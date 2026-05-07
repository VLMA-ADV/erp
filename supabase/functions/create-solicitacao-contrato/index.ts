import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    const { data: permissionsData } = await supabase.rpc("get_user_permissions", { p_user_id: user.id });
    const hasPermission = permissionsData?.some((p: any) =>
      p.permission_key === "contracts.solicitacoes.write" ||
      p.permission_key === "contracts.solicitacoes.*" ||
      p.permission_key === "contracts.*" ||
      p.permission_key === "*"
    );

    if (!hasPermission) {
      return new Response(JSON.stringify({ error: "Você não tem permissão para criar solicitação" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const raw = await req.json();
    const nomeIn = typeof raw?.nome === "string" ? raw.nome.trim() : "";
    const descIn = typeof raw?.descricao === "string" ? raw.descricao.trim() : "";
    const clienteId = typeof raw?.cliente_id === "string" && raw.cliente_id.trim().length > 0 ? raw.cliente_id.trim() : null;
    const nomeClienteNovo =
      typeof raw?.nome_cliente_novo === "string" && raw.nome_cliente_novo.trim().length > 0
        ? raw.nome_cliente_novo.trim()
        : null;

    if (!clienteId && !nomeClienteNovo) {
      return new Response(
        JSON.stringify({ error: "Selecione um cliente existente ou informe o nome do cliente novo." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const payload = {
      ...raw,
      cliente_id: clienteId,
      nome_cliente_novo: nomeClienteNovo,
      nome: nomeIn || "Solicitação de contrato",
      descricao: descIn || "Sem descrição",
    };

    // Daily 2026-05-07 (Item 8): solicitação NÃO cria contrato auto. Filipe quer ZERO
    // auto-criação. Removidos: bloco RF-011 (link_contrato_rascunho_para_solicitacao)
    // e fallback defensivo de INSERT manual em contracts.contratos. A criação do
    // contrato passa a ocorrer apenas no fluxo de aprovação manual via
    // concluir_solicitacao_contrato (que já cria contrato 'rascunho' quando aprovada
    // sem contrato_id existente).
    const { data, error } = await supabase.rpc("create_solicitacao_contrato", {
      p_user_id: user.id,
      p_payload: payload,
    });

    if (error) {
      const msg = String(error.message || "");
      const isBusinessValidation =
        msg.includes(" é obrigatório") ||
        msg.includes(" não encontrado") ||
        msg.includes("Selecione um cliente existente") ||
        msg.includes("informe o nome do cliente novo") ||
        msg.includes("Anexo de proposta é obrigatório");

      return new Response(JSON.stringify({ error: msg, details: msg }), {
        status: isBusinessValidation ? 400 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
