'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  BriefcaseBusiness,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Landmark,
  Layers3,
  FileText,
  Eye,
  Lock,
  Plus,
  Power,
  Trash2,
  ChevronRight,
  Paperclip,
  Pencil,
  Loader2,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CommandSelect } from '@/components/ui/command-select'
import { DatePicker } from '@/components/ui/date-picker'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MoneyInput } from '@/components/ui/money-input'
import { NativeSelect } from '@/components/ui/native-select'
import { AlertDialog } from '@/components/ui/alert-dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useToast } from '@/components/ui/toast'
import { Tooltip } from '@/components/ui/tooltip'
import type { CasoPayload, ContratoFormOptions } from './types'
import RateioSlider from './rateio-slider'

interface PendingAnexo {
  nome: string
  file: File
}

interface TabelaPrecoItem {
  cargo_id: string
  cargo_nome: string
  valor_hora: string
  valor_hora_excedente: string
}

interface TabelaPrecoCatalog {
  id?: string
  nome: string
  itens: TabelaPrecoItem[]
}

interface ChoiceOption {
  value: string
  label: string
  description?: string
}

interface ProspecaoRateioItem {
  pagador_id: string
  percentual?: number | null
}

interface ProspecaoConfig {
  pagamento_ativo: boolean
  modo: 'percentual' | 'valor'
  valor: string
  pagadores: ProspecaoRateioItem[]
}

interface ContratoFormState {
  cliente_id: string
  nome_contrato: string
  forma_entrada: 'organico' | 'prospeccao' | ''
  responsavel_prospeccao_id: string
  canal_prospeccao: string
  grupo_imposto_id: string
  status: 'rascunho' | 'solicitacao' | 'validacao' | 'ativo' | 'encerrado' | 'em_analise'
  casos: CasoPayload[]
}

type BillingRuleStatus = 'rascunho' | 'ativo' | 'encerrado'

interface BillingRuleDraft {
  id: string
  status: BillingRuleStatus
  moeda: CasoPayload['moeda']
  tipo_cobranca_documento: CasoPayload['tipo_cobranca_documento']
  data_inicio_faturamento: string
  pagamento_dia_mes: string
  inicio_vigencia: string
  periodo_reajuste: string
  data_proximo_reajuste: string
  data_ultimo_reajuste: string
  indice_reajuste: string
  regra_cobranca: CasoPayload['regra_cobranca']
  regra_cobranca_config: Record<string, any>
  pagadores_servico: CasoPayload['pagadores_servico']
  indicacao_config: CasoPayload['indicacao_config']
}

type StepKey = 'dados' | 'casos'
type CaseSubstepKey = 'basico' | 'financeiro' | 'despesas' | 'timesheet'

const steps: Array<{ key: StepKey; label: string; icon: typeof FileText }> = [
  { key: 'dados', label: 'Contrato', icon: FileText },
  { key: 'casos', label: 'Casos', icon: BriefcaseBusiness },
]

const caseSubsteps: Array<{ key: CaseSubstepKey; label: string; icon: typeof Layers3 }> = [
  { key: 'basico', label: 'Dados básicos', icon: Layers3 },
  { key: 'financeiro', label: 'Regras financeiras', icon: CircleDollarSign },
  { key: 'despesas', label: 'Despesas', icon: Landmark },
  { key: 'timesheet', label: 'Timesheet', icon: Clock3 },
]

const emptyCaso: CasoPayload = {
  status: 'rascunho',
  nome: '',
  servico_id: '',
  produto_id: '',
  responsavel_id: '',
  moeda: 'real',
  tipo_cobranca_documento: '',
  data_inicio_faturamento: '',
  pagamento_dia_mes: '',
  inicio_vigencia: '',
  periodo_reajuste: 'nao_tem',
  data_proximo_reajuste: '',
  data_ultimo_reajuste: '',
  indice_reajuste: 'nao_tem',
  regra_cobranca: '',
  regra_cobranca_config: {
    natureza_caso: '',
    valor_hora: '',
    tabela_preco_nome: '',
    tabela_preco_id: '',
    cap_enabled: false,
    cap_tipo: 'hora',
    cap_min: '',
    cap_max: '',
    cobra_excedente: false,
    encontro_periodicidade: 'mensal',
    data_proximo_encontro: '',
    data_ultimo_encontro: '',
    valor_mensal: '',
    valor_projeto: '',
    parcelas: [],
    percentual_exito: '',
    valor_acao: '',
    valor_exito_calculado: '',
    data_pagamento_exito: '',
    cap_desejado_horas: '',
    cross_sell_ativo: false,
    cross_sell_origem_colaborador_id: '',
    cross_sell_periodicidade: 'mensal',
    cross_sell_modo: 'percentual',
    cross_sell_valor: '',
    cross_sell_data_pagamento_unico: '',
    cross_sell_usar_dia_vencimento: true,
    cross_sell_dia_pagamento_mensal: '',
    cross_sell_data_fim_pagamentos: '',
    cross_sell_parcelas_pagamento: [],
  },
  centro_custo_rateio: [],
  pagadores_servico: [],
  despesas_config: {
    despesas_reembolsaveis: [],
    limite_adiantamento: '',
  },
  pagadores_despesa: [],
  timesheet_config: {
    envia_timesheet: false,
    revisores: [],
    aprovadores: [],
    template_cobranca: '',
  },
  indicacao_config: {
    pagamento_indicacao: 'nao',
    periodicidade: 'mensal',
    modo: 'percentual',
    valor: '',
    data_pagamento_unico: '',
    usar_dia_vencimento: true,
    dia_pagamento_mensal: '',
    data_fim_pagamentos: '',
    parcelas_pagamento: [],
  },
}

function normalizeRegraCobranca(value: CasoPayload['regra_cobranca']) {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')

  if (!normalized) return ''
  if (normalized === 'hora_com_cap') return 'hora'
  if (normalized === 'projeto_parcelado') return 'projeto'
  if (normalized === 'exito') return 'exito'
  if (normalized === 'mensalidade_de_processo') return 'mensalidade_processo'
  return normalized as CasoPayload['regra_cobranca']
}

const emptyState: ContratoFormState = {
  cliente_id: '',
  nome_contrato: '',
  forma_entrada: '',
  responsavel_prospeccao_id: '',
  canal_prospeccao: '',
  grupo_imposto_id: '',
  status: 'rascunho',
  casos: [{ ...emptyCaso }],
}

const periodToMonths: Record<string, number> = {
  mensal: 1,
  bimestral: 2,
  trimestral: 3,
  semestral: 6,
  anual: 12,
}

function formatDateToInput(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function buildNextDate(base: string, months: number, dayOfMonth?: number): string {
  if (!base) return ''
  const dt = new Date(base + 'T00:00:00')
  if (Number.isNaN(dt.getTime())) return ''

  const y = dt.getFullYear()
  const m = dt.getMonth()
  const target = new Date(y, m + months, 1)
  const finalDay = Math.min(dayOfMonth || dt.getDate(), new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate())
  target.setDate(finalDay)
  return formatDateToInput(target)
}

function formatDateBr(value: string) {
  if (!value) return '-'
  const [y, m, d] = value.split('-')
  if (!y || !m || !d) return value
  return `${d}/${m}/${y}`
}

function normalizeContratoStatus(status?: string): ContratoFormState['status'] {
  if (status === 'em_analise') return 'validacao'
  if (status === 'rascunho' || status === 'solicitacao' || status === 'validacao' || status === 'ativo' || status === 'encerrado') {
    return status
  }
  return 'rascunho'
}

function formatContratoStatus(status?: string) {
  const normalized = normalizeContratoStatus(status)
  if (normalized === 'solicitacao') return 'solicitação'
  if (normalized === 'validacao') return 'validação'
  return normalized
}

function normalizeProspecaoConfig(value: unknown): ProspecaoConfig {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {}
  const rawPagadores = Array.isArray(raw.pagadores)
    ? raw.pagadores
    : Array.isArray(raw.rateio)
      ? raw.rateio
      : []

  const pagadores: ProspecaoRateioItem[] = rawPagadores
    .map((entry: any) => ({
      pagador_id: String(entry?.pagador_id || entry?.id || entry?.entidade_id || '').trim(),
      percentual: Number(entry?.percentual ?? entry?.porcentagem ?? 0) || 0,
    }))
    .filter((entry) => Boolean(entry.pagador_id))

  const modo = raw.modo === 'valor' ? 'valor' : 'percentual'
  const valor = String(raw.valor || '')
  const pagamentoAtivo = Boolean(raw.pagamento_ativo ?? raw.ativo ?? raw.pagamento_indicacao_ativo) || pagadores.length > 0

  return {
    pagamento_ativo: pagamentoAtivo,
    modo,
    valor,
    pagadores,
  }
}

function createRuleId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `regra_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function getRuleStatusFromCasoStatus(status?: string): BillingRuleStatus {
  if (status === 'rascunho') return 'rascunho'
  if (status === 'inativo') return 'encerrado'
  return 'ativo'
}

function buildLegacyRuleFromCaso(caso: CasoPayload): BillingRuleDraft {
  return {
    id: createRuleId(),
    status: getRuleStatusFromCasoStatus(caso.status),
    moeda: caso.moeda || 'real',
    tipo_cobranca_documento: caso.tipo_cobranca_documento || '',
    data_inicio_faturamento: caso.data_inicio_faturamento || '',
    pagamento_dia_mes: caso.pagamento_dia_mes || '',
    inicio_vigencia: caso.inicio_vigencia || '',
    periodo_reajuste: caso.periodo_reajuste || '',
    data_proximo_reajuste: caso.data_proximo_reajuste || '',
    data_ultimo_reajuste: caso.data_ultimo_reajuste || '',
    indice_reajuste: caso.indice_reajuste || '',
    regra_cobranca: normalizeRegraCobranca(caso.regra_cobranca),
    regra_cobranca_config: { ...(caso.regra_cobranca_config || {}) },
    pagadores_servico: [...(caso.pagadores_servico || [])],
    indicacao_config: { ...(caso.indicacao_config || emptyCaso.indicacao_config) },
  }
}

function sanitizeSingleRuleConfig(config: Record<string, any> | undefined | null) {
  const next = { ...(config || {}) }
  delete (next as any).regras_cobranca
  delete (next as any).regras_financeiras
  return next
}

export default function ContratoForm({
  contratoId,
  viewOnly = false,
}: {
  contratoId?: string
  viewOnly?: boolean
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { hasPermission } = usePermissionsContext()
  const { success, error: toastError } = useToast()

  const canWrite =
    hasPermission('contracts.contratos.write') ||
    hasPermission('contracts.contratos.*') ||
    hasPermission('contracts.*')
  const isEdit = !!contratoId
  const isReadOnly = viewOnly || !canWrite

  const [step, setStep] = useState<StepKey>('dados')
  const [substep, setSubstep] = useState<CaseSubstepKey>('basico')
  const [selectedCaseIndex, setSelectedCaseIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<ContratoFormState>(emptyState)
  const [pendingAnexos, setPendingAnexos] = useState<PendingAnexo[]>([])
  const [existingAnexos, setExistingAnexos] = useState<
    Array<{ id: string; nome: string; arquivo_nome: string; created_at: string }>
  >([])
  const [options, setOptions] = useState<ContratoFormOptions>({
    clientes: [],
    prestadores: [],
    parceiros: [],
    grupos_impostos: [],
    servicos: [],
    produtos: [],
    centros_custo: [],
    cargos: [],
    colaboradores: [],
    socios: [],
    tabelas_preco: [],
  })
  const [openingAnexoId, setOpeningAnexoId] = useState<string | null>(null)
  const [removingAnexoId, setRemovingAnexoId] = useState<string | null>(null)
  const [dragRevisorIndex, setDragRevisorIndex] = useState<number | null>(null)
  const [dragAprovadorIndex, setDragAprovadorIndex] = useState<number | null>(null)
  const [priceTableCatalog, setPriceTableCatalog] = useState<TabelaPrecoCatalog[]>([])
  const [creatingPriceTable, setCreatingPriceTable] = useState(false)
  const [newPriceTableName, setNewPriceTableName] = useState('')
  const [priceTableDialogOpen, setPriceTableDialogOpen] = useState(false)
  const [priceTableSaving, setPriceTableSaving] = useState(false)
  const [deleteDraftOpen, setDeleteDraftOpen] = useState(false)
  const [deleteDraftLoading, setDeleteDraftLoading] = useState(false)
  const [draftContratoId, setDraftContratoId] = useState<string | null>(contratoId ?? null)
  const [loadedCaseIds, setLoadedCaseIds] = useState<string[]>([])
  const [loadedCaseStatusById, setLoadedCaseStatusById] = useState<Record<string, string>>({})
  const draftContratoPromiseRef = useRef<Promise<string | null> | null>(null)
  const [anexoDialogOpen, setAnexoDialogOpen] = useState(false)
  const [anexoDialogNome, setAnexoDialogNome] = useState('')
  const [anexoDialogFile, setAnexoDialogFile] = useState<File | null>(null)
  const [anexoDialogFromDrop, setAnexoDialogFromDrop] = useState(false)
  const [anexoDialogTarget, setAnexoDialogTarget] = useState<'contrato' | 'caso'>('contrato')
  const [anexoDialogCaseIndex, setAnexoDialogCaseIndex] = useState<number | null>(null)
  const [pendingCaseAnexos, setPendingCaseAnexos] = useState<Record<number, PendingAnexo[]>>({})
  const [selectedFinanceRuleByCase, setSelectedFinanceRuleByCase] = useState<Record<string, number>>({})
  const [origemSolicitacaoDescricao, setOrigemSolicitacaoDescricao] = useState('')

  const clienteOptions = useMemo(
    () => (options.clientes || []).map((cliente) => ({ value: cliente.id, label: cliente.nome })),
    [options.clientes],
  )
  const grupoImpostoOptions = useMemo(
    () =>
      (options.grupos_impostos || []).map((item) => ({
        value: item.id,
        label: item.descricao ? `${item.nome} (${item.descricao})` : item.nome,
      })),
    [options.grupos_impostos],
  )
  const centroOptions = useMemo(
    () => (options.centros_custo || []).map((item) => ({ value: item.id, label: item.nome })),
    [options.centros_custo],
  )
  const servicoOptions = useMemo(
    () => (options.servicos || []).map((item) => ({ value: item.id, label: item.nome })),
    [options.servicos],
  )
  const produtoOptions = useMemo(
    () => (options.produtos || []).map((item) => ({ value: item.id, label: item.nome })),
    [options.produtos],
  )
  const colaboradorOptions = useMemo(
    () => (options.colaboradores || []).map((item) => ({ value: item.id, label: item.nome })),
    [options.colaboradores],
  )
  const aprovadorOptions = useMemo(
    () => (options.socios || []).map((item) => ({ value: item.id, label: item.nome })),
    [options.socios],
  )
  const produtosMap = useMemo(
    () => new Map((options.produtos || []).map((p) => [p.id, p.nome])),
    [options.produtos],
  )
  const colaboradoresMap = useMemo(
    () => new Map((options.colaboradores || []).map((c) => [c.id, c.nome])),
    [options.colaboradores],
  )
  const centrosMap = useMemo(
    () => new Map((options.centros_custo || []).map((c) => [c.id, c.nome])),
    [options.centros_custo],
  )
  const cargosMap = useMemo(
    () => new Map((options.cargos || []).map((c) => [c.id, c.nome])),
    [options.cargos],
  )
  const indicacaoOptions = useMemo(
    () => [
      ...(options.colaboradores || []).map((p) => ({
        value: `colaborador:${p.id}`,
        label: `${p.nome} (Colaborador)`,
        group: 'Colaboradores',
      })),
      ...(options.clientes || []).map((p) => ({
        value: `cliente:${p.id}`,
        label: `${p.nome} (Cliente)`,
        group: 'Clientes',
      })),
      ...(options.prestadores || []).map((p) => ({
        value: `prestador:${p.id}`,
        label: `${p.nome} (Prestador de Serviço)`,
        group: 'Prestadores de Serviço',
      })),
      ...(options.parceiros || []).map((p) => ({
        value: `parceiro:${p.id}`,
        label: `${p.nome} (Parceiro)`,
        group: 'Parceiros',
      })),
    ],
    [options.colaboradores, options.clientes, options.prestadores, options.parceiros],
  )
  const grupoImpostoMap = useMemo(
    () => new Map((options.grupos_impostos || []).map((item) => [item.id, item.nome])),
    [options.grupos_impostos],
  )

  const currentCaso = form.casos[selectedCaseIndex] || emptyCaso
  const currentCaseKey = String((currentCaso as any)?.id || `idx:${selectedCaseIndex}`)
  const getCasoFinanceRules = (caso: CasoPayload): BillingRuleDraft[] => {
    const fromCaseArray = Array.isArray((caso as any)?.regras_financeiras)
      ? ((caso as any).regras_financeiras as any[])
      : []
    if (fromCaseArray.length > 0) {
      return fromCaseArray.map((rule, idx) => ({
        id: String(rule?.id || createRuleId()),
        status: (rule?.status || 'ativo') as BillingRuleStatus,
        moeda: (rule?.moeda || 'real') as CasoPayload['moeda'],
        tipo_cobranca_documento: (rule?.tipo_cobranca_documento || '') as CasoPayload['tipo_cobranca_documento'],
        data_inicio_faturamento: String(rule?.data_inicio_faturamento || ''),
        pagamento_dia_mes: String(rule?.pagamento_dia_mes || ''),
        inicio_vigencia: String(rule?.inicio_vigencia || ''),
        periodo_reajuste: String(rule?.periodo_reajuste || ''),
        data_proximo_reajuste: String(rule?.data_proximo_reajuste || ''),
        data_ultimo_reajuste: String(rule?.data_ultimo_reajuste || ''),
        indice_reajuste: String(rule?.indice_reajuste || ''),
        regra_cobranca: normalizeRegraCobranca(rule?.regra_cobranca as CasoPayload['regra_cobranca']),
        regra_cobranca_config: {
          ...emptyCaso.regra_cobranca_config,
          ...sanitizeSingleRuleConfig(rule?.regra_cobranca_config || {}),
        },
        pagadores_servico: Array.isArray(rule?.pagadores_servico) ? rule.pagadores_servico : [],
        indicacao_config: { ...(rule?.indicacao_config || caso.indicacao_config || emptyCaso.indicacao_config) },
      }))
    }

    const fromLegacyConfig = Array.isArray((caso.regra_cobranca_config as any)?.regras_cobranca)
      ? (((caso.regra_cobranca_config as any).regras_cobranca || []) as any[])
      : []
    if (fromLegacyConfig.length > 0) {
      return fromLegacyConfig.map((rule) => ({
        ...buildLegacyRuleFromCaso(caso),
        ...rule,
        id: String(rule?.id || createRuleId()),
        status: (rule?.status || 'ativo') as BillingRuleStatus,
        regra_cobranca: normalizeRegraCobranca(rule?.regra_cobranca as CasoPayload['regra_cobranca']),
        regra_cobranca_config: {
          ...emptyCaso.regra_cobranca_config,
          ...sanitizeSingleRuleConfig(rule?.regra_cobranca_config || {}),
        },
        indicacao_config: { ...(rule?.indicacao_config || caso.indicacao_config || emptyCaso.indicacao_config) },
      }))
    }

    return [buildLegacyRuleFromCaso(caso)]
  }
  const currentFinanceRules = getCasoFinanceRules(currentCaso)
  const selectedFinanceRuleIndex = Math.min(
    Math.max(selectedFinanceRuleByCase[currentCaseKey] ?? 0, 0),
    Math.max(currentFinanceRules.length - 1, 0),
  )
  const currentFinanceRule = currentFinanceRules[selectedFinanceRuleIndex] || currentFinanceRules[0]
  const regras = currentCaso.regra_cobranca_config || {}
  const despesas = currentCaso.despesas_config || {}
  const timesheet = currentCaso.timesheet_config || {}
  const indicacao = currentCaso.indicacao_config || {}
  const despesasSelecionadas: string[] = despesas.despesas_reembolsaveis || []
  const despesasReembolsaveisEnabled =
    Boolean((despesas as any).reembolsavel_ativo) || (despesasSelecionadas.length > 0 && !despesasSelecionadas.includes('nao'))
  const showDespesaDetalhes = despesasReembolsaveisEnabled
  const modoPreco = regras.modo_preco || (regras.tabela_preco_id || regras.tabela_preco_nome ? 'tabela' : 'valor_hora')
  const indicacaoPagamentoEnabled =
    Boolean((indicacao as any).pagamento_indicacao_ativo) ||
    (Boolean(indicacao.pagamento_indicacao) && indicacao.pagamento_indicacao !== 'nao')
  const crossSellEnabled = Boolean(regras.cross_sell_ativo)
  const crossSellPeriodicidade = String(regras.cross_sell_periodicidade || 'mensal')
  const crossSellModo = regras.cross_sell_modo === 'valor' ? 'valor' : 'percentual'
  const capMinEnabled = Boolean(
    regras.cap_min_enabled ??
      regras.cap_limites_enabled ??
      (regras.cap_min !== null && regras.cap_min !== undefined && String(regras.cap_min).trim() !== ''),
  )
  const capMaxEnabled = Boolean(
    regras.cap_max_enabled ??
      regras.cap_limites_enabled ??
      (regras.cap_max !== null && regras.cap_max !== undefined && String(regras.cap_max).trim() !== ''),
  )
  const isCurrentFinanceRuleDraft = (currentFinanceRule?.status || 'rascunho') === 'rascunho'
  const isCurrentFinanceRuleClosed = (currentFinanceRule?.status || '') === 'encerrado'
  const reajusteEnabled = (currentCaso.periodo_reajuste || 'nao_tem') !== 'nao_tem'
  const capDesejadoEnabled = Boolean(
    regras.cap_desejado_enabled ??
      (regras.cap_desejado_horas !== null &&
        regras.cap_desejado_horas !== undefined &&
        String(regras.cap_desejado_horas).trim() !== ''),
  )

  const composeCurrentFinanceRule = (base?: BillingRuleDraft): BillingRuleDraft => ({
    id: base?.id || createRuleId(),
    status: base?.status || 'rascunho',
    moeda: currentCaso.moeda || 'real',
    tipo_cobranca_documento: currentCaso.tipo_cobranca_documento || '',
    data_inicio_faturamento: currentCaso.data_inicio_faturamento || '',
    pagamento_dia_mes: currentCaso.pagamento_dia_mes || '',
    inicio_vigencia: currentCaso.inicio_vigencia || '',
    periodo_reajuste: currentCaso.periodo_reajuste || '',
    data_proximo_reajuste: currentCaso.data_proximo_reajuste || '',
    data_ultimo_reajuste: currentCaso.data_ultimo_reajuste || '',
    indice_reajuste: currentCaso.indice_reajuste || '',
    regra_cobranca: normalizeRegraCobranca(currentCaso.regra_cobranca),
    regra_cobranca_config: sanitizeSingleRuleConfig(currentCaso.regra_cobranca_config || {}),
    pagadores_servico: [...(currentCaso.pagadores_servico || [])],
    indicacao_config: { ...(currentCaso.indicacao_config || emptyCaso.indicacao_config) },
  })

  const setFinanceRulesForCurrentCase = (rules: BillingRuleDraft[]) => {
    const normalizedRules = rules.map((rule) => ({
      ...rule,
      regra_cobranca_config: sanitizeSingleRuleConfig(rule.regra_cobranca_config || {}),
    }))
    setForm((prev) => {
      const next = [...prev.casos]
      const current = next[selectedCaseIndex]
      if (!current) return prev

      const currentRules = Array.isArray(current.regras_financeiras)
        ? current.regras_financeiras.map((rule: any) => ({
            ...rule,
            regra_cobranca_config: sanitizeSingleRuleConfig(rule?.regra_cobranca_config || {}),
          }))
        : []
      const sameRules = JSON.stringify(currentRules) === JSON.stringify(normalizedRules)

      const currentLegacyRules = Array.isArray((current.regra_cobranca_config as any)?.regras_cobranca)
        ? ((current.regra_cobranca_config as any).regras_cobranca || []).map((rule: any) => ({
            ...rule,
            regra_cobranca_config: sanitizeSingleRuleConfig(rule?.regra_cobranca_config || {}),
          }))
        : []
      const sameLegacyRules = JSON.stringify(currentLegacyRules) === JSON.stringify(normalizedRules)

      if (sameRules && sameLegacyRules) return prev

      next[selectedCaseIndex] = {
        ...current,
        regras_financeiras: normalizedRules,
        regra_cobranca_config: {
          ...sanitizeSingleRuleConfig(current.regra_cobranca_config || {}),
          regras_cobranca: normalizedRules,
        },
      }
      return { ...prev, casos: next }
    })
  }

  const applyFinanceRuleToCurrentCaso = (rule: BillingRuleDraft) => {
    updateCurrentCaso({
      moeda: rule.moeda,
      tipo_cobranca_documento: rule.tipo_cobranca_documento,
      data_inicio_faturamento: rule.data_inicio_faturamento,
      pagamento_dia_mes: rule.pagamento_dia_mes,
      inicio_vigencia: rule.inicio_vigencia,
      periodo_reajuste: rule.periodo_reajuste,
      data_proximo_reajuste: rule.data_proximo_reajuste,
      data_ultimo_reajuste: rule.data_ultimo_reajuste,
      indice_reajuste: rule.indice_reajuste,
      regra_cobranca: rule.regra_cobranca,
      regra_cobranca_config: sanitizeSingleRuleConfig(rule.regra_cobranca_config || {}),
      pagadores_servico: [...(rule.pagadores_servico || [])],
      indicacao_config: { ...(rule.indicacao_config || emptyCaso.indicacao_config) },
    })
  }

  const validateDados = () => {
    if (!form.cliente_id) return 'Cliente é obrigatório'
    if (!form.nome_contrato.trim()) return 'Nome do contrato é obrigatório'
    if (!form.forma_entrada) return 'Forma de entrada é obrigatória'
    return null
  }

  const validateCasoBasico = (caso: CasoPayload) => {
    if (!caso.nome.trim()) return 'Nome do caso é obrigatório'
    if (!caso.servico_id) return 'Serviço do caso é obrigatório'
    if (!caso.produto_id) return 'Produto do caso é obrigatório'
    if (!caso.responsavel_id) return 'Responsável do caso é obrigatório'
    return null
  }

  const validateCasoFinanceiro = (caso: CasoPayload) => {
    if (!caso.tipo_cobranca_documento) return 'Tipo de cobrança é obrigatório'
    if (!caso.regra_cobranca) return 'Regra de cobrança é obrigatória'
    if (caso.regra_cobranca === 'hora') {
      const regrasCaso = caso.regra_cobranca_config || {}
      const modo = regrasCaso.modo_preco || (regrasCaso.tabela_preco_id || regrasCaso.tabela_preco_nome ? 'tabela' : 'valor_hora')
      if (modo === 'valor_hora' && !String(regrasCaso.valor_hora || '').trim()) {
        return 'Informe o valor da hora ou selecione tabela de preço'
      }
      if (modo === 'valor_hora' && regrasCaso.cobra_excedente && !String(regrasCaso.valor_hora_excedente || '').trim()) {
        return 'Informe o valor da hora excedente'
      }
      if (modo === 'tabela') {
        if (!String(regrasCaso.tabela_preco_id || regrasCaso.tabela_preco_nome || '').trim()) {
          return 'Selecione ou cadastre uma tabela de preço'
        }
        if (!Array.isArray(regrasCaso.tabela_preco_itens) || regrasCaso.tabela_preco_itens.length === 0) {
          return 'A tabela de preço precisa ter itens por cargo'
        }
      }
      if (regrasCaso.cap_enabled && regrasCaso.encontro_contas_enabled && !String(regrasCaso.encontro_periodicidade || '').trim()) {
        return 'Selecione a periodicidade do encontro de contas'
      }
    }
    if (caso.regra_cobranca === 'mensalidade_processo' && !String(caso.regra_cobranca_config?.valor_mensal || '').trim()) {
      return 'Informe o valor mensal da mensalidade de processo'
    }
    return null
  }

  const calcRateioTotal = (items: Array<{ percentual?: number | null }> = []) =>
    items.reduce((acc, item) => acc + (Number(item.percentual) || 0), 0)

  const validateRateio = (
    items: Array<{ percentual?: number | null }> = [],
    label: string,
    requiredWhenHasRows = true,
  ): string | null => {
    if (!items.length) return null
    const total = calcRateioTotal(items)
    if (requiredWhenHasRows && total !== 100) return `${label}: a soma dos percentuais deve ser 100% (atual ${total}%)`
    return null
  }

  const validateSubstepGate = (target: CaseSubstepKey): string | null => {
    const targetIndex = caseSubsteps.findIndex((s) => s.key === target)
    const basicoIndex = caseSubsteps.findIndex((s) => s.key === 'basico')
    const financeiroIndex = caseSubsteps.findIndex((s) => s.key === 'financeiro')
    if (targetIndex > basicoIndex) {
      const err = validateCasoBasico(currentCaso)
      if (err) return err
    }
    if (targetIndex > financeiroIndex) {
      const err = validateCasoFinanceiro(currentCaso)
      if (err) return err
    }
    return null
  }

  const canGoToStep = (target: StepKey) => {
    if (target === 'dados') return true
    return !validateDados()
  }

  const isCaseEmpty = (caso: CasoPayload) =>
    !caso.nome?.trim() &&
    !caso.produto_id &&
    !caso.responsavel_id &&
    !caso.tipo_cobranca_documento &&
    !caso.regra_cobranca &&
    !caso.indice_reajuste &&
    (caso.centro_custo_rateio || []).length === 0 &&
    (caso.pagadores_servico || []).length === 0 &&
    (caso.pagadores_despesa || []).length === 0

  const isCaseComplete = (caso: CasoPayload) =>
    !validateCasoBasico(caso) &&
    !validateCasoFinanceiro(caso) &&
    !validateRateio(caso.centro_custo_rateio || [], 'Centro de custo') &&
    !validateRateio(caso.pagadores_servico || [], 'Pagador do serviço') &&
    !validateRateio(caso.pagadores_despesa || [], 'Pagador da despesa')

  const openStep = (target: StepKey) => {
    if (target === 'casos' && !isEdit) {
      void goNextStep()
      return
    }
    if (canGoToStep(target)) {
      setStep(target)
      return
    }
    const validationError = validateDados()
    if (validationError) setError(validationError)
  }

  const openSubstep = (target: CaseSubstepKey) => {
    const gateError = validateSubstepGate(target)
    if (gateError) {
      setError(gateError)
      return
    }
    setError(null)
    setSubstep(target)
  }

  useEffect(() => {
    const fetchData = async () => {
      setInitialLoading(true)
      setError(null)

      try {
        const supabase = createClient()
        const {
          data: { session },
        } = await supabase.auth.getSession()
        if (!session) return

        const optsResp = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-contrato-form-options`,
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              'Content-Type': 'application/json',
            },
          },
        )

        const optsData = await optsResp.json()
        if (!optsResp.ok) {
          setError(optsData.error || 'Erro ao carregar opções do formulário')
          return
        }
        const nextOptions = optsData.data || {
          clientes: [],
          prestadores: [],
          parceiros: [],
          grupos_impostos: [],
          servicos: [],
          produtos: [],
          centros_custo: [],
          cargos: [],
          colaboradores: [],
          socios: [],
          tabelas_preco: [],
        }

        if (!Array.isArray(nextOptions.cargos) || nextOptions.cargos.length === 0) {
          try {
            const cargosResp = await fetch(
              `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-cargos`,
              {
                method: 'GET',
                headers: {
                  Authorization: `Bearer ${session.access_token}`,
                  'Content-Type': 'application/json',
                },
              },
            )
            const cargosData = await cargosResp.json()
            if (cargosResp.ok && Array.isArray(cargosData.data)) {
              nextOptions.cargos = cargosData.data
                .filter((item: any) => item?.ativo !== false)
                .map((item: any) => ({ id: item.id, nome: item.nome }))
            }
          } catch (cargosError) {
            console.error('Fallback de cargos falhou', cargosError)
          }
        }

        setOptions(nextOptions)
        setPriceTableCatalog(
          (nextOptions.tabelas_preco || []).map((table: any) => ({
            id: table.id,
            nome: table.nome,
            itens: table.itens || [],
          })),
        )

        if (isEdit && contratoId) {
          const contratoResp = await fetch(
            `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-contrato?id=${contratoId}`,
            {
              method: 'GET',
              headers: {
                Authorization: `Bearer ${session.access_token}`,
                'Content-Type': 'application/json',
              },
            },
          )

          const contratoData = await contratoResp.json()
          if (!contratoResp.ok) {
            setError(contratoData.error || 'Erro ao carregar contrato')
            return
          }

          const contrato = contratoData.data?.contrato || {}
          const casos = (contratoData.data?.casos || []) as CasoPayload[]
          const persistedCaseIds = casos
            .map((caso) => ((caso as any)?.id ? String((caso as any).id) : ''))
            .filter(Boolean)
          const persistedCaseStatus = casos.reduce<Record<string, string>>((acc, caso) => {
            const id = (caso as any)?.id ? String((caso as any).id) : ''
            if (!id) return acc
            acc[id] = String((caso as any)?.status || 'rascunho')
            return acc
          }, {})

          setForm({
            cliente_id: contrato.cliente_id || '',
            nome_contrato: contrato.nome_contrato || '',
            forma_entrada: (contrato.forma_entrada || '') as 'organico' | 'prospeccao' | '',
            responsavel_prospeccao_id: String((contrato as any).responsavel_prospeccao_id || ''),
            canal_prospeccao: String((contrato as any).canal_prospeccao || ''),
            grupo_imposto_id: String(contrato.grupo_imposto_id || ''),
            status: normalizeContratoStatus(contrato.status || 'rascunho'),
            casos: casos.length
              ? casos.map((caso) => ({
                  ...emptyCaso,
                  ...caso,
                  regra_cobranca: normalizeRegraCobranca(caso.regra_cobranca as CasoPayload['regra_cobranca']),
                  pagamento_dia_mes: caso.pagamento_dia_mes ? String(caso.pagamento_dia_mes) : '',
                  regra_cobranca_config: {
                    ...emptyCaso.regra_cobranca_config,
                    ...sanitizeSingleRuleConfig(caso.regra_cobranca_config || {}),
                  },
                  regras_financeiras: Array.isArray((caso as any)?.regras_financeiras)
                    ? ((caso as any).regras_financeiras as any[]).map((rule) => ({
                        id: String(rule?.id || createRuleId()),
                        status: String(rule?.status || 'ativo'),
                        moeda: rule?.moeda || 'real',
                        tipo_cobranca_documento: rule?.tipo_cobranca_documento || '',
                        data_inicio_faturamento: String(rule?.data_inicio_faturamento || ''),
                        pagamento_dia_mes: String(rule?.pagamento_dia_mes || ''),
                        inicio_vigencia: String(rule?.inicio_vigencia || ''),
                        periodo_reajuste: String(rule?.periodo_reajuste || ''),
                        data_proximo_reajuste: String(rule?.data_proximo_reajuste || ''),
                        data_ultimo_reajuste: String(rule?.data_ultimo_reajuste || ''),
                        indice_reajuste: String(rule?.indice_reajuste || ''),
                        regra_cobranca: normalizeRegraCobranca(rule?.regra_cobranca as CasoPayload['regra_cobranca']),
                        regra_cobranca_config: {
                          ...emptyCaso.regra_cobranca_config,
                          ...sanitizeSingleRuleConfig(rule?.regra_cobranca_config || {}),
                        },
                        pagadores_servico: Array.isArray(rule?.pagadores_servico) ? rule.pagadores_servico : [],
                        indicacao_config: {
                          ...(rule?.indicacao_config || caso.indicacao_config || emptyCaso.indicacao_config),
                        },
                      }))
                    : undefined,
                  despesas_config: { ...emptyCaso.despesas_config, ...(caso.despesas_config || {}) },
                  timesheet_config: { ...emptyCaso.timesheet_config, ...(caso.timesheet_config || {}) },
                  indicacao_config: { ...emptyCaso.indicacao_config, ...(caso.indicacao_config || {}) },
                }))
              : [{ ...emptyCaso }],
          })

          setLoadedCaseIds(persistedCaseIds)
          setLoadedCaseStatusById(persistedCaseStatus)
          setExistingAnexos(contratoData.data?.anexos || [])
          setOrigemSolicitacaoDescricao(String(contrato?.solicitacao_descricao || ''))
        } else {
          setLoadedCaseIds([])
          setLoadedCaseStatusById({})
          setOrigemSolicitacaoDescricao('')
          setForm((prev) => ({
            ...prev,
            grupo_imposto_id: '',
            responsavel_prospeccao_id: '',
            canal_prospeccao: '',
          }))
        }
      } catch (fetchError) {
        console.error(fetchError)
        setError('Erro ao carregar dados do contrato')
      } finally {
        setInitialLoading(false)
      }
    }

    fetchData()
  }, [isEdit, contratoId])

  useEffect(() => {
    if (contratoId) setDraftContratoId(contratoId)
  }, [contratoId])

  useEffect(() => {
    const targetStep = searchParams.get('step')
    if (targetStep === 'casos') {
      setStep('casos')
    }
  }, [searchParams])

  useEffect(() => {
    const found = new Map<string, TabelaPrecoCatalog>()
    for (const caso of form.casos) {
      const nome = caso.regra_cobranca_config?.tabela_preco_nome
      const id = caso.regra_cobranca_config?.tabela_preco_id
      const itens = caso.regra_cobranca_config?.tabela_preco_itens
      if (nome && Array.isArray(itens)) {
        found.set(nome, { id, nome, itens })
      }
    }
    if (found.size > 0) {
      setPriceTableCatalog((prev) => {
        const prevMap = new Map(prev.map((item) => [item.nome, item]))
        for (const [nome, table] of found.entries()) prevMap.set(nome, table)
        return [...prevMap.values()]
      })
    }
  }, [form.casos])

  useEffect(() => {
    if (isReadOnly) return
    if (step !== 'casos' || substep !== 'financeiro') return
    if (currentCaso.regra_cobranca !== 'hora') return
    if (modoPreco !== 'tabela') return
    if (priceTableCatalog.length === 0 || creatingPriceTable) {
      setPriceTableDialogOpen(true)
    }
  }, [
    isReadOnly,
    step,
    substep,
    currentCaso.regra_cobranca,
    modoPreco,
    priceTableCatalog.length,
    creatingPriceTable,
  ])

  useEffect(() => {
    if (isEdit) return
    const months = periodToMonths[currentCaso.periodo_reajuste] || 0
    if (!months) return

    const base = currentCaso.data_ultimo_reajuste || currentCaso.inicio_vigencia
    if (!base) return

    const calculated = buildNextDate(base, months)
    if (!calculated || calculated === currentCaso.data_proximo_reajuste) return

    updateCurrentCaso({ data_proximo_reajuste: calculated })
  }, [
    isEdit,
    selectedCaseIndex,
    currentCaso.periodo_reajuste,
    currentCaso.inicio_vigencia,
    currentCaso.data_ultimo_reajuste,
    currentCaso.data_proximo_reajuste,
  ])

  useEffect(() => {
    if (currentCaso.regra_cobranca !== 'hora') return
    const hasCapDesejado = Boolean(regras.cap_desejado_enabled) || String(regras.cap_desejado_horas || '').trim() !== ''
    if (!hasCapDesejado) return

    setForm((prev) => {
      const next = [...prev.casos]
      const current = next[selectedCaseIndex]
      if (!current) return prev
      const currentRegras = { ...(current.regra_cobranca_config || {}) }
      const currentHasCapDesejado =
        Boolean(currentRegras.cap_desejado_enabled) || String(currentRegras.cap_desejado_horas || '').trim() !== ''
      if (!currentHasCapDesejado) return prev

      next[selectedCaseIndex] = {
        ...current,
        regra_cobranca_config: {
          ...currentRegras,
          cap_desejado_enabled: false,
          cap_desejado_horas: '',
        },
      }
      return { ...prev, casos: next }
    })
  }, [
    currentCaso.regra_cobranca,
    regras.cap_desejado_enabled,
    regras.cap_desejado_horas,
    selectedCaseIndex,
  ])

  useEffect(() => {
    setForm((prev) => {
      const next = [...prev.casos]
      const current = next[selectedCaseIndex]
      if (!current) return prev

      const regrasCaso = { ...(current.regra_cobranca_config || {}) }
      let changed = false
      const inicioVigencia = current.inicio_vigencia || ''

      if ((regrasCaso.data_ultimo_encontro || '') !== inicioVigencia) {
        regrasCaso.data_ultimo_encontro = inicioVigencia
        changed = true
      }

      if (!regrasCaso.encontro_contas_enabled) {
        if (regrasCaso.data_proximo_encontro) {
          regrasCaso.data_proximo_encontro = ''
          changed = true
        }
      } else if (regrasCaso.encontro_periodicidade && regrasCaso.data_ultimo_encontro) {
        const months = periodToMonths[regrasCaso.encontro_periodicidade] || 0
        if (months > 0) {
          const day = Number(current.pagamento_dia_mes || '0') || undefined
          const calculated = buildNextDate(regrasCaso.data_ultimo_encontro, months, day)
          if (!isEdit || !regrasCaso.data_proximo_encontro) {
            if ((regrasCaso.data_proximo_encontro || '') !== calculated) {
              regrasCaso.data_proximo_encontro = calculated
              changed = true
            }
          }
        }
      }

      if (!changed) return prev
      next[selectedCaseIndex] = { ...current, regra_cobranca_config: regrasCaso }
      return { ...prev, casos: next }
    })
  }, [
    selectedCaseIndex,
    currentCaso.inicio_vigencia,
    currentCaso.pagamento_dia_mes,
    regras.encontro_contas_enabled,
    regras.encontro_periodicidade,
    isEdit,
  ])

  useEffect(() => {
    if (step !== 'casos' || substep !== 'financeiro') return
    if (!currentFinanceRules[selectedFinanceRuleIndex]) return
    const nextRules = [...currentFinanceRules]
    nextRules[selectedFinanceRuleIndex] = {
      ...composeCurrentFinanceRule(nextRules[selectedFinanceRuleIndex]),
      status: nextRules[selectedFinanceRuleIndex].status || 'rascunho',
    }
    setFinanceRulesForCurrentCase(nextRules)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedCaseIndex,
    selectedFinanceRuleIndex,
    currentCaso.moeda,
    currentCaso.tipo_cobranca_documento,
    currentCaso.data_inicio_faturamento,
    currentCaso.pagamento_dia_mes,
    currentCaso.inicio_vigencia,
    currentCaso.periodo_reajuste,
    currentCaso.data_proximo_reajuste,
    currentCaso.data_ultimo_reajuste,
    currentCaso.indice_reajuste,
    currentCaso.regra_cobranca,
    currentCaso.regra_cobranca_config,
    currentCaso.pagadores_servico,
    currentCaso.indicacao_config,
    step,
    substep,
  ])

  const updateCaso = (index: number, patch: Partial<CasoPayload>) => {
    setForm((prev) => {
      const next = [...prev.casos]
      next[index] = { ...next[index], ...patch }
      return { ...prev, casos: next }
    })
  }

  const updateCurrentCaso = (patch: Partial<CasoPayload>) => {
    updateCaso(selectedCaseIndex, patch)
  }

  const updateCurrentRegra = (field: string, value: any) => {
    setForm((prev) => {
      const next = [...prev.casos]
      const current = next[selectedCaseIndex] || { ...emptyCaso }
      next[selectedCaseIndex] = {
        ...current,
        regra_cobranca_config: {
          ...(current.regra_cobranca_config || {}),
          [field]: value,
        },
      }
      return { ...prev, casos: next }
    })
  }

  const updateCurrentDespesas = (field: string, value: any) => {
    setForm((prev) => {
      const next = [...prev.casos]
      const current = next[selectedCaseIndex] || { ...emptyCaso }
      next[selectedCaseIndex] = {
        ...current,
        despesas_config: {
          ...(current.despesas_config || {}),
          [field]: value,
        },
      }
      return { ...prev, casos: next }
    })
  }

  const updateCurrentTimesheet = (field: string, value: any) => {
    setForm((prev) => {
      const next = [...prev.casos]
      const current = next[selectedCaseIndex] || { ...emptyCaso }
      next[selectedCaseIndex] = {
        ...current,
        timesheet_config: {
          ...(current.timesheet_config || {}),
          [field]: value,
        },
      }
      return { ...prev, casos: next }
    })
  }

  const updateCurrentIndicacao = (field: string, value: any) => {
    setForm((prev) => {
      const next = [...prev.casos]
      const current = next[selectedCaseIndex] || { ...emptyCaso }
      next[selectedCaseIndex] = {
        ...current,
        indicacao_config: {
          ...(current.indicacao_config || {}),
          [field]: value,
        },
      }
      return { ...prev, casos: next }
    })
  }

  const updateCurrentCrossSell = (field: string, value: any) => {
    updateCurrentRegra(`cross_sell_${field}`, value)
  }

  const setIndicacaoPeriodicidade = (periodicidade: string) => {
    updateCurrentIndicacao('periodicidade', periodicidade)
    if (periodicidade === 'mensal') {
      updateCurrentIndicacao('usar_dia_vencimento', true)
      updateCurrentIndicacao('parcelas_pagamento', [])
      if (!indicacao.data_fim_pagamentos) {
        updateCurrentIndicacao('data_fim_pagamentos', currentCaso.inicio_vigencia || currentCaso.data_inicio_faturamento || '')
      }
      return
    }
    if (periodicidade === 'parcelado') {
      updateCurrentIndicacao('data_pagamento_unico', '')
      if (!Array.isArray(indicacao.parcelas_pagamento) || indicacao.parcelas_pagamento.length === 0) {
        updateCurrentIndicacao('parcelas_pagamento', [{ valor: '', data_pagamento: '' }])
      }
      return
    }
    updateCurrentIndicacao('parcelas_pagamento', [])
    updateCurrentIndicacao('data_fim_pagamentos', '')
    updateCurrentIndicacao('dia_pagamento_mensal', '')
    if (!indicacao.data_pagamento_unico) {
      updateCurrentIndicacao('data_pagamento_unico', currentCaso.inicio_vigencia || currentCaso.data_inicio_faturamento || '')
    }
  }

  const addIndicacaoParcela = () => {
    const parcelas = Array.isArray(indicacao.parcelas_pagamento) ? indicacao.parcelas_pagamento : []
    updateCurrentIndicacao('parcelas_pagamento', [...parcelas, { valor: '', data_pagamento: '' }])
  }

  const updateIndicacaoParcela = (idx: number, field: 'valor' | 'data_pagamento', value: string) => {
    const parcelas = Array.isArray(indicacao.parcelas_pagamento) ? [...indicacao.parcelas_pagamento] : []
    if (!parcelas[idx]) return
    parcelas[idx] = { ...parcelas[idx], [field]: value }
    updateCurrentIndicacao('parcelas_pagamento', parcelas)
  }

  const removeIndicacaoParcela = (idx: number) => {
    const parcelas = Array.isArray(indicacao.parcelas_pagamento) ? [...indicacao.parcelas_pagamento] : []
    parcelas.splice(idx, 1)
    updateCurrentIndicacao('parcelas_pagamento', parcelas)
  }

  const setCrossSellPeriodicidade = (periodicidade: string) => {
    updateCurrentCrossSell('periodicidade', periodicidade)
    if (periodicidade === 'mensal') {
      updateCurrentCrossSell('usar_dia_vencimento', true)
      updateCurrentCrossSell('parcelas_pagamento', [])
      if (!regras.cross_sell_data_fim_pagamentos) {
        updateCurrentCrossSell('data_fim_pagamentos', currentCaso.inicio_vigencia || currentCaso.data_inicio_faturamento || '')
      }
      return
    }
    if (periodicidade === 'parcelado') {
      updateCurrentCrossSell('data_pagamento_unico', '')
      const parcelas = Array.isArray(regras.cross_sell_parcelas_pagamento) ? regras.cross_sell_parcelas_pagamento : []
      if (parcelas.length === 0) {
        updateCurrentCrossSell('parcelas_pagamento', [{ valor: '', data_pagamento: '' }])
      }
      return
    }
    updateCurrentCrossSell('parcelas_pagamento', [])
    updateCurrentCrossSell('data_fim_pagamentos', '')
    updateCurrentCrossSell('dia_pagamento_mensal', '')
    if (!String(regras.cross_sell_data_pagamento_unico || '').trim()) {
      updateCurrentCrossSell('data_pagamento_unico', currentCaso.inicio_vigencia || currentCaso.data_inicio_faturamento || '')
    }
  }

  const addCrossSellParcela = () => {
    const parcelas = Array.isArray(regras.cross_sell_parcelas_pagamento) ? regras.cross_sell_parcelas_pagamento : []
    updateCurrentCrossSell('parcelas_pagamento', [...parcelas, { valor: '', data_pagamento: '' }])
  }

  const updateCrossSellParcela = (idx: number, field: 'valor' | 'data_pagamento', value: string) => {
    const parcelas = Array.isArray(regras.cross_sell_parcelas_pagamento) ? [...regras.cross_sell_parcelas_pagamento] : []
    if (!parcelas[idx]) return
    parcelas[idx] = { ...parcelas[idx], [field]: value }
    updateCurrentCrossSell('parcelas_pagamento', parcelas)
  }

  const removeCrossSellParcela = (idx: number) => {
    const parcelas = Array.isArray(regras.cross_sell_parcelas_pagamento) ? [...regras.cross_sell_parcelas_pagamento] : []
    parcelas.splice(idx, 1)
    updateCurrentCrossSell('parcelas_pagamento', parcelas)
  }

  const setCentroRateio = (items: Array<{ id: string; percentual: number }>) => {
    updateCurrentCaso({
      centro_custo_rateio: items.map((item) => ({
        centro_custo_id: item.id,
        percentual: item.percentual,
      })),
    })
  }

  const setPagadoresServicoRateio = (items: Array<{ id: string; percentual: number }>) => {
    updateCurrentCaso({
      pagadores_servico: items.map((item) => ({
        cliente_id: item.id,
        percentual: item.percentual,
      })),
    })
  }

  const setPagadoresDespesaRateio = (items: Array<{ id: string; percentual: number }>) => {
    updateCurrentCaso({
      pagadores_despesa: items.map((item) => ({
        cliente_id: item.id,
        percentual: item.percentual,
      })),
    })
  }

  const buildDefaultTabelaPrecoItens = (): TabelaPrecoItem[] =>
    (options.cargos || []).map((cargo) => ({
      cargo_id: cargo.id,
      cargo_nome: cargo.nome,
      valor_hora: '',
      valor_hora_excedente: '',
    }))

  const getPriceTableByKey = (key: string) =>
    priceTableCatalog.find((table) => table.id === key || table.nome === key)

  const upsertPriceTableCatalog = (payload: { id?: string; nome: string; itens: TabelaPrecoItem[] }) => {
    const { id, nome, itens } = payload
    if (!nome.trim()) return
    setPriceTableCatalog((prev) => {
      const list = prev.filter((item) => item.nome !== nome && (!id || item.id !== id))
      return [...list, { id, nome, itens }]
    })
  }

  const priceTableOptions = useMemo(
    () => [
      ...priceTableCatalog.map((table) => ({ value: table.id || table.nome, label: table.nome })),
      { value: '__new__', label: '+ Nova tabela de preço' },
    ],
    [priceTableCatalog],
  )

  const savePriceTable = async () => {
    const nome = creatingPriceTable ? newPriceTableName.trim() : (regras.tabela_preco_nome || '').trim()
    if (!nome) {
      setError('Nome da tabela é obrigatório')
      return
    }

    const itens: TabelaPrecoItem[] = (regras.tabela_preco_itens || []).length
      ? regras.tabela_preco_itens
      : buildDefaultTabelaPrecoItens()

    try {
      setPriceTableSaving(true)
      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) return

      const resp = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/upsert-tabela-preco`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: creatingPriceTable ? null : regras.tabela_preco_id || null,
          nome,
          itens,
        }),
      })
      const data = await resp.json()
      if (!resp.ok) {
        setError(data.error || 'Erro ao salvar tabela de preço')
        return
      }

      const saved = data.data || {}
      const savedTable: TabelaPrecoCatalog = {
        id: saved.id,
        nome: saved.nome || nome,
        itens: saved.itens || itens,
      }
      upsertPriceTableCatalog(savedTable)
      updateCurrentRegra('modo_preco', 'tabela')
      updateCurrentRegra('tabela_preco_id', savedTable.id || '')
      updateCurrentRegra('tabela_preco_nome', savedTable.nome)
      updateCurrentRegra('tabela_preco_itens', savedTable.itens)
      setCreatingPriceTable(false)
      setNewPriceTableName('')
      success('Tabela de preço salva')
      setError(null)
    } catch (e) {
      console.error(e)
      setError('Erro ao salvar tabela de preço')
    } finally {
      setPriceTableSaving(false)
    }
  }

  const parseAmount = (value: string | number | null | undefined) => {
    if (value === null || value === undefined) return 0
    const raw = String(value).trim()
    if (!raw) return 0
    if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw)
    const normalized = raw.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')
    const parsed = Number(normalized)
    return Number.isFinite(parsed) ? parsed : 0
  }

  const getProjetoValor = () => parseAmount(regras.valor_projeto)
  const getParcelasValorTotal = () =>
    (regras.parcelas || []).reduce((acc: number, parcela: any) => acc + parseAmount(parcela.valor), 0)
  const getParcelasRestante = () => getProjetoValor() - getParcelasValorTotal()
  const formatAmount = (value: number) =>
    value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const applyParcelasShortcut = (weights: number[]) => {
    const total = getProjetoValor()
    if (!total || total <= 0) {
      setError('Informe o valor do projeto antes de usar os atalhos de parcelas')
      return
    }
    const totalWeight = weights.reduce((acc, value) => acc + value, 0)
    if (!totalWeight) return
    const baseDate =
      currentCaso.data_inicio_faturamento || currentCaso.inicio_vigencia || new Date().toISOString().slice(0, 10)

    const parcelas = weights.map((weight, idx) => ({
      valor: (Math.round(((total * weight) / totalWeight) * 100) / 100).toFixed(2),
      data_pagamento: idx === 0 ? baseDate : '',
    }))
    const diff = total - parcelas.reduce((acc, p) => acc + Number(p.valor || 0), 0)
    if (parcelas.length > 0 && Math.abs(diff) > 0.001) {
      parcelas[parcelas.length - 1].valor = (Number(parcelas[parcelas.length - 1].valor) + diff).toFixed(2)
    }
    updateCurrentRegra('parcelas', parcelas)
    setError(null)
  }

  const reorderTimeList = (field: 'revisores' | 'aprovadores', fromIndex: number, toIndex: number) => {
    const list = [...(timesheet[field] || [])]
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= list.length || toIndex >= list.length) return
    const [moved] = list.splice(fromIndex, 1)
    list.splice(toIndex, 0, moved)
    const withOrder = list.map((item: any, idx: number) => ({ ...item, ordem: idx + 1 }))
    updateCurrentTimesheet(field, withOrder)
  }

  const formatIndicacaoPagador = (value: string | undefined) => {
    if (!value || value === 'nao') return 'Não'
    const [tipoRaw, entityId] = String(value).split(':')
    if (!entityId) return value

    if (tipoRaw === 'colaborador') {
      const nome = options.colaboradores.find((item) => item.id === entityId)?.nome
      return nome ? `${nome} (Colaborador)` : `Colaborador (${entityId})`
    }
    if (tipoRaw === 'cliente') {
      const nome = options.clientes.find((item) => item.id === entityId)?.nome
      return nome ? `${nome} (Cliente)` : `Cliente (${entityId})`
    }
    if (tipoRaw === 'prestador') {
      const nome = options.prestadores?.find((item) => item.id === entityId)?.nome
      return nome ? `${nome} (Prestador de Serviço)` : `Prestador (${entityId})`
    }
    if (tipoRaw === 'parceiro') {
      const nome = options.parceiros?.find((item) => item.id === entityId)?.nome
      return nome ? `${nome} (Parceiro)` : `Parceiro (${entityId})`
    }
    return value
  }

  const periodicidadeIndicacaoOptions = useMemo(() => {
    const regra = normalizeRegraCobranca(currentFinanceRule?.regra_cobranca || currentCaso.regra_cobranca)
    if (regra === 'mensal' || regra === 'mensalidade_processo') {
      return [
        { value: 'mensal', label: 'Mensal' },
        { value: 'pontual', label: 'Única' },
      ]
    }
    if (regra === 'projeto') {
      return [
        { value: 'pontual', label: 'Única' },
        { value: 'parcelado', label: 'Parcelada por datas' },
      ]
    }
    return [
      { value: 'pontual', label: 'Única' },
      { value: 'mensal', label: 'Mensal' },
      { value: 'ao_final', label: 'Ao final' },
    ]
  }, [currentFinanceRule?.regra_cobranca, currentCaso.regra_cobranca])

  const indicacaoPreview = useMemo(() => {
    if (!indicacaoPagamentoEnabled) return []
    const periodicidade = String(indicacao.periodicidade || '')
    if (periodicidade === 'parcelado') {
      const parcelas = Array.isArray(indicacao.parcelas_pagamento) ? indicacao.parcelas_pagamento : []
      if (!parcelas.length) return ['Nenhuma parcela configurada']
      return parcelas.map((p: any, idx: number) => {
        const valor = String(p?.valor || '').trim() || '0,00'
        const data = formatDateBr(String(p?.data_pagamento || ''))
        return `Parcela ${idx + 1}: ${valor} em ${data}`
      })
    }
    if (periodicidade === 'mensal') {
      const usaVencimento = Boolean(indicacao.usar_dia_vencimento)
      const dia = usaVencimento
        ? String(currentCaso.pagamento_dia_mes || '').trim()
        : String(indicacao.dia_pagamento_mensal || '').trim()
      const fim = String(indicacao.data_fim_pagamentos || '').trim()
      const valor = String(indicacao.valor || '').trim()
      const linhas = [
        `Mensalidade ${indicacao.modo === 'valor' ? `de ${valor || '0,00'}` : `de ${valor || '0'}%`} com pagamento todo dia ${dia || '-'}`,
      ]
      linhas.push(`Até ${formatDateBr(fim)}`)
      return linhas
    }
    const data = String(indicacao.data_pagamento_unico || '').trim()
    return [`Pagamento único em ${formatDateBr(data)}`]
  }, [indicacao, indicacaoPagamentoEnabled, currentCaso.pagamento_dia_mes])

  const crossSellPreview = useMemo(() => {
    if (!crossSellEnabled) return []
    if (crossSellPeriodicidade === 'parcelado') {
      const parcelas = Array.isArray(regras.cross_sell_parcelas_pagamento) ? regras.cross_sell_parcelas_pagamento : []
      if (!parcelas.length) return ['Nenhuma parcela configurada']
      return parcelas.map((p: any, idx: number) => {
        const valor = String(p?.valor || '').trim() || '0,00'
        const data = formatDateBr(String(p?.data_pagamento || ''))
        return `Parcela ${idx + 1}: ${valor} em ${data}`
      })
    }
    if (crossSellPeriodicidade === 'mensal') {
      const usaVencimento = Boolean(regras.cross_sell_usar_dia_vencimento)
      const dia = usaVencimento
        ? String(currentCaso.pagamento_dia_mes || '').trim()
        : String(regras.cross_sell_dia_pagamento_mensal || '').trim()
      const fim = String(regras.cross_sell_data_fim_pagamentos || '').trim()
      const valor = String(regras.cross_sell_valor || '').trim()
      const linhas = [
        `Mensalidade ${crossSellModo === 'valor' ? `de ${valor || '0,00'}` : `de ${valor || '0'}%`} com pagamento todo dia ${dia || '-'}`,
      ]
      linhas.push(`Até ${formatDateBr(fim)}`)
      return linhas
    }
    const data = String(regras.cross_sell_data_pagamento_unico || '').trim()
    return [`Pagamento único em ${formatDateBr(data)}`]
  }, [crossSellEnabled, crossSellPeriodicidade, crossSellModo, regras, currentCaso.pagamento_dia_mes])

  const addCaso = () => {
    setForm((prev) => ({
      ...prev,
      casos: [...prev.casos, { ...emptyCaso }],
    }))
    setSelectedCaseIndex(form.casos.length)
    setSubstep('basico')
  }

  const selectFinanceRule = (index: number) => {
    if (!currentFinanceRules[index]) return
    const nextRules = [...currentFinanceRules]
    nextRules[selectedFinanceRuleIndex] = composeCurrentFinanceRule(nextRules[selectedFinanceRuleIndex])
    setFinanceRulesForCurrentCase(nextRules)
    const selectedRule = nextRules[index]
    setSelectedFinanceRuleByCase((prev) => ({ ...prev, [currentCaseKey]: index }))
    applyFinanceRuleToCurrentCaso(selectedRule)
  }

  const addFinanceRule = () => {
    const nextRules = [...currentFinanceRules]
    nextRules[selectedFinanceRuleIndex] = composeCurrentFinanceRule(nextRules[selectedFinanceRuleIndex])
    const newRule: BillingRuleDraft = {
      id: createRuleId(),
      status: 'rascunho',
      moeda: currentCaso.moeda || 'real',
      tipo_cobranca_documento: '',
      data_inicio_faturamento: currentCaso.data_inicio_faturamento || '',
      pagamento_dia_mes: currentCaso.pagamento_dia_mes || '',
      inicio_vigencia: currentCaso.inicio_vigencia || '',
      periodo_reajuste: 'nao_tem',
      data_proximo_reajuste: '',
      data_ultimo_reajuste: '',
      indice_reajuste: 'nao_tem',
      regra_cobranca: '',
      regra_cobranca_config: { ...emptyCaso.regra_cobranca_config },
      pagadores_servico: [],
      indicacao_config: { ...emptyCaso.indicacao_config },
    }
    nextRules.push(newRule)
    setFinanceRulesForCurrentCase(nextRules)
    const nextIndex = nextRules.length - 1
    setSelectedFinanceRuleByCase((prev) => ({ ...prev, [currentCaseKey]: nextIndex }))
    applyFinanceRuleToCurrentCaso(newRule)
  }

  const removeCurrentFinanceRule = () => {
    const current = currentFinanceRules[selectedFinanceRuleIndex]
    if (!current) return
    if (current.status !== 'rascunho') {
      setError('Só é possível remover regra financeira em rascunho')
      return
    }
    if (currentFinanceRules.length <= 1) {
      setError('É necessário manter pelo menos uma regra financeira')
      return
    }
    const nextRules = currentFinanceRules.filter((_, idx) => idx !== selectedFinanceRuleIndex)
    const nextIndex = Math.max(0, selectedFinanceRuleIndex - 1)
    setFinanceRulesForCurrentCase(nextRules)
    setSelectedFinanceRuleByCase((prev) => ({ ...prev, [currentCaseKey]: nextIndex }))
    applyFinanceRuleToCurrentCaso(nextRules[nextIndex])
  }

  const toggleCurrentFinanceRuleStatus = () => {
    const current = currentFinanceRules[selectedFinanceRuleIndex]
    if (!current) return
    const nextStatus: BillingRuleStatus = current.status === 'encerrado' ? 'ativo' : 'encerrado'
    const nextRules = [...currentFinanceRules]
    nextRules[selectedFinanceRuleIndex] = {
      ...composeCurrentFinanceRule(current),
      status: nextStatus,
    }
    setFinanceRulesForCurrentCase(nextRules)
    setError(null)
  }

  const isCasoRascunho = (caso?: CasoPayload) => (caso?.status || 'rascunho') === 'rascunho'
  const getCasoId = (caso: CasoPayload): string | null => {
    const id = (caso as any)?.id
    return id ? String(id) : null
  }
  const getCasoCardLabel = (caso: CasoPayload | undefined, idx: number) => {
    const nome = caso?.nome?.trim() || `Caso ${idx + 1}`
    const numero = (caso as any)?.numero
    return numero ? `${numero} - ${nome}` : nome
  }
  const sortedCaseRefs = useMemo(() => {
    return form.casos
      .map((caso, idx) => ({ caso, idx }))
      .sort((a, b) => {
        const aNumero = Number((a.caso as any)?.numero)
        const bNumero = Number((b.caso as any)?.numero)
        const aHasNumero = Number.isFinite(aNumero) && aNumero > 0
        const bHasNumero = Number.isFinite(bNumero) && bNumero > 0

        if (aHasNumero && bHasNumero) return aNumero - bNumero
        if (aHasNumero) return -1
        if (bHasNumero) return 1
        return a.idx - b.idx
      })
  }, [form.casos])

  const removeCaso = (index: number) => {
    const caso = form.casos[index]
    if (!isCasoRascunho(caso)) {
      setError('Só é possível remover casos em rascunho')
      return
    }
    setForm((prev) => {
      if (prev.casos.length <= 1) return prev
      return {
        ...prev,
        casos: prev.casos.filter((_, i) => i !== index),
      }
    })
    setPendingCaseAnexos((prev) => {
      const next: Record<number, PendingAnexo[]> = {}
      Object.entries(prev).forEach(([key, value]) => {
        const oldIndex = Number(key)
        if (Number.isNaN(oldIndex) || oldIndex === index) return
        const newIndex = oldIndex > index ? oldIndex - 1 : oldIndex
        next[newIndex] = value
      })
      return next
    })
    setSelectedCaseIndex((prev) => Math.max(0, index > 0 ? prev - 1 : 0))
  }

  const removePendingAnexo = (index: number) => {
    setPendingAnexos((prev) => prev.filter((_, i) => i !== index))
  }

  const appendPendingAnexo = (nome: string, file: File) => {
    setPendingAnexos((prev) => [...prev, { nome, file }])
  }

  const appendPendingCaseAnexo = (caseIndex: number, nome: string, file: File) => {
    setPendingCaseAnexos((prev) => ({
      ...prev,
      [caseIndex]: [...(prev[caseIndex] || []), { nome, file }],
    }))
  }

  const removePendingCaseAnexo = (caseIndex: number, anexoIndex: number) => {
    setPendingCaseAnexos((prev) => {
      const list = [...(prev[caseIndex] || [])]
      list.splice(anexoIndex, 1)
      return { ...prev, [caseIndex]: list }
    })
  }

  const openPendingCaseAnexo = (caseIndex: number, anexoIndex: number) => {
    const item = pendingCaseAnexos[caseIndex]?.[anexoIndex]
    if (!item?.file) return
    const url = URL.createObjectURL(item.file)
    window.open(url, '_blank')
    setTimeout(() => URL.revokeObjectURL(url), 10000)
  }

  const openAnexoDialogByDrop = (file: File, target: 'contrato' | 'caso', caseIndex?: number) => {
    setAnexoDialogTarget(target)
    setAnexoDialogCaseIndex(target === 'caso' ? caseIndex ?? selectedCaseIndex : null)
    setAnexoDialogFromDrop(true)
    setAnexoDialogFile(file)
    setAnexoDialogNome('')
    setAnexoDialogOpen(true)
  }

  const openAnexoDialogByClick = (target: 'contrato' | 'caso', caseIndex?: number) => {
    setAnexoDialogTarget(target)
    setAnexoDialogCaseIndex(target === 'caso' ? caseIndex ?? selectedCaseIndex : null)
    setAnexoDialogFromDrop(false)
    setAnexoDialogFile(null)
    setAnexoDialogNome('')
    setAnexoDialogOpen(true)
  }

  const submitAnexoDialog = () => {
    if (!anexoDialogNome.trim()) {
      setError('Nome do anexo é obrigatório')
      return
    }
    if (!anexoDialogFile) {
      setError('Arquivo do anexo é obrigatório')
      return
    }
    if (anexoDialogTarget === 'caso') {
      const targetIndex = anexoDialogCaseIndex ?? selectedCaseIndex
      appendPendingCaseAnexo(targetIndex, anexoDialogNome.trim(), anexoDialogFile)
    } else {
      appendPendingAnexo(anexoDialogNome.trim(), anexoDialogFile)
    }
    setAnexoDialogOpen(false)
    setAnexoDialogNome('')
    setAnexoDialogFile(null)
    setAnexoDialogFromDrop(false)
    setAnexoDialogCaseIndex(null)
    setError(null)
  }

  const ensureDraftCreated = async (accessToken: string): Promise<string | null> => {
    if (isEdit && contratoId) return contratoId
    if (draftContratoId) return draftContratoId
    if (draftContratoPromiseRef.current) return draftContratoPromiseRef.current

    const promise = (async () => {
      const resp = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/create-contrato`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          cliente_id: form.cliente_id,
          nome_contrato: form.nome_contrato,
          forma_entrada: form.forma_entrada || null,
          responsavel_prospeccao_id: form.forma_entrada === 'prospeccao' ? form.responsavel_prospeccao_id || null : null,
          canal_prospeccao: form.forma_entrada === 'prospeccao' ? form.canal_prospeccao || null : null,
          grupo_imposto_id: form.grupo_imposto_id || null,
          status: 'rascunho',
          casos: [],
        }),
      })
      const data = await resp.json()
      if (!resp.ok) {
        throw new Error(data.error || 'Erro ao salvar rascunho do contrato')
      }
      const id = data.data?.id as string | undefined
      if (!id) throw new Error('Contrato criado sem retorno de ID')
      setDraftContratoId(id)
      return id
    })()

    draftContratoPromiseRef.current = promise
    try {
      return await promise
    } finally {
      draftContratoPromiseRef.current = null
    }
  }

  const toBase64 = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.readAsDataURL(file)
      reader.onload = () => {
        const result = String(reader.result || '')
        resolve(result.includes(',') ? result.split(',')[1] : result)
      }
      reader.onerror = reject
    })

  const uploadPendingAnexos = async (
    contractId: string,
    accessToken: string,
    anexos: PendingAnexo[] = pendingAnexos,
  ) => {
    const uploaded: Array<{ id: string; nome: string; arquivo_nome: string; created_at: string }> = []
    for (const anexo of anexos) {
      if (!anexo.nome?.trim() || !anexo.file) continue
      const arquivo_base64 = await toBase64(anexo.file)
      const resp = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/create-contrato-anexo`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contrato_id: contractId,
            nome: anexo.nome,
            arquivo_nome: anexo.file.name,
            mime_type: anexo.file.type || null,
            arquivo_base64,
          }),
        },
      )

      if (!resp.ok) {
        const data = await resp.json()
        throw new Error(data.error || 'Erro ao enviar anexo do contrato')
      }
      const payload = await resp.json()
      uploaded.push({
        id: payload?.data?.id || crypto.randomUUID(),
        nome: anexo.nome,
        arquivo_nome: anexo.file.name,
        created_at: new Date().toISOString(),
      })
    }
    return uploaded
  }

  const uploadPendingCaseAnexos = async (
    caseId: string,
    accessToken: string,
    anexos: PendingAnexo[],
  ) => {
    const uploaded: Array<{ id: string; nome: string; arquivo_nome: string; created_at: string }> = []
    for (const anexo of anexos) {
      if (!anexo.nome?.trim() || !anexo.file) continue
      const arquivo_base64 = await toBase64(anexo.file)
      const resp = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/create-caso-anexo`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            caso_id: caseId,
            nome: anexo.nome,
            arquivo_nome: anexo.file.name,
            mime_type: anexo.file.type || null,
            arquivo_base64,
          }),
        },
      )
      const payload = await resp.json()
      if (!resp.ok) {
        throw new Error(payload.error || 'Erro ao enviar anexo do caso')
      }
      uploaded.push({
        id: payload?.data?.id || crypto.randomUUID(),
        nome: anexo.nome,
        arquivo_nome: anexo.file.name,
        created_at: new Date().toISOString(),
      })
    }
    return uploaded
  }

  const openAnexo = async (anexoId: string, tipo: 'contrato' | 'caso') => {
    try {
      setOpeningAnexoId(anexoId)
      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) return

      const resp = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-anexo?tipo=${tipo}&id=${anexoId}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
        },
      )
      const data = await resp.json()
      if (!resp.ok) {
        setError(data.error || 'Erro ao abrir anexo')
        return
      }

      const item = data.data
      const mimeType = item.mime_type || 'application/octet-stream'
      const fileName = item.arquivo_nome || 'anexo.bin'
      const byteString = atob(item.arquivo_base64 || '')
      const buffer = new ArrayBuffer(byteString.length)
      const bytes = new Uint8Array(buffer)
      for (let i = 0; i < byteString.length; i += 1) bytes[i] = byteString.charCodeAt(i)
      const blob = new Blob([buffer], { type: mimeType })
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank')
      setTimeout(() => URL.revokeObjectURL(url), 10000)
      console.info(`Anexo aberto: ${fileName}`)
    } catch (e) {
      console.error(e)
      setError('Erro ao abrir anexo')
    } finally {
      setOpeningAnexoId(null)
    }
  }

  const openPendingAnexo = (index: number) => {
    const item = pendingAnexos[index]
    if (!item?.file) return
    const url = URL.createObjectURL(item.file)
    window.open(url, '_blank')
    setTimeout(() => URL.revokeObjectURL(url), 10000)
  }

  const removeExistingAnexo = async (anexoId: string, tipo: 'contrato' | 'caso', caseIndex?: number) => {
    try {
      setRemovingAnexoId(anexoId)
      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) return

      const resp = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/delete-anexo`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tipo, id: anexoId }),
      })
      const data = await resp.json()
      if (!resp.ok) {
        const msg = data.error || 'Erro ao remover anexo'
        setError(msg)
        toastError(msg)
        return
      }
      if (tipo === 'contrato') {
        setExistingAnexos((prev) => prev.filter((item) => item.id !== anexoId))
      } else {
        const targetIndex = caseIndex ?? selectedCaseIndex
        setForm((prev) => {
          const next = [...prev.casos]
          const current = next[targetIndex]
          if (!current) return prev
          const anexos = (((current as any)?.anexos || []) as any[]).filter((item) => item.id !== anexoId)
          next[targetIndex] = { ...current, anexos }
          return { ...prev, casos: next }
        })
      }
      success('Anexo removido')
    } catch (e) {
      console.error(e)
      setError('Erro ao remover anexo')
    } finally {
      setRemovingAnexoId(null)
    }
  }

  const goNextStep = async () => {
    if (step !== 'dados') return

    const validationError = validateDados()
    if (validationError) {
      setError(validationError)
      return
    }

    setError(null)
    setStep('casos')
    setSubstep('basico')

    if (!isEdit) {
      void (async () => {
        try {
          const supabase = createClient()
          const {
            data: { session },
          } = await supabase.auth.getSession()
          if (!session) return
          const createdId = await ensureDraftCreated(session.access_token)
          if (!createdId) return
          success('Rascunho salvo')
        } catch (submitError) {
          console.error(submitError)
          toastError(submitError instanceof Error ? submitError.message : 'Erro ao salvar rascunho')
        }
      })()
      return
    }

    if (isEdit && contratoId) {
      void (async () => {
        try {
          const supabase = createClient()
          const {
            data: { session },
          } = await supabase.auth.getSession()
          if (!session) return

          const updateResp = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/update-contrato`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              id: contratoId,
              cliente_id: form.cliente_id,
              nome_contrato: form.nome_contrato,
              forma_entrada: form.forma_entrada || null,
              responsavel_prospeccao_id: form.forma_entrada === 'prospeccao' ? form.responsavel_prospeccao_id || null : null,
              canal_prospeccao: form.forma_entrada === 'prospeccao' ? form.canal_prospeccao || null : null,
              grupo_imposto_id: form.grupo_imposto_id || null,
            }),
          })
          const updateData = await updateResp.json()
          if (!updateResp.ok) {
            toastError(updateData.error || 'Erro ao atualizar contrato')
            return
          }
        } catch (submitError) {
          console.error(submitError)
          toastError('Erro ao atualizar contrato')
        }
      })()
    }
  }

  const submit = async () => {
    setError(null)

    if (isReadOnly) {
      setError('Modo somente leitura')
      return
    }

    const dadosError = validateDados()
    if (dadosError) {
      setStep('dados')
      setError(dadosError)
      return
    }

    try {
      setLoading(true)
      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) return

      const contractTargetId = await ensureDraftCreated(session.access_token)
      if (!contractTargetId) {
        setError('Salve os dados do contrato antes de cadastrar casos')
        return
      }

      const resp = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/update-contrato`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: contractTargetId,
          cliente_id: form.cliente_id,
          nome_contrato: form.nome_contrato,
          forma_entrada: form.forma_entrada || null,
          responsavel_prospeccao_id: form.forma_entrada === 'prospeccao' ? form.responsavel_prospeccao_id || null : null,
          canal_prospeccao: form.forma_entrada === 'prospeccao' ? form.canal_prospeccao || null : null,
          grupo_imposto_id: form.grupo_imposto_id || null,
        }),
      })

      const data = await resp.json()
      if (!resp.ok) {
        setError(data.error || 'Erro ao atualizar contrato')
        return
      }

      if (isEdit) {
        const currentIds = form.casos
          .map((caso) => getCasoId(caso))
          .filter((id): id is string => Boolean(id))
        const removedCaseIds = loadedCaseIds.filter((id) => !currentIds.includes(id))
        const removedDraftCaseIds = removedCaseIds.filter((id) => loadedCaseStatusById[id] === 'rascunho')

        for (const removedCaseId of removedDraftCaseIds) {
          const deleteResp = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/delete-caso`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ id: removedCaseId }),
          })
          const deleteData = await deleteResp.json()
          if (!deleteResp.ok) {
            setError(deleteData.error || 'Erro ao excluir caso removido')
            return
          }
        }
      }

      if (pendingAnexos.length > 0) {
        const uploaded = await uploadPendingAnexos(contractTargetId, session.access_token, pendingAnexos)
        setExistingAnexos((prev) => [...uploaded, ...prev])
        setPendingAnexos([])
      }

      let hasPersistedCase = false
      let createdCases = 0
      let updatedCases = 0
      const persistedCaseIds: string[] = []
      const persistedCaseStatusById: Record<string, string> = {}
      for (let caseIndex = 0; caseIndex < form.casos.length; caseIndex += 1) {
        const caso = form.casos[caseIndex]
        if (isCaseEmpty(caso)) continue

        if (!caso.nome?.trim()) {
          setStep('casos')
          setSubstep('basico')
          setError('Caso em rascunho precisa ter ao menos um nome')
          return
        }

        const payload = {
          ...caso,
          regra_cobranca: normalizeRegraCobranca(caso.regra_cobranca),
          data_ultimo_reajuste: caso.data_ultimo_reajuste || caso.data_inicio_faturamento || '',
          status: isCaseComplete(caso) ? 'ativo' : 'rascunho',
        }

        const existingCaseId = getCasoId(caso)
        const isExistingCase = Boolean(existingCaseId)
        const caseResp = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/${isExistingCase ? 'update-caso' : 'create-caso'}`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(
              isExistingCase
                ? { id: existingCaseId, ...payload }
                : { contrato_id: contractTargetId, ...payload },
            ),
          },
        )
        const caseData = await caseResp.json()
        if (!caseResp.ok) {
          setError(caseData.error || 'Erro ao salvar caso')
          return
        }
        hasPersistedCase = true
        const persistedId = caseData?.data?.id || existingCaseId
        if (persistedId) {
          const safeId = String(persistedId)
          persistedCaseIds.push(safeId)
          persistedCaseStatusById[safeId] = payload.status || 'rascunho'
          const pendingCaseList = pendingCaseAnexos[caseIndex] || []
          if (pendingCaseList.length > 0) {
            await uploadPendingCaseAnexos(safeId, session.access_token, pendingCaseList)
            setPendingCaseAnexos((prev) => ({ ...prev, [caseIndex]: [] }))
          }
        }
        if (isExistingCase) {
          updatedCases += 1
        } else {
          createdCases += 1
          // Atualiza form.casos com o ID retornado para evitar duplicatas em salvamentos subsequentes
          if (persistedId) {
            setForm((prev) => {
              const next = [...prev.casos]
              next[caseIndex] = { ...next[caseIndex], id: String(persistedId) } as any
              return { ...prev, casos: next }
            })
          }
        }
      }

      if (isEdit) {
        setLoadedCaseIds(persistedCaseIds)
        setLoadedCaseStatusById(persistedCaseStatusById)
      }

      if (hasPersistedCase && form.status === 'rascunho') {
        const statusResp = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/toggle-contrato-status`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ id: contractTargetId, status: 'validacao' }),
        })
        const statusData = await statusResp.json()
        if (!statusResp.ok) {
          setError(statusData.error || 'Erro ao mover contrato para validação')
          return
        }
        setForm((prev) => ({ ...prev, status: 'validacao' }))
      }

      const successMessage =
        createdCases > 0 || updatedCases > 0
          ? createdCases > 0 && updatedCases > 0
            ? `Contrato salvo. ${createdCases} caso(s) criado(s) e ${updatedCases} atualizado(s).`
            : createdCases > 0
              ? `Contrato salvo. ${createdCases} caso(s) criado(s).`
              : `Contrato salvo. ${updatedCases} caso(s) atualizado(s).`
          : isEdit
            ? 'Contrato atualizado com sucesso.'
            : 'Contrato criado com sucesso.'

      success(successMessage)

      if (!isEdit) {
        router.push('/contratos')
        return
      }

      router.refresh()
    } catch (submitError) {
      console.error(submitError)
      setError(submitError instanceof Error ? submitError.message : 'Erro ao salvar contrato')
    } finally {
      setLoading(false)
    }
  }

  const deleteDraft = async () => {
    if (!contratoId) return
    try {
      setDeleteDraftLoading(true)
      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) return

      const resp = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/delete-contrato`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id: contratoId }),
      })
      const data = await resp.json()
      if (!resp.ok) {
        toastError(data.error || 'Erro ao excluir rascunho')
        return
      }
      success('Rascunho excluído com sucesso')
      router.push('/contratos')
      router.refresh()
    } catch (err) {
      console.error(err)
      toastError('Erro ao excluir rascunho')
    } finally {
      setDeleteDraftLoading(false)
      setDeleteDraftOpen(false)
    }
  }

  if (initialLoading) {
    return (
      <div className="rounded-md border p-4">
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-10 rounded bg-gray-200" />
          ))}
        </div>
      </div>
    )
  }

  if (!canWrite && !viewOnly) {
    return (
      <Alert className="border-red-200 bg-red-50 text-red-800">
        <AlertDescription>Você não tem permissão para criar/editar contratos.</AlertDescription>
      </Alert>
    )
  }

  if (isReadOnly) {
    return (
      <div className="space-y-4">
        {error && (
          <Alert className="border-red-200 bg-red-50 text-red-800">
            <AlertTitle>Atenção</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Card>
          <CardContent className="pt-6">
            <div className="grid gap-2 md:grid-cols-2">
              {steps.map((stepConfig, index) => {
                const Icon = stepConfig.icon
                const isActive = step === stepConfig.key
                const locked = !canGoToStep(stepConfig.key)
                return (
                  <button
                    key={stepConfig.key}
                    type="button"
                    onClick={() => openStep(stepConfig.key)}
                    className={`rounded-md border p-3 text-left transition ${
                      isActive ? 'border-primary bg-primary/5' : 'border-border bg-background'
                    } ${locked ? 'cursor-not-allowed opacity-60' : 'hover:border-primary/50'}`}
                    disabled={locked}
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className={`flex h-8 w-8 items-center justify-center rounded-full border ${
                          isActive ? 'border-primary text-primary' : 'border-border'
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                        <span className="truncate font-medium">
                          Etapa {index + 1}: {stepConfig.label}
                        </span>
                        {locked ? <Lock className="h-4 w-4 text-muted-foreground" /> : null}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </CardContent>
        </Card>

        {step === 'dados' && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Dados do contrato</CardTitle>
                <Badge>{formatContratoStatus(form.status)}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <p className="text-xs text-muted-foreground">Cliente</p>
                  <p className="font-medium">{clienteOptions.find((c) => c.value === form.cliente_id)?.label || '-'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Forma de entrada</p>
                  <p className="font-medium">{form.forma_entrada || '-'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Responsável da prospecção</p>
                  <p className="font-medium">{colaboradoresMap.get(form.responsavel_prospeccao_id) || '-'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Grupo de impostos</p>
                  <p className="font-medium">{grupoImpostoMap.get(form.grupo_imposto_id) || '-'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Canal de prospecção</p>
                  <p className="font-medium">{form.canal_prospeccao || '-'}</p>
                </div>
                <div className="md:col-span-2">
                  <p className="text-xs text-muted-foreground">Nome do contrato</p>
                  <p className="font-medium">{form.nome_contrato || '-'}</p>
                </div>
              </div>

              <div className="space-y-2 rounded-md border p-3">
                {origemSolicitacaoDescricao ? (
                  <div className="mb-3 rounded-md border bg-muted/30 p-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Descrição da solicitação</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{origemSolicitacaoDescricao}</p>
                  </div>
                ) : null}
                <p className="font-medium">Anexos do contrato</p>
                {existingAnexos.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem anexos cadastrados.</p>
                ) : (
                  existingAnexos.map((anexo) => (
                    <div key={anexo.id} className="flex items-center justify-between rounded border px-3 py-2">
                      <div>
                        <p className="text-sm font-medium">{anexo.nome}</p>
                        <p className="text-xs text-muted-foreground">{anexo.arquivo_nome}</p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openAnexo(anexo.id, 'contrato')}
                        disabled={openingAnexoId === anexo.id}
                      >
                        <Paperclip className="mr-1 h-4 w-4" />
                        Abrir
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {step === 'casos' && (
          <Card>
            <CardHeader>
              <CardTitle>Casos do contrato</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                {sortedCaseRefs.map(({ caso, idx }) => {
                  const button = (
                    <Button
                      key={idx}
                      type="button"
                      variant={idx === selectedCaseIndex ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setSelectedCaseIndex(idx)}
                    >
                      {getCasoCardLabel(caso, idx)}
                    </Button>
                  )
                  return isCasoRascunho(caso) ? (
                    <Tooltip key={idx} content="Caso em rascunho">
                      <span className="inline-flex">{button}</span>
                    </Tooltip>
                  ) : (
                    button
                  )
                })}
              </div>

              <div className="rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {caseSubsteps.map((item, idx) => {
                    const ItemIcon = item.icon
                    const active = substep === item.key
                    return (
                      <div key={item.key} className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setSubstep(item.key)}
                          className={`rounded-md px-2 py-1 ${
                            active ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted'
                          }`}
                        >
                          <span className="inline-flex items-center gap-1.5">
                            <ItemIcon className="h-3.5 w-3.5" />
                            {item.label}
                          </span>
                        </button>
                        {idx < caseSubsteps.length - 1 ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : null}
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="rounded-md border p-4 text-sm">
                {substep === 'basico' && (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div><p className="text-xs text-muted-foreground">Nome</p><p className="font-medium">{currentCaso.nome || '-'}</p></div>
                    <div><p className="text-xs text-muted-foreground">Serviço</p><p className="font-medium">{produtosMap.get(currentCaso.produto_id) || '-'}</p></div>
                    <div>
                      <p className="text-xs text-muted-foreground">Natureza do caso</p>
                      <p className="font-medium">
                        {String(regras.natureza_caso || '').trim()
                          ? String(regras.natureza_caso).toLowerCase() === 'consultivo'
                            ? 'Consultivo'
                            : 'Contencioso'
                          : '-'}
                      </p>
                    </div>
                    <div><p className="text-xs text-muted-foreground">Responsável</p><p className="font-medium">{colaboradoresMap.get(currentCaso.responsavel_id) || '-'}</p></div>
                    <div>
                      <p className="text-xs text-muted-foreground">Centro de custo (total {calcRateioTotal(currentCaso.centro_custo_rateio || [])}%)</p>
                      <p className="font-medium">
                        {(currentCaso.centro_custo_rateio || []).map((c) => `${centrosMap.get(c.centro_custo_id) || '-'} (${c.percentual ?? 0}%)`).join(' | ') || '-'}
                      </p>
                    </div>
                  </div>
                )}
                {substep === 'financeiro' && (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div><p className="text-xs text-muted-foreground">Moeda</p><p className="font-medium">{currentCaso.moeda || '-'}</p></div>
                    <div><p className="text-xs text-muted-foreground">Tipo de cobrança</p><p className="font-medium">{currentCaso.tipo_cobranca_documento || '-'}</p></div>
                    <div><p className="text-xs text-muted-foreground">Regra de cobrança</p><p className="font-medium">{currentCaso.regra_cobranca || '-'}</p></div>
                    <div><p className="text-xs text-muted-foreground">Pagadores serviço (total {calcRateioTotal(currentCaso.pagadores_servico || [])}%)</p><p className="font-medium">{(currentCaso.pagadores_servico || []).map((p) => `${clienteOptions.find((c) => c.value === p.cliente_id)?.label || '-'} (${p.percentual ?? 0}%)`).join(' | ') || '-'}</p></div>
                  </div>
                )}
                {substep === 'despesas' && (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div><p className="text-xs text-muted-foreground">Despesas reembolsáveis</p><p className="font-medium">{(despesas.despesas_reembolsaveis || []).join(', ') || '-'}</p></div>
                    {showDespesaDetalhes ? (
                      <>
                        <div><p className="text-xs text-muted-foreground">Limite de adiantamento</p><p className="font-medium">{despesas.limite_adiantamento || '-'}</p></div>
                        <div className="md:col-span-2"><p className="text-xs text-muted-foreground">Pagadores despesa (total {calcRateioTotal(currentCaso.pagadores_despesa || [])}%)</p><p className="font-medium">{(currentCaso.pagadores_despesa || []).map((p) => `${clienteOptions.find((c) => c.value === p.cliente_id)?.label || '-'} (${p.percentual ?? 0}%)`).join(' | ') || '-'}</p></div>
                      </>
                    ) : (
                      <div><p className="text-xs text-muted-foreground">Detalhes de despesa</p><p className="font-medium">Não aplicável</p></div>
                    )}
                  </div>
                )}
                {substep === 'timesheet' && (
                  <div className="space-y-2">
                    <p><span className="text-xs text-muted-foreground">Envia timesheet:</span> <span className="font-medium">{timesheet.envia_timesheet ? 'Sim' : 'Não'}</span></p>
                    <p><span className="text-xs text-muted-foreground">Revisores:</span> <span className="font-medium">{(timesheet.revisores || []).map((r: any) => `${colaboradoresMap.get(r.colaborador_id) || '-'} (#${r.ordem || '-'})`).join(' | ') || '-'}</span></p>
                    <p><span className="text-xs text-muted-foreground">Aprovadores:</span> <span className="font-medium">{(timesheet.aprovadores || []).map((a: any) => `${colaboradoresMap.get(a.colaborador_id) || '-'} (#${a.ordem || '-'})`).join(' | ') || '-'}</span></p>
                  </div>
                )}
                {false && (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div><p className="text-xs text-muted-foreground">Pagamento da indicação</p><p className="font-medium">{formatIndicacaoPagador(indicacao.pagamento_indicacao)}</p></div>
                    <div><p className="text-xs text-muted-foreground">Periodicidade</p><p className="font-medium">{indicacao.periodicidade || '-'}</p></div>
                    <div><p className="text-xs text-muted-foreground">Modo</p><p className="font-medium">{indicacao.modo || '-'}</p></div>
                    <div><p className="text-xs text-muted-foreground">Valor</p><p className="font-medium">{indicacao.valor || '-'}</p></div>
                  </div>
                )}
              </div>

              <div className="space-y-2 rounded-md border p-3">
                <p className="font-medium">Anexos do caso</p>
                {((currentCaso as any)?.anexos || []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem anexos cadastrados neste caso.</p>
                ) : (
                  ((currentCaso as any).anexos || []).map((anexo: any) => (
                    <div key={anexo.id} className="flex items-center justify-between rounded border px-3 py-2">
                      <div>
                        <p className="text-sm font-medium">{anexo.nome}</p>
                        <p className="text-xs text-muted-foreground">{anexo.arquivo_nome}</p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openAnexo(anexo.id, 'caso')}
                        disabled={openingAnexoId === anexo.id}
                      >
                        <Paperclip className="mr-1 h-4 w-4" />
                        Abrir
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex justify-end gap-2">
          {step === 'casos' && (
            <Button variant="outline" onClick={() => setStep('dados')} disabled={loading}>
              Voltar
            </Button>
          )}
          <Button variant="outline" onClick={() => router.push('/contratos')} disabled={loading}>
            Voltar para lista
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && (
        <Alert className="border-red-200 bg-red-50 text-red-800">
          <AlertTitle>Atenção</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="pt-6">
          <div className="grid gap-2 md:grid-cols-2">
            {steps.map((stepConfig, index) => {
              const Icon = stepConfig.icon
              const isActive = step === stepConfig.key
              const isDone = stepConfig.key === 'dados' && !validateDados()
              const locked = !canGoToStep(stepConfig.key)
              return (
                <button
                  key={stepConfig.key}
                  type="button"
                  onClick={() => openStep(stepConfig.key)}
                  className={`rounded-md border p-3 text-left transition ${
                    isActive ? 'border-primary bg-primary/5' : 'border-border bg-background'
                  } ${locked ? 'cursor-not-allowed opacity-60' : 'hover:border-primary/50'}`}
                  disabled={locked}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className={`flex h-8 w-8 items-center justify-center rounded-full border ${
                        isActive ? 'border-primary text-primary' : 'border-border'
                      }`}
                    >
                      {isDone && !isActive ? <CheckCircle2 className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                    </div>
                    <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                      <span className="truncate font-medium">
                        Etapa {index + 1}: {stepConfig.label}
                      </span>
                      {locked ? <Lock className="h-4 w-4 text-muted-foreground" /> : null}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {step === 'dados' && (
        <Card>
          <CardHeader>
            <div className={`flex items-center ${isEdit ? 'justify-between' : 'justify-start'}`}>
              <CardTitle>Dados do contrato</CardTitle>
              {isEdit ? <Badge>{formatContratoStatus(form.status)}</Badge> : null}
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-5 md:grid-cols-2 md:gap-6">
            <div className="space-y-2 md:col-span-2">
              <Label>Cliente (buscar)</Label>
              <CommandSelect
                value={form.cliente_id}
                onValueChange={(value) => setForm((prev) => ({ ...prev, cliente_id: value }))}
                options={clienteOptions}
                placeholder="Selecione o cliente"
                searchPlaceholder="Buscar cliente por nome..."
                emptyText="Nenhum cliente encontrado."
                disabled={isReadOnly}
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label>Nome do contrato</Label>
              <Input
                value={form.nome_contrato}
                onChange={(e) => setForm((prev) => ({ ...prev, nome_contrato: e.target.value }))}
                disabled={isReadOnly}
              />
            </div>

            <div className="space-y-3 md:col-span-2">
              <Label>Forma de entrada</Label>
              <ChoiceCards
                value={form.forma_entrada}
                onChange={(value) =>
                  setForm((prev) => ({
                    ...prev,
                    forma_entrada: value as 'organico' | 'prospeccao',
                    responsavel_prospeccao_id: value === 'prospeccao' ? prev.responsavel_prospeccao_id : '',
                    canal_prospeccao: value === 'prospeccao' ? prev.canal_prospeccao : '',
                  }))
                }
                disabled={isReadOnly}
                options={[
                  { value: 'organico', label: 'Orgânico' },
                  { value: 'prospeccao', label: 'Prospecção' },
                ]}
                columns={2}
              />
            </div>

            {form.forma_entrada === 'prospeccao' ? (
              <>
                <div className="space-y-2">
                  <Label>Responsável da prospecção</Label>
                  <CommandSelect
                    value={form.responsavel_prospeccao_id}
                    onValueChange={(value) =>
                      setForm((prev) => ({
                        ...prev,
                        responsavel_prospeccao_id: value,
                      }))
                    }
                    options={colaboradorOptions}
                    placeholder="Selecione o responsável"
                    searchPlaceholder="Buscar colaborador..."
                    emptyText="Nenhum colaborador encontrado."
                    disabled={isReadOnly}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Canal de prospecção</Label>
                  <Input
                    value={form.canal_prospeccao}
                    onChange={(e) => setForm((prev) => ({ ...prev, canal_prospeccao: e.target.value }))}
                    placeholder="Ex.: indicação, evento, inbound, outbound..."
                    disabled={isReadOnly}
                  />
                </div>
              </>
            ) : null}

            <div className="space-y-2 md:col-span-2">
              <Label>Grupo de impostos</Label>
              <CommandSelect
                value={form.grupo_imposto_id}
                onValueChange={(value) => setForm((prev) => ({ ...prev, grupo_imposto_id: value }))}
                options={grupoImpostoOptions}
                placeholder="Selecione o grupo de impostos"
                searchPlaceholder="Buscar grupo..."
                emptyText="Nenhum grupo de impostos encontrado."
                disabled={isReadOnly}
              />
            </div>

            {isEdit ? (
              <div className="space-y-2">
                <Label>Status</Label>
                <Input value={formatContratoStatus(form.status)} disabled />
              </div>
            ) : null}

            <div className="space-y-2 md:col-span-2">
              {origemSolicitacaoDescricao ? (
                <div className="rounded-md border bg-muted/30 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Descrição da solicitação</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{origemSolicitacaoDescricao}</p>
                </div>
              ) : null}
              <Label>Anexos</Label>

              {existingAnexos.length > 0 && (
                <div className="space-y-2 rounded-md border p-3">
                  <p className="text-sm font-medium">Anexos já cadastrados</p>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
                    {existingAnexos.map((anexo) => (
                      <div key={anexo.id} className="w-full max-w-[140px]">
                        <div
                          className="group relative aspect-square overflow-hidden rounded-md border bg-muted/20 p-2 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          tabIndex={0}
                        >
                          <div className="flex h-full items-center justify-center text-muted-foreground">
                            <Paperclip className="h-5 w-5" />
                          </div>
                          <div className="absolute inset-0 hidden items-center justify-center gap-2 bg-black/35 text-white shadow-lg group-hover:flex group-focus-within:flex">
                              <Button
                                type="button"
                                size="icon"
                                variant="secondary"
                                className="h-8 w-8"
                                onClick={() => openAnexo(anexo.id, 'contrato')}
                                disabled={openingAnexoId === anexo.id}
                                title={openingAnexoId === anexo.id ? 'Abrindo anexo...' : 'Visualizar anexo'}
                              >
                                {openingAnexoId === anexo.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                              </Button>
                            {!isReadOnly && (
                              <Button
                                type="button"
                                size="icon"
                                variant="destructive"
                                className="h-8 w-8"
                                onClick={() => removeExistingAnexo(anexo.id, 'contrato')}
                                disabled={removingAnexoId === anexo.id}
                                title="Remover anexo"
                                aria-label="Remover anexo"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                        <div className="mt-1 space-y-0.5">
                          <div className="truncate text-xs font-medium">{anexo.nome}</div>
                          <div className="truncate text-[11px] text-muted-foreground">{anexo.arquivo_nome}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!isReadOnly && (
                <div
                  className="cursor-pointer rounded-md border-2 border-dashed p-6 text-center text-sm text-muted-foreground hover:border-primary/40 hover:bg-muted/30"
                  onClick={() => openAnexoDialogByClick('contrato')}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault()
                    const dropped = e.dataTransfer.files?.[0]
                    if (!dropped) return
                    openAnexoDialogByDrop(dropped, 'contrato')
                  }}
                >
                  <p className="font-medium text-foreground">Arraste um arquivo aqui</p>
                  <p className="mt-1">ou clique para selecionar</p>
                  <div className="mt-3">
                    <Button type="button" variant="outline" size="sm" onClick={() => openAnexoDialogByClick('contrato')}>
                      <Plus className="mr-1 h-4 w-4" />
                      Novo anexo
                    </Button>
                  </div>
                </div>
              )}

              {pendingAnexos.length > 0 && (
                <div className="space-y-2 rounded-md border p-3">
                  <p className="text-sm font-medium">Anexos pendentes</p>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
                    {pendingAnexos.map((anexo, idx) => (
                      <div key={idx} className="w-full max-w-[140px]">
                        <div
                          className="group relative aspect-square overflow-hidden rounded-md border bg-muted/30 p-2 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          tabIndex={0}
                        >
                          <div className="flex h-full items-center justify-center text-muted-foreground">
                            <Paperclip className="h-5 w-5" />
                          </div>
                          <div className="absolute inset-0 hidden items-center justify-center gap-2 bg-black/35 text-white shadow-lg group-hover:flex group-focus-within:flex">
                            <Button
                              type="button"
                              size="icon"
                              variant="secondary"
                              className="h-8 w-8"
                              onClick={() => openPendingAnexo(idx)}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            {!isReadOnly && (
                              <Button
                                type="button"
                                size="icon"
                                variant="destructive"
                                className="h-8 w-8"
                                onClick={() => removePendingAnexo(idx)}
                                title="Remover anexo pendente"
                                aria-label="Remover anexo pendente"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                        <div className="mt-1 space-y-0.5">
                          <div className="truncate text-xs font-medium">{anexo.nome}</div>
                          <div className="truncate text-[11px] text-muted-foreground">{anexo.file?.name || 'Arquivo pendente'}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'casos' && (
        <Card>
          <CardHeader>
            <CardTitle>Etapa 2 - Casos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {sortedCaseRefs.map(({ caso, idx }) => {
                const draft = isCasoRascunho(caso)
                const button = (
                  <Button
                    key={idx}
                    type="button"
                    variant={idx === selectedCaseIndex ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSelectedCaseIndex(idx)}
                  >
                    <span className="inline-flex items-center gap-1">
                      {getCasoCardLabel(caso, idx)}
                      {draft ? <Pencil className="h-3.5 w-3.5" /> : null}
                    </span>
                  </Button>
                )

                return draft ? (
                  <Tooltip key={idx} content="Caso em rascunho">
                    <span className="inline-flex">{button}</span>
                  </Tooltip>
                ) : (
                  button
                )
              })}
              {!isReadOnly && (
                <Button type="button" variant="outline" size="sm" onClick={addCaso}>
                  <Plus className="mr-1 h-4 w-4" />
                  Novo caso
                </Button>
              )}
              {!isReadOnly && form.casos.length > 1 ? (
                <Tooltip
                  content={
                    isCasoRascunho(form.casos[selectedCaseIndex])
                      ? 'Remover caso em rascunho'
                      : 'Só é possível remover casos em rascunho'
                  }
                >
                  <span className="inline-flex">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => removeCaso(selectedCaseIndex)}
                      disabled={!isCasoRascunho(form.casos[selectedCaseIndex])}
                    >
                      Remover caso atual
                    </Button>
                  </span>
                </Tooltip>
              ) : null}
            </div>

            <div className="rounded-md border p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {caseSubsteps.map((item, idx) => {
                  const ItemIcon = item.icon
                  const locked = !!validateSubstepGate(item.key)
                  const active = substep === item.key
                  return (
                    <div key={item.key} className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openSubstep(item.key)}
                        disabled={locked}
                        className={`rounded-md px-2 py-1 ${
                          active ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground'
                        } ${locked ? 'cursor-not-allowed opacity-50' : 'hover:bg-muted'}`}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <ItemIcon className="h-3.5 w-3.5" />
                          {item.label}
                        </span>
                      </button>
                      {idx < caseSubsteps.length - 1 ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : null}
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="rounded-md border p-4">
              {substep === 'basico' && (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="space-y-2 md:col-span-2">
                    <Label>Nome</Label>
                    <Input
                      value={currentCaso.nome}
                      onChange={(e) => updateCurrentCaso({ nome: e.target.value })}
                      disabled={isReadOnly}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Serviço</Label>
                    <CommandSelect
                      value={currentCaso.servico_id || ''}
                      onValueChange={(value) => updateCurrentCaso({ servico_id: value })}
                      options={servicoOptions}
                      placeholder="Selecione..."
                      searchPlaceholder="Buscar serviço..."
                      emptyText="Nenhum serviço encontrado."
                      disabled={isReadOnly}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Produto</Label>
                    <CommandSelect
                      value={currentCaso.produto_id}
                      onValueChange={(value) => updateCurrentCaso({ produto_id: value })}
                      options={produtoOptions}
                      placeholder="Selecione..."
                      searchPlaceholder="Buscar produto..."
                      emptyText="Nenhum produto encontrado."
                      disabled={isReadOnly}
                    />
                  </div>

                  <div className="space-y-2 md:col-span-2">
                    <Label>Natureza do caso</Label>
                    <ChoiceCards
                      value={String(regras.natureza_caso || '')}
                      onChange={(value) => updateCurrentRegra('natureza_caso', value)}
                      options={[
                        { value: 'contencioso', label: 'Contencioso' },
                        { value: 'consultivo', label: 'Consultivo' },
                      ]}
                      disabled={isReadOnly}
                    />
                  </div>

                  <div className="space-y-2 md:col-span-2">
                    <Label>Responsável</Label>
                    <CommandSelect
                      value={currentCaso.responsavel_id}
                      onValueChange={(value) => updateCurrentCaso({ responsavel_id: value })}
                      options={colaboradorOptions}
                      placeholder="Selecione..."
                      searchPlaceholder="Buscar responsável..."
                      emptyText="Nenhum responsável encontrado."
                      disabled={isReadOnly}
                    />
                  </div>

                  <div className="space-y-2 md:col-span-2">
                    <RateioSlider
                      title="Centro de custo (rateio)"
                      options={centroOptions}
                      items={(currentCaso.centro_custo_rateio || [])
                        .filter((item) => item.centro_custo_id)
                        .map((item) => ({
                          id: item.centro_custo_id,
                          percentual: item.percentual ?? 0,
                        }))}
                      onChange={setCentroRateio}
                      disabled={isReadOnly}
                    />
                  </div>

                  <div className="space-y-2 md:col-span-2">
                    <Label>Anexos do caso</Label>

                    {(((currentCaso as any)?.anexos || []) as any[]).length > 0 && (
                      <div className="space-y-2 rounded-md border p-3">
                        <p className="text-sm font-medium">Anexos já cadastrados</p>
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
                          {(((currentCaso as any)?.anexos || []) as any[]).map((anexo: any) => (
                            <div key={anexo.id} className="w-full max-w-[140px]">
                              <div
                                className="group relative aspect-square overflow-hidden rounded-md border bg-muted/20 p-2 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                tabIndex={0}
                              >
                                <div className="flex h-full items-center justify-center text-muted-foreground">
                                  <Paperclip className="h-5 w-5" />
                                </div>
                                <div className="absolute inset-0 hidden items-center justify-center gap-2 bg-black/35 text-white shadow-lg group-hover:flex group-focus-within:flex">
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="secondary"
                                    className="h-8 w-8"
                                    onClick={() => openAnexo(anexo.id, 'caso')}
                                    disabled={openingAnexoId === anexo.id}
                                    title={openingAnexoId === anexo.id ? 'Abrindo anexo...' : 'Visualizar anexo'}
                                  >
                                    {openingAnexoId === anexo.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                                  </Button>
                                  {!isReadOnly && (
                                    <Button
                                      type="button"
                                      size="icon"
                                      variant="destructive"
                                      className="h-8 w-8"
                                      onClick={() => removeExistingAnexo(anexo.id, 'caso', selectedCaseIndex)}
                                      disabled={removingAnexoId === anexo.id}
                                      title="Remover anexo"
                                      aria-label="Remover anexo"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  )}
                                </div>
                              </div>
                              <div className="mt-1 space-y-0.5">
                                <div className="truncate text-xs font-medium">{anexo.nome}</div>
                                <div className="truncate text-[11px] text-muted-foreground">{anexo.arquivo_nome}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {!isReadOnly && (
                      <div
                        className="cursor-pointer rounded-md border-2 border-dashed p-6 text-center text-sm text-muted-foreground hover:border-primary/40 hover:bg-muted/30"
                        onClick={() => openAnexoDialogByClick('caso', selectedCaseIndex)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault()
                          const dropped = e.dataTransfer.files?.[0]
                          if (!dropped) return
                          openAnexoDialogByDrop(dropped, 'caso', selectedCaseIndex)
                        }}
                      >
                        <p className="font-medium text-foreground">Arraste um arquivo aqui</p>
                        <p className="mt-1">ou clique para selecionar</p>
                        <div className="mt-3">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => openAnexoDialogByClick('caso', selectedCaseIndex)}
                          >
                            <Plus className="mr-1 h-4 w-4" />
                            Novo anexo
                          </Button>
                        </div>
                      </div>
                    )}

                    {(pendingCaseAnexos[selectedCaseIndex] || []).length > 0 && (
                      <div className="space-y-2 rounded-md border p-3">
                        <p className="text-sm font-medium">Anexos pendentes</p>
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
                          {(pendingCaseAnexos[selectedCaseIndex] || []).map((anexo, idx) => (
                            <div key={`${selectedCaseIndex}-${idx}`} className="w-full max-w-[140px]">
                              <div
                                className="group relative aspect-square overflow-hidden rounded-md border bg-muted/30 p-2 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                tabIndex={0}
                              >
                                <div className="flex h-full items-center justify-center text-muted-foreground">
                                  <Paperclip className="h-5 w-5" />
                                </div>
                                <div className="absolute inset-0 hidden items-center justify-center gap-2 bg-black/35 text-white shadow-lg group-hover:flex group-focus-within:flex">
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="secondary"
                                    className="h-8 w-8"
                                    onClick={() => openPendingCaseAnexo(selectedCaseIndex, idx)}
                                  >
                                    <Eye className="h-4 w-4" />
                                  </Button>
                                  {!isReadOnly && (
                                    <Button
                                      type="button"
                                      size="icon"
                                      variant="destructive"
                                      className="h-8 w-8"
                                      onClick={() => removePendingCaseAnexo(selectedCaseIndex, idx)}
                                      title="Remover anexo pendente"
                                      aria-label="Remover anexo pendente"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  )}
                                </div>
                              </div>
                              <div className="mt-1 space-y-0.5">
                                <div className="truncate text-xs font-medium">{anexo.nome}</div>
                                <div className="truncate text-[11px] text-muted-foreground">{anexo.file?.name || 'Arquivo pendente'}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {substep === 'financeiro' && (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="space-y-2 md:col-span-2">
                    <Label>Regras financeiras</Label>
                    <div className="flex flex-wrap gap-2">
                      {currentFinanceRules.map((rule, idx) => {
                        const selected = idx === selectedFinanceRuleIndex
                        const labelTipo = rule.regra_cobranca
                          ? rule.regra_cobranca.replaceAll('_', ' ')
                          : 'Nova regra'
                        return (
                          <Button
                            key={rule.id}
                            type="button"
                            variant={selected ? 'default' : 'outline'}
                            className="gap-1.5"
                            onClick={() => selectFinanceRule(idx)}
                          >
                            {idx + 1}. {labelTipo}
                            {rule.status === 'rascunho' ? <Pencil className="h-3.5 w-3.5" /> : null}
                            {rule.status === 'encerrado' ? (
                              <Badge className="bg-muted text-muted-foreground">encerrada</Badge>
                            ) : null}
                          </Button>
                        )
                      })}

                      {!isReadOnly && (
                        <Button type="button" variant="outline" onClick={addFinanceRule}>
                          + Nova regra
                        </Button>
                      )}

                      {!isReadOnly && (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={removeCurrentFinanceRule}
                          disabled={!isCurrentFinanceRuleDraft}
                        >
                          Remover regra atual
                        </Button>
                      )}

                      {!isReadOnly && (
                        <Button type="button" variant="outline" onClick={toggleCurrentFinanceRuleStatus}>
                          <Power className={`mr-1 h-3.5 w-3.5 ${isCurrentFinanceRuleClosed ? 'text-green-600' : 'text-red-600'}`} />
                          {isCurrentFinanceRuleClosed ? 'Reativar regra' : 'Encerrar regra'}
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Moeda</Label>
                    <NativeSelect
                      value={currentCaso.moeda}
                      onChange={(e) => updateCurrentCaso({ moeda: e.target.value as CasoPayload['moeda'] })}
                      disabled={isReadOnly}
                    >
                      <option value="real">Real</option>
                      <option value="euro">Euro</option>
                      <option value="dolar">Dólar</option>
                    </NativeSelect>
                  </div>

                  <div className="space-y-2">
                    <Label>Tipo de cobrança</Label>
                    <NativeSelect
                      value={currentCaso.tipo_cobranca_documento}
                      onChange={(e) =>
                        updateCurrentCaso({
                          tipo_cobranca_documento: e.target.value as CasoPayload['tipo_cobranca_documento'],
                        })
                      }
                      disabled={isReadOnly}
                    >
                      <option value="">Selecione...</option>
                      <option value="invoice">Invoice</option>
                      <option value="nf">NF</option>
                    </NativeSelect>
                  </div>

                  <div className="space-y-2">
                    <Label>Data início faturamento</Label>
                    <DatePicker
                      value={currentCaso.data_inicio_faturamento}
                      onChange={(value) =>
                        updateCurrentCaso(
                          isEdit
                            ? { data_inicio_faturamento: value }
                            : { data_inicio_faturamento: value, data_ultimo_reajuste: value },
                        )
                      }
                      disabled={isReadOnly}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Pagamento em (dia do mês)</Label>
                    <Input
                      value={currentCaso.pagamento_dia_mes}
                      onChange={(e) =>
                        updateCurrentCaso({
                          pagamento_dia_mes: e.target.value.replace(/\D/g, '').slice(0, 2),
                        })
                      }
                      disabled={isReadOnly}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Início da vigência</Label>
                    <DatePicker
                      value={currentCaso.inicio_vigencia}
                      onChange={(value) => updateCurrentCaso({ inicio_vigencia: value })}
                      disabled={isReadOnly}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Período reajuste</Label>
                    <NativeSelect
                      value={currentCaso.periodo_reajuste || 'nao_tem'}
                      onChange={(e) => {
                        const nextPeriod = e.target.value
                        if (nextPeriod === 'nao_tem') {
                          updateCurrentCaso({
                            periodo_reajuste: 'nao_tem',
                            indice_reajuste: 'nao_tem',
                            data_proximo_reajuste: '',
                            data_ultimo_reajuste: '',
                          })
                          return
                        }
                        updateCurrentCaso({ periodo_reajuste: nextPeriod })
                      }}
                      disabled={isReadOnly}
                    >
                      <option value="nao_tem">Não tem</option>
                      <option value="mensal">Mensal</option>
                      <option value="bimestral">Bimestral</option>
                      <option value="trimestral">Trimestral</option>
                      <option value="semestral">Semestral</option>
                      <option value="anual">Anual</option>
                    </NativeSelect>
                  </div>

                  {reajusteEnabled ? (
                    <>
                      <div className="space-y-2">
                        <Label>Data próximo reajuste</Label>
                        <DatePicker
                          value={currentCaso.data_proximo_reajuste}
                          onChange={(value) => {
                            if (isEdit) updateCurrentCaso({ data_proximo_reajuste: value })
                          }}
                          disabled={isReadOnly || !isEdit}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Data último reajuste</Label>
                        <DatePicker
                          value={currentCaso.data_ultimo_reajuste}
                          onChange={(value) => updateCurrentCaso({ data_ultimo_reajuste: value })}
                          disabled={isReadOnly}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Índice de reajuste</Label>
                        <NativeSelect
                          value={currentCaso.indice_reajuste || 'nao_tem'}
                          onChange={(e) => updateCurrentCaso({ indice_reajuste: e.target.value })}
                          disabled={isReadOnly}
                        >
                          <option value="nao_tem">Não tem</option>
                          <option value="IPCA">IPCA</option>
                          <option value="SELIC">SELIC</option>
                          <option value="IGP-M">IGP-M</option>
                          <option value="INPC">INPC</option>
                        </NativeSelect>
                      </div>
                    </>
                  ) : null}

                  <div className="space-y-2">
                    <Label>Regra de cobrança</Label>
                    <NativeSelect
                      value={currentCaso.regra_cobranca}
                      onChange={(e) =>
                        updateCurrentCaso({ regra_cobranca: e.target.value as CasoPayload['regra_cobranca'] })
                      }
                      disabled={isReadOnly}
                    >
                      <option value="">Selecione...</option>
                      <option value="hora">Hora</option>
                      <option value="mensal">Mensal</option>
                      <option value="mensalidade_processo">Mensalidade de processo</option>
                      <option value="projeto">Projeto</option>
                      <option value="exito">Êxito</option>
                    </NativeSelect>
                  </div>

                  <div className="space-y-2 md:col-span-2">
                    <Label>Habilitar cap desejado</Label>
                    <ChoiceCards
                      value={capDesejadoEnabled ? 'sim' : 'nao'}
                      onChange={(value) => {
                        if (value === 'nao') {
                          updateCurrentRegra('cap_desejado_enabled', false)
                          updateCurrentRegra('cap_desejado_horas', '')
                          return
                        }
                        updateCurrentRegra('cap_desejado_enabled', true)
                        if (!String(regras.cap_desejado_horas || '').trim()) {
                          updateCurrentRegra('cap_desejado_horas', '0')
                        }
                      }}
                      disabled={isReadOnly || currentCaso.regra_cobranca === 'hora'}
                      options={[
                        { value: 'nao', label: 'Não' },
                        { value: 'sim', label: 'Sim' },
                      ]}
                    />
                    {currentCaso.regra_cobranca === 'hora' ? (
                      <p className="text-xs text-muted-foreground">Indisponível para regra de cobrança por hora.</p>
                    ) : null}
                  </div>
                  {capDesejadoEnabled ? (
                    <div className="space-y-2">
                      <Label>Cap desejado (Quantidade de horas)</Label>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={String(regras.cap_desejado_horas || '')}
                        onChange={(e) => updateCurrentRegra('cap_desejado_horas', e.target.value)}
                        disabled={isReadOnly || currentCaso.regra_cobranca === 'hora'}
                        placeholder="Ex: 120"
                      />
                    </div>
                  ) : null}

                  {currentCaso.regra_cobranca === 'hora' && (
                    <div className="space-y-3 md:col-span-2">
                      <div className="border-t" />
                      <p className="text-base font-semibold">Configuração de cobrança por Hora</p>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div className="space-y-2 md:col-span-2">
                          <Label>Modelo de precificação</Label>
                          <ChoiceCards
                            value={modoPreco}
                            onChange={(value) => {
                              const nextMode = value
                              updateCurrentRegra('modo_preco', nextMode)
                              if (nextMode === 'valor_hora') {
                                updateCurrentRegra('tabela_preco_id', '')
                                updateCurrentRegra('tabela_preco_nome', '')
                                updateCurrentRegra('tabela_preco_itens', [])
                                setCreatingPriceTable(false)
                              } else if (!(regras.tabela_preco_itens || []).length) {
                                updateCurrentRegra('tabela_preco_itens', buildDefaultTabelaPrecoItens())
                              }
                            }}
                            disabled={isReadOnly}
                            columns={2}
                            options={[
                              { value: 'valor_hora', label: 'Valor da hora' },
                              { value: 'tabela', label: 'Tabela de preço' },
                            ]}
                          />
                        </div>

                        {modoPreco === 'valor_hora' && (
                          <div className="space-y-1 md:col-span-2">
                            <Label>Valor da hora</Label>
                            <MoneyInput
                              value={regras.valor_hora || ''}
                              onValueChange={(value) => updateCurrentRegra('valor_hora', value)}
                              disabled={isReadOnly}
                            />
                          </div>
                        )}

                        {modoPreco === 'tabela' && (
                          <>
                            <div className="space-y-1 md:col-span-2">
                              <Label>Tabela de preço</Label>
                              <div className="flex flex-col gap-2 md:flex-row">
                                <div className="flex-1">
                                  <CommandSelect
                                    value={creatingPriceTable ? '__new__' : (regras.tabela_preco_id || regras.tabela_preco_nome || '')}
                                    onValueChange={(value) => {
                                      if (value === '__new__') {
                                        updateCurrentRegra('modo_preco', 'tabela')
                                        setCreatingPriceTable(true)
                                        setNewPriceTableName('')
                                        updateCurrentRegra('tabela_preco_id', '')
                                        updateCurrentRegra('tabela_preco_nome', '')
                                        updateCurrentRegra('tabela_preco_itens', buildDefaultTabelaPrecoItens())
                                        setPriceTableDialogOpen(true)
                                        return
                                      }
                                      setCreatingPriceTable(false)
                                      const selectedTable = getPriceTableByKey(value)
                                      if (!selectedTable) {
                                        setError('Tabela de preço não encontrada')
                                        return
                                      }
                                      updateCurrentRegra('modo_preco', 'tabela')
                                      updateCurrentRegra('tabela_preco_id', selectedTable.id || '')
                                      updateCurrentRegra('tabela_preco_nome', selectedTable.nome)
                                      updateCurrentRegra(
                                        'tabela_preco_itens',
                                        selectedTable?.itens || buildDefaultTabelaPrecoItens(),
                                      )
                                      setError(null)
                                    }}
                                    options={priceTableOptions}
                                    placeholder={priceTableCatalog.length === 0 ? 'Cadastre a primeira tabela' : 'Selecionar tabela'}
                                    searchPlaceholder="Buscar tabela..."
                                    emptyText="Nenhuma tabela encontrada."
                                    disabled={isReadOnly}
                                  />
                                </div>
                                {!isReadOnly && (
                                  <Button type="button" variant="outline" onClick={() => setPriceTableDialogOpen(true)}>
                                    {creatingPriceTable || !regras.tabela_preco_nome ? 'Cadastrar tabela' : 'Editar tabela'}
                                  </Button>
                                )}
                              </div>
                            </div>
                            {(regras.tabela_preco_nome || '').trim() && (
                              <div className="rounded-md border bg-muted/20 p-3 text-sm md:col-span-2">
                                <p className="font-medium">{regras.tabela_preco_nome}</p>
                                <p className="text-muted-foreground">
                                  {(regras.tabela_preco_itens || []).length} cargos configurados.
                                </p>
                              </div>
                            )}
                            {priceTableCatalog.length === 0 && (
                              <Alert className="md:col-span-2">
                                <AlertTitle>Cadastre uma tabela de preço</AlertTitle>
                                <AlertDescription>
                                  Para usar o modelo por tabela, você precisa cadastrar ao menos uma tabela de preços.
                                </AlertDescription>
                              </Alert>
                            )}
                          </>
                        )}

                        <div className="space-y-2">
                          <Label>CAP</Label>
                          <ChoiceCards
                            value={regras.cap_enabled ? 'sim' : 'nao'}
                            onChange={(value) => {
                              const enabled = value === 'sim'
                              updateCurrentRegra('cap_enabled', enabled)
                              if (!enabled) {
                                updateCurrentRegra('cap_limites_enabled', false)
                                updateCurrentRegra('cap_min_enabled', false)
                                updateCurrentRegra('cap_max_enabled', false)
                                updateCurrentRegra('cap_min', '')
                                updateCurrentRegra('cap_max', '')
                              }
                            }}
                            disabled={isReadOnly}
                            columns={2}
                            options={[
                              { value: 'nao', label: 'Cap desabilitado' },
                              { value: 'sim', label: 'Cap habilitado' },
                            ]}
                          />
                        </div>

                        {regras.cap_enabled && (
                          <>
                            <div className="space-y-1">
                              <Label>Tipo de CAP</Label>
                              <NativeSelect
                                value={regras.cap_tipo || 'hora'}
                                onChange={(e) => updateCurrentRegra('cap_tipo', e.target.value)}
                                disabled={isReadOnly}
                              >
                                <option value="hora">Cap por hora</option>
                                <option value="valor">Cap por valor</option>
                              </NativeSelect>
                            </div>
                            <div className="space-y-2">
                              <Label>Habilitar limites?</Label>
                              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                                <label className="flex items-center gap-2 text-sm text-gray-700">
                                  <input
                                    type="checkbox"
                                    checked={capMinEnabled}
                                    onChange={(e) => {
                                      const enabled = e.currentTarget.checked
                                      updateCurrentRegra('cap_min_enabled', enabled)
                                      updateCurrentRegra('cap_limites_enabled', enabled || capMaxEnabled)
                                      if (!enabled) updateCurrentRegra('cap_min', '')
                                    }}
                                    disabled={isReadOnly}
                                    className="h-4 w-4 rounded border-gray-300"
                                  />
                                  Ativar limite inferior
                                </label>
                                <label className="flex items-center gap-2 text-sm text-gray-700">
                                  <input
                                    type="checkbox"
                                    checked={capMaxEnabled}
                                    onChange={(e) => {
                                      const enabled = e.currentTarget.checked
                                      updateCurrentRegra('cap_max_enabled', enabled)
                                      updateCurrentRegra('cap_limites_enabled', capMinEnabled || enabled)
                                      if (!enabled) updateCurrentRegra('cap_max', '')
                                    }}
                                    disabled={isReadOnly}
                                    className="h-4 w-4 rounded border-gray-300"
                                  />
                                  Ativar limite superior
                                </label>
                              </div>
                            </div>
                            <div className="grid grid-cols-1 gap-3 md:col-span-2 md:grid-cols-2">
                              {capMinEnabled ? (
                                <div className="space-y-1">
                                  <Label>Limite inferior</Label>
                                  <MoneyInput
                                    value={regras.cap_min || ''}
                                    onValueChange={(value) => updateCurrentRegra('cap_min', value)}
                                    disabled={isReadOnly}
                                    placeholder="Opcional"
                                  />
                                </div>
                              ) : (
                                <div />
                              )}
                              {capMaxEnabled && (
                                <div className="space-y-1">
                                  <Label>Limite superior</Label>
                                  <MoneyInput
                                    value={regras.cap_max || ''}
                                    onValueChange={(value) => updateCurrentRegra('cap_max', value)}
                                    disabled={isReadOnly}
                                    placeholder="Opcional"
                                  />
                                </div>
                              )}
                            </div>
                            <div className="space-y-2">
                              <Label>Cobrar excedente?</Label>
                            <ChoiceCards
                              value={regras.cobra_excedente ? 'sim' : 'nao'}
                              onChange={(value) => {
                                const enabled = value === 'sim'
                                updateCurrentRegra('cobra_excedente', enabled)
                                if (!enabled) {
                                  updateCurrentRegra('valor_hora_excedente', '')
                                }
                              }}
                              disabled={isReadOnly}
                              columns={2}
                              options={[
                                { value: 'nao', label: 'Não cobra excedente' },
                                { value: 'sim', label: 'Cobra excedente' },
                              ]}
                            />
                          </div>
                          {modoPreco === 'valor_hora' && regras.cobra_excedente && (
                            <div className="space-y-1">
                              <Label>Valor da hora excedente</Label>
                              <MoneyInput
                                value={regras.valor_hora_excedente || ''}
                                onValueChange={(value) => updateCurrentRegra('valor_hora_excedente', value)}
                                disabled={isReadOnly}
                              />
                            </div>
                          )}
                          <div className="space-y-2 md:col-span-2">
                              <Label>Encontro de contas</Label>
                              <ChoiceCards
                                value={regras.encontro_contas_enabled ? 'sim' : 'nao'}
                                onChange={(value) => {
                                  const enabled = value === 'sim'
                                  updateCurrentRegra('encontro_contas_enabled', enabled)
                                  if (!enabled) {
                                    updateCurrentRegra('encontro_periodicidade', '')
                                    updateCurrentRegra('data_proximo_encontro', '')
                                  }
                                }}
                                disabled={isReadOnly}
                                columns={2}
                                options={[
                                  { value: 'nao', label: 'Não' },
                                  { value: 'sim', label: 'Sim' },
                                ]}
                              />
                            </div>
                            {regras.encontro_contas_enabled && (
                              <>
                                <div className="space-y-1">
                                  <Label>Periodicidade encontro de contas</Label>
                                  <NativeSelect
                                    value={regras.encontro_periodicidade || ''}
                                    onChange={(e) => {
                                      const periodicidade = e.target.value
                                      updateCurrentRegra('encontro_periodicidade', periodicidade)

                                      const months = periodToMonths[periodicidade] || 0
                                      const baseDate = regras.data_ultimo_encontro || currentCaso.inicio_vigencia || ''
                                      const day = Number(currentCaso.pagamento_dia_mes || '0') || undefined
                                      const nextDate = months > 0 && baseDate ? buildNextDate(baseDate, months, day) : ''
                                      updateCurrentRegra('data_proximo_encontro', nextDate)
                                    }}
                                    disabled={isReadOnly}
                                  >
                                    <option value="">Selecione...</option>
                                    <option value="mensal">Encontro mensal</option>
                                    <option value="bimestral">Encontro bimestral</option>
                                    <option value="trimestral">Encontro trimestral</option>
                                    <option value="semestral">Encontro semestral</option>
                                    <option value="anual">Encontro anual</option>
                                  </NativeSelect>
                                </div>
                                <div className="space-y-1">
                                  <Label>Data último encontro de contas</Label>
                                  <DatePicker
                                    value={regras.data_ultimo_encontro || ''}
                                    onChange={() => {}}
                                    disabled
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label>Data próximo encontro de contas</Label>
                                  <DatePicker
                                    value={regras.data_proximo_encontro || ''}
                                    onChange={(value) => updateCurrentRegra('data_proximo_encontro', value)}
                                    disabled={isReadOnly || !isEdit}
                                  />
                                </div>
                              </>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {currentCaso.regra_cobranca === 'mensal' && (
                    <div className="space-y-2 md:col-span-2">
                      <div className="border-t" />
                      <p className="text-base font-semibold">Configuração de cobrança mensal</p>
                      <Label>Valor mensal do projeto</Label>
                      <MoneyInput
                        value={regras.valor_mensal || ''}
                        onValueChange={(value) => updateCurrentRegra('valor_mensal', value)}
                        disabled={isReadOnly}
                      />
                    </div>
                  )}

                  {currentCaso.regra_cobranca === 'mensalidade_processo' && (
                    <div className="space-y-2 md:col-span-2">
                      <div className="border-t" />
                      <p className="text-base font-semibold">Configuração de mensalidade de processo</p>
                      <Label>Valor mensal</Label>
                      <MoneyInput
                        value={regras.valor_mensal || ''}
                        onValueChange={(value) => updateCurrentRegra('valor_mensal', value)}
                        disabled={isReadOnly}
                      />
                    </div>
                  )}

                  {currentCaso.regra_cobranca === 'projeto' && (
                    <div className="space-y-3 md:col-span-2">
                      <div className="border-t" />
                      <p className="text-base font-semibold">Configuração de cobrança por Projeto</p>
                      <Label>Valor do projeto</Label>
                      <MoneyInput
                        value={regras.valor_projeto || ''}
                        onValueChange={(value) => {
                          updateCurrentRegra('valor_projeto', value)
                          setError(null)
                        }}
                        disabled={isReadOnly}
                      />
                      <div className="flex flex-wrap gap-2">
                        <span className="mr-1 text-xs font-medium text-muted-foreground">Atalhos:</span>
                        <Button type="button" variant="outline" size="sm" disabled={isReadOnly} onClick={() => applyParcelasShortcut([1, 1])}>
                          50/50
                        </Button>
                        <Button type="button" variant="outline" size="sm" disabled={isReadOnly} onClick={() => applyParcelasShortcut([1, 1, 1])}>
                          3 iguais
                        </Button>
                        <Button type="button" variant="outline" size="sm" disabled={isReadOnly} onClick={() => applyParcelasShortcut([1, 1, 1, 1])}>
                          4 iguais
                        </Button>
                        <Button type="button" variant="outline" size="sm" disabled={isReadOnly} onClick={() => applyParcelasShortcut([3, 3, 4])}>
                          30/30/40
                        </Button>
                        <Button type="button" variant="outline" size="sm" disabled={isReadOnly} onClick={() => applyParcelasShortcut([4, 2, 2, 2])}>
                          40/20/20/20
                        </Button>
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <Label>Parcelas</Label>
                        {!isReadOnly && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              updateCurrentRegra('parcelas', [...(regras.parcelas || []), { valor: '', data_pagamento: '' }])
                            }
                          >
                            Adicionar parcela
                          </Button>
                        )}
                      </div>
                      <div className="flex justify-end">
                        <Badge className={Math.abs(getParcelasRestante()) < 0.01 ? '' : 'bg-muted'}>
                          {Math.abs(getParcelasRestante()) < 0.01
                            ? 'Parcelas fechadas'
                            : getParcelasRestante() > 0
                              ? `Valor faltante: ${formatAmount(getParcelasRestante())}`
                              : `Valor excedente: ${formatAmount(Math.abs(getParcelasRestante()))}`}
                        </Badge>
                      </div>
                      {(regras.parcelas || []).map((parcela: any, idx: number) => (
                        <div key={idx} className="grid grid-cols-1 gap-2 md:grid-cols-3">
                          <MoneyInput
                            value={parcela.valor || ''}
                            disabled={isReadOnly}
                            onValueChange={(value) => {
                              const arr = [...(regras.parcelas || [])]
                              arr[idx] = { ...arr[idx], valor: value }
                              updateCurrentRegra('parcelas', arr)
                            }}
                          />
                          <DatePicker
                            value={parcela.data_pagamento || ''}
                            onChange={(value) => {
                              const arr = [...(regras.parcelas || [])]
                              arr[idx] = { ...arr[idx], data_pagamento: value }
                              updateCurrentRegra('parcelas', arr)
                            }}
                            disabled={isReadOnly}
                          />
                          {!isReadOnly && (
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => {
                                const arr = [...(regras.parcelas || [])]
                                arr.splice(idx, 1)
                                updateCurrentRegra('parcelas', arr)
                              }}
                            >
                              Remover
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {currentCaso.regra_cobranca === 'exito' && (
                    <div className="grid grid-cols-1 gap-2 md:col-span-2 md:grid-cols-3">
                      <div className="md:col-span-3 border-t" />
                      <p className="md:col-span-3 text-base font-semibold">Configuração de cobrança por Êxito</p>
                      <div className="space-y-1">
                        <Label>Porcentagem de êxito (%)</Label>
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          placeholder="Ex: 20"
                          value={regras.percentual_exito || ''}
                          onChange={(e) => {
                            const percentual = Number(e.target.value || '0')
                            const valorAcao = parseAmount(regras.valor_acao || '0')
                            updateCurrentRegra('percentual_exito', e.target.value)
                            updateCurrentRegra('valor_exito_calculado', ((valorAcao * percentual) / 100).toFixed(2))
                          }}
                          disabled={isReadOnly}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>Valor da ação</Label>
                        <MoneyInput
                          value={regras.valor_acao || ''}
                          onValueChange={(value) => {
                            const valorAcao = parseAmount(value || '0')
                            const percentual = Number(regras.percentual_exito || '0')
                            updateCurrentRegra('valor_acao', value)
                            updateCurrentRegra('valor_exito_calculado', ((valorAcao * percentual) / 100).toFixed(2))
                          }}
                          disabled={isReadOnly}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>Data de pagamento</Label>
                        <DatePicker
                          value={regras.data_pagamento_exito || ''}
                          onChange={(value) => updateCurrentRegra('data_pagamento_exito', value)}
                          disabled={isReadOnly}
                        />
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-4 md:col-span-2 md:grid-cols-2">
                    <div className="space-y-2 md:col-span-2">
                      <div className="border-t" />
                      <p className="pt-2 text-base font-semibold">Regras de negócio e indicação</p>
                    </div>
                    <div className="space-y-2">
                      <Label>Cross Sell de cobrança?</Label>
                      <ChoiceCards
                        value={crossSellEnabled ? 'sim' : 'nao'}
                        onChange={(value) => {
                          const enabled = value === 'sim'
                          updateCurrentCrossSell('ativo', enabled)
                          if (!enabled) {
                            updateCurrentCrossSell('origem_colaborador_id', '')
                            updateCurrentCrossSell('periodicidade', 'mensal')
                            updateCurrentCrossSell('modo', 'percentual')
                            updateCurrentCrossSell('valor', '')
                            updateCurrentCrossSell('data_pagamento_unico', '')
                            updateCurrentCrossSell('usar_dia_vencimento', true)
                            updateCurrentCrossSell('dia_pagamento_mensal', '')
                            updateCurrentCrossSell('data_fim_pagamentos', '')
                            updateCurrentCrossSell('parcelas_pagamento', [])
                            return
                          }

                          if (!String(regras.cross_sell_origem_colaborador_id || '').trim() && options.colaboradores?.[0]?.id) {
                            updateCurrentCrossSell('origem_colaborador_id', options.colaboradores[0].id)
                          }
                          if (!String(regras.cross_sell_periodicidade || '').trim()) {
                            setCrossSellPeriodicidade(periodicidadeIndicacaoOptions[0]?.value || 'pontual')
                          }
                          if (!String(regras.cross_sell_modo || '').trim()) {
                            updateCurrentCrossSell('modo', 'percentual')
                          }
                        }}
                        options={[
                          { value: 'nao', label: 'Não' },
                          { value: 'sim', label: 'Sim' },
                        ]}
                        disabled={isReadOnly}
                        columns={2}
                      />
                    </div>
                    {crossSellEnabled && (
                      <>
                        <div className="space-y-2">
                          <Label>Origem do cross sell</Label>
                          <CommandSelect
                            value={String(regras.cross_sell_origem_colaborador_id || '')}
                            onValueChange={(value) => updateCurrentCrossSell('origem_colaborador_id', value)}
                            options={colaboradorOptions}
                            placeholder="Selecione..."
                            searchPlaceholder="Buscar colaborador..."
                            emptyText="Nenhum colaborador encontrado."
                            disabled={isReadOnly}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Periodicidade do cross selling</Label>
                          <NativeSelect
                            value={crossSellPeriodicidade || periodicidadeIndicacaoOptions[0]?.value || 'pontual'}
                            disabled={isReadOnly}
                            onChange={(e) => setCrossSellPeriodicidade(e.target.value)}
                          >
                            {periodicidadeIndicacaoOptions.map((option) => (
                              <option key={`cross-sell-${option.value}`} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </NativeSelect>
                        </div>
                        <div className="space-y-2">
                          <Label>Método</Label>
                          <NativeSelect
                            value={crossSellModo}
                            disabled={isReadOnly}
                            onChange={(e) => updateCurrentCrossSell('modo', e.target.value)}
                          >
                            <option value="percentual">Percentual</option>
                            <option value="valor">Valor</option>
                          </NativeSelect>
                        </div>
                        <div className="space-y-2">
                          <Label>{crossSellModo === 'valor' ? 'Valor' : 'Percentual'}</Label>
                          {crossSellModo === 'valor' ? (
                            <MoneyInput
                              value={regras.cross_sell_valor || ''}
                              onValueChange={(value) => updateCurrentCrossSell('valor', value)}
                              disabled={isReadOnly}
                            />
                          ) : (
                            <Input
                              value={regras.cross_sell_valor || ''}
                              disabled={isReadOnly}
                              onChange={(e) => updateCurrentCrossSell('valor', e.target.value)}
                            />
                          )}
                        </div>
                        {(crossSellPeriodicidade === 'pontual' || crossSellPeriodicidade === 'ao_final') && (
                          <div className="space-y-2">
                            <Label>Data do pagamento do cross selling</Label>
                            <DatePicker
                              value={regras.cross_sell_data_pagamento_unico || ''}
                              onChange={(value) => updateCurrentCrossSell('data_pagamento_unico', value)}
                              disabled={isReadOnly}
                            />
                          </div>
                        )}
                        {crossSellPeriodicidade === 'mensal' && (
                          <>
                            <div className="space-y-2">
                              <Label>Usar dia de vencimento do caso?</Label>
                              <ChoiceCards
                                value={regras.cross_sell_usar_dia_vencimento ? 'sim' : 'nao'}
                                onChange={(value) => updateCurrentCrossSell('usar_dia_vencimento', value === 'sim')}
                                disabled={isReadOnly}
                                options={[
                                  { value: 'sim', label: 'Sim' },
                                  { value: 'nao', label: 'Não' },
                                ]}
                              />
                            </div>
                            {!regras.cross_sell_usar_dia_vencimento && (
                              <div className="space-y-2">
                                <Label>Dia do pagamento mensal</Label>
                                <Input
                                  type="number"
                                  min={1}
                                  max={31}
                                  value={regras.cross_sell_dia_pagamento_mensal || ''}
                                  onChange={(e) => updateCurrentCrossSell('dia_pagamento_mensal', e.target.value)}
                                  disabled={isReadOnly}
                                />
                              </div>
                            )}
                            <div className="space-y-2">
                              <Label>Data final dos pagamentos</Label>
                              <DatePicker
                                value={regras.cross_sell_data_fim_pagamentos || ''}
                                onChange={(value) => updateCurrentCrossSell('data_fim_pagamentos', value)}
                                disabled={isReadOnly}
                              />
                            </div>
                          </>
                        )}
                        {crossSellPeriodicidade === 'parcelado' && (
                          <div className="space-y-2 md:col-span-2">
                            <div className="flex items-center justify-between">
                              <Label>Parcelas do cross selling</Label>
                              {!isReadOnly && (
                                <Button type="button" variant="outline" size="sm" onClick={addCrossSellParcela}>
                                  Adicionar parcela
                                </Button>
                              )}
                            </div>
                            {(Array.isArray(regras.cross_sell_parcelas_pagamento) ? regras.cross_sell_parcelas_pagamento : []).map(
                              (parcela: any, idx: number) => (
                                <div key={idx} className="grid grid-cols-1 gap-2 md:grid-cols-3">
                                  <MoneyInput
                                    value={parcela?.valor || ''}
                                    onValueChange={(value) => updateCrossSellParcela(idx, 'valor', value)}
                                    disabled={isReadOnly}
                                  />
                                  <DatePicker
                                    value={parcela?.data_pagamento || ''}
                                    onChange={(value) => updateCrossSellParcela(idx, 'data_pagamento', value)}
                                    disabled={isReadOnly}
                                  />
                                  {!isReadOnly && (
                                    <Button type="button" variant="outline" onClick={() => removeCrossSellParcela(idx)}>
                                      Remover
                                    </Button>
                                  )}
                                </div>
                              ),
                            )}
                          </div>
                        )}
                        <div className="space-y-2 md:col-span-2">
                          <Label>Previsão de pagamento do cross selling</Label>
                          <div className="rounded-md border p-3 text-sm text-muted-foreground">
                            {crossSellPreview.length ? (
                              <ul className="space-y-1">
                                {crossSellPreview.map((linha, idx) => (
                                  <li key={`${linha}-${idx}`}>{linha}</li>
                                ))}
                              </ul>
                            ) : (
                              <p>Defina os dados para visualizar a previsão.</p>
                            )}
                          </div>
                        </div>
                      </>
                    )}
                    <div className="space-y-2">
                      <Label>Pagamento da indicação</Label>
                      <ChoiceCards
                        value={indicacaoPagamentoEnabled ? 'sim' : 'nao'}
                        disabled={isReadOnly}
                        onChange={(value) => {
                          if (value === 'nao') {
                            updateCurrentIndicacao('pagamento_indicacao_ativo', false)
                            updateCurrentIndicacao('pagamento_indicacao', 'nao')
                            return
                          }
                          const nextValue =
                            options.colaboradores?.[0]
                              ? `colaborador:${options.colaboradores[0].id}`
                              : options.clientes?.[0]
                                ? `cliente:${options.clientes[0].id}`
                                : options.prestadores?.[0]
                                  ? `prestador:${options.prestadores[0].id}`
                                  : options.parceiros?.[0]
                                    ? `parceiro:${options.parceiros[0].id}`
                                    : ''
                          updateCurrentIndicacao('pagamento_indicacao_ativo', true)
                          updateCurrentIndicacao('pagamento_indicacao', nextValue)
                        }}
                        columns={2}
                        options={[
                          { value: 'nao', label: 'Não' },
                          { value: 'sim', label: 'Sim' },
                        ]}
                      />
                    </div>
                    {indicacaoPagamentoEnabled && (
                      <>
                        <div className="space-y-2">
                          <Label>Indicado por</Label>
                          <CommandSelect
                            value={indicacao.pagamento_indicacao || ''}
                            onValueChange={(value) => updateCurrentIndicacao('pagamento_indicacao', value)}
                            options={indicacaoOptions}
                            placeholder="Selecione..."
                            searchPlaceholder="Buscar indicado..."
                            emptyText="Nenhum indicado encontrado."
                            disabled={isReadOnly}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Periodicidade</Label>
                          <NativeSelect
                            value={indicacao.periodicidade || periodicidadeIndicacaoOptions[0]?.value || 'pontual'}
                            disabled={isReadOnly}
                            onChange={(e) => setIndicacaoPeriodicidade(e.target.value)}
                          >
                            {periodicidadeIndicacaoOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </NativeSelect>
                        </div>
                        <div className="space-y-2">
                          <Label>Modo</Label>
                          <NativeSelect
                            value={indicacao.modo || 'percentual'}
                            disabled={isReadOnly}
                            onChange={(e) => updateCurrentIndicacao('modo', e.target.value)}
                          >
                            <option value="percentual">Percentual</option>
                            <option value="valor">Valor</option>
                          </NativeSelect>
                        </div>
                        <div className="space-y-2">
                          <Label>{indicacao.modo === 'valor' ? 'Valor' : 'Percentual'}</Label>
                          {indicacao.modo === 'valor' ? (
                            <MoneyInput
                              value={indicacao.valor || ''}
                              onValueChange={(value) => updateCurrentIndicacao('valor', value)}
                              disabled={isReadOnly}
                            />
                          ) : (
                            <Input
                              value={indicacao.valor || ''}
                              disabled={isReadOnly}
                              onChange={(e) => updateCurrentIndicacao('valor', e.target.value)}
                            />
                          )}
                        </div>
                        {(indicacao.periodicidade === 'pontual' || indicacao.periodicidade === 'ao_final') && (
                          <div className="space-y-2">
                            <Label>Data do pagamento</Label>
                            <DatePicker
                              value={indicacao.data_pagamento_unico || ''}
                              onChange={(value) => updateCurrentIndicacao('data_pagamento_unico', value)}
                              disabled={isReadOnly}
                            />
                          </div>
                        )}
                        {indicacao.periodicidade === 'mensal' && (
                          <>
                            <div className="space-y-2">
                              <Label>Usar dia de vencimento do caso?</Label>
                              <ChoiceCards
                                value={indicacao.usar_dia_vencimento ? 'sim' : 'nao'}
                                onChange={(value) => updateCurrentIndicacao('usar_dia_vencimento', value === 'sim')}
                                disabled={isReadOnly}
                                options={[
                                  { value: 'sim', label: 'Sim' },
                                  { value: 'nao', label: 'Não' },
                                ]}
                              />
                            </div>
                            {!indicacao.usar_dia_vencimento && (
                              <div className="space-y-2">
                                <Label>Dia do pagamento mensal</Label>
                                <Input
                                  type="number"
                                  min={1}
                                  max={31}
                                  value={indicacao.dia_pagamento_mensal || ''}
                                  onChange={(e) => updateCurrentIndicacao('dia_pagamento_mensal', e.target.value)}
                                  disabled={isReadOnly}
                                />
                              </div>
                            )}
                            <div className="space-y-2">
                              <Label>Data final dos pagamentos</Label>
                              <DatePicker
                                value={indicacao.data_fim_pagamentos || ''}
                                onChange={(value) => updateCurrentIndicacao('data_fim_pagamentos', value)}
                                disabled={isReadOnly}
                              />
                            </div>
                          </>
                        )}
                        {indicacao.periodicidade === 'parcelado' && (
                          <div className="space-y-2 md:col-span-2">
                            <div className="flex items-center justify-between">
                              <Label>Parcelas da indicação</Label>
                              {!isReadOnly && (
                                <Button type="button" variant="outline" size="sm" onClick={addIndicacaoParcela}>
                                  Adicionar parcela
                                </Button>
                              )}
                            </div>
                            {(Array.isArray(indicacao.parcelas_pagamento) ? indicacao.parcelas_pagamento : []).map((parcela: any, idx: number) => (
                              <div key={idx} className="grid grid-cols-1 gap-2 md:grid-cols-3">
                                <MoneyInput
                                  value={parcela?.valor || ''}
                                  onValueChange={(value) => updateIndicacaoParcela(idx, 'valor', value)}
                                  disabled={isReadOnly}
                                />
                                <DatePicker
                                  value={parcela?.data_pagamento || ''}
                                  onChange={(value) => updateIndicacaoParcela(idx, 'data_pagamento', value)}
                                  disabled={isReadOnly}
                                />
                                {!isReadOnly && (
                                  <Button type="button" variant="outline" onClick={() => removeIndicacaoParcela(idx)}>
                                    Remover
                                  </Button>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="space-y-2 md:col-span-2">
                          <Label>Previsão de pagamento da indicação</Label>
                          <div className="rounded-md border p-3 text-sm text-muted-foreground">
                            {indicacaoPreview.length ? (
                              <ul className="space-y-1">
                                {indicacaoPreview.map((linha, idx) => (
                                  <li key={`${linha}-${idx}`}>{linha}</li>
                                ))}
                              </ul>
                            ) : (
                              <p>Defina os dados para visualizar a previsão.</p>
                            )}
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="space-y-2 md:col-span-2">
                    <div className="border-t" />
                    <p className="text-base font-semibold">Pagadores do serviço (rateio)</p>
                    <RateioSlider
                      title=""
                      options={clienteOptions}
                      items={(currentCaso.pagadores_servico || [])
                        .filter((item) => item.cliente_id)
                        .map((item) => ({
                          id: item.cliente_id,
                          percentual: item.percentual ?? 0,
                        }))}
                      onChange={setPagadoresServicoRateio}
                      disabled={isReadOnly}
                      frameless
                    />
                  </div>
                </div>
              )}

              {substep === 'despesas' && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Despesas reembolsáveis</Label>
                    <ChoiceCards
                      value={despesasReembolsaveisEnabled ? 'sim' : 'nao'}
                      onChange={(value) => {
                        if (value === 'nao') {
                          updateCurrentDespesas('reembolsavel_ativo', false)
                          updateCurrentDespesas('despesas_reembolsaveis', ['nao'])
                          updateCurrentDespesas('limite_adiantamento', '')
                          updateCurrentCaso({ pagadores_despesa: [] })
                        } else {
                          const next = (despesas.despesas_reembolsaveis || []).filter((item: string) => item !== 'nao')
                          updateCurrentDespesas('reembolsavel_ativo', true)
                          updateCurrentDespesas('despesas_reembolsaveis', next)
                        }
                      }}
                      disabled={isReadOnly}
                      columns={2}
                      options={[
                        { value: 'nao', label: 'Não' },
                        { value: 'sim', label: 'Sim' },
                      ]}
                    />
                  </div>

                  {despesasReembolsaveisEnabled && (
                    <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                      {[
                        { key: 'viagem', label: 'Viagem' },
                        { key: 'despesas_extrajudiciais', label: 'Despesas Extrajudiciais' },
                        { key: 'despesas_judiciais', label: 'Despesas Judiciais' },
                        { key: 'deslocamento', label: 'Deslocamento' },
                      ].map((op) => {
                        const selected: string[] = despesas.despesas_reembolsaveis || []
                        const isSelected = selected.includes(op.key)
                        return (
                          <button
                            key={op.key}
                            type="button"
                            className={`rounded-md border px-3 py-2 text-left text-sm ${
                              isSelected ? 'border-primary bg-primary/10' : ''
                            }`}
                            disabled={isReadOnly}
                            onClick={() => {
                              const next = isSelected ? selected.filter((s) => s !== op.key) : [...selected, op.key]
                              updateCurrentDespesas('despesas_reembolsaveis', next)
                            }}
                          >
                            {op.label}
                          </button>
                        )
                      })}
                    </div>
                  )}

                  {showDespesaDetalhes && (
                    <>
                      <div className="space-y-2">
                        <Label>Limite de adiantamento</Label>
                        <MoneyInput
                          value={despesas.limite_adiantamento || ''}
                          onValueChange={(value) => updateCurrentDespesas('limite_adiantamento', value)}
                          disabled={isReadOnly}
                        />
                      </div>

                      <div className="space-y-2">
                        <RateioSlider
                          title="Pagadores da despesa (rateio)"
                          options={clienteOptions}
                          items={(currentCaso.pagadores_despesa || [])
                            .filter((item) => item.cliente_id)
                            .map((item) => ({
                              id: item.cliente_id,
                              percentual: item.percentual ?? 0,
                            }))}
                          onChange={setPagadoresDespesaRateio}
                          disabled={isReadOnly}
                          frameless
                        />
                      </div>
                    </>
                  )}
                </div>
              )}

              {substep === 'timesheet' && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Enviar timesheet ao cliente?</Label>
                    <ChoiceCards
                      value={timesheet.envia_timesheet ? 'sim' : 'nao'}
                      disabled={isReadOnly}
                      onChange={(value) => updateCurrentTimesheet('envia_timesheet', value === 'sim')}
                      columns={2}
                      options={[
                        { value: 'nao', label: 'Não' },
                        { value: 'sim', label: 'Sim' },
                      ]}
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="mb-2 flex items-center justify-between">
                      <Label>Revisores</Label>
                      {!isReadOnly && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            updateCurrentTimesheet('revisores', [
                              ...(timesheet.revisores || []),
                              { colaborador_id: '', ordem: (timesheet.revisores || []).length + 1 },
                            ])
                          }
                        >
                          Adicionar
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">Arraste para ordenar a sequência de revisão.</p>

                    {(timesheet.revisores || []).map((item: any, idx: number) => (
                      <div
                        key={idx}
                        className={`mb-2 grid grid-cols-1 gap-2 rounded-md border p-2 md:grid-cols-[auto_1fr_auto] ${
                          dragRevisorIndex === idx ? 'opacity-60' : ''
                        }`}
                        draggable={!isReadOnly}
                        onDragStart={() => setDragRevisorIndex(idx)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => {
                          if (dragRevisorIndex === null) return
                          reorderTimeList('revisores', dragRevisorIndex, idx)
                          setDragRevisorIndex(null)
                        }}
                        onDragEnd={() => setDragRevisorIndex(null)}
                      >
                        <div className="flex h-10 w-10 items-center justify-center rounded border text-sm font-semibold text-muted-foreground">
                          #{idx + 1}
                        </div>
                        <CommandSelect
                          value={item.colaborador_id || ''}
                          onValueChange={(value) => {
                            const list = [...(timesheet.revisores || [])]
                            list[idx] = { ...list[idx], colaborador_id: value }
                            updateCurrentTimesheet('revisores', list)
                          }}
                          options={colaboradorOptions}
                          placeholder="Selecione..."
                          searchPlaceholder="Buscar revisor..."
                          emptyText="Nenhum colaborador encontrado."
                          disabled={isReadOnly}
                        />
                        {!isReadOnly && (
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                              const list = [...(timesheet.revisores || [])]
                              list.splice(idx, 1)
                              updateCurrentTimesheet(
                                'revisores',
                                list.map((entry: any, orderIdx: number) => ({ ...entry, ordem: orderIdx + 1 })),
                              )
                            }}
                          >
                            Remover
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="space-y-2">
                    <div className="mb-2 flex items-center justify-between">
                      <Label>Aprovadores</Label>
                      {!isReadOnly && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            updateCurrentTimesheet('aprovadores', [
                              ...(timesheet.aprovadores || []),
                              { colaborador_id: '', ordem: (timesheet.aprovadores || []).length + 1 },
                            ])
                          }
                        >
                          Adicionar
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">Arraste para ordenar a sequência de aprovação.</p>

                    {(timesheet.aprovadores || []).map((item: any, idx: number) => (
                      <div
                        key={idx}
                        className={`mb-2 grid grid-cols-1 gap-2 rounded-md border p-2 md:grid-cols-[auto_1fr_auto] ${
                          dragAprovadorIndex === idx ? 'opacity-60' : ''
                        }`}
                        draggable={!isReadOnly}
                        onDragStart={() => setDragAprovadorIndex(idx)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => {
                          if (dragAprovadorIndex === null) return
                          reorderTimeList('aprovadores', dragAprovadorIndex, idx)
                          setDragAprovadorIndex(null)
                        }}
                        onDragEnd={() => setDragAprovadorIndex(null)}
                      >
                        <div className="flex h-10 w-10 items-center justify-center rounded border text-sm font-semibold text-muted-foreground">
                          #{idx + 1}
                        </div>
                        <CommandSelect
                          value={item.colaborador_id || ''}
                          onValueChange={(value) => {
                            const list = [...(timesheet.aprovadores || [])]
                            list[idx] = { ...list[idx], colaborador_id: value }
                            updateCurrentTimesheet('aprovadores', list)
                          }}
                          options={aprovadorOptions}
                          placeholder="Selecione..."
                          searchPlaceholder="Buscar aprovador..."
                          emptyText="Nenhum sócio encontrado."
                          disabled={isReadOnly}
                        />
                        {!isReadOnly && (
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                              const list = [...(timesheet.aprovadores || [])]
                              list.splice(idx, 1)
                              updateCurrentTimesheet(
                                'aprovadores',
                                list.map((entry: any, orderIdx: number) => ({ ...entry, ordem: orderIdx + 1 })),
                              )
                            }}
                          >
                            Remover
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>

                </div>
              )}

              {false && (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Pagamento da indicação</Label>
                    <ChoiceCards
                      value={indicacaoPagamentoEnabled ? 'sim' : 'nao'}
                      disabled={isReadOnly}
                      onChange={(value) => {
                        if (value === 'nao') {
                          updateCurrentIndicacao('pagamento_indicacao_ativo', false)
                          updateCurrentIndicacao('pagamento_indicacao', 'nao')
                          return
                        }
                        const nextValue =
                          options.colaboradores?.[0]
                            ? `colaborador:${options.colaboradores[0].id}`
                            : options.clientes?.[0]
                              ? `cliente:${options.clientes[0].id}`
                              : options.prestadores?.[0]
                                ? `prestador:${options.prestadores[0].id}`
                                : options.parceiros?.[0]
                                  ? `parceiro:${options.parceiros[0].id}`
                                  : ''
                        updateCurrentIndicacao('pagamento_indicacao_ativo', true)
                        updateCurrentIndicacao('pagamento_indicacao', nextValue)
                      }}
                      columns={2}
                      options={[
                        { value: 'nao', label: 'Não' },
                        { value: 'sim', label: 'Sim' },
                      ]}
                    />
                  </div>

                  {indicacaoPagamentoEnabled && (
                    <div className="space-y-2">
                      <Label>Indicado por</Label>
                      <CommandSelect
                        value={indicacao.pagamento_indicacao || ''}
                        onValueChange={(value) => updateCurrentIndicacao('pagamento_indicacao', value)}
                        options={indicacaoOptions}
                        placeholder="Selecione..."
                        searchPlaceholder="Buscar indicado..."
                        emptyText="Nenhum indicado encontrado."
                        disabled={isReadOnly}
                      />
                    </div>
                  )}

                  {indicacaoPagamentoEnabled && (
                    <>
                      <div className="space-y-2">
                        <Label>Periodicidade</Label>
                        <NativeSelect
                          value={indicacao.periodicidade || 'mensal'}
                          disabled={isReadOnly}
                          onChange={(e) => updateCurrentIndicacao('periodicidade', e.target.value)}
                        >
                          <option value="mensal">Mensal</option>
                          <option value="ao_final">Ao final</option>
                          <option value="pontual">Pontual</option>
                        </NativeSelect>
                      </div>

                      <div className="space-y-2">
                        <Label>Modo</Label>
                        <NativeSelect
                          value={indicacao.modo || 'percentual'}
                          disabled={isReadOnly}
                          onChange={(e) => updateCurrentIndicacao('modo', e.target.value)}
                        >
                          <option value="percentual">Percentual</option>
                          <option value="valor">Valor</option>
                        </NativeSelect>
                      </div>

                      <div className="space-y-2">
                        <Label>{indicacao.modo === 'valor' ? 'Valor' : 'Percentual'}</Label>
                        <Input
                          value={indicacao.valor || ''}
                          disabled={isReadOnly}
                          onChange={(e) => updateCurrentIndicacao('valor', e.target.value)}
                        />
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog
        open={anexoDialogOpen}
        onOpenChange={(open) => {
          setAnexoDialogOpen(open)
          if (!open) {
            setAnexoDialogNome('')
            setAnexoDialogFile(null)
            setAnexoDialogFromDrop(false)
            setAnexoDialogCaseIndex(null)
            setAnexoDialogTarget('contrato')
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Novo anexo</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {anexoDialogFromDrop ? (
              <div className="rounded-md border p-3 text-sm">
                <p className="font-medium">{anexoDialogFile?.name || 'Arquivo selecionado'}</p>
                <p className="text-muted-foreground">Arquivo já anexado. Informe apenas o nome.</p>
              </div>
            ) : (
              <div className="space-y-1">
                <Label>Arquivo</Label>
                <Input
                  type="file"
                  onChange={(e) => setAnexoDialogFile(e.target.files?.[0] || null)}
                />
              </div>
            )}

            <div className="space-y-1">
              <Label>Nome do anexo</Label>
              <Input
                value={anexoDialogNome}
                onChange={(e) => setAnexoDialogNome(e.target.value)}
                placeholder="Ex: Proposta comercial"
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setAnexoDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="button" onClick={submitAnexoDialog}>
                Adicionar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={priceTableDialogOpen}
        onOpenChange={(open) => {
          setPriceTableDialogOpen(open)
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Tabela de preço por cargo</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Tabela</Label>
              <CommandSelect
                value={creatingPriceTable ? '__new__' : (regras.tabela_preco_id || regras.tabela_preco_nome || '')}
                onValueChange={(value) => {
                  if (value === '__new__') {
                    updateCurrentRegra('modo_preco', 'tabela')
                    setCreatingPriceTable(true)
                    setNewPriceTableName('')
                    updateCurrentRegra('tabela_preco_id', '')
                    updateCurrentRegra('tabela_preco_nome', '')
                    updateCurrentRegra('tabela_preco_itens', buildDefaultTabelaPrecoItens())
                    return
                  }
                  const selectedTable = getPriceTableByKey(value)
                  if (!selectedTable) {
                    setError('Tabela de preço não encontrada')
                    return
                  }
                  setCreatingPriceTable(false)
                  updateCurrentRegra('modo_preco', 'tabela')
                  updateCurrentRegra('tabela_preco_id', selectedTable.id || '')
                  updateCurrentRegra('tabela_preco_nome', selectedTable.nome)
                  updateCurrentRegra('tabela_preco_itens', selectedTable?.itens || buildDefaultTabelaPrecoItens())
                  setError(null)
                }}
                options={priceTableOptions}
                placeholder={priceTableCatalog.length === 0 ? 'Cadastre a primeira tabela' : 'Selecionar tabela'}
                searchPlaceholder="Buscar tabela..."
                emptyText="Nenhuma tabela encontrada."
                disabled={isReadOnly}
              />
            </div>

            {(creatingPriceTable || !regras.tabela_preco_nome) && (
              <div className="space-y-1">
                <Label>Nome da nova tabela</Label>
                <Input
                  value={newPriceTableName}
                  onChange={(e) => setNewPriceTableName(e.target.value)}
                  disabled={isReadOnly}
                  placeholder="Ex: Tabela Tributário 2026"
                />
              </div>
            )}

            <div className="space-y-3 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <p className="text-base font-semibold">Preenchimento por cargo</p>
                <Badge>{(regras.tabela_preco_itens || []).length} cargos</Badge>
              </div>
              {(regras.tabela_preco_itens || []).length === 0 ? (
                <p className="text-sm text-muted-foreground">Sem cargos para configurar.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cargo</TableHead>
                      <TableHead>Hora normal</TableHead>
                      <TableHead>Hora excedente</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(regras.tabela_preco_itens || []).map((item: any, idx: number) => (
                      <TableRow key={item.cargo_id || idx}>
                        <TableCell className="font-medium">{item.cargo_nome || cargosMap.get(item.cargo_id) || 'Cargo'}</TableCell>
                        <TableCell>
                          <MoneyInput
                            value={item.valor_hora || ''}
                            disabled={isReadOnly}
                            onValueChange={(value) => {
                              const list = [...(regras.tabela_preco_itens || [])]
                              list[idx] = { ...list[idx], valor_hora: value }
                              updateCurrentRegra('tabela_preco_itens', list)
                            }}
                          />
                        </TableCell>
                        <TableCell>
                          <MoneyInput
                            value={item.valor_hora_excedente || ''}
                            disabled={isReadOnly}
                            onValueChange={(value) => {
                              const list = [...(regras.tabela_preco_itens || [])]
                              list[idx] = { ...list[idx], valor_hora_excedente: value }
                              updateCurrentRegra('tabela_preco_itens', list)
                            }}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
            {!isReadOnly && (
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setPriceTableDialogOpen(false)}>
                  Fechar
                </Button>
                <Button type="button" onClick={savePriceTable} disabled={priceTableSaving || (creatingPriceTable && !newPriceTableName.trim())}>
                  {priceTableSaving ? 'Salvando...' : 'Salvar tabela'}
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <div className="flex justify-end gap-2">
        {step === 'casos' && (
          <Button variant="outline" onClick={() => setStep('dados')} disabled={loading}>
            Voltar
          </Button>
        )}
        {isEdit && form.status === 'rascunho' && !isReadOnly ? (
          <Button variant="outline" onClick={() => setDeleteDraftOpen(true)} disabled={loading || deleteDraftLoading}>
            Excluir rascunho
          </Button>
        ) : null}
        <Button variant="outline" onClick={() => router.push('/contratos')} disabled={loading}>
          Cancelar
        </Button>
        {step === 'dados' ? (
          <Button onClick={goNextStep} disabled={loading}>
            Próximo
          </Button>
        ) : (
          !isReadOnly && (
            <Button onClick={submit} disabled={loading}>
              {loading ? 'Salvando...' : isEdit ? (step === 'casos' ? 'Atualizar caso' : 'Atualizar contrato') : 'Criar contrato'}
            </Button>
          )
        )}
      </div>
      <AlertDialog
        open={deleteDraftOpen}
        onOpenChange={setDeleteDraftOpen}
        title="Excluir contrato em rascunho?"
        description="Essa ação remove o contrato rascunho e os dados vinculados."
        confirmLabel="Excluir"
        cancelLabel="Cancelar"
        onConfirm={deleteDraft}
        loading={deleteDraftLoading}
      />
    </div>
  )
}

function ChoiceCards({
  value,
  onChange,
  options,
  disabled,
  columns = 2,
}: {
  value: string
  onChange: (value: string) => void
  options: ChoiceOption[]
  disabled?: boolean
  columns?: 2 | 3
}) {
  const gridCols = columns === 3 ? 'md:grid-cols-3' : 'md:grid-cols-2'

  return (
    <div className={`grid grid-cols-1 gap-2 ${gridCols}`}>
      {options.map((option) => {
        const selected = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={`rounded-md border px-3 py-2 text-left transition ${
              selected ? 'border-primary bg-primary/10 shadow-sm' : 'hover:border-primary/40'
            } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
          >
            <p className="text-sm font-medium">{option.label}</p>
            {option.description ? <p className="mt-0.5 text-xs text-muted-foreground">{option.description}</p> : null}
          </button>
        )
      })}
    </div>
  )
}
