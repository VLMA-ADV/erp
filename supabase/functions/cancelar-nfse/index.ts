import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

// Cancela uma NFS-e Nacional.
// - Nota AUTORIZADA na prefeitura: cancelamento fiscal real via Focus
//   (DELETE /v2/nfsen/{ref} com justificativa) — irreversível.
// - Nota nunca autorizada (processando, rejeitada, pendente): não existe nada
//   na prefeitura; apenas marca status='cancelado' em finance.billing_notes.
//
// Body: { nota_id: string, justificativa?: string }

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

function jsonResponse(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } })
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  try {
    const authHeader = req.headers.get("Authorization")
    if (!authHeader) return jsonResponse({ error: "Missing authorization header" }, 401)

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const token = authHeader.replace("Bearer ", "")
    const { data: { user }, error: userError } = await supabase.auth.getUser(token)
    if (userError || !user) return jsonResponse({ error: "Invalid token" }, 401)

    const { data: tenantId } = await supabase.rpc("get_tenant_for_user", { p_user_id: user.id })
    if (!tenantId) return jsonResponse({ error: "Usuário não associado a tenant" }, 403)

    // Cancelar NFS-e é restrito à capacidade 'finance.nfse.manage' (sócios + Jessika Lira).
    const { data: podeNfse } = await supabase.rpc("tem_capacidade_sensivel", { p_user_id: user.id, p_capacidade: "finance.nfse.manage" })
    if (podeNfse !== true) return jsonResponse({ error: "Sem permissão para cancelar NFS-e" }, 403)

    const body = await req.json().catch(() => ({}))
    const notaId: string | undefined = body.nota_id
    const justificativa: string = String(body.justificativa || "").trim() || "Cancelamento solicitado pelo prestador (emissão indevida)."
    if (!notaId) return jsonResponse({ error: "nota_id é obrigatório" }, 400)

    const { data: nota, error: notaError } = await supabase
      .schema("finance")
      .from("billing_notes")
      .select("id, status, tipo_documento, focus_ref, focus_status, metadata")
      .eq("id", notaId)
      .eq("tenant_id", tenantId)
      .single()
    if (notaError || !nota) return jsonResponse({ error: "Nota não encontrada" }, 404)
    if (nota.tipo_documento !== "nota_fiscal_servico") return jsonResponse({ error: "Apenas notas fiscais de serviço podem ser canceladas por aqui" }, 422)
    if (nota.status === "cancelado") return jsonResponse({ error: "Nota já está cancelada" }, 422)

    const { data: cfg } = await supabase.rpc("get_focus_nfe_config", { p_tenant_id: tenantId })
    const focusBase = cfg?.focus_env === "production" ? "https://api.focusnfe.com.br" : "https://homologacao.focusnfe.com.br"
    const focusToken = Deno.env.get("FOCUS_NFE_TOKEN") ?? ""

    let focusCancel: Record<string, any> | null = null

    // Só existe cancelamento fiscal se a nota foi autorizada na prefeitura.
    if (nota.focus_ref && nota.focus_status === "autorizado") {
      const r = await fetch(`${focusBase}/v2/nfsen/${encodeURIComponent(nota.focus_ref)}`, {
        method: "DELETE",
        headers: { Authorization: `Basic ${btoa(focusToken + ":")}`, "Content-Type": "application/json" },
        body: JSON.stringify({ justificativa }),
      })
      focusCancel = await r.json().catch(() => ({}))
      const cancelStatus = String(focusCancel?.status ?? "")
      const accepted = r.status >= 200 && r.status < 300 && cancelStatus !== "erro_cancelamento"
      if (!accepted) {
        return jsonResponse({ error: "Focus NFe recusou o cancelamento", focus_response: focusCancel, http_status: r.status }, 422)
      }
    }

    const { error: updError } = await supabase
      .schema("finance")
      .from("billing_notes")
      .update({
        status: "cancelado",
        focus_status: "cancelado",
        metadata: {
          ...(nota.metadata ?? {}),
          nfse_cancelamento: {
            justificativa,
            cancelado_na_prefeitura: nota.focus_status === "autorizado",
            focus_response: focusCancel,
            cancelado_por: user.id,
            cancelado_em: new Date().toISOString(),
          },
        },
      })
      .eq("id", nota.id)
      .eq("tenant_id", tenantId)
    if (updError) return jsonResponse({ error: updError.message }, 500)

    return jsonResponse({ ok: true, nota_id: nota.id, cancelado_na_prefeitura: nota.focus_status === "autorizado", focus_response: focusCancel }, 200)
  } catch (e) {
    return jsonResponse({ error: (e as Error).message }, 500)
  }
})
