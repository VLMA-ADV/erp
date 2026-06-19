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
      p.permission_key === "operations.despesas.read" ||
      p.permission_key === "operations.despesas.write" ||
      p.permission_key === "operations.despesas.*" ||
      p.permission_key === "operations.*" ||
      p.permission_key === "*"
    );
    if (!allowed) return json({ error: "Você não tem permissão para baixar arquivos de despesa" }, 403);

    const url = new URL(req.url);
    const kind = url.searchParams.get("kind") || "primario";
    const id = url.searchParams.get("id") || "";
    if (!id) return json({ error: "id é obrigatório" }, 400);

    const { data, error } = await supabase.rpc("get_despesa_arquivo", {
      p_user_id: user.id,
      p_kind: kind,
      p_id: id,
    });
    if (error) {
      const msg = error.message || "Erro ao baixar arquivo";
      return json({ error: msg }, /não encontrado/i.test(msg) ? 404 : 500);
    }

    return json(data as Record<string, unknown>, 200);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
