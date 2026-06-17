import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization header" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) return json({ error: "Invalid token" }, 401);

    const { data: permissionsData } = await supabase.rpc("get_user_permissions", { p_user_id: user.id });
    const allowed = permissionsData?.some((p: any) =>
      p.permission_key === "operations.timesheet.write" ||
      p.permission_key === "operations.timesheet.*" ||
      p.permission_key === "operations.*" ||
      p.permission_key === "*"
    );
    if (!allowed) return json({ error: "Você não tem permissão para excluir timesheet" }, 403);

    const body = await req.json().catch(() => ({}));
    if (!body.id) return json({ error: "ID do timesheet é obrigatório" }, 400);

    const { data: tenantRows, error: tenantError } = await supabase.rpc("get_user_tenant", { p_user_id: user.id });
    if (tenantError) return json({ error: tenantError.message }, 500);
    const tenantId = Array.isArray(tenantRows) && tenantRows.length > 0 ? tenantRows[0]?.tenant_id as string | undefined : undefined;
    if (!tenantId) return json({ error: "Usuário sem tenant vinculado" }, 403);

    // Guarda: não excluir lançamento já aprovado (pode já ter entrado no faturamento).
    const { data: existing, error: fetchError } = await supabase
      .schema("operations").from("timesheets")
      .select("id, status").eq("id", body.id).eq("tenant_id", tenantId).single();
    if (fetchError || !existing) return json({ error: "Lançamento não encontrado" }, 404);
    if (existing.status === "aprovado") {
      return json({ error: "Não é possível excluir um lançamento já aprovado. Reabra a revisão antes." }, 422);
    }

    const { error: delError } = await supabase
      .schema("operations").from("timesheets")
      .delete().eq("id", body.id).eq("tenant_id", tenantId);
    if (delError) return json({ error: delError.message }, 500);

    return json({ ok: true, id: body.id }, 200);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
