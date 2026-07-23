import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BUCKET = "colaboradores-fotos";

function json(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function extFromMime(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  return "jpg";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization header" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabase = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) return json({ error: "Invalid token" }, 401);

    const { data: permissionsData } = await supabase.rpc("get_user_permissions", { p_user_id: user.id });
    const allowed = permissionsData?.some((p: any) =>
      p.permission_key === "people.colaboradores.write" ||
      p.permission_key === "people.colaboradores.*" ||
      p.permission_key === "people.*" ||
      p.permission_key === "*"
    );
    if (!allowed) return json({ error: "Você não tem permissão para alterar colaboradores" }, 403);

    const body = await req.json().catch(() => ({}));
    const colaboradorId: string = body.colaborador_id;
    const base64: string = body.arquivo_base64 || "";
    const mime: string = body.mime_type || "image/jpeg";
    if (!colaboradorId) return json({ error: "colaborador_id é obrigatório" }, 400);
    if (!base64) return json({ error: "arquivo_base64 é obrigatório" }, 400);

    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const path = `${colaboradorId}.${extFromMime(mime)}`;

    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, bytes, {
      contentType: mime,
      upsert: true,
    });
    if (upErr) return json({ error: upErr.message }, 500);

    // Bucket privado: guarda o PATH do objeto (não a URL pública). Quem lê
    // (list-colaboradores, timesheet) gera uma signed URL temporária na hora.
    const fotoUrl = path;

    const { error: setErr } = await supabase.rpc("set_colaborador_foto", {
      p_user_id: user.id,
      p_colaborador_id: colaboradorId,
      p_foto_url: fotoUrl,
    });
    if (setErr) {
      const msg = setErr.message || "Erro ao salvar foto";
      return json({ error: msg }, /não encontrado/i.test(msg) ? 404 : 500);
    }

    return json({ ok: true, foto_url: fotoUrl }, 200);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
