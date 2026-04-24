import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasPermission(
  rows: Array<{ permission_key?: string }> | null | undefined,
  required: string,
) {
  return (rows ?? []).some((row) => {
    const key = row.permission_key;
    return key === required || key === "config.*" || key === "*";
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body: unknown = await req.json().catch(() => ({}));
    if (!isRecord(body)) {
      return new Response(JSON.stringify({ error: "Payload inválido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const valor = Number(body.valor);
    if (!Number.isFinite(valor) || valor <= 0) {
      return new Response(JSON.stringify({ error: "valor deve ser maior que zero" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const vigenciaDesde = typeof body.vigencia_desde === "string" ? body.vigencia_desde : undefined;
    if (vigenciaDesde && !/^\d{4}-\d{2}-\d{2}$/.test(vigenciaDesde)) {
      return new Response(JSON.stringify({ error: "vigencia_desde deve estar no formato YYYY-MM-DD" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: permissionsData, error: permissionsError } = await supabase.rpc("get_user_permissions", {
      p_user_id: user.id,
    });

    if (permissionsError || !hasPermission(permissionsData, "config.salario_minimo.write")) {
      return new Response(JSON.stringify({ error: "Você não tem permissão para editar salário mínimo" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload: Record<string, unknown> = { valor };
    if (vigenciaDesde) payload.vigencia_desde = vigenciaDesde;

    const { data, error } = await supabase.rpc("update_salario_minimo", {
      p_user_id: user.id,
      p_payload: payload,
    });

    if (error) {
      return new Response(JSON.stringify({ error: error.message, details: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(data ?? {}), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
