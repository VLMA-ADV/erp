// Duplicar caso:
//   GET                      -> clientes que possuem casos
//   GET ?cliente_id=...      -> casos e contratos daquele cliente
//   POST {origem_caso_id, contrato_destino_id} -> duplica e retorna o novo caso
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

    if (req.method === "POST") {
      const { data: permissionsData } = await supabase.rpc("get_user_permissions", { p_user_id: user.id });
      const allowed = permissionsData?.some((p: any) =>
        p.permission_key === "contracts.contratos.write" ||
        p.permission_key === "contracts.contratos.*" ||
        p.permission_key === "contracts.*" ||
        p.permission_key === "*"
      );
      if (!allowed) return json({ error: "Você não tem permissão para criar casos" }, 403);

      const body = await req.json().catch(() => ({}));
      if (!body.origem_caso_id || !body.contrato_destino_id) {
        return json({ error: "origem_caso_id e contrato_destino_id são obrigatórios" }, 400);
      }
      const { data, error } = await supabase.rpc("duplicate_caso", {
        p_user_id: user.id,
        p_origem_caso_id: body.origem_caso_id,
        p_contrato_destino_id: body.contrato_destino_id,
      });
      if (error) {
        const msg = error.message || "Erro ao duplicar caso";
        return json({ error: msg }, /não encontrad/i.test(msg) ? 404 : 500);
      }
      return json(data as Record<string, unknown>, 200);
    }

    const url = new URL(req.url);
    const clienteId = url.searchParams.get("cliente_id");
    if (clienteId) {
      const { data, error } = await supabase.rpc("get_cliente_casos_contratos", { p_user_id: user.id, p_cliente_id: clienteId });
      if (error) return json({ error: error.message }, 500);
      return json({ data }, 200);
    }

    const { data, error } = await supabase.rpc("get_clientes_com_casos", { p_user_id: user.id });
    if (error) return json({ error: error.message }, 500);
    return json({ data }, 200);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
