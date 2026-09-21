import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

/**
 * Envia a fatura por e-mail (pedido Filipe, 19/08: "montar a fatura e o email
 * e enviar o send").
 *
 * O QUE VEM DO NAVEGADOR: assunto, corpo e destinatários — é o que a pessoa leu
 * e aprovou na prévia, e mandar outra coisa quebraria essa confiança.
 *
 * Os destinatários chegam preenchidos com os responsáveis financeiros do
 * cliente e podem ser editados. Quem chega aqui já passou por
 * finance.nfse.manage (sócios e Jessika), e todo envio fica gravado em
 * finance.fatura_envios com para quem foi, o texto e os anexos.
 *
 * REMETENTE: financeiro@erp.vlma.com.br. Na conta do Resend o único domínio
 * verificado é erp.vlma.com.br; financeiro@vlma.com.br faria o envio ser
 * RECUSADO. As respostas do cliente vão para o financeiro pelo reply-to.
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

// Sai no NOME da Jessika, pelo domínio que já está verificado (Filipe, 20/08:
// "que inicie o processo de envio da fatura no ERP, mas que a conversa continue
// no email dela").
//
// O cliente vê "Jessika Lira (VLMA)" como remetente e, ao responder, cai na
// caixa dela — que é o que importa para a conversa continuar lá. O endereço
// técnico é financeiro@erp.vlma.com.br porque é esse o domínio verificado no
// Resend hoje.
//
// PARA SAIR COMO jessika.lira@vlma.com.br: basta trocar a linha abaixo, DEPOIS
// que o domínio raiz vlma.com.br estiver verificado no Resend (ele já está
// cadastrado lá; faltam três registros de DNS, em docs/dns-resend-vlma.md).
// Antes disso o Resend recusa o envio — não é spam, é erro.
const REMETENTE = "Jessika Lira (VLMA) <financeiro@erp.vlma.com.br>"
const REPLY_TO_JESSIKA = "jessika.lira@vlma.com.br"

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
    const { contrato_id, caso_id, competencia, assunto, corpo, destinatarios } = body as {
      contrato_id?: string
      caso_id?: string | null
      competencia?: string | null
      assunto?: string
      corpo?: string
      destinatarios?: string[]
    }
    if (!contrato_id) return json({ error: "contrato_id é obrigatório" }, 400)
    if (!corpo?.trim()) return json({ error: "corpo do e-mail é obrigatório" }, 400)

    // Kit por caso/competência (Composição da fatura, D13-a/D15-a, 21/09): a
    // sobrecarga nova de get_dados_envio_fatura devolve `anexos` com tudo que
    // vai no e-mail — NFS-e, boleto, nota de débito e o relatório de timesheet
    // quando o caso pede. Sem caso_id continua o envio por contrato de antes,
    // que anexa só a NFS-e.
    const competenciaNorm = (() => {
      const m = /^(\d{4})-(\d{2})/.exec(String(competencia ?? ""))
      return m ? `${m[1]}-${m[2]}-01` : null
    })()
    const porKit = Boolean(caso_id || competenciaNorm)

    // get_dados_envio_fatura já checa a permissão finance.nfse.manage.
    const { data: dados, error: dadosErr } = await supabase.rpc(
      "get_dados_envio_fatura",
      porKit
        ? { p_user_id: user.id, p_contrato_id: contrato_id, p_caso_id: caso_id ?? null, p_competencia: competenciaNorm }
        : { p_user_id: user.id, p_contrato_id: contrato_id },
    )
    if (dadosErr) return json({ error: dadosErr.message }, 403)

    const d = dados as {
      cliente_nome: string
      destinatarios: string[]
      nota: { id: string; numero: string | null; arquivo_nome: string | null; arquivo_url: string | null } | null
      reply_to: string[]
      // url: http(s) para a NFS-e (Focus); caminho no bucket
      // 'faturamento-documentos' para o que o ERP mesmo gerou.
      anexos?: Array<{ tipo: string; nome: string | null; url: string | null }> | null
    }

    // Quem recebe: o que veio da tela, quando veio; senão o cadastro.
    //
    // Na primeira versão isto era fechado, resolvido só pelo cadastro, com medo
    // de o ERP virar relay. Revi por dois motivos. Quem chega aqui já passou por
    // finance.nfse.manage — sócios e Jessika, um punhado de pessoas, não
    // "qualquer um logado" — e todo envio fica gravado com destinatário, corpo e
    // anexos. E o Filipe pediu exatamente essa folga para o primeiro mês: "que
    // eu também possa editar manualmente quem eu quero enviar".
    //
    // O que continua valendo: formato de e-mail e um teto de destinatários.
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
    const escolhidos = (Array.isArray(destinatarios) && destinatarios.length
      ? destinatarios
      : (d.destinatarios ?? []))
      .map((e) => String(e).trim().toLowerCase())
      .filter(Boolean)

    const invalidos = escolhidos.filter((e) => !EMAIL_RE.test(e))
    if (invalidos.length) {
      return json({ error: `E-mail inválido: ${invalidos.join(", ")}` }, 422)
    }
    if (escolhidos.length === 0) {
      return json({
        error: `O cliente ${d.cliente_nome} está sem e-mail cadastrado e nenhum destinatário foi informado. Preencha o responsável financeiro no cadastro do cliente ou digite o endereço aqui.`,
      }, 422)
    }
    if (escolhidos.length > 10) {
      return json({ error: "Máximo de 10 destinatários por envio." }, 422)
    }

    const resendApiKey = Deno.env.get("RESEND_API_KEY")
    if (!resendApiKey) return json({ error: "RESEND_API_KEY não configurada" }, 500)

    // Anexos. Por contrato (fluxo antigo): só a NFS-e. Por kit: tudo que a RPC
    // listou — NFS-e (URL da Focus), e os PDFs que o ERP gerou (relatório de
    // timesheet, nota de débito, boleto), guardados no bucket privado e
    // baixados aqui com a service role.
    const anexos: Array<{ filename: string; content: string }> = []
    const anexosResumo: Array<{ nome: string; tipo?: string }> = []

    const paraBase64 = (bin: Uint8Array) => {
      let s = ""
      for (let i = 0; i < bin.length; i++) s += String.fromCharCode(bin[i])
      return btoa(s)
    }

    const baixar = async (url: string): Promise<Uint8Array | null> => {
      if (/^https?:\/\//i.test(url)) {
        const arq = await fetch(url)
        if (!arq.ok) {
          console.error("anexo nao baixou:", url, arq.status)
          return null
        }
        return new Uint8Array(await arq.arrayBuffer())
      }
      const { data: blob, error } = await supabase.storage.from("faturamento-documentos").download(url)
      if (error || !blob) {
        console.error("anexo do bucket nao baixou:", url, error?.message)
        return null
      }
      return new Uint8Array(await blob.arrayBuffer())
    }

    const listaAnexos: Array<{ tipo: string; nome: string | null; url: string | null }> = porKit
      ? (d.anexos ?? [])
      : (d.nota?.arquivo_url
        ? [{ tipo: "nota_fiscal_servico", nome: d.nota.arquivo_nome, url: d.nota.arquivo_url }]
        : [])

    const nomesUsados = new Set<string>()
    for (const anexo of listaAnexos) {
      if (!anexo?.url) continue
      try {
        const bin = await baixar(anexo.url)
        if (!bin) continue
        let nome = anexo.nome
          || (anexo.tipo === "nota_fiscal_servico" ? `NFSe-${d.nota?.numero ?? "documento"}.pdf` : `${anexo.tipo}.pdf`)
        if (!/\.pdf$/i.test(nome)) nome = `${nome}.pdf`
        // Dois anexos com o mesmo nome no Resend viram um só na caixa do cliente.
        if (nomesUsados.has(nome)) nome = nome.replace(/\.pdf$/i, `-${nomesUsados.size + 1}.pdf`)
        nomesUsados.add(nome)
        anexos.push({ filename: nome, content: paraBase64(bin) })
        anexosResumo.push({ nome, tipo: anexo.tipo })
      } catch (e) {
        // Anexo que falha não impede o envio: melhor a cobrança chegar sem o
        // PDF (e o registro apontar isso) do que não chegar.
        console.error("falha ao baixar anexo:", anexo.tipo, e)
      }
    }

    const assuntoFinal = assunto?.trim() || `Fatura — ${d.cliente_nome}`
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#23201c;white-space:pre-wrap">${
      corpo.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    }</div>`

    // A resposta do cliente tem de cair na caixa DELA — é onde a conversa
    // continua depois que o ERP dá a largada (Filipe, 20/08). Os demais do
    // financeiro ficam em cópia do reply-to para ninguém perder o fio.
    const replyTo = Array.from(new Set([REPLY_TO_JESSIKA, ...(d.reply_to ?? [])]))

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: REMETENTE,
        to: escolhidos,
        reply_to: replyTo,
        subject: assuntoFinal,
        html,
        ...(anexos.length ? { attachments: anexos } : {}),
      }),
    })

    const respBody = await resp.json().catch(() => null)
    const remetenteUsado = REMETENTE

    await supabase.rpc("registrar_envio_fatura", {
      p_user_id: user.id,
      p_contrato_id: contrato_id,
      p_billing_note_id: d.nota?.id ?? null,
      p_destinatario: escolhidos.join(", "),
      p_assunto: assuntoFinal,
      p_corpo: corpo,
      p_anexos: anexosResumo,
      p_remetente: remetenteUsado,
      p_provider_id: resp.ok ? (respBody?.id ?? null) : null,
      p_erro: resp.ok ? null : JSON.stringify(respBody ?? {}).slice(0, 500),
    })

    if (!resp.ok) {
      return json({ error: "O Resend recusou o envio.", detalhe: respBody }, 502)
    }

    return json({
      enviado: true,
      destinatarios: escolhidos,
      anexos: anexosResumo.map((a) => a.nome),
      remetente: remetenteUsado,
      id: respBody?.id ?? null,
    }, 200)
  } catch (err) {
    console.error(err)
    return json({ error: "Erro ao enviar a fatura" }, 500)
  }
})
