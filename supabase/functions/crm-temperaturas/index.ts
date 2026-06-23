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
      const body = await req.json().catch(() => ({}));
      const { data, error } = await supabase.rpc("create_crm_temperatura", { p_user_id: user.id, p_nome: body.nome });
      if (error) return json({ error: error.message }, /obrigatório/i.test(error.message) ? 400 : 500);
      return json({ data }, 200);
    }

    const { data, error } = await supabase.rpc("list_crm_temperaturas", { p_user_id: user.id });
    if (error) return json({ error: error.message }, 500);
    return json({ data }, 200);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
