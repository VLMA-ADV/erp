import "jsr:@supabase/functions-js/edge-runtime.d.ts"

// Consulta o status FINAL de uma NFS-e Nacional no Focus por referência (ref).
// O emit grava apenas o status do momento do envio (processando_autorizacao);
// a prefeitura autoriza/rejeita de forma assíncrona. Esta função fecha o ciclo:
// pergunta ao Focus o status real (autorizado / erro_autorizacao / cancelado)
// e devolve número da NFS-e, código de verificação e links de PDF/XML.
//
// GET /v2/nfsen/{ref} — Basic auth (token como usuário, senha em branco).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  try {
    const body = await req.json().catch(() => ({}))
    const refs: string[] = Array.isArray(body.refs) ? body.refs : (body.ref ? [body.ref] : [])
    if (refs.length === 0) {
      return new Response(JSON.stringify({ error: "informe { ref } ou { refs: [] }" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } })
    }

    const focusToken = Deno.env.get("FOCUS_NFE_TOKEN") ?? ""
    const focusBase = body.env === "homologacao" ? "https://homologacao.focusnfe.com.br" : "https://api.focusnfe.com.br"

    const results: Array<Record<string, unknown>> = []
    for (const ref of refs) {
      const r = await fetch(`${focusBase}/v2/nfsen/${encodeURIComponent(ref)}`, {
        headers: { Authorization: `Basic ${btoa(focusToken + ":")}` },
      })
      const j = await r.json().catch(() => ({}))
      results.push({
        ref,
        http_status: r.status,
        status: (j as any).status,
        numero: (j as any).numero,
        codigo_verificacao: (j as any).codigo_verificacao,
        url: (j as any).url,
        url_danfse: (j as any).url_danfse,
        caminho_xml: (j as any).caminho_xml_nota_fiscal,
        erros: (j as any).erros,
        raw: j,
      })
    }

    return new Response(JSON.stringify({ ok: true, results }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } })
  }
})
