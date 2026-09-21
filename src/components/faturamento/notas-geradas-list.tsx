'use client'

import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { Ban, Copy, Loader2, RefreshCw, Search } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { copiarTexto, formatarLinhaDigitavel } from '@/lib/utils/boleto-ficha'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CommandSelect, type CommandSelectOption } from '@/components/ui/command-select'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { Table } from '@/components/ui/table'
import { useToast } from '@/components/ui/toast'

interface NotaGerada {
  id: string
  numero: number | null
  status: 'gerado' | 'cancelado' | string
  tipo_documento: 'boleto_itau' | 'relatorio_honorarios' | 'nota_fiscal_servico' | string
  arquivo_nome: string | null
  arquivo_url: string | null
  metadata: Record<string, unknown> | null
  created_at: string
  batch_numero: number | null
  contrato_numero: number | null
  contrato_nome: string | null
  caso_numero: number | null
  caso_nome: string | null
  // Campos da RPC get_notas_geradas (migration 20260921120000). Ficam
  // opcionais porque a edge ainda tem o fallback sem eles.
  cliente_id?: string | null
  cliente_nome?: string | null
  tomador_nome?: string | null
  valor_total?: number | string | null
  vencimento?: string | null
  lancamento_status?: string | null
  lancamento_vencimento?: string | null
  lancamento_valor?: number | string | null
  boleto_status?: string | null
  linha_digitavel?: string | null
  competencia?: string | null
}

const tipoDocumentoOptions = [
  { value: '', label: 'Todos os tipos' },
  { value: 'boleto_itau', label: 'Boleto Itaú' },
  { value: 'relatorio_honorarios', label: 'Relatório de honorários' },
  { value: 'nota_fiscal_servico', label: 'Nota fiscal de serviço' },
]

const statusOptions = [
  { value: '', label: 'Todos os status' },
  { value: 'gerado', label: 'Gerado' },
  { value: 'cancelado', label: 'Cancelado' },
]

function formatDateTime(value: string | null | undefined) {
  if (!value) return '-'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDate(value: string | null | undefined) {
  if (!value) return '-'
  // Data pura (YYYY-MM-DD) vinda do banco: sem fuso, senao vira o dia anterior.
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (match) return `${match[3]}/${match[2]}/${match[1]}`
  return formatDateTime(value)
}

function formatCompetencia(value: string | null | undefined) {
  if (!value) return '-'
  const match = /^(\d{4})-(\d{2})/.exec(value)
  return match ? `${match[2]}/${match[1]}` : value
}

function formatMoney(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') return '-'
  const parsed = typeof value === 'number' ? value : Number(value)
  if (Number.isNaN(parsed)) return '-'
  return parsed.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// Situacao da conta a receber (finance.lancamentos) e do boleto (finance.boletos).
const lancamentoStatusLabels: Record<string, string> = {
  pendente: 'A receber',
  agendado: 'Agendado',
  atrasado: 'Atrasado',
  recebido: 'Recebido',
  pago: 'Recebido',
  cancelado: 'Cancelado',
}

function getLancamentoBadgeClass(status: string) {
  if (status === 'recebido' || status === 'pago') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (status === 'cancelado' || status === 'atrasado') return 'border-red-200 bg-red-50 text-red-700'
  return 'border-amber-200 bg-amber-50 text-amber-700'
}

const boletoStatusLabels: Record<string, string> = {
  preparado: 'Boleto preparado',
  registrado: 'Boleto registrado',
  erro: 'Boleto com erro',
  liquidado: 'Boleto liquidado',
  baixado: 'Boleto baixado',
}

function getBoletoBadgeClass(status: string) {
  if (status === 'registrado' || status === 'liquidado') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (status === 'erro') return 'border-red-200 bg-red-50 text-red-700'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function getTipoDocumentoLabel(value: string) {
  const option = tipoDocumentoOptions.find((item) => item.value === value)
  return option?.label || value || '-'
}

function getStatusLabel(value: string) {
  if (value === 'gerado') return 'Gerado'
  if (value === 'cancelado') return 'Cancelado'
  return value || '-'
}

const nfseStatusLabels: Record<string, string> = {
  processando_autorizacao: 'NFS-e em processamento',
  autorizado: 'NFS-e autorizada',
  erro_autorizacao: 'NFS-e rejeitada',
  cancelado: 'NFS-e cancelada',
}

function getNfseStatus(note: NotaGerada): string | null {
  if (note.tipo_documento !== 'nota_fiscal_servico') return null
  const consulta = note.metadata?.nfse_consulta as { status?: string } | undefined
  return consulta?.status || null
}

function getNfseStatusBadgeClass(status: string) {
  if (status === 'autorizado') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (status === 'erro_autorizacao' || status === 'cancelado') return 'border-red-200 bg-red-50 text-red-700'
  return 'border-amber-200 bg-amber-50 text-amber-700'
}

function getContratoLabel(note: NotaGerada) {
  if (note.contrato_numero) return `Contrato ${note.contrato_numero}${note.contrato_nome ? ` - ${note.contrato_nome}` : ''}`
  return note.contrato_nome || 'Contrato não informado'
}

function getCasoLabel(note: NotaGerada) {
  if (note.caso_numero) return `Caso ${note.caso_numero}${note.caso_nome ? ` - ${note.caso_nome}` : ''}`
  return note.caso_nome || ''
}

// Nº da NFS-e devolvido pela prefeitura, quando ja consultada.
function getNumeroNfse(note: NotaGerada): string | null {
  const consulta = note.metadata?.nfse_consulta as { numero_nfse?: string | number } | undefined
  return consulta?.numero_nfse ? String(consulta.numero_nfse) : null
}

export default function NotasGeradasList() {
  const { toast: notify } = useToast()
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notes, setNotes] = useState<NotaGerada[]>([])
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [tipoDocumento, setTipoDocumento] = useState('')
  const [clienteId, setClienteId] = useState('')
  const [mes, setMes] = useState('')
  // Clientes vistos nas notas carregadas. Acumula entre cargas: filtrar por
  // um cliente nao pode fazer os outros sumirem da lista de opcoes.
  const [clientesConhecidos, setClientesConhecidos] = useState<Record<string, string>>({})
  const [refreshingNfse, setRefreshingNfse] = useState(false)
  const [cancelingId, setCancelingId] = useState<string | null>(null)

  const loadNotes = async (isRefresh = false) => {
    try {
      if (isRefresh) setSubmitting(true)
      else setLoading(true)
      setError(null)

      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session) return

      const params = new URLSearchParams()
      if (search.trim()) params.set('search', search.trim())
      if (status) params.set('status', status)
      if (tipoDocumento) params.set('tipo_documento', tipoDocumento)
      if (clienteId) params.set('cliente_id', clienteId)
      if (mes) params.set('mes', mes)
      params.set('limit', '200')

      const query = params.toString()
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-notas-geradas${query ? `?${query}` : ''}`,
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
        setError(payload.error || 'Erro ao carregar notas geradas')
        setNotes([])
        return
      }

      const rows = (payload.data || []) as NotaGerada[]
      setNotes(rows)
      setClientesConhecidos((prev) => {
        const next = { ...prev }
        for (const row of rows) {
          if (row.cliente_id && row.cliente_nome) next[row.cliente_id] = row.cliente_nome
        }
        return next
      })
    } catch (err) {
      console.error(err)
      setError('Erro ao carregar notas geradas')
      setNotes([])
    } finally {
      setLoading(false)
      setSubmitting(false)
    }
  }

  useEffect(() => {
    void loadNotes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const totals = useMemo(
    () =>
      notes.reduce(
        (acc, note) => {
          acc.total += 1
          if (note.status === 'cancelado') acc.canceladas += 1
          return acc
        },
        { total: 0, canceladas: 0 },
      ),
    [notes],
  )

  const clienteOptions = useMemo<CommandSelectOption[]>(
    () => [
      { value: '', label: 'Todos os clientes' },
      ...Object.entries(clientesConhecidos)
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')),
    ],
    [clientesConhecidos],
  )

  const copiar = async (texto: string, rotulo: string) => {
    notify((await copiarTexto(texto)) ? `${rotulo} copiada.` : 'O navegador não deixou copiar. Selecione o texto e copie.')
  }

  const handleSubmitFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void loadNotes(true)
  }

  const handleRefreshNfse = async () => {
    try {
      setRefreshingNfse(true)
      setError(null)

      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session) return

      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/consultar-nfse`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      })
      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        setError(payload.error || 'Erro ao atualizar status das NFS-e')
        return
      }

      await loadNotes(true)
    } catch (err) {
      console.error(err)
      setError('Erro ao atualizar status das NFS-e')
    } finally {
      setRefreshingNfse(false)
    }
  }

  const handleCancelNfse = async (note: NotaGerada) => {
    const autorizada = getNfseStatus(note) === 'autorizado'
    const aviso = autorizada
      ? 'Esta NFS-e foi AUTORIZADA pela prefeitura. O cancelamento é fiscal e irreversível. Informe a justificativa:'
      : 'Esta nota será marcada como cancelada no sistema. Informe a justificativa:'
    const justificativa = window.prompt(aviso, 'Cancelamento solicitado pelo prestador (emissão indevida).')
    if (justificativa === null) return

    try {
      setCancelingId(note.id)
      setError(null)

      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session) return

      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/cancelar-nfse`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ nota_id: note.id, justificativa }),
      })
      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        setError(payload.error || 'Erro ao cancelar a nota')
        return
      }

      await loadNotes(true)
    } catch (err) {
      console.error(err)
      setError('Erro ao cancelar a nota')
    } finally {
      setCancelingId(null)
    }
  }

  const handleClearFilters = () => {
    setSearch('')
    setStatus('')
    setTipoDocumento('')
    setClienteId('')
    setMes('')
    setTimeout(() => {
      void loadNotes(true)
    }, 0)
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmitFilters} className="grid grid-cols-1 gap-3 rounded-lg border bg-white p-4 md:grid-cols-6">
        <div className="md:col-span-2">
          <label className="mb-1 block text-sm font-medium">Buscar</label>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Cliente, caso, contrato ou nº da nota"
          />
        </div>
        <div className="md:col-span-2">
          <label className="mb-1 block text-sm font-medium">Cliente</label>
          <CommandSelect
            value={clienteId}
            onValueChange={setClienteId}
            options={clienteOptions}
            placeholder="Todos os clientes"
            searchPlaceholder="Buscar cliente..."
            emptyText="Nenhum cliente encontrado."
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Mês de emissão</label>
          <Input type="month" value={mes} onChange={(event) => setMes(event.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Tipo de documento</label>
          <NativeSelect value={tipoDocumento} onChange={(event) => setTipoDocumento(event.target.value)}>
            {tipoDocumentoOptions.map((option) => (
              <option key={option.value || 'all'} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Status</label>
          <NativeSelect value={status} onChange={(event) => setStatus(event.target.value)}>
            {statusOptions.map((option) => (
              <option key={option.value || 'all'} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="md:col-span-6 flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={submitting}>
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
            Filtrar
          </Button>
          <Button type="button" variant="outline" onClick={handleClearFilters} disabled={submitting}>
            Limpar filtros
          </Button>
          <Button type="button" variant="outline" onClick={() => void handleRefreshNfse()} disabled={refreshingNfse || submitting}>
            {refreshingNfse ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Atualizar NFS-e
          </Button>
          <span className="text-sm text-ink-mute">
            {totals.total} nota(s) • {totals.canceladas} cancelada(s)
          </span>
        </div>
      </form>

      {error ? (
        <Alert className="border-red-300 bg-red-50 text-red-700">
          <AlertTitle>Erro ao carregar notas</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="rounded-lg border bg-white">
        <Table>
          <thead>
            <tr>
              <th className="h-10 px-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-mute">Nota</th>
              <th className="h-10 px-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-mute">Documento</th>
              <th className="h-10 px-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-mute">Status</th>
              <th className="h-10 px-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-mute">Cliente</th>
              <th className="h-10 px-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-mute">Caso</th>
              <th className="h-10 px-2 text-right text-xs font-semibold uppercase tracking-wide text-ink-mute">Valor</th>
              <th className="h-10 px-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-mute">Vencimento</th>
              <th className="h-10 px-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-mute">Cobrança</th>
              <th className="h-10 px-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-mute">Competência</th>
              <th className="h-10 px-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-mute">Arquivo</th>
              <th className="h-10 px-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-mute">Gerado em</th>
              <th className="h-10 px-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-mute">Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={12} className="px-2 py-12 text-center text-sm text-ink-mute">
                  <span className="inline-flex items-center">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Carregando notas geradas...
                  </span>
                </td>
              </tr>
            ) : notes.length === 0 ? (
              <tr>
                <td colSpan={12} className="px-2 py-12 text-center text-sm text-ink-mute">
                  Nenhuma nota encontrada para os filtros informados.
                </td>
              </tr>
            ) : (
              notes.map((note) => (
                <tr key={note.id} className="border-b last:border-0">
                  <td className="p-2">
                    <div className="font-medium">#{note.numero || '-'}</div>
                    {getNumeroNfse(note) ? <div className="text-xs text-ink-mute">NFS-e {getNumeroNfse(note)}</div> : null}
                    {note.batch_numero ? <div className="text-xs text-ink-mute">Lote #{note.batch_numero}</div> : null}
                  </td>
                  <td className="p-2">{getTipoDocumentoLabel(note.tipo_documento)}</td>
                  <td className="p-2">
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge className={note.status === 'cancelado' ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}>
                        {getStatusLabel(note.status)}
                      </Badge>
                      {(() => {
                        const nfseStatus = getNfseStatus(note)
                        if (!nfseStatus) return null
                        return (
                          <Badge className={getNfseStatusBadgeClass(nfseStatus)}>
                            {nfseStatusLabels[nfseStatus] || `NFS-e: ${nfseStatus}`}
                          </Badge>
                        )
                      })()}
                    </div>
                  </td>
                  <td className="p-2 text-sm">
                    <div className="max-w-[220px] truncate" title={note.cliente_nome || undefined}>
                      {note.cliente_nome || <span className="text-ink-mute">-</span>}
                    </div>
                    {note.tomador_nome && note.tomador_nome !== note.cliente_nome ? (
                      <div className="max-w-[220px] truncate text-xs text-ink-mute" title={note.tomador_nome}>
                        Tomador: {note.tomador_nome}
                      </div>
                    ) : null}
                  </td>
                  <td className="p-2 text-sm text-ink-secondary">
                    <div className="max-w-[260px] truncate" title={getCasoLabel(note) || undefined}>
                      {getCasoLabel(note) || <span className="text-ink-mute">-</span>}
                    </div>
                    <div className="max-w-[260px] truncate text-xs text-ink-mute" title={getContratoLabel(note)}>
                      {getContratoLabel(note)}
                    </div>
                  </td>
                  <td className="p-2 text-right text-sm font-medium tabular-nums">{formatMoney(note.valor_total)}</td>
                  <td className="p-2 text-sm tabular-nums">{formatDate(note.lancamento_vencimento || note.vencimento)}</td>
                  <td className="p-2">
                    <div className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-1">
                        {note.lancamento_status ? (
                          <Badge className={getLancamentoBadgeClass(note.lancamento_status)}>
                            {lancamentoStatusLabels[note.lancamento_status] || note.lancamento_status}
                          </Badge>
                        ) : (
                          <span className="text-xs text-ink-mute">Sem conta a receber</span>
                        )}
                        {note.boleto_status ? (
                          <Badge className={getBoletoBadgeClass(note.boleto_status)}>
                            {boletoStatusLabels[note.boleto_status] || `Boleto ${note.boleto_status}`}
                          </Badge>
                        ) : null}
                      </div>
                      {note.linha_digitavel ? (
                        <button
                          type="button"
                          onClick={() => void copiar(note.linha_digitavel!, 'Linha digitável')}
                          className="inline-flex max-w-[260px] items-center gap-1 text-left font-mono text-[11px] text-ink-secondary hover:text-ink"
                          title="Copiar linha digitável"
                        >
                          <Copy className="h-3 w-3 shrink-0" />
                          <span className="truncate">{formatarLinhaDigitavel(note.linha_digitavel)}</span>
                        </button>
                      ) : null}
                    </div>
                  </td>
                  <td className="p-2 text-sm tabular-nums">{formatCompetencia(note.competencia)}</td>
                  <td className="p-2">
                    {note.arquivo_url ? (
                      <a
                        href={note.arquivo_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 underline decoration-dotted underline-offset-2 hover:text-blue-700"
                      >
                        {note.arquivo_nome || 'Abrir arquivo'}
                      </a>
                    ) : (
                      <span className="text-ink-mute">-</span>
                    )}
                  </td>
                  <td className="p-2 text-sm text-ink-secondary">{formatDateTime(note.created_at)}</td>
                  <td className="p-2">
                    {note.tipo_documento === 'nota_fiscal_servico' && note.status !== 'cancelado' ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="border-red-200 text-red-700 hover:bg-red-50"
                        onClick={() => void handleCancelNfse(note)}
                        disabled={cancelingId !== null}
                      >
                        {cancelingId === note.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Ban className="mr-1 h-3.5 w-3.5" />}
                        Cancelar
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </div>
    </div>
  )
}
