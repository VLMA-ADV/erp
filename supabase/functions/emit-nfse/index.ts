import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  try {
    const authHeader = req.headers.get("Authorization")
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const token = authHeader.replace("Bearer ", "")
    const { data: { user }, error: userError } = await supabase.auth.getUser(token)
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Resolve tenant via RPC (core schema não exposto no PostgREST)
    const { data: tenantId, error: tenantError } = await supabase.rpc("get_tenant_for_user", { p_user_id: user.id })
    if (tenantError || !tenantId) {
      return new Response(JSON.stringify({ error: "Usuário não associado a tenant" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const body = await req.json()
    const { contrato_id, billing_item_ids } = body as {
      contrato_id?: string
      billing_item_ids?: string[]
    }

    if (!contrato_id && (!billing_item_ids || billing_item_ids.length === 0)) {
      return new Response(JSON.stringify({ error: "contrato_id ou billing_item_ids é obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Buscar itens aprovados via RPC (evita schema routing do PostgREST)
    const { data: items, error: itemsError } = await supabase.rpc("get_billing_items_aprovados", {
      p_tenant_id:   tenantId as string,
      p_contrato_id: contrato_id   ?? null,
      p_item_ids:    billing_item_ids?.length ? billing_item_ids : null,
    })

    if (itemsError || !items || items.length === 0) {
      return new Response(JSON.stringify({ error: "Nenhum item aprovado encontrado para este contrato" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Calcular valor total e discriminação
    const valorTotal = items.reduce((sum: number, item: any) => {
      return sum + Number(item.valor_aprovado ?? item.valor_revisado ?? 0)
    }, 0)

    const discriminacaoSet = new Set<string>()
    for (const item of items as any[]) {
      const snap = (item.snapshot as Record<string, unknown>) || {}
      const desc = String(snap.caso_nome || snap.descricao || "Serviços advocatícios")
      discriminacaoSet.add(desc)
    }
    const discriminacao = Array.from(discriminacaoSet).join("; ") || "Serviços advocatícios"

    // Focus NFe config
    const focusToken = Deno.env.get("FOCUS_NFE_TOKEN") ?? ""
    const focusEnv = Deno.env.get("FOCUS_NFE_ENV") ?? "homologation"
    const focusBase = focusEnv === "production"
      ? "https://api.focusnfe.com.br"
      : "https://homologacao.focusnfe.com.br"

    const cnpjPrestador = (Deno.env.get("FOCUS_NFE_CNPJ") ?? "14491612000139").replace(/\D/g, "")
    const inscricaoMunicipal = Deno.env.get("FOCUS_NFE_INSCRICAO_MUNICIPAL") ?? "6265382"
    const itemListaServico = Deno.env.get("FOCUS_NFE_ITEM_LISTA_SERVICO") ?? "1714"
    const aliquota = Number(Deno.env.get("FOCUS_NFE_ALIQUOTA") ?? "3.5")
    const codigoTributario = Deno.env.get("FOCUS_NFE_CODIGO_TRIBUTARIO") ?? ""

    const ref = `vlma-${Date.now()}`

    const codigoMunicipio = Deno.env.get("FOCUS_NFE_CODIGO_MUNICIPIO") ?? "4106902" // Curitiba
    const nfseEndpoint = Deno.env.get("FOCUS_NFE_ENDPOINT") ?? "nfsen" // nfse | nfsen (Curitiba usa NFS-e Nacional)

    // Payload NFS-e Nacional (/v2/nfsen): campos no nível raiz, não aninhados em prestador
    const nfsePayload: Record<string, unknown> = {
      cnpj_prestador: cnpjPrestador,
      inscricao_municipal_prestador: inscricaoMunicipal,
      codigo_municipio_prestador: codigoMunicipio,
      valor_servicos: valorTotal.toFixed(2),
      discriminacao,
      codigo_item_lista_servico: itemListaServico,
      aliquota_iss: aliquota,
      ...(codigoTributario ? { codigo_tributario_municipio: codigoTributario } : {}),
    }

    const focusResp = await fetch(`${focusBase}/v2/${nfseEndpoint}?ref=${ref}`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(focusToken + ":")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(nfsePayload),
    })

    const focusBody = await focusResp.json().catch(() => ({}))
    const accepted = focusResp.status === 201 || focusResp.status === 200
    const focusStatus = accepted ? "pendente" : "erro"

    // Registrar nota via RPC (evita schema routing do PostgREST)
    const { data: noteId } = await supabase.rpc("insert_billing_note", {
      p_tenant_id:      tenantId as string,
      p_contrato_id:    (items[0] as any).contrato_id,
      p_tipo_documento: "nota_fiscal_servico",
      p_status:         accepted ? "gerado" : "cancelado",
      p_focus_ref:      ref,
      p_focus_status:   focusStatus,
      p_metadata:       {
        focus_response: focusBody,
        item_ids:       items.map((i: any) => i.id),
        valor_total:    valorTotal,
        discriminacao,
      },
      p_created_by: user.id,
    })

    if (!accepted) {
      return new Response(
        JSON.stringify({ error: "Focus NFe recusou a solicitação", focus_response: focusBody }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      )
    }

    return new Response(
      JSON.stringify({
        ok: true,
        ref,
        focus_status: focusStatus,
        nota_id:      noteId ?? null,
        valor_total:  valorTotal,
        focus_response: focusBody,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
