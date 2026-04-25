'use client'

import { Fragment, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Plus, ChevronDown, ChevronRight, Percent } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'
import { fetchWithRetry } from '@/lib/utils/fetch-with-retry'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import ContratosActions from './contratos-actions'
import CasosActions from './casos-actions'
import type { ContratoListItem } from './types'
import { Table } from '@/components/ui/table'
import { useToast } from '@/components/ui/toast'

function getContratoDisplayLabel(item: Pick<ContratoListItem, 'numero_sequencial' | 'nome_contrato'>) {
  if (typeof item.numero_sequencial === 'number' && item.numero_sequencial > 0) {
    return `Contrato ${item.numero_sequencial}`
  }
  const fallback = item.nome_contrato?.trim()
  return fallback || 'Contrato sem identificador'
}

export default function ContratosList() {
  const searchParams = useSearchParams()
  const { hasPermission } = usePermissionsContext()
  const { success: toastSuccess, error: toastError } = useToast()
  const canRead = hasPermission('contracts.contratos.read')
  const canWrite = hasPermission('contracts.contratos.write')

  const [items, setItems] = useState<ContratoListItem[]>([])
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [expandedClients, setExpandedClients] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [focusedContratoId, setFocusedContratoId] = useState('')
  const [aplicandoReajustes, setAplicandoReajustes] = useState(false)

  useEffect(() => {
    const searchFromQuery = searchParams.get('search') || ''
    const contratoIdFromQuery = searchParams.get('contrato_id') || ''
    setSearch(searchFromQuery)
    setFocusedContratoId(contratoIdFromQuery)
    if (contratoIdFromQuery) {
      setExpanded((prev) => ({ ...prev, [contratoIdFromQuery]: true }))
    }
  }, [searchParams])

  const fetchItems = async (signal?: AbortSignal) => {
    try {
      setLoading(true)
      setError(null)
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      if (signal?.aborted) return

      const resp = await fetchWithRetry(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-contratos`, {
        method: 'GET',
        signal,
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      })

      const data = await resp.json()
      if (!resp.ok) {
        setError(data.error || 'Erro ao carregar contratos')
        return
      }

      let list = (data.data || []) as ContratoListItem[]
      if (focusedContratoId) {
        list = list.filter((c) => c.id === focusedContratoId)
      }
      if (search.trim()) {
        const s = search.toLowerCase()
        list = list.filter((c) =>
          String(c.numero || '').includes(s) ||
          String(c.numero_sequencial || '').includes(s) ||
          getContratoDisplayLabel(c).toLowerCase().includes(s) ||
          c.nome_contrato.toLowerCase().includes(s) ||
          c.cliente_nome.toLowerCase().includes(s) ||
          c.casos?.some((caso) => String(caso.numero || '').includes(s) || caso.nome.toLowerCase().includes(s)),
        )
      }
      setItems(list)
    } catch (e) {
      // Caller cancelou (unmount/dependency change): silenciar — não setar erro
      if (e instanceof DOMException && e.name === 'AbortError') return
      console.error(e)
      setError('Erro ao carregar contratos')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }

  useEffect(() => {
    if (!canRead) return
    const ac = new AbortController()
    fetchItems(ac.signal)
    return () => ac.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead])

  useEffect(() => {
    if (!canRead) return
    const ac = new AbortController()
    fetchItems(ac.signal)
    return () => ac.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, focusedContratoId])

  const aplicarReajustesPendentes = async () => {
    try {
      setAplicandoReajustes(true)
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        toastError('Sessão expirada. Faça login novamente.')
        return
      }
      const resp = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/aplicar-reajuste`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      })
      const payload = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        toastError(typeof payload.error === 'string' ? payload.error : 'Falha ao aplicar reajustes')
        return
      }
      const result = payload.data as { casos_reajustados?: number; detalhe?: unknown } | undefined
      const n = typeof result?.casos_reajustados === 'number' ? result.casos_reajustados : 0
      toastSuccess(n > 0 ? `Reajustes aplicados: ${n} caso(s).` : 'Nenhum caso elegível para reajuste no momento.')
      void fetchItems()
    } catch (e) {
      console.error(e)
      toastError('Erro ao aplicar reajustes')
    } finally {
      setAplicandoReajustes(false)
    }
  }

  if (!canRead) {
    return (
      <div className="rounded-md bg-red-50 p-4">
        <p className="text-sm text-red-800">Você não tem permissão para visualizar contratos</p>
      </div>
    )
  }

  const statusPill = (status: string) => {
    if (status === 'ativo') return 'bg-green-100 text-green-800'
    if (status === 'validacao' || status === 'em_analise') return 'bg-blue-100 text-blue-800'
    if (status === 'solicitacao') return 'bg-violet-100 text-violet-800'
    if (status === 'encerrado') return 'bg-red-100 text-red-800'
    return 'bg-yellow-100 text-yellow-800'
  }

  const formatContractStatus = (status: string) => {
    if (status === 'em_analise') return 'validação'
    if (status === 'validacao') return 'validação'
    if (status === 'solicitacao') return 'solicitação'
    return status
  }

  const caseStatusPill = (status: string) => {
    if (status === 'ativo') return 'bg-green-100 text-green-800'
    if (status === 'inativo') return 'bg-red-100 text-red-800'
    return 'bg-yellow-100 text-yellow-800'
  }

  return (
    <div className="space-y-4">
      {error && <div className="rounded-md bg-red-50 p-4 text-sm text-red-800">{error}</div>}

      <div className="flex items-center justify-between gap-3">
        <Input
          className="max-w-md"
          placeholder="Buscar contrato, cliente ou caso..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {canWrite && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={aplicandoReajustes}
              onClick={() => void aplicarReajustesPendentes()}
            >
              <Percent className="mr-2 h-4 w-4" />
              {aplicandoReajustes ? 'Aplicando…' : 'Aplicar reajustes pendentes'}
            </Button>
            <Link href="/contratos/novo">
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Novo contrato
              </Button>
            </Link>
          </div>
        )}
      </div>

      {loading ? (
        <div className="rounded-md border p-4">
          <div className="animate-pulse space-y-4">
            {[1, 2, 3].map((i) => <div key={i} className="h-12 rounded bg-gray-200" />)}
          </div>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-md border p-8 text-center text-gray-500">Nenhum contrato encontrado</div>
      ) : (() => {
        // Group contracts by client
        const groups = items.reduce<Record<string, { clienteNome: string; contratos: ContratoListItem[] }>>((acc, item) => {
          const key = item.cliente_nome || 'Sem cliente'
          if (!acc[key]) acc[key] = { clienteNome: key, contratos: [] }
          acc[key].contratos.push(item)
          return acc
        }, {})
        const clienteKeys = Object.keys(groups).sort()

        return (
          <div className="rounded-md border overflow-x-auto">
            <Table className="w-full min-w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="w-10 px-3 py-3" />
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Contrato</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Casos</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Ações</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {clienteKeys.map((clienteKey) => {
                  const group = groups[clienteKey]
                  const isClientOpen = !!expandedClients[clienteKey]
                  return (
                    <Fragment key={clienteKey}>
                      {/* Client header row */}
                      <tr className="bg-blue-50 hover:bg-blue-100">
                        <td className="px-3 py-3">
                          <button
                            className="rounded p-1 hover:bg-blue-200"
                            onClick={() => setExpandedClients((prev) => ({ ...prev, [clienteKey]: !isClientOpen }))}
                          >
                            {isClientOpen ? <ChevronDown className="h-4 w-4 text-blue-700" /> : <ChevronRight className="h-4 w-4 text-blue-700" />}
                          </button>
                        </td>
                        <td colSpan={4} className="px-6 py-3 text-sm font-semibold text-blue-900">
                          {group.clienteNome}
                          <span className="ml-2 text-xs font-normal text-blue-600">({group.contratos.length} contrato{group.contratos.length !== 1 ? 's' : ''})</span>
                        </td>
                      </tr>

                      {/* Contract rows for this client */}
                      {isClientOpen && group.contratos.map((item) => {
                        const isOpen = !!expanded[item.id]
                        return (
                          <Fragment key={item.id}>
                            <tr className="hover:bg-gray-50">
                              <td className="px-3 py-4 pl-8">
                                <button
                                  className="rounded p-1 hover:bg-gray-100"
                                  onClick={() => setExpanded((prev) => ({ ...prev, [item.id]: !isOpen }))}
                                >
                                  {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                </button>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                {getContratoDisplayLabel(item)}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${statusPill(item.status)}`}>
                                  {formatContractStatus(item.status)}
                                </span>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{item.casos?.length || 0}</td>
                              <td className="px-6 py-4 whitespace-nowrap text-right">
                                <ContratosActions
                                  contratoId={item.id}
                                  status={item.status}
                                  canWrite={canWrite}
                                  onRefresh={fetchItems}
                                />
                              </td>
                            </tr>

                            {isOpen && (
                              <tr className="bg-gray-50/40">
                                <td colSpan={5} className="px-6 py-4 pl-12">
                                  <div className="rounded-md border bg-white overflow-hidden">
                                    <Table className="w-full min-w-full">
                                      <thead className="bg-gray-50">
                                        <tr>
                                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Caso</th>
                                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Produto</th>
                                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Responsável</th>
                                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Ações</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-gray-100">
                                        {item.casos?.length ? (
                                          item.casos.map((caso) => (
                                            <tr key={caso.id}>
                                              <td className="px-4 py-3 text-sm text-gray-900">{caso.numero || '-'} - {caso.nome}</td>
                                              <td className="px-4 py-3 text-sm text-gray-700">{caso.produto_nome || '-'}</td>
                                              <td className="px-4 py-3 text-sm text-gray-700">{caso.responsavel_nome || '-'}</td>
                                              <td className="px-4 py-3 text-sm">
                                                <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${caseStatusPill(caso.status || 'rascunho')}`}>
                                                  {caso.status || 'rascunho'}
                                                </span>
                                              </td>
                                              <td className="px-4 py-3 text-right">
                                                <CasosActions
                                                  contratoId={item.id}
                                                  casoId={caso.id}
                                                  status={caso.status || 'ativo'}
                                                  canWrite={canWrite}
                                                  onRefresh={fetchItems}
                                                />
                                              </td>
                                            </tr>
                                          ))
                                        ) : (
                                          <tr>
                                            <td colSpan={5} className="px-4 py-6 text-center text-sm text-gray-500">
                                              Nenhum caso cadastrado para este contrato
                                            </td>
                                          </tr>
                                        )}
                                      </tbody>
                                    </Table>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        )
                      })}
                    </Fragment>
                  )
                })}
              </tbody>
            </Table>
          </div>
        )
      })()}
    </div>
  )
}
