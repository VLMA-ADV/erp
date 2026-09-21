import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function enrichContratoWithSequentialData(
  supabase: ReturnType<typeof createClient>,
  payload: any,
  contratoId: string,
) {
  const { data: record } = await supabase
    .schema("contracts")
    .from("contratos")
    .select("id, numero_sequencial, nome_contrato")
    .eq("id", contratoId)
    .maybeSingle();

  if (!record || !payload || typeof payload !== "object") return payload;

  const nextPayload = { ...payload };
  const contrato = nextPayload.contrato && typeof nextPayload.contrato === "object"
    ? { ...nextPayload.contrato }
    : {};

  contrato.numero_sequencial = record.numero_sequencial ?? contrato.numero_sequencial ?? null;
  contrato.nome_contrato = record.nome_contrato ?? contrato.nome_contrato ?? "";
  nextPayload.contrato = contrato;

  return nextPayload;
}

// enviar_relatorio_timesheet (Filipe, 21/09, D15-a) não está na projeção da
// RPC get_contrato, que monta o JSON coluna a coluna. Ela é gravada fora da
// RPC também (caso-flags-sync.ts), então o caminho de leitura fica espelhado
// aqui: lê direto de contracts.casos e mescla em cada caso. Se a coluna ainda
// não existir, o select falha e a resposta segue sem a flag — o formulário
// trata ausência como "não".
async function enrichCasosWithFlags(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  payload: any,
  contratoId: string,
) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.casos) || payload.casos.length === 0) {
    return payload;
  }
  const { data: rows, error } = await supabase
    .schema("contracts")
    .from("casos")
    .select("id, enviar_relatorio_timesheet")
    .eq("contrato_id", contratoId);
  if (error || !Array.isArray(rows)) {
    if (error) console.error("flags do caso nao carregaram:", error.message);
    return payload;
  }
  const porId = new Map<string, Record<string, unknown>>();
  for (const row of rows as Array<Record<string, unknown>>) porId.set(String(row.id), row);
  return {
    ...payload,
    casos: payload.casos.map((caso: any) => {
      const flags = caso && typeof caso === "object" ? porId.get(String(caso.id)) : undefined;
      if (!flags) return caso;
      return { ...caso, enviar_relatorio_timesheet: flags.enviar_relatorio_timesheet === true };
    }),
  };
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

    const contratoId = new URL(req.url).searchParams.get("id");
    if (!contratoId) {
      return new Response(JSON.stringify({ error: "ID do contrato é obrigatório" }), {
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
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: permissionsData } = await supabase.rpc("get_user_permissions", { p_user_id: user.id });
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

    const { data, error } = await supabase.rpc("get_contrato", {
      p_user_id: user.id,
      p_contrato_id: contratoId,
    });

    if (error) {
      return new Response(JSON.stringify({ error: error.message, details: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const enrichedData = await enrichCasosWithFlags(
      supabase,
      await enrichContratoWithSequentialData(supabase, data, contratoId),
      contratoId,
    );

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
