'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Download, Edit3, GripVertical, MoveRight, Plus, UserPlus, UserRound } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CommandSelect } from '@/components/ui/command-select'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MoneyInput } from '@/components/ui/money-input'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import SolicitacaoContratoFormFields, { type PendingSolicitacaoAnexo } from '@/components/solicitacoes-contrato/solicitacao-contrato-form-fields'

type EtapaKanban =
  | 'prospeccao'
  | 'em_standby'
  | 'proposta_solicitada'
  | 'proposta_enviada'
  | 'exito_projetado'
  | 'conversao'
  | 'negada'
  | 'suspensa'

interface PipelineAnexo {
  id: string
  nome: string
  arquivo_nome: string
  mime_type: string | null
  tamanho_bytes: number | null
  created_at: string
}

interface PipelineCard {
  id: string
  cliente_id: string
  cliente_nome: string
  servico_id: string | null
  servico_nome: string | null
  produto_id: string | null
  produto_nome: string | null
  valor: number
  responsavel_interno_id: string | null
  responsavel_interno_nome: string | null
  temperatura_pct: number | null
  segmento_nome: string | null
  cidade: string | null
  estado: string | null
  area_id: string | null
  data_card: string | null
  valor_global: number
  forma_pagamento: string | null
  valor_caixa_mes: number
  valor_futuro_projetado: number
  observacoes: string
  etapa: EtapaKanban
  ordem: number
  ativo: boolean
  converted_solicitacao_id: string | null
  created_at: string
  updated_at: string
  anexos: PipelineAnexo[]
}

interface OptionItem {
  id: string
  nome: string
}

interface FormState {
  id?: string
  cliente_id: string
  servico_id: string
  produto_id: string
  valor: string
  responsavel_interno_id: string
  area_id: string
  observacoes: string
  etapa: EtapaKanban
  data_card: string
  valor_global: string
  forma_pagamento: string
  valor_caixa_mes: string
  valor_futuro_projetado: string
}

interface NewAnexo {
  id: string
  nome: string
  file: File
}

const ETAPAS: Array<{ key: EtapaKanban; label: string }> = [
  { key: 'prospeccao', label: 'Prospecção' },
  { key: 'em_standby', label: 'Em standby' },
  { key: 'proposta_solicitada', label: 'Proposta solicitada' },
  { key: 'proposta_enviada', label: 'Proposta enviada' },
  { key: 'exito_projetado', label: 'Êxito/projetado' },
  { key: 'conversao', label: 'Conversão' },
  { key: 'negada', label: 'Negada' },
  { key: 'suspensa', label: 'Suspensa' },
]

const emptyForm: FormState = {
  cliente_id: '',
  servico_id: '',
  produto_id: '',
  valor: '',
  responsavel_interno_id: '',
  area_id: '',
  observacoes: '',
  etapa: 'prospeccao',
  data_card: '',
  valor_global: '',
  forma_pagamento: '',
  valor_caixa_mes: '',
  valor_futuro_projetado: '',
}

function tempColor(pct: number | null | undefined) {
  if (pct == null) return '#d1d5db'
  const hue = 210 - (210 * pct) / 100 // azul (frio) → vermelho (quente)
  return `hsl(${hue}, 80%, 50%)`
}

function formatMoney(value: number | string | null | undefined) {
  const amount = Number(value || 0)
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number.isFinite(amount) ? amount : 0)
}

function formatDateTime(value: string) {
  if (!value) return '-'
  const dt = new Date(value)
  if (Number.isNaN(dt.getTime())) return '-'
  return dt.toLocaleString('pt-BR')
}

async function fileToBase64(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })

  const parts = dataUrl.split(',')
  return parts[1] || ''
}

function base64ToBlob(base64: string, mimeType?: string | null): Blob {
  const byteCharacters = atob(base64)
  const byteNumbers = new Array(byteCharacters.length)
  for (let i = 0; i < byteCharacters.length; i += 1) {
    byteNumbers[i] = byteCharacters.charCodeAt(i)
  }
  const byteArray = new Uint8Array(byteNumbers)
  return new Blob([byteArray], { type: mimeType || 'application/octet-stream' })
}

export default function CrmPipeline() {
  const router = useRouter()
  const { hasPermission } = usePermissionsContext()
  const { success, error: toastError } = useToast()

  /** `write` não implica `read` na semântica de `isPermissionSatisfied`; manter as duas chaves. Curingas cobrem ambas via hook. */
  const canRead =
    hasPermission('crm.pipeline.read') || hasPermission('crm.pipeline.write')

  const canWrite = hasPermission('crm.pipeline.write')

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [movingCardId, setMovingCardId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [cards, setCards] = useState<PipelineCard[]>([])
  const [clientes, setClientes] = useState<OptionItem[]>([])
  const [servicos, setServicos] = useState<OptionItem[]>([])
  const [produtos, setProdutos] = useState<OptionItem[]>([])
  const [colaboradores, setColaboradores] = useState<OptionItem[]>([])
  const [clientesInfo, setClientesInfo] = useState<Record<string, { segmento_nome: string | null; cidade: string | null; estado: string | null }>>({})
  const [areas, setAreas] = useState<OptionItem[]>([])

  const [dialogOpen, setDialogOpen] = useState(false)
  const [filterMonth, setFilterMonth] = useState('')
  const [form, setForm] = useState<FormState>(emptyForm)
  const [solicitacaoOpen, setSolicitacaoOpen] = useState(false)
  const [solicitacaoSubmitting, setSolicitacaoSubmitting] = useState(false)
  const [solicitacaoCardId, setSolicitacaoCardId] = useState('')
  const [solicitacaoNome, setSolicitacaoNome] = useState('')
  const [solicitacaoDescricao, setSolicitacaoDescricao] = useState('')
  const [solicitacaoClienteId, setSolicitacaoClienteId] = useState('')
  const [solicitacaoCentroCustoId, setSolicitacaoCentroCustoId] = useState('')
  const [solicitacaoAnexos, setSolicitacaoAnexos] = useState<PendingSolicitacaoAnexo[]>([])
  const [creatingSolicitacaoCliente, setCreatingSolicitacaoCliente] = useState(false)

  const [existingAnexos, setExistingAnexos] = useState<PipelineAnexo[]>([])
  const [removeAnexoIds, setRemoveAnexoIds] = useState<string[]>([])
  const [newAnexos, setNewAnexos] = useState<NewAnexo[]>([])

  const getSession = async () => {
    const supabase = createClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    return session
  }

  const fetchPipeline = async () => {
    const session = await getSession()
    if (!session) return

    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-crm-pipeline?_ts=${Date.now()}`, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
    })

    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(payload.error || 'Erro ao carregar pipeline')
    }

    setCards(Array.isArray(payload.data) ? (payload.data as PipelineCard[]) : [])
  }

  const fetchClientesInfo = async () => {
    const session = await getSession()
    if (!session) return
    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-crm-clientes-info?_ts=${Date.now()}`, {
      method: 'GET',
      cache: 'no-store',
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    })
    const payload = await response.json().catch(() => ({}))
    if (response.ok && payload.data && typeof payload.data === 'object') setClientesInfo(payload.data)
  }

  const handleSetTemperaturaPct = async (cardId: string, pct: number | null) => {
    // otimista
    setCards((prev) => prev.map((c) => (c.id === cardId ? { ...c, temperatura_pct: pct } : c)))
    try {
      const session = await getSession()
      if (!session) return
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/set-crm-card-temperatura-pct`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ card_id: cardId, temperatura_pct: pct }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(payload.error || 'Erro ao definir temperatura')
        await fetchPipeline()
      }
    } catch (err) {
      console.error(err)
      setError('Erro ao definir temperatura')
    }
  }

  const fetchClientes = async () => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data, error: rpcErr } = await supabase.rpc('list_clientes_paginated', {
      p_user_id: user.id,
      p_limit: 5000,
      p_offset: 0,
      p_search: null,
    })

    if (rpcErr || !data) return

    const payload = (data as { data: any[]; total: number })
    const nextClientes = (payload.data || [])
      .filter((item: any) => item?.id && item?.nome)
      .map((item: any) => ({ id: item.id as string, nome: item.nome as string }))

    setClientes(nextClientes)
  }

  const fetchServicos = async () => {
    const session = await getSession()
    if (!session) return

    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-servicos?_ts=${Date.now()}`, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
    })

    const payload = await response.json().catch(() => ({}))
    if (!response.ok) return

    const nextServicos = (payload.data || [])
      .filter((item: any) => item?.id && item?.nome)
      .map((item: any) => ({ id: item.id as string, nome: item.nome as string }))

    setServicos(nextServicos)
  }

  const fetchProdutos = async () => {
    const session = await getSession()
    if (!session) return

    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-servicos-produtos?_ts=${Date.now()}`, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
    })

    const payload = await response.json().catch(() => ({}))
    if (!response.ok) return

    const nextProdutos = (payload.data || [])
      .filter((item: any) => item?.id && item?.nome)
      .map((item: any) => ({ id: item.id as string, nome: item.nome as string }))

    setProdutos(nextProdutos)
  }

  const fetchAreas = async () => {
    const session = await getSession()
    if (!session) return

    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-areas?_ts=${Date.now()}`, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
    })

    const payload = await response.json().catch(() => ({}))
    if (!response.ok) return

    const nextAreas = (payload.data || [])
      .filter((item: any) => item?.id && item?.nome)
      .map((item: any) => ({ id: item.id as string, nome: item.nome as string }))

    setAreas(nextAreas)
  }

  const fetchColaboradores = async () => {
    const session = await getSession()
    if (!session) return

    const response = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/list-colaboradores?page=1&limit=200&_ts=${Date.now()}`,
      {
        method: 'GET',
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      },
    )

    const payload = await response.json().catch(() => ({}))
    if (!response.ok) return

    const nextColaboradores = (payload.data || [])
      .filter((item: any) => item?.id && item?.nome)
      .map((item: any) => ({ id: item.id as string, nome: item.nome as string }))

    setColaboradores(nextColaboradores)
  }

  const loadAll = async () => {
    try {
      setLoading(true)
      setError(null)
      await Promise.all([fetchPipeline(), fetchClientes(), fetchServicos(), fetchProdutos(), fetchColaboradores(), fetchAreas(), fetchClientesInfo()])
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Erro ao carregar CRM')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!canRead) return
    void loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead])

  const cardsByEtapa = useMemo(() => {
    const byEtapa: Record<EtapaKanban, PipelineCard[]> = {
      prospeccao: [],
      em_standby: [],
      proposta_solicitada: [],
      proposta_enviada: [],
      exito_projetado: [],
      conversao: [],
      negada: [],
      suspensa: [],
    }

    const filtrados = filterMonth
      ? cards.filter((c) => (c.created_at || '').slice(0, 7) === filterMonth)
      : cards
    for (const card of filtrados) {
      byEtapa[card.etapa]?.push(card)
    }

    for (const etapa of Object.keys(byEtapa) as EtapaKanban[]) {
      byEtapa[etapa].sort((a, b) => {
        if (a.ordem !== b.ordem) return a.ordem - b.ordem
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      })
    }

    return byEtapa
  }, [cards, filterMonth])

  const monthOptions = useMemo(() => {
    const opts: Array<{ value: string; label: string }> = [{ value: '', label: 'Todos os meses' }]
    const now = new Date()
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      opts.push({ value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) })
    }
    return opts
  }, [])

  const totalValor = useMemo(() => cards.reduce((acc, card) => acc + Number(card.valor || 0), 0), [cards])

  const clientesOptions = useMemo(
    () => clientes.map((item) => ({ value: item.id, label: item.nome })),
    [clientes],
  )

  const servicosOptions = useMemo(
    () => servicos.map((item) => ({ value: item.id, label: item.nome })),
    [servicos],
  )

  const produtosOptions = useMemo(
    () => produtos.map((item) => ({ value: item.id, label: item.nome })),
    [produtos],
  )

  const colaboradoresOptions = useMemo(
    () => colaboradores.map((item) => ({ value: item.id, label: item.nome })),
    [colaboradores],
  )

  const areasOptions = useMemo(
    () => areas.map((item) => ({ value: item.id, label: item.nome })),
    [areas],
  )

  const resetDialog = () => {
    setForm(emptyForm)
    setExistingAnexos([])
    setRemoveAnexoIds([])
    setNewAnexos([])
  }

  const handleOpenCreate = (etapa: EtapaKanban = 'prospeccao') => {
    resetDialog()
    setForm({ ...emptyForm, etapa })
    setDialogOpen(true)
  }

  const handleOpenEdit = (card: PipelineCard) => {
    setForm({
      id: card.id,
      cliente_id: card.cliente_id,
      servico_id: card.servico_id || '',
      produto_id: card.produto_id || '',
      valor: String(card.valor || 0),
      responsavel_interno_id: card.responsavel_interno_id || '',
      area_id: card.area_id || '',
      observacoes: card.observacoes || '',
      etapa: card.etapa,
      data_card: card.data_card || '',
      valor_global: card.valor_global ? String(card.valor_global) : '',
      forma_pagamento: card.forma_pagamento || '',
      valor_caixa_mes: card.valor_caixa_mes ? String(card.valor_caixa_mes) : '',
      valor_futuro_projetado: card.valor_futuro_projetado ? String(card.valor_futuro_projetado) : '',
    })
    setExistingAnexos(card.anexos || [])
    setRemoveAnexoIds([])
    setNewAnexos([])
    setDialogOpen(true)
  }

  const handleSelectAnexoFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return
    const incoming = Array.from(files).map((file) => ({
      id: `${Date.now()}-${file.name}-${Math.random().toString(36).slice(2)}`,
      nome: file.name,
      file,
    }))
    setNewAnexos((prev) => [...prev, ...incoming])
  }

  const toggleRemoveExistingAnexo = (anexo: PipelineAnexo) => {
    setRemoveAnexoIds((prev) =>
      prev.includes(anexo.id) ? prev.filter((id) => id !== anexo.id) : [...prev, anexo.id],
    )
  }

  const updateNewAnexoName = (id: string, nome: string) => {
    setNewAnexos((prev) => prev.map((item) => (item.id === id ? { ...item, nome } : item)))
  }

  const removeNewAnexo = (id: string) => {
    setNewAnexos((prev) => prev.filter((item) => item.id !== id))
  }

  const resetSolicitacaoDialog = () => {
    setSolicitacaoCardId('')
    setSolicitacaoNome('')
    setSolicitacaoDescricao('')
    setSolicitacaoClienteId('')
    setSolicitacaoCentroCustoId('')
    setSolicitacaoAnexos([])
  }

  const openSolicitacaoDialog = (card: PipelineCard) => {
    const nome = [card.cliente_nome, card.servico_nome || card.produto_nome || 'Proposta comercial'].filter(Boolean).join(' - ')
    resetSolicitacaoDialog()
    setSolicitacaoCardId(card.id)
    setSolicitacaoNome(nome)
    setSolicitacaoDescricao(card.observacoes || 'Solicitação criada via CRM (conversão).')
    setSolicitacaoClienteId(card.cliente_id || '')
    setSolicitacaoOpen(true)
  }

  const handleSelectSolicitacaoFiles = (files: FileList | null) => {
    if (!files?.length) return
    const nextFiles = Array.from(files).map((file) => ({ nome: file.name, file }))
    setSolicitacaoAnexos((prev) => [...prev, ...nextFiles])
  }

  const createClienteOnDemand = async (
    nomeCliente: string,
    onCreated?: (clienteId: string) => void,
    setCreating?: (value: boolean) => void,
  ) => {
    const nome = nomeCliente.trim()
    if (!nome) return

    try {
      setCreating?.(true)
      const session = await getSession()
      if (!session) return

      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/create-cliente`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          nome,
          cliente_estrangeiro: true,
          tipo: 'pessoa_juridica',
        }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        toastError(payload.error || 'Erro ao criar cliente')
        return
      }

      const clienteId = payload?.data?.cliente?.id as string | undefined
      await fetchClientes()

      if (clienteId) {
        onCreated?.(clienteId)
      }

      success('Cliente criado com sucesso')
    } catch (err) {
      console.error(err)
      toastError('Erro ao criar cliente')
    } finally {
      setCreating?.(false)
    }
  }

  const createSolicitacao = async () => {
    try {
      setSolicitacaoSubmitting(true)
      const session = await getSession()
      if (!session) return

      const anexosPayload =
        solicitacaoAnexos.length === 0
          ? []
          : await Promise.all(
              solicitacaoAnexos.map(async (item) => ({
                nome: item.nome.trim() || item.file.name,
                arquivo_nome: item.file.name,
                mime_type: item.file.type || 'application/octet-stream',
                tamanho_bytes: item.file.size,
                arquivo_base64: await fileToBase64(item.file),
              })),
            )

      // Daily 04/05 22:03: solicitação NÃO cria contrato auto. Bypassa o edge
      // (fallback defensivo criava contrato). Chama RPC direto.
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: rpcData, error: rpcError } = await supabase.rpc('create_solicitacao_contrato', {
        p_user_id: user.id,
        p_payload: {
          nome: solicitacaoNome.trim(),
          descricao: solicitacaoDescricao.trim(),
          cliente_id: solicitacaoClienteId || null,
          centro_custo_id: solicitacaoCentroCustoId || null,
          anexos: anexosPayload.length ? anexosPayload : undefined,
        },
      })

      if (rpcError) {
        toastError(rpcError.message || 'Erro ao criar solicitação')
        return
      }

      const solicitacaoId =
        rpcData && typeof (rpcData as Record<string, unknown>).id === 'string'
          ? ((rpcData as Record<string, unknown>).id as string)
          : ''
      if (solicitacaoCardId && solicitacaoId) {
        await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/update-crm-pipeline-card`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            id: solicitacaoCardId,
            converted_solicitacao_id: solicitacaoId,
          }),
        }).catch((err) => {
          console.warn('Não foi possível vincular a solicitação ao card do CRM:', err)
        })
      }

      success('Solicitação criada com sucesso')
      setSolicitacaoOpen(false)
      resetSolicitacaoDialog()
      await fetchPipeline()
    } catch (err) {
      console.error(err)
      toastError('Erro ao criar solicitação')
    } finally {
      setSolicitacaoSubmitting(false)
    }
  }

  const submitCard = async () => {
    if (!form.cliente_id) {
      toastError('Cliente é obrigatório')
      return
    }

    try {
      setSaving(true)
      const session = await getSession()
      if (!session) return

      const anexosPayload = await Promise.all(
        newAnexos.map(async (item) => ({
          nome: item.nome.trim() || item.file.name,
          arquivo_nome: item.file.name,
          mime_type: item.file.type || 'application/octet-stream',
          tamanho_bytes: item.file.size,
          arquivo_base64: await fileToBase64(item.file),
        })),
      )

      const payload = {
        cliente_id: form.cliente_id,
        servico_id: form.servico_id || null,
        produto_id: form.produto_id || null,
        valor: form.valor || '0',
        responsavel_interno_id: form.responsavel_interno_id || null,
        area_id: form.area_id || null,
        observacoes: form.observacoes || '',
        etapa: form.etapa,
        data_card: form.data_card || '',
        valor_global: form.valor_global || '0',
        forma_pagamento: form.forma_pagamento || '',
        valor_caixa_mes: form.valor_caixa_mes || '0',
        valor_futuro_projetado: form.valor_futuro_projetado || '0',
        anexos: anexosPayload,
        remove_anexo_ids: removeAnexoIds,
      }

      const endpoint = form.id ? 'update-crm-pipeline-card' : 'create-crm-pipeline-card'
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/${endpoint}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(form.id ? { id: form.id, ...payload } : payload),
      })

      const responsePayload = await response.json().catch(() => ({}))
      if (!response.ok) {
        toastError(responsePayload.error || 'Erro ao salvar card')
        return
      }

      success(form.id ? 'Card atualizado' : 'Card criado')
      setDialogOpen(false)
      resetDialog()
      await fetchPipeline()
    } catch (err) {
      console.error(err)
      toastError('Erro ao salvar card')
    } finally {
      setSaving(false)
    }
  }

  const handleMoveCard = async (cardId: string, etapa: EtapaKanban) => {
    try {
      setMovingCardId(cardId)
      const session = await getSession()
      if (!session) return

      const ordem = (cardsByEtapa[etapa] || []).length + 1

      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/move-crm-pipeline-card`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id: cardId, etapa, ordem }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        toastError(payload.error || 'Erro ao mover card')
        return
      }

      await fetchPipeline()
    } catch (err) {
      console.error(err)
      toastError('Erro ao mover card')
    } finally {
      setMovingCardId(null)
    }
  }

  const handleDownloadAnexo = async (anexoId: string) => {
    try {
      const session = await getSession()
      if (!session) return

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-crm-pipeline-anexo?id=${anexoId}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
        },
      )

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        toastError(payload.error || 'Erro ao baixar anexo')
        return
      }

      const anexo = payload.data
      if (!anexo?.arquivo_base64) {
        toastError('Arquivo não encontrado')
        return
      }

      const blob = base64ToBlob(anexo.arquivo_base64, anexo.mime_type)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = anexo.arquivo_nome || 'anexo.bin'
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error(err)
      toastError('Erro ao baixar anexo')
    }
  }

  const goToSolicitacaoContrato = (card: PipelineCard) => {
    openSolicitacaoDialog(card)
  }

  if (!canRead) {
    return (
      <Alert className="border border-destructive/30 bg-destructive/10 text-destructive">
        <AlertTitle>Sem permissão</AlertTitle>
        <AlertDescription>Você não tem permissão para visualizar o módulo CRM.</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-white p-4">
        <div>
          <h2 className="text-lg font-semibold text-ink">Pipeline de CRM</h2>
          <p className="text-sm text-ink-mute">Total de cards: {cards.length} • Valor potencial: {formatMoney(totalValor)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect
            value={filterMonth}
            onChange={(e) => setFilterMonth(e.target.value)}
            className="h-9 rounded-md border px-2 text-sm capitalize"
            title="Filtrar por mês de cadastro do card"
          >
            {monthOptions.map((m) => (
              <option key={m.value || 'all'} value={m.value}>{m.label}</option>
            ))}
          </NativeSelect>
          <Button variant="outline" onClick={() => void loadAll()} disabled={loading}>
            Atualizar
          </Button>
          {canWrite ? (
            <>
              <Button variant="outline" onClick={() => router.push('/pessoas/clientes/novo')}>
                <UserPlus className="mr-2 h-4 w-4" /> Novo cliente
              </Button>
              <Button onClick={() => handleOpenCreate('prospeccao')}>
                <Plus className="mr-2 h-4 w-4" /> Novo card
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {error ? (
        <Alert className="border border-destructive/30 bg-destructive/10 text-destructive">
          <AlertTitle>Erro</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="overflow-x-auto pb-2">
        <div className="grid min-w-[1900px] grid-cols-8 gap-4">
          {ETAPAS.map((etapa) => {
            const etapaCards = cardsByEtapa[etapa.key] || []
            return (
              <div
                key={etapa.key}
                className="rounded-lg border bg-canvas-soft p-3"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault()
                  if (!canWrite) return
                  const cardId = event.dataTransfer.getData('text/plain')
                  if (!cardId) return
                  void handleMoveCard(cardId, etapa.key)
                }}
              >
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-ink-secondary">{etapa.label}</h3>
                  <Badge className="border-hairline bg-canvas-soft text-ink-secondary">{etapaCards.length}</Badge>
                </div>

                <div className="space-y-2">
                  {etapaCards.map((card) => (
                    <div
                      key={card.id}
                      draggable={canWrite}
                      onDragStart={(event) => {
                        event.dataTransfer.setData('text/plain', card.id)
                        event.dataTransfer.effectAllowed = 'move'
                      }}
                      className="rounded-md border bg-white p-3 shadow-sm transition hover:shadow"
                    >
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <button
                          type="button"
                          className="min-w-0 text-left"
                          onClick={() => handleOpenEdit(card)}
                        >
                          <p className="truncate text-sm font-semibold text-ink">{card.cliente_nome}</p>
                          <p className="truncate text-xs text-ink-mute">{card.segmento_nome || 'Sem segmento'}</p>
                        </button>
                        {canWrite ? <GripVertical className="h-4 w-4 shrink-0 text-ink-mute" /> : null}
                      </div>

                      <div className="space-y-1 text-xs text-ink-mute">
                        <p className="truncate">{areas.find((a) => a.id === card.area_id)?.nome || 'Sem centro de custo'}</p>
                        <p className="truncate">{[card.servico_nome, card.produto_nome].filter(Boolean).join(' • ') || 'Sem serviço/produto'}</p>
                        {card.data_card ? <p className="truncate">{new Date(card.data_card + 'T00:00:00').toLocaleDateString('pt-BR')}</p> : null}
                        <p className="font-medium text-ink">{formatMoney(card.valor)}</p>
                        {card.valor_global ? <p className="truncate">Global: {formatMoney(card.valor_global)} {card.forma_pagamento ? `· ${card.forma_pagamento === 'a_vista' ? 'à vista' : 'parcelado'}` : ''}</p> : null}
                        {card.valor_caixa_mes ? <p className="truncate">Caixa no mês: {formatMoney(card.valor_caixa_mes)}</p> : null}
                        {card.valor_futuro_projetado ? <p className="truncate">Futuro projetado: {formatMoney(card.valor_futuro_projetado)}</p> : null}

                        <div>
                          <div className="flex items-center justify-between">
                            <span>Temperatura</span>
                            <span className="font-medium text-ink">{card.temperatura_pct != null ? `${card.temperatura_pct}%` : '—'}</span>
                          </div>
                          <div className="mt-1 h-1.5 rounded-full bg-secondary">
                            <div className="h-1.5 rounded-full" style={{ width: `${card.temperatura_pct ?? 0}%`, backgroundColor: tempColor(card.temperatura_pct) }} />
                          </div>
                          {canWrite ? (
                            <input
                              type="range"
                              min={0}
                              max={100}
                              step={5}
                              value={card.temperatura_pct ?? 0}
                              onChange={(event) => void handleSetTemperaturaPct(card.id, Number(event.target.value))}
                              className="mt-1 w-full"
                              title="Temperatura de fechamento (%)"
                            />
                          ) : null}
                        </div>

                        <p className="truncate">
                          <UserRound className="mr-1 inline h-3 w-3" />
                          {card.responsavel_interno_nome || 'Sem responsável'}
                        </p>
                        <p className="truncate">{[card.cidade, card.estado].filter(Boolean).join(' / ') || 'Sem cidade'}</p>
                        {card.observacoes ? <p className="line-clamp-2 whitespace-pre-wrap">{card.observacoes}</p> : null}
                        {card.anexos?.length ? <p>{card.anexos.length} anexo(s)</p> : null}
                        <p className="text-[11px] text-ink-mute">Atualizado em {formatDateTime(card.updated_at)}</p>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-1">
                        {canWrite ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs"
                            onClick={() => handleOpenEdit(card)}
                          >
                            <Edit3 className="mr-1 h-3 w-3" /> Editar
                          </Button>
                        ) : null}

                        {card.etapa === 'conversao' ? (
                          <Button
                            size="sm"
                            className="h-7 px-2 text-xs"
                            variant="secondary"
                            onClick={() => goToSolicitacaoContrato(card)}
                          >
                            <MoveRight className="mr-1 h-3 w-3" /> Solicitar contrato
                          </Button>
                        ) : null}

                        {canWrite ? (
                          <NativeSelect
                            value={card.etapa}
                            onChange={(event) => void handleMoveCard(card.id, event.target.value as EtapaKanban)}
                            className="h-7 rounded border px-2 text-xs"
                            disabled={movingCardId === card.id}
                          >
                            {ETAPAS.map((item) => (
                              <option key={item.key} value={item.key}>
                                {item.label}
                              </option>
                            ))}
                          </NativeSelect>
                        ) : null}
                      </div>
                    </div>
                  ))}

                  {etapaCards.length === 0 ? (
                    <div className="rounded-md border border-dashed bg-white/70 p-4 text-center text-xs text-ink-mute">
                      Nenhum card nesta etapa
                    </div>
                  ) : null}

                  {canWrite ? (
                    <Button
                      type="button"
                      variant="ghost"
                      className="w-full justify-start text-xs"
                      onClick={() => handleOpenCreate(etapa.key)}
                    >
                      <Plus className="mr-1 h-3 w-3" /> Adicionar em {etapa.label}
                    </Button>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={(open) => {
        setDialogOpen(open)
        if (!open) resetDialog()
      }}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form.id ? 'Editar card CRM' : 'Novo card CRM'}</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* 1. Cliente */}
            <div className="space-y-2">
              <Label>Cliente *</Label>
              <CommandSelect
                value={form.cliente_id}
                onValueChange={(value) => setForm((prev) => ({ ...prev, cliente_id: value }))}
                options={clientesOptions}
                placeholder="Selecione o cliente"
                searchPlaceholder="Buscar cliente..."
                emptyText="Nenhum cliente encontrado."
                onCreateOption={
                  canWrite
                    ? (value) =>
                        void createClienteOnDemand(value, (clienteId) => {
                          setForm((prev) => ({ ...prev, cliente_id: clienteId }))
                        })
                    : undefined
                }
                createOptionLabel="Criar cliente"
                disabled={saving}
                maxVisibleOptions={7}
              />
            </div>

            {/* 2. Segmento econômico (do cliente, somente leitura) */}
            <div className="space-y-2">
              <Label>Segmento econômico</Label>
              <div className="flex h-10 items-center rounded-md border bg-canvas-soft px-3 text-sm text-ink-secondary">
                {clientesInfo[form.cliente_id]?.segmento_nome || '— (definido no cadastro do cliente)'}
              </div>
            </div>

            {/* 3. Centro de custo */}
            <div className="space-y-2">
              <Label>Centro de custo</Label>
              <CommandSelect
                value={form.area_id}
                onValueChange={(value) => setForm((prev) => ({ ...prev, area_id: value }))}
                options={areasOptions}
                placeholder="Selecione o centro de custo"
                searchPlaceholder="Buscar área..."
                emptyText="Nenhuma área encontrada."
                disabled={saving}
                maxVisibleOptions={7}
              />
            </div>

            {/* 4. Serviço */}
            <div className="space-y-2">
              <Label>Serviço</Label>
              <CommandSelect
                value={form.servico_id}
                onValueChange={(value) => setForm((prev) => ({ ...prev, servico_id: value }))}
                options={servicosOptions}
                placeholder="Selecione o serviço"
                searchPlaceholder="Buscar serviço..."
                emptyText="Nenhum serviço encontrado."
                disabled={saving}
                maxVisibleOptions={7}
              />
            </div>

            {/* 5. Produto */}
            <div className="space-y-2">
              <Label>Produto</Label>
              <CommandSelect
                value={form.produto_id}
                onValueChange={(value) => setForm((prev) => ({ ...prev, produto_id: value }))}
                options={produtosOptions}
                placeholder="Selecione o produto"
                searchPlaceholder="Buscar produto..."
                emptyText="Nenhum produto encontrado."
                disabled={saving}
                maxVisibleOptions={7}
              />
            </div>

            {/* 6. Valor */}
            <div className="space-y-2">
              <Label>Valor</Label>
              <MoneyInput
                value={form.valor}
                onValueChange={(value) => setForm((prev) => ({ ...prev, valor: value }))}
                placeholder="0,00"
                disabled={saving}
              />
            </div>

            {/* Data do card */}
            <div className="space-y-2">
              <Label>Data</Label>
              <Input
                type="date"
                value={form.data_card}
                onChange={(e) => setForm((prev) => ({ ...prev, data_card: e.target.value }))}
                disabled={saving}
              />
            </div>

            {/* Valor global */}
            <div className="space-y-2">
              <Label>Valor global</Label>
              <MoneyInput value={form.valor_global} onValueChange={(v) => setForm((prev) => ({ ...prev, valor_global: v }))} placeholder="0,00" disabled={saving} />
            </div>

            {/* Forma de pagamento */}
            <div className="space-y-2">
              <Label>Forma de pagamento</Label>
              <NativeSelect value={form.forma_pagamento} onChange={(e) => setForm((prev) => ({ ...prev, forma_pagamento: e.target.value }))} className="h-10 rounded-md border px-3" disabled={saving}>
                <option value="">—</option>
                <option value="a_vista">À vista</option>
                <option value="parcelado">Parcelado</option>
              </NativeSelect>
            </div>

            {/* Valor em caixa no mês */}
            <div className="space-y-2">
              <Label>Valor em caixa no mês</Label>
              <MoneyInput value={form.valor_caixa_mes} onValueChange={(v) => setForm((prev) => ({ ...prev, valor_caixa_mes: v }))} placeholder="0,00" disabled={saving} />
            </div>

            {/* Valor futuro projetado */}
            <div className="space-y-2">
              <Label>Valor futuro projetado</Label>
              <MoneyInput value={form.valor_futuro_projetado} onValueChange={(v) => setForm((prev) => ({ ...prev, valor_futuro_projetado: v }))} placeholder="0,00" disabled={saving} />
            </div>

            {/* 7. Fase */}
            <div className="space-y-2">
              <Label>Fase</Label>
              <NativeSelect
                value={form.etapa}
                onChange={(event) => setForm((prev) => ({ ...prev, etapa: event.target.value as EtapaKanban }))}
                className="h-10 rounded-md border px-3"
                disabled={!canWrite || saving}
              >
                {ETAPAS.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label}
                  </option>
                ))}
              </NativeSelect>
            </div>

            {/* 9. Responsável */}
            <div className="space-y-2">
              <Label>Responsável interno</Label>
              <CommandSelect
                value={form.responsavel_interno_id}
                onValueChange={(value) => setForm((prev) => ({ ...prev, responsavel_interno_id: value }))}
                options={colaboradoresOptions}
                placeholder="Selecione o responsável"
                searchPlaceholder="Buscar colaborador..."
                emptyText="Nenhum colaborador encontrado."
                disabled={saving}
                maxVisibleOptions={7}
              />
            </div>

            {/* 10. Cidade (do cliente, somente leitura) */}
            <div className="space-y-2">
              <Label>Cidade</Label>
              <div className="flex h-10 items-center rounded-md border bg-canvas-soft px-3 text-sm text-ink-secondary">
                {[clientesInfo[form.cliente_id]?.cidade, clientesInfo[form.cliente_id]?.estado].filter(Boolean).join(' / ') || '— (definida no cadastro do cliente)'}
              </div>
            </div>
          </div>

          {/* 8. Temperatura de fechamento — ajustável pela barra no card */}
          <p className="text-xs text-ink-mute">
            Temperatura de fechamento: ajuste pela barra de 0–100% no card{form.id ? '' : ' (após salvar)'}.
          </p>

          <div className="space-y-2">
            <Label>Observações</Label>
            <Textarea
              value={form.observacoes}
              onChange={(event) => setForm((prev) => ({ ...prev, observacoes: event.target.value }))}
              rows={4}
              placeholder="Detalhes da oportunidade, próximos passos, objeções etc."
              disabled={saving}
            />
          </div>

          <div className="space-y-3 rounded-md border p-3">
            <div className="flex items-center justify-between">
              <Label>Anexos</Label>
              <Input
                type="file"
                onChange={(event) => handleSelectAnexoFiles(event.target.files)}
                disabled={saving}
                multiple
                className="max-w-xs"
              />
            </div>

            {existingAnexos.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-medium text-ink-secondary">Anexos já enviados</p>
                {existingAnexos.map((anexo) => {
                  const markedToRemove = removeAnexoIds.includes(anexo.id)
                  return (
                    <div key={anexo.id} className="flex items-center justify-between gap-2 rounded border px-2 py-1 text-xs">
                      <div className="min-w-0">
                        <p className={`truncate font-medium ${markedToRemove ? 'line-through text-ink-mute' : ''}`}>{anexo.nome}</p>
                        <p className="truncate text-ink-mute">{anexo.arquivo_nome}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2"
                          onClick={() => void handleDownloadAnexo(anexo.id)}
                        >
                          <Download className="h-3 w-3" />
                        </Button>
                        {canWrite ? (
                          <Button
                            type="button"
                            variant={markedToRemove ? 'default' : 'outline'}
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => toggleRemoveExistingAnexo(anexo)}
                          >
                            {markedToRemove ? 'Desfazer' : 'Remover'}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : null}

            {newAnexos.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-medium text-ink-secondary">Novos anexos</p>
                {newAnexos.map((anexo) => (
                  <div key={anexo.id} className="grid grid-cols-1 gap-2 rounded border p-2 md:grid-cols-[1fr_auto]">
                    <div className="space-y-1">
                      <Label className="text-xs">Nome do anexo</Label>
                      <Input
                        value={anexo.nome}
                        onChange={(event) => updateNewAnexoName(anexo.id, event.target.value)}
                        disabled={saving}
                        className="h-8"
                      />
                      <p className="truncate text-xs text-ink-mute">{anexo.file.name}</p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={() => removeNewAnexo(anexo.id)}
                    >
                      Remover
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-ink-mute">Nenhum novo anexo selecionado.</p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button type="button" onClick={() => void submitCard()} disabled={saving}>
              {saving ? 'Salvando...' : form.id ? 'Salvar alterações' : 'Criar card'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={solicitacaoOpen} onOpenChange={(open) => {
        if (!solicitacaoSubmitting) {
          setSolicitacaoOpen(open)
          if (!open) resetSolicitacaoDialog()
        }
      }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Nova solicitação de abertura de contrato</DialogTitle>
          </DialogHeader>

          <SolicitacaoContratoFormFields
            areasOptions={areasOptions}
            centroCustoId={solicitacaoCentroCustoId}
            clientesOptions={clientesOptions}
            creatingCliente={creatingSolicitacaoCliente}
            descricaoSolicitacao={solicitacaoDescricao}
            disabled={solicitacaoSubmitting}
            nomeSolicitacao={solicitacaoNome}
            onAddFiles={handleSelectSolicitacaoFiles}
            onCentroCustoChange={setSolicitacaoCentroCustoId}
            onCreateCliente={
              canWrite
                ? (value) =>
                    void createClienteOnDemand(
                      value,
                      (clienteId) => setSolicitacaoClienteId(clienteId),
                      setCreatingSolicitacaoCliente,
                    )
                : undefined
            }
            onDescricaoSolicitacaoChange={setSolicitacaoDescricao}
            onNomeSolicitacaoChange={setSolicitacaoNome}
            onRemovePendingAnexo={(index) => setSolicitacaoAnexos((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}
            onSelectedClienteIdChange={setSolicitacaoClienteId}
            pendingAnexos={solicitacaoAnexos}
            selectedClienteId={solicitacaoClienteId}
          />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSolicitacaoOpen(false)} disabled={solicitacaoSubmitting}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void createSolicitacao()} disabled={solicitacaoSubmitting}>
              {solicitacaoSubmitting ? 'Salvando...' : 'Criar solicitação'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
