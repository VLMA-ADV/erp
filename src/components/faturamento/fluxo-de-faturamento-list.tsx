'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/native-select'
import { Table } from '@/components/ui/table'

interface RevisaoItem {
  contrato_id: string
  caso_id: string
  contrato_numero: number | null
  contrato_nome: string
  cliente_nome: string
  origem_tipo: string
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
  contratoId: string
  contratoNumero: number | null
  contratoNome: string
  clienteNome: string
  itens: number
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

export default function FluxoDeFaturamentoList() {
  const [loading, setLoading] = useState(true)
  const [loadingContratos, setLoadingContratos] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [contratosEmRevisao, setContratosEmRevisao] = useState<ContratoEmRevisao[]>([])

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
      const caseGroups = new Map<string, RevisaoItem[]>()
      const statusMap = new Map<string, Set<string>>()
      const responsavelMap = new Map<string, Set<string>>()

      for (const item of itens) {
        const contratoId = item.contrato_id
        if (!contratoId) continue
        const statusLabel = formatStatus(item.status)
        const snapshot = item.snapshot || {}
        const snapshotRevisor = typeof snapshot.responsavel_revisao_nome === 'string' ? snapshot.responsavel_revisao_nome : null
        const snapshotAprovador = typeof snapshot.responsavel_aprovacao_nome === 'string' ? snapshot.responsavel_aprovacao_nome : null
        const snapshotFluxo = typeof snapshot.responsavel_fluxo_nome === 'string' ? snapshot.responsavel_fluxo_nome : null
        const responsavelAtual =
          item.status === 'em_revisao'
            ? item.responsavel_fluxo_nome || item.responsavel_revisao_nome || snapshotFluxo || snapshotRevisor || null
            : item.status === 'em_aprovacao'
              ? item.responsavel_fluxo_nome || item.responsavel_aprovacao_nome || snapshotFluxo || snapshotAprovador || null
              : null

        if (!statusMap.has(contratoId)) statusMap.set(contratoId, new Set<string>())
        statusMap.get(contratoId)?.add(statusLabel)
        if (responsavelAtual) {
          if (!responsavelMap.has(contratoId)) responsavelMap.set(contratoId, new Set<string>())
          responsavelMap.get(contratoId)?.add(responsavelAtual)
        }

        const caseKey = `${contratoId}::${item.caso_id || 'sem-caso'}`
        if (!caseGroups.has(caseKey)) caseGroups.set(caseKey, [])
        caseGroups.get(caseKey)?.push(item)

        if (!grouped.has(contratoId)) {
          grouped.set(contratoId, {
            contratoId,
            contratoNumero: item.contrato_numero ?? null,
            contratoNome: item.contrato_nome || 'Contrato sem nome',
            clienteNome: item.cliente_nome || 'Cliente sem nome',
            itens: 0,
            horas: 0,
            valor: 0,
            statusLabel,
            responsavelAtual: responsavelAtual || '-',
          })
        }
      }

      for (const [, caseItems] of caseGroups) {
        if (caseItems.length === 0) continue
        const contractId = caseItems[0].contrato_id
        const contract = grouped.get(contractId)
        if (!contract) continue

        const timesheetItems = caseItems.filter((entry) => entry.origem_tipo === 'timesheet')
        const nonTimesheetItems = caseItems.filter((entry) => entry.origem_tipo !== 'timesheet')
        const snapshotCarrier = caseItems.find((entry) => {
          const snapshot = entry.snapshot || {}
          return Array.isArray(snapshot.timesheet_itens_revisao) && snapshot.timesheet_itens_revisao.length > 0
        })
        const snapshotTotals = snapshotCarrier ? getSnapshotTimesheetTotals(snapshotCarrier) : null

        const timesheetHoursFallback = timesheetItems.reduce(
          (acc, entry) => acc + getEffectiveHours(entry),
          0,
        )
        const timesheetValueFallback = timesheetItems.reduce(
          (acc, entry) => acc + getEffectiveValue(entry),
          0,
        )

        const timesheetHours = snapshotTotals ? snapshotTotals.hours : timesheetHoursFallback
        const timesheetValue = snapshotTotals ? snapshotTotals.value : timesheetValueFallback
        const hasTimesheetLine = Boolean(snapshotCarrier || timesheetItems.length > 0 || caseItems.length > 0)

        const nonTimesheetHours = nonTimesheetItems.reduce(
          (acc, entry) => acc + getEffectiveHours(entry),
          0,
        )
        const nonTimesheetValue = nonTimesheetItems.reduce(
          (acc, entry) => acc + getEffectiveValue(entry),
          0,
        )

        contract.horas += nonTimesheetHours + (hasTimesheetLine ? timesheetHours : 0)
        contract.valor += nonTimesheetValue + (hasTimesheetLine ? timesheetValue : 0)
        contract.itens += nonTimesheetItems.length + (hasTimesheetLine ? 1 : 0)
      }

      const contratos = Array.from(grouped.values())
        .map((contrato) => {
          const statuses = Array.from(statusMap.get(contrato.contratoId) || [])
          const responsaveis = Array.from(responsavelMap.get(contrato.contratoId) || [])
          return {
            ...contrato,
            statusLabel: statuses.length <= 1 ? (statuses[0] || '-') : 'Múltiplos',
            responsavelAtual: responsaveis.length <= 1 ? (responsaveis[0] || '-') : 'Múltiplos responsáveis',
          }
        })
        .sort((a, b) => a.clienteNome.localeCompare(b.clienteNome))

      setContratosEmRevisao(contratos)
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
  }, [status])

  const totals = useMemo(() => {
    return contratosEmRevisao.reduce(
      (acc, contrato) => {
        acc.valor += contrato.valor
        acc.horas += contrato.horas
        acc.itens += contrato.itens
        return acc
      },
      { valor: 0, horas: 0, itens: 0 },
    )
  }, [contratosEmRevisao])

  return (
    <div className="space-y-4">
      {error ? (
        <Alert className="border-red-200 bg-red-50 text-red-700">
          <AlertTitle>Atenção</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-3 md:grid-cols-4">
        <div className="space-y-1 md:col-span-2">
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
            Contratos: <strong className="text-foreground">{contratosEmRevisao.length}</strong>
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
        <h3 className="text-sm font-semibold uppercase text-muted-foreground">Contratos no fluxo</h3>
        <div className="overflow-hidden rounded-md border bg-white">
          <Table className="w-full min-w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Cliente</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Contrato</th>
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
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    Carregando contratos em revisão...
                  </td>
                </tr>
              ) : contratosEmRevisao.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    Nenhum contrato em revisão.
                  </td>
                </tr>
              ) : (
                contratosEmRevisao.map((contrato) => (
                  <tr key={contrato.contratoId}>
                    <td className="px-4 py-3">{contrato.clienteNome}</td>
                    <td className="px-4 py-3 font-medium">
                      {contrato.contratoNumero ? `${contrato.contratoNumero} - ` : ''}
                      {contrato.contratoNome}
                    </td>
                    <td className="px-4 py-3">{contrato.statusLabel}</td>
                    <td className="px-4 py-3">{contrato.responsavelAtual}</td>
                    <td className="px-4 py-3">{contrato.itens}</td>
                    <td className="px-4 py-3">{formatHours(contrato.horas)}</td>
                    <td className="px-4 py-3 text-right">{formatMoney(contrato.valor)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </Table>
        </div>
      </div>
    </div>
  )
}
