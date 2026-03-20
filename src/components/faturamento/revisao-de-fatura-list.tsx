'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Eye, Loader2, Plus, Save, Settings2, SquarePen, Trash2, Undo2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CommandSelect, type CommandSelectOption } from '@/components/ui/command-select'
import { Input } from '@/components/ui/input'
import { MoneyInput } from '@/components/ui/money-input'
import { Table } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip } from '@/components/ui/tooltip'
import { useToast } from '@/components/ui/toast'
import { usePermissions } from '@/lib/hooks/use-permissions'

interface RevisaoItem {
  id: string
  contratoId: string
  casoId: string
  timesheetId: string | null
  batchId: string | null
  batchNumero: number | null
  status: string
  origemTipo: string
  dataReferencia: string
  clienteNome: string
  contratoNome: string
  contratoNumero: number | null
  casoNome: string
  casoNumero: number | null
  regraNome: string
  horasInformadas: number | null
  horasRevisadas: number | null
  horasAprovadas: number | null
  valorInformado: number | null
  valorRevisado: number | null
  valorAprovado: number | null
  responsavelFluxoNome: string | null
  responsavelRevisaoNome: string | null
  responsavelAprovacaoNome: string | null
  timesheetDataLancamento: string
  timesheetHoras: number
  timesheetDescricao: string
  timesheetProfissional: string
  timesheetValorHora: number
  snapshot: Record<string, unknown>
}

interface CasoGroup {
  key: string
  nome: string
  numero: number | null
  totalHoras: number
  totalValor: number
  itens: RevisaoItem[]
}

interface ContratoGroup {
  key: string
  contratoId: string
  nome: string
  numero: number | null
  totalHoras: number
  totalValor: number
  casos: CasoGroup[]
}

interface ClienteGroup {
  key: string
  nome: string
  totalHoras: number
  totalValor: number
  contratos: ContratoGroup[]
}

interface DraftFields {
  horas: string
  valor: string
  observacao: string
  aprovacaoDataInput: string
  aprovacaoDescricao: string
  timesheetRows: TimesheetRowDraft[]
  valueRows: ValueRowDraft[]
}

interface FluxoResponsavel {
  colaborador_id: string
  ordem: number
}

interface CasoTimesheetConfig {
  id: string
  numero: number | null
  nome: string
  timesheetConfig: {
    revisores: FluxoResponsavel[]
    aprovadores: FluxoResponsavel[]
  }
}

interface ContratoTimesheetConfig {
  id: string
  numero: number | null
  nome: string
  casos: CasoTimesheetConfig[]
}

interface TimesheetRowDraft {
  id: string
  casoId: string
  contratoId: string
  dataLancamento: string
  profissional: string
  atividade: string
  horasIniciais: string
  horasRevisadas: string
  valorHoraInicial: string
  valorHora: string
}

interface ValueRowDraft {
  id: string
  referencia: string
  descricao: string
  valorOriginal: string
  valorRevisado: string
}

interface CaseDisplayMetrics {
  totalHoras: number
  totalValor: number
  itemCount: number
  timesheetHours: number
  timesheetValue: number
  timesheetItemCount: number
  timesheetAnchorItem: RevisaoItem | null
  nonTimesheetItems: RevisaoItem[]
}

interface ClienteReviewItemTab {
  key: string
  label: string
  itemId: string
  mode: 'default' | 'timesheet'
}

interface ClienteReviewContractTab {
  key: string
  label: string
  items: ClienteReviewItemTab[]
}

interface StageLine {
  key: string
  label: string
  stageType: 'inicial' | 'revisor' | 'aprovador'
  stageOrder: number | null
  item: string
  caso: string
  responsavelId: string | null
  responsavelNome: string
  responsavelEditable: boolean
  completed: boolean
  data: string
  dataInput: string
  descricao: string
  tempo: string
  valor: number | null
  editable: boolean
}

function asString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function asNumber(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function asOptionalNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function pickFirstDefined(...values: unknown[]) {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== '') return value
  }
  return undefined
}

function resolveNumber(primary: number | null | undefined, fallback?: number | null | undefined) {
  return primary ?? fallback ?? 0
}

function getSnapshotAprovadorOrdemAtual(item: RevisaoItem) {
  const raw = Number(item.snapshot?.aprovador_ordem_atual ?? 0)
  return Number.isFinite(raw) ? raw : 0
}

function shouldUseApprovedStageValues(item: RevisaoItem) {
  if (item.status === 'aprovado' || item.status === 'faturado' || item.status === 'cancelado') return true
  if (item.status !== 'em_aprovacao') return false
  // Enquanto estiver no primeiro aprovador, o "último avaliado" ainda é a revisão.
  return getSnapshotAprovadorOrdemAtual(item) > 1
}

function getEffectiveItemHours(item: RevisaoItem) {
  if (shouldUseApprovedStageValues(item) && item.horasAprovadas !== null && item.horasAprovadas !== undefined) {
    return item.horasAprovadas
  }
  if (item.horasRevisadas !== null && item.horasRevisadas !== undefined) return item.horasRevisadas
  if (item.horasInformadas !== null && item.horasInformadas !== undefined) return item.horasInformadas
  return 0
}

function getEffectiveItemValue(item: RevisaoItem) {
  if (shouldUseApprovedStageValues(item) && item.valorAprovado !== null && item.valorAprovado !== undefined) {
    return item.valorAprovado
  }
  if (item.valorRevisado !== null && item.valorRevisado !== undefined) return item.valorRevisado
  if (item.valorInformado !== null && item.valorInformado !== undefined) return item.valorInformado
  return 0
}

function parseDecimalInput(value: string) {
  const normalized = value.replace(',', '.').trim()
  if (!normalized) return 0
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatMoney(value: number | null | undefined) {
  const amount = Number(value || 0)
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount)
}

function formatHours(value: number | null | undefined) {
  const amount = Number(value || 0)
  return amount.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function sanitizeMinutesInput(value: string) {
  return value.replace(/\D/g, '')
}

function minutesToHoursString(minutesInput: string) {
  const sanitized = sanitizeMinutesInput(minutesInput)
  if (!sanitized) return ''
  const minutes = Number(sanitized)
  if (!Number.isFinite(minutes) || minutes < 0) return ''
  const hours = minutes / 60
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
}

function hoursNumberToMinutesDisplay(value: number | null | undefined) {
  const amount = Number(value || 0)
  const minutes = Math.max(0, Math.round(amount * 60))
  return String(minutes)
}

function hoursStringToMinutesDisplay(value: string) {
  const normalized = value.replace(',', '.').trim()
  if (!normalized) return ''
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed) || parsed < 0) return ''
  return hoursNumberToMinutesDisplay(parsed)
}

function formatStatus(status: string) {
  switch (status) {
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
      return status || '-'
  }
}

function canShowReviewActions(status: string) {
  return status === 'em_revisao' || status === 'em_aprovacao'
}

function isReviewQueueStatus(status: string) {
  return status === 'em_revisao' || status === 'em_aprovacao'
}

function formatDate(value: string) {
  if (!value) return '-'
  const [year, month, day] = value.split('-')
  if (!year || !month || !day) return value
  return `${day}/${month}/${year}`
}

function normalizeDateInput(value: string) {
  if (!value) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

function formatDateDisplay(value: string) {
  if (!value) return ''
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return value
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-')
    return `${day}/${month}/${year}`
  }
  return value
}

function normalizeDateFromDisplay(value: string) {
  if (!value) return ''
  const trimmed = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
  const parts = trimmed.split('/')
  if (parts.length === 3) {
    const [day, month, year] = parts
    if (day?.length === 2 && month?.length === 2 && year?.length === 4) {
      return `${year}-${month}-${day}`
    }
  }
  return normalizeDateInput(trimmed) || trimmed
}

function formatNullableHours(value: number | null) {
  if (value === null || value === undefined) return '-'
  return formatHours(value)
}

function formatNullableMoney(value: number | null) {
  if (value === null || value === undefined) return '-'
  return formatMoney(value)
}

function StageLinesSummary({
  lines,
  activeLineKey,
  disabled,
  responsavelOptions,
  savingResponsavelLineKey,
  onActivateLine,
  onUpdateLineField,
  onUpdateResponsavel,
}: {
  lines: StageLine[]
  activeLineKey: string | null
  disabled: boolean
  responsavelOptions: CommandSelectOption[]
  savingResponsavelLineKey: string | null
  onActivateLine: (lineKey: string) => void
  onUpdateLineField: (line: StageLine, field: 'data' | 'descricao' | 'tempo' | 'valor', value: string) => void
  onUpdateResponsavel: (line: StageLine, responsavelId: string) => void
}) {
  return (
    <div className="rounded-md border bg-muted/20 p-2 text-xs">
      <div className="overflow-visible rounded-md border bg-white">
        <table className="w-full table-fixed text-xs">
          <colgroup>
            <col style={{ width: '13%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '16%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '19%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '8%' }} />
          </colgroup>
          <thead className="bg-gray-50">
            <tr>
              <th className="px-2 py-2 text-left text-[11px] font-medium uppercase text-gray-500">Item</th>
              <th className="px-2 py-2 text-left text-[11px] font-medium uppercase text-gray-500">Etapa</th>
              <th className="px-2 py-2 text-left text-[11px] font-medium uppercase text-gray-500">Caso</th>
              <th className="px-2 py-2 text-left text-[11px] font-medium uppercase text-gray-500">Responsável</th>
              <th className="px-2 py-2 text-left text-[11px] font-medium uppercase text-gray-500">Data</th>
              <th className="px-2 py-2 text-left text-[11px] font-medium uppercase text-gray-500">Descrição</th>
              <th className="px-2 py-2 text-right text-[11px] font-medium uppercase text-gray-500">Tempo (min)</th>
              <th className="px-2 py-2 text-right text-[11px] font-medium uppercase text-gray-500">Valor</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr
                key={line.key}
                className={
                  activeLineKey === line.key
                    ? 'bg-primary/5'
                    : line.editable && !disabled
                      ? 'cursor-pointer hover:bg-muted/30'
                      : ''
                }
                onClick={() => {
                  if (!disabled) onActivateLine(line.key)
                }}
              >
                <td className="px-2 py-1.5 text-[12px]">{line.item || '-'}</td>
                <td className="px-2 py-1.5 text-[12px] font-medium">{line.label}</td>
                <td className="px-2 py-1.5 text-[12px]">{line.caso || '-'}</td>
                <td className="relative z-40 px-2 py-1.5 text-[12px]">
                  {line.responsavelEditable && !disabled ? (
                    <div className="w-full min-w-0 max-w-[220px]">
                      <CommandSelect
                        value={line.responsavelId || ''}
                        onValueChange={(value) => onUpdateResponsavel(line, value)}
                        options={responsavelOptions}
                        placeholder="Selecionar responsável"
                        searchPlaceholder="Buscar colaborador..."
                        emptyText="Nenhum colaborador encontrado."
                        disabled={savingResponsavelLineKey === line.key}
                        maxVisibleOptions={3}
                        panelMinWidth={220}
                      />
                    </div>
                  ) : (
                    line.responsavelNome || '-'
                  )}
                </td>
                <td className="px-2 py-1.5 text-[12px]">
                  {line.editable && activeLineKey === line.key && !disabled ? (
                    <Input
                      type="date"
                      value={line.dataInput}
                      onChange={(event) => onUpdateLineField(line, 'data', event.target.value)}
                      className="h-7 text-xs"
                    />
                  ) : (
                    line.data || '-'
                  )}
                </td>
                <td className="px-2 py-1.5 text-[12px]">
                  {line.editable && activeLineKey === line.key && !disabled ? (
                    <Input
                      value={line.descricao || ''}
                      onChange={(event) => onUpdateLineField(line, 'descricao', event.target.value)}
                      className="h-7 text-xs"
                    />
                  ) : (
                    line.descricao || '-'
                  )}
                </td>
                <td className="px-2 py-1.5 text-right text-[12px]">
                  {line.editable && activeLineKey === line.key && line.tempo !== '-' && !disabled ? (
                    <Input
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={line.tempo}
                      onChange={(event) => onUpdateLineField(line, 'tempo', event.target.value)}
                      className="h-7 text-right text-xs"
                      placeholder="0"
                    />
                  ) : (
                    line.tempo || '-'
                  )}
                </td>
                <td className="px-2 py-1.5 text-right text-[12px]">
                  {line.editable && activeLineKey === line.key && !disabled ? (
                    <MoneyInput
                      value={String(line.valor ?? 0)}
                      onValueChange={(value) => onUpdateLineField(line, 'valor', value)}
                      disabled={disabled}
                    />
                  ) : (
                    formatNullableMoney(line.valor)
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function createDraftRowId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function toObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function parseFluxoResponsaveis(raw: unknown): FluxoResponsavel[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((entry, idx) => {
      const obj = toObject(entry) || {}
      const colaboradorId = asString(obj.colaborador_id || obj.id)
      return {
        colaborador_id: colaboradorId,
        ordem: asNumber(obj.ordem, idx + 1),
      }
    })
    .filter((entry) => entry.colaborador_id)
    .sort((a, b) => a.ordem - b.ordem)
    .map((entry, idx) => ({ ...entry, ordem: idx + 1 }))
}

function parseCasoTimesheetConfig(rawCaso: Record<string, unknown>) {
  const rootRevisores = parseFluxoResponsaveis(rawCaso.revisores)
  const rootAprovadores = parseFluxoResponsaveis(rawCaso.aprovadores)
  const rawTimesheetConfig = toObject(rawCaso.timesheet_config) || {}
  const nestedRevisores = parseFluxoResponsaveis(rawTimesheetConfig.revisores)
  const nestedAprovadores = parseFluxoResponsaveis(rawTimesheetConfig.aprovadores)

  return {
    revisores: nestedRevisores.length > 0 ? nestedRevisores : rootRevisores,
    aprovadores: nestedAprovadores.length > 0 ? nestedAprovadores : rootAprovadores,
  }
}

function parseSnapshotTimesheetRows(item: RevisaoItem): TimesheetRowDraft[] {
  const snapshotRows = Array.isArray(item.snapshot?.timesheet_itens_revisao)
    ? (item.snapshot.timesheet_itens_revisao as unknown[])
    : []

  if (snapshotRows.length > 0) {
    const parsed = snapshotRows
      .map((entry) => {
        const row = toObject(entry)
        if (!row) return null
        const horasIniciais = asNumber(row.horas_iniciais ?? row.horas_informadas ?? row.horas)
        const horasRevisadas = asNumber(row.horas_revisadas ?? row.horas)
        return {
          id: asString(row.id) || createDraftRowId(),
          casoId: asString(row.caso_id) || item.casoId,
          contratoId: asString(row.contrato_id) || item.contratoId,
          dataLancamento: normalizeDateInput(asString(row.data_lancamento)),
          profissional: asString(row.profissional),
          atividade: asString(row.atividade ?? row.descricao),
          horasIniciais: String(horasIniciais),
          horasRevisadas: String(horasRevisadas || horasIniciais),
          valorHoraInicial: String(asNumber(row.valor_hora_inicial ?? row.valor_hora)),
          valorHora: String(asNumber(row.valor_hora)),
        }
      })
      .filter((row): row is TimesheetRowDraft => row !== null)

    if (parsed.length > 0) return parsed
  }

  return [
    {
      id: item.timesheetId || createDraftRowId(),
      casoId: item.casoId,
      contratoId: item.contratoId,
      dataLancamento: item.timesheetDataLancamento,
      profissional: item.timesheetProfissional,
      atividade: item.timesheetDescricao,
      horasIniciais: String(resolveNumber(item.timesheetHoras, item.horasInformadas)),
      horasRevisadas: String(
        item.status === 'em_aprovacao'
          ? resolveNumber(item.horasAprovadas, item.horasRevisadas)
          : resolveNumber(item.horasRevisadas, item.timesheetHoras),
      ),
      valorHoraInicial: String(item.timesheetValorHora || 0),
      valorHora: String(item.timesheetValorHora || 0),
    },
  ]
}

function getRuleKind(item: RevisaoItem) {
  return asString(item.snapshot?.regra_cobranca || '').trim().toLowerCase()
}

function getRuleTitle(item: RevisaoItem) {
  if (item.origemTipo === 'despesa') return 'Despesa'
  const kind = getRuleKind(item)
  if (kind === 'mensalidade_processo') return 'Mensalidade de processo'
  if (kind === 'mensal') return 'Mensalidade'
  if (kind === 'projeto' || kind === 'projeto_parcelado') return 'Projeto'
  if (kind === 'exito') return 'Êxito'
  return item.regraNome || 'Regra financeira'
}

function parseSnapshotValueRows(item: RevisaoItem): ValueRowDraft[] {
  const valueRows = Array.isArray(item.snapshot?.valor_itens_revisao) ? (item.snapshot.valor_itens_revisao as unknown[]) : []

  if (valueRows.length > 0) {
    const parsed = valueRows
      .map((entry) => {
        const row = toObject(entry)
        if (!row) return null
        const valorOriginal = asNumber(row.valor_original ?? row.valor_informado ?? row.valor)
        const valorRevisado = asNumber(row.valor_revisado ?? row.valor ?? valorOriginal)
        return {
          id: asString(row.id) || createDraftRowId(),
          referencia: asString(row.referencia || row.data_referencia),
          descricao: asString(row.descricao),
          valorOriginal: String(valorOriginal),
          valorRevisado: String(valorRevisado),
        }
      })
      .filter((row): row is ValueRowDraft => row !== null)
    if (parsed.length > 0) return parsed
  }

  return [
    {
      id: createDraftRowId(),
      referencia: item.dataReferencia || '',
      descricao: getRuleTitle(item),
      valorOriginal: String(resolveNumber(item.valorInformado)),
      valorRevisado: String(getEffectiveItemValue(item)),
    },
  ]
}

function normalizeItem(raw: unknown): RevisaoItem | null {
  if (!raw || typeof raw !== 'object') return null
  const data = raw as Record<string, unknown>

  const id = asString(pickFirstDefined(data.billing_item_id, data.item_id, data.id))
  if (!id) return null

  return {
    id,
    contratoId: asString(data.contrato_id),
    casoId: asString(data.caso_id),
    timesheetId: asString(data.timesheet_id) || null,
    batchId: asString(pickFirstDefined(data.billing_batch_id, data.batch_id)) || null,
    batchNumero: asOptionalNumber(pickFirstDefined(data.batch_numero, data.lote_numero, data.numero_lote)),
    status: asString(data.status, 'em_revisao'),
    origemTipo: asString(data.origem_tipo, ''),
    dataReferencia: asString(data.data_referencia, ''),
    clienteNome: asString(data.cliente_nome, 'Cliente sem nome'),
    contratoNome: asString(data.contrato_nome, 'Contrato sem nome'),
    contratoNumero: asOptionalNumber(data.contrato_numero),
    casoNome: asString(data.caso_nome, 'Caso sem nome'),
    casoNumero: asOptionalNumber(data.caso_numero),
    regraNome: asString(pickFirstDefined(data.regra_nome, data.descricao, data.origem_tipo), 'Regra financeira'),
    horasInformadas: asOptionalNumber(pickFirstDefined(data.horas_informadas, data.snapshot_horas_informadas, data.horas)),
    horasRevisadas: asOptionalNumber(pickFirstDefined(data.horas_revisadas, data.snapshot_horas_revisadas, data.horas)),
    horasAprovadas: asOptionalNumber(pickFirstDefined(data.horas_aprovadas, data.snapshot_horas_aprovadas, data.horas)),
    valorInformado: asOptionalNumber(pickFirstDefined(data.valor_informado, data.snapshot_valor_informado, data.valor)),
    valorRevisado: asOptionalNumber(pickFirstDefined(data.valor_revisado, data.snapshot_valor_revisado, data.valor)),
    valorAprovado: asOptionalNumber(pickFirstDefined(data.valor_aprovado, data.snapshot_valor_aprovado, data.valor)),
    responsavelFluxoNome: asString(data.responsavel_fluxo_nome) || null,
    responsavelRevisaoNome: asString(data.responsavel_revisao_nome) || null,
    responsavelAprovacaoNome: asString(data.responsavel_aprovacao_nome) || null,
    timesheetDataLancamento: normalizeDateInput(asString(data.timesheet_data_lancamento)),
    timesheetHoras: asNumber(pickFirstDefined(data.timesheet_horas, data.horas_informadas)),
    timesheetDescricao: asString(data.timesheet_descricao, ''),
    timesheetProfissional: asString(data.timesheet_profissional, ''),
    timesheetValorHora: asNumber(data.timesheet_valor_hora),
    snapshot: toObject(data.snapshot) || {},
  }
}

function formatItemLabel(item: RevisaoItem) {
  const base = item.origemTipo === 'timesheet' ? 'Timesheet' : getRuleTitle(item)
  return `${base} • ${formatDate(item.dataReferencia)}`
}

function formatItemTabLabel(item: RevisaoItem, mode: 'default' | 'timesheet') {
  if (mode === 'timesheet' || item.origemTipo === 'timesheet') return 'Timesheet'
  return getRuleTitle(item)
}

function getSnapshotTimesheetTotals(item: RevisaoItem) {
  const rawRows = Array.isArray(item.snapshot?.timesheet_itens_revisao) ? (item.snapshot.timesheet_itens_revisao as unknown[]) : []
  if (rawRows.length === 0) return null

  let hours = 0
  let value = 0
  for (const raw of rawRows) {
    const row = toObject(raw)
    if (!row) continue
    const rowHours = asNumber(row.horas_revisadas ?? row.horas ?? row.horas_iniciais)
    const rowValorHora = asNumber(row.valor_hora)
    hours += rowHours
    value += rowHours * rowValorHora
  }

  return {
    hours,
    value,
    count: rawRows.length,
  }
}

function buildTree(items: RevisaoItem[]): ClienteGroup[] {
  const clientes = new Map<string, ClienteGroup>()

  for (const item of items) {
    const clienteKey = item.clienteNome || 'cliente'
    if (!clientes.has(clienteKey)) {
      clientes.set(clienteKey, {
        key: clienteKey,
        nome: item.clienteNome || 'Cliente sem nome',
        totalHoras: 0,
        totalValor: 0,
        contratos: [],
      })
    }

    const cliente = clientes.get(clienteKey)
    if (!cliente) continue
    cliente.totalHoras += getEffectiveItemHours(item)
    cliente.totalValor += getEffectiveItemValue(item)

    const contratoKey = `${item.contratoNumero || 'sem-numero'}-${item.contratoNome}`
    let contrato = cliente.contratos.find((entry) => entry.key === contratoKey)
    if (!contrato) {
      contrato = {
        key: contratoKey,
        contratoId: item.contratoId,
        nome: item.contratoNome,
        numero: item.contratoNumero,
        totalHoras: 0,
        totalValor: 0,
        casos: [],
      }
      cliente.contratos.push(contrato)
    }

    contrato.totalHoras += getEffectiveItemHours(item)
    contrato.totalValor += getEffectiveItemValue(item)

    const casoKey = `${item.casoNumero || 'sem-numero'}-${item.casoNome}`
    let caso = contrato.casos.find((entry) => entry.key === casoKey)
    if (!caso) {
      caso = {
        key: casoKey,
        nome: item.casoNome,
        numero: item.casoNumero,
        totalHoras: 0,
        totalValor: 0,
        itens: [],
      }
      contrato.casos.push(caso)
    }

    caso.totalHoras += getEffectiveItemHours(item)
    caso.totalValor += getEffectiveItemValue(item)
    caso.itens.push(item)
  }

  return Array.from(clientes.values())
}

export default function RevisaoDeFaturaList() {
  const { success, error: toastError } = useToast()
  const { hasPermission } = usePermissions()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cliente, setCliente] = useState('')
  const [contrato, setContrato] = useState('')
  const [caso, setCaso] = useState('')
  const [items, setItems] = useState<RevisaoItem[]>([])
  const [colaboradorOptions, setColaboradorOptions] = useState<CommandSelectOption[]>([])
  const [colaboradorIdOptions, setColaboradorIdOptions] = useState<CommandSelectOption[]>([])
  const [colaboradorMap, setColaboradorMap] = useState<Map<string, string>>(new Map())
  const [colaboradorEmailMap, setColaboradorEmailMap] = useState<Map<string, string>>(new Map())
  const [currentUserEmail, setCurrentUserEmail] = useState('')
  const [currentColaboradorId, setCurrentColaboradorId] = useState<string | null>(null)
  const [contratoConfigMap, setContratoConfigMap] = useState<Map<string, ContratoTimesheetConfig>>(new Map())

  const [expandedClientes, setExpandedClientes] = useState<Record<string, boolean>>({})
  const [expandedContratos, setExpandedContratos] = useState<Record<string, boolean>>({})
  const [expandedCasos, setExpandedCasos] = useState<Record<string, boolean>>({})

  const [drafts, setDrafts] = useState<Record<string, DraftFields>>({})
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [selectedReviewMode, setSelectedReviewMode] = useState<'default' | 'timesheet'>('default')
  const [activeStageLineKey, setActiveStageLineKey] = useState<string | null>(null)
  const [selectedClienteKey, setSelectedClienteKey] = useState<string | null>(null)
  const [selectedClienteContractTab, setSelectedClienteContractTab] = useState<string>('')
  const [selectedClienteItemTab, setSelectedClienteItemTab] = useState<string>('')
  const [, setEditingTimesheetItemId] = useState<string | null>(null)
  const [, setExpandedTimesheetRows] = useState<Record<string, boolean>>({})
  const [savingItemId, setSavingItemId] = useState<string | null>(null)
  const [movingItemId, setMovingItemId] = useState<string | null>(null)
  const [confirmAdvanceAllOpen, setConfirmAdvanceAllOpen] = useState(false)
  const [advancingAll, setAdvancingAll] = useState(false)
  const [selectedContratoConfigId, setSelectedContratoConfigId] = useState<string | null>(null)
  const [savingContratoConfig, setSavingContratoConfig] = useState(false)
  const [savingResponsavelLineKey, setSavingResponsavelLineKey] = useState<string | null>(null)

  const loadCurrentUser = async () => {
    try {
      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      setCurrentUserEmail((session?.user?.email || '').trim().toLowerCase())
    } catch (err) {
      console.error(err)
      setCurrentUserEmail('')
    }
  }

  const loadItems = async () => {
    try {
      setLoading(true)
      setError(null)
      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session) return

      const params = new URLSearchParams()
      if (cliente.trim()) params.set('cliente', cliente.trim())
      if (contrato.trim()) params.set('contrato', contrato.trim())
      if (caso.trim()) params.set('caso', caso.trim())

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-revisao-fatura${params.toString() ? `?${params}` : ''}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
        },
      )

      const payload = await response.json()
      if (!response.ok) {
        setError(payload.error || 'Erro ao carregar revisão de fatura')
        setItems([])
        return
      }

      const parsed: RevisaoItem[] = Array.isArray(payload.data)
        ? payload.data
            .map((entry: unknown) => normalizeItem(entry))
            .filter((entry: RevisaoItem | null): entry is RevisaoItem => entry !== null && isReviewQueueStatus(entry.status))
        : []

      setItems(parsed)

      const nextDrafts: Record<string, DraftFields> = {}
      for (const item of parsed) {
        const timesheetRows = parseSnapshotTimesheetRows(item)
        const totalHorasRevisadas = timesheetRows.reduce((acc, row) => acc + parseDecimalInput(row.horasRevisadas), 0)
        const totalValorRevisado = timesheetRows.reduce(
          (acc, row) => acc + parseDecimalInput(row.horasRevisadas) * parseDecimalInput(row.valorHora),
          0,
        )
        const horasDraft =
          item.origemTipo === 'timesheet'
            ? item.status === 'em_aprovacao'
              ? String(resolveNumber(item.horasAprovadas, totalHorasRevisadas))
              : String(totalHorasRevisadas)
            : String(getEffectiveItemHours(item))
        const valorDraft =
          item.origemTipo === 'timesheet'
            ? item.status === 'em_aprovacao'
              ? String(resolveNumber(item.valorAprovado, totalValorRevisado))
              : String(totalValorRevisado)
            : String(getEffectiveItemValue(item))

        nextDrafts[item.id] = {
          horas: horasDraft,
          valor: valorDraft,
          observacao: '',
          aprovacaoDataInput:
            item.origemTipo === 'timesheet'
              ? normalizeDateInput(asString(item.snapshot?.timesheet_aprovacao_data_lancamento))
              : normalizeDateFromDisplay(asString(item.snapshot?.aprovacao_referencia)),
          aprovacaoDescricao:
            item.origemTipo === 'timesheet'
              ? asString(item.snapshot?.timesheet_aprovacao_descricao)
              : asString(item.snapshot?.aprovacao_descricao),
          timesheetRows,
          valueRows: parseSnapshotValueRows(item),
        }
      }
      setDrafts(nextDrafts)

      if (selectedItemId && !parsed.some((item) => item.id === selectedItemId)) {
        setSelectedItemId(null)
      }
    } catch (err) {
      console.error(err)
      setError('Erro ao carregar revisão de fatura')
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  const loadColaboradores = async () => {
    try {
      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) return

      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/list-colaboradores?limit=1000`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) return

      const options = Array.isArray(payload.data)
        ? (payload.data as Array<Record<string, unknown>>)
            .filter((entry) => asString(entry.nome))
            .map((entry) => ({
              value: asString(entry.nome),
              label: asString(entry.nome),
              group: asString(entry.categoria),
            }))
        : []
      const idOptions = Array.isArray(payload.data)
        ? (payload.data as Array<Record<string, unknown>>)
            .filter((entry) => asString(entry.nome) && asString(entry.id))
            .map((entry) => ({
              value: asString(entry.id),
              label: asString(entry.nome),
              group: asString(entry.categoria),
            }))
        : []

      setColaboradorOptions(options)
      setColaboradorIdOptions(idOptions)
      const map = new Map<string, string>()
      const emailMap = new Map<string, string>()
      if (Array.isArray(payload.data)) {
        for (const entry of payload.data as Array<Record<string, unknown>>) {
          const id = asString(entry.id)
          const nome = asString(entry.nome)
          if (id && nome) map.set(id, nome)
          const email = asString(entry.email).trim().toLowerCase()
          if (id && email) emailMap.set(email, id)
        }
      }
      setColaboradorMap(map)
      setColaboradorEmailMap(emailMap)
    } catch (err) {
      console.error(err)
      setColaboradorOptions([])
      setColaboradorIdOptions([])
      setColaboradorMap(new Map())
      setColaboradorEmailMap(new Map())
    }
  }

  const loadContratoConfigs = async () => {
    try {
      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) return

      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-contratos?_ts=${Date.now()}`, {
        method: 'GET',
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !Array.isArray(payload.data)) {
        setContratoConfigMap(new Map())
        return
      }

      const contratosRaw = payload.data as Array<Record<string, unknown>>
      const detailCasesByContrato = new Map<string, Array<Record<string, unknown>>>()
      const detailContratoIds = contratosRaw
        .filter((rawContrato) => {
          const rawCasos = Array.isArray(rawContrato.casos) ? (rawContrato.casos as unknown[]) : []
          if (rawCasos.length === 0) return false
          return rawCasos.some((rawCaso) => {
            const caso = toObject(rawCaso) || {}
            const timesheetConfig = toObject(caso.timesheet_config)
            const hasNested = Boolean(timesheetConfig && (Array.isArray(timesheetConfig.revisores) || Array.isArray(timesheetConfig.aprovadores)))
            const hasRoot = Array.isArray(caso.revisores) || Array.isArray(caso.aprovadores)
            return !hasNested && !hasRoot
          })
        })
        .map((rawContrato) => asString(rawContrato.id))
        .filter(Boolean)

      if (detailContratoIds.length > 0) {
        await Promise.all(
          detailContratoIds.map(async (contratoId) => {
            try {
              const detailResponse = await fetch(
                `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-contrato?id=${contratoId}&_ts=${Date.now()}`,
                {
                  method: 'GET',
                  cache: 'no-store',
                  headers: {
                    Authorization: `Bearer ${session.access_token}`,
                    'Content-Type': 'application/json',
                  },
                },
              )
              const detailPayload = await detailResponse.json().catch(() => ({}))
              if (!detailResponse.ok) return
              const detailData = toObject(detailPayload.data) || {}
              const detailCasos = Array.isArray(detailData.casos) ? (detailData.casos as Array<Record<string, unknown>>) : []
              if (detailCasos.length > 0) {
                detailCasesByContrato.set(contratoId, detailCasos)
              }
            } catch (error) {
              console.error(error)
            }
          }),
        )
      }

      const map = new Map<string, ContratoTimesheetConfig>()
      for (const rawContrato of contratosRaw) {
        const contratoId = asString(rawContrato.id)
        if (!contratoId) continue
        const baseCasos = Array.isArray(rawContrato.casos) ? (rawContrato.casos as Array<Record<string, unknown>>) : []
        const rawCasos = detailCasesByContrato.get(contratoId) || baseCasos
        map.set(contratoId, {
          id: contratoId,
          numero: asOptionalNumber(rawContrato.numero),
          nome: asString(rawContrato.nome_contrato, 'Contrato sem nome'),
          casos: rawCasos.map((rawCaso) => {
            const timesheetConfig = parseCasoTimesheetConfig(rawCaso)
            return {
              id: asString(rawCaso.id),
              numero: asOptionalNumber(rawCaso.numero),
              nome: asString(rawCaso.nome, 'Caso sem nome'),
              timesheetConfig: {
                revisores: timesheetConfig.revisores,
                aprovadores: timesheetConfig.aprovadores,
              },
            }
          }),
        })
      }
      setContratoConfigMap(map)
    } catch (err) {
      console.error(err)
      setContratoConfigMap(new Map())
    }
  }

  useEffect(() => {
    void loadCurrentUser()
    void loadItems()
    void loadColaboradores()
    void loadContratoConfigs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!currentUserEmail) {
      setCurrentColaboradorId(null)
      return
    }
    setCurrentColaboradorId(colaboradorEmailMap.get(currentUserEmail) || null)
  }, [currentUserEmail, colaboradorEmailMap])

  const tree = useMemo(() => buildTree(items), [items])

  const totals = useMemo(() => {
    return tree.reduce(
      (acc, clienteGroup) => {
        for (const contratoGroup of clienteGroup.contratos) {
          for (const casoGroup of contratoGroup.casos) {
            const caseMetrics = getCaseDisplayMetrics(casoGroup)
            acc.horas += caseMetrics.totalHoras
            acc.valor += caseMetrics.totalValor
            acc.itens += caseMetrics.itemCount
          }
        }
        return acc
      },
      { horas: 0, valor: 0, itens: 0 },
    )
  }, [tree])

  const selectedClienteGroup = useMemo(
    () => (selectedClienteKey ? tree.find((group) => group.key === selectedClienteKey) || null : null),
    [tree, selectedClienteKey],
  )

  const selectedClienteContracts = useMemo<ClienteReviewContractTab[]>(() => {
    if (!selectedClienteGroup) return []

    return selectedClienteGroup.contratos.map((contratoGroup) => {
      const items: ClienteReviewItemTab[] = []
      for (const casoGroup of contratoGroup.casos) {
        const metrics = getCaseDisplayMetrics(casoGroup)
        for (const item of metrics.nonTimesheetItems) {
          items.push({
            key: `item-${item.id}`,
            label: formatItemTabLabel(item, 'default'),
            itemId: item.id,
            mode: 'default',
          })
        }
        if (metrics.timesheetAnchorItem) {
          const anchor = metrics.timesheetAnchorItem
          items.push({
            key: `timesheet-${anchor.id}-${casoGroup.key}`,
            label: formatItemTabLabel(anchor, 'timesheet'),
            itemId: anchor.id,
            mode: 'timesheet',
          })
        }
      }

      return {
        key: `contrato-${contratoGroup.contratoId || contratoGroup.key}`,
        label: contratoGroup.numero ? `${contratoGroup.numero} - ${contratoGroup.nome}` : contratoGroup.nome,
        items,
      }
    })
  }, [selectedClienteGroup])

  const selectedItem = useMemo(() => items.find((item) => item.id === selectedItemId) || null, [items, selectedItemId])
  const activeClienteContract = useMemo(
    () => selectedClienteContracts.find((contract) => contract.key === selectedClienteContractTab) || null,
    [selectedClienteContracts, selectedClienteContractTab],
  )
  const activeClienteItem = useMemo(
    () => activeClienteContract?.items.find((item) => item.key === selectedClienteItemTab) || null,
    [activeClienteContract, selectedClienteItemTab],
  )
  const selectedContratoConfig = useMemo(
    () => (selectedContratoConfigId ? contratoConfigMap.get(selectedContratoConfigId) || null : null),
    [contratoConfigMap, selectedContratoConfigId],
  )

  const getRevisoresOrdenados = (item: RevisaoItem) => {
    const contratoConfig = contratoConfigMap.get(item.contratoId)
    const caso = contratoConfig?.casos.find((entry) => entry.id === item.casoId)
    return [...(caso?.timesheetConfig.revisores || [])]
      .sort((a, b) => a.ordem - b.ordem)
      .map((entry, idx) => ({
        colaborador_id: entry.colaborador_id,
        ordem: idx + 1,
        nome: colaboradorMap.get(entry.colaborador_id) || entry.colaborador_id,
      }))
  }

  const getResponsavelAtualNome = (item: RevisaoItem) => {
    const snapshot = item.snapshot || {}
    const snapshotFluxo = asString(snapshot.responsavel_fluxo_nome)
    const snapshotRevisor = asString(snapshot.responsavel_revisao_nome)
    const snapshotAprovador = asString(snapshot.responsavel_aprovacao_nome)
    const snapshotRevisorId = asString(snapshot.responsavel_revisao_id)
    const snapshotAprovadorId = asString(snapshot.responsavel_aprovacao_id)

    const byId = (id: string) => (id ? colaboradorMap.get(id) || id : '')

    if (item.status === 'em_revisao' && (snapshotFluxo || snapshotRevisor)) return snapshotFluxo || snapshotRevisor
    if (item.status === 'em_aprovacao' && (snapshotFluxo || snapshotAprovador)) return snapshotFluxo || snapshotAprovador
    if (item.status === 'em_revisao' && snapshotRevisorId) return byId(snapshotRevisorId)
    if (item.status === 'em_aprovacao' && snapshotAprovadorId) return byId(snapshotAprovadorId)

    const revisores = getRevisoresOrdenados(item)
    const aprovadores = getAprovadoresOrdenados(item)

    if (item.status === 'em_revisao') {
      if (revisores.length === 0) return item.responsavelFluxoNome || item.responsavelRevisaoNome
      const snapshotOrderRaw = Number(snapshot.revisor_ordem_atual ?? 0)
      if (Number.isFinite(snapshotOrderRaw) && snapshotOrderRaw > 0 && snapshotOrderRaw <= revisores.length) {
        return revisores[snapshotOrderRaw - 1]?.nome || null
      }
      if (snapshotRevisorId) {
        const idx = revisores.findIndex((entry) => entry.colaborador_id === snapshotRevisorId)
        if (idx >= 0) return revisores[idx]?.nome || null
      }
      if (snapshotRevisor || snapshotFluxo) {
        const target = snapshotRevisor || snapshotFluxo
        const idx = revisores.findIndex((entry) => entry.nome === target)
        if (idx >= 0) return revisores[idx]?.nome || null
      }
      return revisores[0]?.nome || item.responsavelFluxoNome || item.responsavelRevisaoNome || null
    }

    if (item.status === 'em_aprovacao') {
      if (aprovadores.length === 0) return item.responsavelFluxoNome || item.responsavelAprovacaoNome
      const snapshotOrderRaw = Number(snapshot.aprovador_ordem_atual ?? 0)
      if (Number.isFinite(snapshotOrderRaw) && snapshotOrderRaw > 0 && snapshotOrderRaw <= aprovadores.length) {
        return aprovadores[snapshotOrderRaw - 1]?.nome || null
      }
      if (snapshotAprovadorId) {
        const idx = aprovadores.findIndex((entry) => entry.colaborador_id === snapshotAprovadorId)
        if (idx >= 0) return aprovadores[idx]?.nome || null
      }
      if (snapshotAprovador || snapshotFluxo) {
        const target = snapshotAprovador || snapshotFluxo
        const idx = aprovadores.findIndex((entry) => entry.nome === target)
        if (idx >= 0) return aprovadores[idx]?.nome || null
      }
      return aprovadores[0]?.nome || item.responsavelFluxoNome || item.responsavelAprovacaoNome || null
    }

    return null
  }

  const summarizeStatusAndResponsavel = (groupItems: RevisaoItem[]) => {
    const statusSet = new Set<string>()
    const responsavelSet = new Set<string>()
    for (const item of groupItems) {
      statusSet.add(formatStatus(item.status))
      const responsavel = getResponsavelAtualNome(item)
      if (responsavel) responsavelSet.add(responsavel)
    }
    return {
      status: statusSet.size === 0 ? '-' : statusSet.size === 1 ? Array.from(statusSet)[0] : 'Múltiplos',
      responsavel:
        responsavelSet.size === 0 ? '-' : responsavelSet.size === 1 ? Array.from(responsavelSet)[0] : 'Múltiplos',
    }
  }

function getCaseDisplayMetrics(casoGroup: CasoGroup): CaseDisplayMetrics {
  const timesheetItems = casoGroup.itens.filter((entry) => entry.origemTipo === 'timesheet')
  const nonTimesheetItems = casoGroup.itens.filter((entry) => entry.origemTipo !== 'timesheet')
  const snapshotCarrier =
      casoGroup.itens.find((entry) => {
        const raw = Array.isArray(entry.snapshot?.timesheet_itens_revisao) ? (entry.snapshot.timesheet_itens_revisao as unknown[]) : []
        return raw.length > 0
      }) || null

  const hasConcreteTimesheetItems = timesheetItems.length > 0
  const snapshotTotals = !hasConcreteTimesheetItems && snapshotCarrier ? getSnapshotTimesheetTotals(snapshotCarrier) : null
  const fallbackTimesheetHours = timesheetItems.reduce((acc, item) => acc + getEffectiveItemHours(item), 0)
  const fallbackTimesheetValue = timesheetItems.reduce((acc, item) => acc + getEffectiveItemValue(item), 0)
  const timesheetHours = hasConcreteTimesheetItems ? fallbackTimesheetHours : snapshotTotals ? snapshotTotals.hours : 0
  const timesheetValue = hasConcreteTimesheetItems ? fallbackTimesheetValue : snapshotTotals ? snapshotTotals.value : 0
  const timesheetItemCount =
    hasConcreteTimesheetItems
      ? timesheetItems.length
      : snapshotTotals?.count ?? (snapshotCarrier || casoGroup.itens.length > 0 ? 1 : 0)

    const nonTimesheetHours = nonTimesheetItems.reduce((acc, item) => acc + getEffectiveItemHours(item), 0)
    const nonTimesheetValue = nonTimesheetItems.reduce((acc, item) => acc + getEffectiveItemValue(item), 0)
    const hasTimesheetLine = Boolean(snapshotCarrier || timesheetItems.length > 0 || casoGroup.itens.length > 0)

    return {
      totalHoras: nonTimesheetHours + (hasTimesheetLine ? timesheetHours : 0),
      totalValor: nonTimesheetValue + (hasTimesheetLine ? timesheetValue : 0),
      itemCount: nonTimesheetItems.length + (hasTimesheetLine ? 1 : 0),
      timesheetHours: hasTimesheetLine ? timesheetHours : 0,
      timesheetValue: hasTimesheetLine ? timesheetValue : 0,
      timesheetItemCount: hasTimesheetLine ? Math.max(timesheetItemCount, 1) : 0,
      timesheetAnchorItem: snapshotCarrier || timesheetItems[0] || casoGroup.itens[0] || null,
      nonTimesheetItems,
    }
  }

  const updateDraft = (itemId: string, patch: Partial<DraftFields>) => {
    setDrafts((prev) => ({
      ...prev,
      [itemId]: {
        horas: prev[itemId]?.horas || '0',
        valor: prev[itemId]?.valor || '0',
        observacao: prev[itemId]?.observacao || '',
        aprovacaoDataInput: prev[itemId]?.aprovacaoDataInput || '',
        aprovacaoDescricao: prev[itemId]?.aprovacaoDescricao || '',
        timesheetRows: prev[itemId]?.timesheetRows || [],
        valueRows: prev[itemId]?.valueRows || [],
        ...patch,
      },
    }))
  }

  const openReviewModal = (itemId: string, mode: 'default' | 'timesheet' = 'default') => {
    setSelectedItemId(itemId)
    setSelectedReviewMode(mode)
    setEditingTimesheetItemId(null)
    setExpandedTimesheetRows({})
  }

  const openClienteReviewModal = (clienteKey: string) => {
    setSelectedClienteKey(clienteKey)
  }

  useEffect(() => {
    if (!selectedClienteKey) return
    const firstContract = selectedClienteContracts[0]
    if (!firstContract) {
      setSelectedClienteContractTab('')
      setSelectedClienteItemTab('')
      return
    }

    if (!selectedClienteContractTab || !selectedClienteContracts.some((contract) => contract.key === selectedClienteContractTab)) {
      setSelectedClienteContractTab(firstContract.key)
      setSelectedClienteItemTab(firstContract.items[0]?.key || '')
      return
    }

    const activeContract = selectedClienteContracts.find((contract) => contract.key === selectedClienteContractTab) || firstContract
    if (!activeContract.items.some((item) => item.key === selectedClienteItemTab)) {
      setSelectedClienteItemTab(activeContract.items[0]?.key || '')
    }
  }, [selectedClienteKey, selectedClienteContracts, selectedClienteContractTab, selectedClienteItemTab])

  useEffect(() => {
    if (!selectedClienteKey || !activeClienteItem) return
    setSelectedItemId(activeClienteItem.itemId)
    setSelectedReviewMode(activeClienteItem.mode)
    setEditingTimesheetItemId(null)
    setExpandedTimesheetRows({})
  }, [selectedClienteKey, activeClienteItem])

  const updateTimesheetRow = (itemId: string, rowId: string, patch: Partial<TimesheetRowDraft>) => {
    setDrafts((prev) => {
      const current = prev[itemId]
      if (!current) return prev

      return {
        ...prev,
        [itemId]: {
          ...current,
          timesheetRows: (current.timesheetRows || []).map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
        },
      }
    })
  }

  const addTimesheetRow = (itemId: string) => {
    const sourceItem = items.find((item) => item.id === itemId)
    const row: TimesheetRowDraft = {
      id: createDraftRowId(),
      casoId: sourceItem?.casoId || '',
      contratoId: sourceItem?.contratoId || '',
      dataLancamento: '',
      profissional: '',
      atividade: '',
      horasIniciais: '0',
      horasRevisadas: '0',
      valorHoraInicial: '0',
      valorHora: '0',
    }
    setDrafts((prev) => {
      const current = prev[itemId]
      if (!current) return prev
      return {
        ...prev,
        [itemId]: {
          ...current,
          timesheetRows: [...(current.timesheetRows || []), row],
        },
      }
    })
    setEditingTimesheetItemId(row.id)
  }

  const updateValueRow = (itemId: string, rowId: string, patch: Partial<ValueRowDraft>) => {
    setDrafts((prev) => {
      const current = prev[itemId]
      if (!current) return prev
      return {
        ...prev,
        [itemId]: {
          ...current,
          valueRows: (current.valueRows || []).map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
        },
      }
    })
  }

  const addValueRow = (itemId: string) => {
    const row: ValueRowDraft = {
      id: createDraftRowId(),
      referencia: '',
      descricao: 'Parcela',
      valorOriginal: '0',
      valorRevisado: '0',
    }
    setDrafts((prev) => {
      const current = prev[itemId]
      if (!current) return prev
      return {
        ...prev,
        [itemId]: {
          ...current,
          valueRows: [...(current.valueRows || []), row],
        },
      }
    })
    setEditingTimesheetItemId(row.id)
  }

  const removeValueRow = (itemId: string, rowId: string) => {
    setDrafts((prev) => {
      const current = prev[itemId]
      if (!current) return prev
      const nextRows = (current.valueRows || []).filter((row) => row.id !== rowId)
      return {
        ...prev,
        [itemId]: {
          ...current,
          valueRows: nextRows.length > 0 ? nextRows : current.valueRows,
        },
      }
    })
    setEditingTimesheetItemId((current) => (current === rowId ? null : current))
  }

  const updateCasoFluxo = (
    casoId: string,
    field: 'revisores' | 'aprovadores',
    updater: (entries: FluxoResponsavel[]) => FluxoResponsavel[],
  ) => {
    setContratoConfigMap((prev) => {
      if (!selectedContratoConfigId) return prev
      const contrato = prev.get(selectedContratoConfigId)
      if (!contrato) return prev
      const nextCasos = contrato.casos.map((caso) => {
        if (caso.id !== casoId) return caso
        const current = caso.timesheetConfig[field] || []
        const updated = updater(current).map((entry, idx) => ({ ...entry, ordem: entry.ordem || idx + 1 }))
        return {
          ...caso,
          timesheetConfig: {
            ...caso.timesheetConfig,
            [field]: updated,
          },
        }
      })
      const next = new Map(prev)
      next.set(selectedContratoConfigId, { ...contrato, casos: nextCasos })
      return next
    })
  }

  const normalizeTimesheetConfigPayload = (timesheetConfig: { revisores: FluxoResponsavel[]; aprovadores: FluxoResponsavel[] }) => ({
    revisores: [...(timesheetConfig.revisores || [])]
      .sort((a, b) => a.ordem - b.ordem)
      .map((entry, idx) => ({ colaborador_id: entry.colaborador_id, ordem: idx + 1 }))
      .filter((entry) => entry.colaborador_id),
    aprovadores: [...(timesheetConfig.aprovadores || [])]
      .sort((a, b) => a.ordem - b.ordem)
      .map((entry, idx) => ({ colaborador_id: entry.colaborador_id, ordem: idx + 1 }))
      .filter((entry) => entry.colaborador_id),
  })

  const persistCasoTimesheetConfig = async (
    casoId: string,
    timesheetConfig: { revisores: FluxoResponsavel[]; aprovadores: FluxoResponsavel[] },
  ) => {
    const supabase = createClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) {
      return { ok: false, error: 'Sessão inválida.' }
    }

    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/update-caso`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: casoId,
        timesheet_config: normalizeTimesheetConfigPayload(timesheetConfig),
      }),
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) {
      return {
        ok: false,
        error: asString(result.error) || 'Erro ao salvar responsáveis do caso.',
      }
    }
    return { ok: true, error: '' }
  }

  const saveContratoConfig = async () => {
    if (!selectedContratoConfig) return
    try {
      setSavingContratoConfig(true)

      for (const caso of selectedContratoConfig.casos) {
        const result = await persistCasoTimesheetConfig(caso.id, caso.timesheetConfig)
        if (!result.ok) {
          toastError(result.error || `Erro ao salvar responsáveis do caso ${caso.nome}`)
          return
        }
      }

      success('Revisores/aprovadores atualizados com sucesso.')
      setSelectedContratoConfigId(null)
      await loadContratoConfigs()
    } catch (err) {
      console.error(err)
      toastError('Erro ao salvar revisores/aprovadores')
    } finally {
      setSavingContratoConfig(false)
    }
  }

  const updateStageLineResponsavel = async (line: StageLine, responsavelId: string) => {
    if (!selectedItem || !canManageReviewers) return
    if (line.stageType === 'inicial' || !line.stageOrder) return
    if (!responsavelId) return
    if (line.completed) {
      toastError('Não é permitido alterar responsável de etapas já realizadas.')
      return
    }

    const contratoConfig = contratoConfigMap.get(selectedItem.contratoId)
    const caso = contratoConfig?.casos.find((entry) => entry.id === selectedItem.casoId)
    if (!caso) {
      toastError('Configuração do caso não encontrada para atualizar responsável.')
      return
    }

    const revisoresOrdenados = [...(caso.timesheetConfig.revisores || [])]
      .sort((a, b) => a.ordem - b.ordem)
      .map((entry, idx) => ({ ...entry, ordem: idx + 1 }))
    const aprovadoresOrdenados = [...(caso.timesheetConfig.aprovadores || [])]
      .sort((a, b) => a.ordem - b.ordem)
      .map((entry, idx) => ({ ...entry, ordem: idx + 1 }))
    const targetField = line.stageType === 'revisor' ? 'revisores' : 'aprovadores'
    const targetEntries = targetField === 'revisores' ? revisoresOrdenados : aprovadoresOrdenados
    const targetIndex = line.stageOrder - 1
    if (targetIndex < 0) return
    const paddedEntries = [...targetEntries]
    while (paddedEntries.length <= targetIndex) {
      paddedEntries.push({ colaborador_id: '', ordem: paddedEntries.length + 1 })
    }
    if ((paddedEntries[targetIndex]?.colaborador_id || '') === responsavelId) return

    const updatedEntries = paddedEntries.map((entry, idx) =>
      idx === targetIndex
        ? { ...entry, colaborador_id: responsavelId, ordem: idx + 1 }
        : { ...entry, ordem: idx + 1 },
    )
    const nextTimesheetConfig = {
      revisores: targetField === 'revisores' ? updatedEntries : revisoresOrdenados,
      aprovadores: targetField === 'aprovadores' ? updatedEntries : aprovadoresOrdenados,
    }

    try {
      setSavingResponsavelLineKey(line.key)
      const result = await persistCasoTimesheetConfig(caso.id, nextTimesheetConfig)
      if (!result.ok) {
        toastError(result.error || 'Erro ao salvar responsável da etapa.')
        return
      }

      setContratoConfigMap((prev) => {
        const contrato = prev.get(selectedItem.contratoId)
        if (!contrato) return prev
        const nextCasos = contrato.casos.map((entry) =>
          entry.id === caso.id ? { ...entry, timesheetConfig: nextTimesheetConfig } : entry,
        )
        const next = new Map(prev)
        next.set(selectedItem.contratoId, { ...contrato, casos: nextCasos })
        return next
      })
      success('Responsável da etapa atualizado com sucesso.')
    } catch (err) {
      console.error(err)
      toastError('Erro ao atualizar responsável da etapa.')
    } finally {
      setSavingResponsavelLineKey(null)
    }
  }

  const removeTimesheetRow = (itemId: string, rowId: string) => {
    setDrafts((prev) => {
      const current = prev[itemId]
      if (!current) return prev
      const nextRows = (current.timesheetRows || []).filter((row) => row.id !== rowId)
      return {
        ...prev,
        [itemId]: {
          ...current,
          timesheetRows: nextRows.length > 0 ? nextRows : current.timesheetRows,
        },
      }
    })
    setEditingTimesheetItemId((current) => (current === rowId ? null : current))
  }

  const saveItem = async (item: RevisaoItem) => {
    try {
      setSavingItemId(item.id)
      const draft = drafts[item.id] || {
        horas: '0',
        valor: '0',
        observacao: '',
        aprovacaoDataInput: '',
        aprovacaoDescricao: '',
        timesheetRows: [],
        valueRows: [],
      }

      const timesheetRows = draft.timesheetRows || []
      const valueRows = draft.valueRows || []
      const totalHorasRevisadas = timesheetRows.reduce((acc, row) => acc + parseDecimalInput(row.horasRevisadas), 0)
      const totalValorRevisado = timesheetRows.reduce(
        (acc, row) => acc + parseDecimalInput(row.horasRevisadas) * parseDecimalInput(row.valorHora),
        0,
      )
      const totalRevisadoRegra = valueRows.reduce((acc, row) => acc + parseDecimalInput(row.valorRevisado), 0)
      const firstRow = timesheetRows[0]
      const isTimesheetMode = (selectedItemId === item.id && selectedReviewMode === 'timesheet') || item.origemTipo === 'timesheet'
      if (isTimesheetMode) {
        const horasRaw = (draft.horas || '').trim()
        const horas = parseDecimalInput(horasRaw)
        if (!horasRaw || horas <= 0) {
          toastError('Informe o tempo em minutos para salvar e avançar o item.')
          return false
        }
      }
      const snapshotPatch =
        isTimesheetMode
          ? {
              timesheet_itens_revisao: timesheetRows.map((row) => ({
                id: row.id,
                caso_id: row.casoId || item.casoId,
                contrato_id: row.contratoId || item.contratoId,
                data_lancamento: row.dataLancamento || null,
                profissional: row.profissional || '',
                atividade: row.atividade || '',
                horas_iniciais: parseDecimalInput(row.horasIniciais),
                horas_revisadas: parseDecimalInput(row.horasRevisadas),
                valor_hora_inicial: parseDecimalInput(row.valorHoraInicial),
                valor_hora: parseDecimalInput(row.valorHora),
              })),
              timesheet_data_lancamento: firstRow?.dataLancamento || null,
              timesheet_horas: parseDecimalInput(firstRow?.horasIniciais || '0'),
              timesheet_descricao: firstRow?.atividade || '',
              timesheet_profissional: firstRow?.profissional || '',
              timesheet_valor_hora: parseDecimalInput(firstRow?.valorHora || '0'),
              timesheet_data_lancamento_inicial:
                asString(item.snapshot?.timesheet_data_lancamento_inicial) ||
                item.timesheetDataLancamento ||
                firstRow?.dataLancamento ||
                null,
              timesheet_descricao_inicial:
                asString(item.snapshot?.timesheet_descricao_inicial) ||
                item.timesheetDescricao ||
                firstRow?.atividade ||
                '',
              ...(item.status === 'em_aprovacao'
                ? {
                    timesheet_aprovacao_data_lancamento: normalizeDateInput(draft.aprovacaoDataInput || '') || null,
                    timesheet_aprovacao_descricao: draft.aprovacaoDescricao || '',
                  }
                : {}),
            }
          : {
              valor_itens_revisao: valueRows.map((row) => ({
                id: row.id,
                referencia: normalizeDateFromDisplay(row.referencia || '') || row.referencia || null,
                descricao: row.descricao || '',
                valor_original: parseDecimalInput(row.valorOriginal),
                valor_revisado: parseDecimalInput(row.valorRevisado),
              })),
              referencia_inicial:
                normalizeDateFromDisplay(asString(item.snapshot?.referencia_inicial)) ||
                normalizeDateFromDisplay(item.dataReferencia || '') ||
                null,
              descricao_inicial: asString(item.snapshot?.descricao_inicial) || getRuleTitle(item),
              ...(item.status === 'em_aprovacao'
                ? {
                    aprovacao_referencia: normalizeDateInput(draft.aprovacaoDataInput || '') || null,
                    aprovacao_descricao: draft.aprovacaoDescricao || '',
                  }
                : {}),
            }

      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) return false

      const body: Record<string, unknown> = {
        billing_item_id: item.id,
        observacao: draft.observacao || null,
        snapshot_patch: snapshotPatch,
      }
      if (isTimesheetMode && item.origemTipo !== 'timesheet') {
        body.review_mode = 'timesheet'
      }

      const targetHours = isTimesheetMode ? totalHorasRevisadas : getEffectiveItemHours(item)
      const targetValue =
        isTimesheetMode
          ? totalValorRevisado
          : valueRows.length > 0
            ? totalRevisadoRegra
            : getEffectiveItemValue(item)
      if (item.status === 'em_aprovacao') {
        body.horas_aprovadas = isTimesheetMode ? parseDecimalInput(draft.horas || String(totalHorasRevisadas)) : targetHours
        body.valor_aprovado = parseDecimalInput(draft.valor || String(targetValue))
      } else {
        body.horas_revisadas = targetHours
        body.valor_revisado = targetValue
      }

      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/update-revisao-fatura-item`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        toastError(payload.error || 'Erro ao salvar item da revisão')
        return false
      }

      success('Revisão salva com sucesso.')
      await loadItems()
      return true
    } catch (err) {
      console.error(err)
      toastError('Erro ao salvar item da revisão')
      return false
    } finally {
      setSavingItemId(null)
    }
  }

  const moveStatus = async (
    item: RevisaoItem,
    action: 'avancar' | 'retornar',
    options?: { notify?: boolean; reload?: boolean; setBusy?: boolean },
  ) => {
    const notify = options?.notify ?? true
    const reload = options?.reload ?? true
    const setBusy = options?.setBusy ?? true
    try {
      if (setBusy) setMovingItemId(item.id)
      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) return false

      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/set-revisao-fatura-status`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          billing_item_id: item.id,
          action,
        }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (notify) toastError(payload.error || 'Erro ao atualizar etapa do item')
        return false
      }

      if (notify) success(action === 'avancar' ? 'Item avançado para próxima etapa.' : 'Item retornado para etapa anterior.')
      if (reload) await loadItems()
      return true
    } catch (err) {
      console.error(err)
      if (notify) toastError('Erro ao atualizar etapa do item')
      return false
    } finally {
      if (setBusy) setMovingItemId(null)
    }
  }

  const getAprovadoresOrdenados = (item: RevisaoItem) => {
    const contratoConfig = contratoConfigMap.get(item.contratoId)
    const caso = contratoConfig?.casos.find((entry) => entry.id === item.casoId)
    return [...(caso?.timesheetConfig.aprovadores || [])]
      .sort((a, b) => a.ordem - b.ordem)
      .map((entry, idx) => ({
        colaborador_id: entry.colaborador_id,
        ordem: idx + 1,
        nome: colaboradorMap.get(entry.colaborador_id) || entry.colaborador_id,
      }))
  }

  const getRevisorAtualIndex = (
    item: RevisaoItem,
    revisores: Array<{ colaborador_id: string; ordem: number; nome: string }>,
  ) => {
    if (revisores.length === 0) return -1
    const snapshotOrderRaw = Number((item.snapshot || {}).revisor_ordem_atual ?? 0)
    if (Number.isFinite(snapshotOrderRaw) && snapshotOrderRaw > 0 && snapshotOrderRaw <= revisores.length) {
      return snapshotOrderRaw - 1
    }
    const snapshotRevisorId = asString((item.snapshot || {}).responsavel_revisao_id)
    if (snapshotRevisorId) {
      const idxById = revisores.findIndex((entry) => entry.colaborador_id === snapshotRevisorId)
      if (idxById >= 0) return idxById
    }
    const responsavelAtual = getResponsavelAtualNome(item)
    if (responsavelAtual) {
      const idxByName = revisores.findIndex((entry) => entry.nome === responsavelAtual)
      if (idxByName >= 0) return idxByName
    }
    return 0
  }

  const getAprovadorAtualIndex = (
    item: RevisaoItem,
    aprovadores: Array<{ colaborador_id: string; ordem: number; nome: string }>,
  ) => {
    if (aprovadores.length === 0) return -1

    const snapshotOrderRaw = Number((item.snapshot || {}).aprovador_ordem_atual ?? 0)
    if (Number.isFinite(snapshotOrderRaw) && snapshotOrderRaw > 0 && snapshotOrderRaw <= aprovadores.length) {
      return snapshotOrderRaw - 1
    }

    const responsavelAtual = getResponsavelAtualNome(item)
    if (responsavelAtual) {
      const idxByName = aprovadores.findIndex((entry) => entry.nome === responsavelAtual)
      if (idxByName >= 0) return idxByName
    }

    return 0
  }

  const updateAprovadorDaVez = async (
    item: RevisaoItem,
    targetIndex: number,
    message: string,
    options?: { notify?: boolean; reload?: boolean },
  ) => {
    const notify = options?.notify ?? true
    const reload = options?.reload ?? true
    const aprovadores = getAprovadoresOrdenados(item)
    if (targetIndex < 0 || targetIndex >= aprovadores.length) return false
    const target = aprovadores[targetIndex]

    const supabase = createClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) return false

    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/update-revisao-fatura-item`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        billing_item_id: item.id,
        snapshot_patch: {
          aprovador_ordem_atual: target.ordem,
          responsavel_aprovacao_id: target.colaborador_id,
          responsavel_aprovacao_nome: target.nome,
          responsavel_fluxo_nome: target.nome,
        },
      }),
    })

    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      if (notify) toastError(payload.error || 'Erro ao atualizar aprovador da vez')
      return false
    }

    if (notify) success(message)
    if (reload) await loadItems()
    return true
  }

  const advanceToNextApprover = async (item: RevisaoItem, options?: { notify?: boolean; reload?: boolean }) => {
    if (item.status !== 'em_aprovacao') return false
    const aprovadores = getAprovadoresOrdenados(item)
    if (aprovadores.length <= 1) return false
    const currentIndex = getAprovadorAtualIndex(item, aprovadores)
    if (currentIndex < 0 || currentIndex >= aprovadores.length - 1) return false
    return updateAprovadorDaVez(item, currentIndex + 1, 'Item avançado para próximo aprovador.', options)
  }

  const returnToPreviousApprover = async (item: RevisaoItem) => {
    if (item.status !== 'em_aprovacao') return false
    const aprovadores = getAprovadoresOrdenados(item)
    if (aprovadores.length <= 1) return false
    const currentIndex = getAprovadorAtualIndex(item, aprovadores)
    if (currentIndex <= 0) return false
    return updateAprovadorDaVez(item, currentIndex - 1, 'Item retornado para aprovador anterior.')
  }

  const handleReturnAction = async (item: RevisaoItem) => {
    const handledInApprovalChain = await returnToPreviousApprover(item)
    if (handledInApprovalChain) return
    await moveStatus(item, 'retornar')
  }

  const getAdvanceActionLabel = (item: RevisaoItem) => {
    const contratoConfig = contratoConfigMap.get(item.contratoId)
    const caso = contratoConfig?.casos.find((entry) => entry.id === item.casoId)
    const responsavelAtual = getResponsavelAtualNome(item)

    if (item.status === 'em_revisao') {
      const revisores = [...(caso?.timesheetConfig.revisores || [])].sort((a, b) => a.ordem - b.ordem)
      if (revisores.length <= 1) return 'Enviar para aprovação'
      const idx = revisores.findIndex((entry) => {
        const nome = colaboradorMap.get(entry.colaborador_id) || entry.colaborador_id
        return responsavelAtual ? nome === responsavelAtual : false
      })
      const hasNext = idx >= 0 ? idx < revisores.length - 1 : revisores.length > 1
      return hasNext ? 'Avançar para próximo revisor' : 'Enviar para aprovação'
    }

    if (item.status === 'em_aprovacao') {
      const aprovadores = [...(caso?.timesheetConfig.aprovadores || [])].sort((a, b) => a.ordem - b.ordem)
      if (aprovadores.length <= 1) return 'Aprovar'
      const idx = aprovadores.findIndex((entry) => {
        const nome = colaboradorMap.get(entry.colaborador_id) || entry.colaborador_id
        return responsavelAtual ? nome === responsavelAtual : false
      })
      const hasNext = idx >= 0 ? idx < aprovadores.length - 1 : aprovadores.length > 1
      return hasNext ? 'Avançar para próximo aprovador' : 'Aprovar'
    }

    return 'Avançar'
  }

  const saveAndAdvanceItem = async (item: RevisaoItem) => {
    if (item.id === selectedItem?.id && hasInvalidEditableTempo) {
      toastError('Informe o tempo em minutos para avançar o item.')
      return
    }
    const saved = await saveItem(item)
    if (!saved) return
    const handledInApprovalChain = await advanceToNextApprover(item)
    if (handledInApprovalChain) return
    await moveStatus(item, 'avancar')
  }

  const canAdvance = (statusValue: string) => statusValue === 'em_revisao' || statusValue === 'em_aprovacao'
  const canReturn = (statusValue: string) => statusValue === 'em_aprovacao' || statusValue === 'aprovado'
  const clienteAdvanceItems = useMemo(() => {
    if (!selectedClienteGroup) return []
    const map = new Map<string, RevisaoItem>()
    for (const contratoGroup of selectedClienteGroup.contratos) {
      for (const casoGroup of contratoGroup.casos) {
        for (const item of casoGroup.itens) {
          if (!map.has(item.id) && canAdvance(item.status)) map.set(item.id, item)
        }
      }
    }
    return Array.from(map.values())
  }, [selectedClienteGroup])

  const advanceAllClienteItems = async () => {
    if (!selectedClienteGroup) return
    if (clienteAdvanceItems.length === 0) {
      toastError('Nenhum item elegível para avançar neste cliente.')
      return
    }

    try {
      setAdvancingAll(true)
      let successCount = 0
      let failCount = 0
      const selectedId = selectedItem?.id || null

      if (selectedItem && canAdvance(selectedItem.status)) {
        const saved = await saveItem(selectedItem)
        if (!saved) {
          failCount += 1
        }
      }

      for (const item of clienteAdvanceItems) {
        if (item.id === selectedId && failCount > 0) continue
        const advancedInChain = await advanceToNextApprover(item, { notify: false, reload: false })
        const moved = advancedInChain || (await moveStatus(item, 'avancar', { notify: false, reload: false, setBusy: false }))
        if (moved) {
          successCount += 1
        } else {
          failCount += 1
        }
      }

      await loadItems()
      if (successCount > 0) {
        success(`${successCount} item(ns) avançado(s) para a próxima etapa.`)
      }
      if (failCount > 0) {
        toastError(`${failCount} item(ns) não puderam ser avançados.`)
      }
      setConfirmAdvanceAllOpen(false)
    } catch (err) {
      console.error(err)
      toastError('Erro ao avançar itens em massa.')
    } finally {
      setAdvancingAll(false)
    }
  }

  const selectedDraft = selectedItem ? drafts[selectedItem.id] : null
  const modalBusy = selectedItem ? savingItemId === selectedItem.id || movingItemId === selectedItem.id : false
  const itemLocked = selectedItem ? ['aprovado', 'faturado', 'cancelado'].includes(selectedItem.status) : false
  const editDisabled = modalBusy || itemLocked
  const isTimesheetMode = selectedItem ? selectedReviewMode === 'timesheet' || selectedItem.origemTipo === 'timesheet' : false
  const selectedTimesheetRows = selectedDraft?.timesheetRows || []
  const selectedValueRows = selectedDraft?.valueRows || []
  const caseTransferMap = useMemo(() => {
    const caseToContrato = new Map<string, string>()
    const optionsMap = new Map<string, CommandSelectOption>()
    for (const contrato of contratoConfigMap.values()) {
      if (!contrato.id) continue
      const contratoLabel = contrato.numero ? `${contrato.numero} - ${contrato.nome}` : contrato.nome
      for (const caso of contrato.casos || []) {
        if (!caso.id) continue
        caseToContrato.set(caso.id, contrato.id)
        if (optionsMap.has(caso.id)) continue
        const casoLabel = caso.numero ? `${caso.numero} - ${caso.nome}` : caso.nome
        optionsMap.set(caso.id, {
          value: caso.id,
          label: casoLabel,
          group: contratoLabel,
        })
      }
    }

    if (selectedItem?.casoId && selectedItem?.contratoId && !optionsMap.has(selectedItem.casoId)) {
      caseToContrato.set(selectedItem.casoId, selectedItem.contratoId)
      const casoLabel = selectedItem.casoNumero ? `${selectedItem.casoNumero} - ${selectedItem.casoNome}` : selectedItem.casoNome
      const contratoLabel = selectedItem.contratoNumero
        ? `${selectedItem.contratoNumero} - ${selectedItem.contratoNome}`
        : selectedItem.contratoNome
      optionsMap.set(selectedItem.casoId, {
        value: selectedItem.casoId,
        label: casoLabel || 'Caso atual',
        group: contratoLabel || 'Contrato atual',
      })
    }

    return {
      caseToContrato,
      options: Array.from(optionsMap.values()).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')),
    }
  }, [contratoConfigMap, selectedItem])
  const canManageReviewers = useMemo(
    () =>
      hasPermission('finance.faturamento.manage') ||
      hasPermission('finance.faturamento.*') ||
      hasPermission('finance.*') ||
      hasPermission('*'),
    [hasPermission],
  )
  const totalHorasIniciais = selectedTimesheetRows.reduce((acc, row) => acc + parseDecimalInput(row.horasIniciais), 0)
  const totalHorasRevisadas = selectedTimesheetRows.reduce((acc, row) => acc + parseDecimalInput(row.horasRevisadas), 0)
  const valorInicialTimesheet = selectedTimesheetRows.reduce(
    (acc, row) => acc + parseDecimalInput(row.horasIniciais) * parseDecimalInput(row.valorHoraInicial),
    0,
  )
  const valorSugerido = selectedTimesheetRows.reduce(
    (acc, row) => acc + parseDecimalInput(row.horasRevisadas) * parseDecimalInput(row.valorHora),
    0,
  )
  const valorOriginalRegras = selectedValueRows.reduce((acc, row) => acc + parseDecimalInput(row.valorOriginal), 0)
  const valorRevisadoRegras = selectedValueRows.reduce((acc, row) => acc + parseDecimalInput(row.valorRevisado), 0)
  const stageLines = useMemo<StageLine[]>(() => {
    if (!selectedItem) return []
    const itemLabel = formatItemLabel(selectedItem)
    const selectedCaseLabel = selectedItem.casoNumero ? `${selectedItem.casoNumero} - ${selectedItem.casoNome}` : selectedItem.casoNome
    const caseLabelMap = new Map(caseTransferMap.options.map((option) => [option.value, option.label] as const))
    const compact = (values: string[], fallback = '-') => {
      const unique = Array.from(
        new Set(
          values
            .map((value) => value.trim())
            .filter(Boolean),
        ),
      )
      if (unique.length === 0) return fallback
      if (unique.length === 1) return unique[0]
      return `${unique[0]} +${unique.length - 1}`
    }

    const timesheetCases = selectedTimesheetRows.map((row) => caseLabelMap.get(row.casoId) || selectedCaseLabel)
    const timesheetDates = selectedTimesheetRows.map((row) => (row.dataLancamento ? formatDate(row.dataLancamento) : ''))
    const timesheetDataInput = selectedTimesheetRows[0]?.dataLancamento || ''
    const timesheetDescriptions = selectedTimesheetRows.map((row) => row.atividade || '')
    const timesheetCaso = compact(timesheetCases, selectedCaseLabel || '-')
    const timesheetData = compact(timesheetDates, selectedItem.dataReferencia ? formatDate(selectedItem.dataReferencia) : '-')
    const timesheetDescricao = compact(timesheetDescriptions, selectedItem.timesheetDescricao || 'Sem descrição')
    const initialTimesheetDataInput =
      normalizeDateInput(asString(selectedItem.snapshot?.timesheet_data_lancamento_inicial)) ||
      selectedItem.timesheetDataLancamento ||
      timesheetDataInput
    const initialTimesheetData = initialTimesheetDataInput ? formatDate(initialTimesheetDataInput) : '-'
    const initialTimesheetDescricao =
      asString(selectedItem.snapshot?.timesheet_descricao_inicial) ||
      selectedItem.timesheetDescricao ||
      'Sem descrição'
    const reviewTimesheetDataInput = timesheetDataInput
    const reviewTimesheetData = timesheetData
    const reviewTimesheetDescricao = timesheetDescricao
    const approvalTimesheetDataInput =
      selectedItem.status === 'em_aprovacao'
        ? normalizeDateInput(selectedDraft?.aprovacaoDataInput || '') ||
          normalizeDateInput(asString(selectedItem.snapshot?.timesheet_aprovacao_data_lancamento)) ||
          reviewTimesheetDataInput
        : normalizeDateInput(asString(selectedItem.snapshot?.timesheet_aprovacao_data_lancamento)) || reviewTimesheetDataInput
    const approvalTimesheetData = approvalTimesheetDataInput ? formatDate(approvalTimesheetDataInput) : '-'
    const approvalTimesheetDescricao =
      selectedItem.status === 'em_aprovacao'
        ? (selectedDraft?.aprovacaoDescricao || '').trim() || asString(selectedItem.snapshot?.timesheet_aprovacao_descricao) || reviewTimesheetDescricao
        : asString(selectedItem.snapshot?.timesheet_aprovacao_descricao) || reviewTimesheetDescricao
    const draftTempoRaw = (selectedDraft?.horas || '').trim()
    const draftValorRaw = (selectedDraft?.valor || '').trim()

    const approvalHoursTimesheet =
      selectedItem.status === 'em_aprovacao'
        ? parseDecimalInput(selectedDraft?.horas || String(totalHorasRevisadas))
        : selectedItem.horasAprovadas
    const approvalValueTimesheet =
      selectedItem.status === 'em_aprovacao'
        ? parseDecimalInput(selectedDraft?.valor || String(valorSugerido))
        : selectedItem.valorAprovado
    const approvalValueRegra =
      selectedItem.status === 'em_aprovacao'
        ? parseDecimalInput(selectedDraft?.valor || String(valorRevisadoRegras))
        : selectedItem.valorAprovado
    const reviewTempoDisplay =
      selectedItem.status === 'em_revisao'
        ? draftTempoRaw === ''
          ? ''
          : hoursStringToMinutesDisplay(draftTempoRaw)
        : hoursNumberToMinutesDisplay(totalHorasRevisadas)
    const approvalTempoDisplay =
      selectedItem.status === 'em_aprovacao'
        ? draftTempoRaw === ''
          ? ''
          : hoursStringToMinutesDisplay(draftTempoRaw)
        : hoursNumberToMinutesDisplay(approvalHoursTimesheet)
    const reviewValueDisplay =
      selectedItem.status === 'em_revisao' && draftValorRaw !== '' ? parseDecimalInput(draftValorRaw) : valorSugerido
    const approvalValueDisplayTimesheet =
      selectedItem.status === 'em_aprovacao' && draftValorRaw !== ''
        ? parseDecimalInput(draftValorRaw)
        : approvalValueTimesheet
    const reviewValueDisplayRegra =
      selectedItem.status === 'em_revisao' && draftValorRaw !== '' ? parseDecimalInput(draftValorRaw) : valorRevisadoRegras
    const approvalValueDisplayRegra =
      selectedItem.status === 'em_aprovacao' && draftValorRaw !== ''
        ? parseDecimalInput(draftValorRaw)
        : approvalValueRegra
    const revisoresConfig = getRevisoresOrdenados(selectedItem)
    const aprovadoresConfig = getAprovadoresOrdenados(selectedItem)
    const revisores =
      revisoresConfig.length > 0
        ? revisoresConfig
        : [{ colaborador_id: '', ordem: 1, nome: '' }]
    const aprovadores =
      aprovadoresConfig.length > 0
        ? aprovadoresConfig
        : [{ colaborador_id: '', ordem: 1, nome: '' }]
    const reviewerOwnIndex = currentColaboradorId
      ? revisores.findIndex((entry) => entry.colaborador_id === currentColaboradorId)
      : -1
    const approverOwnIndex = currentColaboradorId
      ? aprovadores.findIndex((entry) => entry.colaborador_id === currentColaboradorId)
      : -1
    const reviewerCurrentIndex = Math.max(0, getRevisorAtualIndex(selectedItem, revisores))
    const approverCurrentIndex = Math.max(0, getAprovadorAtualIndex(selectedItem, aprovadores))
    const isLockedStatus = ['aprovado', 'faturado', 'cancelado'].includes(selectedItem.status)
    const colaboradorIdByNome = new Map<string, string>()
    for (const [id, nome] of colaboradorMap.entries()) {
      if (!nome || colaboradorIdByNome.has(nome)) continue
      colaboradorIdByNome.set(nome, id)
    }
    const responsavelAtualNome = getResponsavelAtualNome(selectedItem) || ''
    const responsavelAtualId = responsavelAtualNome ? colaboradorIdByNome.get(responsavelAtualNome) || null : null

    const isReviewLineCompleted = (index: number) => {
      if (selectedItem.status === 'em_revisao') return index < reviewerCurrentIndex
      return true
    }

    const isApprovalLineCompleted = (index: number) => {
      if (selectedItem.status === 'em_aprovacao') return index < approverCurrentIndex
      if (selectedItem.status === 'em_revisao') return false
      return true
    }

    const canViewReviewLine = (index: number) => {
      if (canManageReviewers) return true
      if (approverOwnIndex >= 0) return true
      if (reviewerOwnIndex >= 0) return index <= reviewerOwnIndex
      if (selectedItem.status === 'em_revisao') return index <= reviewerCurrentIndex
      return true
    }

    const canViewApprovalLine = (index: number) => {
      if (selectedItem.status === 'em_revisao') return false
      if (canManageReviewers) return true
      if (approverOwnIndex >= 0) return index <= approverOwnIndex
      if (reviewerOwnIndex >= 0) return false
      if (selectedItem.status === 'em_aprovacao') return index <= approverCurrentIndex
      return true
    }

    const canEditReviewLine = (index: number) => {
      if (isLockedStatus || selectedItem.status !== 'em_revisao') return false
      if (canManageReviewers && reviewerOwnIndex < 0) return index === reviewerCurrentIndex
      return reviewerOwnIndex >= 0 && index === reviewerOwnIndex
    }

    const canEditApprovalLine = (index: number) => {
      if (isLockedStatus || selectedItem.status !== 'em_aprovacao') return false
      if (canManageReviewers && approverOwnIndex < 0) return index === approverCurrentIndex
      return approverOwnIndex >= 0 && index === approverOwnIndex
    }

    const canEditResponsavel = (type: 'revisor' | 'aprovador', index: number, completed: boolean) =>
      canManageReviewers &&
      !isLockedStatus &&
      !completed &&
      (type === 'revisor' ? selectedItem.status === 'em_revisao' : selectedItem.status !== 'em_revisao')

    const resolveLineResponsavel = (
      type: 'revisor' | 'aprovador',
      idx: number,
      entry: { colaborador_id: string; ordem: number; nome: string },
    ) => {
      if (entry.colaborador_id || entry.nome) {
        const id = entry.colaborador_id || null
        const nome = entry.nome || (id ? colaboradorMap.get(id) || id : '-')
        return { id, nome }
      }
      const isCurrentLine =
        (type === 'revisor' && selectedItem.status === 'em_revisao' && idx === reviewerCurrentIndex) ||
        (type === 'aprovador' && selectedItem.status === 'em_aprovacao' && idx === approverCurrentIndex)
      if (isCurrentLine && responsavelAtualNome) {
        return { id: responsavelAtualId, nome: responsavelAtualNome }
      }
      return { id: null, nome: '-' }
    }

    const baseInitialLine: StageLine = {
      key: 'inicial',
      label: 'Lançamento original',
      stageType: 'inicial',
      stageOrder: null,
      item: itemLabel,
      caso: isTimesheetMode ? timesheetCaso : selectedCaseLabel || '-',
      responsavelId: null,
      responsavelNome: '-',
      responsavelEditable: false,
      completed: true,
      data: isTimesheetMode ? initialTimesheetData : '-',
      dataInput: isTimesheetMode ? initialTimesheetDataInput : '',
      descricao: isTimesheetMode ? initialTimesheetDescricao : '-',
      tempo: isTimesheetMode ? hoursNumberToMinutesDisplay(totalHorasIniciais) : '-',
      valor: isTimesheetMode ? valorInicialTimesheet : valorOriginalRegras,
      editable: false,
    }

    if (isTimesheetMode) {
      const reviewLines = revisores
        .map((entry, idx): StageLine | null => {
          if (!canViewReviewLine(idx)) return null
          const completed = isReviewLineCompleted(idx)
          const responsavel = resolveLineResponsavel('revisor', idx, entry)
          return {
            key: `revisao-${idx + 1}`,
            label: `Revisor ${idx + 1}`,
            stageType: 'revisor',
            stageOrder: idx + 1,
            item: 'Revisão',
            caso: timesheetCaso,
            responsavelId: responsavel.id,
            responsavelNome: responsavel.nome,
            responsavelEditable: canEditResponsavel('revisor', idx, completed),
            completed,
            data: reviewTimesheetData,
            dataInput: reviewTimesheetDataInput,
            descricao: reviewTimesheetDescricao,
            tempo: reviewTempoDisplay,
            valor: reviewValueDisplay,
            editable: canEditReviewLine(idx),
          }
        })
        .filter((line): line is StageLine => line !== null)

      const approvalLines = aprovadores
        .map((entry, idx): StageLine | null => {
          if (!canViewApprovalLine(idx)) return null
          const completed = isApprovalLineCompleted(idx)
          const responsavel = resolveLineResponsavel('aprovador', idx, entry)
          return {
            key: `aprovacao-${idx + 1}`,
            label: `Aprovador ${idx + 1}`,
            stageType: 'aprovador',
            stageOrder: idx + 1,
            item: 'Aprovação',
            caso: timesheetCaso,
            responsavelId: responsavel.id,
            responsavelNome: responsavel.nome,
            responsavelEditable: canEditResponsavel('aprovador', idx, completed),
            completed,
            data: approvalTimesheetData,
            dataInput: approvalTimesheetDataInput,
            descricao: approvalTimesheetDescricao,
            tempo: approvalTempoDisplay,
            valor: approvalValueDisplayTimesheet,
            editable: canEditApprovalLine(idx),
          }
        })
        .filter((line): line is StageLine => line !== null)

      return [baseInitialLine, ...reviewLines, ...approvalLines]
    }

    const regraDescricao = compact(
      selectedValueRows.map((row) => row.descricao || ''),
      getRuleTitle(selectedItem),
    )
    const regraDataInput = normalizeDateFromDisplay(selectedValueRows[0]?.referencia || selectedItem.dataReferencia || '')
    const regraData = compact(
      selectedValueRows.map((row) => formatDateDisplay(row.referencia || '')),
      selectedItem.dataReferencia ? formatDate(selectedItem.dataReferencia) : '-',
    )
    const initialRegraDataInput =
      normalizeDateFromDisplay(asString(selectedItem.snapshot?.referencia_inicial)) ||
      normalizeDateFromDisplay(selectedItem.dataReferencia || '') ||
      regraDataInput
    const initialRegraData = initialRegraDataInput ? formatDateDisplay(initialRegraDataInput) : '-'
    const initialRegraDescricao =
      asString(selectedItem.snapshot?.descricao_inicial) ||
      getRuleTitle(selectedItem)
    const reviewRegraDataInput = regraDataInput
    const reviewRegraData = regraData
    const reviewRegraDescricao = regraDescricao
    const approvalRegraDataInput =
      selectedItem.status === 'em_aprovacao'
        ? normalizeDateInput(selectedDraft?.aprovacaoDataInput || '') ||
          normalizeDateFromDisplay(asString(selectedItem.snapshot?.aprovacao_referencia)) ||
          reviewRegraDataInput
        : normalizeDateFromDisplay(asString(selectedItem.snapshot?.aprovacao_referencia)) || reviewRegraDataInput
    const approvalRegraData = approvalRegraDataInput ? formatDateDisplay(approvalRegraDataInput) : '-'
    const approvalRegraDescricao =
      selectedItem.status === 'em_aprovacao'
        ? (selectedDraft?.aprovacaoDescricao || '').trim() || asString(selectedItem.snapshot?.aprovacao_descricao) || reviewRegraDescricao
        : asString(selectedItem.snapshot?.aprovacao_descricao) || reviewRegraDescricao

    const reviewLines = revisores
      .map((entry, idx): StageLine | null => {
        if (!canViewReviewLine(idx)) return null
        const completed = isReviewLineCompleted(idx)
        const responsavel = resolveLineResponsavel('revisor', idx, entry)
        return {
          key: `revisao-${idx + 1}`,
          label: `Revisor ${idx + 1}`,
          stageType: 'revisor',
          stageOrder: idx + 1,
          item: 'Revisão',
          caso: selectedCaseLabel || '-',
          responsavelId: responsavel.id,
          responsavelNome: responsavel.nome,
          responsavelEditable: canEditResponsavel('revisor', idx, completed),
          completed,
          data: reviewRegraData,
          dataInput: reviewRegraDataInput,
          descricao: reviewRegraDescricao,
          tempo: '-',
          valor: reviewValueDisplayRegra,
          editable: canEditReviewLine(idx),
        }
      })
      .filter((line): line is StageLine => line !== null)

    const approvalLines = aprovadores
      .map((entry, idx): StageLine | null => {
        if (!canViewApprovalLine(idx)) return null
        const completed = isApprovalLineCompleted(idx)
        const responsavel = resolveLineResponsavel('aprovador', idx, entry)
        return {
          key: `aprovacao-${idx + 1}`,
          label: `Aprovador ${idx + 1}`,
          stageType: 'aprovador',
          stageOrder: idx + 1,
          item: 'Aprovação',
          caso: selectedCaseLabel || '-',
          responsavelId: responsavel.id,
          responsavelNome: responsavel.nome,
          responsavelEditable: canEditResponsavel('aprovador', idx, completed),
          completed,
          data: approvalRegraData,
          dataInput: approvalRegraDataInput,
          descricao: approvalRegraDescricao,
          tempo: '-',
          valor: approvalValueDisplayRegra,
          editable: canEditApprovalLine(idx),
        }
      })
      .filter((line): line is StageLine => line !== null)

    return [
      {
        ...baseInitialLine,
        caso: selectedCaseLabel || '-',
        data: initialRegraData,
        dataInput: initialRegraDataInput,
        descricao: initialRegraDescricao,
      },
      ...reviewLines,
      ...approvalLines,
    ]
  }, [
    canManageReviewers,
    caseTransferMap.options,
    colaboradorMap,
    currentColaboradorId,
    getAprovadorAtualIndex,
    getAprovadoresOrdenados,
    getRevisorAtualIndex,
    getRevisoresOrdenados,
    isTimesheetMode,
    selectedDraft,
    selectedItem,
    selectedTimesheetRows,
    selectedValueRows,
    totalHorasIniciais,
    valorInicialTimesheet,
    totalHorasRevisadas,
    valorSugerido,
    valorOriginalRegras,
    valorRevisadoRegras,
  ])

  useEffect(() => {
    if (!selectedItem) {
      setActiveStageLineKey(null)
      return
    }
    setActiveStageLineKey((current) => {
      if (current && stageLines.some((line) => line.key === current)) return current
      const firstEditable = stageLines.find((line) => line.editable)
      return firstEditable?.key || stageLines[0]?.key || null
    })
  }, [selectedItem, stageLines])

  const hasEditableStageLine = stageLines.some((line) => line.editable)
  const hasInvalidEditableTempo = useMemo(() => {
    if (!selectedItem || !isTimesheetMode) return false
    const editableTempoLine = stageLines.find((line) => line.editable && line.tempo !== '-')
    if (!editableTempoLine) return false
    const horasRaw = (selectedDraft?.horas || '').trim()
    if (!horasRaw) return true
    const horas = parseDecimalInput(horasRaw)
    return !Number.isFinite(horas) || horas <= 0
  }, [selectedDraft, selectedItem, isTimesheetMode, stageLines])

  const updateStageLineField = (
    line: StageLine,
    field: 'data' | 'descricao' | 'tempo' | 'valor',
    value: string,
  ) => {
    if (!selectedItem || !line.editable) return

    setDrafts((prev) => {
      const current = prev[selectedItem.id]
      if (!current) return prev

      if (isTimesheetMode) {
        if (selectedItem.status === 'em_aprovacao' && line.stageType === 'aprovador') {
          if (field === 'data') {
            return {
              ...prev,
              [selectedItem.id]: {
                ...current,
                aprovacaoDataInput: normalizeDateInput(value),
              },
            }
          }
          if (field === 'descricao') {
            return {
              ...prev,
              [selectedItem.id]: {
                ...current,
                aprovacaoDescricao: value,
              },
            }
          }
          if (field === 'tempo') {
            const minutos = sanitizeMinutesInput(value)
            return {
              ...prev,
              [selectedItem.id]: {
                ...current,
                horas: minutesToHoursString(minutos),
              },
            }
          }
          if (field === 'valor') {
            return {
              ...prev,
              [selectedItem.id]: {
                ...current,
                valor: value,
              },
            }
          }
        }

        const nextRows = (current.timesheetRows || []).map((row, idx) => {
          if (field === 'data') {
            return { ...row, dataLancamento: normalizeDateInput(value) }
          }
          if (field === 'descricao') {
            return { ...row, atividade: value }
          }
          if (field === 'tempo') {
            const minutos = sanitizeMinutesInput(value)
            const horas = minutesToHoursString(minutos)
            return idx === 0 ? { ...row, horasRevisadas: horas } : row
          }
          if (field === 'valor') {
            const totalHours = (current.timesheetRows || []).reduce(
              (acc, currentRow) => acc + parseDecimalInput(currentRow.horasRevisadas || currentRow.horasIniciais),
              0,
            )
            const valorHora = totalHours > 0 ? parseDecimalInput(value) / totalHours : 0
            return { ...row, valorHora: String(valorHora) }
          }
          return row
        })

        return {
          ...prev,
          [selectedItem.id]: {
            ...current,
            horas: field === 'tempo' ? minutesToHoursString(sanitizeMinutesInput(value)) : current.horas,
            valor: field === 'valor' ? value : current.valor,
            timesheetRows: nextRows,
          },
        }
      }

      const valueRows = current.valueRows || []
      if (field === 'valor' && selectedItem.status === 'em_aprovacao' && line.stageType === 'aprovador') {
        return {
          ...prev,
          [selectedItem.id]: {
            ...current,
            valor: value,
          },
        }
      }
      if (selectedItem.status === 'em_aprovacao' && line.stageType === 'aprovador') {
        if (field === 'data') {
          return {
            ...prev,
            [selectedItem.id]: {
              ...current,
              aprovacaoDataInput: normalizeDateInput(value),
            },
          }
        }
        if (field === 'descricao') {
          return {
            ...prev,
            [selectedItem.id]: {
              ...current,
              aprovacaoDescricao: value,
            },
          }
        }
      }
      const nextValueRows = valueRows.map((row, idx) => {
        if (idx !== 0) return row
        if (field === 'data') {
          return { ...row, referencia: normalizeDateInput(value) }
        }
        if (field === 'descricao') {
          return { ...row, descricao: value }
        }
        if (field === 'valor') {
          return { ...row, valorRevisado: value }
        }
        return row
      })

      return {
        ...prev,
        [selectedItem.id]: {
          ...current,
          valor: field === 'valor' ? value : current.valor,
          valueRows: nextValueRows,
        },
      }
    })
  }

  const clienteFilterOptions = useMemo<CommandSelectOption[]>(() => {
    const names = Array.from(new Set(items.map((item) => item.clienteNome).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'))
    return [{ value: '', label: 'Todos os clientes' }, ...names.map((name) => ({ value: name, label: name }))]
  }, [items])

  const contratoFilterOptions = useMemo<CommandSelectOption[]>(() => {
    const filtered = cliente ? items.filter((item) => item.clienteNome === cliente) : items
    const seen = new Set<string>()
    const options: CommandSelectOption[] = [{ value: '', label: 'Todos os contratos' }]
    for (const item of filtered) {
      const key = `${item.contratoNumero || ''}-${item.contratoNome}`
      if (seen.has(key)) continue
      seen.add(key)
      options.push({
        value: item.contratoNome,
        label: item.contratoNumero ? `${item.contratoNumero} - ${item.contratoNome}` : item.contratoNome,
        group: item.clienteNome,
      })
    }
    return options
  }, [items, cliente])

  const casoFilterOptions = useMemo<CommandSelectOption[]>(() => {
    let filtered = items
    if (cliente) filtered = filtered.filter((item) => item.clienteNome === cliente)
    if (contrato) filtered = filtered.filter((item) => item.contratoNome === contrato)
    const seen = new Set<string>()
    const options: CommandSelectOption[] = [{ value: '', label: 'Todos os casos' }]
    for (const item of filtered) {
      const key = `${item.casoNumero || ''}-${item.casoNome}`
      if (seen.has(key)) continue
      seen.add(key)
      options.push({
        value: item.casoNome,
        label: item.casoNumero ? `${item.casoNumero} - ${item.casoNome}` : item.casoNome,
        group: item.contratoNumero ? `${item.contratoNumero} - ${item.contratoNome}` : item.contratoNome,
      })
    }
    return options
  }, [items, cliente, contrato])

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
          <label className="text-sm font-medium">Cliente</label>
          <CommandSelect
            value={cliente}
            onValueChange={(value) => {
              setCliente(value)
              setContrato('')
              setCaso('')
            }}
            options={clienteFilterOptions}
            placeholder="Selecione o cliente"
            searchPlaceholder="Buscar cliente..."
            emptyText="Nenhum cliente encontrado."
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Contrato</label>
          <CommandSelect
            value={contrato}
            onValueChange={(value) => {
              setContrato(value)
              setCaso('')
            }}
            options={contratoFilterOptions}
            placeholder="Selecione o contrato"
            searchPlaceholder="Buscar contrato..."
            emptyText="Nenhum contrato encontrado."
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Caso</label>
          <CommandSelect
            value={caso}
            onValueChange={setCaso}
            options={casoFilterOptions}
            placeholder="Selecione o caso"
            searchPlaceholder="Buscar caso..."
            emptyText="Nenhum caso encontrado."
          />
        </div>
        <div className="flex items-end justify-end">
          <Button onClick={() => void loadItems()} disabled={loading}>
            {loading ? 'Atualizando...' : 'Aplicar filtros'}
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-md border bg-muted/30 p-3 text-sm">
        <div className="text-muted-foreground">
          <span className="mr-4">
            Itens: <strong className="text-foreground">{totals.itens}</strong>
          </span>
          <span>
            Horas: <strong className="text-foreground">{formatHours(totals.horas)}</strong>
          </span>
        </div>
        <div className="font-semibold">{formatMoney(totals.valor)}</div>
      </div>

      <div className="flex justify-end">
        <Button onClick={() => void loadItems()} disabled={loading}>
          {loading ? 'Atualizando...' : 'Atualizar lista'}
        </Button>
      </div>

      <div className="overflow-hidden rounded-md border bg-white">
        <Table className="w-full min-w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Cliente / Contrato / Caso</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Horas em aberto</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Itens</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Responsável atual</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">Valor em aberto</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Carregando revisão de fatura...
                </td>
              </tr>
            ) : tree.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Nenhum item em revisão encontrado para os filtros informados.
                </td>
              </tr>
            ) : (
              tree.map((clienteGroup) => {
                const clienteExpanded = expandedClientes[clienteGroup.key] ?? true
                const clienteItems = clienteGroup.contratos.flatMap((contratoGroup) => contratoGroup.casos.flatMap((casoGroup) => casoGroup.itens))
                const clienteSummary = summarizeStatusAndResponsavel(clienteItems)
                const clienteMetrics = clienteGroup.contratos.reduce(
                  (acc, contratoGroup) => {
                    const contratoMetrics = contratoGroup.casos.reduce(
                      (accContrato, casoGroup) => {
                        const caseMetrics = getCaseDisplayMetrics(casoGroup)
                        accContrato.horas += caseMetrics.totalHoras
                        accContrato.valor += caseMetrics.totalValor
                        accContrato.itens += caseMetrics.itemCount
                        return accContrato
                      },
                      { horas: 0, valor: 0, itens: 0 },
                    )
                    acc.horas += contratoMetrics.horas
                    acc.valor += contratoMetrics.valor
                    acc.itens += contratoMetrics.itens
                    return acc
                  },
                  { horas: 0, valor: 0, itens: 0 },
                )

                return (
                  <Fragment key={clienteGroup.key}>
                    <tr className="bg-muted/10">
                      <td className="px-4 py-3 font-semibold">
                        <button
                          className="inline-flex items-center gap-2"
                          onClick={() =>
                            setExpandedClientes((prev) => ({
                              ...prev,
                              [clienteGroup.key]: !clienteExpanded,
                            }))
                          }
                        >
                          {clienteExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          {clienteGroup.nome}
                        </button>
                      </td>
                      <td className="px-4 py-3">{formatHours(clienteMetrics.horas)}</td>
                      <td className="px-4 py-3">{clienteMetrics.itens}</td>
                      <td className="px-4 py-3">{clienteSummary.status}</td>
                      <td className="px-4 py-3">{clienteSummary.responsavel}</td>
                      <td className="px-4 py-3 text-right">{formatMoney(clienteMetrics.valor)}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end">
                          <Tooltip content="Revisar cliente">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => openClienteReviewModal(clienteGroup.key)}
                              disabled={clienteMetrics.itens <= 0}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                          </Tooltip>
                        </div>
                      </td>
                    </tr>

                    {clienteExpanded &&
                      clienteGroup.contratos.map((contratoGroup) => {
                        const contratoExpanded = expandedContratos[contratoGroup.key] ?? true
                        const contratoItems = contratoGroup.casos.flatMap((casoGroup) => casoGroup.itens)
                        const contratoSummary = summarizeStatusAndResponsavel(contratoItems)
                        const contratoMetrics = contratoGroup.casos.reduce(
                          (acc, casoGroup) => {
                            const caseMetrics = getCaseDisplayMetrics(casoGroup)
                            acc.horas += caseMetrics.totalHoras
                            acc.valor += caseMetrics.totalValor
                            acc.itens += caseMetrics.itemCount
                            return acc
                          },
                          { horas: 0, valor: 0, itens: 0 },
                        )

                        return (
                          <Fragment key={`${clienteGroup.key}-${contratoGroup.key}`}>
                            <tr>
                              <td className="px-4 py-3 pl-10">
                                <button
                                  className="inline-flex items-center gap-2"
                                  onClick={() =>
                                    setExpandedContratos((prev) => ({
                                      ...prev,
                                      [contratoGroup.key]: !contratoExpanded,
                                    }))
                                  }
                                >
                                  {contratoExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                  {contratoGroup.numero ? `${contratoGroup.numero} - ` : ''}
                                  {contratoGroup.nome}
                                </button>
                              </td>
                              <td className="px-4 py-3">{formatHours(contratoMetrics.horas)}</td>
                              <td className="px-4 py-3">{contratoMetrics.itens}</td>
                              <td className="px-4 py-3">{contratoSummary.status}</td>
                              <td className="px-4 py-3">{contratoSummary.responsavel}</td>
                              <td className="px-4 py-3 text-right">{formatMoney(contratoMetrics.valor)}</td>
                              <td className="px-4 py-3 text-right text-xs text-muted-foreground">-</td>
                            </tr>

                            {contratoExpanded &&
                              contratoGroup.casos.map((casoGroup) => {
                                const casoExpanded = expandedCasos[casoGroup.key] ?? true
                                const caseMetrics = getCaseDisplayMetrics(casoGroup)
                                const casoSummary = summarizeStatusAndResponsavel(casoGroup.itens)

                                return (
                                  <Fragment key={`${clienteGroup.key}-${contratoGroup.key}-${casoGroup.key}`}>
                                    <tr>
                                      <td className="px-4 py-3 pl-16 text-muted-foreground">
                                        <button
                                          className="inline-flex items-center gap-2"
                                          onClick={() =>
                                            setExpandedCasos((prev) => ({
                                              ...prev,
                                              [casoGroup.key]: !casoExpanded,
                                            }))
                                          }
                                        >
                                          {casoExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                          {casoGroup.numero ? `${casoGroup.numero} - ` : ''}
                                          {casoGroup.nome}
                                        </button>
                                      </td>
                                      <td className="px-4 py-3 text-muted-foreground">{formatHours(caseMetrics.totalHoras)}</td>
                                      <td className="px-4 py-3 text-muted-foreground">{caseMetrics.itemCount}</td>
                                      <td className="px-4 py-3 text-muted-foreground">{casoSummary.status}</td>
                                      <td className="px-4 py-3 text-muted-foreground">{casoSummary.responsavel}</td>
                                      <td className="px-4 py-3 text-right text-muted-foreground">{formatMoney(caseMetrics.totalValor)}</td>
                                      <td className="px-4 py-3 text-right text-xs text-muted-foreground">-</td>
                                    </tr>

                                    {casoExpanded &&
                                      (() => {
                                        const baseItem = caseMetrics.timesheetAnchorItem
                                        const timesheetBusy = casoGroup.itens
                                          .filter((entry) => entry.origemTipo === 'timesheet')
                                          .some(
                                          (entry) => savingItemId === entry.id || movingItemId === entry.id,
                                        )
                                        return (
                                          <>
                                            {caseMetrics.nonTimesheetItems.map((item) => {
                                              const busy = savingItemId === item.id || movingItemId === item.id
                                              const showActions = canShowReviewActions(item.status)

                                              return (
                                                <tr key={item.id} className="bg-muted/5">
                                                  <td className="px-4 py-3 pl-24 text-xs text-muted-foreground">
                                                    <div className="max-w-[460px] truncate">
                                                      {formatItemLabel(item)}
                                                      {item.timesheetDescricao ? ` • ${item.timesheetDescricao}` : ''}
                                                    </div>
                                                  </td>
                                                  <td className="px-4 py-3 text-xs">{formatHours(getEffectiveItemHours(item))}</td>
                                                  <td className="px-4 py-3 text-xs">1</td>
                                                  <td className="px-4 py-3 text-xs">{formatStatus(item.status)}</td>
                                                  <td className="px-4 py-3 text-xs">{getResponsavelAtualNome(item) || '-'}</td>
                                                  <td className="px-4 py-3 text-right text-xs">{formatMoney(getEffectiveItemValue(item))}</td>
                                                  <td className="px-4 py-3">
                                                    {showActions ? (
                                                      <div className="flex flex-wrap items-center justify-end gap-2">
                                                        {canManageReviewers ? (
                                                          <Tooltip content="Configurar revisores/aprovadores">
                                                            <Button
                                                              size="icon"
                                                              variant="ghost"
                                                              onClick={() => setSelectedContratoConfigId(item.contratoId || null)}
                                                              disabled={busy || !item.contratoId}
                                                            >
                                                              <Settings2 className="h-4 w-4" />
                                                            </Button>
                                                          </Tooltip>
                                                        ) : null}
                                                        <Tooltip content={item.status === 'em_aprovacao' ? 'Aprovar item' : 'Revisar item'}>
                                                          <Button
                                                            size="icon"
                                                            variant="ghost"
                                                            onClick={() => openReviewModal(item.id)}
                                                            disabled={busy}
                                                          >
                                                            {item.status === 'em_aprovacao' ? <Check className="h-4 w-4" /> : <SquarePen className="h-4 w-4" />}
                                                          </Button>
                                                        </Tooltip>
                                                      </div>
                                                    ) : (
                                                      <div className="text-right text-xs text-muted-foreground">-</div>
                                                    )}
                                                  </td>
                                                </tr>
                                              )
                                            })}

                                            {baseItem ? (
                                              <tr key={`synthetic-timesheet-${casoGroup.key}`} className="bg-muted/5">
                                                <td className="px-4 py-3 pl-24 text-xs text-muted-foreground">
                                                  <div className="max-w-[460px] truncate">Timesheet</div>
                                                </td>
                                                <td className="px-4 py-3 text-xs">{formatHours(caseMetrics.timesheetHours)}</td>
                                                <td className="px-4 py-3 text-xs">{caseMetrics.timesheetItemCount}</td>
                                                <td className="px-4 py-3 text-xs">{formatStatus(baseItem.status)}</td>
                                                <td className="px-4 py-3 text-xs">{getResponsavelAtualNome(baseItem) || '-'}</td>
                                                <td className="px-4 py-3 text-right text-xs">{formatMoney(caseMetrics.timesheetValue)}</td>
                                                <td className="px-4 py-3">
                                                  {canShowReviewActions(baseItem.status) ? (
                                                    <div className="flex flex-wrap items-center justify-end gap-2">
                                                      {canManageReviewers ? (
                                                        <Tooltip content="Configurar revisores/aprovadores">
                                                          <Button
                                                            size="icon"
                                                            variant="ghost"
                                                            onClick={() => setSelectedContratoConfigId(baseItem.contratoId || null)}
                                                            disabled={!baseItem.contratoId || timesheetBusy}
                                                          >
                                                            <Settings2 className="h-4 w-4" />
                                                          </Button>
                                                        </Tooltip>
                                                      ) : null}
                                                      <Tooltip content={baseItem.status === 'em_aprovacao' ? 'Aprovar timesheet' : 'Revisar timesheet'}>
                                                        <Button
                                                          size="icon"
                                                          variant="ghost"
                                                          onClick={() => openReviewModal(baseItem.id, 'timesheet')}
                                                          disabled={timesheetBusy}
                                                        >
                                                          {baseItem.status === 'em_aprovacao' ? <Check className="h-4 w-4" /> : <SquarePen className="h-4 w-4" />}
                                                        </Button>
                                                      </Tooltip>
                                                    </div>
                                                  ) : (
                                                    <div className="text-right text-xs text-muted-foreground">-</div>
                                                  )}
                                                </td>
                                              </tr>
                                            ) : null}
                                          </>
                                        )
                                      })()}
                                  </Fragment>
                                )
                              })}
                          </Fragment>
                        )
                      })}
                  </Fragment>
                )
              })
            )}
          </tbody>
        </Table>
      </div>

      <Dialog
        open={!!selectedClienteGroup}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedClienteKey(null)
            setSelectedClienteContractTab('')
            setSelectedClienteItemTab('')
            setSelectedItemId(null)
            setSelectedReviewMode('default')
            setEditingTimesheetItemId(null)
            setExpandedTimesheetRows({})
            setConfirmAdvanceAllOpen(false)
          }
        }}
      >
        <DialogContent className="w-[96vw] max-w-[1800px]">
          <DialogHeader>
            <DialogTitle>Revisão do cliente</DialogTitle>
            <DialogDescription>{selectedClienteGroup?.nome || ''}</DialogDescription>
          </DialogHeader>

          {selectedClienteGroup ? (
            <Tabs
              defaultValue={selectedClienteContracts[0]?.key || '__none__'}
              value={selectedClienteContractTab}
              onValueChange={(value) => {
                setSelectedClienteContractTab(value)
                const contract = selectedClienteContracts.find((entry) => entry.key === value)
                setSelectedClienteItemTab(contract?.items[0]?.key || '')
              }}
              className="space-y-4"
            >
              <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto">
                {selectedClienteContracts.map((contract) => (
                  <TabsTrigger key={contract.key} value={contract.key}>
                    {contract.label}
                  </TabsTrigger>
                ))}
              </TabsList>

              {selectedClienteContracts.map((contract) => (
                <TabsContent key={contract.key} value={contract.key} className="space-y-3">
                  {contract.items.length === 0 ? (
                    <div className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">
                      Nenhum item disponível para este contrato.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <Tabs
                        defaultValue={contract.items[0]?.key || '__none__'}
                        value={selectedClienteItemTab}
                        onValueChange={(value) => {
                          setSelectedClienteItemTab(value)
                          const nextTab = contract.items.find((entry) => entry.key === value)
                          if (nextTab) {
                            setSelectedItemId(nextTab.itemId)
                            setSelectedReviewMode(nextTab.mode)
                            setEditingTimesheetItemId(null)
                            setExpandedTimesheetRows({})
                          }
                        }}
                        className="space-y-3"
                      >
                        <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto">
                          {contract.items.map((itemTab) => (
                            <TabsTrigger key={itemTab.key} value={itemTab.key}>
                              {itemTab.label}
                            </TabsTrigger>
                          ))}
                        </TabsList>
                      </Tabs>
                    </div>
                  )}
                </TabsContent>
              ))}
            </Tabs>
          ) : null}

          {selectedClienteGroup && selectedItem && selectedDraft ? (
            <div className="space-y-4 border-t pt-3">
              <div className="flex items-center justify-end gap-2">
                {isTimesheetMode ? (
                  <Button
                    variant="outline"
                    onClick={() => addTimesheetRow(selectedItem.id)}
                    disabled={editDisabled || !hasEditableStageLine}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Adicionar timesheet
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    onClick={() => addValueRow(selectedItem.id)}
                    disabled={editDisabled || !hasEditableStageLine}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Adicionar item
                  </Button>
                )}
              </div>

              <StageLinesSummary
                lines={stageLines}
                activeLineKey={activeStageLineKey}
                disabled={editDisabled}
                responsavelOptions={colaboradorIdOptions}
                savingResponsavelLineKey={savingResponsavelLineKey}
                onActivateLine={setActiveStageLineKey}
                onUpdateLineField={updateStageLineField}
                onUpdateResponsavel={(line, responsavelId) => void updateStageLineResponsavel(line, responsavelId)}
              />

              <p className="text-xs text-muted-foreground">
                Clique na linha de <strong>Revisor/Aprovador</strong> para editar os dados e depois use o botão de avanço.
              </p>

              <div className="space-y-1">
                <label className="text-sm font-medium">Observação</label>
                <Textarea
                  value={selectedDraft.observacao}
                  onChange={(event) => updateDraft(selectedItem.id, { observacao: event.target.value })}
                  disabled={editDisabled || !hasEditableStageLine}
                  rows={3}
                />
              </div>
            </div>
          ) : null}

          <DialogFooter className="sticky bottom-0 z-30 -mx-6 border-t bg-white px-6 py-4 shadow-[0_-4px_12px_rgba(15,23,42,0.06)] sm:justify-between sm:space-x-0">
            <Button
              variant="outline"
              onClick={() => {
                setSelectedClienteKey(null)
                setSelectedClienteContractTab('')
                setSelectedClienteItemTab('')
                setSelectedItemId(null)
                setSelectedReviewMode('default')
                setEditingTimesheetItemId(null)
                setConfirmAdvanceAllOpen(false)
              }}
            >
              Fechar
            </Button>
            {selectedItem ? (
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => void handleReturnAction(selectedItem)}
                  disabled={modalBusy || !hasEditableStageLine || !canReturn(selectedItem.status)}
                >
                  <Undo2 className="mr-2 h-4 w-4" />
                  Retornar
                </Button>
                {canAdvance(selectedItem.status) ? (
                  <Button
                    onClick={() => setConfirmAdvanceAllOpen(true)}
                    disabled={
                      modalBusy || !hasEditableStageLine || hasInvalidEditableTempo || advancingAll || clienteAdvanceItems.length === 0
                    }
                    className="min-w-[240px] bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-primary/70 disabled:text-primary-foreground"
                  >
                    {advancingAll ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Enviar para próxima etapa (todos)
                  </Button>
                ) : null}
              </div>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmAdvanceAllOpen}
        onOpenChange={(open) => {
          if (!advancingAll) setConfirmAdvanceAllOpen(open)
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Confirmar avanço em massa</DialogTitle>
            <DialogDescription>
              Ao confirmar, todos os itens elegíveis deste cliente serão avançados para a próxima etapa.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border bg-muted/20 p-3 text-sm">
            Itens elegíveis para avanço: <strong>{clienteAdvanceItems.length}</strong>
          </div>
          <DialogFooter className="sticky bottom-0 z-30 -mx-6 border-t bg-white px-6 py-4 shadow-[0_-4px_12px_rgba(15,23,42,0.06)]">
            <Button variant="outline" onClick={() => setConfirmAdvanceAllOpen(false)} disabled={advancingAll}>
              Cancelar
            </Button>
            <Button onClick={() => void advanceAllClienteItems()} disabled={advancingAll || clienteAdvanceItems.length === 0}>
              {advancingAll ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Confirmar e avançar todos
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!selectedItem && !selectedClienteKey}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedItemId(null)
            setSelectedReviewMode('default')
            setEditingTimesheetItemId(null)
          }
        }}
      >
        <DialogContent className="w-[96vw] max-w-[1700px]">
          <DialogHeader>
            <DialogTitle>Revisar item de faturamento</DialogTitle>
            <DialogDescription>
              {selectedItem
                ? `${selectedItem.contratoNumero ? `${selectedItem.contratoNumero} - ` : ''}${selectedItem.contratoNome}`
                : ''}
            </DialogDescription>
          </DialogHeader>

          {selectedItem && selectedDraft ? (
            <div className="space-y-4">
              {isTimesheetMode ? (
                <>
                <div className="flex items-center justify-end">
                  <Button variant="outline" onClick={() => addTimesheetRow(selectedItem.id)} disabled={editDisabled || !hasEditableStageLine}>
                    <Plus className="mr-2 h-4 w-4" />
                    Adicionar timesheet
                  </Button>
                </div>

                <StageLinesSummary
                  lines={stageLines}
                  activeLineKey={activeStageLineKey}
                  disabled={editDisabled}
                  responsavelOptions={colaboradorIdOptions}
                  savingResponsavelLineKey={savingResponsavelLineKey}
                  onActivateLine={setActiveStageLineKey}
                  onUpdateLineField={updateStageLineField}
                  onUpdateResponsavel={(line, responsavelId) => void updateStageLineResponsavel(line, responsavelId)}
                />

                <p className="text-xs text-muted-foreground">
                  Clique na linha de <strong>Revisor/Aprovador</strong> para editar os dados e depois avançar.
                </p>
                </>
              ) : (
                <>
                <div className="flex items-center justify-end">
                  <Button variant="outline" onClick={() => addValueRow(selectedItem.id)} disabled={editDisabled || !hasEditableStageLine}>
                    <Plus className="mr-2 h-4 w-4" />
                    Adicionar item
                  </Button>
                </div>

                <StageLinesSummary
                  lines={stageLines}
                  activeLineKey={activeStageLineKey}
                  disabled={editDisabled}
                  responsavelOptions={colaboradorIdOptions}
                  savingResponsavelLineKey={savingResponsavelLineKey}
                  onActivateLine={setActiveStageLineKey}
                  onUpdateLineField={updateStageLineField}
                  onUpdateResponsavel={(line, responsavelId) => void updateStageLineResponsavel(line, responsavelId)}
                />

                <div className="space-y-1">
                  <label className="text-sm font-medium">Observação</label>
                  <Textarea
                    value={selectedDraft.observacao}
                    onChange={(event) => updateDraft(selectedItem.id, { observacao: event.target.value })}
                    disabled={editDisabled || !hasEditableStageLine}
                    rows={3}
                  />
                </div>
                </>
              )}
            </div>
          ) : null}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setSelectedItemId(null)
                setSelectedReviewMode('default')
                setEditingTimesheetItemId(null)
              }}
              disabled={modalBusy}
            >
              Fechar
            </Button>
            {selectedItem ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => void handleReturnAction(selectedItem)}
                  disabled={modalBusy || !hasEditableStageLine || !canReturn(selectedItem.status)}
                >
                  <Undo2 className="mr-2 h-4 w-4" />
                  Retornar
                </Button>
                {canAdvance(selectedItem.status) ? (
                  <Button
                    onClick={() => void saveAndAdvanceItem(selectedItem)}
                    disabled={modalBusy || !hasEditableStageLine || hasInvalidEditableTempo}
                  >
                    {movingItemId === selectedItem.id || savingItemId === selectedItem.id ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    {getAdvanceActionLabel(selectedItem)}
                  </Button>
                ) : null}
              </>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!selectedContratoConfig}
        onOpenChange={(open) => {
          if (!open && !savingContratoConfig) setSelectedContratoConfigId(null)
        }}
      >
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Revisores e aprovadores do contrato</DialogTitle>
            <DialogDescription>
              {selectedContratoConfig
                ? `${selectedContratoConfig.numero ? `${selectedContratoConfig.numero} - ` : ''}${selectedContratoConfig.nome}`
                : ''}
            </DialogDescription>
          </DialogHeader>

          {selectedContratoConfig ? (
            <div className="space-y-4">
              {selectedContratoConfig.casos.map((caso) => (
                <div key={caso.id} className="rounded-md border p-3">
                  <p className="mb-3 text-sm font-semibold">
                    {caso.numero ? `${caso.numero} - ` : ''}
                    {caso.nome}
                  </p>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold uppercase text-muted-foreground">Revisores</p>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            updateCasoFluxo(caso.id, 'revisores', (entries) => [
                              ...entries,
                              { colaborador_id: '', ordem: entries.length + 1 },
                            ])
                          }
                        >
                          <Plus className="mr-1 h-4 w-4" />
                          Adicionar
                        </Button>
                      </div>
                      {(caso.timesheetConfig.revisores || []).map((entry, idx) => (
                        <div key={`rev-${caso.id}-${idx}`} className="grid grid-cols-[96px_1fr_40px] items-center gap-2">
                          <Input
                            type="number"
                            min={1}
                            value={String(entry.ordem)}
                            onChange={(event) =>
                              updateCasoFluxo(caso.id, 'revisores', (entries) =>
                                entries.map((current, currentIdx) =>
                                  currentIdx === idx ? { ...current, ordem: asNumber(event.target.value, current.ordem) } : current,
                                ),
                              )
                            }
                          />
                          <CommandSelect
                            value={entry.colaborador_id}
                            onValueChange={(value) =>
                              updateCasoFluxo(caso.id, 'revisores', (entries) =>
                                entries.map((current, currentIdx) =>
                                  currentIdx === idx ? { ...current, colaborador_id: value } : current,
                                ),
                              )
                            }
                            options={colaboradorIdOptions}
                            placeholder="Selecione o colaborador"
                            searchPlaceholder="Buscar colaborador..."
                            emptyText="Nenhum colaborador encontrado."
                          />
                          <Tooltip content="Remover revisor">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() =>
                                updateCasoFluxo(caso.id, 'revisores', (entries) => entries.filter((_, currentIdx) => currentIdx !== idx))
                              }
                              disabled={(caso.timesheetConfig.revisores || []).length <= 1}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </Tooltip>
                        </div>
                      ))}
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold uppercase text-muted-foreground">Aprovadores</p>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            updateCasoFluxo(caso.id, 'aprovadores', (entries) => [
                              ...entries,
                              { colaborador_id: '', ordem: entries.length + 1 },
                            ])
                          }
                        >
                          <Plus className="mr-1 h-4 w-4" />
                          Adicionar
                        </Button>
                      </div>
                      {(caso.timesheetConfig.aprovadores || []).map((entry, idx) => (
                        <div key={`apr-${caso.id}-${idx}`} className="grid grid-cols-[96px_1fr_40px] items-center gap-2">
                          <Input
                            type="number"
                            min={1}
                            value={String(entry.ordem)}
                            onChange={(event) =>
                              updateCasoFluxo(caso.id, 'aprovadores', (entries) =>
                                entries.map((current, currentIdx) =>
                                  currentIdx === idx ? { ...current, ordem: asNumber(event.target.value, current.ordem) } : current,
                                ),
                              )
                            }
                          />
                          <CommandSelect
                            value={entry.colaborador_id}
                            onValueChange={(value) =>
                              updateCasoFluxo(caso.id, 'aprovadores', (entries) =>
                                entries.map((current, currentIdx) =>
                                  currentIdx === idx ? { ...current, colaborador_id: value } : current,
                                ),
                              )
                            }
                            options={colaboradorIdOptions}
                            placeholder="Selecione o colaborador"
                            searchPlaceholder="Buscar colaborador..."
                            emptyText="Nenhum colaborador encontrado."
                          />
                          <Tooltip content="Remover aprovador">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() =>
                                updateCasoFluxo(caso.id, 'aprovadores', (entries) => entries.filter((_, currentIdx) => currentIdx !== idx))
                              }
                              disabled={(caso.timesheetConfig.aprovadores || []).length <= 1}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </Tooltip>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedContratoConfigId(null)} disabled={savingContratoConfig}>
              Fechar
            </Button>
            <Button onClick={() => void saveContratoConfig()} disabled={savingContratoConfig}>
              {savingContratoConfig ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Salvar responsáveis
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
