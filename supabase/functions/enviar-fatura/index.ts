import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

/**
 * Envia a fatura por e-mail (pedido Filipe, 19/08: "montar a fatura e o email
 * e enviar o send").
 *
 * O QUE VEM DO NAVEGADOR: assunto e corpo — é o texto que a pessoa leu e
 * aprovou na prévia, e mandar outra coisa quebraria essa confiança.
 *
 * O QUE NÃO VEM DO NAVEGADOR: o destinatário. Ele é resolvido no banco, a
 * partir do cadastro do cliente do contrato. Aceitar o endereço que a tela
 * mandasse transformaria o ERP num relay — qualquer pessoa logada poderia
 * disparar mensagem para um endereço qualquer usando o domínio do escritório.
 *
 * REMETENTE: financeiro@erp.vlma.com.br. Na conta do Resend o único domínio
 * verificado é erp.vlma.com.br; financeiro@vlma.com.br faria o envio ser
 * RECUSADO. As respostas do cliente vão para o financeiro pelo reply-to.
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const REMETENTE = "VLMA Financeiro <financeiro@erp.vlma.com.br>"

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

    const body = await req.json().catch(() => ({}))
    const { contrato_id, assunto, corpo } = body as { contrato_id?: string; assunto?: string; corpo?: string }
    if (!contrato_id) return json({ error: "contrato_id é obrigatório" }, 400)
    if (!corpo?.trim()) return json({ error: "corpo do e-mail é obrigatório" }, 400)

    // get_dados_envio_fatura já checa a permissão finance.nfse.manage.
    const { data: dados, error: dadosErr } = await supabase.rpc("get_dados_envio_fatura", {
      p_user_id: user.id,
      p_contrato_id: contrato_id,
    })
    if (dadosErr) return json({ error: dadosErr.message }, 403)

    const d = dados as {
      cliente_nome: string
      destinatario: string | null
      nota: { id: string; numero: string | null; arquivo_nome: string | null; arquivo_url: string | null } | null
      reply_to: string[]
    }

    if (!d.destinatario) {
      return json({
        error: `O cliente ${d.cliente_nome} está sem e-mail cadastrado. Preencha o e-mail do financeiro no cadastro do cliente antes de enviar.`,
      }, 422)
    }

    const resendApiKey = Deno.env.get("RESEND_API_KEY")
    if (!resendApiKey) return json({ error: "RESEND_API_KEY não configurada" }, 500)

    // Anexo: a NFS-e, quando já existe arquivo. O boleto entra aqui quando o
    // certificado do Itaú sair — por isso o texto da prévia ainda não promete.
    const anexos: Array<{ filename: string; content: string }> = []
    const anexosResumo: Array<{ nome: string }> = []
    if (d.nota?.arquivo_url) {
      try {
        const arq = await fetch(d.nota.arquivo_url)
        if (arq.ok) {
          const bin = new Uint8Array(await arq.arrayBuffer())
          let s = ""
          for (let i = 0; i < bin.length; i++) s += String.fromCharCode(bin[i])
          const nome = d.nota.arquivo_nome || `NFSe-${d.nota.numero ?? "documento"}.pdf`
          anexos.push({ filename: nome, content: btoa(s) })
          anexosResumo.push({ nome })
        } else {
          console.error("anexo da NFS-e nao baixou:", arq.status)
        }
      } catch (e) {
        // Anexo que falha não impede o envio: melhor a cobrança chegar sem o
        // PDF (e o registro apontar isso) do que não chegar.
        console.error("falha ao baixar anexo:", e)
      }
    }

    const assuntoFinal = assunto?.trim() || `Fatura — ${d.cliente_nome}`
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#23201c;white-space:pre-wrap">${
      corpo.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    }</div>`

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: REMETENTE,
        to: [d.destinatario],
        reply_to: d.reply_to?.length ? d.reply_to : undefined,
        subject: assuntoFinal,
        html,
        ...(anexos.length ? { attachments: anexos } : {}),
      }),
    })

    const respBody = await resp.json().catch(() => null)

    await supabase.rpc("registrar_envio_fatura", {
      p_user_id: user.id,
      p_contrato_id: contrato_id,
      p_billing_note_id: d.nota?.id ?? null,
      p_destinatario: d.destinatario,
      p_assunto: assuntoFinal,
      p_corpo: corpo,
      p_anexos: anexosResumo,
      p_provider_id: resp.ok ? (respBody?.id ?? null) : null,
      p_erro: resp.ok ? null : JSON.stringify(respBody ?? {}).slice(0, 500),
    })

    if (!resp.ok) {
      return json({ error: "O Resend recusou o envio.", detalhe: respBody }, 502)
    }

    return json({
      enviado: true,
      destinatario: d.destinatario,
      anexos: anexosResumo.map((a) => a.nome),
      id: respBody?.id ?? null,
    }, 200)
  } catch (err) {
    console.error(err)
    return json({ error: "Erro ao enviar a fatura" }, 500)
  }
})
