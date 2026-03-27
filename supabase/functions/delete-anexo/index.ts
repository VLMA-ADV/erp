/**
 * Edge: delete-anexo
 * SPEC: RF-019 | RNF-002 | RULES §3–4
 * Remove anexo de contrato ou caso em contracts.*_anexos: valida JWT, permissões (RPC) e tenant;
 * delete via service role com filtro tenant_id (schema contracts não tem USAGE para authenticated no REST).
 *
 * Deploy: manter verify_jwt=false no dashboard/CLI (mesmo padrão que get-user-permissions).
 * O gateway com verify_jwt=true rejeita sessões JWT ES256 do GoTrue; a validação fica em auth.getUser().
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonRes(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function permissionKeys(
  rows: { permission_key: string }[] | null,
): string[] {
  return rows?.map((r) => r.permission_key).filter(Boolean) ?? [];
}

/** Alinhado a contrato-form.tsx (somente escrita em contratos). */
function canDeleteContratoAnexo(keys: string[]): boolean {
  return keys.some(
    (p) =>
      p === "contracts.contratos.write" ||
      p === "contracts.contratos.*" ||
      p === "contracts.*",
  );
}

/** Alinhado a caso-form.tsx (caso ou contrato write). */
function canDeleteCasoAnexo(keys: string[]): boolean {
  return keys.some(
    (p) =>
      p === "contracts.casos.write" ||
      p === "contracts.casos.*" ||
      p === "contracts.contratos.write" ||
      p === "contracts.contratos.*" ||
      p === "contracts.*",
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonRes({ error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonRes({ error: "Missing authorization header" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("delete-anexo: missing SUPABASE_URL or service role key");
      return jsonRes({ error: "Server configuration error" }, 500);
    }

    const admin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: userError,
    } = await admin.auth.getUser(token);

    if (userError || !user) {
      return jsonRes(
        {
          error: "Invalid or expired token",
          details: userError?.message ?? null,
        },
        401,
      );
    }

    let body: { tipo?: string; id?: string };
    try {
      body = await req.json();
    } catch {
      return jsonRes({ error: "Invalid JSON body" }, 400);
    }

    const { tipo, id } = body;

    if (tipo !== "contrato" && tipo !== "caso") {
      return jsonRes(
        { error: 'Invalid tipo: expected "contrato" or "caso"' },
        400,
      );
    }

    if (!id || typeof id !== "string" || !UUID_RE.test(id)) {
      return jsonRes({ error: "Invalid id: expected UUID" }, 400);
    }

    const { data: permsRows, error: permErr } = await admin.rpc(
      "get_user_permissions",
      { p_user_id: user.id },
    );

    if (permErr) {
      console.error("get_user_permissions:", permErr);
      return jsonRes({ error: "Unable to verify permissions" }, 500);
    }

    const keys = permissionKeys(permsRows as { permission_key: string }[]);

    if (tipo === "contrato" && !canDeleteContratoAnexo(keys)) {
      return jsonRes({ error: "Forbidden" }, 403);
    }
    if (tipo === "caso" && !canDeleteCasoAnexo(keys)) {
      return jsonRes({ error: "Forbidden" }, 403);
    }

    const { data: tenantRows, error: tenantErr } = await admin.rpc(
      "get_user_tenant",
      { p_user_id: user.id },
    );

    if (tenantErr) {
      console.error("get_user_tenant:", tenantErr);
      return jsonRes({ error: "Unable to resolve tenant" }, 500);
    }

    const userTenantId = (tenantRows as { tenant_id: string }[] | null)?.[0]
      ?.tenant_id;
    if (!userTenantId) {
      return jsonRes({ error: "Forbidden" }, 403);
    }

    const table = tipo === "contrato" ? "contrato_anexos" : "caso_anexos";

    const { data: row, error: rowErr } = await admin
      .schema("contracts")
      .from(table)
      .select("id,tenant_id")
      .eq("id", id)
      .maybeSingle();

    if (rowErr) {
      console.error("delete-anexo fetch row:", rowErr);
      return jsonRes({ error: rowErr.message || "Lookup failed" }, 400);
    }

    if (!row) {
      return jsonRes(
        { error: "Anexo not found or not accessible for this tenant" },
        404,
      );
    }

    if (row.tenant_id !== userTenantId) {
      return jsonRes(
        { error: "Anexo not found or not accessible for this tenant" },
        404,
      );
    }

    const { data: deleted, error: delError } = await admin
      .schema("contracts")
      .from(table)
      .delete()
      .eq("id", id)
      .eq("tenant_id", userTenantId)
      .select("id");

    if (delError) {
      console.error("delete-anexo delete error:", delError);
      return jsonRes({ error: delError.message || "Delete failed" }, 400);
    }

    if (!deleted?.length) {
      return jsonRes(
        { error: "Anexo not found or not accessible for this tenant" },
        404,
      );
    }

    return jsonRes({ ok: true, id: deleted[0].id }, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonRes({ error: msg }, 500);
  }
});
