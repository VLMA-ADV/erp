import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

/**
 * Manda o lembrete de renovação do certificado do Itaú.
 *
 * Quem chama é o cron da Vercel, que sabe quantos dias faltam (o certificado
 * mora numa variável de ambiente de lá). Aqui só mora a chave do Resend e a
 * lista de quem recebe.
 *
 * Autenticação pela service role key: não é um usuário chamando, é máquina
 * falando com máquina. Comparação em tempo constante para não vazar a chave
 * por diferença de tempo de resposta.
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

function igual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  const json = (b: unknown, s: number) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } })

  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  const enviado = (req.headers.get("Authorization") ?? "").replace("Bearer ", "")
  if (!service || !igual(enviado, service)) return json({ error: "não autorizado" }, 401)

  const { dias_restantes, vence_em, pode_renovar, erro } =
    (await req.json().catch(() => ({}))) as {
      dias_restantes?: number; vence_em?: string; pode_renovar?: boolean; erro?: string | null
    }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "", service,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  const { data: tenant } = await supabase
    .schema("core").from("tenant_users").select("tenant_id").eq("status", "ativo").limit(1).maybeSingle()

  const { data: emails } = await supabase.rpc("get_emails_financeiro", {
    p_tenant_id: (tenant as { tenant_id?: string } | null)?.tenant_id,
  })
  const destinos = (emails ?? []) as string[]
  if (destinos.length === 0) return json({ enviado: false, motivo: "nenhum destinatário" }, 200)

  const chave = Deno.env.get("RESEND_API_KEY")
  if (!chave) return json({ enviado: false, motivo: "RESEND_API_KEY não configurada" }, 200)

  const dias = Number(dias_restantes ?? 0)
  const vencido = dias < 0
  const assunto = erro
    ? "Certificado do Itaú com problema — boletos podem parar"
    : vencido
      ? `Certificado do Itaú VENCIDO há ${Math.abs(dias)} dia(s) — boletos parados`
      : `Certificado do Itaú vence em ${dias} dia(s)`

  const html = `
    <p>${erro
      ? `O certificado do Itaú não pôde ser lido: <code>${erro}</code>. Enquanto isso, nenhum boleto é emitido.`
      : vencido
        ? `O certificado do Itaú <strong>venceu em ${vence_em}</strong>. A emissão de boletos está parada até ele ser trocado.`
        : `O certificado que o ERP usa para emitir boletos vence em <strong>${vence_em}</strong> — faltam ${dias} dias.`}</p>
    ${pode_renovar && !vencido
      ? `<p><strong>A janela de renovação já está aberta</strong> (o Itaú só aceita nos últimos 30 dias). É a hora de renovar.</p>`
      : !vencido
        ? `<p>A renovação só é aceita nos últimos 30 dias antes do vencimento. Este é um aviso antecipado.</p>`
        : `<p>Passada a data, não há renovação: é preciso refazer o processo com o banco — pedir token novo, gerar CSR e esperar a liberação.</p>`}
    <p><strong>Como renovar:</strong> usa a MESMA chave privada guardada em <code>~/vlma-itau/itau-privada.key</code>,
    pelo endpoint <code>sts.itau.com.br/seguranca/v2/certificado/renovacao</code>. O passo a passo está em
    <code>docs/boleto-itau-integracao.md</code>.</p>
    <p style="color:#7a726a;font-size:12px">Aviso automático do ERP. Ele se repete enquanto a situação não mudar.</p>
  `

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "VLMA ERP <no-reply@erp.vlma.com.br>", to: destinos, subject: assunto, html }),
  })

  if (!r.ok) {
    console.error("Resend recusou:", (await r.text()).slice(0, 300))
    return json({ enviado: false, motivo: "falha no envio" }, 200)
  }
  return json({ enviado: true, destinatarios: destinos.length }, 200)
})
