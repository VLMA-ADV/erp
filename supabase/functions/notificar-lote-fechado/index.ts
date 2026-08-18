import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

/**
 * Avisa o financeiro que alguém fechou o lote de adiantamento.
 *
 * Filipe, 17/08: "O fechar o lote deve mandar aviso para o financeiro para
 * poder baixar".
 *
 * Até aqui o único aviso era o contador na aba de Lotes — quem não abrisse a
 * tela não ficava sabendo. Agora sai e-mail, pelo mesmo Resend que já manda o
 * convite de colaborador.
 *
 * O e-mail é BEST EFFORT: se o Resend estiver fora ou sem chave, o lote
 * continua fechado do mesmo jeito. Fechar é o que importa; avisar é o extra.
 * Por isso quem chama isto trata a falha como aviso, não como erro.
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

function money(v: unknown) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v || 0))
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } })

  try {
    const authHeader = req.headers.get("Authorization")
    if (!authHeader) return json({ error: "Missing authorization header" }, 401)

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const { data: { user }, error: userError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""))
    if (userError || !user) return json({ error: "Invalid token" }, 401)

    const { lote_id } = (await req.json().catch(() => ({}))) as { lote_id?: string }
    if (!lote_id) return json({ error: "lote_id é obrigatório" }, 400)

    const { data: lote } = await supabase
      .schema("operations")
      .from("despesa_lotes")
      .select("id, valor, descricao, status, colaborador_user_id, tenant_id, fechamento_solicitado_em")
      .eq("id", lote_id)
      .single()

    if (!lote) return json({ error: "Lote não encontrado" }, 404)
    // Só avisa o que de fato está esperando validação — senão dá para disparar
    // e-mail para o financeiro chamando esta função em qualquer lote.
    if (lote.status !== "em_validacao") return json({ enviado: false, motivo: "lote não está em validação" }, 200)

    const { data: dono } = await supabase
      .schema("people")
      .from("colaboradores")
      .select("nome")
      .eq("user_id", lote.colaborador_user_id)
      .eq("tenant_id", lote.tenant_id)
      .maybeSingle()

    // Destinatários: quem pode dar baixa em conta a pagar. É a mesma permissão
    // que a tela de lotes exige para validar — usar outra lista aqui faria o
    // aviso chegar a quem não pode agir nele.
    const { data: destinos } = await supabase.rpc("get_emails_financeiro", { p_tenant_id: lote.tenant_id })
    const emails = (destinos ?? []) as string[]
    if (emails.length === 0) return json({ enviado: false, motivo: "nenhum destinatário" }, 200)

    const resendApiKey = Deno.env.get("RESEND_API_KEY")
    if (!resendApiKey) return json({ enviado: false, motivo: "RESEND_API_KEY não configurada" }, 200)

    const nome = dono?.nome ?? "Um colaborador"
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "VLMA <no-reply@erp.vlma.com.br>",
        to: emails,
        subject: `Lote fechado por ${nome} — esperando baixa`,
        html: `
          <p><strong>${nome}</strong> fechou um lote de adiantamento e ele está esperando validação.</p>
          <p><strong>Lote:</strong> ${lote.descricao ?? "—"}<br/>
             <strong>Adiantado:</strong> ${money(lote.valor)}</p>
          <p>Abra <em>Contas a pagar e receber → Lotes de despesa</em> para conferir e baixar.</p>
        `,
      }),
    })

    if (!resp.ok) {
      const detalhe = await resp.text()
      console.error("Resend recusou:", detalhe.slice(0, 300))
      return json({ enviado: false, motivo: "falha no envio" }, 200)
    }

    return json({ enviado: true, destinatarios: emails.length }, 200)
  } catch (err) {
    console.error(err)
    return json({ error: "Erro ao notificar" }, 500)
  }
})
