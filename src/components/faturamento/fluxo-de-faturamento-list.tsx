'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { CommandSelect, type CommandSelectOption } from '@/components/ui/command-select'
import { NativeSelect } from '@/components/ui/native-select'
import { Table } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

interface RevisaoItem {
  id: string
  contrato_id: string
  caso_id: string
  contrato_numero: number | null
  contrato_nome: string
  caso_numero?: number | null
  caso_nome?: string | null
  origem_tipo: string
  data_referencia?: string | null
  regra_nome?: string | null
  status: 'em_revisao' | 'em_aprovacao' | 'aprovado' | 'faturado' | 'cancelado' | 'disponivel'
  responsavel_fluxo_nome?: string | null
  responsavel_revisao_nome?: string | null
  responsavel_aprovacao_nome?: string | null
  snapshot?: Record<string, unknown> | null
  horas_revisadas: number | null
  horas_aprovadas?: number | null
  horas_informadas: number | null
  valor_revisado: number | null
  valor_aprovado?: number | null
  valor_informado: number | null
}

function toObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function getSnapshotTimesheetTotals(item: RevisaoItem) {
  const snapshot = item.snapshot || {}
  const rawRows = Array.isArray(snapshot.timesheet_itens_revisao) ? (snapshot.timesheet_itens_revisao as unknown[]) : []
  if (rawRows.length === 0) return null

  let hours = 0
  let value = 0
  for (const raw of rawRows) {
    const row = toObject(raw)
    if (!row) continue
    const rowHours = Number(row.horas_revisadas ?? row.horas ?? row.horas_iniciais ?? 0)
    const rowValorHora = Number(row.valor_hora ?? 0)
    const safeHours = Number.isFinite(rowHours) ? rowHours : 0
    const safeValorHora = Number.isFinite(rowValorHora) ? rowValorHora : 0
    hours += safeHours
    value += safeHours * safeValorHora
  }

  return {
    hours,
    value,
  }
}

interface ContratoEmRevisao {
  key: string
  contratoNumero: number | null
  contratoNome: string
  casoNumero: number | null
  casoNome: string
  regraFinanceira: string
  regraTipo: string
  itens: number
  horas: number
  valor: number
  statusLabel: string
  responsavelAtual: string
  detalhes: FluxoItemDetalhe[]
}

interface FluxoItemDetalhe {
  id: string
  descricao: string
  referencia: string
  horas: number
  valor: number
  statusLabel: string
  responsavelAtual: string
}

function formatMoney(value: number | string | null | undefined) {
  const amount = Number(value || 0)
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount)
}

function formatHours(value: number | string | null | undefined) {
  const amount = Number(value || 0)
  return amount.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatStatus(value: string) {
  switch (value) {
    case 'em_revisao':
      return 'Em revisão'
    case 'em_aprovacao':
      return 'Em aprovação'
    case 'aprovado':
      return 'Aprovado'
    case 'faturado':
      return 'Faturado'
    case 'cancelado':
      return 'Cancelado'
    default:
      return value || '-'
  }
}

function getEffectiveHours(item: RevisaoItem) {
  return Number(item.horas_aprovadas ?? item.horas_revisadas ?? item.horas_informadas ?? 0)
}

function getEffectiveValue(item: RevisaoItem) {
  return Number(item.valor_aprovado ?? item.valor_revisado ?? item.valor_informado ?? 0)
}

function asText(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function getRuleKind(item: RevisaoItem) {
  return asText(item.snapshot?.regra_cobranca || '').trim().toLowerCase()
}

function getRuleTitle(item: RevisaoItem) {
  if (item.origem_tipo === 'timesheet') return 'Timesheet'
  if (item.origem_tipo === 'despesa') return 'Despesa'
  const kind = getRuleKind(item)
  if (kind === 'mensalidade_processo') return 'Mensalidade de processo'
  if (kind === 'mensal') return 'Mensalidade'
  if (kind === 'projeto') return 'Projeto'
  if (kind === 'projeto_parcelado') return 'Projeto parcelado'
  if (kind === 'exito') return 'Êxito'
  if (kind === 'hora') return 'Hora'
  return asText(item.regra_nome).trim() || 'Regra financeira'
}

function getRuleType(item: RevisaoItem) {
  if (item.origem_tipo === 'timesheet') return 'hora'
  if (item.origem_tipo === 'despesa') return 'despesa'
  const kind = getRuleKind(item)
  if (kind === 'mensalidade_processo') return 'mensalidade_processo'
  if (kind === 'mensal') return 'mensalidade'
  if (kind === 'projeto') return 'projeto'
  if (kind === 'projeto_parcelado') return 'projeto_parcelado'
  if (kind === 'exito') return 'exito'
  if (kind === 'hora') return 'hora'
  return 'outros'
}

function resolveResponsavelAtual(item: RevisaoItem) {
  const snapshot = item.snapshot || {}
  const snapshotRevisor = typeof snapshot.responsavel_revisao_nome === 'string' ? snapshot.responsavel_revisao_nome : null
  const snapshotAprovador = typeof snapshot.responsavel_aprovacao_nome === 'string' ? snapshot.responsavel_aprovacao_nome : null
  const snapshotFluxo = typeof snapshot.responsavel_fluxo_nome === 'string' ? snapshot.responsavel_fluxo_nome : null

  if (item.status === 'em_revisao') {
    return item.responsavel_fluxo_nome || item.responsavel_revisao_nome || snapshotFluxo || snapshotRevisor || '-'
  }
  if (item.status === 'em_aprovacao') {
    return item.responsavel_fluxo_nome || item.responsavel_aprovacao_nome || snapshotFluxo || snapshotAprovador || '-'
  }
  return '-'
}

function getItemMetrics(item: RevisaoItem) {
  if (item.origem_tipo === 'timesheet') {
    const snapshotTotals = getSnapshotTimesheetTotals(item)
    if (snapshotTotals) {
      return { horas: snapshotTotals.hours, valor: snapshotTotals.value, itens: 1 }
    }
  }

  return {
    horas: getEffectiveHours(item),
    valor: getEffectiveValue(item),
    itens: 1,
  }
}

export default function FluxoDeFaturamentoList() {
  const [loading, setLoading] = useState(true)
  const [loadingContratos, setLoadingContratos] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [caso, setCaso] = useState('')
  const [regraTipoTab, setRegraTipoTab] = useState('all')
  const [contratosEmRevisao, setContratosEmRevisao] = useState<ContratoEmRevisao[]>([])
  const [casoOptions, setCasoOptions] = useState<CommandSelectOption[]>([])
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({})

  const loadContratosEmRevisao = async () => {
    try {
      setLoading(true)
      setLoadingContratos(true)
      setError(null)
      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) return
      const params = new URLSearchParams()
      if (status) params.set('status', status)
      if (caso) params.set('caso', caso)
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-revisao-fatura?${params.toString()}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(payload.error || 'Erro ao carregar fluxo de faturamento')
        return
      }

      const itens = (payload.data || []) as RevisaoItem[]
      const grouped = new Map<string, ContratoEmRevisao>()
      const nextCaseOptionsMap = new Map<string, CommandSelectOption>()

      for (const item of itens) {
        const contratoId = item.contrato_id
        if (!contratoId) continue
        const casoNumero = Number(item.caso_numero ?? 0) || null
        const casoNome = asText(item.caso_nome).trim() || 'Caso sem nome'
        const caseFilterLabel = `${casoNumero ? `${casoNumero} - ` : ''}${casoNome}`
        if (caseFilterLabel) {
          nextCaseOptionsMap.set(caseFilterLabel, {
            value: caseFilterLabel,
            label: caseFilterLabel,
          })
        }
        const statusLabel = formatStatus(item.status)
        const responsavelAtual = resolveResponsavelAtual(item)
        const metrics = getItemMetrics(item)

        const ruleLabel = getRuleTitle(item)
        const ruleType = getRuleType(item)
        const groupKey = `${contratoId}::${item.caso_id || 'sem-caso'}::${ruleLabel}::${item.status}::${responsavelAtual}`

        if (!grouped.has(groupKey)) {
          grouped.set(groupKey, {
            key: groupKey,
            contratoNumero: item.contrato_numero ?? null,
            contratoNome: item.contrato_nome || 'Contrato sem nome',
            casoNumero,
            casoNome,
            regraFinanceira: ruleLabel,
            regraTipo: ruleType,
            itens: 0,
            horas: 0,
            valor: 0,
            statusLabel,
            responsavelAtual,
            detalhes: [],
          })
        }

        const contract = grouped.get(groupKey)
        if (!contract) continue

        contract.horas += metrics.horas
        contract.valor += metrics.valor
        contract.itens += metrics.itens
        contract.detalhes.push({
          id: item.id,
          descricao: item.origem_tipo === 'timesheet' ? 'Timesheet' : getRuleTitle(item),
          referencia: asText(item.data_referencia),
          horas: metrics.horas,
          valor: metrics.valor,
          statusLabel,
          responsavelAtual,
        })
      }

      const contratos = Array.from(grouped.values())
        .map((contrato) => ({
          ...contrato,
          detalhes: contrato.detalhes.sort((a, b) => (a.referencia || '').localeCompare(b.referencia || '', 'pt-BR')),
        }))
        .sort((a, b) => {
          const contratoOrder = a.contratoNome.localeCompare(b.contratoNome, 'pt-BR')
          if (contratoOrder !== 0) return contratoOrder
          const casoOrder = a.casoNome.localeCompare(b.casoNome, 'pt-BR')
          if (casoOrder !== 0) return casoOrder
          return a.regraFinanceira.localeCompare(b.regraFinanceira, 'pt-BR')
        })

      setContratosEmRevisao(contratos)
      setExpandedRows((previous) => {
        const next: Record<string, boolean> = {}
        for (const entry of contratos) {
          next[entry.key] = previous[entry.key] ?? false
        }
        return next
      })
      setCasoOptions(
        Array.from(nextCaseOptionsMap.values()).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')),
      )
    } catch (err) {
      console.error(err)
      setError('Erro ao carregar fluxo de faturamento')
    } finally {
      setLoading(false)
      setLoadingContratos(false)
    }
  }

  useEffect(() => {
    void loadContratosEmRevisao()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, caso])

  const contratosFiltradosPorRegra = useMemo(() => {
    if (regraTipoTab === 'all') return contratosEmRevisao
    return contratosEmRevisao.filter((entry) => entry.regraTipo === regraTipoTab)
  }, [contratosEmRevisao, regraTipoTab])

  const totals = useMemo(() => {
    return contratosFiltradosPorRegra.reduce(
      (acc, contrato) => {
        acc.valor += contrato.valor
        acc.horas += contrato.horas
        acc.itens += contrato.itens
        return acc
      },
      { valor: 0, horas: 0, itens: 0 },
    )
  }, [contratosFiltradosPorRegra])

  return (
    <div className="space-y-4">
      {error ? (
        <Alert className="border-red-200 bg-red-50 text-red-700">
          <AlertTitle>Atenção</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-3 md:grid-cols-4">
        <div className="space-y-1">
          <label className="text-sm font-medium">Status</label>
          <NativeSelect value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Todos os status</option>
            <option value="em_revisao">Em revisão</option>
            <option value="em_aprovacao">Em aprovação</option>
            <option value="aprovado">Aprovado</option>
            <option value="faturado">Faturado</option>
            <option value="cancelado">Cancelado</option>
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Caso</label>
          <CommandSelect
            value={caso}
            onValueChange={(value) => setCaso(value)}
            options={casoOptions}
            placeholder="Todos os casos"
            searchPlaceholder="Buscar caso..."
            emptyText="Nenhum caso disponível"
          />
        </div>
        <div className="md:col-span-2 flex items-end justify-end">
          <Button
            onClick={() => {
              void loadContratosEmRevisao()
            }}
            disabled={loading || loadingContratos}
          >
            {loading ? 'Atualizando...' : 'Atualizar lista'}
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-md border bg-muted/30 p-3">
        <div className="text-sm text-muted-foreground">
          <span className="mr-4">
            Regras: <strong className="text-foreground">{contratosFiltradosPorRegra.length}</strong>
          </span>
          <span className="mr-4">
            Itens: <strong className="text-foreground">{totals.itens}</strong>
          </span>
          <span>
            Horas: <strong className="text-foreground">{formatHours(totals.horas)}</strong>
          </span>
        </div>
        <div className="text-sm font-semibold">{formatMoney(totals.valor)}</div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold uppercase text-muted-foreground">Regras financeiras no fluxo</h3>
        <Tabs value={regraTipoTab} defaultValue="all" onValueChange={setRegraTipoTab}>
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="all">Todas</TabsTrigger>
            <TabsTrigger value="hora">Hora</TabsTrigger>
            <TabsTrigger value="mensalidade_processo">Mensalidade de processo</TabsTrigger>
            <TabsTrigger value="mensalidade">Mensalidade</TabsTrigger>
            <TabsTrigger value="projeto">Projeto</TabsTrigger>
            <TabsTrigger value="projeto_parcelado">Projeto parcelado</TabsTrigger>
            <TabsTrigger value="exito">Êxito</TabsTrigger>
            <TabsTrigger value="despesa">Despesas</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="overflow-hidden rounded-md border bg-white">
          <Table className="w-full min-w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="w-10 px-2 py-3" />
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Regra financeira</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Contrato</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Caso</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Responsável atual</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Itens</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Horas</th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">Valor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loadingContratos ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    Carregando regras financeiras no fluxo...
                  </td>
                </tr>
              ) : contratosFiltradosPorRegra.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    Nenhuma regra financeira no fluxo.
                  </td>
                </tr>
              ) : (
                contratosFiltradosPorRegra.map((contrato) => (
                  <Fragment key={contrato.key}>
                    <tr>
                      <td className="px-2 py-3">
                        <button
                          type="button"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-muted-foreground hover:border-border hover:bg-muted"
                          onClick={() => {
                            setExpandedRows((previous) => ({ ...previous, [contrato.key]: !previous[contrato.key] }))
                          }}
                          aria-label={expandedRows[contrato.key] ? 'Recolher detalhes' : 'Expandir detalhes'}
                        >
                          {expandedRows[contrato.key] ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                      </td>
                      <td className="px-4 py-3 font-medium">{contrato.regraFinanceira}</td>
                      <td className="px-4 py-3 font-medium">
                        {contrato.contratoNumero ? `${contrato.contratoNumero} - ` : ''}
                        {contrato.contratoNome}
                      </td>
                      <td className="px-4 py-3">
                        {contrato.casoNumero ? `${contrato.casoNumero} - ` : ''}
                        {contrato.casoNome}
                      </td>
                      <td className="px-4 py-3">{contrato.statusLabel}</td>
                      <td className="px-4 py-3">{contrato.responsavelAtual}</td>
                      <td className="px-4 py-3">{contrato.itens}</td>
                      <td className="px-4 py-3">{formatHours(contrato.horas)}</td>
                      <td className="px-4 py-3 text-right">{formatMoney(contrato.valor)}</td>
                    </tr>
                    {expandedRows[contrato.key] ? (
                      <tr>
                        <td colSpan={9} className="bg-muted/20 px-4 py-3">
                          <div className="rounded-md border bg-white">
                            <Table className="w-full min-w-full">
                              <thead className="bg-gray-50">
                                <tr>
                                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Item</th>
                                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Referência</th>
                                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Status</th>
                                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Responsável</th>
                                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Horas</th>
                                  <th className="px-3 py-2 text-right text-xs font-medium uppercase text-gray-500">Valor</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {contrato.detalhes.map((detalhe) => (
                                  <tr key={detalhe.id}>
                                    <td className="px-3 py-2 text-sm">{detalhe.descricao}</td>
                                    <td className="px-3 py-2 text-sm">{detalhe.referencia || '-'}</td>
                                    <td className="px-3 py-2 text-sm">{detalhe.statusLabel}</td>
                                    <td className="px-3 py-2 text-sm">{detalhe.responsavelAtual}</td>
                                    <td className="px-3 py-2 text-sm">{formatHours(detalhe.horas)}</td>
                                    <td className="px-3 py-2 text-right text-sm">{formatMoney(detalhe.valor)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </Table>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))
              )}
            </tbody>
          </Table>
        </div>
      </div>
    </div>
  )
}
