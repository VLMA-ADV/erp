import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

// Consulta o status FINAL de NFS-e Nacional no Focus e persiste o resultado.
// O emit grava apenas o status do momento do envio (processando_autorizacao);
// a prefeitura autoriza/rejeita de forma assíncrona. Esta função fecha o ciclo:
// pergunta ao Focus o status real (autorizado / erro_autorizacao / cancelado),
// grava focus_status + link do PDF (url_danfse) em finance.billing_notes e
// devolve os resultados para o front.
//
// Body: { nota_ids?: string[] } — sem nota_ids, atualiza todas as NFS-e do
// tenant que ainda não chegaram a um status final.
//
// GET /v2/nfsen/{ref} — Basic auth (token como usuário, senha em branco).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const FINAL_STATUSES = ["autorizado", "erro_autorizacao", "cancelado"]

function absoluteUrl(value: unknown, base: string): string | null {
  const s = typeof value === "string" ? value.trim() : ""
  if (!s) return null
  if (s.startsWith("http://") || s.startsWith("https://")) return s
  return `${base}${s.startsWith("/") ? "" : "/"}${s}`
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

    const body = await req.json().catch(() => ({}))
    const notaIds: string[] = Array.isArray(body.nota_ids) ? body.nota_ids : []

    const { data: cfg } = await supabase.rpc("get_focus_nfe_config", { p_tenant_id: tenantId })
    const focusBase = cfg?.focus_env === "production" ? "https://api.focusnfe.com.br" : "https://homologacao.focusnfe.com.br"
    const focusToken = Deno.env.get("FOCUS_NFE_TOKEN") ?? ""

    let query = supabase
      .schema("finance")
      .from("billing_notes")
      .select("id, focus_ref, focus_status, metadata")
      .eq("tenant_id", tenantId)
      .eq("tipo_documento", "nota_fiscal_servico")
      .not("focus_ref", "is", null)

    if (notaIds.length > 0) query = query.in("id", notaIds)
    else query = query.not("focus_status", "in", `(${FINAL_STATUSES.join(",")})`)

    const { data: notas, error: notasError } = await query
    if (notasError) return new Response(JSON.stringify({ error: notasError.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } })

    const results: Array<Record<string, unknown>> = []
    for (const nota of notas ?? []) {
      const r = await fetch(`${focusBase}/v2/nfsen/${encodeURIComponent(nota.focus_ref)}`, {
        headers: { Authorization: `Basic ${btoa(focusToken + ":")}` },
      })
      const j: Record<string, any> = await r.json().catch(() => ({}))

      const status = typeof j.status === "string" ? j.status : null
      const urlDanfse = absoluteUrl(j.url_danfse ?? j.url, focusBase)
      const caminhoXml = absoluteUrl(j.caminho_xml_nota_fiscal, focusBase)

      if (r.ok && status) {
        const updates: Record<string, unknown> = {
          focus_status: status,
          metadata: {
            ...(nota.metadata ?? {}),
            nfse_consulta: {
              status,
              numero_nfse: j.numero ?? null,
              codigo_verificacao: j.codigo_verificacao ?? null,
              url_danfse: urlDanfse,
              caminho_xml: caminhoXml,
              consultado_em: new Date().toISOString(),
            },
          },
        }
        if (urlDanfse) {
          updates.arquivo_url = urlDanfse
          updates.arquivo_nome = `NFS-e ${j.numero ?? nota.focus_ref}.pdf`
        }
        const { error: updError } = await supabase
          .schema("finance")
          .from("billing_notes")
          .update(updates)
          .eq("id", nota.id)
          .eq("tenant_id", tenantId)
        if (updError) {
          results.push({ nota_id: nota.id, ref: nota.focus_ref, error: updError.message })
          continue
        }
      }

      results.push({
        nota_id: nota.id,
        ref: nota.focus_ref,
        http_status: r.status,
        status,
        numero: j.numero ?? null,
        codigo_verificacao: j.codigo_verificacao ?? null,
        url_danfse: urlDanfse,
        caminho_xml: caminhoXml,
        erros: j.erros ?? null,
      })
    }

    return new Response(JSON.stringify({ ok: true, results }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } })
  }
})
