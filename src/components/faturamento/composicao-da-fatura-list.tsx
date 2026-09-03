'use client'

import { useEffect, useMemo, useState } from 'react'
import { Banknote, FileText, Loader2, Mail, Receipt, RefreshCw, Clock, ExternalLink } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { formatContratoDisplay } from '@/lib/utils/contrato-display'
import { formatHorasMin } from '@/lib/utils/format-horas'
import { openTimesheetReport } from '@/lib/utils/timesheet-report'
import NotaDespesaPreview, { type NotaDespesaData } from './nota-despesa-preview'
import FaturaEmailPreview, { type FaturaEmailData } from './fatura-email-preview'

// "Composição da fatura": painel onde a Jéssica (financeiro) monta o "kit" enviado
// ao cliente a partir dos itens já aprovados/faturados. O kit tem no mínimo 2 itens
// (nota fiscal de serviço + boleto) e no máximo 4 (+ relatório de timesheet e nota
// de despesa). Boleto/relatório/nota de despesa ainda serão automatizados — aqui
// surfamos os artefatos já emitidos e deixamos os botões engatilhados (stub).

interface RevisaoItem {
  id: string
  contrato_id: string
  cliente_nome?: string | null
  contrato_numero: number | null
  contrato_nome: string
  origem_tipo: string
  status: 'em_revisao' | 'em_aprovacao' | 'aprovado' | 'faturado' | 'cancelado' | 'disponivel'
  snapshot?: Record<string, unknown> | null
  horas_aprovadas?: number | null
  horas_revisadas: number | null
  horas_informadas: number | null
  valor_aprovado?: number | null
  valor_revisado: number | null
  valor_informado: number | null
  // Presentes quando origem_tipo === 'despesa' — a Nota de Despesas usa estes,
  // nao a tabela operations.despesas: o que importa e o que esta sendo
  // faturado NESTA fatura, nao um status manual que nunca e setado.
  origem_id?: string | null
  data_referencia?: string | null
  caso_numero?: number | null
  caso_nome?: string | null
}

interface NotaGerada {
  id: string
  numero: number | null
  status: string
  tipo_documento: 'boleto_itau' | 'relatorio_honorarios' | 'nota_fiscal_servico' | string
  arquivo_nome: string | null
  arquivo_url: string | null
  contrato_id: string | null
}

interface EnvioFatura {
  enviado_em: string
  destinatario: string
  remetente: string | null
  por: string | null
  erro: string | null
  total: number
}

interface ContratoKit {
  contratoId: string
  numero: number | null
  nome: string
  clienteNome: string
  valorServico: number
  valorDespesa: number
  horasTimesheet: number
  temTimesheet: boolean
  temDespesa: boolean
}

interface ClienteKit {
  nome: string
  contratos: ContratoKit[]
  total: number
}

function formatMoney(value: number | null | undefined) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0))
}

// Horas em "1h 20min" — util compartilhado (pedido do cliente 01/08).
const formatHours = formatHorasMin

function toObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function isoHoje() {
  return new Date().toISOString().slice(0, 10)
}

// Mês de referência da fatura = mês anterior ao corrente (faturamento fechado).
function mesReferenciaAtual() {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - 1)
  return d.toLocaleDateString('pt-BR', { month: 'long' })
}

function getEffectiveValue(item: RevisaoItem) {
  if ((item.status === 'aprovado' || item.status === 'faturado') && item.valor_aprovado != null) {
    return Number(item.valor_aprovado)
  }
  if (item.valor_revisado != null) return Number(item.valor_revisado)
  if (item.valor_informado != null) return Number(item.valor_informado)
  return 0
}

// Totais de timesheet preferindo o snapshot (mesma lógica do Fluxo de faturamento).
function getTimesheetTotals(item: RevisaoItem) {
  const rows = Array.isArray(item.snapshot?.timesheet_itens_revisao)
    ? (item.snapshot?.timesheet_itens_revisao as unknown[])
    : []
  if (rows.length === 0) {
    const horas =
      item.horas_aprovadas ?? item.horas_revisadas ?? item.horas_informadas ?? 0
    return { horas: Number(horas) || 0, valor: getEffectiveValue(item) }
  }
  let horas = 0
  let valor = 0
  for (const raw of rows) {
    const row = toObject(raw)
    if (!row) continue
    const h = Number(row.horas_revisadas ?? row.horas ?? row.horas_iniciais ?? 0)
    const vh = Number(row.valor_hora ?? 0)
    const safeH = Number.isFinite(h) ? h : 0
    horas += safeH
    valor += safeH * (Number.isFinite(vh) ? vh : 0)
  }
  return { horas, valor }
}

function buildKits(items: RevisaoItem[]): ClienteKit[] {
  const clientes = new Map<string, Map<string, ContratoKit>>()

  for (const item of items) {
    if (!item.contrato_id) continue
    const clienteNome = (item.cliente_nome || '').trim() || 'Cliente sem nome'
    if (!clientes.has(clienteNome)) clientes.set(clienteNome, new Map())
    const contratos = clientes.get(clienteNome)!

    if (!contratos.has(item.contrato_id)) {
      contratos.set(item.contrato_id, {
        contratoId: item.contrato_id,
        numero: item.contrato_numero ?? null,
        nome: item.contrato_nome || 'Contrato sem nome',
        clienteNome,
        valorServico: 0,
        valorDespesa: 0,
        horasTimesheet: 0,
        temTimesheet: false,
        temDespesa: false,
      })
    }
    const kit = contratos.get(item.contrato_id)!

    if (item.origem_tipo === 'despesa') {
      kit.valorDespesa += getEffectiveValue(item)
      kit.temDespesa = true
    } else if (item.origem_tipo === 'timesheet') {
      const t = getTimesheetTotals(item)
      kit.horasTimesheet += t.horas
      kit.valorServico += t.valor
      kit.temTimesheet = true
    } else {
      kit.valorServico += getEffectiveValue(item)
    }
  }

  return Array.from(clientes.entries())
    .map(([nome, contratosMap]) => {
      const contratos = Array.from(contratosMap.values()).sort((a, b) => {
        const n = (a.numero ?? 0) - (b.numero ?? 0)
        return n !== 0 ? n : a.nome.localeCompare(b.nome, 'pt-BR')
      })
      const total = contratos.reduce((acc, c) => acc + c.valorServico + c.valorDespesa, 0)
      return { nome, contratos, total }
    })
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
}

export default function ComposicaoDaFaturaList() {
  const { toast: notify } = useToast()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<RevisaoItem[]>([])
  const [notes, setNotes] = useState<NotaGerada[]>([])
  const [notaData, setNotaData] = useState<NotaDespesaData | null>(null)
  const [emailData, setEmailData] = useState<FaturaEmailData | null>(null)
  const [emailContratoId, setEmailContratoId] = useState<string | null>(null)
  // Controle visual do que ja foi enviado (Filipe, 20/08: "um controle visual
  // ali no modulo da fatura para controlar o que foi enviado, talvez com uma
  // sinalizacao em verde"). Uma consulta so, chaveada por contrato.
  const [envios, setEnvios] = useState<Record<string, EnvioFatura>>({})
  // Vencimento do certificado do Itaú. Fica nesta tela porque é daqui que o
  // boleto sai — avisar em Configuração seria avisar onde ninguém entra.
  const [cert, setCert] = useState<{
    configurado: boolean; dias_restantes: number | null; vence_em: string | null
    pode_renovar: boolean; erro: string | null
  } | null>(null)
  const [enviandoEmail, setEnviandoEmail] = useState(false)

  const load = async () => {
    try {
      setLoading(true)
      setError(null)
      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) return

      const headers = {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      }
      const base = process.env.NEXT_PUBLIC_SUPABASE_URL

      const [revisaoResp, notasResp] = await Promise.all([
        fetch(`${base}/functions/v1/get-revisao-fatura`, { method: 'GET', headers }),
        fetch(`${base}/functions/v1/get-notas-geradas?status=gerado&limit=200`, { method: 'GET', headers }),
      ])

      const revisaoPayload = await revisaoResp.json().catch(() => ({}))
      if (!revisaoResp.ok) {
        setError(revisaoPayload.error || 'Erro ao carregar itens aprovados')
        return
      }
      const notasPayload = await notasResp.json().catch(() => ({}))

      const allItems = (revisaoPayload.data || []) as RevisaoItem[]
      // O kit só faz sentido para o que o financeiro já aprovou/faturou.
      setItems(allItems.filter((it) => it.status === 'aprovado' || it.status === 'faturado'))
      setNotes(notasResp.ok ? ((notasPayload.data || []) as NotaGerada[]) : [])

      // Quais contratos já tiveram a fatura enviada. Uma consulta só para a
      // tela inteira — não uma por linha.
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: envs } = await supabase.rpc('get_envios_fatura', {
          p_user_id: user.id,
          p_contrato_id: null,
        })
        setEnvios((envs as Record<string, EnvioFatura>) || {})
      }

      // Certificado do Itaú: só interessa quando está perto de vencer.
      try {
        const rc = await fetch('/api/boletos/certificado')
        if (rc.ok) setCert(await rc.json())
      } catch {
        // Sem certificado configurado ainda é o normal hoje; não é erro de tela.
      }
    } catch (err) {
      console.error(err)
      setError('Erro ao carregar composição da fatura')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const clientes = useMemo(() => buildKits(items), [items])

  // Notas emitidas por contrato e tipo de documento (ignora canceladas).
  const notaPorContrato = useMemo(() => {
    const map = new Map<string, Partial<Record<string, NotaGerada>>>()
    for (const nota of notes) {
      if (!nota.contrato_id || nota.status === 'cancelado') continue
      const current = map.get(nota.contrato_id) || {}
      if (!current[nota.tipo_documento]) current[nota.tipo_documento] = nota
      map.set(nota.contrato_id, current)
    }
    return map
  }, [notes])

  // Despesas reembolsáveis, agrupadas por contrato, para o detalhe da Nota de
  // Despesas. Vem dos MESMOS billing_items que compõem o kit (origem_tipo ===
  // 'despesa'), nunca da tabela operations.despesas: o que entra na nota é
  // exatamente o que está sendo faturado nesta fatura, e nao um status manual
  // que nenhuma tela chega a setar.
  const despesaPorContrato = useMemo(() => {
    const map = new Map<string, RevisaoItem[]>()
    for (const item of items) {
      if (item.origem_tipo !== 'despesa' || !item.contrato_id) continue
      const list = map.get(item.contrato_id) || []
      list.push(item)
      map.set(item.contrato_id, list)
    }
    return map
  }, [items])

  // Mesmo padrão do mapa de despesas acima: as horas do contrato, para o
  // relatório sair com as linhas de verdade e não com o agregado do kit.
  const horasPorContrato = useMemo(() => {
    const map = new Map<string, RevisaoItem[]>()
    for (const item of items) {
      if (item.origem_tipo !== 'timesheet' || !item.contrato_id) continue
      const list = map.get(item.contrato_id) || []
      list.push(item)
      map.set(item.contrato_id, list)
    }
    return map
  }, [items])

  const totalGeral = useMemo(() => clientes.reduce((acc, c) => acc + c.total, 0), [clientes])

  const emBreve = (label: string) => notify(`${label}: automação ainda não implementada nesta etapa.`)

  // Emite a NFS-e do contrato. Mesmo caminho da tela de Revisão (edge emit-nfse):
  // a emissão é por CONTRATO e já trata rateio, uma nota por pagador. Aqui o
  // botão existia como aviso de "não implementada" desde o começo — a tela
  // prometia e não cumpria.
  const [emitindoNfse, setEmitindoNfse] = useState<string | null>(null)
  const emitirNfse = async (contratoId: string, label: string) => {
    if (emitindoNfse) return
    const ok = window.confirm(
      `Emitir NFS-e de ${label}?\n\nA nota é enviada à prefeitura e passa a existir de verdade.`,
    )
    if (!ok) return
    setEmitindoNfse(contratoId)
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { notify('Sessão expirada.'); return }
      const resp = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/emit-nfse`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contrato_id: contratoId }),
      })
      const payload = await resp.json().catch(() => ({}))
      if (!resp.ok) { notify(payload.error || 'A prefeitura recusou a emissão.'); return }
      if (payload.partial) {
        notify(payload.message || 'Emissão parcial — alguns pagadores foram recusados.')
      } else {
        const n = Number(payload.n_notas ?? 1)
        notify(n > 1
          ? `${n} NFS-e enviadas (rateio). Status: ${payload.focus_status}`
          : `NFS-e enviada. Status: ${payload.focus_status}`)
      }
      // A prefeitura leva alguns segundos a minutos para autorizar, e so entao
      // existem numero e PDF. Sem perguntar, o arquivo so apareceria no dia
      // seguinte (cron) — foi assim que o Filipe emitiu e nao viu o arquivo.
      // Duas tentativas curtas resolvem o caso comum sem prender a tela.
      const perguntarDesfecho = async (esperaMs: number) => {
        await new Promise((r) => setTimeout(r, esperaMs))
        await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/consultar-nfse`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }).catch(() => null)
        await load()
      }
      void perguntarDesfecho(4000).then(() => perguntarDesfecho(12000))

      void load()
    } catch {
      notify('Erro de rede ao emitir a NFS-e.')
    } finally {
      setEmitindoNfse(null)
    }
  }

  // Relatório de timesheet do contrato — mesmo gerador das outras telas.
  const gerarRelatorio = (kit: ContratoKit) => {
    const linhas = horasPorContrato.get(kit.contratoId) || []
    if (linhas.length === 0) { notify('Este contrato não tem horas para relatar.'); return }
    openTimesheetReport({
      titulo: 'Relatório de timesheet',
      subtitulo: `${kit.clienteNome} · ${formatContratoDisplay(kit.numero, kit.nome).full}`,
      mostrarValor: true,
      rows: linhas
        .slice()
        // Cronológico, como a revisão passou a ser em 02/09.
        .sort((a, b) => String(a.data_referencia || '').localeCompare(String(b.data_referencia || '')))
        .map((item) => {
          const t = getTimesheetTotals(item)
          return {
            data: String(item.data_referencia || '').split('-').reverse().join('/'),
            cliente: kit.clienteNome,
            caso: `${item.caso_numero ? `${item.caso_numero} - ` : ''}${item.caso_nome || ''}`,
            profissional: String(item.snapshot?.timesheet_profissional || ''),
            descricao: String(item.snapshot?.timesheet_descricao || ''),
            horas: formatHours(t.horas),
            valor: t.valor,
          }
        }),
    })
  }

  // Emite o boleto da fatura. A tela trabalha por contrato/nota; a emissão
  // trabalha por conta a receber — bol_lancamento_da_nota faz a ponte, que já
  // existia nos dados (lancamentos.origem_ref_id aponta para a nota) mas não
  // tinha caminho a partir daqui.
  //
  // Confirmação explícita: isto registra o título no banco de verdade e o
  // cliente pode pagar. Não há desfazer de um clique.
  const [emitindoBoleto, setEmitindoBoleto] = useState(false)
  const emitirBoleto = async (notaId: string) => {
    if (emitindoBoleto) return
    setEmitindoBoleto(true)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { notify('Sessão expirada.'); return }

      const { data, error } = await supabase.rpc('bol_lancamento_da_nota', {
        p_user_id: user.id,
        p_nota_id: notaId,
      })
      if (error) { notify(error.message); return }
      const info = data as {
        encontrado: boolean; motivo?: string; lancamento_id?: string
        descricao?: string; valor?: number; vencimento?: string; ja_baixado?: boolean
      }
      if (!info?.encontrado) { notify(info?.motivo || 'Conta a receber não encontrada.'); return }
      if (info.ja_baixado) { notify('Esta fatura já foi recebida — não há o que cobrar.'); return }

      const venc = (info.vencimento || '').split('-').reverse().join('/')
      const ok = window.confirm(
        `Registrar boleto no Itaú?\n\n${info.descricao}\n` +
        `${formatMoney(info.valor || 0)} — vence ${venc}\n\n` +
        'O título passa a existir no banco e o cliente pode pagar.',
      )
      if (!ok) return

      const resp = await fetch('/api/boletos/emitir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lancamento_id: info.lancamento_id }),
      })
      const corpo = await resp.json().catch(() => ({}))
      if (!resp.ok) { notify(corpo.error || 'Não foi possível emitir o boleto.'); return }

      const linha = (corpo as { boleto?: { linha_digitavel?: string | null } }).boleto
      notify(linha?.linha_digitavel
        ? `Boleto registrado. Linha digitável: ${linha.linha_digitavel}`
        : 'Boleto registrado no Itaú.')
      void load()
    } catch {
      notify('Erro de rede ao emitir o boleto.')
    } finally {
      setEmitindoBoleto(false)
    }
  }

  const abrirNota = (kit: ContratoKit) => {
    const linhas = despesaPorContrato.get(kit.contratoId) || []
    const caso = linhas[0]
    setNotaData({
      clienteNome: kit.clienteNome,
      contratoLabel: formatContratoDisplay(kit.numero, kit.nome).full,
      casoLabel: caso ? `${caso.caso_numero ? `${caso.caso_numero} - ` : ''}${caso.caso_nome}` : null,
      documentoNumero: null,
      emissao: isoHoje(),
      vencimento: isoHoje(),
      itens: linhas.map((item) => ({
        data_lancamento: item.data_referencia || '',
        categoria: String(item.snapshot?.categoria || ''),
        descricao: String(item.snapshot?.descricao || ''),
        valor: getEffectiveValue(item),
      })),
    })
  }

  const abrirEmail = async (kit: ContratoKit) => {
    setEmailContratoId(kit.contratoId)
    // Os destinatários vêm dos responsáveis financeiros do cliente — pode haver
    // mais de um, e a 7 Holding tem três. Chegam preenchidos e a pessoa edita
    // se precisar.
    let destinatario: string | null = null
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data } = await supabase.rpc('get_dados_envio_fatura', {
          p_user_id: user.id,
          p_contrato_id: kit.contratoId,
        })
        const lista = (data as { destinatarios?: string[] } | null)?.destinatarios ?? []
        destinatario = lista.length ? lista.join(', ') : null
      }
    } catch (err) {
      console.error(err)
    }
    const notasKit = notaPorContrato.get(kit.contratoId) || {}
    const nfse = notasKit['nota_fiscal_servico']
    const anexos: string[] = []
    if (nfse) anexos.push(`NFSe ${nfse.numero ?? ''}`.trim())
    else anexos.push('NFSe (pendente)')
    if (kit.temDespesa) anexos.push('Nota de despesas')
    anexos.push(notasKit['boleto_itau'] ? 'Boleto bancário' : 'Boleto bancário (pendente)')
    if (kit.temTimesheet) anexos.push('Relatório de timesheet')

    setEmailData({
      clienteNome: kit.clienteNome,
      contratoLabel: formatContratoDisplay(kit.numero, kit.nome).full,
      destinatarioEmail: destinatario,
      nfseNumero: nfse?.numero != null ? String(nfse.numero) : null,
      mesReferencia: mesReferenciaAtual(),
      vencimento: new Date().toLocaleDateString('pt-BR'),
      anexos,
      completo: kit.temDespesa || kit.temTimesheet,
    })
  }

  /**
   * Envia de verdade (pedido Filipe 19/08). Destinatários separados por vírgula
   * — vêm preenchidos do cadastro e a pessoa pode editar antes de mandar.
   */
  const enviarFatura = async (assunto: string, corpo: string, para: string) => {
    if (!emailContratoId) return
    try {
      setEnviandoEmail(true)
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const destinatarios = para
        .split(/[,;]/)
        .map((e) => e.trim())
        .filter(Boolean)
      const { data, error: e } = await supabase.functions.invoke('enviar-fatura', {
        body: { contrato_id: emailContratoId, assunto, corpo, destinatarios },
      })
      const resposta = data as { enviado?: boolean; destinatarios?: string[]; error?: string } | null
      if (e || resposta?.error || !resposta?.enviado) {
        setError(resposta?.error || 'Não foi possível enviar a fatura.')
        return
      }
      setError(null)
      setEmailData(null)
      setEmailContratoId(null)
      window.alert(`Fatura enviada para ${(resposta.destinatarios || []).join(', ')}.`)
      // Recarrega para o sinal verde aparecer sem a pessoa precisar atualizar.
      void load()
    } catch (err) {
      console.error(err)
      setError('Erro ao enviar a fatura.')
    } finally {
      setEnviandoEmail(false)
    }
  }

  return (
    <div className="space-y-6">
      {error ? (
        <Alert className="border border-destructive/30 bg-destructive/10 text-destructive">
          <AlertTitle>Atenção</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {/* Certificado do Itaú perto de vencer. O banco só aceita renovação nos
          últimos 30 dias, uma vez por ano — se essa janela passar, é refazer o
          processo inteiro. Silêncio aqui vira boleto parado lá na frente. */}
      {cert?.configurado && (cert.erro || (cert.dias_restantes !== null && cert.dias_restantes <= 60)) ? (
        <Alert
          className={
            cert.erro || (cert.dias_restantes ?? 0) < 0
              ? 'border-destructive/40 bg-destructive/10 text-destructive'
              : (cert.dias_restantes ?? 0) <= 30
                ? 'border-orange-400 bg-orange-50 text-orange-900'
                : 'border-amber-300 bg-amber-50 text-amber-900'
          }
        >
          <AlertTitle>
            {cert.erro
              ? 'Certificado do Itaú com problema'
              : (cert.dias_restantes ?? 0) < 0
                ? `Certificado do Itaú venceu em ${cert.vence_em}`
                : `Certificado do Itaú vence em ${cert.dias_restantes} dia(s)`}
          </AlertTitle>
          <AlertDescription>
            {cert.erro
              ? `Não foi possível ler o certificado (${cert.erro}). Enquanto isso, nenhum boleto é emitido.`
              : (cert.dias_restantes ?? 0) < 0
                ? 'A emissão de boletos está parada. Passada a data não há renovação: é refazer o processo com o banco.'
                : cert.pode_renovar
                  ? 'A janela de renovação já está aberta — o Itaú só aceita nos últimos 30 dias. É a hora de renovar.'
                  : `Vence em ${cert.vence_em}. A renovação só é aceita nos últimos 30 dias; este é um aviso antecipado.`}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex items-center justify-between rounded-md border bg-muted/30 p-3">
        <div className="text-sm text-muted-foreground">
          Clientes: <strong className="text-foreground">{clientes.length}</strong>
          <span className="mx-3">•</span>
          Total a faturar: <strong className="text-foreground font-tabular">{formatMoney(totalGeral)}</strong>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Atualizar
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center rounded-md border bg-white py-16 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Carregando composição da fatura...
        </div>
      ) : clientes.length === 0 ? (
        <div className="rounded-md border bg-white py-16 text-center text-sm text-muted-foreground">
          Nenhum item aprovado pelo financeiro disponível para composição.
        </div>
      ) : (
        clientes.map((cliente) => (
          <section key={cliente.nome} className="space-y-3">
            <div className="flex items-end justify-between">
              <h2 className="text-base font-semibold text-ink">{cliente.nome}</h2>
              <span className="text-sm text-muted-foreground font-tabular">{formatMoney(cliente.total)}</span>
            </div>

            <div className="space-y-3">
              {cliente.contratos.map((kit) => (
                <ContratoKitCard
                  key={kit.contratoId}
                  kit={kit}
                  notas={notaPorContrato.get(kit.contratoId) || {}}
                  envio={envios[kit.contratoId]}
                  onStub={emBreve}
                  onEmitirBoleto={emitirBoleto}
                  onEmitirNfse={() => emitirNfse(kit.contratoId, formatContratoDisplay(kit.numero, kit.nome).full)}
                  onGerarRelatorio={() => gerarRelatorio(kit)}
                  onAbrirNota={() => abrirNota(kit)}
                  onAbrirEmail={() => void abrirEmail(kit)}
                />
              ))}
            </div>
          </section>
        ))
      )}

      <NotaDespesaPreview open={!!notaData} onClose={() => setNotaData(null)} data={notaData} />
      <FaturaEmailPreview
        open={!!emailData}
        onClose={() => setEmailData(null)}
        data={emailData}
        enviando={enviandoEmail}
        onEnviar={(assunto, corpo, para) => void enviarFatura(assunto, corpo, para)}
      />
    </div>
  )
}

function ComposicaoLinha({
  icon,
  titulo,
  descricao,
  valor,
  nota,
  acaoLabel,
  onAcao,
}: {
  icon: React.ReactNode
  titulo: string
  descricao: string
  valor?: number | null
  nota?: NotaGerada
  acaoLabel: string
  onAcao: () => void
}) {
  const emitida = !!nota
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="text-muted-foreground">{icon}</span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-ink">{titulo}</span>
            {emitida ? (
              <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">
                Emitido{nota?.numero ? ` #${nota.numero}` : ''}
              </Badge>
            ) : (
              <Badge className="border-amber-200 bg-amber-50 text-amber-700">Pendente</Badge>
            )}
          </div>
          <p className="truncate text-xs text-muted-foreground">{descricao}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {valor != null ? <span className="text-sm font-tabular text-ink">{formatMoney(valor)}</span> : null}
        {emitida && nota?.arquivo_url ? (
          <a
            href={nota.arquivo_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm text-blue-600 underline decoration-dotted underline-offset-2 hover:text-blue-700"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Abrir
          </a>
        ) : (
          <Button variant="outline" size="sm" onClick={onAcao}>
            {acaoLabel}
          </Button>
        )}
      </div>
    </div>
  )
}

function ContratoKitCard({
  kit,
  notas,
  envio,
  onStub,
  onEmitirBoleto,
  onEmitirNfse,
  onGerarRelatorio,
  onAbrirNota,
  onAbrirEmail,
}: {
  kit: ContratoKit
  notas: Partial<Record<string, NotaGerada>>
  envio?: EnvioFatura
  onStub: (label: string) => void
  onEmitirBoleto: (notaId: string) => void
  onEmitirNfse: () => void
  onGerarRelatorio: () => void
  onAbrirNota: () => void
  onAbrirEmail: () => void
}) {
  const contratoLabel = formatContratoDisplay(kit.numero, kit.nome).full
  const totalKit = kit.valorServico + kit.valorDespesa
  const enviadoOk = Boolean(envio && !envio.erro)

  return (
    <div className={`overflow-hidden rounded-lg border bg-white ${enviadoOk ? 'border-green-300' : ''}`}>
      <div className={`flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 ${enviadoOk ? 'bg-green-50' : 'bg-canvas-soft'}`}>
        <div>
          <span className="text-eyebrow text-xs">KIT DA FATURA</span>
          <p className="text-sm font-medium text-ink">{contratoLabel}</p>
          {/* Sinal do que já foi enviado (Filipe, 20/08). Mostra a data, para
              quem, por quem e quantas vezes — reenvio acontece, e saber que
              foram três é o que evita o quarto. */}
          {envio ? (
            <p className={`mt-1 text-xs ${envio.erro ? 'text-destructive' : 'text-green-700'}`}>
              {envio.erro ? '✕ Falhou o envio' : '✓ Enviada'} em{' '}
              {new Date(envio.enviado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
              {' para '}{envio.destinatario}
              {envio.por ? ` · por ${envio.por}` : ''}
              {envio.total > 1 ? ` · ${envio.total} envios` : ''}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold font-tabular text-ink">{formatMoney(totalKit)}</span>
          <Button variant={enviadoOk ? 'outline' : 'default'} size="sm" onClick={onAbrirEmail}>
            <Mail className="mr-2 h-4 w-4" />
            {enviadoOk ? 'Reenviar e-mail' : 'Pré-visualizar e-mail'}
          </Button>
        </div>
      </div>

      <div className="divide-y divide-hairline">
        {/* 1. Nota fiscal de serviço — sempre presente */}
        <ComposicaoLinha
          icon={<FileText className="h-4 w-4" />}
          titulo="Nota fiscal de serviço"
          descricao="Serviço prestado (timesheet + regras do contrato). Emitida no Fluxo de faturamento."
          valor={kit.valorServico}
          nota={notas['nota_fiscal_servico']}
          acaoLabel="Emitir no fluxo"
          onAcao={onEmitirNfse}
        />

        {/*
          2. Boleto — depende da nota: o titulo e registrado no Itau em cima da
          conta a receber, que so existe depois da NF. Enquanto ela nao sai, o
          botao explica o que falta em vez de falhar no clique.
        */}
        <ComposicaoLinha
          icon={<Banknote className="h-4 w-4" />}
          titulo="Boleto"
          descricao={
            notas['nota_fiscal_servico']
              ? 'Registra o título no Itaú e devolve a linha digitável.'
              : 'Emita a nota fiscal primeiro — o boleto é gerado sobre ela.'
          }
          nota={notas['boleto_itau']}
          acaoLabel="Emitir boleto"
          onAcao={() => {
            const nf = notas['nota_fiscal_servico']
            if (!nf) { onStub('Boleto: emita a nota fiscal primeiro'); return }
            onEmitirBoleto(nf.id)
          }}
        />

        {/* 3. Relatório de timesheet — opcional (só quando há horas aprovadas) */}
        {kit.temTimesheet ? (
          <ComposicaoLinha
            icon={<Clock className="h-4 w-4" />}
            titulo="Relatório de timesheet"
            descricao={`${formatHours(kit.horasTimesheet)} aprovadas. Geração de PDF a definir (template pendente).`}
            nota={notas['relatorio_honorarios']}
            acaoLabel="Gerar relatório"
            onAcao={onGerarRelatorio}
          />
        ) : null}

        {/* 4. Nota de despesa — opcional (só quando há despesa reembolsável) */}
        {kit.temDespesa ? (
          <ComposicaoLinha
            icon={<Receipt className="h-4 w-4" />}
            titulo="Nota de despesa"
            descricao="Despesas reembolsáveis (não tributadas). Compõe o boleto de despesa."
            valor={kit.valorDespesa}
            acaoLabel="Gerar nota de despesa"
            onAcao={onAbrirNota}
          />
        ) : null}
      </div>
    </div>
  )
}
