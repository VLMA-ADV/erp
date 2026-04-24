import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function enrichContratosWithSequentialData(supabase: ReturnType<typeof createClient>, contratos: any[]) {
  if (!Array.isArray(contratos) || contratos.length === 0) return contratos ?? [];

  const contratoIds = contratos
    .map((item: any) => typeof item?.id === "string" ? item.id : "")
    .filter(Boolean);

  if (contratoIds.length === 0) return contratos;

  const { data: records } = await supabase
    .schema("contracts")
    .from("contratos")
    .select("id, numero_sequencial, nome_contrato")
    .in("id", contratoIds);

  const byId = new Map((records ?? []).map((entry: any) => [entry.id, entry]));

  return contratos.map((item: any) => {
    const contractRecord = byId.get(item.id);
    if (!contractRecord) return item;
    return {
      ...item,
      numero_sequencial: contractRecord.numero_sequencial ?? item.numero_sequencial ?? null,
      nome_contrato: contractRecord.nome_contrato ?? item.nome_contrato ?? "",
    };
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: permissionsData, error: permissionsError } = await supabase.rpc(
      "get_user_permissions",
      { p_user_id: user.id },
    );

    if (permissionsError) {
      return new Response(JSON.stringify({ error: "Erro ao verificar permissões" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const hasPermission = permissionsData?.some((p: any) =>
      p.permission_key === "contracts.contratos.read" ||
      p.permission_key === "contracts.contratos.*" ||
      p.permission_key === "contracts.*" ||
      p.permission_key === "*"
    );

    if (!hasPermission) {
      return new Response(JSON.stringify({ error: "Você não tem permissão para visualizar contratos" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data, error } = await supabase.rpc("get_contratos", { p_user_id: user.id });
    if (error) {
      return new Response(JSON.stringify({ error: error.message, details: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const enrichedData = await enrichContratosWithSequentialData(supabase, data ?? []);

    return new Response(JSON.stringify({ data: enrichedData }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
