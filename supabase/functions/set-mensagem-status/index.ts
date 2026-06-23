// Marca uma mensagem de solicitação como lida e/ou com providência tomada.
// Apenas financeiro (admin/sócio) — validado nas RPCs SECURITY DEFINER.
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

    const body = await req.json().catch(() => ({}));
    if (!body.mensagem_id) return json({ error: "mensagem_id é obrigatório" }, 400);

    if (typeof body.lida === "boolean") {
      const { error } = await supabase.rpc("set_mensagem_lida", {
        p_user_id: user.id, p_mensagem_id: body.mensagem_id, p_lida: body.lida,
      });
      if (error) return json({ error: error.message }, /financeiro/i.test(error.message) ? 403 : 500);
    }

    if (typeof body.providencia === "boolean") {
      const { error } = await supabase.rpc("set_mensagem_providencia", {
        p_user_id: user.id, p_mensagem_id: body.mensagem_id, p_tomada: body.providencia,
      });
      if (error) return json({ error: error.message }, /financeiro/i.test(error.message) ? 403 : 500);
    }

    return json({ ok: true }, 200);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
