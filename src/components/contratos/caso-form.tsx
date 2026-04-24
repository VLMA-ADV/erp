'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, CircleDollarSign, Clock3, Copy, Eye, Landmark, Layers3, Loader2, Paperclip, Pencil, Power, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AlertDialog } from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CommandSelect } from '@/components/ui/command-select'
import { DatePicker } from '@/components/ui/date-picker'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MoneyInput } from '@/components/ui/money-input'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'
import { useToast } from '@/components/ui/toast'
import AnexoModal from './anexo-modal'
import CapEncontroSimple from './cap-encontro-simple'
import RateioSlider from './rateio-slider'
import type { CasoPayload, ContratoFormOptions } from './types'

const emptyCaso: CasoPayload = {
  nome: '',
  observacao: '',
  polo: null,
  servico_id: '',
  produto_id: '',
  responsavel_id: '',
  moeda: 'real',
  tipo_cobranca_documento: '',
  data_inicio_faturamento: '',
  dia_inicio_faturamento: '',
  pagamento_dia_mes: '',
  inicio_vigencia: '',
  possui_reajuste: true,
  periodo_reajuste: 'nao_tem',
  data_proximo_reajuste: '',
  data_ultimo_reajuste: '',
  indice_reajuste: 'nao_tem',
  regra_cobranca: '',
  regra_cobranca_config: {
    natureza_caso: '',
    regras_adicionais: [],
    valor_hora: '',
    valor_hora_excedente: '',
    usa_tabela_preco: false,
    tabela_preco_nome: '',
    tabela_preco_itens: [],
    cap_enabled: false,
    cap_limites_enabled: false,
    cap_tipo: 'hora',
    cap_desejado_horas: '',
    cap_min: '',
    cap_max: '',
    cobra_excedente: false,
    encontro_contas_enabled: false,
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
    regra_cobranca_texto: '',
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
}

interface CasoAnexoItem {
  id: string
  nome: string
  arquivo_nome: string
  created_at: string
}

type BillingRuleStatus = 'rascunho' | 'ativo' | 'encerrado'

interface BillingRuleDraft {
  id: string
  status: BillingRuleStatus
  moeda: CasoPayload['moeda']
  tipo_cobranca_documento: CasoPayload['tipo_cobranca_documento']
  data_inicio_faturamento: string
  dia_inicio_faturamento: number | ''
  pagamento_dia_mes: string
  inicio_vigencia: string
  periodo_reajuste: string
  data_proximo_reajuste: string
  data_ultimo_reajuste: string
  indice_reajuste: string
  regra_cobranca: CasoPayload['regra_cobranca']
  quantidade_sm?: number | null
  regra_cobranca_config: Record<string, any>
  pagadores_servico: CasoPayload['pagadores_servico']
  indicacao_config: CasoPayload['indicacao_config']
}

type CaseSubstepKey = 'basico' | 'financeiro' | 'despesas' | 'timesheet'

const caseSubsteps: Array<{ key: CaseSubstepKey; label: string; icon: typeof Layers3 }> = [
  { key: 'basico', label: 'Dados básicos', icon: Layers3 },
  { key: 'financeiro', label: 'Regras financeiras', icon: CircleDollarSign },
  { key: 'despesas', label: 'Despesas', icon: Landmark },
  { key: 'timesheet', label: 'Timesheet', icon: Clock3 },
]

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

function normalizeDiaInicioFaturamento(value: unknown, fallbackDate?: unknown): number | '' {
  const parseDay = (raw: unknown) => {
    if (raw === null || raw === undefined || raw === '') return ''
    const parsed = Number(raw)
    if (!Number.isInteger(parsed)) return ''
    return parsed >= 1 && parsed <= 31 ? parsed : ''
  }

  const direct = parseDay(value)
  if (direct !== '') return direct

  if (typeof fallbackDate === 'string' && fallbackDate) {
    const [, , day] = fallbackDate.split('-')
    return parseDay(day)
  }

  return ''
}

function validateDiaInicioFaturamento(value: number | '') {
  return value === '' || (Number.isInteger(value) && value >= 1 && value <= 31)
}

function normalizePolo(value: unknown): CasoPayload['polo'] {
  if (value === 'ativo' || value === 'passivo') return value
  return null
}

function buildDateFromDay(baseDate: string, dayOfMonth: number | '') {
  if (dayOfMonth === '') return baseDate || ''

  const base = baseDate ? new Date(`${baseDate}T00:00:00`) : new Date()
  if (Number.isNaN(base.getTime())) return ''

  const target = new Date(base.getFullYear(), base.getMonth(), 1)
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  target.setDate(Math.min(dayOfMonth, lastDay))
  return formatDateToInput(target)
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

function createRuleId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `regra_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function sanitizeSingleRuleConfig(config: Record<string, any> | undefined | null) {
  const next = { ...(config || {}) }
  delete (next as any).regras_cobranca
  delete (next as any).regras_financeiras
  return next
}

function cloneCasoValue<T>(value: T): T {
  if (value === null || value === undefined) return value
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value)) as T
}

function normalizePositiveDecimal(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(String(value).replace(',', '.'))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

async function fetchSalarioMinimoAtual(): Promise<{ valor: number | string | null }> {
  const supabase = createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Sessão expirada')

  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-salario-minimo`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
  })
  const data: unknown = await response.json()
  if (!response.ok) {
    const message = data && typeof data === 'object' && 'error' in data ? String(data.error) : 'Erro ao carregar salário mínimo'
    throw new Error(message)
  }
  return data as { valor: number | string | null }
}

function buildInheritedReajusteVigenciaPatch(source?: Partial<CasoPayload> | null): Partial<CasoPayload> {
  if (!source) return {}

  const possuiReajuste = source.possui_reajuste !== false
  const inicioVigencia = String(source.inicio_vigencia || '')
  const dataUltimoReajuste = String(source.data_ultimo_reajuste || inicioVigencia || '')

  return {
    possui_reajuste: possuiReajuste,
    inicio_vigencia: inicioVigencia,
    periodo_reajuste: possuiReajuste ? String(source.periodo_reajuste || emptyCaso.periodo_reajuste) : 'nao_tem',
    data_proximo_reajuste: String(source.data_proximo_reajuste || ''),
    data_ultimo_reajuste: dataUltimoReajuste,
    indice_reajuste: possuiReajuste ? String(source.indice_reajuste || emptyCaso.indice_reajuste) : 'nao_tem',
  }
}

export default function CasoForm({
  contratoId,
  casoId,
  viewOnly = false,
}: {
  contratoId: string
  casoId?: string
  viewOnly?: boolean
}) {
  const router = useRouter()
  const { hasPermission } = usePermissionsContext()
  const { success, error: toastError } = useToast()
  const canWrite =
    hasPermission('contracts.casos.write') || hasPermission('contracts.contratos.write')

  const [substep, setSubstep] = useState<CaseSubstepKey>('basico')
  const [loading, setLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<CasoPayload>(emptyCaso)
  const [options, setOptions] = useState<ContratoFormOptions>({
    clientes: [],
    prestadores: [],
    parceiros: [],
    produtos: [],
    centros_custo: [],
    cargos: [],
    colaboradores: [],
    socios: [],
    tabelas_preco: [],
  })
  const [dayModalOpen, setDayModalOpen] = useState(false)
  const [manualReajusteDate, setManualReajusteDate] = useState(false)
  const [priceTableCatalog, setPriceTableCatalog] = useState<TabelaPrecoCatalog[]>([])
  const [creatingPriceTable, setCreatingPriceTable] = useState(false)
  const [newPriceTableName, setNewPriceTableName] = useState('')
  const [priceTableDialogOpen, setPriceTableDialogOpen] = useState(false)
  const [priceTableSaving, setPriceTableSaving] = useState(false)
  const [anexoModalOpen, setAnexoModalOpen] = useState(false)
  const [caseAnexos, setCaseAnexos] = useState<CasoAnexoItem[]>([])
  const [contractCases, setContractCases] = useState<Array<Record<string, any>>>([])
  const [openingAnexoId, setOpeningAnexoId] = useState<string | null>(null)
  const [removingAnexoId, setRemovingAnexoId] = useState<string | null>(null)
  const [dragRevisorIndex, setDragRevisorIndex] = useState<number | null>(null)
  const [dragAprovadorIndex, setDragAprovadorIndex] = useState<number | null>(null)
  const [billingRules, setBillingRules] = useState<BillingRuleDraft[]>([])
  const [selectedBillingRuleIndex, setSelectedBillingRuleIndex] = useState(0)
  const [deleteCasoOpen, setDeleteCasoOpen] = useState(false)
  const [deleteCasoLoading, setDeleteCasoLoading] = useState(false)

  const isEdit = !!casoId
  const isReadOnly = viewOnly || !canWrite
  const isInicioVigenciaReadOnly = viewOnly || (isEdit && !canWrite)

  const regras = form.regra_cobranca_config || {}
  const despesas = form.despesas_config || {}
  const timesheet = form.timesheet_config || {}
  const indicacao = form.indicacao_config || {}
  const modoPreco = regras.modo_preco || (regras.tabela_preco_id || regras.tabela_preco_nome ? 'tabela' : 'valor_hora')
  const quantidadeSm = normalizePositiveDecimal(regras.quantidade_sm)
  const salarioMinimoQuery = useQuery({
    queryKey: ['salario-minimo-atual'],
    queryFn: fetchSalarioMinimoAtual,
    enabled: form.regra_cobranca === 'salario_minimo',
  })
  const salarioMinimoValor = normalizePositiveDecimal(salarioMinimoQuery.data?.valor)
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
  const possuiReajuste = form.possui_reajuste !== false
  const reajusteEnabled = possuiReajuste && (form.periodo_reajuste || 'nao_tem') !== 'nao_tem'
  const capDesejadoEnabled = Boolean(
    regras.cap_desejado_enabled ??
      (regras.cap_desejado_horas !== null &&
        regras.cap_desejado_horas !== undefined &&
        String(regras.cap_desejado_horas).trim() !== ''),
  )
  const despesasSelecionadas: string[] = despesas.despesas_reembolsaveis || []
  const despesasReembolsaveisEnabled =
    Boolean((despesas as any).reembolsavel_ativo) || (despesasSelecionadas.length > 0 && !despesasSelecionadas.includes('nao'))
  const clienteOptions = useMemo(
    () => (options.clientes || []).map((item) => ({ value: item.id, label: item.nome })),
    [options.clientes],
  )
  const servicoOptions = useMemo(
    () => (options.servicos || []).map((item) => ({ value: item.id, label: item.nome })),
    [options.servicos],
  )
  const centroOptions = useMemo(
    () => (options.centros_custo || []).map((item) => ({ value: item.id, label: item.nome })),
    [options.centros_custo],
  )
  const produtoOptions = useMemo(
    () => (options.produtos || []).map((item) => ({ value: item.id, label: item.nome })),
    [options.produtos],
  )
  const colaboradorOptions = useMemo(
    () =>
      (options.colaboradores || [])
        .filter((item) => item.ativo !== false)
        .map((item) => ({ value: item.id, label: item.nome })),
    [options.colaboradores],
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
  const produtoMap = useMemo(() => new Map((options.produtos || []).map((item) => [item.id, item.nome])), [options.produtos])
  const colaboradorMap = useMemo(() => new Map((options.colaboradores || []).map((item) => [item.id, item.nome])), [options.colaboradores])
  const centroMap = useMemo(() => new Map((options.centros_custo || []).map((item) => [item.id, item.nome])), [options.centros_custo])
  const currentBillingRule = billingRules[selectedBillingRuleIndex]
  const isCurrentRuleDraft = (currentBillingRule?.status || 'rascunho') === 'rascunho'
  const isCurrentRuleClosed = (currentBillingRule?.status || '') === 'encerrado'
  const indicacaoPagamentoEnabled =
    Boolean((indicacao as any).pagamento_indicacao_ativo) ||
    (Boolean(indicacao.pagamento_indicacao) && indicacao.pagamento_indicacao !== 'nao')

  const composeBillingRuleFromForm = (base?: BillingRuleDraft): BillingRuleDraft => ({
    id: base?.id || createRuleId(),
    status: base?.status || 'rascunho',
    moeda: form.moeda,
    tipo_cobranca_documento: form.tipo_cobranca_documento,
    data_inicio_faturamento: form.data_inicio_faturamento,
    dia_inicio_faturamento: form.dia_inicio_faturamento ?? '',
    pagamento_dia_mes: form.pagamento_dia_mes,
    inicio_vigencia: form.inicio_vigencia,
    periodo_reajuste: form.periodo_reajuste,
    data_proximo_reajuste: form.data_proximo_reajuste,
    data_ultimo_reajuste: form.data_ultimo_reajuste,
    indice_reajuste: form.indice_reajuste,
    regra_cobranca: normalizeRegraCobranca(form.regra_cobranca),
    quantidade_sm: normalizeRegraCobranca(form.regra_cobranca) === 'salario_minimo'
      ? normalizePositiveDecimal(form.regra_cobranca_config?.quantidade_sm)
      : null,
    regra_cobranca_config: sanitizeSingleRuleConfig(form.regra_cobranca_config || {}),
    pagadores_servico: [...(form.pagadores_servico || [])],
    indicacao_config: { ...(form.indicacao_config || emptyCaso.indicacao_config) },
  })

  const applyBillingRuleToForm = (rule: BillingRuleDraft) => {
    setForm((prev) => {
      return {
        ...prev,
        moeda: rule.moeda,
        tipo_cobranca_documento: rule.tipo_cobranca_documento,
        data_inicio_faturamento: rule.data_inicio_faturamento,
        dia_inicio_faturamento: rule.dia_inicio_faturamento ?? '',
        pagamento_dia_mes: rule.pagamento_dia_mes,
        inicio_vigencia: rule.inicio_vigencia,
        periodo_reajuste: rule.periodo_reajuste,
        data_proximo_reajuste: rule.data_proximo_reajuste,
        data_ultimo_reajuste: rule.data_ultimo_reajuste,
        indice_reajuste: rule.indice_reajuste,
        regra_cobranca: rule.regra_cobranca,
        regra_cobranca_config: {
          ...sanitizeSingleRuleConfig(rule.regra_cobranca_config || {}),
          quantidade_sm: rule.quantidade_sm ?? rule.regra_cobranca_config?.quantidade_sm ?? '',
        },
        pagadores_servico: [...(rule.pagadores_servico || [])],
        indicacao_config: { ...(rule.indicacao_config || emptyCaso.indicacao_config) },
      }
    })
  }

  const syncCurrentRule = (nextStatus?: BillingRuleStatus) => {
    if (!billingRules[selectedBillingRuleIndex]) return
    const updated = [...billingRules]
    updated[selectedBillingRuleIndex] = {
      ...composeBillingRuleFromForm(updated[selectedBillingRuleIndex]),
      status: nextStatus || updated[selectedBillingRuleIndex].status,
    }
    setBillingRules(updated)
  }

  const selectBillingRule = (index: number) => {
    if (!billingRules[index]) return
    const updated = [...billingRules]
    if (updated[selectedBillingRuleIndex]) {
      updated[selectedBillingRuleIndex] = composeBillingRuleFromForm(updated[selectedBillingRuleIndex])
    }
    setBillingRules(updated)
    setSelectedBillingRuleIndex(index)
    applyBillingRuleToForm(updated[index])
  }

  const addBillingRule = () => {
    const updated = [...billingRules]
    if (updated[selectedBillingRuleIndex]) {
      updated[selectedBillingRuleIndex] = composeBillingRuleFromForm(updated[selectedBillingRuleIndex])
    }
    const nextRule: BillingRuleDraft = {
      id: createRuleId(),
      status: 'rascunho',
      moeda: form.moeda || 'real',
      tipo_cobranca_documento: '',
      data_inicio_faturamento: form.data_inicio_faturamento || '',
      dia_inicio_faturamento: form.dia_inicio_faturamento ?? '',
      pagamento_dia_mes: form.pagamento_dia_mes || '',
      inicio_vigencia: form.inicio_vigencia || '',
      periodo_reajuste: 'nao_tem',
      data_proximo_reajuste: '',
      data_ultimo_reajuste: '',
      indice_reajuste: 'nao_tem',
      regra_cobranca: '',
      quantidade_sm: null,
      regra_cobranca_config: { ...emptyCaso.regra_cobranca_config },
      pagadores_servico: [],
      indicacao_config: { ...emptyCaso.indicacao_config },
    }
    updated.push(nextRule)
    setBillingRules(updated)
    setSelectedBillingRuleIndex(updated.length - 1)
    applyBillingRuleToForm(nextRule)
  }

  const removeCurrentBillingRule = () => {
    const current = billingRules[selectedBillingRuleIndex]
    if (!current) return
    if (current.status !== 'rascunho') {
      setError('Só é possível remover regra de cobrança em rascunho')
      return
    }
    if (billingRules.length <= 1) {
      setError('É necessário manter ao menos uma regra de cobrança')
      return
    }
    const updated = billingRules.filter((_, idx) => idx !== selectedBillingRuleIndex)
    const nextIndex = Math.max(0, selectedBillingRuleIndex - 1)
    setBillingRules(updated)
    setSelectedBillingRuleIndex(nextIndex)
    applyBillingRuleToForm(updated[nextIndex])
  }

  const replicatePreviousCase = () => {
    const lastCase = contractCases[contractCases.length - 1]
    if (!lastCase) return

    const nextFormPatch: Partial<CasoPayload> = {
      nome: `Cópia - ${String(lastCase.nome || '').trim() || 'Caso'}`,
      servico_id: String(lastCase.servico_id || ''),
      produto_id: String(lastCase.produto_id || ''),
      responsavel_id: String(lastCase.responsavel_id || ''),
      ...buildInheritedReajusteVigenciaPatch(lastCase),
      regra_cobranca: normalizeRegraCobranca(lastCase.regra_cobranca as CasoPayload['regra_cobranca']),
      regra_cobranca_config: cloneCasoValue(sanitizeSingleRuleConfig(lastCase.regra_cobranca_config || {})),
      centro_custo_rateio: cloneCasoValue(lastCase.centro_custo_rateio || []),
      pagadores_servico: cloneCasoValue(lastCase.pagadores_servico || []),
      despesas_config: cloneCasoValue(lastCase.despesas_config || emptyCaso.despesas_config),
      pagadores_despesa: cloneCasoValue(lastCase.pagadores_despesa || []),
      timesheet_config: cloneCasoValue(lastCase.timesheet_config || emptyCaso.timesheet_config),
      indicacao_config: cloneCasoValue(lastCase.indicacao_config || emptyCaso.indicacao_config),
    }

    setForm((prev) => ({
      ...prev,
      ...nextFormPatch,
    }))

    const sourceRules = Array.isArray(lastCase.regras_financeiras)
      ? lastCase.regras_financeiras
      : Array.isArray(lastCase.regra_cobranca_config?.regras_cobranca)
        ? lastCase.regra_cobranca_config.regras_cobranca
        : []

    const copiedRules: BillingRuleDraft[] =
      sourceRules.length > 0
        ? sourceRules.map((item: any) => ({
            ...item,
            id: item.id || createRuleId(),
            status: (item.status || 'ativo') as BillingRuleStatus,
            regra_cobranca: normalizeRegraCobranca(item.regra_cobranca as CasoPayload['regra_cobranca']),
            quantidade_sm: normalizePositiveDecimal(item.quantidade_sm ?? item.regra_cobranca_config?.quantidade_sm),
            regra_cobranca_config: sanitizeSingleRuleConfig(cloneCasoValue(item.regra_cobranca_config || {})),
            pagadores_servico: cloneCasoValue(item.pagadores_servico || lastCase.pagadores_servico || []),
            indicacao_config: cloneCasoValue(item.indicacao_config || lastCase.indicacao_config || emptyCaso.indicacao_config),
            moeda: (item.moeda || lastCase.moeda || emptyCaso.moeda) as BillingRuleDraft['moeda'],
            tipo_cobranca_documento: (item.tipo_cobranca_documento || lastCase.tipo_cobranca_documento || emptyCaso.tipo_cobranca_documento) as BillingRuleDraft['tipo_cobranca_documento'],
            data_inicio_faturamento: String(item.data_inicio_faturamento || lastCase.data_inicio_faturamento || ''),
            dia_inicio_faturamento: normalizeDiaInicioFaturamento(
              item.dia_inicio_faturamento,
              item.data_inicio_faturamento || lastCase.data_inicio_faturamento,
            ) || normalizeDiaInicioFaturamento(lastCase.dia_inicio_faturamento, lastCase.data_inicio_faturamento),
            pagamento_dia_mes: String(item.pagamento_dia_mes || lastCase.pagamento_dia_mes || ''),
            inicio_vigencia: String(item.inicio_vigencia || lastCase.inicio_vigencia || ''),
            periodo_reajuste: String(item.periodo_reajuste || lastCase.periodo_reajuste || emptyCaso.periodo_reajuste),
            data_proximo_reajuste: String(item.data_proximo_reajuste || lastCase.data_proximo_reajuste || ''),
            data_ultimo_reajuste: String(item.data_ultimo_reajuste || lastCase.data_ultimo_reajuste || ''),
            indice_reajuste: String(item.indice_reajuste || lastCase.indice_reajuste || emptyCaso.indice_reajuste),
          }))
        : [{
            id: createRuleId(),
            status: 'ativo',
            moeda: (lastCase.moeda || emptyCaso.moeda) as BillingRuleDraft['moeda'],
            tipo_cobranca_documento: (lastCase.tipo_cobranca_documento || emptyCaso.tipo_cobranca_documento) as BillingRuleDraft['tipo_cobranca_documento'],
            data_inicio_faturamento: String(lastCase.data_inicio_faturamento || ''),
            dia_inicio_faturamento: normalizeDiaInicioFaturamento(lastCase.dia_inicio_faturamento, lastCase.data_inicio_faturamento),
            pagamento_dia_mes: String(lastCase.pagamento_dia_mes || ''),
            inicio_vigencia: String(lastCase.inicio_vigencia || ''),
            periodo_reajuste: String(lastCase.periodo_reajuste || emptyCaso.periodo_reajuste),
            data_proximo_reajuste: String(lastCase.data_proximo_reajuste || ''),
            data_ultimo_reajuste: String(lastCase.data_ultimo_reajuste || ''),
            indice_reajuste: String(lastCase.indice_reajuste || emptyCaso.indice_reajuste),
            regra_cobranca: normalizeRegraCobranca(lastCase.regra_cobranca as CasoPayload['regra_cobranca']),
            quantidade_sm: normalizePositiveDecimal(lastCase.quantidade_sm ?? lastCase.regra_cobranca_config?.quantidade_sm),
            regra_cobranca_config: sanitizeSingleRuleConfig(cloneCasoValue(lastCase.regra_cobranca_config || {})),
            pagadores_servico: cloneCasoValue(lastCase.pagadores_servico || []),
            indicacao_config: cloneCasoValue(lastCase.indicacao_config || emptyCaso.indicacao_config),
          }]

    setBillingRules(copiedRules)
    setSelectedBillingRuleIndex(0)
    setError(null)
    success('Dados do caso anterior copiados. Revise antes de salvar.')
  }

  const toggleCurrentBillingRuleStatus = () => {
    const current = billingRules[selectedBillingRuleIndex]
    if (!current) return
    const nextStatus: BillingRuleStatus = current.status === 'encerrado' ? 'ativo' : 'encerrado'
    const updated = [...billingRules]
    updated[selectedBillingRuleIndex] = {
      ...composeBillingRuleFromForm(current),
      status: nextStatus,
    }
    setBillingRules(updated)
  }

  const loadCaseAnexos = async (accessToken?: string) => {
    if (!casoId) {
      setCaseAnexos([])
      return
    }

    try {
      let token = accessToken
      if (!token) {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()
        token = session?.access_token
      }
      if (!token) return

      const contratoResp = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-contrato?id=${contratoId}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      })
      const contratoData = await contratoResp.json()
      if (!contratoResp.ok) return

      const caso = (contratoData.data?.casos || []).find((c: any) => c.id === casoId)
      setCaseAnexos(((caso?.anexos || []) as CasoAnexoItem[]) ?? [])
    } catch (e) {
      console.error(e)
    }
  }

  useEffect(() => {
    const fetchData = async () => {
      setInitialLoading(true)
      setError(null)

      try {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return

        const [optsResp, contratoResp] = await Promise.all([
          fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-contrato-form-options`, {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              'Content-Type': 'application/json',
            },
          }),
          fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-contrato?id=${contratoId}`, {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              'Content-Type': 'application/json',
            },
          }),
        ])

        const optsData = await optsResp.json()
        if (!optsResp.ok) {
          setError(optsData.error || 'Erro ao carregar opções')
          return
        }
        const nextOptions = optsData.data || {
          clientes: [],
          prestadores: [],
          parceiros: [],
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

        const contratoData = await contratoResp.json()
        if (!contratoResp.ok) {
          setError(contratoData.error || 'Erro ao carregar contrato')
          return
        }

        setContractCases(Array.isArray(contratoData.data?.casos) ? contratoData.data.casos : [])

        if (casoId) {
          const caso = (contratoData.data?.casos || []).find((c: any) => c.id === casoId)
          if (!caso) {
            setError('Caso não encontrado')
            return
          }

          const loadedForm: CasoPayload = {
            ...emptyCaso,
            nome: caso.nome || '',
            observacao: caso.observacao || '',
            polo: normalizePolo(caso.polo),
            servico_id: caso.servico_id || '',
            produto_id: caso.produto_id || '',
            responsavel_id: caso.responsavel_id || '',
            moeda: caso.moeda || 'real',
            tipo_cobranca_documento: caso.tipo_cobranca_documento || '',
            data_inicio_faturamento: caso.data_inicio_faturamento || '',
            dia_inicio_faturamento: normalizeDiaInicioFaturamento(caso.dia_inicio_faturamento, caso.data_inicio_faturamento),
            pagamento_dia_mes: caso.pagamento_dia_mes ? String(caso.pagamento_dia_mes) : '',
            inicio_vigencia: caso.inicio_vigencia || '',
            possui_reajuste: caso.possui_reajuste !== false,
            periodo_reajuste: caso.periodo_reajuste || '',
            data_proximo_reajuste: caso.data_proximo_reajuste || '',
            data_ultimo_reajuste: caso.data_ultimo_reajuste || '',
            indice_reajuste: caso.indice_reajuste || '',
            regra_cobranca: normalizeRegraCobranca(caso.regra_cobranca || ''),
            regra_cobranca_config: {
              ...emptyCaso.regra_cobranca_config,
              ...sanitizeSingleRuleConfig(caso.regra_cobranca_config || {}),
            },
            centro_custo_rateio: caso.centro_custo_rateio || [],
            pagadores_servico: caso.pagadores_servico || [],
            despesas_config: caso.despesas_config || emptyCaso.despesas_config,
            pagadores_despesa: caso.pagadores_despesa || [],
            timesheet_config: caso.timesheet_config || emptyCaso.timesheet_config,
            indicacao_config: caso.indicacao_config || emptyCaso.indicacao_config,
          }
          setForm(loadedForm)
          const rulesFromColumn = Array.isArray((caso as any)?.regras_financeiras)
            ? ((caso as any).regras_financeiras as BillingRuleDraft[])
            : []
          const configRules = Array.isArray((loadedForm.regra_cobranca_config as any)?.regras_cobranca)
            ? ((loadedForm.regra_cobranca_config as any).regras_cobranca as BillingRuleDraft[])
            : []
          const sourceRules = rulesFromColumn.length > 0 ? rulesFromColumn : configRules
          const initialRules: BillingRuleDraft[] = sourceRules.length > 0
            ? sourceRules.map((item) => ({
              ...item,
              id: item.id || createRuleId(),
              status: (item.status || 'ativo') as BillingRuleStatus,
              regra_cobranca: normalizeRegraCobranca(item.regra_cobranca as CasoPayload['regra_cobranca']),
              quantidade_sm: normalizePositiveDecimal(item.quantidade_sm ?? item.regra_cobranca_config?.quantidade_sm),
              dia_inicio_faturamento: normalizeDiaInicioFaturamento(
                item.dia_inicio_faturamento,
                item.data_inicio_faturamento || loadedForm.data_inicio_faturamento,
              ) || loadedForm.dia_inicio_faturamento || '',
              regra_cobranca_config: sanitizeSingleRuleConfig(item.regra_cobranca_config || {}),
              indicacao_config: { ...(item.indicacao_config || loadedForm.indicacao_config || emptyCaso.indicacao_config) },
            }))
            : [{
              id: createRuleId(),
              status: (caso.status || 'ativo') as BillingRuleStatus,
              moeda: loadedForm.moeda,
              tipo_cobranca_documento: loadedForm.tipo_cobranca_documento,
              data_inicio_faturamento: loadedForm.data_inicio_faturamento,
              dia_inicio_faturamento: loadedForm.dia_inicio_faturamento ?? '',
              pagamento_dia_mes: loadedForm.pagamento_dia_mes,
              inicio_vigencia: loadedForm.inicio_vigencia,
              periodo_reajuste: loadedForm.periodo_reajuste,
              data_proximo_reajuste: loadedForm.data_proximo_reajuste,
              data_ultimo_reajuste: loadedForm.data_ultimo_reajuste,
              indice_reajuste: loadedForm.indice_reajuste,
              regra_cobranca: normalizeRegraCobranca(loadedForm.regra_cobranca),
              quantidade_sm: normalizePositiveDecimal(loadedForm.regra_cobranca_config?.quantidade_sm),
              regra_cobranca_config: sanitizeSingleRuleConfig(loadedForm.regra_cobranca_config || {}),
              pagadores_servico: [...(loadedForm.pagadores_servico || [])],
              indicacao_config: { ...(loadedForm.indicacao_config || emptyCaso.indicacao_config) },
            }]
          setBillingRules(initialRules)
          setSelectedBillingRuleIndex(0)
          setCaseAnexos(((caso?.anexos || []) as CasoAnexoItem[]) ?? [])
        } else {
          const lastCase =
            Array.isArray(contratoData.data?.casos) && contratoData.data.casos.length > 0
              ? contratoData.data.casos[contratoData.data.casos.length - 1]
              : null
          const inheritedPatch = buildInheritedReajusteVigenciaPatch(lastCase)
          setForm({
            ...emptyCaso,
            ...inheritedPatch,
          })
          const initialRule: BillingRuleDraft = {
            id: createRuleId(),
            status: 'rascunho',
            moeda: emptyCaso.moeda,
            tipo_cobranca_documento: emptyCaso.tipo_cobranca_documento,
            data_inicio_faturamento: emptyCaso.data_inicio_faturamento,
            dia_inicio_faturamento: emptyCaso.dia_inicio_faturamento ?? '',
            pagamento_dia_mes: emptyCaso.pagamento_dia_mes,
            inicio_vigencia: String(inheritedPatch.inicio_vigencia || emptyCaso.inicio_vigencia),
            periodo_reajuste: String(inheritedPatch.periodo_reajuste || emptyCaso.periodo_reajuste),
            data_proximo_reajuste: String(inheritedPatch.data_proximo_reajuste || emptyCaso.data_proximo_reajuste),
            data_ultimo_reajuste: String(inheritedPatch.data_ultimo_reajuste || emptyCaso.data_ultimo_reajuste),
            indice_reajuste: String(inheritedPatch.indice_reajuste || emptyCaso.indice_reajuste),
            regra_cobranca: emptyCaso.regra_cobranca,
            quantidade_sm: null,
            regra_cobranca_config: { ...emptyCaso.regra_cobranca_config },
            pagadores_servico: [],
            indicacao_config: { ...emptyCaso.indicacao_config },
          }
          setBillingRules([initialRule])
          setSelectedBillingRuleIndex(0)
          setCaseAnexos([])
        }
      } catch (e) {
        console.error(e)
        setError('Erro ao carregar dados do caso')
      } finally {
        setInitialLoading(false)
      }
    }

    fetchData()
  }, [contratoId, casoId])

  useEffect(() => {
    if (manualReajusteDate) return
    const months = periodToMonths[form.periodo_reajuste] || 0
    if (!months) return

    const base = form.data_ultimo_reajuste || form.inicio_vigencia
    if (!base) return

    setForm((prev) => ({
      ...prev,
      data_proximo_reajuste: buildNextDate(base, months),
    }))
  }, [form.periodo_reajuste, form.inicio_vigencia, form.data_ultimo_reajuste, manualReajusteDate])

  useEffect(() => {
    if (form.regra_cobranca !== 'hora') return
    const hasCapDesejado = Boolean(regras.cap_desejado_enabled) || String(regras.cap_desejado_horas || '').trim() !== ''
    if (!hasCapDesejado) return
    setForm((prev) => ({
      ...prev,
      regra_cobranca_config: {
        ...(prev.regra_cobranca_config || {}),
        cap_desejado_enabled: false,
        cap_desejado_horas: '',
      },
    }))
  }, [form.regra_cobranca, regras.cap_desejado_enabled, regras.cap_desejado_horas])

  useEffect(() => {
    setForm((prev) => {
      const regras = { ...(prev.regra_cobranca_config || {}) }
      let changed = false
      const inicioVigencia = prev.inicio_vigencia || ''

      if ((regras.data_ultimo_encontro || '') !== inicioVigencia) {
        regras.data_ultimo_encontro = inicioVigencia
        changed = true
      }

      if (!regras.encontro_contas_enabled) {
        if (regras.data_proximo_encontro) {
          regras.data_proximo_encontro = ''
          changed = true
        }
      } else if (regras.encontro_periodicidade && regras.data_ultimo_encontro) {
        const months = periodToMonths[regras.encontro_periodicidade] || 0
        if (months > 0) {
          const day = Number(prev.pagamento_dia_mes || '0') || undefined
          const calculated = buildNextDate(regras.data_ultimo_encontro, months, day)
          if (!isEdit || !regras.data_proximo_encontro) {
            if ((regras.data_proximo_encontro || '') !== calculated) {
              regras.data_proximo_encontro = calculated
              changed = true
            }
          }
        }
      }

      if (!changed) return prev
      return { ...prev, regra_cobranca_config: regras }
    })
  }, [
    form.inicio_vigencia,
    form.pagamento_dia_mes,
    form.regra_cobranca_config?.encontro_contas_enabled,
    form.regra_cobranca_config?.encontro_periodicidade,
    isEdit,
  ])

  useEffect(() => {
    setBillingRules((prev) => {
      if (!prev[selectedBillingRuleIndex]) return prev
      const next = [...prev]
      next[selectedBillingRuleIndex] = composeBillingRuleFromForm(prev[selectedBillingRuleIndex])
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedBillingRuleIndex,
    form.moeda,
    form.tipo_cobranca_documento,
    form.data_inicio_faturamento,
    form.dia_inicio_faturamento,
    form.pagamento_dia_mes,
    form.inicio_vigencia,
    form.periodo_reajuste,
    form.data_proximo_reajuste,
    form.data_ultimo_reajuste,
    form.indice_reajuste,
    form.regra_cobranca,
    form.regra_cobranca_config,
    form.pagadores_servico,
    form.indicacao_config,
  ])

  const setField = <K extends keyof CasoPayload>(key: K, value: CasoPayload[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const copyHonorariosToDespesas = () => {
    setForm((prev) => ({
      ...prev,
      pagadores_despesa: (prev.pagadores_servico || []).map((pagador) => ({ ...pagador })),
    }))
  }

  const setRegra = (field: string, value: any) => {
    setForm((prev) => ({
      ...prev,
      regra_cobranca_config: {
        ...prev.regra_cobranca_config,
        [field]: value,
      },
    }))
  }

  const setNaturezaCaso = (value: string) => {
    setForm((prev) => ({
      ...prev,
      polo: value === 'contencioso' ? prev.polo : null,
      regra_cobranca_config: {
        ...prev.regra_cobranca_config,
        natureza_caso: value,
      },
    }))
  }

  const setDespesas = (field: string, value: any) => {
    setForm((prev) => ({
      ...prev,
      despesas_config: {
        ...prev.despesas_config,
        [field]: value,
      },
    }))
  }

  const setTimesheet = (field: string, value: any) => {
    setForm((prev) => ({
      ...prev,
      timesheet_config: {
        ...prev.timesheet_config,
        [field]: value,
      },
    }))
  }

  const setIndicacao = (field: string, value: any) => {
    setForm((prev) => ({
      ...prev,
      indicacao_config: {
        ...prev.indicacao_config,
        [field]: value,
      },
    }))
  }

  const setCrossSell = (field: string, value: any) => {
    setRegra(`cross_sell_${field}`, value)
  }

  const getBillingStartReferenceDate = () => {
    const day = normalizeDiaInicioFaturamento(form.dia_inicio_faturamento, form.data_inicio_faturamento)
    return buildDateFromDay(form.inicio_vigencia || form.data_inicio_faturamento, day)
  }

  const setIndicacaoPeriodicidade = (periodicidade: string) => {
    const billingStartReferenceDate = getBillingStartReferenceDate()
    setIndicacao('periodicidade', periodicidade)
    if (periodicidade === 'mensal') {
      setIndicacao('usar_dia_vencimento', true)
      setIndicacao('parcelas_pagamento', [])
      if (!indicacao.data_fim_pagamentos) {
        setIndicacao('data_fim_pagamentos', billingStartReferenceDate)
      }
      return
    }
    if (periodicidade === 'parcelado') {
      setIndicacao('data_pagamento_unico', '')
      if (!Array.isArray(indicacao.parcelas_pagamento) || indicacao.parcelas_pagamento.length === 0) {
        setIndicacao('parcelas_pagamento', [{ valor: '', data_pagamento: '' }])
      }
      return
    }
    setIndicacao('parcelas_pagamento', [])
    setIndicacao('data_fim_pagamentos', '')
    setIndicacao('dia_pagamento_mensal', '')
    if (!indicacao.data_pagamento_unico) {
      setIndicacao('data_pagamento_unico', billingStartReferenceDate)
    }
  }

  const addIndicacaoParcela = () => {
    const parcelas = Array.isArray(indicacao.parcelas_pagamento) ? indicacao.parcelas_pagamento : []
    setIndicacao('parcelas_pagamento', [...parcelas, { valor: '', data_pagamento: '' }])
  }

  const updateIndicacaoParcela = (idx: number, field: 'valor' | 'data_pagamento', value: string) => {
    const parcelas = Array.isArray(indicacao.parcelas_pagamento) ? [...indicacao.parcelas_pagamento] : []
    if (!parcelas[idx]) return
    parcelas[idx] = { ...parcelas[idx], [field]: value }
    setIndicacao('parcelas_pagamento', parcelas)
  }

  const removeIndicacaoParcela = (idx: number) => {
    const parcelas = Array.isArray(indicacao.parcelas_pagamento) ? [...indicacao.parcelas_pagamento] : []
    parcelas.splice(idx, 1)
    setIndicacao('parcelas_pagamento', parcelas)
  }

  const setCrossSellPeriodicidade = (periodicidade: string) => {
    const billingStartReferenceDate = getBillingStartReferenceDate()
    setCrossSell('periodicidade', periodicidade)
    if (periodicidade === 'mensal') {
      setCrossSell('usar_dia_vencimento', true)
      setCrossSell('parcelas_pagamento', [])
      if (!regras.cross_sell_data_fim_pagamentos) {
        setCrossSell('data_fim_pagamentos', billingStartReferenceDate)
      }
      return
    }
    if (periodicidade === 'parcelado') {
      setCrossSell('data_pagamento_unico', '')
      const parcelas = Array.isArray(regras.cross_sell_parcelas_pagamento) ? regras.cross_sell_parcelas_pagamento : []
      if (parcelas.length === 0) {
        setCrossSell('parcelas_pagamento', [{ valor: '', data_pagamento: '' }])
      }
      return
    }
    setCrossSell('parcelas_pagamento', [])
    setCrossSell('data_fim_pagamentos', '')
    setCrossSell('dia_pagamento_mensal', '')
    if (!String(regras.cross_sell_data_pagamento_unico || '').trim()) {
      setCrossSell('data_pagamento_unico', billingStartReferenceDate)
    }
  }

  const addCrossSellParcela = () => {
    const parcelas = Array.isArray(regras.cross_sell_parcelas_pagamento) ? regras.cross_sell_parcelas_pagamento : []
    setCrossSell('parcelas_pagamento', [...parcelas, { valor: '', data_pagamento: '' }])
  }

  const updateCrossSellParcela = (idx: number, field: 'valor' | 'data_pagamento', value: string) => {
    const parcelas = Array.isArray(regras.cross_sell_parcelas_pagamento) ? [...regras.cross_sell_parcelas_pagamento] : []
    if (!parcelas[idx]) return
    parcelas[idx] = { ...parcelas[idx], [field]: value }
    setCrossSell('parcelas_pagamento', parcelas)
  }

  const removeCrossSellParcela = (idx: number) => {
    const parcelas = Array.isArray(regras.cross_sell_parcelas_pagamento) ? [...regras.cross_sell_parcelas_pagamento] : []
    parcelas.splice(idx, 1)
    setCrossSell('parcelas_pagamento', parcelas)
  }

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
        ? String(form.pagamento_dia_mes || '').trim()
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
  }, [indicacao, indicacaoPagamentoEnabled, form.pagamento_dia_mes])

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
        ? String(form.pagamento_dia_mes || '').trim()
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
  }, [crossSellEnabled, crossSellPeriodicidade, crossSellModo, regras, form.pagamento_dia_mes])

  const setCentroRateio = (items: Array<{ id: string; percentual: number }>) => {
    setField(
      'centro_custo_rateio',
      items.map((item) => ({
        centro_custo_id: item.id,
        percentual: item.percentual,
      })),
    )
  }

  const setPagadoresServicoRateio = (items: Array<{ id: string; percentual: number }>) => {
    setField(
      'pagadores_servico',
      items.map((item) => ({
        cliente_id: item.id,
        percentual: item.percentual,
      })),
    )
  }

  const setPagadoresDespesaRateio = (items: Array<{ id: string; percentual: number }>) => {
    setField(
      'pagadores_despesa',
      items.map((item) => ({
        cliente_id: item.id,
        percentual: item.percentual,
      })),
    )
  }

  const addParcela = () => {
    const parcelas = form.regra_cobranca_config?.parcelas || []
    setRegra('parcelas', [...parcelas, { valor: '', data_pagamento: '' }])
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
    const totalWeight = weights.reduce((acc, weight) => acc + weight, 0)
    if (!totalWeight) return
    const baseDate = getBillingStartReferenceDate() || form.inicio_vigencia || new Date().toISOString().slice(0, 10)
    const parcelas = weights.map((weight, idx) => ({
      valor: (Math.round(((total * weight) / totalWeight) * 100) / 100).toFixed(2),
      data_pagamento: idx === 0 ? baseDate : '',
    }))
    const diff = total - parcelas.reduce((acc, parcela) => acc + Number(parcela.valor || 0), 0)
    if (parcelas.length > 0 && Math.abs(diff) > 0.001) {
      parcelas[parcelas.length - 1].valor = (Number(parcelas[parcelas.length - 1].valor) + diff).toFixed(2)
    }
    setRegra('parcelas', parcelas)
    setError(null)
  }

  const addRevisor = () => {
    const revisores = form.timesheet_config?.revisores || []
    setTimesheet('revisores', [...revisores, { colaborador_id: '', ordem: revisores.length + 1 }])
  }

  const addAprovador = () => {
    const aprovadores = form.timesheet_config?.aprovadores || []
    setTimesheet('aprovadores', [...aprovadores, { colaborador_id: '', ordem: aprovadores.length + 1 }])
  }

  const reorderTimeList = (field: 'revisores' | 'aprovadores', fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return
    const current = [...((form.timesheet_config as any)?.[field] || [])]
    if (!current[fromIndex] || !current[toIndex]) return
    const [moved] = current.splice(fromIndex, 1)
    current.splice(toIndex, 0, moved)
    const normalized = current.map((entry: any, idx: number) => ({ ...entry, ordem: idx + 1 }))
    setTimesheet(field, normalized)
  }

  const chooseDay = (day: number) => {
    setField('pagamento_dia_mes', String(day))
    setDayModalOpen(false)
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
      const { data: { session } } = await supabase.auth.getSession()
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
      setRegra('modo_preco', 'tabela')
      setRegra('tabela_preco_id', savedTable.id || '')
      setRegra('tabela_preco_nome', savedTable.nome)
      setRegra('tabela_preco_itens', savedTable.itens)
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
    const regra = normalizeRegraCobranca(currentBillingRule?.regra_cobranca || form.regra_cobranca)
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
  }, [currentBillingRule?.regra_cobranca, form.regra_cobranca])

  const validateFinanceiro = (): string | null => {
    if (!validateDiaInicioFaturamento(form.dia_inicio_faturamento ?? '')) {
      return 'Dia de início de faturamento deve ser um inteiro entre 1 e 31'
    }
    if (form.regra_cobranca === 'salario_minimo' && !normalizePositiveDecimal(regras.quantidade_sm)) {
      return 'Informe a quantidade de SM'
    }
    return null
  }

  const validateBasico = (): string | null => {
    if (String(regras.natureza_caso || '') === 'contencioso' && !form.polo) {
      return 'Polo é obrigatório quando natureza do caso é Contencioso'
    }
    return null
  }

  const submit = async () => {
    setError(null)

    if (isReadOnly) {
      setError('Modo somente leitura')
      return
    }

    const basicoError = validateBasico()
    if (basicoError) {
      setError(basicoError)
      return
    }
    const financeiroError = validateFinanceiro()
    if (financeiroError) {
      setError(financeiroError)
      return
    }

    try {
      setLoading(true)
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/${isEdit ? 'update-caso' : 'create-caso'}`
      const preparedRules = (() => {
        const list = [...billingRules]
        if (!list[selectedBillingRuleIndex]) {
          list.push(composeBillingRuleFromForm({ id: createRuleId(), status: 'rascunho' } as BillingRuleDraft))
        } else {
          list[selectedBillingRuleIndex] = {
            ...composeBillingRuleFromForm(list[selectedBillingRuleIndex]),
            status: list[selectedBillingRuleIndex].status === 'encerrado' ? 'encerrado' : 'ativo',
          }
        }
        return list
      })()
      const invalidSmRule = preparedRules.find((rule) =>
        normalizeRegraCobranca(rule.regra_cobranca) === 'salario_minimo' &&
        !normalizePositiveDecimal(rule.quantidade_sm ?? rule.regra_cobranca_config?.quantidade_sm)
      )
      if (invalidSmRule) {
        setError('Informe a quantidade de SM')
        toastError('Informe a quantidade de SM')
        setLoading(false)
        return
      }
      const payload = {
        ...form,
        natureza_caso: String(regras.natureza_caso || ''),
        polo: String(regras.natureza_caso || '') === 'contencioso' ? form.polo : null,
        possui_reajuste: possuiReajuste,
        possui_cap_horas: capDesejadoEnabled,
        regra_cobranca: normalizeRegraCobranca(form.regra_cobranca),
        data_ultimo_reajuste: form.data_ultimo_reajuste || form.inicio_vigencia || '',
        regras_financeiras: preparedRules.map((rule) => ({
          ...rule,
          quantidade_sm: normalizeRegraCobranca(rule.regra_cobranca) === 'salario_minimo'
            ? normalizePositiveDecimal(rule.quantidade_sm ?? rule.regra_cobranca_config?.quantidade_sm)
            : null,
          natureza_caso: String((rule.regra_cobranca_config || {}).natureza_caso || regras.natureza_caso || ''),
          regra_cobranca_config: sanitizeSingleRuleConfig(rule.regra_cobranca_config || {}),
        })),
        indicacao_config: {
          ...(preparedRules[selectedBillingRuleIndex]?.indicacao_config ||
            preparedRules[0]?.indicacao_config ||
            form.indicacao_config ||
            {}),
        },
        regra_cobranca_config: {
          ...sanitizeSingleRuleConfig(form.regra_cobranca_config || {}),
          regras_cobranca: preparedRules.map((rule) => ({
            ...rule,
            quantidade_sm: normalizeRegraCobranca(rule.regra_cobranca) === 'salario_minimo'
              ? normalizePositiveDecimal(rule.quantidade_sm ?? rule.regra_cobranca_config?.quantidade_sm)
              : null,
            natureza_caso: String((rule.regra_cobranca_config || {}).natureza_caso || regras.natureza_caso || ''),
            regra_cobranca_config: sanitizeSingleRuleConfig(rule.regra_cobranca_config || {}),
          })),
        },
      }
      const body = isEdit
        ? { id: casoId, ...payload, status: 'ativo' }
        : { contrato_id: contratoId, ...payload, status: 'ativo' }

      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      const data = await resp.json()
      if (!resp.ok) {
        setError(data.error || 'Erro ao salvar caso')
        toastError(data.error || 'Erro ao salvar caso')
        return
      }

      success(isEdit ? 'Caso atualizado com sucesso.' : 'Caso criado com sucesso.')
      router.push(`/contratos/${contratoId}/editar`)
      router.refresh()
    } catch (e) {
      console.error(e)
      setError('Erro ao salvar caso')
      toastError('Erro ao salvar caso')
    } finally {
      setLoading(false)
    }
  }

  const deleteCaso = async () => {
    if (!casoId) return
    try {
      setDeleteCasoLoading(true)
      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) return

      const resp = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/delete-caso`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id: casoId }),
      })
      const data = await resp.json()
      if (!resp.ok) {
        toastError(data.error || 'Erro ao excluir caso')
        return
      }
      success('Caso excluído com sucesso.')
      router.push(`/contratos/${contratoId}/editar`)
      router.refresh()
    } catch (e) {
      console.error(e)
      toastError('Erro ao excluir caso')
    } finally {
      setDeleteCasoLoading(false)
      setDeleteCasoOpen(false)
    }
  }

  const openAnexo = async (anexoId: string) => {
    try {
      setOpeningAnexoId(anexoId)
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const resp = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-anexo?tipo=caso&id=${anexoId}`,
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
      const byteString = atob(item.arquivo_base64 || '')
      const buffer = new ArrayBuffer(byteString.length)
      const bytes = new Uint8Array(buffer)
      for (let i = 0; i < byteString.length; i += 1) bytes[i] = byteString.charCodeAt(i)
      const blob = new Blob([buffer], { type: mimeType })
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank')
      setTimeout(() => URL.revokeObjectURL(url), 10000)
    } catch (e) {
      console.error(e)
      setError('Erro ao abrir anexo')
    } finally {
      setOpeningAnexoId(null)
    }
  }

  const removeAnexo = async (anexoId: string) => {
    try {
      setRemovingAnexoId(anexoId)
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const resp = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/delete-anexo`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tipo: 'caso', id: anexoId }),
      })
      const data = await resp.json()
      if (!resp.ok) {
        const msg = data.error || 'Erro ao remover anexo'
        setError(msg)
        toastError(msg)
        return
      }

      setCaseAnexos((prev) => prev.filter((item) => item.id !== anexoId))
      success('Anexo removido')
    } catch (e) {
      console.error(e)
      setError('Erro ao remover anexo')
    } finally {
      setRemovingAnexoId(null)
    }
  }

  if (initialLoading) {
    return (
      <div className="rounded-md border p-4">
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map((i) => <div key={i} className="h-10 rounded bg-gray-200" />)}
        </div>
      </div>
    )
  }

  if (!isReadOnly && !canWrite) {
    return (
      <div className="rounded-md bg-red-50 p-4">
        <p className="text-sm text-red-800">Você não tem permissão para criar/editar casos</p>
      </div>
    )
  }

  return (
    <div className="space-y-4 pb-24">
      {error && (
        <Alert className="border-red-200 bg-red-50 text-red-800">
          <AlertTitle>Atenção</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!isEdit && contractCases.length > 0 ? (
        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={replicatePreviousCase}>
            <Copy className="mr-2 h-4 w-4" />
            Replicar caso anterior
          </Button>
        </div>
      ) : null}

      <Card>
        <CardContent className="pt-4">
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
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid grid-cols-1 gap-4 pt-6 md:grid-cols-2">
          {isReadOnly ? (
            <>
              {substep === 'basico' && (
                <div className="grid grid-cols-1 gap-3 md:col-span-2 md:grid-cols-2">
                  <div className="space-y-1 rounded-md border p-3 md:col-span-2">
                    <p className="text-xs text-muted-foreground">Nome</p>
                    <p className="font-medium">{form.nome || '-'}</p>
                  </div>
                  <div className="space-y-1 rounded-md border p-3">
                    <p className="text-xs text-muted-foreground">Serviço</p>
                    <p className="font-medium">{produtoMap.get(form.produto_id) || '-'}</p>
                  </div>
                  <div className="space-y-1 rounded-md border p-3">
                    <p className="text-xs text-muted-foreground">Responsável</p>
                    <p className="font-medium">{colaboradorMap.get(form.responsavel_id) || '-'}</p>
                  </div>
                  <div className="space-y-2 rounded-md border p-3 md:col-span-2">
                    <p className="text-xs text-muted-foreground">Centro de custo</p>
                    {(form.centro_custo_rateio || []).length === 0 ? (
                      <p className="font-medium">-</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {(form.centro_custo_rateio || []).map((item, idx) => (
                          <Badge key={`${item.centro_custo_id}-${idx}`}>
                            {centroMap.get(item.centro_custo_id) || '-'} ({item.percentual ?? 0}%)
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
              {substep === 'financeiro' && (
                <div className="grid grid-cols-1 gap-3 md:col-span-2 md:grid-cols-2">
                  <div className="space-y-1 rounded-md border p-3"><p className="text-xs text-muted-foreground">Moeda</p><p className="font-medium">{form.moeda || '-'}</p></div>
                  <div className="space-y-1 rounded-md border p-3"><p className="text-xs text-muted-foreground">Tipo de cobrança</p><p className="font-medium">{form.tipo_cobranca_documento || '-'}</p></div>
                  <div className="space-y-1 rounded-md border p-3"><p className="text-xs text-muted-foreground">Dia de início de faturamento</p><p className="font-medium">{form.dia_inicio_faturamento || '-'}</p></div>
                  <div className="space-y-1 rounded-md border p-3"><p className="text-xs text-muted-foreground">Pagamento (dia do mês)</p><p className="font-medium">{form.pagamento_dia_mes || '-'}</p></div>
                  <div className="space-y-1 rounded-md border p-3"><p className="text-xs text-muted-foreground">Início vigência</p><p className="font-medium">{form.inicio_vigencia || '-'}</p></div>
                  <div className="space-y-1 rounded-md border p-3"><p className="text-xs text-muted-foreground">Período reajuste</p><p className="font-medium">{form.periodo_reajuste || '-'}</p></div>
                  <div className="space-y-1 rounded-md border p-3"><p className="text-xs text-muted-foreground">Data próximo reajuste</p><p className="font-medium">{form.data_proximo_reajuste || '-'}</p></div>
                  <div className="space-y-1 rounded-md border p-3"><p className="text-xs text-muted-foreground">Data último reajuste</p><p className="font-medium">{form.data_ultimo_reajuste || '-'}</p></div>
                  <div className="space-y-1 rounded-md border p-3"><p className="text-xs text-muted-foreground">Índice reajuste</p><p className="font-medium">{form.indice_reajuste || '-'}</p></div>
                  <div className="space-y-1 rounded-md border p-3"><p className="text-xs text-muted-foreground">Regra de cobrança</p><p className="font-medium">{form.regra_cobranca || '-'}</p></div>
                  <div className="space-y-2 rounded-md border p-3 md:col-span-2">
                    <p className="text-xs text-muted-foreground">Pagadores do serviço</p>
                    {(form.pagadores_servico || []).length === 0 ? (
                      <p className="font-medium">-</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {(form.pagadores_servico || []).map((item, idx) => (
                          <Badge key={`${item.cliente_id}-${idx}`}>
                            {options.clientes.find((c) => c.id === item.cliente_id)?.nome || '-'} ({item.percentual ?? 0}%)
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
              {substep === 'despesas' && (
                <div className="grid grid-cols-1 gap-3 md:col-span-2 md:grid-cols-2">
                  <div className="space-y-1 rounded-md border p-3"><p className="text-xs text-muted-foreground">Despesas reembolsáveis</p><p className="font-medium">{(despesas.despesas_reembolsaveis || []).join(', ') || '-'}</p></div>
                  <div className="space-y-1 rounded-md border p-3"><p className="text-xs text-muted-foreground">Limite de adiantamento</p><p className="font-medium">{despesas.limite_adiantamento || '-'}</p></div>
                  <div className="space-y-2 rounded-md border p-3 md:col-span-2">
                    <p className="text-xs text-muted-foreground">Pagadores da despesa</p>
                    {(form.pagadores_despesa || []).length === 0 ? (
                      <p className="font-medium">-</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {(form.pagadores_despesa || []).map((item, idx) => (
                          <Badge key={`${item.cliente_id}-${idx}`}>
                            {options.clientes.find((c) => c.id === item.cliente_id)?.nome || '-'} ({item.percentual ?? 0}%)
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
              {substep === 'timesheet' && (
                <div className="grid grid-cols-1 gap-3 md:col-span-2">
                  <div className="space-y-1 rounded-md border p-3"><p className="text-xs text-muted-foreground">Enviar timesheet</p><p className="font-medium">{timesheet.envia_timesheet ? 'Sim' : 'Não'}</p></div>
                  <div className="space-y-1 rounded-md border p-3"><p className="text-xs text-muted-foreground">Revisores</p><p className="font-medium">{(timesheet.revisores || []).map((r: any) => `${colaboradorMap.get(r.colaborador_id) || '-'} (#${r.ordem || '-'})`).join(' | ') || '-'}</p></div>
                  <div className="space-y-1 rounded-md border p-3"><p className="text-xs text-muted-foreground">Aprovadores</p><p className="font-medium">{(timesheet.aprovadores || []).map((a: any) => `${colaboradorMap.get(a.colaborador_id) || '-'} (#${a.ordem || '-'})`).join(' | ') || '-'}</p></div>
                </div>
              )}
              {false && (
                <div className="grid grid-cols-1 gap-3 md:col-span-2 md:grid-cols-2">
                  <div className="space-y-1 rounded-md border p-3"><p className="text-xs text-muted-foreground">Pagamento da indicação</p><p className="font-medium">{formatIndicacaoPagador(indicacao.pagamento_indicacao)}</p></div>
                  <div className="space-y-1 rounded-md border p-3"><p className="text-xs text-muted-foreground">Periodicidade</p><p className="font-medium">{indicacao.periodicidade || '-'}</p></div>
                  <div className="space-y-1 rounded-md border p-3"><p className="text-xs text-muted-foreground">Modo</p><p className="font-medium">{indicacao.modo || '-'}</p></div>
                  <div className="space-y-1 rounded-md border p-3"><p className="text-xs text-muted-foreground">Valor</p><p className="font-medium">{indicacao.valor || '-'}</p></div>
                </div>
              )}
            </>
          ) : (
            <>
          {substep === 'basico' && (
            <>
              <div className="space-y-2 md:col-span-2">
                <Label>Nome</Label>
                <Input value={form.nome} onChange={(e) => setField('nome', e.target.value)} disabled={isReadOnly} />
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label>Observação</Label>
                <Textarea
                  value={form.observacao || ''}
                  onChange={(event) => setField('observacao', event.target.value)}
                  disabled={isReadOnly}
                  placeholder="Observações livres sobre o caso"
                />
              </div>

              <div className="space-y-2">
                <Label>Serviço</Label>
                <CommandSelect
                  value={form.servico_id || ''}
                  onValueChange={(value) => setField('servico_id', value)}
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
                  value={form.produto_id}
                  onValueChange={(value) => setField('produto_id', value)}
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
                  onChange={setNaturezaCaso}
                  options={[
                    { value: 'contencioso', label: 'Contencioso' },
                    { value: 'consultivo', label: 'Consultivo' },
                  ]}
                  disabled={isReadOnly}
                />
              </div>

              {String(regras.natureza_caso || '') === 'contencioso' ? (
                <div className="space-y-2 md:col-span-2">
                  <Label>Polo</Label>
                  <ChoiceCards
                    value={form.polo || ''}
                    onChange={(value) => setField('polo', normalizePolo(value))}
                    options={[
                      { value: 'ativo', label: 'Ativo' },
                      { value: 'passivo', label: 'Passivo' },
                    ]}
                    disabled={isReadOnly}
                  />
                </div>
              ) : null}

              <div className="space-y-2 md:col-span-2">
                <Label>Responsável</Label>
                <CommandSelect
                  value={form.responsavel_id}
                  onValueChange={(value) => setField('responsavel_id', value)}
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
                  items={(form.centro_custo_rateio || [])
                    .filter((item) => item.centro_custo_id)
                    .map((item) => ({ id: item.centro_custo_id, percentual: item.percentual ?? 0 }))}
                  onChange={setCentroRateio}
                  disabled={isReadOnly}
                  frameless
                />
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label>Anexos do caso</Label>

                {isEdit && caseAnexos.length > 0 && (
                  <div className="space-y-2 rounded-md border p-3">
                    <p className="text-sm font-medium">Anexos já cadastrados</p>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
                      {caseAnexos.map((anexo) => (
                        <div key={anexo.id} className="w-full max-w-[140px]">
                          <div className="group relative aspect-square overflow-hidden rounded-md border bg-muted/20 p-2">
                            <div className="flex h-full items-center justify-center text-muted-foreground">
                              <Paperclip className="h-5 w-5" />
                            </div>
                            <div className="absolute inset-0 hidden items-center justify-center gap-2 bg-black/35 text-white shadow-lg group-hover:flex">
                              <Button
                                type="button"
                                size="icon"
                                variant="secondary"
                                className="h-8 w-8"
                                onClick={() => openAnexo(anexo.id)}
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
                                  onClick={() => removeAnexo(anexo.id)}
                                  disabled={removingAnexoId === anexo.id}
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
                    onClick={() => setAnexoModalOpen(true)}
                  >
                    <p className="text-base font-medium text-foreground">Clique para inserir anexo</p>
                    <p className="text-sm">Adicione anexos do caso com nome e arquivo</p>
                    <div className="mt-3">
                      <Button type="button" variant="outline" size="sm" onClick={() => setAnexoModalOpen(true)}>
                        <Paperclip className="mr-1 h-4 w-4" />
                        Novo anexo
                      </Button>
                    </div>
                  </div>
                )}

                {!isEdit && (
                  <p className="text-sm text-muted-foreground">Salve o caso primeiro para adicionar anexos.</p>
                )}

                {isEdit && caseAnexos.length === 0 && (
                  <p className="text-sm text-muted-foreground">Sem anexos cadastrados neste caso.</p>
                )}
              </div>
            </>
          )}

          {substep === 'financeiro' && (
            <>
              <div className="space-y-2 md:col-span-2">
                <Label>Regras de cobrança</Label>
                <div className="flex flex-wrap gap-2">
                  {billingRules.map((rule, idx) => {
                    const selected = idx === selectedBillingRuleIndex
                    const labelTipo = rule.regra_cobranca
                      ? rule.regra_cobranca.replaceAll('_', ' ')
                      : 'Nova regra'
                    return (
                      <Button
                        key={rule.id}
                        type="button"
                        variant={selected ? 'default' : 'outline'}
                        className="gap-1.5"
                        onClick={() => selectBillingRule(idx)}
                      >
                        {idx + 1}. {labelTipo}
                        {rule.status === 'rascunho' ? <Pencil className="h-3.5 w-3.5" /> : null}
                        {rule.status === 'encerrado' ? <Badge className="bg-muted text-muted-foreground">encerrada</Badge> : null}
                      </Button>
                    )
                  })}
                  {!isReadOnly && (
                    <Button type="button" variant="outline" onClick={addBillingRule}>
                      + Nova regra
                    </Button>
                  )}
                  {!isReadOnly && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={removeCurrentBillingRule}
                      disabled={!isCurrentRuleDraft}
                    >
                      Remover regra atual
                    </Button>
                  )}
                  {!isReadOnly && (
                    <Button type="button" variant="outline" onClick={toggleCurrentBillingRuleStatus}>
                      <Power className={`mr-1 h-3.5 w-3.5 ${isCurrentRuleClosed ? 'text-green-600' : 'text-red-600'}`} />
                      {isCurrentRuleClosed ? 'Reativar regra' : 'Encerrar regra'}
                    </Button>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Moeda</Label>
                <NativeSelect value={form.moeda} onChange={(e) => setField('moeda', e.target.value as any)} disabled={isReadOnly}>
                  <option value="real">Real</option>
                  <option value="euro">Euro</option>
                  <option value="dolar">Dólar</option>
                </NativeSelect>
              </div>
              <div className="space-y-2">
                <Label>Tipo de cobrança</Label>
                <NativeSelect value={form.tipo_cobranca_documento} onChange={(e) => setField('tipo_cobranca_documento', e.target.value as any)} disabled={isReadOnly}>
                  <option value="">Selecione...</option>
                  <option value="invoice">Invoice</option>
                  <option value="nf">NF</option>
                </NativeSelect>
              </div>
              <div className="space-y-2">
                <Label>Dia de início de faturamento</Label>
                <Input
                  type="number"
                  min={1}
                  max={31}
                  step={1}
                  value={form.dia_inicio_faturamento}
                  onChange={(event) => {
                    const value = event.target.value
                    setField('dia_inicio_faturamento', value === '' ? '' : Number(value))
                  }}
                  disabled={isReadOnly}
                  placeholder="1 a 31"
                />
              </div>
              <div className="space-y-2">
                <Label>Pagamento em (dia do mês)</Label>
                <div className="flex gap-2">
                  <Input value={form.pagamento_dia_mes} readOnly />
                  {!isReadOnly && <Button type="button" variant="outline" onClick={() => setDayModalOpen(true)}>Selecionar dia</Button>}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Início da vigência</Label>
                <DatePicker value={form.inicio_vigencia} onChange={(value) => setField('inicio_vigencia', value)} disabled={isInicioVigenciaReadOnly} />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Possui reajuste?</Label>
                <ChoiceCards
                  value={possuiReajuste ? 'sim' : 'nao'}
                  onChange={(value) => {
                    const sim = value === 'sim'
                    setField('possui_reajuste', sim)
                    if (!sim) {
                      setField('periodo_reajuste', 'nao_tem')
                      setField('indice_reajuste', 'nao_tem')
                      setField('data_proximo_reajuste', '')
                      setField('data_ultimo_reajuste', '')
                    }
                  }}
                  disabled={isReadOnly}
                  options={[
                    { value: 'nao', label: 'Não' },
                    { value: 'sim', label: 'Sim' },
                  ]}
                />
              </div>
              {possuiReajuste && (
              <div className="space-y-2">
                <Label>Período reajuste</Label>
                <NativeSelect
                  value={form.periodo_reajuste || 'nao_tem'}
                  onChange={(e) => {
                    const nextPeriod = e.target.value
                    if (nextPeriod === 'nao_tem') {
                      setField('periodo_reajuste', 'nao_tem')
                      setField('indice_reajuste', 'nao_tem')
                      setField('data_proximo_reajuste', '')
                      setField('data_ultimo_reajuste', '')
                      if (isEdit) setManualReajusteDate(true)
                      return
                    }
                    setField('periodo_reajuste', nextPeriod)
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
              )}
              {reajusteEnabled ? (
                <>
                  <div className="space-y-2">
                    <Label>Data próximo reajuste</Label>
                    <DatePicker
                      value={form.data_proximo_reajuste}
                      onChange={(value) => {
                        if (isEdit) setManualReajusteDate(true)
                        setField('data_proximo_reajuste', value)
                      }}
                      disabled={isReadOnly || !isEdit}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Data último reajuste</Label>
                    <DatePicker value={form.data_ultimo_reajuste} onChange={(value) => setField('data_ultimo_reajuste', value)} disabled={isReadOnly} />
                  </div>
                  <div className="space-y-2">
                    <Label>Índice de reajuste</Label>
                    <NativeSelect value={form.indice_reajuste || 'nao_tem'} onChange={(e) => setField('indice_reajuste', e.target.value)} disabled={isReadOnly}>
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
                  value={form.regra_cobranca}
                  onChange={(e) => {
                    const nextRule = e.target.value as CasoPayload['regra_cobranca']
                    setField('regra_cobranca', nextRule)
                    if (nextRule !== 'salario_minimo') setRegra('quantidade_sm', null)
                  }}
                  disabled={isReadOnly}
                >
                  <option value="">Selecione...</option>
                  <option value="hora">Hora</option>
                  <option value="mensal">Mensal</option>
                  <option value="mensalidade_processo">Mensalidade de processo</option>
                  <option value="salario_minimo">Salário Mínimo</option>
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
                      setRegra('cap_desejado_enabled', false)
                      setRegra('cap_desejado_horas', '')
                      return
                    }
                    setRegra('cap_desejado_enabled', true)
                    if (!String(regras.cap_desejado_horas || '').trim()) setRegra('cap_desejado_horas', '0')
                  }}
                  disabled={isReadOnly || form.regra_cobranca === 'hora'}
                  options={[
                    { value: 'nao', label: 'Não' },
                    { value: 'sim', label: 'Sim' },
                  ]}
                />
                {form.regra_cobranca === 'hora' ? (
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
                    onChange={(e) => setRegra('cap_desejado_horas', e.target.value)}
                    disabled={isReadOnly || form.regra_cobranca === 'hora'}
                    placeholder="Ex: 120"
                  />
                </div>
              ) : null}

              {form.regra_cobranca === 'hora' && (
                <div className="space-y-3 md:col-span-2">
                  <div className="border-t" />
                  <p className="text-base font-semibold">Configuração de cobrança por Hora</p>
                  <ChoiceCards
                    value={modoPreco}
                    onChange={(value) => {
                      setRegra('modo_preco', value)
                      if (value === 'valor_hora') {
                        setRegra('tabela_preco_id', '')
                        setRegra('tabela_preco_nome', '')
                        setRegra('tabela_preco_itens', [])
                      } else if (!(regras.tabela_preco_itens || []).length) {
                        setRegra('tabela_preco_itens', buildDefaultTabelaPrecoItens())
                      }
                    }}
                    disabled={isReadOnly}
                    options={[
                      { value: 'valor_hora', label: 'Valor da hora' },
                      { value: 'tabela', label: 'Tabela de preço' },
                    ]}
                  />
                  {modoPreco === 'valor_hora' ? (
                    <div className="space-y-2">
                      <Label>Valor da hora</Label>
                      <MoneyInput value={regras.valor_hora || ''} onValueChange={(value) => setRegra('valor_hora', value)} disabled={isReadOnly} />
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Label>Tabela de preço</Label>
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <CommandSelect
                            value={creatingPriceTable ? '__new__' : (regras.tabela_preco_id || regras.tabela_preco_nome || '')}
                            onValueChange={(value) => {
                              if (value === '__new__') {
                                setRegra('modo_preco', 'tabela')
                                setCreatingPriceTable(true)
                                setNewPriceTableName('')
                                setRegra('tabela_preco_id', '')
                                setRegra('tabela_preco_nome', '')
                                setRegra('tabela_preco_itens', buildDefaultTabelaPrecoItens())
                                setPriceTableDialogOpen(true)
                                return
                              }
                              const selected = getPriceTableByKey(value)
                              if (!selected) return
                              setRegra('modo_preco', 'tabela')
                              setCreatingPriceTable(false)
                              setRegra('tabela_preco_id', selected.id || '')
                              setRegra('tabela_preco_nome', selected.nome)
                              setRegra('tabela_preco_itens', selected.itens)
                            }}
                            options={priceTableOptions}
                            placeholder="Selecionar tabela"
                            searchPlaceholder="Buscar tabela..."
                            emptyText="Nenhuma tabela encontrada."
                            disabled={isReadOnly}
                          />
                        </div>
                        {!isReadOnly && <Button type="button" variant="outline" onClick={() => setPriceTableDialogOpen(true)}>Cadastrar tabela</Button>}
                      </div>
                      {(regras.tabela_preco_nome || '').trim() ? <Badge>{regras.tabela_preco_nome}</Badge> : null}
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label>CAP</Label>
                    <ChoiceCards
                      value={regras.cap_enabled ? 'sim' : 'nao'}
                      onChange={(value) => {
                        const enabled = value === 'sim'
                        setRegra('cap_enabled', enabled)
                        if (!enabled) {
                          setRegra('cap_limites_enabled', false)
                          setRegra('cap_min_enabled', false)
                          setRegra('cap_max_enabled', false)
                          setRegra('cap_min', '')
                          setRegra('cap_max', '')
                          setRegra('encontro_contas_enabled', false)
                          setRegra('encontro_periodicidade', '')
                          setRegra('data_proximo_encontro', '')
                        }
                      }}
                      disabled={isReadOnly}
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
                        <NativeSelect value={regras.cap_tipo || 'hora'} onChange={(e) => setRegra('cap_tipo', e.target.value)} disabled={isReadOnly}>
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
                                setRegra('cap_min_enabled', enabled)
                                setRegra('cap_limites_enabled', enabled || capMaxEnabled)
                                if (!enabled) setRegra('cap_min', '')
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
                                setRegra('cap_max_enabled', enabled)
                                setRegra('cap_limites_enabled', capMinEnabled || enabled)
                                if (!enabled) setRegra('cap_max', '')
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
                              onValueChange={(value) => setRegra('cap_min', value)}
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
                              onValueChange={(value) => setRegra('cap_max', value)}
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
                            setRegra('cobra_excedente', enabled)
                            if (!enabled) {
                              setRegra('valor_hora_excedente', '')
                            }
                          }}
                          disabled={isReadOnly}
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
                            onValueChange={(value) => setRegra('valor_hora_excedente', value)}
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
                            setRegra('encontro_contas_enabled', enabled)
                            if (!enabled) {
                              setRegra('encontro_periodicidade', '')
                              setRegra('data_proximo_encontro', '')
                            }
                          }}
                          disabled={isReadOnly}
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
                                setRegra('encontro_periodicidade', periodicidade)

                                const months = periodToMonths[periodicidade] || 0
                                const baseDate = regras.data_ultimo_encontro || form.inicio_vigencia || ''
                                const day = Number(form.pagamento_dia_mes || '0') || undefined
                                const nextDate = months > 0 && baseDate ? buildNextDate(baseDate, months, day) : ''
                                setRegra('data_proximo_encontro', nextDate)
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
                            <DatePicker value={regras.data_ultimo_encontro || ''} onChange={() => {}} disabled />
                          </div>
                          <div className="space-y-1">
                            <Label>Data próximo encontro de contas</Label>
                            <DatePicker
                              value={regras.data_proximo_encontro || ''}
                              onChange={(value) => setRegra('data_proximo_encontro', value)}
                              disabled={isReadOnly || !isEdit}
                            />
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>
              )}

              {form.regra_cobranca === 'mensal' && (
                <div className="space-y-2 md:col-span-2">
                  <div className="border-t" />
                  <p className="text-base font-semibold">Configuração de cobrança mensal</p>
                  <Label>Valor mensal do projeto</Label>
                  <MoneyInput
                    value={regras.valor_mensal || ''}
                    onValueChange={(value) => setRegra('valor_mensal', value)}
                    disabled={isReadOnly}
                  />
                </div>
              )}

              {form.regra_cobranca === 'mensalidade_processo' && (
                <div className="space-y-2 md:col-span-2">
                  <div className="border-t" />
                  <p className="text-base font-semibold">Configuração de mensalidade de processo</p>
                  <Label>Valor mensal</Label>
                  <MoneyInput
                    value={regras.valor_mensal || ''}
                    onValueChange={(value) => setRegra('valor_mensal', value)}
                    disabled={isReadOnly}
                  />
                </div>
              )}

              {form.regra_cobranca === 'salario_minimo' && (
                <div className="space-y-3 md:col-span-2">
                  <div className="border-t" />
                  <p className="text-base font-semibold">Configuração por Salário Mínimo</p>
                  <div className="max-w-sm space-y-2">
                    <Label>Quantidade de SM</Label>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={String(regras.quantidade_sm || '')}
                      onChange={(e) => {
                        setRegra('quantidade_sm', e.target.value)
                        setError(null)
                      }}
                      disabled={isReadOnly}
                      placeholder="Ex: 2,5"
                    />
                  </div>
                  <div className="rounded-md border bg-muted/20 p-3 text-sm">
                    {salarioMinimoQuery.isLoading ? (
                      <span className="text-muted-foreground">Carregando salário mínimo atual...</span>
                    ) : salarioMinimoQuery.isError ? (
                      <span className="text-red-700">{salarioMinimoQuery.error.message}</span>
                    ) : quantidadeSm && salarioMinimoValor ? (
                      <span>
                        {quantidadeSm.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} SM × R$ {formatAmount(salarioMinimoValor)} = R${' '}
                        {formatAmount(quantidadeSm * salarioMinimoValor)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Informe a quantidade de SM para ver o cálculo.</span>
                    )}
                  </div>
                </div>
              )}

              {form.regra_cobranca === 'projeto' && (
                <div className="space-y-3 md:col-span-2">
                  <div className="border-t" />
                  <p className="text-base font-semibold">Configuração de cobrança por Projeto</p>
                  <Label>Valor do projeto</Label>
                  <MoneyInput
                    value={regras.valor_projeto || ''}
                    onValueChange={(value) => {
                      setRegra('valor_projeto', value)
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
                      <Button type="button" variant="outline" size="sm" onClick={addParcela}>
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
                          setRegra('parcelas', arr)
                        }}
                      />
                      <DatePicker
                        value={parcela.data_pagamento || ''}
                        onChange={(value) => {
                          const arr = [...(regras.parcelas || [])]
                          arr[idx] = { ...arr[idx], data_pagamento: value }
                          setRegra('parcelas', arr)
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
                            setRegra('parcelas', arr)
                          }}
                        >
                          Remover
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {form.regra_cobranca === 'exito' && (
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
                        setRegra('percentual_exito', e.target.value)
                        setRegra('valor_exito_calculado', ((valorAcao * percentual) / 100).toFixed(2))
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
                        setRegra('valor_acao', value)
                        setRegra('valor_exito_calculado', ((valorAcao * percentual) / 100).toFixed(2))
                      }}
                      disabled={isReadOnly}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Data de pagamento</Label>
                    <DatePicker
                      value={regras.data_pagamento_exito || ''}
                      onChange={(value) => setRegra('data_pagamento_exito', value)}
                      disabled={isReadOnly}
                    />
                  </div>
                </div>
              )}

              {form.regra_cobranca && form.regra_cobranca !== 'hora' && (
                <CapEncontroSimple
                  regras={regras}
                  onRegraChange={setRegra}
                  inicioVigencia={form.inicio_vigencia}
                  pagamentoDiaMes={form.pagamento_dia_mes}
                  isReadOnly={isReadOnly}
                  isEdit={isEdit}
                />
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
                      setCrossSell('ativo', enabled)
                      if (!enabled) {
                        setCrossSell('origem_colaborador_id', '')
                        setCrossSell('periodicidade', 'mensal')
                        setCrossSell('modo', 'percentual')
                        setCrossSell('valor', '')
                        setCrossSell('data_pagamento_unico', '')
                        setCrossSell('usar_dia_vencimento', true)
                        setCrossSell('dia_pagamento_mensal', '')
                        setCrossSell('data_fim_pagamentos', '')
                        setCrossSell('parcelas_pagamento', [])
                        return
                      }
                      if (!String(regras.cross_sell_origem_colaborador_id || '').trim() && options.colaboradores?.[0]?.id) {
                        setCrossSell('origem_colaborador_id', options.colaboradores[0].id)
                      }
                      if (!String(regras.cross_sell_periodicidade || '').trim()) {
                        setCrossSellPeriodicidade(periodicidadeIndicacaoOptions[0]?.value || 'pontual')
                      }
                      if (!String(regras.cross_sell_modo || '').trim()) {
                        setCrossSell('modo', 'percentual')
                      }
                    }}
                    options={[
                      { value: 'nao', label: 'Não' },
                      { value: 'sim', label: 'Sim' },
                    ]}
                    disabled={isReadOnly}
                  />
                </div>
                {crossSellEnabled && (
                  <>
                    <div className="space-y-2">
                      <Label>Origem do cross sell</Label>
                      <CommandSelect
                        value={String(regras.cross_sell_origem_colaborador_id || '')}
                        onValueChange={(value) => setCrossSell('origem_colaborador_id', value)}
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
                        onChange={(e) => setCrossSellPeriodicidade(e.target.value)}
                        disabled={isReadOnly}
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
                      <NativeSelect value={crossSellModo} onChange={(e) => setCrossSell('modo', e.target.value)} disabled={isReadOnly}>
                        <option value="percentual">Percentual</option>
                        <option value="valor">Valor</option>
                      </NativeSelect>
                    </div>
                    <div className="space-y-2">
                      <Label>{crossSellModo === 'valor' ? 'Valor' : 'Percentual'}</Label>
                      {crossSellModo === 'valor' ? (
                        <MoneyInput value={regras.cross_sell_valor || ''} onValueChange={(value) => setCrossSell('valor', value)} disabled={isReadOnly} />
                      ) : (
                        <Input value={regras.cross_sell_valor || ''} onChange={(e) => setCrossSell('valor', e.target.value)} disabled={isReadOnly} />
                      )}
                    </div>
                    {(crossSellPeriodicidade === 'pontual' || crossSellPeriodicidade === 'ao_final') && (
                      <div className="space-y-2">
                        <Label>Data do pagamento do cross selling</Label>
                        <DatePicker value={regras.cross_sell_data_pagamento_unico || ''} onChange={(value) => setCrossSell('data_pagamento_unico', value)} disabled={isReadOnly} />
                      </div>
                    )}
                    {crossSellPeriodicidade === 'mensal' && (
                      <>
                        <div className="space-y-2">
                          <Label>Usar dia de vencimento do caso?</Label>
                          <ChoiceCards
                            value={regras.cross_sell_usar_dia_vencimento ? 'sim' : 'nao'}
                            onChange={(value) => setCrossSell('usar_dia_vencimento', value === 'sim')}
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
                              onChange={(e) => setCrossSell('dia_pagamento_mensal', e.target.value)}
                              disabled={isReadOnly}
                            />
                          </div>
                        )}
                        <div className="space-y-2">
                          <Label>Data final dos pagamentos</Label>
                          <DatePicker value={regras.cross_sell_data_fim_pagamentos || ''} onChange={(value) => setCrossSell('data_fim_pagamentos', value)} disabled={isReadOnly} />
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
                        {(Array.isArray(regras.cross_sell_parcelas_pagamento) ? regras.cross_sell_parcelas_pagamento : []).map((parcela: any, idx: number) => (
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
                        ))}
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
                    onChange={(value) => {
                      if (value === 'nao') {
                        setIndicacao('pagamento_indicacao_ativo', false)
                        setIndicacao('pagamento_indicacao', 'nao')
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
                      setIndicacao('pagamento_indicacao_ativo', true)
                      setIndicacao('pagamento_indicacao', nextValue)
                    }}
                    options={[
                      { value: 'nao', label: 'Não' },
                      { value: 'sim', label: 'Sim' },
                    ]}
                    disabled={isReadOnly}
                  />
                </div>
                {indicacaoPagamentoEnabled && (
                  <>
                    <div className="space-y-2">
                      <Label>Indicado por</Label>
                      <CommandSelect
                        value={indicacao.pagamento_indicacao || ''}
                        onValueChange={(value) => setIndicacao('pagamento_indicacao', value)}
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
                        onChange={(e) => setIndicacaoPeriodicidade(e.target.value)}
                        disabled={isReadOnly}
                      >
                        {periodicidadeIndicacaoOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </NativeSelect>
                    </div>
                    <div className="space-y-2">
                      <Label>Tipo de valor</Label>
                      <NativeSelect value={indicacao.modo || 'percentual'} onChange={(e) => setIndicacao('modo', e.target.value)} disabled={isReadOnly}>
                        <option value="percentual">Percentual</option>
                        <option value="valor">Valor</option>
                      </NativeSelect>
                    </div>
                    <div className="space-y-2">
                      <Label>{indicacao.modo === 'valor' ? 'Valor' : 'Percentual'}</Label>
                      {indicacao.modo === 'valor' ? (
                        <MoneyInput value={indicacao.valor || ''} onValueChange={(value) => setIndicacao('valor', value)} disabled={isReadOnly} />
                      ) : (
                        <Input value={indicacao.valor || ''} onChange={(e) => setIndicacao('valor', e.target.value)} disabled={isReadOnly} />
                      )}
                    </div>
                    {(indicacao.periodicidade === 'pontual' || indicacao.periodicidade === 'ao_final') && (
                      <div className="space-y-2">
                        <Label>Data do pagamento</Label>
                        <DatePicker value={indicacao.data_pagamento_unico || ''} onChange={(value) => setIndicacao('data_pagamento_unico', value)} disabled={isReadOnly} />
                      </div>
                    )}
                    {indicacao.periodicidade === 'mensal' && (
                      <>
                        <div className="space-y-2">
                          <Label>Usar dia de vencimento do caso?</Label>
                          <ChoiceCards
                            value={indicacao.usar_dia_vencimento ? 'sim' : 'nao'}
                            onChange={(value) => setIndicacao('usar_dia_vencimento', value === 'sim')}
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
                              onChange={(e) => setIndicacao('dia_pagamento_mensal', e.target.value)}
                              disabled={isReadOnly}
                            />
                          </div>
                        )}
                        <div className="space-y-2">
                          <Label>Data final dos pagamentos</Label>
                          <DatePicker value={indicacao.data_fim_pagamentos || ''} onChange={(value) => setIndicacao('data_fim_pagamentos', value)} disabled={isReadOnly} />
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
                <RateioSlider
                  title="Pagadores do serviço (rateio)"
                  options={clienteOptions}
                  items={(form.pagadores_servico || []).filter((item) => item.cliente_id).map((item) => ({ id: item.cliente_id, percentual: item.percentual ?? 0 }))}
                  onChange={setPagadoresServicoRateio}
                  disabled={isReadOnly}
                  frameless
                />
              </div>
            </>
          )}

          {substep === 'despesas' && (
            <div className="space-y-4 md:col-span-2">
              <div className="space-y-2">
                <Label>Despesas reembolsáveis</Label>
                <ChoiceCards
                  value={despesasReembolsaveisEnabled ? 'sim' : 'nao'}
                  onChange={(value) => {
                    if (value === 'nao') {
                      setDespesas('reembolsavel_ativo', false)
                      setDespesas('despesas_reembolsaveis', ['nao'])
                      setDespesas('limite_adiantamento', '')
                      setField('pagadores_despesa', [])
                    } else {
                      setDespesas('reembolsavel_ativo', true)
                      setDespesas('despesas_reembolsaveis', (despesas.despesas_reembolsaveis || []).filter((item: string) => item !== 'nao'))
                    }
                  }}
                  disabled={isReadOnly}
                  options={[{ value: 'nao', label: 'Não' }, { value: 'sim', label: 'Sim' }]}
                />
              </div>
              {despesasReembolsaveisEnabled && (
                <>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                    {[
                      { key: 'viagem', label: 'Viagem' },
                      { key: 'despesas_extrajudiciais', label: 'Despesas Extrajudiciais' },
                      { key: 'despesas_judiciais', label: 'Despesas Judiciais' },
                      { key: 'deslocamento', label: 'Deslocamento' },
                    ].map((op) => {
                      const selected = (despesas.despesas_reembolsaveis || []).includes(op.key)
                      return (
                        <button
                          key={op.key}
                          type="button"
                          className={`rounded-md border px-3 py-2 text-left text-sm ${selected ? 'border-primary bg-primary/10' : ''}`}
                          onClick={() => {
                            const current = despesas.despesas_reembolsaveis || []
                            const next = selected ? current.filter((item: string) => item !== op.key) : [...current, op.key]
                            setDespesas('despesas_reembolsaveis', next)
                          }}
                          disabled={isReadOnly}
                        >
                          {op.label}
                        </button>
                      )
                    })}
                  </div>
                  <div className="space-y-2">
                    <Label>Limite de adiantamento</Label>
                    <MoneyInput value={despesas.limite_adiantamento || ''} onValueChange={(value) => setDespesas('limite_adiantamento', value)} disabled={isReadOnly} />
                  </div>
                  <div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={copyHonorariosToDespesas}
                      disabled={isReadOnly || !form.pagadores_servico || form.pagadores_servico.length === 0}
                      title={
                        form.pagadores_servico?.length === 0
                          ? 'Configure primeiro os pagadores de honorários'
                          : 'Copia a distribuição de pagadores dos honorários'
                      }
                    >
                      <Copy className="mr-2 h-4 w-4" />
                      Copiar dados dos honorários
                    </Button>
                  </div>
                  <RateioSlider
                    title="Pagadores da despesa (rateio)"
                    options={clienteOptions}
                    items={(form.pagadores_despesa || []).filter((item) => item.cliente_id).map((item) => ({ id: item.cliente_id, percentual: item.percentual ?? 0 }))}
                    onChange={setPagadoresDespesaRateio}
                    disabled={isReadOnly}
                    frameless
                  />
                </>
              )}
            </div>
          )}

          {substep === 'timesheet' && (
            <div className="space-y-4 md:col-span-2">
              <div className="space-y-2">
                <Label>Enviar timesheet ao cliente?</Label>
                <ChoiceCards
                  value={timesheet.envia_timesheet ? 'sim' : 'nao'}
                  onChange={(value) => setTimesheet('envia_timesheet', value === 'sim')}
                  options={[{ value: 'nao', label: 'Não' }, { value: 'sim', label: 'Sim' }]}
                  disabled={isReadOnly}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Revisores</Label>
                  {!isReadOnly && <Button type="button" variant="outline" size="sm" onClick={addRevisor}>Adicionar</Button>}
                </div>
                <p className="text-xs text-muted-foreground">Arraste para ordenar a sequência de revisão.</p>
                {(timesheet.revisores || []).map((r: any, idx: number) => (
                  <div
                    key={idx}
                    className={`grid grid-cols-1 gap-2 rounded-md border p-2 md:grid-cols-[auto_1fr_auto] ${
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
                    <CommandSelect value={r.colaborador_id || ''} onValueChange={(value) => {
                      const list = [...(timesheet.revisores || [])]
                      list[idx] = { ...list[idx], colaborador_id: value }
                      setTimesheet('revisores', list)
                    }} disabled={isReadOnly} options={colaboradorOptions} placeholder="Selecione..." searchPlaceholder="Buscar revisor..." emptyText="Nenhum colaborador encontrado." />
                    {!isReadOnly && <Button type="button" variant="outline" onClick={() => {
                      const list = [...(timesheet.revisores || [])]
                      list.splice(idx, 1)
                      setTimesheet('revisores', list.map((entry: any, orderIdx: number) => ({ ...entry, ordem: orderIdx + 1 })))
                    }}>Remover</Button>}
                  </div>
                ))}
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Aprovadores</Label>
                  {!isReadOnly && <Button type="button" variant="outline" size="sm" onClick={addAprovador}>Adicionar</Button>}
                </div>
                <p className="text-xs text-muted-foreground">Arraste para ordenar a sequência de aprovação.</p>
                {(timesheet.aprovadores || []).map((a: any, idx: number) => (
                  <div
                    key={idx}
                    className={`grid grid-cols-1 gap-2 rounded-md border p-2 md:grid-cols-[auto_1fr_auto] ${
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
                    <CommandSelect value={a.colaborador_id || ''} onValueChange={(value) => {
                      const list = [...(timesheet.aprovadores || [])]
                      list[idx] = { ...list[idx], colaborador_id: value }
                      setTimesheet('aprovadores', list)
                    }} disabled={isReadOnly} options={colaboradorOptions} placeholder="Selecione..." searchPlaceholder="Buscar aprovador..." emptyText="Nenhum colaborador encontrado." />
                    {!isReadOnly && <Button type="button" variant="outline" onClick={() => {
                      const list = [...(timesheet.aprovadores || [])]
                      list.splice(idx, 1)
                      setTimesheet('aprovadores', list.map((entry: any, orderIdx: number) => ({ ...entry, ordem: orderIdx + 1 })))
                    }}>Remover</Button>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {false && (
            <div className="grid grid-cols-1 gap-4 md:col-span-2 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <Label>Cross Sell</Label>
                <ChoiceCards
                  value={regras.cross_sell_ativo ? 'sim' : 'nao'}
                  onChange={(value) => {
                    const enabled = value === 'sim'
                    setRegra('cross_sell_ativo', enabled)
                    if (!enabled) setRegra('cross_sell_origem_colaborador_id', '')
                  }}
                  options={[
                    { value: 'nao', label: 'Não' },
                    { value: 'sim', label: 'Sim' },
                  ]}
                  disabled={isReadOnly}
                />
              </div>
              {regras.cross_sell_ativo && (
                <div className="space-y-2 md:col-span-2">
                  <Label>Origem do Cross Sell</Label>
                  <CommandSelect
                    value={String(regras.cross_sell_origem_colaborador_id || '')}
                    onValueChange={(value) => setRegra('cross_sell_origem_colaborador_id', value)}
                    options={colaboradorOptions}
                    placeholder="Selecione..."
                    searchPlaceholder="Buscar colaborador..."
                    emptyText="Nenhum colaborador encontrado."
                    disabled={isReadOnly}
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label>Pagamento da indicação</Label>
                <ChoiceCards
                  value={indicacaoPagamentoEnabled ? 'sim' : 'nao'}
                  onChange={(value) => {
                    if (value === 'nao') {
                      setIndicacao('pagamento_indicacao_ativo', false)
                      setIndicacao('pagamento_indicacao', 'nao')
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
                    setIndicacao('pagamento_indicacao_ativo', true)
                    setIndicacao('pagamento_indicacao', nextValue)
                  }}
                  options={[
                    { value: 'nao', label: 'Não' },
                    { value: 'sim', label: 'Sim' },
                  ]}
                  disabled={isReadOnly}
                />
              </div>
              {indicacaoPagamentoEnabled && (
                <>
                  <div className="space-y-2">
                    <Label>Indicado por</Label>
                    <CommandSelect
                      value={indicacao.pagamento_indicacao || ''}
                      onValueChange={(value) => setIndicacao('pagamento_indicacao', value)}
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
                      onChange={(e) => setIndicacao('periodicidade', e.target.value)}
                      disabled={isReadOnly}
                    >
                      {periodicidadeIndicacaoOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="space-y-2">
                    <Label>Tipo de valor</Label>
                    <NativeSelect value={indicacao.modo || 'percentual'} onChange={(e) => setIndicacao('modo', e.target.value)} disabled={isReadOnly}>
                      <option value="percentual">Percentual</option>
                      <option value="valor">Valor</option>
                    </NativeSelect>
                  </div>
                  <div className="space-y-2">
                    <Label>{indicacao.modo === 'valor' ? 'Valor' : 'Percentual'}</Label>
                    <Input value={indicacao.valor || ''} onChange={(e) => setIndicacao('valor', e.target.value)} disabled={isReadOnly} />
                  </div>
                </>
              )}
            </div>
          )}
            </>
          )}
        </CardContent>
      </Card>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 backdrop-blur-sm md:pl-64">
        <div className="pointer-events-auto container mx-auto flex flex-wrap justify-end gap-2 px-4 py-4">
          {isEdit && !isReadOnly ? (
            <Button variant="outline" onClick={() => setDeleteCasoOpen(true)} disabled={loading || deleteCasoLoading}>
              Excluir caso
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => router.back()} disabled={loading}>
            Cancelar
          </Button>
          {!isReadOnly && (
            <Button onClick={submit} disabled={loading}>
              {loading ? 'Salvando...' : isEdit ? 'Atualizar caso' : 'Criar caso'}
            </Button>
          )}
        </div>
      </div>

      <AlertDialog
        open={deleteCasoOpen}
        onOpenChange={setDeleteCasoOpen}
        title="Excluir caso definitivamente?"
        description="Essa ação remove o caso e os dados vinculados. Não é possível desfazer."
        confirmLabel="Excluir"
        cancelLabel="Cancelar"
        onConfirm={deleteCaso}
        loading={deleteCasoLoading}
      />

      <Dialog open={priceTableDialogOpen} onOpenChange={setPriceTableDialogOpen}>
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
                    setRegra('modo_preco', 'tabela')
                    setCreatingPriceTable(true)
                    setNewPriceTableName('')
                    setRegra('tabela_preco_id', '')
                    setRegra('tabela_preco_nome', '')
                    setRegra('tabela_preco_itens', buildDefaultTabelaPrecoItens())
                    return
                  }
                  const selected = getPriceTableByKey(value)
                  if (!selected) return
                  setRegra('modo_preco', 'tabela')
                  setCreatingPriceTable(false)
                  setRegra('tabela_preco_id', selected.id || '')
                  setRegra('tabela_preco_nome', selected.nome)
                  setRegra('tabela_preco_itens', selected.itens)
                }}
                options={priceTableOptions}
                placeholder="Selecionar tabela"
                searchPlaceholder="Buscar tabela..."
                emptyText="Nenhuma tabela encontrada."
                disabled={isReadOnly}
              />
            </div>
            {(creatingPriceTable || !regras.tabela_preco_nome) && (
              <div className="space-y-1">
                <Label>Nome da nova tabela</Label>
                <Input value={newPriceTableName} onChange={(e) => setNewPriceTableName(e.target.value)} placeholder="Ex: Tabela Tributário 2026" disabled={isReadOnly} />
              </div>
            )}
            <div className="space-y-3 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <p className="text-base font-semibold">Preenchimento por cargo</p>
                <Badge>{(regras.tabela_preco_itens || []).length} cargos</Badge>
              </div>
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
                      <TableCell className="font-medium">{item.cargo_nome || 'Cargo'}</TableCell>
                      <TableCell>
                        <MoneyInput value={item.valor_hora || ''} onValueChange={(value) => {
                          const list = [...(regras.tabela_preco_itens || [])]
                          list[idx] = { ...list[idx], valor_hora: value }
                          setRegra('tabela_preco_itens', list)
                        }} disabled={isReadOnly} />
                      </TableCell>
                      <TableCell>
                        <MoneyInput value={item.valor_hora_excedente || ''} onValueChange={(value) => {
                          const list = [...(regras.tabela_preco_itens || [])]
                          list[idx] = { ...list[idx], valor_hora_excedente: value }
                          setRegra('tabela_preco_itens', list)
                        }} disabled={isReadOnly} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {!isReadOnly && (
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setPriceTableDialogOpen(false)}>Fechar</Button>
                <Button type="button" onClick={savePriceTable} disabled={priceTableSaving || (creatingPriceTable && !newPriceTableName.trim())}>
                  {priceTableSaving ? 'Salvando...' : 'Salvar tabela'}
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={dayModalOpen} onOpenChange={setDayModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Selecione o dia de pagamento</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-7 gap-2 py-2">
            {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
              <button
                key={day}
                type="button"
                className="rounded border px-2 py-2 text-sm hover:bg-gray-50"
                onClick={() => chooseDay(day)}
              >
                {day}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {isEdit && casoId && (
        <AnexoModal
          open={anexoModalOpen}
          onOpenChange={setAnexoModalOpen}
          mode="caso"
          targetId={casoId}
          onSuccess={() => {
            void loadCaseAnexos()
            success('Anexo enviado com sucesso.')
          }}
        />
      )}
    </div>
  )
}

function ChoiceCards({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  options: ChoiceOption[]
  disabled?: boolean
}) {
  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
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
          </button>
        )
      })}
    </div>
  )
}
