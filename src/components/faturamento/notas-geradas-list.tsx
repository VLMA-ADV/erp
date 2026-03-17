'use client'

import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { Loader2, Search } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { Table } from '@/components/ui/table'

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

function getTipoDocumentoLabel(value: string) {
  const option = tipoDocumentoOptions.find((item) => item.value === value)
  return option?.label || value || '-'
}

function getStatusLabel(value: string) {
  if (value === 'gerado') return 'Gerado'
  if (value === 'cancelado') return 'Cancelado'
  return value || '-'
}

function formatMetadata(metadata: Record<string, unknown> | null) {
  if (!metadata || typeof metadata !== 'object') return '-'
  const entries = Object.entries(metadata)
  if (entries.length === 0) return '-'
  return entries
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(' | ')
}

function getContractCaseLabel(note: NotaGerada) {
  const contrato = note.contrato_numero
    ? `Contrato ${note.contrato_numero}${note.contrato_nome ? ` - ${note.contrato_nome}` : ''}`
    : note.contrato_nome || 'Contrato não informado'
  const caso = note.caso_numero ? `Caso ${note.caso_numero}${note.caso_nome ? ` - ${note.caso_nome}` : ''}` : note.caso_nome || ''
  if (!caso) return contrato
  return `${contrato} • ${caso}`
}

export default function NotasGeradasList() {
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notes, setNotes] = useState<NotaGerada[]>([])
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [tipoDocumento, setTipoDocumento] = useState('')

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

      setNotes((payload.data || []) as NotaGerada[])
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

  const handleSubmitFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void loadNotes(true)
  }

  const handleClearFilters = () => {
    setSearch('')
    setStatus('')
    setTipoDocumento('')
    setTimeout(() => {
      void loadNotes(true)
    }, 0)
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmitFilters} className="grid grid-cols-1 gap-3 rounded-lg border bg-white p-4 md:grid-cols-4">
        <div className="md:col-span-2">
          <label className="mb-1 block text-sm font-medium">Buscar</label>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Número da nota, contrato, caso, lote ou arquivo"
          />
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
        <div className="md:col-span-4 flex items-center gap-2">
          <Button type="submit" disabled={submitting}>
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
            Filtrar
          </Button>
          <Button type="button" variant="outline" onClick={handleClearFilters} disabled={submitting}>
            Limpar filtros
          </Button>
          <span className="text-sm text-gray-500">
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
              <th className="h-10 px-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Nota</th>
              <th className="h-10 px-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Documento</th>
              <th className="h-10 px-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Status</th>
              <th className="h-10 px-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Contrato / Caso</th>
              <th className="h-10 px-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Lote</th>
              <th className="h-10 px-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Arquivo</th>
              <th className="h-10 px-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Metadados</th>
              <th className="h-10 px-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Gerado em</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-2 py-12 text-center text-sm text-gray-500">
                  <span className="inline-flex items-center">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Carregando notas geradas...
                  </span>
                </td>
              </tr>
            ) : notes.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-2 py-12 text-center text-sm text-gray-500">
                  Nenhuma nota encontrada para os filtros informados.
                </td>
              </tr>
            ) : (
              notes.map((note) => (
                <tr key={note.id} className="border-b last:border-0">
                  <td className="p-2 font-medium">#{note.numero || '-'}</td>
                  <td className="p-2">{getTipoDocumentoLabel(note.tipo_documento)}</td>
                  <td className="p-2">
                    <Badge className={note.status === 'cancelado' ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}>
                      {getStatusLabel(note.status)}
                    </Badge>
                  </td>
                  <td className="p-2 text-sm text-gray-700">{getContractCaseLabel(note)}</td>
                  <td className="p-2">{note.batch_numero ? `#${note.batch_numero}` : '-'}</td>
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
                      <span className="text-gray-500">-</span>
                    )}
                  </td>
                  <td className="p-2 text-xs text-gray-600">{formatMetadata(note.metadata)}</td>
                  <td className="p-2 text-sm text-gray-700">{formatDateTime(note.created_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </div>
    </div>
  )
}
