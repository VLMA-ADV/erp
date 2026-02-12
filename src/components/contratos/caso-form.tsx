'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight, CircleDollarSign, Clock3, HandCoins, Landmark, Layers3, Paperclip, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CommandSelect } from '@/components/ui/command-select'
import { DatePicker } from '@/components/ui/date-picker'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MoneyInput } from '@/components/ui/money-input'
import { NativeSelect } from '@/components/ui/native-select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'
import { useToast } from '@/components/ui/toast'
import AnexoModal from './anexo-modal'
import RateioSlider from './rateio-slider'
import type { CasoPayload, ContratoFormOptions } from './types'

const emptyCaso: CasoPayload = {
  nome: '',
  produto_id: '',
  responsavel_id: '',
  moeda: 'real',
  tipo_cobranca_documento: '',
  data_inicio_faturamento: '',
  pagamento_dia_mes: '',
  inicio_vigencia: '',
  periodo_reajuste: '',
  data_proximo_reajuste: '',
  data_ultimo_reajuste: '',
  indice_reajuste: '',
  regra_cobranca: '',
  regra_cobranca_config: {
    valor_hora: '',
    usa_tabela_preco: false,
    tabela_preco_nome: '',
    tabela_preco_itens: [],
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
    regra_cobranca_texto: '',
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

type CaseSubstepKey = 'basico' | 'financeiro' | 'despesas' | 'timesheet' | 'indicacao'

const caseSubsteps: Array<{ key: CaseSubstepKey; label: string; icon: typeof Layers3 }> = [
  { key: 'basico', label: 'Dados básicos', icon: Layers3 },
  { key: 'financeiro', label: 'Regras financeiras', icon: CircleDollarSign },
  { key: 'despesas', label: 'Despesas', icon: Landmark },
  { key: 'timesheet', label: 'Timesheet', icon: Clock3 },
  { key: 'indicacao', label: 'Indicação', icon: HandCoins },
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
  const canWrite = hasPermission('contracts.casos.write') || hasPermission('contracts.contratos.write') || hasPermission('contracts.*')

  const [substep, setSubstep] = useState<CaseSubstepKey>('basico')
  const [loading, setLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<CasoPayload>(emptyCaso)
  const [options, setOptions] = useState<ContratoFormOptions>({
    clientes: [],
    produtos: [],
    centros_custo: [],
    cargos: [],
    colaboradores: [],
    socios: [],
    tabelas_preco: [],
  })
  const [dayModalOpen, setDayModalOpen] = useState(false)
  const [manualReajusteDate, setManualReajusteDate] = useState(false)
  const [manualEncontroDate, setManualEncontroDate] = useState(false)
  const [priceTableCatalog, setPriceTableCatalog] = useState<TabelaPrecoCatalog[]>([])
  const [creatingPriceTable, setCreatingPriceTable] = useState(false)
  const [newPriceTableName, setNewPriceTableName] = useState('')
  const [priceTableDialogOpen, setPriceTableDialogOpen] = useState(false)
  const [priceTableSaving, setPriceTableSaving] = useState(false)
  const [anexoModalOpen, setAnexoModalOpen] = useState(false)
  const [caseAnexos, setCaseAnexos] = useState<CasoAnexoItem[]>([])
  const [openingAnexoId, setOpeningAnexoId] = useState<string | null>(null)
  const [removingAnexoId, setRemovingAnexoId] = useState<string | null>(null)

  const isEdit = !!casoId
  const isReadOnly = viewOnly || !canWrite

  const socioOptions = useMemo(() => options.socios || [], [options.socios])
  const regras = form.regra_cobranca_config || {}
  const despesas = form.despesas_config || {}
  const timesheet = form.timesheet_config || {}
  const indicacao = form.indicacao_config || {}
  const modoPreco = regras.modo_preco || (regras.tabela_preco_id || regras.tabela_preco_nome ? 'tabela' : 'valor_hora')
  const despesasSelecionadas: string[] = despesas.despesas_reembolsaveis || []
  const despesasReembolsaveisEnabled =
    Boolean((despesas as any).reembolsavel_ativo) || (despesasSelecionadas.length > 0 && !despesasSelecionadas.includes('nao'))
  const clienteOptions = useMemo(
    () => (options.clientes || []).map((item) => ({ value: item.id, label: item.nome })),
    [options.clientes],
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
    () => (options.colaboradores || []).map((item) => ({ value: item.id, label: item.nome })),
    [options.colaboradores],
  )
  const produtoMap = useMemo(() => new Map((options.produtos || []).map((item) => [item.id, item.nome])), [options.produtos])
  const colaboradorMap = useMemo(() => new Map((options.colaboradores || []).map((item) => [item.id, item.nome])), [options.colaboradores])
  const centroMap = useMemo(() => new Map((options.centros_custo || []).map((item) => [item.id, item.nome])), [options.centros_custo])

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
          produtos: [],
          centros_custo: [],
          cargos: [],
          colaboradores: [],
          socios: [],
          tabelas_preco: [],
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

        if (casoId) {
          const caso = (contratoData.data?.casos || []).find((c: any) => c.id === casoId)
          if (!caso) {
            setError('Caso não encontrado')
            return
          }

          setForm({
            ...emptyCaso,
            nome: caso.nome || '',
            produto_id: caso.produto_id || '',
            responsavel_id: caso.responsavel_id || '',
            moeda: caso.moeda || 'real',
            tipo_cobranca_documento: caso.tipo_cobranca_documento || '',
            data_inicio_faturamento: caso.data_inicio_faturamento || '',
            pagamento_dia_mes: caso.pagamento_dia_mes ? String(caso.pagamento_dia_mes) : '',
            inicio_vigencia: caso.inicio_vigencia || '',
            periodo_reajuste: caso.periodo_reajuste || '',
            data_proximo_reajuste: caso.data_proximo_reajuste || '',
            data_ultimo_reajuste: caso.data_ultimo_reajuste || '',
            indice_reajuste: caso.indice_reajuste || '',
            regra_cobranca: caso.regra_cobranca || '',
            regra_cobranca_config: caso.regra_cobranca_config || emptyCaso.regra_cobranca_config,
            centro_custo_rateio: caso.centro_custo_rateio || [],
            pagadores_servico: caso.pagadores_servico || [],
            despesas_config: caso.despesas_config || emptyCaso.despesas_config,
            pagadores_despesa: caso.pagadores_despesa || [],
            timesheet_config: caso.timesheet_config || emptyCaso.timesheet_config,
            indicacao_config: caso.indicacao_config || emptyCaso.indicacao_config,
          })
          setCaseAnexos(((caso?.anexos || []) as CasoAnexoItem[]) ?? [])
        } else {
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
    if (manualEncontroDate) return
    const periodicidade = form.regra_cobranca_config?.encontro_periodicidade || 'mensal'
    const months = periodToMonths[periodicidade] || 1
    const day = Number(form.pagamento_dia_mes || '0') || undefined

    const base = form.regra_cobranca_config?.data_ultimo_encontro || form.data_inicio_faturamento
    if (!base) return

    setForm((prev) => ({
      ...prev,
      regra_cobranca_config: {
        ...prev.regra_cobranca_config,
        data_proximo_encontro: buildNextDate(base, months, day),
      },
    }))
  }, [
    form.pagamento_dia_mes,
    form.data_inicio_faturamento,
    form.regra_cobranca_config?.encontro_periodicidade,
    form.regra_cobranca_config?.data_ultimo_encontro,
    manualEncontroDate,
  ])

  const setField = <K extends keyof CasoPayload>(key: K, value: CasoPayload[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
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
    const baseDate = form.data_inicio_faturamento || form.inicio_vigencia || new Date().toISOString().slice(0, 10)
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
    if (tipoRaw === 'prestador') return `Prestador (${entityId})`
    if (tipoRaw === 'parceiro') return `Parceiro (${entityId})`
    return value
  }

  const submit = async () => {
    setError(null)

    if (isReadOnly) {
      setError('Modo somente leitura')
      return
    }

    if (!form.nome.trim()) {
      setError('Nome do caso é obrigatório')
      return
    }

    try {
      setLoading(true)
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/${isEdit ? 'update-caso' : 'create-caso'}`
      const body = isEdit
        ? { id: casoId, ...form, data_ultimo_reajuste: form.data_ultimo_reajuste || form.data_inicio_faturamento, status: 'ativo' }
        : { contrato_id: contratoId, ...form, data_ultimo_reajuste: form.data_inicio_faturamento, status: 'ativo' }

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
        setError(data.error || 'Erro ao remover anexo')
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
    <div className="space-y-4">
      {error && (
        <Alert className="border-red-200 bg-red-50 text-red-800">
          <AlertTitle>Atenção</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

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
                  <div className="space-y-1 rounded-md border p-3"><p className="text-xs text-muted-foreground">Data início faturamento</p><p className="font-medium">{form.data_inicio_faturamento || '-'}</p></div>
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
              {substep === 'indicacao' && (
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

              <div className="space-y-2">
                <Label>Serviço</Label>
                <CommandSelect
                  value={form.produto_id}
                  onValueChange={(value) => setField('produto_id', value)}
                  options={produtoOptions}
                  placeholder="Selecione..."
                  searchPlaceholder="Buscar serviço..."
                  emptyText="Nenhum serviço encontrado."
                  disabled={isReadOnly}
                />
              </div>

              <div className="space-y-2">
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
                  title="Centro de custo (múltiplos + percentual opcional)"
                  options={centroOptions}
                  items={(form.centro_custo_rateio || [])
                    .filter((item) => item.centro_custo_id)
                    .map((item) => ({ id: item.centro_custo_id, percentual: item.percentual ?? 0 }))}
                  onChange={setCentroRateio}
                  disabled={isReadOnly}
                  frameless
                />
              </div>
            </>
          )}

          {substep === 'financeiro' && (
            <>
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
                <Label>Data início faturamento</Label>
                <DatePicker value={form.data_inicio_faturamento} onChange={(value) => setField('data_inicio_faturamento', value)} disabled={isReadOnly} />
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
                <DatePicker value={form.inicio_vigencia} onChange={(value) => setField('inicio_vigencia', value)} disabled={isReadOnly} />
              </div>
              <div className="space-y-2">
                <Label>Período reajuste</Label>
                <NativeSelect value={form.periodo_reajuste} onChange={(e) => setField('periodo_reajuste', e.target.value)} disabled={isReadOnly}>
                  <option value="">Selecione...</option>
                  <option value="mensal">Mensal</option>
                  <option value="bimestral">Bimestral</option>
                  <option value="trimestral">Trimestral</option>
                  <option value="semestral">Semestral</option>
                  <option value="anual">Anual</option>
                </NativeSelect>
              </div>
              <div className="space-y-2">
                <Label>Data próximo reajuste</Label>
                <DatePicker
                  value={form.data_proximo_reajuste}
                  onChange={(value) => {
                    setManualReajusteDate(true)
                    setField('data_proximo_reajuste', value)
                  }}
                  disabled={isReadOnly}
                />
              </div>
              {isEdit && (
                <div className="space-y-2">
                  <Label>Data último reajuste</Label>
                  <DatePicker value={form.data_ultimo_reajuste} onChange={(value) => setField('data_ultimo_reajuste', value)} disabled={isReadOnly} />
                </div>
              )}
              <div className="space-y-2">
                <Label>Índice de reajuste</Label>
                <NativeSelect value={form.indice_reajuste} onChange={(e) => setField('indice_reajuste', e.target.value)} disabled={isReadOnly}>
                  <option value="">Selecione...</option>
                  <option value="IPCA">IPCA</option>
                  <option value="SELIC">SELIC</option>
                  <option value="IGP-M">IGP-M</option>
                  <option value="INPC">INPC</option>
                </NativeSelect>
              </div>
              <div className="space-y-2">
                <Label>Regra de cobrança</Label>
                <NativeSelect value={form.regra_cobranca} onChange={(e) => setField('regra_cobranca', e.target.value as any)} disabled={isReadOnly}>
                  <option value="">Selecione...</option>
                  <option value="hora">Hora</option>
                  <option value="mensal">Mensal</option>
                  <option value="mensalidade_processo">Mensalidade de processo</option>
                  <option value="projeto">Projeto</option>
                  <option value="exito">Êxito</option>
                </NativeSelect>
              </div>

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
                <Alert className="md:col-span-2">
                  <AlertTitle>Mensalidade de processo</AlertTitle>
                  <AlertDescription>Esta configuração ainda será desenvolvida.</AlertDescription>
                </Alert>
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
                    {['viagem', 'cartorio', 'custas', 'deslocamento', 'outros'].map((op) => {
                      const selected = (despesas.despesas_reembolsaveis || []).includes(op)
                      return (
                        <button
                          key={op}
                          type="button"
                          className={`rounded-md border px-3 py-2 text-left text-sm ${selected ? 'border-primary bg-primary/10' : ''}`}
                          onClick={() => {
                            const current = despesas.despesas_reembolsaveis || []
                            const next = selected ? current.filter((item: string) => item !== op) : [...current, op]
                            setDespesas('despesas_reembolsaveis', next)
                          }}
                          disabled={isReadOnly}
                        >
                          {op}
                        </button>
                      )
                    })}
                  </div>
                  <div className="space-y-2">
                    <Label>Limite de adiantamento</Label>
                    <MoneyInput value={despesas.limite_adiantamento || ''} onValueChange={(value) => setDespesas('limite_adiantamento', value)} disabled={isReadOnly} />
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
                  <Label>Revisores (sócios)</Label>
                  {!isReadOnly && <Button type="button" variant="outline" size="sm" onClick={addRevisor}>Adicionar</Button>}
                </div>
                {(timesheet.revisores || []).map((r: any, idx: number) => (
                  <div key={idx} className="grid grid-cols-1 gap-2 md:grid-cols-3">
                    <NativeSelect value={r.colaborador_id || ''} onChange={(e) => {
                      const list = [...(timesheet.revisores || [])]
                      list[idx] = { ...list[idx], colaborador_id: e.target.value }
                      setTimesheet('revisores', list)
                    }} disabled={isReadOnly}>
                      <option value="">Selecione...</option>
                      {socioOptions.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
                    </NativeSelect>
                    <Input type="number" value={r.ordem || idx + 1} onChange={(e) => {
                      const list = [...(timesheet.revisores || [])]
                      list[idx] = { ...list[idx], ordem: Number(e.target.value || idx + 1) }
                      setTimesheet('revisores', list)
                    }} disabled={isReadOnly} />
                    {!isReadOnly && <Button type="button" variant="outline" onClick={() => {
                      const list = [...(timesheet.revisores || [])]
                      list.splice(idx, 1)
                      setTimesheet('revisores', list)
                    }}>Remover</Button>}
                  </div>
                ))}
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Aprovadores (sócios)</Label>
                  {!isReadOnly && <Button type="button" variant="outline" size="sm" onClick={addAprovador}>Adicionar</Button>}
                </div>
                {(timesheet.aprovadores || []).map((a: any, idx: number) => (
                  <div key={idx} className="grid grid-cols-1 gap-2 md:grid-cols-3">
                    <NativeSelect value={a.colaborador_id || ''} onChange={(e) => {
                      const list = [...(timesheet.aprovadores || [])]
                      list[idx] = { ...list[idx], colaborador_id: e.target.value }
                      setTimesheet('aprovadores', list)
                    }} disabled={isReadOnly}>
                      <option value="">Selecione...</option>
                      {socioOptions.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
                    </NativeSelect>
                    <Input type="number" value={a.ordem || idx + 1} onChange={(e) => {
                      const list = [...(timesheet.aprovadores || [])]
                      list[idx] = { ...list[idx], ordem: Number(e.target.value || idx + 1) }
                      setTimesheet('aprovadores', list)
                    }} disabled={isReadOnly} />
                    {!isReadOnly && <Button type="button" variant="outline" onClick={() => {
                      const list = [...(timesheet.aprovadores || [])]
                      list.splice(idx, 1)
                      setTimesheet('aprovadores', list)
                    }}>Remover</Button>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {substep === 'indicacao' && (
            <div className="grid grid-cols-1 gap-4 md:col-span-2 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Pagamento da indicação</Label>
                <NativeSelect value={indicacao.pagamento_indicacao || 'nao'} onChange={(e) => setIndicacao('pagamento_indicacao', e.target.value)} disabled={isReadOnly}>
                  <option value="nao">Não</option>
                  <optgroup label="Colaboradores">
                    {(options.colaboradores || []).map((p) => <option key={`col-${p.id}`} value={`colaborador:${p.id}`}>{p.nome}</option>)}
                  </optgroup>
                  <optgroup label="Clientes">
                    {(options.clientes || []).map((p) => <option key={`cli-${p.id}`} value={`cliente:${p.id}`}>{p.nome}</option>)}
                  </optgroup>
                </NativeSelect>
              </div>
              <div className="space-y-2">
                <Label>Periodicidade</Label>
                <NativeSelect value={indicacao.periodicidade || 'mensal'} onChange={(e) => setIndicacao('periodicidade', e.target.value)} disabled={isReadOnly}>
                  <option value="mensal">Mensal</option>
                  <option value="ao_final">Ao final</option>
                  <option value="pontual">Pontual</option>
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
            </div>
          )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="flex items-center justify-between">
            <p className="text-base font-semibold">Anexos do caso</p>
            {isEdit && !isReadOnly ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setAnexoModalOpen(true)}>
                <Paperclip className="mr-1 h-4 w-4" />
                Inserir anexo
              </Button>
            ) : null}
          </div>

          {!isEdit && (
            <p className="text-sm text-muted-foreground">
              Salve o caso primeiro para adicionar anexos.
            </p>
          )}

          {isEdit && caseAnexos.length === 0 && (
            <p className="text-sm text-muted-foreground">Sem anexos cadastrados neste caso.</p>
          )}

          {isEdit && caseAnexos.length > 0 && (
            <div className="space-y-2">
              {caseAnexos.map((anexo) => (
                <div key={anexo.id} className="flex items-center justify-between rounded border px-3 py-2">
                  <div>
                    <p className="text-sm font-medium">{anexo.nome}</p>
                    <p className="text-xs text-muted-foreground">{anexo.arquivo_nome}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => openAnexo(anexo.id)}
                      disabled={openingAnexoId === anexo.id}
                    >
                      <Paperclip className="mr-1 h-4 w-4" />
                      Abrir
                    </Button>
                    {!isReadOnly && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => removeAnexo(anexo.id)}
                        disabled={removingAnexoId === anexo.id}
                      >
                        <Trash2 className="mr-1 h-4 w-4" />
                        Remover
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.back()} disabled={loading}>Cancelar</Button>
        {!isReadOnly && (
          <Button onClick={submit} disabled={loading}>
            {loading ? 'Salvando...' : isEdit ? 'Atualizar caso' : 'Criar caso'}
          </Button>
        )}
      </div>

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
                    setCreatingPriceTable(true)
                    setNewPriceTableName('')
                    setRegra('tabela_preco_id', '')
                    setRegra('tabela_preco_nome', '')
                    setRegra('tabela_preco_itens', buildDefaultTabelaPrecoItens())
                    return
                  }
                  const selected = getPriceTableByKey(value)
                  if (!selected) return
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
