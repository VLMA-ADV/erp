'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeftRight, Ban, ChevronDown, ChevronRight, Clock, DollarSign, Eye, EyeOff, FileText, Layers, Loader2, Receipt, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { CommandSelect, type CommandSelectOption } from '@/components/ui/command-select'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Table } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'
import { openTimesheetReport } from '@/lib/utils/timesheet-report'
import { formatHorasMin } from '@/lib/utils/format-horas'
import { formatContratoDisplay } from '@/lib/utils/contrato-display'
import NfsePreviewDialog from './nfse-preview-dialog'
import NotaDespesaPreview, { type NotaDespesaData } from './nota-despesa-preview'

// Nota já emitida (finance.billing_notes), usada para "Ver NF"/"Cancelar NF"
// na faixa do caso. Mesmo shape devolvido por get-notas-geradas.
interface NotaEmitida {
  id: string
  numero: number | null
  status: string
  tipo_documento: string
  arquivo_url: string | null
  contrato_id: string | null
}

interface RevisaoItem {
  id: string
  contratoId: string
  casoId: string
  timesheetId: string | null
  status: string
  grupoId: string | null
  grupoTexto: string | null
  grupoHoras: number | null
  grupoValor: number | null
  origemTipo: string
  casoRegraCobranca: string
  revisoresModo: string
  timesheetDescricaoOriginal: string
  valorHoraAtual: number
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
  responsavelRevisaoId: string | null
  responsavelRevisaoNome: string | null
  responsavelAprovacaoId: string | null
  responsavelAprovacaoNome: string | null
  enviadoPorId: string | null
  enviadoPorNome: string | null
  centroCustoNome: string | null
  enviadoPorFoto: string | null
  revisorFoto: string | null
  aprovadorFoto: string | null
  dataRevisao: string | null
  dataAprovacao: string | null
  timesheetDataLancamento: string
  timesheetHoras: number
  timesheetDescricao: string
  timesheetProfissional: string
  timesheetValorHora: number
  snapshot: Record<string, unknown>
  historico: RevisaoHistoricoEntry[]
}

interface CasoGroup {
  key: string
  nome: string
  numero: number | null
  itens: RevisaoItem[]
}

interface ClienteGroup {
  key: string
  nome: string
  casos: CasoGroup[]
}

interface ContratoOption {
  id: string
  numero?: number | null
  numero_sequencial?: number | null
  cliente_id?: string | null
  cliente_nome?: string | null
  nome_contrato?: string | null
  status?: string | null
  casos?: Array<{ id: string; numero?: number | null; nome: string }>
}

interface ColaboradorOption {
  id: string
  nome: string
}

interface TimesheetRowDraft {
  id: string
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

interface DraftFields {
  casoId: string
  profissional: string
  horas: string
  valor: string
  observacao: string
  etapaResponsavelId: string
  timesheetRows: TimesheetRowDraft[]
  valueRows: ValueRowDraft[]
}

interface CaseMetrics {
  totalHoras: number
  totalValor: number
  itemCount: number
  timesheetItems: RevisaoItem[]
  nonTimesheetItems: RevisaoItem[]
}

type ReviewMode = 'default' | 'timesheet'
type RuleFilterKey =
  | 'all'
  | 'hora'
  | 'mensalidade_processo'
  | 'mensalidade'
  | 'projeto'
  | 'projeto_parcelado'
  | 'exito'
  | 'despesa'
type HistoricoRole = 'USUARIO' | 'REVISOR' | 'APROVADOR'


interface RevisaoHistoricoEntry {
  id: string
  billingItemId: string
  role: HistoricoRole
  authorId: string
  authorName: string
  horas: number
  valor: number
  texto: string | null
  tenantId: string
  createdAt: string
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

function toObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function parseDecimalInput(value: string) {
  const normalized = value.replace(',', '.').trim()
  if (!normalized) return 0
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

function sanitizeMinutesInput(value: string) {
  return value.replace(/\D/g, '')
}

function minutesToHoursString(minutesInput: string) {
  const sanitized = sanitizeMinutesInput(minutesInput)
  if (!sanitized) return '0'
  const minutes = Number(sanitized)
  if (!Number.isFinite(minutes) || minutes < 0) return '0'
  const hours = minutes / 60
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
}

function hoursToMinutes(value: number | null | undefined) {
  return Math.max(0, Math.round(Number(value || 0) * 60))
}

function splitMinutosTotal(total: number | string | null | undefined) {
  const parsed = Number(total || 0)
  if (Number.isNaN(parsed) || parsed < 0) return { horas: '0', minutos: '0' }
  const inteiro = Math.floor(parsed)
  return { horas: String(Math.floor(inteiro / 60)), minutos: String(inteiro % 60) }
}

function computeMinutosFromHHMM(horas: string, minutos: string) {
  const h = Math.max(0, Math.floor(Number(horas || 0)))
  const mRaw = Math.max(0, Math.floor(Number(minutos || 0)))
  const m = Math.min(mRaw, 60)
  return h * 60 + m
}

function normalizeDateInput(value: string) {
  if (!value) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
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

function isoToDisplay(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '')
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
}

function displayToIso(display: string) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(display || '')
  return m ? `${m[3]}-${m[2]}-${m[1]}` : ''
}

function getNextBillingPeriodDate(item: RevisaoItem) {
  const reference = normalizeDateFromDisplay(item.dataReferencia || item.timesheetDataLancamento)
  const fallbackDate = new Date()
  const parsedReference = reference ? new Date(`${reference}T00:00:00`) : fallbackDate
  const baseDate = Number.isNaN(parsedReference.getTime()) ? fallbackDate : parsedReference
  return new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 1)
}

function formatDate(value: string) {
  if (!value) return '-'
  const normalized = normalizeDateFromDisplay(value)
  const [year, month, day] = normalized.split('-')
  if (!year || !month || !day) return value
  return `${day}/${month}/${year}`
}

function formatDateTime(value: string) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return formatDate(value)
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatMoney(value: number | null | undefined) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0))
}

// Toda hora exibida é "1h 20min" (pedido do cliente 01/08).
const formatHours = formatHorasMin

const formatHistoryHours = formatHorasMin

function getOriginalItemHours(item: RevisaoItem) {
  if (item.horasInformadas !== null && item.horasInformadas !== undefined) return item.horasInformadas
  if (item.timesheetHoras) return item.timesheetHoras
  return 0
}

function getOriginalItemValue(item: RevisaoItem) {
  if (item.valorInformado !== null && item.valorInformado !== undefined) return item.valorInformado
  if (item.origemTipo === 'timesheet') {
    return getOriginalItemHours(item) * item.timesheetValorHora
  }
  return 0
}

function areStageNumbersEqual(left: number | null | undefined, right: number | null | undefined) {
  if (left === null || left === undefined) return right === null || right === undefined
  if (right === null || right === undefined) return false
  return Number(left) === Number(right)
}




function isReviewQueueStatus(status: string) {
  return status === 'em_revisao' || status === 'em_aprovacao'
}

// Aprovado permanece visível (pedido do Douglas) até o "Enviar para faturamento".
// Faturado também permanece: a nota passa a ser emitida aqui mesmo (faixa do caso),
// então o caso não pode sumir no instante da emissão — fica com o badge "Faturado".
function isVisibleInReview(item: RevisaoItem) {
  if (isReviewQueueStatus(item.status)) return true
  if (item.status === 'faturado') return true
  if (item.status === 'aprovado') {
    const snapshot = (item.snapshot || {}) as Record<string, unknown>
    return snapshot.enviado_faturamento !== true
  }
  return false
}

function canAdvance(status: string) {
  return status === 'em_revisao' || status === 'em_aprovacao'
}

function getEffectiveItemHours(item: RevisaoItem) {
  if (item.status === 'em_aprovacao' && item.horasAprovadas !== null && item.horasAprovadas !== undefined) {
    return item.horasAprovadas
  }
  if (item.horasRevisadas !== null && item.horasRevisadas !== undefined) return item.horasRevisadas
  if (item.horasInformadas !== null && item.horasInformadas !== undefined) return item.horasInformadas
  return 0
}

function hojeIso() {
  return new Date().toISOString().slice(0, 10)
}

function getEffectiveItemValue(item: RevisaoItem) {
  if (item.status === 'em_aprovacao' && item.valorAprovado !== null && item.valorAprovado !== undefined) {
    return item.valorAprovado
  }
  if (item.valorRevisado !== null && item.valorRevisado !== undefined) return item.valorRevisado
  if (item.valorInformado !== null && item.valorInformado !== undefined) return item.valorInformado
  return 0
}

// Compara a etapa com a anterior para exibir a tag (Sem alterações / Alterado)
// e o resumo do que mudou — substitui o antigo texto tachado.
function getStageChanges(item: RevisaoItem, role: 'REVISOR' | 'APROVADOR') {
  const hist = item.historico || []
  const stage = [...hist].reverse().find((h) => h.role === role)
  const baseRole = role === 'REVISOR' ? 'USUARIO' : 'REVISOR'
  const base = [...hist].reverse().find((h) => h.role === baseRole) || hist.find((h) => h.role === 'USUARIO')
  const changes: string[] = []
  if (stage && base) {
    if (Number(stage.horas || 0) !== Number(base.horas || 0)) {
      changes.push(`${formatHistoryHours(base.horas)} \u2192 ${formatHistoryHours(stage.horas)}`)
    }
    if (Number(stage.valor || 0) !== Number(base.valor || 0)) {
      changes.push(`${formatMoney(base.valor)} \u2192 ${formatMoney(stage.valor)}`)
    }
    if ((stage.texto || '').trim() && (stage.texto || '').trim() !== (base.texto || '').trim()) {
      changes.push('texto editado')
    }
  }

  // O hist\u00f3rico guarda observa\u00e7\u00e3o \u2014 as edi\u00e7\u00f5es de atividade/profissional/data
  // vivem no snapshot (timesheet_itens_revisao). Sem isto, editar o texto n\u00e3o
  // gerava a tag "Alterado" nem aparecia na linha da revis\u00e3o (bug do cliente).
  let textoRevisado = (stage?.texto || '').trim()
  if (role === 'REVISOR' && (!stage || !base) && changes.length === 0) {
    const hi = Number(item.horasInformadas ?? 0)
    const hr = item.horasRevisadas
    if (hr !== null && hr !== undefined && Number(hr) !== hi) {
      changes.push(`${formatHistoryHours(hi)} → ${formatHistoryHours(Number(hr))}`)
    }
  }
  // Aprovação sem histórico completo (itens antigos ou sem entrada da etapa
  // anterior): compara aprovado × revisado direto do item.
  if (role === 'APROVADOR' && (!stage || !base) && changes.length === 0) {
    const hBase = item.horasRevisadas ?? item.horasInformadas
    if (item.horasAprovadas !== null && item.horasAprovadas !== undefined && hBase !== null && hBase !== undefined && Number(item.horasAprovadas) !== Number(hBase)) {
      changes.push(`${formatHistoryHours(Number(hBase))} → ${formatHistoryHours(Number(item.horasAprovadas))}`)
    }
    const vBase = item.valorRevisado ?? item.valorInformado
    if (item.valorAprovado !== null && item.valorAprovado !== undefined && vBase !== null && vBase !== undefined && Number(item.valorAprovado) !== Number(vBase)) {
      changes.push(`${formatMoney(Number(vBase))} → ${formatMoney(Number(item.valorAprovado))}`)
    }
  }
  if (role === 'REVISOR') {
    const snapshot = (item.snapshot || {}) as Record<string, unknown>
    const rows = Array.isArray(snapshot.timesheet_itens_revisao)
      ? (snapshot.timesheet_itens_revisao as Array<Record<string, unknown>>)
      : []
    const row = rows[0]
    if (row) {
      const atividade = String(row.atividade ?? '').trim()
      const original = String(
        snapshot.timesheet_descricao_original ?? snapshot.timesheet_descricao ?? item.timesheetDescricao ?? '',
      ).trim()
      if (atividade && original && atividade !== original) {
        if (!changes.includes('texto editado')) changes.push('texto editado')
        textoRevisado = atividade
      } else if (atividade) {
        textoRevisado = textoRevisado || atividade
      }
      const profissional = String(row.profissional ?? '').trim()
      const profOriginal = String(snapshot.timesheet_profissional ?? item.timesheetProfissional ?? '').trim()
      if (profissional && profOriginal && profissional !== profOriginal) {
        changes.push('profissional alterado')
      }
      const dataRevisada = String(row.data_lancamento ?? '').slice(0, 10)
      const dataOriginal = String(snapshot.timesheet_data_lancamento ?? item.timesheetDataLancamento ?? '').slice(0, 10)
      if (dataRevisada && dataOriginal && dataRevisada !== dataOriginal) {
        changes.push('data alterada')
      }
    }
  }

  if (!stage && changes.length === 0 && !textoRevisado) return null
  return { alterado: changes.length > 0, changes, quando: stage?.createdAt ?? null, texto: textoRevisado }
}

// Tag da etapa: cliente pediu só a sinalização (sem detalhar o diff — o
// histórico guarda os valores).
function StageTag({ alterado }: { alterado: boolean; changes?: string[] }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
        alterado ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
      }`}
    >
      {alterado ? 'Com alterações' : 'Sem alterações'}
    </span>
  )
}

// Avatar (foto ou iniciais) ao lado do nome nas etapas — pedido do cliente.
function PersonBadge({ nome, foto }: { nome: string; foto?: string | null }) {
  const iniciais = (nome || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte[0]?.toUpperCase() || '')
    .join('')
  return (
    <span className="inline-flex items-center gap-2">
      {foto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={foto} alt="" className="h-5 w-5 shrink-0 rounded-full object-cover" />
      ) : (
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-canvas-soft text-[9px] font-semibold text-ink-secondary">
          {iniciais || '?'}
        </span>
      )}
      <span>{nome}</span>
    </span>
  )
}

function getRuleKind(item: RevisaoItem) {
  return asString(item.snapshot?.regra_cobranca || '').trim().toLowerCase()
}

function getRuleTitle(item: RevisaoItem) {
  if (item.origemTipo === 'despesa') return 'Despesa'
  const kind = getRuleKind(item)
  if (kind === 'mensalidade_processo') return 'Mensalidade de processo'
  if (kind === 'mensal') return 'Mensalidade'
  if (kind === 'exito') return 'Exito'
  if (kind === 'pro_labore' || kind === 'pro_labore_parcelado') return 'Pró-labore'
  if (kind === 'projeto' || kind === 'projeto_parcelado') return 'Unico'
  if (kind === 'hora' || kind === 'hora_com_cap') return 'Horas'
  return item.regraNome || 'Regra financeira'
}

// Aba pela regra do caso: hora lançada em caso que não é hora pura
// cai na aba da regra (mensalidade de processo, projeto, êxito...).
function ruleKeyFromKind(kind: string): RuleFilterKey | null {
  if (kind === 'mensalidade_processo' || kind === 'salario_minimo') return 'mensalidade_processo'
  if (kind === 'mensal') return 'mensalidade'
  if (kind === 'projeto' || kind === 'pro_labore') return 'projeto'
  if (kind === 'projeto_parcela' || kind === 'projeto_parcelado' || kind === 'pro_labore_parcelado') return 'projeto_parcelado'
  if (kind === 'exito') return 'exito'
  return null
}

function getRuleFilterKey(item: RevisaoItem): RuleFilterKey | null {
  if (item.origemTipo === 'despesa') return 'despesa'
  const kind = getRuleKind(item)
  const casoKind = (item.casoRegraCobranca || '').trim().toLowerCase()
  if (item.origemTipo === 'timesheet') {
    const mapped = ruleKeyFromKind(casoKind)
    if (mapped) return mapped
    // aba Horas é exclusiva de casos que cobram por hora; sem regra => só em Todas
    return casoKind === 'hora' || casoKind === 'hora_com_cap' ? 'hora' : null
  }
  if (kind === 'hora' || kind === 'hora_com_cap') return 'hora'
  if (kind === 'mensalidade_processo') return 'mensalidade_processo'
  if (kind === 'mensal') return 'mensalidade'
  if (kind === 'projeto' || kind === 'pro_labore') return 'projeto'
  if (kind === 'projeto_parcela' || kind === 'projeto_parcelado' || kind === 'pro_labore_parcelado') return 'projeto_parcelado'
  if (kind === 'exito') return 'exito'
  return null
}

function getRuleFilterLabel(key: RuleFilterKey) {
  switch (key) {
    case 'all':
      return 'Todas'
    case 'hora':
      return 'Horas'
    case 'mensalidade_processo':
      return 'Mensalidade de processo'
    case 'mensalidade':
      return 'Mensalidade'
    case 'projeto':
      return 'Projeto'
    case 'projeto_parcelado':
      return 'Projeto parcelado'
    case 'exito':
      return 'Êxito'
    case 'despesa':
      return 'Despesas'
  }
}

function createDraftRowId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function parseSnapshotTimesheetRows(item: RevisaoItem): TimesheetRowDraft[] {
  const rawRows = Array.isArray(item.snapshot?.timesheet_itens_revisao) ? (item.snapshot.timesheet_itens_revisao as unknown[]) : []
  if (rawRows.length > 0) {
    return rawRows
      .map((entry) => {
        const row = toObject(entry)
        if (!row) return null
        return {
          id: asString(row.id) || createDraftRowId(),
          dataLancamento: normalizeDateInput(asString(row.data_lancamento)),
          profissional: asString(row.profissional),
          atividade: asString(row.atividade ?? row.descricao),
          horasIniciais: String(asNumber(row.horas_iniciais ?? row.horas_informadas ?? row.horas)),
          horasRevisadas: String(asNumber(row.horas_revisadas ?? row.horas ?? row.horas_iniciais)),
          valorHoraInicial: String(asNumber(row.valor_hora_inicial ?? row.valor_hora)),
          valorHora: String(asNumber(row.valor_hora)),
        }
      })
      .filter((row): row is TimesheetRowDraft => row !== null)
  }

  return [
    {
      id: item.timesheetId || createDraftRowId(),
      dataLancamento: item.timesheetDataLancamento,
      profissional: item.timesheetProfissional,
      atividade: item.timesheetDescricao,
      horasIniciais: String(item.timesheetHoras || item.horasInformadas || 0),
      horasRevisadas: String(item.horasRevisadas ?? item.timesheetHoras ?? item.horasInformadas ?? 0),
      valorHoraInicial: String(item.timesheetValorHora || 0),
      valorHora: String(item.timesheetValorHora || 0),
    },
  ]
}

function parseSnapshotValueRows(item: RevisaoItem): ValueRowDraft[] {
  const rawRows = Array.isArray(item.snapshot?.valor_itens_revisao) ? (item.snapshot.valor_itens_revisao as unknown[]) : []
  if (rawRows.length > 0) {
    return rawRows
      .map((entry) => {
        const row = toObject(entry)
        if (!row) return null
        return {
          id: asString(row.id) || createDraftRowId(),
          referencia: asString(row.referencia || row.data_referencia),
          descricao: asString(row.descricao),
          valorOriginal: String(asNumber(row.valor_original ?? row.valor_informado ?? row.valor)),
          valorRevisado: String(asNumber(row.valor_revisado ?? row.valor)),
        }
      })
      .filter((row): row is ValueRowDraft => row !== null)
  }

  return [
    {
      id: createDraftRowId(),
      referencia: item.dataReferencia || '',
      descricao: getRuleTitle(item),
      valorOriginal: String(item.valorInformado ?? 0),
      valorRevisado: String(getEffectiveItemValue(item)),
    },
  ]
}

function normalizeHistoricoRole(value: unknown): HistoricoRole | null {
  if (value === 'USUARIO' || value === 'REVISOR' || value === 'APROVADOR') return value
  return null
}

function normalizeHistorico(raw: unknown): RevisaoHistoricoEntry[] {
  if (!Array.isArray(raw)) return []

  return raw
    .map((entry, index) => {
      const row = toObject(entry)
      if (!row) return null

      const role = normalizeHistoricoRole(row.role)
      const billingItemId = asString(row.billing_item_id)
      const authorId = asString(row.author_id)
      const createdAt = asString(row.created_at)

      // get_revisao_fatura não inclui billing_item_id/tenant_id em cada entrada
      // do histórico — exigi-los descartava TODAS as entradas e a tag da
      // aprovação nunca detectava mudança de horas/valor (bug do cliente 20/07).
      if (!role || !createdAt) return null

      return {
        id: asString(row.id) || `${billingItemId}:${role}:${createdAt}:${index}`,
        billingItemId,
        role,
        authorId,
        authorName: asString(row.author_name, 'Usuário'),
        horas: asNumber(row.horas),
        valor: asNumber(row.valor),
        texto: asString(row.texto) || null,
        tenantId: asString(row.tenant_id),
        createdAt,
      }
    })
    .filter((entry): entry is RevisaoHistoricoEntry => entry !== null)
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
}

function normalizeItem(raw: unknown): RevisaoItem | null {
  if (!raw || typeof raw !== 'object') return null
  const data = raw as Record<string, unknown>
  const id = asString(pickFirstDefined(data.billing_item_id, data.item_id, data.id))
  if (!id) return null
  const snapshot = toObject(data.snapshot) || {}

  const normalized: RevisaoItem = {
    id,
    contratoId: asString(data.contrato_id),
    casoId: asString(data.caso_id),
    timesheetId: asString(data.timesheet_id) || null,
    status: asString(data.status, 'em_revisao'),
    grupoId: (() => { const g = asString(data.grupo_id); return g || null })(),
    grupoTexto: (() => { const t = asString(data.grupo_texto); return t || null })(),
    grupoHoras: asOptionalNumber(data.grupo_horas) ?? null,
    grupoValor: asOptionalNumber(data.grupo_valor) ?? null,
    origemTipo: asString(data.origem_tipo, ''),
    casoRegraCobranca: asString(pickFirstDefined(data.caso_regra_cobranca, snapshot.regra_cobranca), ''),
    revisoresModo: asString(data.revisores_modo, ''),
    timesheetDescricaoOriginal: asString(data.timesheet_descricao_original, ''),
    valorHoraAtual: asOptionalNumber(data.valor_hora_atual) ?? 0,
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
    responsavelFluxoNome: asString(pickFirstDefined(data.responsavel_fluxo_nome, snapshot.responsavel_fluxo_nome)) || null,
    responsavelRevisaoId: asString(pickFirstDefined(data.responsavel_revisao_id, snapshot.responsavel_revisao_id)) || null,
    responsavelRevisaoNome: asString(pickFirstDefined(data.responsavel_revisao_nome, snapshot.responsavel_revisao_nome)) || null,
    responsavelAprovacaoId: asString(pickFirstDefined(data.responsavel_aprovacao_id, snapshot.responsavel_aprovacao_id)) || null,
    responsavelAprovacaoNome: asString(pickFirstDefined(data.responsavel_aprovacao_nome, snapshot.responsavel_aprovacao_nome)) || null,
    enviadoPorId: asString(pickFirstDefined(data.enviado_por_id, snapshot.enviado_por_id)) || null,
    enviadoPorFoto: asString(data.enviado_por_foto) || null,
    revisorFoto: asString(data.revisor_foto) || null,
    aprovadorFoto: asString(data.aprovador_foto) || null,
    enviadoPorNome: asString(pickFirstDefined(data.enviado_por_nome, snapshot.enviado_por_nome)) || null,
    centroCustoNome: asString(data.centro_custo_nome) || null,
    dataRevisao: normalizeDateInput(asString(pickFirstDefined(data.data_revisao, snapshot.data_revisao))),
    dataAprovacao: normalizeDateInput(asString(pickFirstDefined(data.data_aprovacao, snapshot.data_aprovacao))),
    timesheetDataLancamento: normalizeDateInput(asString(data.timesheet_data_lancamento)),
    timesheetHoras: asNumber(pickFirstDefined(data.timesheet_horas, data.horas_informadas)),
    timesheetDescricao: asString(data.timesheet_descricao),
    timesheetProfissional: asString(data.timesheet_profissional),
    timesheetValorHora: asNumber(data.timesheet_valor_hora),
    snapshot,
    historico: normalizeHistorico(data.historico),
  }

  // Valor/hora VIGENTE da regra do caso: itens ainda pendentes refletem a
  // mudança feita na origem (bug do cliente: 'alterei o valor da hora na
  // regra financeira e não veio'). Aprovados/faturados ficam congelados.
  if (
    normalized.origemTipo === 'timesheet' &&
    (normalized.status === 'em_revisao' || normalized.status === 'em_aprovacao') &&
    normalized.valorHoraAtual > 0
  ) {
    normalized.timesheetValorHora = normalized.valorHoraAtual
    if (normalized.horasInformadas !== null && normalized.horasInformadas !== undefined) {
      normalized.valorInformado = Math.round(normalized.horasInformadas * normalized.valorHoraAtual * 100) / 100
    }
    if (normalized.horasRevisadas !== null && normalized.horasRevisadas !== undefined) {
      normalized.valorRevisado = Math.round(normalized.horasRevisadas * normalized.valorHoraAtual * 100) / 100
    }
  }

  return normalized
}

function buildTree(items: RevisaoItem[]): ClienteGroup[] {
  const clientes = new Map<string, ClienteGroup>()

  // agrupamento direto cliente -> caso (sem a camada de contrato, mock A-Tabela)
  for (const item of items) {
    const clienteKey = item.clienteNome || 'cliente'
    if (!clientes.has(clienteKey)) {
      clientes.set(clienteKey, {
        key: clienteKey,
        nome: item.clienteNome,
        casos: [],
      })
    }

    const cliente = clientes.get(clienteKey)
    if (!cliente) continue

    const casoKey = `${item.casoNumero || 'sem-numero'}-${item.casoNome}`
    let caso = cliente.casos.find((entry) => entry.key === casoKey)
    if (!caso) {
      caso = {
        key: casoKey,
        nome: item.casoNome,
        numero: item.casoNumero,
        itens: [],
      }
      cliente.casos.push(caso)
    }

    caso.itens.push(item)
  }

  // Ordem cronológica dentro do caso (Filipe, 02/09: "pra facilitar o processo").
  // Antes saía na ordem em que o banco gravou — que não é ordem nenhuma para
  // quem confere um mês.
  //
  // A data do TRABALHO manda: para hora é timesheetDataLancamento; regra
  // financeira não tem trabalho e cai em dataReferencia (dia 1º do mês), então
  // mensalidade e parcela ficam no topo do caso, antes das horas. Foi
  // confirmado com ele.
  //
  // Empate resolvido pelo número do item, para a ordem ser estável: sem isso,
  // dois lançamentos do mesmo dia trocariam de lugar a cada recarga.
  const dataDoItem = (i: RevisaoItem) =>
    (i.timesheetDataLancamento || i.dataReferencia || '').slice(0, 10)

  for (const cliente of clientes.values()) {
    for (const caso of cliente.casos) {
      caso.itens.sort((a, b) => {
        const da = dataDoItem(a)
        const db = dataDoItem(b)
        if (da !== db) return da < db ? -1 : 1
        // id é estável e único; serve de desempate para a ordem não dançar
        // entre recargas quando dois lançamentos são do mesmo dia.
        return a.id.localeCompare(b.id)
      })
    }
  }

  return Array.from(clientes.values())
}

// TODOS os lançamentos de timesheet do caso contam e aparecem — antes só o
// primeiro ([0]) era exibido/revisável e os demais ficavam invisíveis na grid.
function getCaseBaseMetrics(casoGroup: CasoGroup): CaseMetrics {
  const timesheetItems = casoGroup.itens.filter((item) => item.origemTipo === 'timesheet')
  const nonTimesheetItems = casoGroup.itens.filter((item) => item.origemTipo !== 'timesheet')

  // Item agrupado conta UMA vez, pelo que o revisor definiu no grupo — não pela
  // soma dos originais. O Filipe apontou isso em 07/08: ele alterou as horas do
  // grupo e o título do caso continuou somando as horas antigas.
  const gruposContados = new Set<string>()
  const somaHoras = (acc: number, item: RevisaoItem) => {
    if (item.grupoId) {
      if (gruposContados.has(`h:${item.grupoId}`)) return acc
      gruposContados.add(`h:${item.grupoId}`)
      if (item.grupoHoras !== null && item.grupoHoras !== undefined) return acc + item.grupoHoras
    }
    return acc + getEffectiveItemHours(item)
  }
  const somaValor = (acc: number, item: RevisaoItem) => {
    if (item.grupoId) {
      if (gruposContados.has(`v:${item.grupoId}`)) return acc
      gruposContados.add(`v:${item.grupoId}`)
      if (item.grupoValor !== null && item.grupoValor !== undefined) return acc + item.grupoValor
    }
    return acc + getEffectiveItemValue(item)
  }

  return {
    totalHoras: nonTimesheetItems.reduce(somaHoras, 0) + timesheetItems.reduce(somaHoras, 0),
    totalValor: nonTimesheetItems.reduce(somaValor, 0) + timesheetItems.reduce(somaValor, 0),
    itemCount: nonTimesheetItems.length + timesheetItems.length,
    timesheetItems,
    nonTimesheetItems,
  }
}

export default function RevisaoDeFaturaList() {
  const { success, error: toastError } = useToast()
  const { hasPermission } = usePermissionsContext()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cliente, setCliente] = useState('')
  // Filtros da barra superior (Filipe 07/08): cliente, centro de custo e
  // usuário. O de contrato saiu — na prática ninguém filtra por contrato aqui,
  // e ele ocupava o espaço dos dois que faltavam.
  const [centroCusto, setCentroCusto] = useState('')
  const [usuario, setUsuario] = useState('')
  const [caso, setCaso] = useState('')
  const [items, setItems] = useState<RevisaoItem[]>([])
  const [drafts, setDrafts] = useState<Record<string, DraftFields>>({})
  const [ruleFilter, setRuleFilter] = useState<RuleFilterKey>('all')
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([])
  // Grupos com os lancamentos originais visiveis. Fechado por padrao: o pedido
  // do Filipe e que o grupo apareca como UMA linha e os originais so quando
  // ele clicar no olho.
  const [gruposAbertos, setGruposAbertos] = useState<Record<string, boolean>>({})
  const [grupoDraft, setGrupoDraft] = useState<Record<string, { texto: string; horas: string }>>({})
  const [expandedClientes, setExpandedClientes] = useState<Record<string, boolean>>({})
  const [expandedCasos, setExpandedCasos] = useState<Record<string, boolean>>({})
  // Default: tudo recolhido (revisor abre o que interessa); botão alterna geral.
  const [allExpanded, setAllExpanded] = useState(false)
  const toggleAllExpanded = () => {
    setAllExpanded((prev) => !prev)
    setExpandedClientes({})
    setExpandedCasos({})
  }
  const [editorKey, setEditorKey] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [postergarConfirmId, setPostergarConfirmId] = useState<string | null>(null)
  const [postergarData, setPostergarData] = useState('')
  const [transferItemId, setTransferItemId] = useState<string | null>(null)
  const [transferClienteId, setTransferClienteId] = useState('')
  const [transferCasoId, setTransferCasoId] = useState('')
  // lote: postergar/ignorar/transferir vários de uma vez (feedback 15/07)
  const [postergarIds, setPostergarIds] = useState<string[]>([])
  const [transferIds, setTransferIds] = useState<string[]>([])
  const [ignorarIds, setIgnorarIds] = useState<string[]>([])
  const [ignorarMotivo, setIgnorarMotivo] = useState('')
  const [ignorarOutro, setIgnorarOutro] = useState('')
  const [allContratos, setAllContratos] = useState<ContratoOption[]>([])
  // NFS-e na faixa do caso: a emissão é por CONTRATO (com rateio por pagador), então
  // "Faturar" sempre passa pela prévia — é ela que mostra o que de fato vai na nota.
  // A previa/emissao carrega o CASO: a nota e por caso (Filipe, 03/09), e o
  // botao ja vivia na linha do caso desde 28/07 — so que emitia o contrato
  // inteiro sem avisar. Era o que o confundia.
  const [nfsePreview, setNfsePreview] = useState<{ contratoId: string; casoId?: string | null; label: string; permitirEmitir: boolean } | null>(null)
  const [emittingContratoId, setEmittingContratoId] = useState<string | null>(null)
  const [nfseResult, setNfseResult] = useState<{
    ref: string
    valor_total: number
    focus_status: string
    nota_id: string | null
  } | null>(null)
  // Só quem tem a capacidade finance.nfse.manage (sócios + Jessika) vê o botão de
  // faturar — esta tela é vista também por revisores/aprovadores/coordenadores.
  const [podeEmitirNfse, setPodeEmitirNfse] = useState(false)
  // Notas já emitidas, para mostrar "Ver NF"/"Cancelar NF" na faixa do caso.
  // A nota é emitida por contrato, então indexamos por contrato_id.
  const [notasPorContrato, setNotasPorContrato] = useState<Record<string, NotaEmitida[]>>({})
  const [cancelandoNotaId, setCancelandoNotaId] = useState<string | null>(null)
  // Nota de despesa (documento não-fiscal) do caso.
  const [notaDespesa, setNotaDespesa] = useState<NotaDespesaData | null>(null)
  const [showIndicadores, setShowIndicadores] = useState(false)
  const [indicadores, setIndicadores] = useState<{
    resumo: Record<string, unknown>
    por_cliente: Array<Record<string, unknown>>
  } | null>(null)
  const [indicadoresLoading, setIndicadoresLoading] = useState(false)

  const loadIndicadores = async () => {
    try {
      setIndicadoresLoading(true)
      const supabase = createClient()
      const { data, error: rpcError } = await supabase.rpc('get_indicadores_faturamento', {
        p_data_inicio: null,
        p_data_fim: null,
      })
      if (rpcError) {
        toastError(rpcError.message || 'Erro ao carregar indicadores')
        return
      }
      setIndicadores(data as { resumo: Record<string, unknown>; por_cliente: Array<Record<string, unknown>> })
    } finally {
      setIndicadoresLoading(false)
    }
  }
  const [colaboradores, setColaboradores] = useState<ColaboradorOption[]>([])

  const canRead =
    hasPermission('finance.faturamento.read') ||
    hasPermission('finance.faturamento.review') ||
    hasPermission('finance.faturamento.approve') ||
    hasPermission('finance.faturamento.manage')

  const getSessionToken = async () => {
    const supabase = createClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    return session?.access_token || null
  }

  const updateDraft = (itemId: string, patch: Partial<DraftFields>) => {
    setDrafts((prev) => ({
      ...prev,
      [itemId]: {
        casoId: prev[itemId]?.casoId || '',
        profissional: prev[itemId]?.profissional || '',
        horas: prev[itemId]?.horas || '0',
        valor: prev[itemId]?.valor || '0',
        observacao: prev[itemId]?.observacao || '',
        etapaResponsavelId: prev[itemId]?.etapaResponsavelId || '',
        timesheetRows: prev[itemId]?.timesheetRows || [],
        valueRows: prev[itemId]?.valueRows || [],
        ...patch,
      },
    }))
  }

  const loadItems = async (options?: { silent?: boolean }) => {
    try {
      if (!options?.silent) setLoading(true)
      setError(null)
      const accessToken = await getSessionToken()
      if (!accessToken) return

      const params = new URLSearchParams()
      if (cliente.trim()) params.set('cliente', cliente.trim())
      if (caso.trim()) params.set('caso', caso.trim())

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-revisao-fatura${params.toString() ? `?${params}` : ''}`,
        {
          method: 'GET',
          cache: 'no-store',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        },
      )

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(payload.error || 'Erro ao carregar revisão de fatura')
        setItems([])
        return
      }

      const parsed: RevisaoItem[] = Array.isArray(payload.data)
        ? payload.data
            .map((entry: unknown) => normalizeItem(entry))
            .filter((entry: RevisaoItem | null): entry is RevisaoItem => entry !== null && isVisibleInReview(entry))
        : []

      setItems(parsed)
      setSelectedItemIds((prev) => prev.filter((id) => parsed.some((item) => item.id === id)))

      const nextDrafts: Record<string, DraftFields> = {}
      for (const item of parsed) {
        const timesheetRows = parseSnapshotTimesheetRows(item)
        const valueRows = parseSnapshotValueRows(item)
        const totalHoras = timesheetRows.reduce((acc, row) => acc + parseDecimalInput(row.horasRevisadas || row.horasIniciais), 0)
        const totalValorTimesheet = timesheetRows.reduce(
          (acc, row) => acc + parseDecimalInput(row.horasRevisadas || row.horasIniciais) * parseDecimalInput(row.valorHora),
          0,
        )
        const totalValorRegras = valueRows.reduce((acc, row) => acc + parseDecimalInput(row.valorRevisado), 0)

        nextDrafts[item.id] = {
          casoId: item.casoId,
          profissional: item.timesheetProfissional || '',
          horas: String(item.origemTipo === 'timesheet' ? totalHoras : getEffectiveItemHours(item)),
          valor: String(item.origemTipo === 'timesheet' ? totalValorTimesheet : totalValorRegras || getEffectiveItemValue(item)),
          observacao: '',
          etapaResponsavelId: '',
          timesheetRows,
          valueRows,
        }
      }
      setDrafts(nextDrafts)
    } catch (loadError) {
      console.error(loadError)
      setError('Erro ao carregar revisão de fatura')
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  const loadAllContratos = async () => {
    try {
      const accessToken = await getSessionToken()
      if (!accessToken) return
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-contratos?_ts=${Date.now()}`,
        {
          method: 'GET',
          cache: 'no-store',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        },
      )
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) return
      const list = Array.isArray(payload.data) ? (payload.data as ContratoOption[]) : []
      setAllContratos(list)
    } catch (loadError) {
      console.error('loadAllContratos', loadError)
    }
  }

  const loadColaboradores = async () => {
    try {
      const accessToken = await getSessionToken()
      if (!accessToken) return
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/list-colaboradores?page=1&limit=500&_ts=${Date.now()}`,
        {
          method: 'GET',
          cache: 'no-store',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        },
      )
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) return
      const raw = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.colaboradores) ? payload.colaboradores : []
      const normalized: ColaboradorOption[] = raw
        .map((entry: any) => ({ id: asString(entry?.id), nome: asString(entry?.nome) }))
        .filter((entry: ColaboradorOption) => entry.id && entry.nome)
      setColaboradores(normalized)
    } catch (loadError) {
      console.error('loadColaboradores', loadError)
    }
  }

  // Capacidade de emitir NFS-e (sócios + Jessika). O edge já barra quem não tem;
  // aqui é só para não mostrar "Faturar" a quem tomaria 403 ao clicar.
  const loadPodeEmitirNfse = async () => {
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user?.id) return
      const { data } = await supabase.rpc('tem_capacidade_sensivel', {
        p_user_id: session.user.id,
        p_capacidade: 'finance.nfse.manage',
      })
      setPodeEmitirNfse(data === true)
    } catch (loadError) {
      console.error('loadPodeEmitirNfse', loadError)
    }
  }

  // Notas já emitidas, indexadas por contrato — alimenta "Ver NF"/"Cancelar NF"
  // na faixa do caso. Reusa a mesma fonte da tela "4. Notas geradas".
  const loadNotasEmitidas = async () => {
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const resp = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-notas-geradas?tipo_documento=nota_fiscal_servico&limit=200`,
        { headers: { Authorization: `Bearer ${session.access_token}` }, cache: 'no-store' },
      )
      if (!resp.ok) return
      const payload = await resp.json().catch(() => ({}))
      const lista = (payload?.data || []) as NotaEmitida[]
      const porContrato: Record<string, NotaEmitida[]> = {}
      for (const nota of lista) {
        if (!nota.contrato_id || nota.status === 'cancelado') continue
        if (!porContrato[nota.contrato_id]) porContrato[nota.contrato_id] = []
        porContrato[nota.contrato_id].push(nota)
      }
      setNotasPorContrato(porContrato)
    } catch (loadError) {
      console.error('loadNotasEmitidas', loadError)
    }
  }

  // Cancelamento da NFS-e — mesmo fluxo da tela "4. Notas geradas": exige
  // justificativa e avisa que, se autorizada, o cancelamento é fiscal.
  const cancelarNota = async (nota: NotaEmitida) => {
    const aviso = `Cancelar a NFS-e ${nota.numero ? `#${nota.numero}` : ''}?\n\nSe a nota já estiver autorizada, o cancelamento é fiscal e irreversível.\n\nInforme a justificativa:`
    const justificativa = window.prompt(aviso, '')
    if (justificativa === null) return
    try {
      setCancelandoNotaId(nota.id)
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { toastError('Sessão expirada — faça login novamente.'); return }
      const resp = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/cancelar-nfse`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ nota_id: nota.id, justificativa }),
      })
      const payload = await resp.json().catch(() => ({}))
      if (!resp.ok) { toastError(payload.error || 'Erro ao cancelar a nota'); return }
      // Boleto ja registrado no Itau nao some com a nota: precisa de baixa
      // no banco, senao o cliente pode pagar uma cobranca que nao existe mais.
      const boletos = Number(payload.itens_devolvidos?.boletos_registrados ?? 0)
      if (boletos > 0) {
        toastError(`NFS-e cancelada, mas ${boletos === 1 ? 'há um boleto registrado' : `há ${boletos} boletos registrados`} no Itaú sobre esta nota. Dê baixa no banco para o cliente não pagar.`)
      } else {
        success(payload.cancelado_na_prefeitura ? 'NFS-e cancelada na prefeitura.' : 'NFS-e cancelada.')
      }
      await loadNotasEmitidas()
      void loadItems({ silent: true })
    } catch (cancelError) {
      console.error('cancelarNota', cancelError)
      toastError('Erro ao cancelar a nota')
    } finally {
      setCancelandoNotaId(null)
    }
  }

  useEffect(() => {
    if (!canRead) return
    void loadItems()
    void loadAllContratos()
    void loadColaboradores()
    void loadPodeEmitirNfse()
    void loadNotasEmitidas()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead])

  // A grid reflete envios/revisões de outros usuários sem depender de F5:
  // refetch silencioso ao focar a janela + polling a cada 60s.
  const loadItemsRef = useRef<(options?: { silent?: boolean }) => Promise<void>>()
  loadItemsRef.current = loadItems
  useEffect(() => {
    if (!canRead) return
    const refresh = () => {
      if (document.visibilityState === 'visible') void loadItemsRef.current?.({ silent: true })
    }
    // Refetch imediato quando o "Gerar faturamento do mês" (no topo desta tela) roda.
    const onGerado = () => void loadItemsRef.current?.({ silent: true })
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('faturamento:gerado', onGerado)
    const interval = window.setInterval(refresh, 60_000)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('faturamento:gerado', onGerado)
      window.clearInterval(interval)
    }
  }, [canRead])

  const visibleItems = useMemo(() => {
    let base = ruleFilter === 'all' ? items : items.filter((item) => getRuleFilterKey(item) === ruleFilter)
    // Centro de custo e usuário filtram aqui, sem ida ao servidor: os dados já
    // estão na tela e a resposta é imediata.
    if (centroCusto) base = base.filter((item) => item.centroCustoNome === centroCusto)
    if (usuario) {
      base = base.filter((item) => (item.enviadoPorNome || item.timesheetProfissional) === usuario)
    }
    return base
  }, [items, ruleFilter, centroCusto, usuario])

  const statusSummary = useMemo(() => {
    const counts = { revisao: 0, aprovacao: 0, aprovado: 0, faturado: 0 }
    for (const item of visibleItems) {
      if (item.status === 'em_revisao') counts.revisao += 1
      else if (item.status === 'em_aprovacao') counts.aprovacao += 1
      else if (item.status === 'aprovado') counts.aprovado += 1
      else if (item.status === 'faturado') counts.faturado += 1
    }
    return counts
  }, [visibleItems])

  const tree = useMemo(() => buildTree(visibleItems), [visibleItems])
  const fullTree = useMemo(() => buildTree(items), [items])

  const clienteFilterOptions = useMemo<CommandSelectOption[]>(() => {
    const names = Array.from(new Set(items.map((item) => item.clienteNome).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'))
    return [{ value: '', label: 'Todos os clientes' }, ...names.map((name) => ({ value: name, label: name }))]
  }, [items])

  const centroCustoFilterOptions = useMemo<CommandSelectOption[]>(() => {
    const nomes = Array.from(new Set(items.map((item) => item.centroCustoNome).filter(Boolean) as string[]))
      .sort((a, b) => a.localeCompare(b, 'pt-BR'))
    return [{ value: '', label: 'Todos os centros de custo' }, ...nomes.map((n) => ({ value: n, label: n }))]
  }, [items])

  const usuarioFilterOptions = useMemo<CommandSelectOption[]>(() => {
    const nomes = Array.from(new Set(
      items.map((item) => item.enviadoPorNome || item.timesheetProfissional).filter(Boolean) as string[],
    )).sort((a, b) => a.localeCompare(b, 'pt-BR'))
    return [{ value: '', label: 'Todos os usuários' }, ...nomes.map((n) => ({ value: n, label: n }))]
  }, [items])

  const casoFilterOptions = useMemo<CommandSelectOption[]>(() => {
    let filtered = items
    if (cliente) filtered = filtered.filter((item) => item.clienteNome === cliente)
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
  }, [items, cliente])

  const caseOptions = useMemo<CommandSelectOption[]>(() => {
    const seen = new Set<string>()
    const options: CommandSelectOption[] = []

    for (const contrato of allContratos) {
      const contratoLabel = (() => {
        const numero = contrato.numero_sequencial ?? contrato.numero ?? null
        const nome = contrato.nome_contrato || 'Contrato sem nome'
        const cliente = contrato.cliente_nome ? ` — ${contrato.cliente_nome}` : ''
        return numero ? `${numero} - ${nome}${cliente}` : `${nome}${cliente}`
      })()
      for (const caso of contrato.casos || []) {
        if (!caso?.id || seen.has(caso.id)) continue
        seen.add(caso.id)
        options.push({
          value: caso.id,
          label: caso.numero ? `${caso.numero} - ${caso.nome}` : caso.nome,
          group: contratoLabel,
        })
      }
    }

    for (const item of items) {
      if (!item.casoId || seen.has(item.casoId)) continue
      seen.add(item.casoId)
      options.push({
        value: item.casoId,
        label: item.casoNumero ? `${item.casoNumero} - ${item.casoNome}` : item.casoNome,
        group: item.contratoNumero ? `${item.contratoNumero} - ${item.contratoNome}` : item.contratoNome,
      })
    }

    return options
  }, [allContratos, items])

  const caseLabelById = useMemo(() => new Map(caseOptions.map((option) => [option.value, option.label])), [caseOptions])

  const colaboradorOptions = useMemo<CommandSelectOption[]>(() => {
    const seen = new Set<string>()
    const options: CommandSelectOption[] = []
    for (const colaborador of colaboradores) {
      if (!colaborador.nome || seen.has(colaborador.nome)) continue
      seen.add(colaborador.nome)
      options.push({ value: colaborador.nome, label: colaborador.nome })
    }
    return options
  }, [colaboradores])

  const getLiveItemHours = useCallback((item: RevisaoItem, mode: ReviewMode) => {
    const draft = drafts[item.id]
    if (!draft) return getEffectiveItemHours(item)
    if (mode === 'timesheet') {
      return draft.timesheetRows.reduce((acc, row) => acc + parseDecimalInput(row.horasRevisadas || row.horasIniciais), 0)
    }
    return parseDecimalInput(draft.horas || String(getEffectiveItemHours(item)))
  }, [drafts])

  const getLiveItemValue = useCallback((item: RevisaoItem, mode: ReviewMode) => {
    const draft = drafts[item.id]
    if (!draft) return getEffectiveItemValue(item)
    if (mode === 'timesheet') {
      return draft.timesheetRows.reduce(
        (acc, row) => acc + parseDecimalInput(row.horasRevisadas || row.horasIniciais) * parseDecimalInput(row.valorHora),
        0,
      )
    }
    return draft.valueRows.length > 0
      ? draft.valueRows.reduce((acc, row) => acc + parseDecimalInput(row.valorRevisado), 0)
      : parseDecimalInput(draft.valor || String(getEffectiveItemValue(item)))
  }, [drafts])

  const getLiveCaseMetrics = useCallback((casoGroup: CasoGroup): CaseMetrics => {
    const baseMetrics = getCaseBaseMetrics(casoGroup)
    // Item agrupado conta UMA vez, pelo que o revisor definiu no grupo. O
    // Filipe apontou em 07/08: alterou as horas do grupo e o título do caso
    // continuou somando as horas antigas de cada lançamento.
    const grupoJaContado = new Set<string>()
    const horasDoItem = (item: RevisaoItem, modo: 'timesheet' | 'default') => {
      if (item.grupoId && item.grupoHoras !== null && item.grupoHoras !== undefined) {
        if (grupoJaContado.has(`h:${item.grupoId}`)) return 0
        grupoJaContado.add(`h:${item.grupoId}`)
        return item.grupoHoras
      }
      return getLiveItemHours(item, modo)
    }
    const valorDoItem = (item: RevisaoItem, modo: 'timesheet' | 'default') => {
      if (item.grupoId && item.grupoValor !== null && item.grupoValor !== undefined) {
        if (grupoJaContado.has(`v:${item.grupoId}`)) return 0
        grupoJaContado.add(`v:${item.grupoId}`)
        return item.grupoValor
      }
      return getLiveItemValue(item, modo)
    }

    const timesheetHours = baseMetrics.timesheetItems.reduce((acc, item) => acc + horasDoItem(item, 'timesheet'), 0)
    const timesheetValue = baseMetrics.timesheetItems.reduce((acc, item) => acc + valorDoItem(item, 'timesheet'), 0)
    const nonTimesheetHours = baseMetrics.nonTimesheetItems.reduce((acc, item) => acc + horasDoItem(item, 'default'), 0)
    const nonTimesheetValue = baseMetrics.nonTimesheetItems.reduce((acc, item) => acc + valorDoItem(item, 'default'), 0)

    return {
      totalHoras: nonTimesheetHours + timesheetHours,
      totalValor: nonTimesheetValue + timesheetValue,
      itemCount: baseMetrics.itemCount,
      timesheetItems: baseMetrics.timesheetItems,
      nonTimesheetItems: baseMetrics.nonTimesheetItems,
    }
  }, [getLiveItemHours, getLiveItemValue])

  const getReviewRows = useCallback((casoGroup: CasoGroup) => {
    const metrics = getLiveCaseMetrics(casoGroup)
    const rows: Array<{ item: RevisaoItem; mode: ReviewMode; key: string }> = []
    // Valor da regra primeiro (o que é cobrado); horas embaixo, para validação.
    for (const item of metrics.nonTimesheetItems) {
      rows.push({
        item,
        mode: 'default',
        key: `default:${item.id}`,
      })
    }
    // cada lançamento de hora enviado é um bloco revisável próprio
    for (const item of metrics.timesheetItems) {
      rows.push({
        item,
        mode: 'timesheet',
        key: `timesheet:${item.id}`,
      })
    }
    return rows
  }, [getLiveCaseMetrics])

  const allRows = useMemo(() => {
    const rows: Array<{ item: RevisaoItem; mode: ReviewMode; key: string }> = []
    for (const clienteGroup of fullTree) {
      for (const casoGroup of clienteGroup.casos) {
        rows.push(...getReviewRows(casoGroup))
      }
    }
    return rows
  }, [fullTree, getReviewRows])

  const ruleButtons = useMemo(() => {
    const counts = new Map<RuleFilterKey, number>()
    for (const row of allRows) {
      const key = getRuleFilterKey(row.item)
      if (!key) continue
      counts.set(key, (counts.get(key) || 0) + 1)
    }

    const orderedKeys: RuleFilterKey[] = [
      'hora',
      'mensalidade_processo',
      'mensalidade',
      'projeto',
      'projeto_parcelado',
      'exito',
      'despesa',
    ]
    return [
      { key: 'all' as RuleFilterKey, label: getRuleFilterLabel('all'), count: allRows.length },
      ...orderedKeys.map((key) => ({ key, label: getRuleFilterLabel(key), count: counts.get(key) || 0 })),
    ]
  }, [allRows])

  // Transferência em 2 passos (pedido do cliente): primeiro o CLIENTE, depois o caso dele.
  const transferClienteOptions = useMemo<CommandSelectOption[]>(() => {
    const map = new Map<string, string>()
    for (const contratoOption of allContratos) {
      const id = contratoOption.cliente_id || ''
      if (!id || map.has(id)) continue
      map.set(id, contratoOption.cliente_nome || contratoOption.nome_contrato || 'Cliente sem nome')
    }
    return Array.from(map.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))
  }, [allContratos])

  const transferCasoOptions = useMemo<CommandSelectOption[]>(() => {
    const options: CommandSelectOption[] = []
    for (const contratoOption of allContratos) {
      if (transferClienteId && contratoOption.cliente_id !== transferClienteId) continue
      for (const casoOption of contratoOption.casos || []) {
        options.push({
          value: casoOption.id,
          label: `${casoOption.numero ? `${casoOption.numero} - ` : ''}${casoOption.nome}${transferClienteId ? '' : ` · ${contratoOption.cliente_nome || contratoOption.nome_contrato || ''}`}`,
        })
      }
    }
    return options.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))
  }, [allContratos, transferClienteId])

  const totals = useMemo(() => {
    return tree.reduce(
      (acc, clienteGroup) => {
        for (const casoGroup of clienteGroup.casos) {
          const metrics = getLiveCaseMetrics(casoGroup)
          acc.horas += metrics.totalHoras
          acc.valor += metrics.totalValor
          acc.itens += metrics.itemCount
        }
        return acc
      },
      { horas: 0, valor: 0, itens: 0 },
    )
  }, [tree, getLiveCaseMetrics])


  const syncTimesheetRow = (itemId: string, rowId: string, patch: Partial<TimesheetRowDraft>) => {
    setDrafts((prev) => {
      const current = prev[itemId]
      if (!current) return prev
      const nextRows = current.timesheetRows.map((row) => (row.id === rowId ? { ...row, ...patch } : row))
      const totalHoras = nextRows.reduce((acc, row) => acc + parseDecimalInput(row.horasRevisadas || row.horasIniciais), 0)
      const totalValor = nextRows.reduce(
        (acc, row) => acc + parseDecimalInput(row.horasRevisadas || row.horasIniciais) * parseDecimalInput(row.valorHora),
        0,
      )
      return {
        ...prev,
        [itemId]: {
          ...current,
          horas: String(totalHoras),
          valor: String(totalValor),
          timesheetRows: nextRows,
        },
      }
    })
  }

  const syncValueRow = (itemId: string, rowId: string, patch: Partial<ValueRowDraft>) => {
    setDrafts((prev) => {
      const current = prev[itemId]
      if (!current) return prev
      const nextRows = current.valueRows.map((row) => (row.id === rowId ? { ...row, ...patch } : row))
      const totalValor = nextRows.reduce((acc, row) => acc + parseDecimalInput(row.valorRevisado), 0)
      return {
        ...prev,
        [itemId]: {
          ...current,
          valor: String(totalValor),
          valueRows: nextRows,
        },
      }
    })
  }

  const updateItemCase = async (itemId: string, casoId: string) => {
    const accessToken = await getSessionToken()
    if (!accessToken) return false

    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/update-faturamento-item`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: itemId,
        caso_id: casoId,
      }),
    })

    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      toastError(payload.error || 'Erro ao atualizar caso do item')
      return false
    }
    return true
  }

  const saveReviewItem = async (item: RevisaoItem, mode: ReviewMode) => {
    const draft = drafts[item.id]
    if (!draft) return false

    try {
      setBusyKey(`${mode}:${item.id}`)
      const accessToken = await getSessionToken()
      if (!accessToken) return false

      const body: Record<string, unknown> = {
        billing_item_id: item.id,
        observacao: draft.observacao || null,
        snapshot_patch:
          mode === 'timesheet'
            ? {
                timesheet_itens_revisao: draft.timesheetRows.map((row) => ({
                  id: row.id,
                  caso_id: draft.casoId || item.casoId,
                  contrato_id: item.contratoId,
                  data_lancamento: row.dataLancamento || null,
                  profissional: row.profissional || '',
                  atividade: row.atividade || '',
                  horas_iniciais: parseDecimalInput(row.horasIniciais),
                  horas_revisadas: parseDecimalInput(row.horasRevisadas || row.horasIniciais),
                  valor_hora_inicial: parseDecimalInput(row.valorHoraInicial),
                  valor_hora: parseDecimalInput(row.valorHora),
                })),
              }
            : {
                valor_itens_revisao: draft.valueRows.map((row) => ({
                  id: row.id,
                  referencia: normalizeDateFromDisplay(row.referencia || '') || null,
                  descricao: row.descricao || '',
                  valor_original: parseDecimalInput(row.valorOriginal),
                  valor_revisado: parseDecimalInput(row.valorRevisado),
                })),
                profissional_revisado: draft.profissional || '',
              },
      }

      if (draft.etapaResponsavelId) {
        body.novo_responsavel_colaborador_id = draft.etapaResponsavelId
      }

      const liveHours = getLiveItemHours(item, mode)
      const liveValue = getLiveItemValue(item, mode)
      // 'aprovado' também grava nos campos de aprovação: a edição completa da
      // etapa final (Jessika) altera o valor aprovado sem mudar de etapa.
      if (item.status === 'em_aprovacao' || item.status === 'aprovado') {
        body.horas_aprovadas = liveHours
        body.valor_aprovado = liveValue
      } else {
        body.horas_revisadas = liveHours
        body.valor_revisado = liveValue
      }

      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/update-revisao-fatura-item`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        toastError(payload.error || 'Erro ao salvar item da revisão')
        return false
      }

      if (draft.casoId && draft.casoId !== item.casoId) {
        const moved = await updateItemCase(item.id, draft.casoId)
        if (!moved) return false
      }

      success('Revisão salva com sucesso.')
      // atualização silenciosa: a tela não some/recarrega no meio da revisão
      void loadItems({ silent: true })
      return true
    } catch (saveError) {
      console.error(saveError)
      toastError('Erro ao salvar item da revisão')
      return false
    } finally {
      setBusyKey(null)
    }
  }

  const advanceItem = async (item: RevisaoItem) => {
    try {
      setBusyKey(`advance:${item.id}`)
      const accessToken = await getSessionToken()
      if (!accessToken) return false

      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/set-revisao-fatura-status`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          billing_item_id: item.id,
          action: 'avancar',
        }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        toastError(payload.error || 'Erro ao avançar item')
        return false
      }

      success('Item avançado com sucesso.')
      // avanço otimista: status muda na hora, refetch em silêncio por trás
      setItems((prev) =>
        prev.map((entry) =>
          entry.id === item.id
            ? { ...entry, status: entry.status === 'em_revisao' ? 'em_aprovacao' : 'aprovado' }
            : entry,
        ),
      )
      void loadItems({ silent: true })
      return true
    } catch (advanceError) {
      console.error(advanceError)
      toastError('Erro ao avançar item')
      return false
    } finally {
      setBusyKey(null)
    }
  }

  // Devolver para a etapa anterior (aprovação -> revisão / aprovado -> aprovação)
  const returnItem = async (item: RevisaoItem) => {
    try {
      setBusyKey(`return:${item.id}`)
      const accessToken = await getSessionToken()
      if (!accessToken) return false
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/set-revisao-fatura-status`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ billing_item_id: item.id, action: 'retornar' }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        toastError(payload.error || 'Erro ao devolver item')
        return false
      }
      success('Item devolvido para a etapa anterior.')
      setItems((prev) =>
        prev.map((entry) =>
          entry.id === item.id
            ? { ...entry, status: entry.status === 'em_aprovacao' ? 'em_revisao' : 'em_aprovacao' }
            : entry,
        ),
      )
      void loadItems({ silent: true })
      return true
    } catch (returnError) {
      console.error(returnError)
      toastError('Erro ao devolver item')
      return false
    } finally {
      setBusyKey(null)
    }
  }

  // Ignorar a fatura: zera a cobrança; o lançamento continua existindo e sai
  /**
   * Excluir: tira o item do faturamento como se não existisse. Diferente de
   * ignorar, que mantém o lançamento contado e só não cobra — são indicadores
   * diferentes (Filipe, 11/08).
   *
   * Não toca na origem: o timesheet da pessoa e a regra de cobrança ficam
   * intactos. As horas seguem contando para ela e para os relatórios.
   */
  const excluirItens = async (ids: string[]) => {
    if (ids.length === 0) return
    if (!window.confirm(
      `Excluir ${ids.length} lançamento(s) do faturamento?\n\n` +
      'O timesheet da pessoa e a regra de cobrança NÃO são apagados — sai só o item de cobrança.',
    )) return
    try {
      setBusyKey('excluir')
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { toastError('Sua sessão expirou. Entre novamente.'); return }
      const { data, error } = await supabase.rpc('excluir_billing_items', {
        p_user_id: session.user.id,
        p_ids: ids,
        p_motivo: null,
      })
      if (error) {
        toastError(error.message || 'Erro ao excluir lançamentos')
        return
      }
      const count = Number((data as { excluidos?: number })?.excluidos ?? 0)
      success(`${count} lançamento(s) excluído(s) do faturamento.`)
      setItems((prev) => prev.filter((entry) => !ids.includes(entry.id)))
      setSelectedItemIds((prev) => prev.filter((id) => !ids.includes(id)))
      void loadItems({ silent: true })
    } finally {
      setBusyKey(null)
    }
  }

  // da relação de cobrança. Justificativa obrigatória (auditoria da gestão).
  const ignorarItens = async () => {
    const motivo = ignorarMotivo === 'outro' ? ignorarOutro.trim() : ignorarMotivo
    if (!motivo) {
      toastError('Escolha a justificativa para ignorar.')
      return
    }
    try {
      setBusyKey('ignorar')
      const supabase = createClient()
      const { data, error } = await supabase.rpc('ignorar_billing_items', {
        p_ids: ignorarIds,
        p_motivo: motivo,
      })
      if (error) {
        toastError(error.message || 'Erro ao ignorar itens')
        return
      }
      const count = Number((data as { ignorados?: number })?.ignorados ?? 0)
      success(`${count} item(ns) ignorado(s) — fora da relação de cobrança.`)
      setItems((prev) => prev.filter((entry) => !ignorarIds.includes(entry.id)))
      setSelectedItemIds((prev) => prev.filter((id) => !ignorarIds.includes(id)))
      setIgnorarIds([])
      setIgnorarMotivo('')
      setIgnorarOutro('')
      void loadItems({ silent: true })
    } finally {
      setBusyKey(null)
    }
  }

  // Emite a NFS-e via edge emit-nfse. A emissão é por CONTRATO e já trata o rateio
  // (1 nota por pagador). Só é chamada a partir da prévia, para a pessoa ver antes o
  // que exatamente vai no documento fiscal.
  const emitNfse = async (contratoId: string, label: string, descricaoServico?: string, casoId?: string | null) => {
    try {
      setEmittingContratoId(contratoId)
      const accessToken = await getSessionToken()
      if (!accessToken) {
        toastError('Sessão expirada — faça login novamente.')
        return
      }
      const resp = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/emit-nfse`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contrato_id: contratoId,
          // Sem caso, a nota sai do contrato inteiro (comportamento antigo).
          ...(casoId ? { caso_id: casoId } : {}),
          ...(descricaoServico && descricaoServico.trim() ? { descricao_servico: descricaoServico } : {}),
        }),
      })
      const payload = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        toastError(payload.error || 'Focus NFe recusou a emissão')
        return
      }
      // Emissão parcial (rateio: alguma nota recusada) — HTTP 207.
      if (payload.partial) {
        toastError(payload.message || 'Emissão parcial — alguns pagadores foram recusados.')
        void loadItems({ silent: true })
        return
      }
      setNfseResult({
        ref: String(payload.ref),
        valor_total: Number(payload.valor_total),
        focus_status: String(payload.focus_status ?? 'pendente'),
        nota_id: payload.nota_id ?? null,
      })
      const nNotas = Number(payload.n_notas ?? 1)
      success(
        nNotas > 1
          ? `${nNotas} NFS-e enviadas (rateio) para ${label}. Status: ${payload.focus_status}`
          : `NFS-e enviada para Focus NFe (${label}). Status: ${payload.focus_status}`,
      )
      void loadItems({ silent: true })
      void loadNotasEmitidas()
    } catch (e) {
      console.error('emitNfse', e)
      toastError('Erro ao emitir NFS-e')
    } finally {
      setEmittingContratoId(null)
    }
  }

  // Postergar/transferir vários: reutilizam os diálogos com lista de ids.
  const postergarLote = async () => {
    const ids = postergarIds
    setPostergarIds([])
    let ok = 0
    for (const id of ids) {
      const item = items.find((entry) => entry.id === id)
      if (item?.timesheetId) {
        const done = await postergarItem(item, postergarData || undefined)
        if (done) ok += 1
      }
    }
    if (ok > 0) success(`${ok} lançamento(s) postergado(s).`)
  }

  const transferirLote = async () => {
    if (!transferCasoId) return
    const ids = transferIds
    setTransferIds([])
    let ok = 0
    try {
      setBusyKey('transferir-lote')
      for (const id of ids) {
        const moved = await updateItemCase(id, transferCasoId)
        if (moved) ok += 1
      }
      if (ok > 0) success(`${ok} item(ns) transferido(s) de caso.`)
      setTransferCasoId('')
      void loadItems({ silent: true })
    } finally {
      setBusyKey(null)
    }
  }

  // Transferir o item para outro caso (setas uma contra a outra do mock)
  const transferItem = async () => {
    const item = items.find((entry) => entry.id === transferItemId)
    if (!item || !transferCasoId) return
    try {
      setBusyKey(`transfer:${item.id}`)
      const moved = await updateItemCase(item.id, transferCasoId)
      if (moved) {
        success('Item transferido de caso.')
        setTransferItemId(null)
        setTransferCasoId('')
        void loadItems({ silent: true })
      }
    } finally {
      setBusyKey(null)
    }
  }

  const saveAndAdvance = async (item: RevisaoItem, mode: ReviewMode) => {
    const saved = await saveReviewItem(item, mode)
    if (!saved) return false
    return advanceItem(item)
  }

  // Agrupar: junta os lançamentos selecionados (mesmo caso) numa linha só.
  // O backend valida mesmo-caso e status; aqui só disparamos e recarregamos.
  const agruparSelecionados = async (scopeKey: string, itemIds: string[]) => {
    const uniqueIds = Array.from(new Set(itemIds))
    if (uniqueIds.length < 2) {
      toastError('Selecione ao menos dois lançamentos do mesmo caso para agrupar.')
      return
    }
    try {
      setBusyKey(scopeKey)
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { toastError('Sua sessão expirou. Entre novamente.'); return }
      const { error: rpcError } = await supabase.rpc('agrupar_billing_items', {
        p_user_id: session.user.id,
        p_item_ids: uniqueIds,
      })
      if (rpcError) { toastError(rpcError.message || 'Não foi possível agrupar.'); return }
      setSelectedItemIds((prev) => prev.filter((id) => !uniqueIds.includes(id)))
      success(`${uniqueIds.length} lançamentos agrupados.`)
      await loadItems()
    } finally {
      setBusyKey(null)
    }
  }

  // O revisor escreve o texto do grupo e, se quiser, arredonda as horas.
  const salvarGrupo = async (scopeKey: string, grupoId: string) => {
    const draft = grupoDraft[grupoId]
    if (!draft) return
    try {
      setBusyKey(scopeKey)
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { toastError('Sua sessão expirou. Entre novamente.'); return }
      const { error: rpcError } = await supabase.rpc('atualizar_grupo_billing_items', {
        p_user_id: session.user.id,
        p_grupo_id: grupoId,
        p_payload: { texto: draft.texto, horas: draft.horas },
      })
      if (rpcError) { toastError(rpcError.message || 'Não foi possível salvar o grupo.'); return }
      success('Grupo atualizado.')
      setGrupoDraft((prev) => { const next = { ...prev }; delete next[grupoId]; return next })
      await loadItems()
    } finally {
      setBusyKey(null)
    }
  }

  const desagrupar = async (scopeKey: string, grupoId: string) => {
    try {
      setBusyKey(scopeKey)
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { toastError('Sua sessão expirou. Entre novamente.'); return }
      const { error: rpcError } = await supabase.rpc('desagrupar_billing_items', {
        p_user_id: session.user.id,
        p_grupo_id: grupoId,
      })
      if (rpcError) { toastError(rpcError.message || 'Não foi possível desagrupar.'); return }
      success('Grupo desfeito.')
      await loadItems()
    } finally {
      setBusyKey(null)
    }
  }

  // "Revisar selecionados · OK": conclui a revisão sem alterações dos itens marcados.
  const reviewSelectedOk = async (scopeKey: string, itemIds: string[]) => {
    const uniqueIds = Array.from(new Set(itemIds))
    if (uniqueIds.length === 0) {
      toastError('Nenhum item selecionado para revisão.')
      return
    }
    let successCount = 0
    let failCount = 0
    try {
      setBusyKey(scopeKey)
      for (const itemId of uniqueIds) {
        const item = items.find((entry) => entry.id === itemId)
        if (!item || item.status !== 'em_revisao') {
          failCount += 1
          continue
        }
        const ok = await advanceItem(item)
        if (ok) successCount += 1
        else failCount += 1
      }
      setSelectedItemIds((prev) => prev.filter((id) => !uniqueIds.includes(id)))
      if (successCount > 0) success(`${successCount} item(ns) revisado(s) sem alterações.`)
      if (failCount > 0) toastError(`${failCount} item(ns) não puderam ser revisados.`)
    } finally {
      setBusyKey(null)
    }
  }

  const approveSelected = async (scopeKey: string, itemIds: string[]) => {
    const uniqueIds = Array.from(new Set(itemIds))
    if (uniqueIds.length === 0) {
      toastError('Nenhum item selecionado para aprovação em lote.')
      return
    }

    let successCount = 0
    let failCount = 0

    try {
      setBusyKey(scopeKey)
      for (const itemId of uniqueIds) {
        const item = items.find((entry) => entry.id === itemId)
        if (!item || item.status !== 'em_aprovacao') {
          failCount += 1
          continue
        }
        const mode: ReviewMode = item.origemTipo === 'timesheet' ? 'timesheet' : 'default'
        const ok = await saveAndAdvance(item, mode)
        if (ok) successCount += 1
        else failCount += 1
      }

      setSelectedItemIds((prev) => prev.filter((id) => !uniqueIds.includes(id)))

      if (successCount > 0) success(`${successCount} item(ns) aprovado(s) em lote.`)
      if (failCount > 0) toastError(`${failCount} item(ns) não puderam ser aprovados.`)
    } finally {
      setBusyKey(null)
    }
  }

  const postergarItem = async (item: RevisaoItem, targetDateIso?: string) => {
    try {
      setBusyKey(`postergar:${item.id}`)
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return false

      const proximoMes = targetDateIso ? new Date(`${targetDateIso}T12:00:00`) : getNextBillingPeriodDate(item)
      const periodoFaturamento = proximoMes.toISOString().slice(0, 10)

      // postergar_timesheet cancela o billing_item atual (este item, ja em
      // em_revisao) e grava o novo periodo — o item sai daqui e reaparece na
      // fila de "A liberar" do mes escolhido.
      const { error } = await supabase.rpc('postergar_timesheet', {
        p_user_id: user.id,
        p_timesheet_id: item.timesheetId,
        p_periodo: periodoFaturamento,
      })
      if (error) {
        toastError(error.message || 'Erro ao postergar item')
        return false
      }

      success(`Item postergado para ${proximoMes.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}.`)
      await loadItems()
      return true
    } catch (postergarError) {
      console.error(postergarError)
      toastError('Erro ao postergar item')
      return false
    } finally {
      setBusyKey(null)
    }
  }

  if (!canRead) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4">
        <p className="text-sm text-destructive">Você não tem permissão para visualizar a revisão de faturamento.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error ? (
        <Alert className="border border-destructive/30 bg-destructive/10 text-destructive">
          <AlertTitle>Atenção</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {/* Mesma barra da fase "aguardando liberação" (pedido Filipe 07/08): as
          duas telas usavam estilos diferentes para a mesma coisa. Os contadores
          ficam, porque tirar informação para igualar visual seria piorar. */}
      <Tabs value={ruleFilter} defaultValue="all" onValueChange={(value) => setRuleFilter(value as RuleFilterKey)}>
        <TabsList className="h-auto flex-wrap justify-start">
          {ruleButtons.map((button) => (
            <TabsTrigger key={button.key} value={button.key}>
              {button.label}
              <span className="ml-1.5 rounded-full bg-canvas-soft px-1.5 py-0.5 text-[11px] text-ink-mute">
                {button.count}
              </span>
            </TabsTrigger>
          ))}
          <button
            type="button"
            onClick={() => {
              setShowIndicadores((prev) => !prev)
              if (!indicadores) void loadIndicadores()
            }}
            className={`ml-2 inline-flex items-center rounded-md px-3 py-1.5 text-sm transition-colors ${
              showIndicadores ? 'bg-ink text-white' : 'text-ink-mute hover:text-ink-secondary'
            }`}
          >
            Indicadores
          </button>
        </TabsList>
      </Tabs>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="space-y-1">
          <label className="text-sm font-medium">Cliente</label>
          <CommandSelect
            value={cliente}
            onValueChange={(value) => {
              setCliente(value)
              setCaso('')
            }}
            options={clienteFilterOptions}
            placeholder="Selecione o cliente"
            searchPlaceholder="Buscar cliente..."
            emptyText="Nenhum cliente encontrado."
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Centro de custo</label>
          <CommandSelect
            value={centroCusto}
            onValueChange={setCentroCusto}
            options={centroCustoFilterOptions}
            placeholder="Selecione o centro de custo"
            searchPlaceholder="Buscar centro de custo..."
            emptyText="Nenhum centro de custo encontrado."
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Usuário</label>
          <CommandSelect
            value={usuario}
            onValueChange={setUsuario}
            options={usuarioFilterOptions}
            placeholder="Selecione o usuário"
            searchPlaceholder="Buscar usuário..."
            emptyText="Nenhum usuário encontrado."
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
          <span className="mr-4">
            Horas: <strong className="text-foreground">{formatHours(totals.horas)}</strong>
          </span>
          <span>
            {statusSummary.revisao} liberado(s) · {statusSummary.aprovacao} revisado(s) · {statusSummary.aprovado} aprovado(s)
            {statusSummary.faturado > 0 ? ` · ${statusSummary.faturado} faturado(s)` : null}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            className="rounded-full"
            disabled={visibleItems.length === 0}
            title={selectedItemIds.length > 0 ? `Gera a prévia dos ${selectedItemIds.length} lançamento(s) selecionado(s)` : 'Selecione lançamentos para gerar a prévia de um cliente/caso; sem seleção, sai tudo o que está na tela'}
            onClick={() => {
              // Pedido 21/07: com seleção, o relatório é a prévia de faturamento
              // apenas dos lançamentos selecionados (por cliente/caso).
              const base = selectedItemIds.length > 0
                ? visibleItems.filter((item) => selectedItemIds.includes(item.id))
                : visibleItems
              openTimesheetReport({
                titulo: selectedItemIds.length > 0
                  ? 'Prévia de faturamento — lançamentos selecionados'
                  : 'Relatório de timesheet — Revisão de fatura (etapa 2)',
                subtitulo: selectedItemIds.length > 0
                  ? `${base.length} lançamento(s) selecionado(s)`
                  : `${statusSummary.revisao} em revisão · ${statusSummary.aprovacao} em aprovação · ${statusSummary.aprovado} aprovado(s)`,
                mostrarValor: true,
                rows: base.map((item) => ({
                  data: item.timesheetDataLancamento ? formatDate(item.timesheetDataLancamento) : formatDate(item.dataReferencia || ''),
                  cliente: item.clienteNome || '',
                  caso: `${item.casoNumero || ''} - ${item.casoNome || ''}`,
                  profissional: item.enviadoPorNome || item.timesheetProfissional || '',
                  descricao: item.timesheetDescricaoOriginal || item.timesheetDescricao || item.regraNome || '',
                  horas: formatHistoryHours(getEffectiveItemHours(item)),
                  valor: getEffectiveItemValue(item),
                })),
              })
            }}
          >
            Gerar relatório{selectedItemIds.length > 0 ? ` (${selectedItemIds.length})` : ''}
          </Button>
          <Button variant="outline" size="sm" onClick={toggleAllExpanded}>
            {allExpanded ? 'Recolher tudo' : 'Expandir tudo'}
          </Button>
          <div className="font-semibold font-tabular">{formatMoney(totals.valor)}</div>
        </div>
      </div>

      {showIndicadores ? (
        <div className="space-y-4">
          {indicadoresLoading || !indicadores ? (
            <div className="rounded-xl border bg-white p-8 text-center text-sm text-muted-foreground">Carregando indicadores...</div>
          ) : (
            <>
              {(() => {
                const r = indicadores.resumo || {}
                const num = (v: unknown) => Number(v || 0)
                const lancadas = num(r.horas_lancadas)
                const enviadas = num(r.horas_enviadas)
                const revisadas = num(r.horas_revisadas)
                const aprovadas = num(r.horas_aprovadas)
                const ignoradas = num(r.horas_ignoradas)
                const pct = (parte: number, todo: number) => (todo > 0 ? `${Math.round((parte / todo) * 100)}%` : '—')
                const motivos = Array.isArray(r.ignorados_por_motivo) ? (r.ignorados_por_motivo as Array<Record<string, unknown>>) : []
                return (
                  <>
                    <div className="grid gap-3 md:grid-cols-5">
                      <div className="rounded-xl border bg-white p-4">
                        <p className="text-[11px] uppercase tracking-wide text-ink-mute">Horas lançadas (etapa 1)</p>
                        <p className="mt-1 text-xl font-semibold text-ink font-tabular">{formatHistoryHours(lancadas)}</p>
                        <p className="text-[11px] text-ink-mute">no período, por todos os usuários</p>
                      </div>
                      <div className="rounded-xl border bg-white p-4">
                        <p className="text-[11px] uppercase tracking-wide text-ink-mute">Enviadas p/ revisão</p>
                        <p className="mt-1 text-xl font-semibold text-ink font-tabular">{formatHistoryHours(enviadas)}</p>
                        <p className="text-[11px] text-ink-mute">{pct(enviadas, lancadas)} das lançadas</p>
                      </div>
                      <div className="rounded-xl border bg-white p-4">
                        <p className="text-[11px] uppercase tracking-wide text-ink-mute">Revisadas (etapa 2)</p>
                        <p className="mt-1 text-xl font-semibold text-ink font-tabular">{formatHistoryHours(revisadas)}</p>
                        <p className="text-[11px] text-ink-mute">{pct(revisadas, enviadas)} das enviadas</p>
                      </div>
                      <div className="rounded-xl border bg-white p-4">
                        <p className="text-[11px] uppercase tracking-wide text-ink-mute">Aprovadas (etapa 3)</p>
                        <p className="mt-1 text-xl font-semibold text-ink font-tabular">{formatHistoryHours(aprovadas)}</p>
                        <p className="text-[11px] text-ink-mute">{pct(aprovadas, revisadas)} das revisadas</p>
                      </div>
                      <div className="rounded-xl border bg-white p-4">
                        <p className="text-[11px] uppercase tracking-wide text-ink-mute">Ignoradas (cut)</p>
                        <p className="mt-1 text-xl font-semibold text-red-600 font-tabular">{formatHistoryHours(ignoradas)}</p>
                        <p className="text-[11px] text-ink-mute">
                          {num(r.itens_ignorados)} item(ns) · {formatMoney(num(r.valor_ignorado))}
                        </p>
                      </div>
                    </div>

                    {motivos.length > 0 ? (
                      <div className="rounded-xl border bg-white p-4">
                        <p className="mb-2 text-[11px] uppercase tracking-wide text-ink-mute">Ignoradas por justificativa</p>
                        <div className="flex flex-wrap gap-2">
                          {motivos.map((m, idx) => (
                            <span key={idx} className="rounded-full bg-red-50 px-2.5 py-1 text-xs text-red-700">
                              {String(m.motivo)} · {Number(m.quantidade || 0)} item(ns) · {formatHistoryHours(Number(m.horas || 0))}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div className="overflow-x-auto rounded-xl border bg-white">
                      <Table className="min-w-[820px]">
                        <thead>
                          <tr className="border-b text-[10px] uppercase tracking-wide text-ink-mute">
                            <th className="px-3 py-2 text-left">Cliente</th>
                            <th className="px-3 py-2 text-right">Casos</th>
                            <th className="px-3 py-2 text-right">Enviadas</th>
                            <th className="px-3 py-2 text-right">Revisadas</th>
                            <th className="px-3 py-2 text-right">Aprovadas</th>
                            <th className="px-3 py-2 text-right">Ignoradas</th>
                            <th className="px-3 py-2 text-right">Projeção</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(indicadores.por_cliente || []).map((linha, idx) => (
                            <tr key={idx} className="border-b text-xs">
                              <td className="px-3 py-2 text-ink">{String(linha.cliente)}</td>
                              <td className="px-3 py-2 text-right text-ink-secondary font-tabular">{Number(linha.casos || 0)}</td>
                              <td className="px-3 py-2 text-right text-ink-secondary font-tabular">{formatHistoryHours(Number(linha.horas_enviadas || 0))}</td>
                              <td className="px-3 py-2 text-right text-ink-secondary font-tabular">{formatHistoryHours(Number(linha.horas_revisadas || 0))}</td>
                              <td className="px-3 py-2 text-right text-ink-secondary font-tabular">{formatHistoryHours(Number(linha.horas_aprovadas || 0))}</td>
                              <td className="px-3 py-2 text-right font-tabular text-red-600">{formatHistoryHours(Number(linha.horas_ignoradas || 0))}</td>
                              <td className="px-3 py-2 text-right font-medium text-ink font-tabular">{formatMoney(Number(linha.projecao_valor || 0))}</td>
                            </tr>
                          ))}
                        </tbody>
                      </Table>
                    </div>
                  </>
                )
              })()}
            </>
          )}
        </div>
      ) : loading ? (
        <div className="rounded-xl border bg-white p-8 text-center text-sm text-muted-foreground">
          Carregando revisão de fatura...
        </div>
      ) : tree.length === 0 ? (
        <div className="rounded-xl border bg-white p-8 text-center text-sm text-muted-foreground">
          Nenhum item em revisão encontrado para os filtros informados.
        </div>
      ) : (
        <div className="space-y-5">
          {tree.map((clienteGroup) => {
            const clienteExpanded = expandedClientes[clienteGroup.key] ?? allExpanded
            const clienteTotals = clienteGroup.casos.reduce(
              (acc, casoGroup) => {
                const metrics = getLiveCaseMetrics(casoGroup)
                acc.horas += metrics.totalHoras
                acc.valor += metrics.totalValor
                acc.itens += metrics.itemCount
                return acc
              },
              { horas: 0, valor: 0, itens: 0 },
            )

            return (
              <section key={clienteGroup.key} className="overflow-hidden rounded-2xl border bg-white shadow-sm">
                <div className="border-b bg-canvas-soft px-4 py-3">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 text-left"
                    onClick={() => setExpandedClientes((prev) => ({ ...prev, [clienteGroup.key]: !clienteExpanded }))}
                  >
                    <div className="flex items-center gap-2">
                      {clienteExpanded ? <ChevronDown className="h-4 w-4 text-ink-mute" /> : <ChevronRight className="h-4 w-4 text-ink-mute" />}
                      <div>
                        <p className="text-sm font-semibold text-ink">{clienteGroup.nome}</p>
                        <p className="text-xs text-ink-mute">
                          {clienteTotals.itens} item(ns) · {formatHours(clienteTotals.horas)}
                        </p>
                      </div>
                    </div>
                    <p className="text-sm font-semibold text-ink font-tabular">{formatMoney(clienteTotals.valor)}</p>
                  </button>

                  {/* Relatório consolidado POR CONTRATO (Filipe, 20/08: "agrupar
                      o relatório de casos de um mesmo contrato num único boleto,
                      NF e relatório de horas").

                      A nota já era por contrato — vários casos do mesmo contrato
                      já saem numa nota só. O relatório é que continuava por caso:
                      a prévia mora na faixa do caso e sai um documento para cada
                      um. O cliente recebia uma nota e três relatórios.

                      Um botão por contrato, e não um só por cliente: cliente com
                      dois contratos recebe duas notas, então juntar tudo num
                      relatório só descasaria do documento fiscal. */}
                  <div className="flex flex-wrap gap-2 px-4 pb-3">
                    {Array.from(
                      clienteGroup.casos.reduce((mapa, casoGroup) => {
                        for (const item of casoGroup.itens) {
                          if (!item.contratoId) continue
                          if (!mapa.has(item.contratoId)) {
                            mapa.set(item.contratoId, {
                              label: formatContratoDisplay(item.contratoNumero, item.contratoNome).full,
                              casos: new Set<string>(),
                            })
                          }
                          mapa.get(item.contratoId)!.casos.add(casoGroup.key)
                        }
                        return mapa
                      }, new Map<string, { label: string; casos: Set<string> }>()),
                    ).map(([contratoId, info]) => {
                      const linhas = clienteGroup.casos
                        .filter((casoGroup) => info.casos.has(casoGroup.key))
                        .flatMap((casoGroup) =>
                          getReviewRows(casoGroup)
                            .map((row) => row.item)
                            .filter((it) => it.contratoId === contratoId)
                            // Uma linha por grupo: quando os lançamentos foram
                            // agrupados, é o texto do grupo que vai ao cliente.
                            .filter((it, _i, todos) =>
                              !it.grupoId || todos.find((o) => o.grupoId === it.grupoId)?.id === it.id,
                            ),
                        )
                      return (
                        <Button
                          key={contratoId}
                          size="sm"
                          variant="outline"
                          className="text-xs"
                          disabled={linhas.length === 0}
                          title={`Relatório de horas com os ${info.casos.size} caso(s) deste contrato num documento só`}
                          onClick={() =>
                            openTimesheetReport({
                              titulo: 'Relatório de horas do contrato',
                              subtitulo: `${clienteGroup.nome} · ${info.label} · ${info.casos.size} caso(s) · ${linhas.length} lançamento(s)`,
                              mostrarValor: true,
                              rows: linhas.map((it) => ({
                                data: it.timesheetDataLancamento
                                  ? formatDate(it.timesheetDataLancamento)
                                  : formatDate(it.dataReferencia || ''),
                                cliente: it.clienteNome || '',
                                caso: `${it.casoNumero || ''} - ${it.casoNome || ''}`,
                                profissional: it.enviadoPorNome || it.timesheetProfissional || '',
                                descricao:
                                  it.grupoTexto || it.timesheetDescricaoOriginal || it.timesheetDescricao || it.regraNome || '',
                                horas: formatHistoryHours(it.grupoHoras ?? getEffectiveItemHours(it)),
                                valor: it.grupoValor ?? getEffectiveItemValue(it),
                              })),
                            })
                          }
                        >
                          <Layers className="mr-1 h-3.5 w-3.5" />
                          Relatório do {info.label}
                        </Button>
                      )
                    })}
                  </div>
                </div>

                {clienteExpanded ? (
                  <div className="space-y-4 p-4">
                    {clienteGroup.casos.map((casoGroup) => {
                      const casoExpanded = expandedCasos[casoGroup.key] ?? allExpanded
                      const caseMetrics = getLiveCaseMetrics(casoGroup)
                      const reviewRows = getReviewRows(casoGroup)
                      // Agrupamento v2 (Filipe 06/08): o grupo vira UMA linha. O
                      // primeiro lancamento carrega o painel do grupo; os demais
                      // ficam escondidos ate clicarem no olho.
                      const liderDoGrupo = new Map<string, string>()
                      const tamanhoDoGrupo = new Map<string, number>()
                      for (const { item } of reviewRows) {
                        if (!item.grupoId) continue
                        if (!liderDoGrupo.has(item.grupoId)) liderDoGrupo.set(item.grupoId, item.id)
                        tamanhoDoGrupo.set(item.grupoId, (tamanhoDoGrupo.get(item.grupoId) || 0) + 1)
                      }
                      const caseRowIds = reviewRows.filter((row) => canAdvance(row.item.status) || row.item.status === 'aprovado').map((row) => row.item.id)
                      const allSelected = caseRowIds.length > 0 && caseRowIds.every((id) => selectedItemIds.includes(id))
                      const selectedIds = caseRowIds.filter((id) => selectedItemIds.includes(id))
                      const batchKey = `batch:${clienteGroup.key}:${casoGroup.key}`
                      // O CasoGroup não carrega o contrato; ele vem dos itens. A NFS-e é
                      // emitida por contrato, então é esse id que vai para a prévia/emissão.
                      const casoContratoId = casoGroup.itens[0]?.contratoId || ''
                      // Mesmo formato de contrato usado no resto do sistema.
                      const casoLabelNfse = formatContratoDisplay(
                        casoGroup.itens[0]?.contratoNumero,
                        casoGroup.itens[0]?.contratoNome,
                      ).full
                      // Despesas do caso alimentam a nota de despesa (não geram NFS-e).
                      const despesasDoCaso = casoGroup.itens.filter((item) => item.origemTipo === 'despesa')

                      return (
                        <div key={casoGroup.key} className="rounded-xl border border-hairline">
                          <div className="border-b bg-white px-4 py-3">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <button
                                type="button"
                                className="flex items-center gap-2 text-left"
                                onClick={() => setExpandedCasos((prev) => ({ ...prev, [casoGroup.key]: !casoExpanded }))}
                              >
                                {casoExpanded ? <ChevronDown className="h-4 w-4 text-ink-mute" /> : <ChevronRight className="h-4 w-4 text-ink-mute" />}
                                <div>
                                  <p className="text-sm font-semibold text-ink">
                                    {casoGroup.numero ? `${casoGroup.numero} - ` : ''}
                                    {casoGroup.nome}
                                  </p>
                                  <p className="text-xs text-ink-mute">
                                    {caseMetrics.itemCount} item(ns) · {formatHours(caseMetrics.totalHoras)}
                                  </p>
                                </div>
                              </button>

                              <div className="flex flex-wrap items-center gap-3">
                                <label className="flex items-center gap-2 text-xs text-ink-mute">
                                  <input
                                    type="checkbox"
                                    className="h-4 w-4 rounded border-hairline"
                                    checked={allSelected}
                                    onChange={(event) => {
                                      const checked = event.target.checked
                                      setSelectedItemIds((prev) =>
                                        checked
                                          ? Array.from(new Set([...prev, ...caseRowIds]))
                                          : prev.filter((id) => !caseRowIds.includes(id)),
                                      )
                                    }}
                                  />
                                  Selecionar todos
                                </label>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => void reviewSelectedOk(batchKey, selectedIds)}
                                  disabled={selectedIds.length === 0 || busyKey === batchKey}
                                  title={selectedIds.length === 0 ? 'Selecione os lançamentos que quer marcar como revisados' : undefined}
                                >
                                  {busyKey === batchKey ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                  Revisar selecionados · OK
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-xs"
                                  onClick={() => void approveSelected(batchKey, selectedIds)}
                                  disabled={selectedIds.length === 0 || busyKey === batchKey}
                                  title={selectedIds.length === 0 ? 'Selecione os lançamentos que quer aprovar' : undefined}
                                >
                                  Aprovar selecionados
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-xs"
                                  title={selectedIds.length < 2
                                    ? 'Selecione ao menos dois lançamentos deste caso para agrupar'
                                    : 'Junta os lançamentos selecionados (mesmo caso) numa linha só na fatura'}
                                  onClick={() => void agruparSelecionados(batchKey, selectedIds)}
                                  disabled={selectedIds.length < 2 || busyKey === batchKey}
                                >
                                  <Layers className="mr-1 h-3.5 w-3.5" /> Agrupar
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-xs"
                                  onClick={() => {
                                    const base = new Date()
                                    base.setMonth(base.getMonth() + 1)
                                    base.setDate(1)
                                    setPostergarData(base.toISOString().slice(0, 10))
                                    setPostergarIds(selectedIds)
                                  }}
                                  disabled={selectedIds.length === 0 || busyKey === batchKey}
                                  title={selectedIds.length === 0 ? 'Selecione os lançamentos que quer adiar' : undefined}
                                >
                                  <Clock className="mr-1 h-3.5 w-3.5" /> Postergar
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-xs"
                                  onClick={() => {
                                    setTransferCasoId('')
                                    setTransferIds(selectedIds)
                                  }}
                                  disabled={selectedIds.length === 0 || busyKey === batchKey}
                                  title={selectedIds.length === 0 ? 'Selecione os lançamentos que quer mover de caso' : undefined}
                                >
                                  <ArrowLeftRight className="mr-1 h-3.5 w-3.5" /> Transferir
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-xs text-destructive"
                                  onClick={() => {
                                    setIgnorarMotivo('')
                                    setIgnorarOutro('')
                                    setIgnorarIds(selectedIds)
                                  }}
                                  disabled={selectedIds.length === 0 || busyKey === batchKey}
                                  title={selectedIds.length === 0 ? 'Selecione os lançamentos que quer tirar da cobrança' : undefined}
                                >
                                  Ignorar
                                </Button>
                                {/* Excluir fica ao lado de Ignorar porque a duvida do usuario
                                    e sempre "qual dos dois?" — o title explica a diferenca. */}
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-xs text-destructive"
                                  onClick={() => void excluirItens(selectedIds)}
                                  disabled={selectedIds.length === 0 || busyKey === 'excluir'}
                                  title={selectedIds.length === 0
                                    ? 'Selecione os lançamentos que quer apagar do faturamento'
                                    : 'Apaga o lançamento do faturamento. O timesheet da pessoa continua intacto.'}
                                >
                                  <Trash2 className="mr-1 h-3.5 w-3.5" /> Excluir
                                </Button>
                                {/* "Enviar p/ faturamento" saiu: a etapa que ele acionava nao
                                    existe mais (Filipe, 07/08). No lugar, a previa do relatorio
                                    de timesheet do proprio caso — que e o que ele confere antes
                                    de faturar. Sem selecao, sai o caso inteiro. */}
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-xs"
                                  onClick={() => {
                                    const base = selectedIds.length > 0
                                      ? reviewRows.filter((row) => selectedIds.includes(row.item.id)).map((row) => row.item)
                                      : reviewRows.map((row) => row.item)
                                    openTimesheetReport({
                                      titulo: 'Prévia do relatório de timesheet',
                                      subtitulo: `${casoGroup.numero || ''} - ${casoGroup.nome || ''} · ${base.length} lançamento(s)`,
                                      mostrarValor: true,
                                      rows: base.map((it) => ({
                                        data: it.timesheetDataLancamento ? formatDate(it.timesheetDataLancamento) : formatDate(it.dataReferencia || ''),
                                        cliente: it.clienteNome || '',
                                        caso: `${it.casoNumero || ''} - ${it.casoNome || ''}`,
                                        profissional: it.enviadoPorNome || it.timesheetProfissional || '',
                                        // Com grupo, o que vai no relatorio e o texto do grupo.
                                        descricao: it.grupoTexto || it.timesheetDescricaoOriginal || it.timesheetDescricao || it.regraNome || '',
                                        horas: formatHistoryHours(it.grupoHoras ?? getEffectiveItemHours(it)),
                                        valor: it.grupoValor ?? getEffectiveItemValue(it),
                                      })),
                                    })
                                  }}
                                  disabled={reviewRows.length === 0}
                                  title="Abre a prévia do relatório de timesheet deste caso"
                                >
                                  Prévia do relatório
                                </Button>
                                {/* NFS-e na faixa do caso. A nota é emitida por CONTRATO (com
                                    rateio), então "Faturar" abre a prévia — é ela que mostra o
                                    que vai no documento. Só quem tem finance.nfse.manage emite. */}
                                {casoContratoId ? (
                                  <>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="rounded-full border-blue-300 text-xs text-blue-700 hover:bg-blue-50"
                                      onClick={() => setNfsePreview({ contratoId: casoContratoId, casoId: casoGroup.itens[0]?.casoId ?? null, label: casoLabelNfse, permitirEmitir: false })}
                                      title="Ver a prévia da NFS-e (rascunho) deste caso"
                                    >
                                      <FileText className="mr-1 h-3.5 w-3.5" />
                                      Prévia da NF
                                    </Button>
                                    {podeEmitirNfse ? (
                                      <Button
                                        size="sm"
                                        className="rounded-full bg-green-700 text-xs text-white hover:bg-green-800"
                                        onClick={() => setNfsePreview({ contratoId: casoContratoId, casoId: casoGroup.itens[0]?.casoId ?? null, label: casoLabelNfse, permitirEmitir: true })}
                                        disabled={emittingContratoId === casoContratoId}
                                        title="Conferir a prévia e emitir a NFS-e deste caso"
                                      >
                                        {emittingContratoId === casoContratoId ? (
                                          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                                        ) : (
                                          <DollarSign className="mr-1 h-3.5 w-3.5" />
                                        )}
                                        Faturar
                                      </Button>
                                    ) : null}
                                    {/* Nota já emitida: ver o PDF e cancelar sem sair da tela. */}
                                    {(notasPorContrato[casoContratoId] || []).map((nota) => (
                                      <span key={nota.id} className="inline-flex items-center gap-1">
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          className="rounded-full border-slate-300 text-xs"
                                          onClick={() => window.open(nota.arquivo_url || '/financeiro/notas-geradas', '_blank', 'noopener')}
                                          title={nota.arquivo_url ? 'Abrir o PDF da NFS-e' : 'Ainda sem PDF — abre a lista de notas geradas'}
                                        >
                                          <FileText className="mr-1 h-3.5 w-3.5" />
                                          Ver NF{nota.numero ? ` ${nota.numero}` : ''}
                                        </Button>
                                        {podeEmitirNfse ? (
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            className="rounded-full border-red-200 text-xs text-red-700 hover:bg-red-50"
                                            onClick={() => void cancelarNota(nota)}
                                            disabled={cancelandoNotaId !== null}
                                            title="Cancelar esta NFS-e"
                                          >
                                            {cancelandoNotaId === nota.id ? (
                                              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                                            ) : (
                                              <Ban className="mr-1 h-3.5 w-3.5" />
                                            )}
                                            Cancelar NF
                                          </Button>
                                        ) : null}
                                      </span>
                                    ))}
                                    {/* Despesa não gera NFS-e: gera nota de despesa
                                        (documento não-fiscal de reembolso). */}
                                    {despesasDoCaso.length > 0 ? (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="rounded-full border-amber-300 text-xs text-amber-800 hover:bg-amber-50"
                                        onClick={() => setNotaDespesa({
                                          clienteNome: clienteGroup.nome,
                                          contratoLabel: casoLabelNfse,
                                          casoLabel: `${casoGroup.numero ? `${casoGroup.numero} - ` : ''}${casoGroup.nome}`,
                                          documentoNumero: null,
                                          emissao: hojeIso(),
                                          vencimento: hojeIso(),
                                          itens: despesasDoCaso.map((d) => {
                                            const snap = (d.snapshot || {}) as Record<string, unknown>
                                            return {
                                              data_lancamento: d.dataReferencia,
                                              categoria: String(snap.categoria || '—'),
                                              descricao: String(snap.descricao || d.timesheetDescricao || 'Despesa'),
                                              valor: getEffectiveItemValue(d),
                                            }
                                          }),
                                        })}
                                        title="Gerar a nota de despesa (documento não-fiscal) deste caso"
                                      >
                                        <Receipt className="mr-1 h-3.5 w-3.5" />
                                        Nota de despesa
                                      </Button>
                                    ) : null}
                                  </>
                                ) : null}
                                <p className="text-sm font-semibold text-ink font-tabular">{formatMoney(caseMetrics.totalValor)}</p>
                              </div>
                            </div>
                          </div>

                          {casoExpanded ? (
                            <div className="space-y-3 bg-canvas-soft/40 p-3">
                              {reviewRows.map(({ item, mode, key }) => {
                                const ehLider = !!item.grupoId && liderDoGrupo.get(item.grupoId) === item.id
                                // Quando ha grupo, o que vale nas etapas e o que o revisor
                                // escreveu no grupo — era o que o Filipe estranhou em 07/08:
                                // editava "texto do grupo" e a revisao seguia mostrando o
                                // texto original de cada lancamento. Envio nao muda: ele
                                // registra o que foi lancado, e isso e historico.
                                const textoGrupo = ehLider ? (item.grupoTexto || null) : null
                                const horasGrupo = ehLider ? item.grupoHoras : null
                                const valorGrupo = ehLider ? item.grupoValor : null
                                const grupoAberto = !!item.grupoId && !!gruposAbertos[item.grupoId]
                                // Membro que nao lidera some enquanto o grupo estiver fechado.
                                if (item.grupoId && !ehLider && !grupoAberto) return null
                                const draft = drafts[item.id]
                                const busy = busyKey === key || busyKey === `advance:${item.id}` || busyKey === batchKey || busyKey === `${mode}:${item.id}`
                                const isEditing = editorKey === key
                                // Linguagem de 4 badges (Fase 1): Liberado -> Revisado -> Aprovado -> Faturado.
                                // Mapeia os estados atuais: em_revisao = liberado p/ revisão (laranja);
                                // em_aprovacao = já revisado (verde); aprovado (roxo); faturado (branco).
                                const badge =
                                  item.status === 'em_revisao'
                                    ? { label: 'Liberado', cls: 'bg-amber-100 text-amber-800' }
                                    : item.status === 'em_aprovacao'
                                      ? { label: 'Revisado', cls: 'bg-emerald-100 text-emerald-700' }
                                      : item.status === 'aprovado'
                                        ? { label: 'Aprovado', cls: 'bg-purple-100 text-purple-700' }
                                        : { label: 'Faturado', cls: 'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200' }
                                const envioData = item.timesheetDataLancamento || item.dataReferencia
                                const envioTexto = mode === 'timesheet' ? item.timesheetDescricaoOriginal || item.timesheetDescricao || 'Sem descrição' : getRuleTitle(item)
                                const revisado = item.status === 'em_aprovacao' || item.status === 'aprovado'
                                // trava multi-CC: aprovação só libera quando nenhuma hora do caso
                                // estiver em revisão (cadeado explicado em vez de erro ao clicar)
                                const horasPendentesCC =
                                  item.revisoresModo === 'auto_centro_custo' && item.origemTipo === 'timesheet'
                                    ? casoGroup.itens.filter(
                                        (sibling) => sibling.origemTipo === 'timesheet' && sibling.status === 'em_revisao' && sibling.id !== item.id,
                                      ).length
                                    : 0
                                const aprovacaoTravada = item.status === 'em_aprovacao' && horasPendentesCC > 0
                                const revChanges = getStageChanges(item, 'REVISOR')
                                const aprChanges = getStageChanges(item, 'APROVADOR')
                                const tsRow = draft?.timesheetRows?.[0]
                                const tsHorasValor = parseDecimalInput(tsRow?.horasRevisadas || tsRow?.horasIniciais || '0')
                                const tsHoras = Math.floor(tsHorasValor)
                                const tsMinutos = Math.round((tsHorasValor - tsHoras) * 60)

                                return (
                                  <div key={key} className="overflow-hidden rounded-xl border border-hairline bg-white shadow-sm">
                                    <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-3 py-2">
                                      <input
                                        type="checkbox"
                                        className="h-4 w-4 rounded border-hairline"
                                        checked={selectedItemIds.includes(item.id)}
                                        onChange={(event) =>
                                          setSelectedItemIds((prev) =>
                                            event.target.checked
                                              ? Array.from(new Set([...prev, item.id]))
                                              : prev.filter((id) => id !== item.id),
                                          )
                                        }
                                        disabled={(!canAdvance(item.status) && item.status !== 'aprovado') || busy}
                                      />
                                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${badge.cls}`}>{badge.label}</span>
                                      {item.grupoId ? (
                                        <span
                                          className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-700"
                                          title={ehLider
                                            ? `Grupo de ${tamanhoDoGrupo.get(item.grupoId) || 0} lançamentos — sai como uma linha só na fatura`
                                            : 'Lançamento original deste grupo'}
                                        >
                                          <Layers className="h-3 w-3" />
                                          {ehLider ? `Agrupado (${tamanhoDoGrupo.get(item.grupoId) || 0})` : 'Original'}
                                          {ehLider ? (
                                            <>
                                              <button
                                                type="button"
                                                className="ml-0.5 inline-flex items-center gap-1 underline underline-offset-2 hover:no-underline"
                                                onClick={() => item.grupoId && setGruposAbertos((prev) => ({ ...prev, [item.grupoId as string]: !prev[item.grupoId as string] }))}
                                                title={grupoAberto ? 'Esconder os lançamentos originais' : 'Exibir os lançamentos originais'}
                                              >
                                                {grupoAberto ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                                                {grupoAberto ? 'esconder' : 'exibir'}
                                              </button>
                                              <button
                                                type="button"
                                                className="ml-0.5 underline underline-offset-2 hover:no-underline disabled:opacity-50"
                                                onClick={() => item.grupoId && void desagrupar(batchKey, item.grupoId)}
                                                disabled={item.status === 'aprovado' || busyKey === batchKey}
                                                title={item.status === 'aprovado' ? 'Devolva para revisão antes de desagrupar' : 'Desfazer o grupo'}
                                              >
                                                desagrupar
                                              </button>
                                            </>
                                          ) : null}
                                        </span>
                                      ) : null}
                                      <span className="text-xs text-ink-mute">
                                        Lançado por <strong className="text-ink-secondary">{item.enviadoPorNome || item.timesheetProfissional || '-'}</strong>
                                        {envioData ? ` em ${formatDate(envioData)}` : ''}
                                      </span>
                                    </div>

                                    {ehLider && item.grupoId ? (
                                      <div className="border-b border-hairline bg-violet-50/50 px-3 py-3">
                                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                                          <p className="text-eyebrow text-violet-700">Texto do grupo</p>
                                          <p className="text-xs text-ink-mute">
                                            {tamanhoDoGrupo.get(item.grupoId) || 0} lançamentos ·{' '}
                                            <strong className="font-tabular text-ink-secondary">
                                              {formatMoney(item.grupoValor ?? 0)}
                                            </strong>
                                          </p>
                                        </div>
                                        <Textarea
                                          className="mt-2 bg-white"
                                          rows={3}
                                          value={grupoDraft[item.grupoId]?.texto ?? item.grupoTexto ?? ''}
                                          onChange={(event) => {
                                            const gid = item.grupoId as string
                                            const atual = grupoDraft[gid]
                                            setGrupoDraft((prev) => ({
                                              ...prev,
                                              [gid]: {
                                                texto: event.target.value,
                                                horas: atual?.horas ?? String(item.grupoHoras ?? 0),
                                              },
                                            }))
                                          }}
                                          disabled={item.status === 'aprovado' || busy}
                                          placeholder="Descrição que vai para a fatura"
                                        />
                                        <div className="mt-2 flex flex-wrap items-center gap-2">
                                          <label className="text-xs text-ink-mute">
                                            Horas cobradas
                                            <Input
                                              className="ml-2 inline-block h-8 w-24 bg-white"
                                              value={grupoDraft[item.grupoId]?.horas ?? String(item.grupoHoras ?? 0)}
                                              onChange={(event) => {
                                                const gid = item.grupoId as string
                                                const atual = grupoDraft[gid]
                                                setGrupoDraft((prev) => ({
                                                  ...prev,
                                                  [gid]: {
                                                    texto: atual?.texto ?? item.grupoTexto ?? '',
                                                    horas: event.target.value,
                                                  },
                                                }))
                                              }}
                                              disabled={item.status === 'aprovado' || busy}
                                            />
                                          </label>
                                          <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            className="ml-auto"
                                            onClick={() => item.grupoId && void salvarGrupo(batchKey, item.grupoId)}
                                            disabled={!grupoDraft[item.grupoId] || item.status === 'aprovado' || busy}
                                          >
                                            Salvar texto do grupo
                                          </Button>
                                        </div>
                                      </div>
                                    ) : null}

                                    <div className="flex flex-col md:flex-row">
                                    <div className="min-w-0 flex-1 overflow-x-auto">
                                    <Table className="min-w-[860px]">
                                      <thead className="bg-white">
                                        <tr className="border-b text-[10px] uppercase tracking-wide text-ink-mute">
                                          <th className="px-3 py-2 text-left">Etapa</th>
                                          <th className="px-3 py-2 text-left">Responsável</th>
                                          <th className="px-3 py-2 text-left">Data</th>
                                          <th className="px-3 py-2 text-left">Texto</th>
                                          <th className="px-3 py-2 text-right">Horas</th>
                                          <th className="px-3 py-2 text-right">Valor</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {/* ENVIO */}
                                        <tr className="border-b align-top">
                                          <td className="px-3 py-3">
                                            <span className="rounded-full bg-canvas-soft px-2 py-0.5 text-[11px] text-ink-secondary">Envio</span>
                                          </td>
                                          <td className="px-3 py-2.5 text-xs text-ink-secondary"><PersonBadge nome={item.enviadoPorNome || item.timesheetProfissional || '-'} foto={item.enviadoPorFoto} /></td>
                                          <td className="px-3 py-2.5 text-xs text-ink-secondary">{envioData ? formatDate(envioData) : '—'}</td>
                                          <td className="px-3 py-2.5 text-xs text-ink-secondary">
                                            <div className="max-w-[560px] whitespace-normal break-words text-[11px] leading-snug">{envioTexto}</div>
                                          </td>
                                          <td className="px-3 py-2.5 text-right text-xs text-ink-secondary font-tabular">
                                            {mode === 'timesheet' ? formatHistoryHours(getOriginalItemHours(item)) : '—'}
                                          </td>
                                          <td className="px-3 py-2.5 text-right text-xs font-medium text-ink font-tabular">{formatMoney(getOriginalItemValue(item))}</td>
                                        </tr>

                                        {/* REVISÃO */}
                                        <tr className="border-b bg-emerald-50/50 align-top">
                                          <td className="px-3 py-3">
                                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-700">Revisão</span>
                                          </td>
                                          <td className="px-3 py-2.5 text-xs text-ink-secondary"><PersonBadge nome={item.responsavelRevisaoNome || 'Sem revisor definido'} foto={item.revisorFoto} /></td>
                                          <td className="px-3 py-2.5 text-xs text-ink-secondary">{revisado && item.dataRevisao ? formatDate(item.dataRevisao) : '—'}</td>
                                          <td className="px-3 py-2.5 text-xs text-ink-secondary">
                                            {revisado ? (
                                              <div className="max-w-[560px] space-y-1 whitespace-normal break-words text-[11px] leading-snug">
                                                <div>{textoGrupo || revChanges?.texto || envioTexto}</div>
                                                <StageTag alterado={Boolean(revChanges?.alterado)} changes={revChanges?.changes || []} />
                                              </div>
                                            ) : (
                                              <span className="italic text-ink-mute">Aguardando sua revisão do lançamento acima.</span>
                                            )}
                                          </td>
                                          <td className="px-3 py-2.5 text-right text-xs text-ink-secondary font-tabular">
                                            {revisado && mode === 'timesheet' ? formatHistoryHours(horasGrupo ?? item.horasRevisadas ?? getOriginalItemHours(item)) : revisado ? '—' : ''}
                                          </td>
                                          <td className="px-3 py-2.5 text-right text-xs font-medium text-ink font-tabular">
                                            {revisado ? formatMoney(valorGrupo ?? item.valorRevisado ?? getOriginalItemValue(item)) : ''}
                                          </td>
                                        </tr>

                                        {isEditing && item.status === 'em_revisao' ? (
                                          <tr className="border-b bg-canvas-soft/60">
                                            <td colSpan={6} className="px-4 py-3">
                                              <div className="space-y-3 rounded-lg border bg-white p-4">
                                                {mode === 'timesheet' && tsRow ? (
                                                  <>
                                                    <Textarea
                                                      value={tsRow.atividade}
                                                      onChange={(event) => syncTimesheetRow(item.id, tsRow.id, { atividade: event.target.value })}
                                                      rows={3}
                                                      disabled={busy}
                                                    />
                                                    <div className="flex flex-wrap items-end gap-4">
                                                      <div className="flex items-center gap-2">
                                                        <span className="text-sm text-ink-mute">Data:</span>
                                                        <Input
                                                          type="date"
                                                          className="w-40"
                                                          value={(tsRow.dataLancamento || '').slice(0, 10)}
                                                          onChange={(event) => syncTimesheetRow(item.id, tsRow.id, { dataLancamento: event.target.value })}
                                                          disabled={busy}
                                                        />
                                                      </div>
                                                      <div className="flex items-center gap-2">
                                                        <span className="text-sm text-ink-mute">Horas:</span>
                                                        <Input
                                                          className="w-16 text-right"
                                                          inputMode="numeric"
                                                          value={String(tsHoras)}
                                                          onChange={(event) => {
                                                            const h = Math.max(0, parseInt(event.target.value || '0', 10) || 0)
                                                            syncTimesheetRow(item.id, tsRow.id, { horasRevisadas: String(h + tsMinutos / 60) })
                                                          }}
                                                          disabled={busy}
                                                        />
                                                        <span className="text-sm text-ink-mute">h</span>
                                                        <Input
                                                          className="w-16 text-right"
                                                          inputMode="numeric"
                                                          value={String(tsMinutos)}
                                                          onChange={(event) => {
                                                            const m = Math.min(59, Math.max(0, parseInt(event.target.value || '0', 10) || 0))
                                                            syncTimesheetRow(item.id, tsRow.id, { horasRevisadas: String(tsHoras + m / 60) })
                                                          }}
                                                          disabled={busy}
                                                        />
                                                        <span className="text-sm text-ink-mute">min</span>
                                                      </div>
                                                      <div className="flex items-center gap-2">
                                                        <span className="text-sm text-ink-mute">Profissional:</span>
                                                        <select
                                                          className="h-9 rounded-md border border-hairline-input bg-background px-2 text-sm text-ink"
                                                          value={tsRow.profissional}
                                                          onChange={(event) => syncTimesheetRow(item.id, tsRow.id, { profissional: event.target.value })}
                                                          disabled={busy}
                                                        >
                                                          {tsRow.profissional && !colaboradores.some((c) => c.nome === tsRow.profissional) ? (
                                                            <option value={tsRow.profissional}>{tsRow.profissional}</option>
                                                          ) : null}
                                                          {colaboradores.map((colab) => (
                                                            <option key={colab.id} value={colab.nome}>
                                                              {colab.nome}
                                                            </option>
                                                          ))}
                                                        </select>
                                                      </div>
                                                      <div className="flex items-center gap-2">
                                                        <span className="text-sm text-ink-mute">Responsável pela etapa:</span>
                                                        <select
                                                          className="h-9 rounded-md border border-hairline-input bg-background px-2 text-sm text-ink"
                                                          value={draft?.etapaResponsavelId || ''}
                                                          onChange={(event) => updateDraft(item.id, { etapaResponsavelId: event.target.value })}
                                                          disabled={busy}
                                                        >
                                                          <option value="">Manter atual</option>
                                                          {colaboradores.map((colab) => (
                                                            <option key={colab.id} value={colab.id}>
                                                              {colab.nome}
                                                            </option>
                                                          ))}
                                                        </select>
                                                      </div>
                                                      </div>
                                                  </>
                                                ) : (
                                                  <>
                                                    <Textarea
                                                      value={draft?.valueRows?.[0]?.descricao || ''}
                                                      onChange={(event) => {
                                                        if (draft?.valueRows?.[0]) {
                                                          syncValueRow(item.id, draft.valueRows[0].id, { descricao: event.target.value })
                                                        }
                                                      }}
                                                      rows={3}
                                                      disabled={busy}
                                                    />
                                                    <div className="flex flex-wrap items-end gap-4">
                                                      <div className="flex items-center gap-2">
                                                        <span className="text-sm text-ink-mute">Data:</span>
                                                        <Input
                                                          type="date"
                                                          className="w-40"
                                                          value={displayToIso(draft?.valueRows?.[0]?.referencia || '')}
                                                          onChange={(event) => {
                                                            if (draft?.valueRows?.[0]) {
                                                              syncValueRow(item.id, draft.valueRows[0].id, { referencia: isoToDisplay(event.target.value) })
                                                            }
                                                          }}
                                                          disabled={busy}
                                                        />
                                                      </div>
                                                      <div className="flex items-center gap-2">
                                                        <span className="text-sm text-ink-mute">Responsável pela etapa:</span>
                                                        <select
                                                          className="h-9 rounded-md border border-hairline-input bg-background px-2 text-sm text-ink"
                                                          value={draft?.etapaResponsavelId || ''}
                                                          onChange={(event) => updateDraft(item.id, { etapaResponsavelId: event.target.value })}
                                                          disabled={busy}
                                                        >
                                                          <option value="">Manter atual</option>
                                                          {colaboradores.map((colab) => (
                                                            <option key={colab.id} value={colab.id}>
                                                              {colab.nome}
                                                            </option>
                                                          ))}
                                                        </select>
                                                      </div>
                                                      <div className="flex items-center gap-2">
                                                      <span className="text-sm text-ink-mute">Valor (R$):</span>
                                                      <Input
                                                        className="w-36 text-right"
                                                        value={draft?.valueRows?.[0]?.valorRevisado || draft?.valor || ''}
                                                        onChange={(event) => {
                                                          updateDraft(item.id, { valor: event.target.value })
                                                          if (draft?.valueRows?.[0]) {
                                                            syncValueRow(item.id, draft.valueRows[0].id, { valorRevisado: event.target.value })
                                                          }
                                                        }}
                                                        disabled={busy}
                                                      />
                                                    </div>
                                                    </div>
                                                  </>
                                                )}
                                                <div className="flex items-center justify-end gap-2">
                                                  <Button size="sm" variant="ghost" onClick={() => setEditorKey(null)} disabled={busy}>
                                                    Cancelar
                                                  </Button>
                                                  <Button
                                                    size="sm"
                                                    className="bg-emerald-600 text-white hover:bg-emerald-700"
                                                    onClick={() => {
                                                      setEditorKey(null)
                                                      void saveAndAdvance(item, mode)
                                                    }}
                                                    disabled={busy}
                                                  >
                                                    Salvar revisão
                                                  </Button>
                                                </div>
                                              </div>
                                            </td>
                                          </tr>
                                        ) : null}

                                        {/* APROVAÇÃO */}
                                        <tr className="bg-indigo-50/40 align-top">
                                          <td className="px-3 py-3">
                                            <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] text-indigo-700">Aprovação</span>
                                          </td>
                                          <td className="px-3 py-2.5 text-xs text-ink-secondary"><PersonBadge nome={item.responsavelAprovacaoNome || 'Renata ou Douglas'} foto={item.aprovadorFoto} /></td>
                                          <td className="px-3 py-2.5 text-xs text-ink-secondary">
                                            {item.status === 'aprovado' && item.dataAprovacao ? formatDate(item.dataAprovacao) : '—'}
                                          </td>
                                          <td className="px-3 py-2.5 text-xs text-ink-secondary">
                                            {item.status === 'aprovado' ? (
                                              <div className="max-w-[560px] space-y-1 whitespace-normal break-words text-[11px] leading-snug">
                                                <div>{textoGrupo || aprChanges?.texto || revChanges?.texto || envioTexto}</div>
                                                <StageTag alterado={Boolean(aprChanges?.alterado)} changes={aprChanges?.changes || []} />
                                              </div>
                                            ) : aprovacaoTravada ? (
                                              <span className="italic text-ink-secondary">
                                                Revisão concluída — disponível para aprovar.{' '}
                                                <span className="text-ink-mute">({horasPendentesCC} lançamento(s) deste caso ainda em revisão em outros centros de custo)</span>
                                              </span>
                                            ) : item.status === 'em_aprovacao' ? (
                                              <span className="italic text-ink-secondary">Revisão concluída — disponível para aprovar.</span>
                                            ) : (
                                              <span className="italic text-ink-mute">🔒 Disponível após a revisão.</span>
                                            )}
                                          </td>
                                          <td className="px-3 py-2.5 text-right text-xs text-ink-secondary font-tabular">
                                            {item.status === 'aprovado' && mode === 'timesheet'
                                              ? formatHistoryHours(horasGrupo ?? item.horasAprovadas ?? item.horasRevisadas ?? getOriginalItemHours(item))
                                              : ''}
                                          </td>
                                          <td className="px-3 py-2.5 text-right text-xs font-medium text-ink font-tabular">
                                            {item.status === 'aprovado' ? formatMoney(valorGrupo ?? item.valorAprovado ?? item.valorRevisado ?? getOriginalItemValue(item)) : ''}
                                          </td>
                                        </tr>

                                        {editorKey === `apr:${key}` && (item.status === 'em_aprovacao' || item.status === 'aprovado') ? (
                                          <tr className="border-t bg-canvas-soft/60">
                                            <td colSpan={6} className="px-4 py-3">
                                              <div className="space-y-3 rounded-lg border bg-white p-4">
                                                {mode === 'timesheet' && tsRow ? (
                                                  <>
                                                    <Textarea
                                                      value={tsRow.atividade}
                                                      onChange={(event) => syncTimesheetRow(item.id, tsRow.id, { atividade: event.target.value })}
                                                      rows={3}
                                                      disabled={busy}
                                                    />
                                                    <div className="flex flex-wrap items-end gap-4">
                                                      <div className="flex items-center gap-2">
                                                        <span className="text-sm text-ink-mute">Data:</span>
                                                        <Input
                                                          type="date"
                                                          className="w-40"
                                                          value={(tsRow.dataLancamento || '').slice(0, 10)}
                                                          onChange={(event) => syncTimesheetRow(item.id, tsRow.id, { dataLancamento: event.target.value })}
                                                          disabled={busy}
                                                        />
                                                      </div>
                                                      <div className="flex items-center gap-2">
                                                        <span className="text-sm text-ink-mute">Responsável pela etapa:</span>
                                                        <select
                                                          className="h-9 rounded-md border border-hairline-input bg-background px-2 text-sm text-ink"
                                                          value={draft?.etapaResponsavelId || ''}
                                                          onChange={(event) => updateDraft(item.id, { etapaResponsavelId: event.target.value })}
                                                          disabled={busy}
                                                        >
                                                          <option value="">Manter atual</option>
                                                          {colaboradores.map((colab) => (
                                                            <option key={colab.id} value={colab.id}>
                                                              {colab.nome}
                                                            </option>
                                                          ))}
                                                        </select>
                                                      </div>
                                                      <div className="flex items-center gap-2">
                                                      <span className="text-sm text-ink-mute">Horas:</span>
                                                      <Input
                                                        className="w-16 text-right"
                                                        inputMode="numeric"
                                                        value={String(tsHoras)}
                                                        onChange={(event) => {
                                                          const h = Math.max(0, parseInt(event.target.value || '0', 10) || 0)
                                                          syncTimesheetRow(item.id, tsRow.id, { horasRevisadas: String(h + tsMinutos / 60) })
                                                        }}
                                                        disabled={busy}
                                                      />
                                                      <span className="text-sm text-ink-mute">h</span>
                                                      <Input
                                                        className="w-16 text-right"
                                                        inputMode="numeric"
                                                        value={String(tsMinutos)}
                                                        onChange={(event) => {
                                                          const m = Math.min(59, Math.max(0, parseInt(event.target.value || '0', 10) || 0))
                                                          syncTimesheetRow(item.id, tsRow.id, { horasRevisadas: String(tsHoras + m / 60) })
                                                        }}
                                                        disabled={busy}
                                                      />
                                                      <span className="text-sm text-ink-mute">min</span>
                                                    </div>
                                                    </div>
                                                  </>
                                                ) : (
                                                  <>
                                                    <Textarea
                                                      value={draft?.valueRows?.[0]?.descricao || ''}
                                                      onChange={(event) => {
                                                        if (draft?.valueRows?.[0]) {
                                                          syncValueRow(item.id, draft.valueRows[0].id, { descricao: event.target.value })
                                                        }
                                                      }}
                                                      rows={3}
                                                      disabled={busy}
                                                    />
                                                    <div className="flex flex-wrap items-end gap-4">
                                                      <div className="flex items-center gap-2">
                                                        <span className="text-sm text-ink-mute">Data:</span>
                                                        <Input
                                                          type="date"
                                                          className="w-40"
                                                          value={displayToIso(draft?.valueRows?.[0]?.referencia || '')}
                                                          onChange={(event) => {
                                                            if (draft?.valueRows?.[0]) {
                                                              syncValueRow(item.id, draft.valueRows[0].id, { referencia: isoToDisplay(event.target.value) })
                                                            }
                                                          }}
                                                          disabled={busy}
                                                        />
                                                      </div>
                                                      <div className="flex items-center gap-2">
                                                        <span className="text-sm text-ink-mute">Responsável pela etapa:</span>
                                                        <select
                                                          className="h-9 rounded-md border border-hairline-input bg-background px-2 text-sm text-ink"
                                                          value={draft?.etapaResponsavelId || ''}
                                                          onChange={(event) => updateDraft(item.id, { etapaResponsavelId: event.target.value })}
                                                          disabled={busy}
                                                        >
                                                          <option value="">Manter atual</option>
                                                          {colaboradores.map((colab) => (
                                                            <option key={colab.id} value={colab.id}>
                                                              {colab.nome}
                                                            </option>
                                                          ))}
                                                        </select>
                                                      </div>
                                                      <div className="flex items-center gap-2">
                                                      <span className="text-sm text-ink-mute">Valor (R$):</span>
                                                      <Input
                                                        className="w-36 text-right"
                                                        value={draft?.valueRows?.[0]?.valorRevisado || draft?.valor || ''}
                                                        onChange={(event) => {
                                                          updateDraft(item.id, { valor: event.target.value })
                                                          if (draft?.valueRows?.[0]) {
                                                            syncValueRow(item.id, draft.valueRows[0].id, { valorRevisado: event.target.value })
                                                          }
                                                        }}
                                                        disabled={busy}
                                                      />
                                                    </div>
                                                    </div>
                                                  </>
                                                )}
                                                <div className="flex items-center justify-end gap-2">
                                                  <Button size="sm" variant="ghost" onClick={() => setEditorKey(null)} disabled={busy}>
                                                    Cancelar
                                                  </Button>
                                                  <Button
                                                    size="sm"
                                                    className="bg-indigo-600 text-white hover:bg-indigo-700"
                                                    onClick={() => {
                                                      setEditorKey(null)
                                                      // Item já aprovado: salva a edição SEM avançar de etapa.
                                                      if (item.status === 'aprovado') void saveReviewItem(item, mode)
                                                      else void saveAndAdvance(item, mode)
                                                    }}
                                                    disabled={busy}
                                                  >
                                                    {item.status === 'aprovado' ? 'Salvar edição' : 'Salvar aprovação'}
                                                  </Button>
                                                </div>
                                              </div>
                                            </td>
                                          </tr>
                                        ) : null}
                                      </tbody>
                                    </Table>
                                    </div>

                                    {/* bundle de ações do card (lado direito, como no mock) */}
                                    <div className="flex shrink-0 flex-row flex-wrap items-start gap-2 border-t border-hairline p-3 md:w-52 md:flex-col md:border-l md:border-t-0">
                                      {item.status === 'em_revisao' ? (
                                        <>
                                          <Button
                                            size="sm"
                                            className="w-full justify-start bg-emerald-600 text-white hover:bg-emerald-700"
                                            onClick={() => void advanceItem(item)}
                                            disabled={busy}
                                          >
                                            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                            ✓ OK, sem alterações
                                          </Button>
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            className="w-full justify-start"
                                            onClick={() => setEditorKey((current) => (current === key ? null : key))}
                                            disabled={busy}
                                          >
                                            Revisar
                                          </Button>
                                        </>
                                      ) : null}
                                      {item.status === 'em_aprovacao' ? (
                                        <>
                                          <Button
                                            size="sm"
                                            className="w-full justify-start bg-indigo-600 text-white hover:bg-indigo-700"
                                            onClick={() => void advanceItem(item)}
                                            disabled={busy}
                                            title={aprovacaoTravada ? `${horasPendentesCC} lançamento(s) deste caso ainda em revisão — você pode aprovar mesmo assim.` : undefined}
                                          >
                                            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                            ✓ OK, aprovar
                                          </Button>
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            className="w-full justify-start"
                                            onClick={() => setEditorKey((current) => (current === `apr:${key}` ? null : `apr:${key}`))}
                                            disabled={busy}
                                          >
                                            Alterar
                                          </Button>
                                        </>
                                      ) : null}
                                      {/* Editar completo, independente da etapa: item já aprovado
                                          também pode ser editado (valor, texto, horas) pela Jessika
                                          na sessão final, sem mudar de etapa. */}
                                      {item.status === 'aprovado' ? (
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          className="w-full justify-start"
                                          onClick={() => setEditorKey((current) => (current === `apr:${key}` ? null : `apr:${key}`))}
                                          disabled={busy}
                                        >
                                          Editar
                                        </Button>
                                      ) : null}
                                      {(item.timesheetId && item.status === 'em_revisao') ? (
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          className="w-full justify-start text-primary hover:bg-primary-soft-bg hover:text-primary-deep"
                                          onClick={() => {
                                            const base = getNextBillingPeriodDate(item)
                                            setPostergarData(base.toISOString().slice(0, 10))
                                            setPostergarConfirmId(item.id)
                                          }}
                                          disabled={busy}
                                        >
                                          <Clock className="mr-1 h-3.5 w-3.5" /> Postergar
                                        </Button>
                                      ) : null}
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="w-full justify-start"
                                        onClick={() => {
                                          setTransferCasoId('')
                                          setTransferItemId(item.id)
                                        }}
                                        disabled={busy}
                                      >
                                        <ArrowLeftRight className="mr-1 h-3.5 w-3.5" /> Transferir caso
                                      </Button>
                                      {item.status === 'em_revisao' || item.status === 'em_aprovacao' ? (
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          className="w-full justify-start text-destructive hover:bg-destructive/5"
                                          onClick={() => {
                                            setIgnorarMotivo('')
                                            setIgnorarOutro('')
                                            setIgnorarIds([item.id])
                                          }}
                                          disabled={busy}
                                        >
                                          Ignorar fatura
                                        </Button>
                                      ) : null}
                                      {/* Após revisar/aprovar, o rail mostra também a volta de etapa
                                          (em_aprovacao -> revisão; aprovado -> aprovação) — pedido 20/07. */}
                                      {item.status === 'em_aprovacao' || item.status === 'aprovado' ? (
                                        <Button size="sm" variant="ghost" className="w-full justify-start" onClick={() => void returnItem(item)} disabled={busy}>
                                          Devolver p/ etapa anterior
                                        </Button>
                                      ) : null}
                                    </div>
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                ) : null}
              </section>
            )
          })}
        </div>
      )}

      <Dialog
        open={postergarConfirmId !== null || postergarIds.length > 0}
        onOpenChange={(open) => {
          if (!open) {
            setPostergarConfirmId(null)
            setPostergarIds([])
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Postergar lançamento</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-ink-mute">
            Escolha para quando este lançamento deve ser reagendado:
          </p>
          <Input
            type="date"
            value={postergarData}
            onChange={(event) => setPostergarData(event.target.value)}
          />
          <p className="text-xs text-ink-mute">
            O item sai da lista atual e reaparece no faturamento do período escolhido.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPostergarConfirmId(null)}>
              Cancelar
            </Button>
            <Button
              variant="default"
              className="bg-primary hover:bg-primary-deep text-primary-foreground"
              onClick={() => {
                const confirmId = postergarConfirmId
                setPostergarConfirmId(null)
                if (postergarIds.length > 0) {
                  void postergarLote()
                } else if (confirmId) {
                  const item = items.find((i) => i.id === confirmId)
                  if (item) void postergarItem(item, postergarData || undefined)
                }
              }}
            >
              Reagendar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={transferItemId !== null || transferIds.length > 0}
        onOpenChange={(open) => {
          if (!open) {
            setTransferItemId(null)
            setTransferIds([])
            setTransferClienteId('')
            setTransferCasoId('')
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Transferir para outro caso</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-ink-mute">O lançamento passa a contar no caso escolhido (cliente/contrato do caso).</p>
          <div className="space-y-1">
            <label className="text-xs font-medium text-ink-mute">Cliente</label>
            <CommandSelect
              value={transferClienteId}
              onValueChange={(value) => {
                setTransferClienteId(value)
                setTransferCasoId('')
              }}
              options={transferClienteOptions}
              placeholder="Selecione o cliente"
              searchPlaceholder="Buscar cliente..."
              emptyText="Nenhum cliente encontrado."
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-ink-mute">Caso</label>
            <CommandSelect
              value={transferCasoId}
              onValueChange={setTransferCasoId}
              options={transferCasoOptions}
              placeholder={transferClienteId ? 'Selecione o caso de destino' : 'Escolha o cliente primeiro'}
              searchPlaceholder="Buscar caso..."
              emptyText="Nenhum caso encontrado."
              disabled={!transferClienteId}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferItemId(null)}>
              Cancelar
            </Button>
            <Button
              className="bg-primary hover:bg-primary-deep text-primary-foreground"
              onClick={() => (transferIds.length > 0 ? void transferirLote() : void transferItem())}
              disabled={!transferCasoId || busyKey === `transfer:${transferItemId}` || busyKey === 'transferir-lote'}
            >
              {busyKey === `transfer:${transferItemId}` ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Transferir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={ignorarIds.length > 0}
        onOpenChange={(open) => {
          if (!open) {
            setIgnorarIds([])
            setIgnorarMotivo('')
            setIgnorarOutro('')
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Ignorar a fatura</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-ink-mute">
            A cobrança de {ignorarIds.length} lançamento(s) será zerada e sairá da relação de cobrança.
            O lançamento continua registrado no sistema.
          </p>
          <div className="space-y-2">
            <label className="text-sm font-medium">Justificativa</label>
            <select
              className="h-9 w-full rounded-md border border-hairline-input bg-background px-2 text-sm text-ink"
              value={ignorarMotivo}
              onChange={(event) => setIgnorarMotivo(event.target.value)}
            >
              <option value="">Selecione...</option>
              <option value="Não cabe na fatura">Não cabe na fatura</option>
              <option value="Lançamento desnecessário/excessivo">Lançamento desnecessário/excessivo</option>
              <option value="outro">Outro (descrever)</option>
            </select>
            {ignorarMotivo === 'outro' ? (
              <Textarea rows={2} value={ignorarOutro} onChange={(event) => setIgnorarOutro(event.target.value)} placeholder="Descreva a justificativa" />
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIgnorarIds([])}>
              Cancelar
            </Button>
            <Button
              variant="default"
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => void ignorarItens()}
              disabled={busyKey === 'ignorar' || !ignorarMotivo || (ignorarMotivo === 'outro' && !ignorarOutro.trim())}
            >
              {busyKey === 'ignorar' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Ignorar fatura
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Prévia da NFS-e. Sem onConfirmEmit o diálogo é só leitura — é assim que o
          botão "Prévia da NF" abre, inclusive para quem não pode emitir. */}
      {/* Nota de despesa (documento não-fiscal) — mesmo componente da composição da fatura. */}
      <NotaDespesaPreview open={notaDespesa !== null} onClose={() => setNotaDespesa(null)} data={notaDespesa} />

      <NfsePreviewDialog
        open={nfsePreview !== null}
        contratoId={nfsePreview?.contratoId ?? null}
        casoId={nfsePreview?.casoId ?? null}
        contratoLabel={nfsePreview?.label}
        onClose={() => setNfsePreview(null)}
        onConfirmEmit={
          nfsePreview?.permitirEmitir
            ? (descricaoServico) => {
                if (!nfsePreview) return
                const { contratoId, casoId, label } = nfsePreview
                setNfsePreview(null)
                void emitNfse(contratoId, label, descricaoServico, casoId)
              }
            : undefined
        }
      />

      {/* Resultado da emissão. Visualizar/cancelar a nota seguem em "4. Notas geradas". */}
      <Dialog open={nfseResult !== null} onOpenChange={(open) => { if (!open) setNfseResult(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>NFS-e enviada</DialogTitle>
          </DialogHeader>
          {nfseResult ? (
            <div className="space-y-2 text-sm">
              <p>
                <span className="text-ink-mute">Status: </span>
                <strong className="text-ink">{nfseResult.focus_status}</strong>
              </p>
              <p>
                <span className="text-ink-mute">Valor: </span>
                <strong className="font-tabular text-ink">{formatMoney(nfseResult.valor_total)}</strong>
              </p>
              <p className="break-all font-mono text-xs text-ink-mute">{nfseResult.ref}</p>
              <p className="pt-2 text-xs text-ink-mute">
                A autorização da prefeitura pode levar alguns minutos. Acompanhe, baixe o PDF ou
                cancele em{' '}
                <a href="/financeiro/notas-geradas" className="text-primary underline underline-offset-2">
                  4. Notas geradas
                </a>
                .
              </p>
            </div>
          ) : null}
          <DialogFooter>
            <Button onClick={() => setNfseResult(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}
