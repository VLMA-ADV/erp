'use client'

import { useEffect, useMemo, useState } from 'react'
import { Banknote, FileText, Loader2, Mail, Receipt, RefreshCw, Clock, ExternalLink } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { formatContratoDisplay } from '@/lib/utils/contrato-display'
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

interface DespesaRow {
  contrato_id: string
  caso_numero: number | null
  caso_nome: string
  data_lancamento: string
  categoria: string
  descricao: string
  valor: number
  status: string
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

function formatHours(value: number | null | undefined) {
  return Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

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
  const [despesas, setDespesas] = useState<DespesaRow[]>([])
  const [notaData, setNotaData] = useState<NotaDespesaData | null>(null)
  const [emailData, setEmailData] = useState<FaturaEmailData | null>(null)

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

      const [revisaoResp, notasResp, despesasResp] = await Promise.all([
        fetch(`${base}/functions/v1/get-revisao-fatura`, { method: 'GET', headers }),
        fetch(`${base}/functions/v1/get-notas-geradas?status=gerado&limit=200`, { method: 'GET', headers }),
        fetch(`${base}/functions/v1/get-despesas`, { method: 'GET', headers }),
      ])

      const revisaoPayload = await revisaoResp.json().catch(() => ({}))
      if (!revisaoResp.ok) {
        setError(revisaoPayload.error || 'Erro ao carregar itens aprovados')
        return
      }
      const notasPayload = await notasResp.json().catch(() => ({}))
      const despesasPayload = await despesasResp.json().catch(() => ({}))

      const allItems = (revisaoPayload.data || []) as RevisaoItem[]
      // O kit só faz sentido para o que o financeiro já aprovou/faturou.
      setItems(allItems.filter((it) => it.status === 'aprovado' || it.status === 'faturado'))
      setNotes(notasResp.ok ? ((notasPayload.data || []) as NotaGerada[]) : [])
      // Despesas reembolsáveis aprovadas alimentam a Nota de Despesas.
      const allDespesas = (despesasResp.ok ? despesasPayload.data || [] : []) as DespesaRow[]
      setDespesas(allDespesas.filter((d) => d.status === 'aprovado'))
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

  // Despesas reembolsáveis agrupadas por contrato (detalhe da Nota de Despesas).
  const despesaPorContrato = useMemo(() => {
    const map = new Map<string, DespesaRow[]>()
    for (const d of despesas) {
      if (!d.contrato_id) continue
      const list = map.get(d.contrato_id) || []
      list.push(d)
      map.set(d.contrato_id, list)
    }
    return map
  }, [despesas])

  const totalGeral = useMemo(() => clientes.reduce((acc, c) => acc + c.total, 0), [clientes])

  const emBreve = (label: string) => notify(`${label}: automação ainda não implementada nesta etapa.`)

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
      itens: linhas.map((d) => ({
        data_lancamento: d.data_lancamento,
        categoria: d.categoria,
        descricao: d.descricao,
        valor: Number(d.valor || 0),
      })),
    })
  }

  const abrirEmail = (kit: ContratoKit) => {
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
      destinatarioEmail: null,
      nfseNumero: nfse?.numero != null ? String(nfse.numero) : null,
      mesReferencia: mesReferenciaAtual(),
      vencimento: new Date().toLocaleDateString('pt-BR'),
      anexos,
      completo: kit.temDespesa || kit.temTimesheet,
    })
  }

  return (
    <div className="space-y-6">
      {error ? (
        <Alert className="border border-destructive/30 bg-destructive/10 text-destructive">
          <AlertTitle>Atenção</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
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
                  onStub={emBreve}
                  onAbrirNota={() => abrirNota(kit)}
                  onAbrirEmail={() => abrirEmail(kit)}
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
        onEnviar={() => {
          setEmailData(null)
          emBreve('Envio via Resend')
        }}
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
  onStub,
  onAbrirNota,
  onAbrirEmail,
}: {
  kit: ContratoKit
  notas: Partial<Record<string, NotaGerada>>
  onStub: (label: string) => void
  onAbrirNota: () => void
  onAbrirEmail: () => void
}) {
  const contratoLabel = formatContratoDisplay(kit.numero, kit.nome).full
  const totalKit = kit.valorServico + kit.valorDespesa

  return (
    <div className="overflow-hidden rounded-lg border bg-white">
      <div className="flex items-center justify-between border-b bg-canvas-soft px-4 py-3">
        <div>
          <span className="text-eyebrow text-xs">KIT DA FATURA</span>
          <p className="text-sm font-medium text-ink">{contratoLabel}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold font-tabular text-ink">{formatMoney(totalKit)}</span>
          <Button variant="outline" size="sm" onClick={onAbrirEmail}>
            <Mail className="mr-2 h-4 w-4" />
            Pré-visualizar e-mail
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
          onAcao={() => onStub('Emissão de NFS-e')}
        />

        {/* 2. Boleto — sempre presente; integração Itaú pendente */}
        <ComposicaoLinha
          icon={<Banknote className="h-4 w-4" />}
          titulo="Boleto"
          descricao="Cobrança da fatura. Integração com o Itaú ainda não implementada."
          nota={notas['boleto_itau']}
          acaoLabel="Emitir boleto"
          onAcao={() => onStub('Emissão de boleto')}
        />

        {/* 3. Relatório de timesheet — opcional (só quando há horas aprovadas) */}
        {kit.temTimesheet ? (
          <ComposicaoLinha
            icon={<Clock className="h-4 w-4" />}
            titulo="Relatório de timesheet"
            descricao={`${formatHours(kit.horasTimesheet)} h aprovadas. Geração de PDF a definir (template pendente).`}
            nota={notas['relatorio_honorarios']}
            acaoLabel="Gerar relatório"
            onAcao={() => onStub('Relatório de timesheet')}
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
