import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

function digits(v: string | null | undefined): string {
  return (v ?? "").replace(/\D/g, "")
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  try {
    const authHeader = req.headers.get("Authorization")
    if (!authHeader) return new Response(JSON.stringify({ error: "Missing authorization header" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } })

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const token = authHeader.replace("Bearer ", "")
    const { data: { user }, error: userError } = await supabase.auth.getUser(token)
    if (userError || !user) return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } })

    const { data: tenantId } = await supabase.rpc("get_tenant_for_user", { p_user_id: user.id })
    if (!tenantId) return new Response(JSON.stringify({ error: "Usuário não associado a tenant" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } })

    const body = await req.json()
    const { contrato_id } = body as { contrato_id?: string }
    if (!contrato_id) return new Response(JSON.stringify({ error: "contrato_id é obrigatório" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } })

    const { data: cfg } = await supabase.rpc("get_focus_nfe_config", { p_tenant_id: tenantId })
    if (!cfg) return new Response(JSON.stringify({ error: "Configuração fiscal não encontrada. Cadastre em /configuracao/fiscal-nfse." }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } })

    const { data: dataset } = await supabase.rpc("get_billing_items_aprovados_full", { p_tenant_id: tenantId, p_contrato_id: contrato_id })
    if (!dataset || !dataset.itens || dataset.itens.length === 0) return new Response(JSON.stringify({ error: "Nenhum item aprovado encontrado para este contrato" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } })

    const itens = dataset.itens as Array<{ id: string; valor: number; snapshot: Record<string, unknown> }>
    const tomador = dataset.tomador as Record<string, any> | null
    const grupo = dataset.grupo_imposto as Record<string, any> | null

    if (!tomador) return new Response(JSON.stringify({ error: "Cliente do contrato não encontrado." }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } })

    const missingTomador: string[] = []
    if (!tomador.cnpj) missingTomador.push("cnpj")
    if (!tomador.codigo_ibge) missingTomador.push("codigo_ibge")
    if (!tomador.cep) missingTomador.push("cep")
    if (!tomador.rua) missingTomador.push("rua")
    if (!tomador.numero) missingTomador.push("numero")
    if (!tomador.bairro) missingTomador.push("bairro")
    if (missingTomador.length > 0) {
      return new Response(JSON.stringify({ error: `Cliente ${tomador.nome} sem dados fiscais completos. Faltam: ${missingTomador.join(", ")}. Preencha em /pessoas/clientes.` }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } })
    }

    if (!grupo || !grupo.codigo_tributacao_nacional_iss || !grupo.codigo_nbs || !grupo.aliquota_iss) {
      return new Response(JSON.stringify({ error: "Contrato sem grupo de impostos configurado para NFS-e. Selecione um grupo válido no contrato." }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } })
    }

    const valorTotal = itens.reduce((s, i) => s + Number(i.valor ?? 0), 0)
    const valorIss = Math.round(valorTotal * Number(grupo.aliquota_iss) * 100) / 10000
    const valorIssRounded = Math.round(valorIss * 100) / 100

    const discriminacaoSet = new Set<string>()
    for (const it of itens) {
      const s = it.snapshot || {}
      discriminacaoSet.add(String((s as any).caso_nome || (s as any).descricao || "Serviços advocatícios"))
    }
    const discriminacao = Array.from(discriminacaoSet).join("; ") || "Serviços advocatícios"

    const { data: numeroDps } = await supabase.rpc("allocate_numero_dps", { p_tenant_id: tenantId })

    const focusToken = Deno.env.get("FOCUS_NFE_TOKEN") ?? ""
    const focusBase = cfg.focus_env === "production" ? "https://api.focusnfe.com.br" : "https://homologacao.focusnfe.com.br"
    const ref = `vlma-${tenantId}-${contrato_id}-${Date.now()}`

    const nfsePayload: Record<string, unknown> = {
      data_emissao: new Date().toISOString(),
      data_competencia: new Date().toISOString().slice(0, 10),
      serie_dps: cfg.serie_dps,
      numero_dps: String(numeroDps ?? 1),

      cnpj_prestador: digits(cfg.cnpj),
      inscricao_municipal_prestador: cfg.inscricao_municipal ?? undefined,
      codigo_municipio_prestador: Number(cfg.codigo_municipio),
      codigo_municipio_emissora: Number(cfg.codigo_municipio),
      codigo_municipio_prestacao: Number(cfg.codigo_municipio),
      telefone_prestador: digits(cfg.telefone),
      email_prestador: cfg.email,
      codigo_opcao_simples_nacional: cfg.codigo_opcao_simples_nacional,
      regime_especial_tributacao: cfg.regime_especial_tributacao,
      cep_prestador:         digits(cfg.cep_prestador),
      logradouro_prestador:  cfg.logradouro_prestador,
      numero_prestador:      String(cfg.numero_prestador ?? ''),
      bairro_prestador:      cfg.bairro_prestador,
      ...(cfg.complemento_prestador ? { complemento_prestador: cfg.complemento_prestador } : {}),

      cnpj_tomador: digits(tomador.cnpj),
      razao_social_tomador: tomador.nome,
      codigo_municipio_tomador: Number(tomador.codigo_ibge),
      cep_tomador: digits(tomador.cep),
      logradouro_tomador: tomador.rua,
      numero_tomador: String(tomador.numero),
      complemento_tomador: tomador.complemento || "-",
      bairro_tomador: tomador.bairro,
      telefone_tomador: digits(tomador.telefone) || undefined,
      email_tomador: tomador.email || undefined,

      codigo_tributacao_nacional_iss: grupo.codigo_tributacao_nacional_iss,
      codigo_nbs: grupo.codigo_nbs,
      descricao_servico: discriminacao,
      valor_servico: Number(valorTotal.toFixed(2)),
      valor_iss: valorIssRounded,
      tributacao_iss: grupo.tributacao_iss,
      tipo_retencao_iss: grupo.tipo_retencao_iss,
      situacao_tributaria_pis_cofins: grupo.situacao_tributaria_pis_cofins,
      percentual_total_tributos_federais: String(grupo.pct_trib_federais ?? 0),
      percentual_total_tributos_estaduais: String(grupo.pct_trib_estaduais ?? 0),
      percentual_total_tributos_municipais: String(grupo.pct_trib_municipais ?? 0),
    }

    const focusResp = await fetch(`${focusBase}/v2/nfsen?ref=${ref}`, {
      method: "POST",
      headers: { Authorization: `Basic ${btoa(focusToken + ":")}`, "Content-Type": "application/json" },
      body: JSON.stringify(nfsePayload),
    })

    const focusBody = await focusResp.json().catch(() => ({}))
    // Focus NFe retorna 202 (Accepted) para emissões async (NFSe Nacional) — também é sucesso.
    // Tratar como erro apenas se houver código de erro explícito ou status >= 400.
    const accepted = focusResp.status >= 200 && focusResp.status < 300 && !(focusBody as any)?.codigo

    // focus_status: usa o status retornado pelo Focus (ex.: "processando_autorizacao") ou fallback
    const focusStatus = accepted ? String((focusBody as any)?.status ?? "pendente") : "erro"

    const { data: noteId } = await supabase.rpc("insert_billing_note", {
      p_tenant_id: tenantId,
      p_contrato_id: contrato_id,
      p_tipo_documento: "nota_fiscal_servico",
      p_status: accepted ? "gerado" : "cancelado",
      p_focus_ref: ref,
      p_focus_status: focusStatus,
      p_metadata: { focus_request: nfsePayload, focus_response: focusBody, item_ids: itens.map(i => i.id), valor_total: valorTotal, valor_iss: valorIssRounded },
      p_created_by: user.id,
    })

    if (!accepted) {
      return new Response(JSON.stringify({ error: "Focus NFe recusou a solicitação", focus_response: focusBody, ref, nota_id: noteId }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } })
    }

    return new Response(JSON.stringify({ ok: true, ref, focus_status: focusStatus, nota_id: noteId, valor_total: valorTotal, valor_iss: valorIssRounded, focus_response: focusBody }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } })
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } })
  }
})
