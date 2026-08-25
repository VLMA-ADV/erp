'use client'

import { Fragment, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Plus, ChevronDown, ChevronRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'
import { fetchWithRetry } from '@/lib/utils/fetch-with-retry'
import { formatContratoDisplay } from '@/lib/utils/contrato-display'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import ContratosActions from './contratos-actions'
import CasosActions from './casos-actions'
import type { ContratoListItem } from './types'
import { Table } from '@/components/ui/table'

type CasoLike = {
  id: string
  parte_de_carteira_id?: string | null
  regra_cobranca?: string | null
  processos_carteira_count?: number | null
}

function getVisibleCasos<T extends CasoLike>(casos: T[] | null | undefined): T[] {
  if (!casos || casos.length === 0) return []
  const matrizIds = new Set(
    casos
      .filter((c) =>
        !c.parte_de_carteira_id &&
        (c.regra_cobranca === 'mensalidade_carteira' || (c.processos_carteira_count ?? 0) > 0),
      )
      .map((c) => c.id),
  )
  return matrizIds.size > 0 ? casos.filter((c) => !matrizIds.has(c.id)) : casos
}

// Mesmos rotulos que o formulario do caso usa, para nao virar um segundo
// vocabulario: quem le "Salário Mínimo" no cadastro procura isso aqui.
const REGRAS_FILTRO = [
  { valor: 'hora', label: 'Hora' },
  { valor: 'hora_com_cap', label: 'Hora com cap' },
  { valor: 'mensal', label: 'Mensal' },
  { valor: 'mensalidade_processo', label: 'Mensalidade de processo' },
  { valor: 'salario_minimo', label: 'Salário mínimo' },
  { valor: 'mensalidade_carteira', label: 'Carteira' },
  { valor: 'projeto', label: 'Projeto' },
  { valor: 'projeto_parcelado', label: 'Projeto parcelado' },
  { valor: 'pro_labore', label: 'Pró-labore' },
  { valor: 'pro_labore_parcelado', label: 'Pró-labore parcelado' },
  { valor: 'exito', label: 'Êxito' },
]

// Data curta para caber na coluna (pedido Filipe 04/08).
function fmtData(value?: string | null) {
  if (!value) return '-'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

export default function ContratosList() {
  const searchParams = useSearchParams()
  const { hasPermission } = usePermissionsContext()
  const canRead = hasPermission('contracts.contratos.read')
  const canWrite = hasPermission('contracts.contratos.write')

  const [items, setItems] = useState<ContratoListItem[]>([])
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [expandedClients, setExpandedClients] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filtroRegra, setFiltroRegra] = useState('')
  const [filtroSituacao, setFiltroSituacao] = useState('')
  const [focusedContratoId, setFocusedContratoId] = useState('')

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
          formatContratoDisplay(c.numero_sequencial, c.nome_contrato).full.toLowerCase().includes(s) ||
          c.nome_contrato.toLowerCase().includes(s) ||
          c.cliente_nome.toLowerCase().includes(s) ||
          c.casos?.some((caso) => String(caso.numero || '').includes(s) || caso.nome.toLowerCase().includes(s)),
        )

        // Buscar "57" ja funcionava — o problema era enxergar. A tela devolve 28
        // linhas (todo contrato ou caso com "57" em qualquer posicao do numero),
        // agrupadas por cliente e com os dois niveis FECHADOS. O caso 57 estava
        // ali dentro o tempo todo, invisivel. Para quem busca, "nao encontra".
        //
        // Duas correcoes: o que bate EXATO vem primeiro, e o caminho ate ele
        // abre sozinho.
        const exato = (c: ContratoListItem) =>
          String(c.numero || '') === s ||
          String(c.numero_sequencial || '') === s ||
          !!c.casos?.some((caso) => String(caso.numero || '') === s)

        list = [...list].sort((a, b) => Number(exato(b)) - Number(exato(a)))

        const abrirContratos: Record<string, boolean> = {}
        const abrirClientes: Record<string, boolean> = {}
        for (const c of list) {
          if (!exato(c)) continue
          abrirContratos[c.id] = true
          // Mesma chave que o agrupamento da tela usa, logo abaixo.
          abrirClientes[c.cliente_nome || 'Sem cliente'] = true
        }
        if (Object.keys(abrirContratos).length > 0) {
          setExpanded((prev) => ({ ...prev, ...abrirContratos }))
          setExpandedClients((prev) => ({ ...prev, ...abrirClientes }))
        }
      }

      // Filtros de regra: um contrato fica se ALGUM caso dele casar. Filtrar o
      // contrato inteiro e o certo aqui porque a tela e uma arvore — some o
      // contrato, some o caso junto.
      //
      // A situacao vem da REGRA, nao do caso: um caso ativo pode ter regra em
      // rascunho, e e exatamente esse o par que nao fatura e nao aparece em
      // lugar nenhum. Sao 6 casos, R$ 2.600/mes, achados no batimento de agosto.
      if (filtroRegra || filtroSituacao) {
        list = list.filter((c) =>
          (c.casos || []).some((caso) => {
            const regras = caso.regras_financeiras?.length
              ? caso.regras_financeiras
              : [{ regra_cobranca: caso.regra_cobranca, status: caso.status }]
            return regras.some((r) => {
              if (filtroRegra && (r.regra_cobranca || '') !== filtroRegra) return false
              if (filtroSituacao && (r.status || 'ativo') !== filtroSituacao) return false
              return true
            })
          }),
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
  }, [search, focusedContratoId, filtroRegra, filtroSituacao])

  if (!canRead) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4">
        <p className="text-sm text-destructive">Você não tem permissão para visualizar contratos</p>
      </div>
    )
  }

  const statusPill = (status: string) => {
    if (status === 'ativo') return 'bg-green-100 text-green-800'
    if (status === 'validacao' || status === 'em_analise') return 'bg-primary-soft-bg text-primary-soft-fg'
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
      {error && <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>}

      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <Input
            className="max-w-md"
            placeholder="Buscar contrato, cliente ou nº do caso..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <NativeSelect
            className="h-10 w-auto min-w-[11rem]"
            value={filtroRegra}
            onChange={(e) => setFiltroRegra(e.target.value)}
          >
            <option value="">Todas as regras</option>
            {REGRAS_FILTRO.map((r) => (
              <option key={r.valor} value={r.valor}>{r.label}</option>
            ))}
          </NativeSelect>

          <NativeSelect
            className="h-10 w-auto min-w-[10rem]"
            value={filtroSituacao}
            onChange={(e) => setFiltroSituacao(e.target.value)}
          >
            <option value="">Ativas e rascunhos</option>
            <option value="ativo">Só regras ativas</option>
            <option value="rascunho">Só rascunhos</option>
            <option value="encerrado">Só encerradas</option>
          </NativeSelect>

          {(filtroRegra || filtroSituacao) && (
            <Button
              variant="ghost"
              className="h-10 px-2 text-sm text-ink-mute"
              onClick={() => { setFiltroRegra(''); setFiltroSituacao('') }}
            >
              limpar
            </Button>
          )}
        </div>

        {canWrite && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
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
            {[1, 2, 3].map((i) => <div key={i} className="h-12 rounded bg-hairline" />)}
          </div>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-md border p-8 text-center text-ink-mute">Nenhum contrato encontrado</div>
      ) : (() => {
        // Group contracts by client
        const groups = items.reduce<Record<string, { clienteNome: string; contratos: ContratoListItem[] }>>((acc, item) => {
          const key = item.cliente_nome || 'Sem cliente'
          if (!acc[key]) acc[key] = { clienteNome: key, contratos: [] }
          acc[key].contratos.push(item)
          return acc
        }, {})
        // Alfabetico, mas o cliente que teve casamento exato na busca sobe para
        // o topo: nao adianta abrir sozinho se fica na 20a linha.
        const clienteKeys = Object.keys(groups).sort((a, b) => {
          const aAberto = !!expandedClients[a] && !!search.trim()
          const bAberto = !!expandedClients[b] && !!search.trim()
          if (aAberto !== bAberto) return Number(bAberto) - Number(aAberto)
          return a.localeCompare(b)
        })

        return (
          <div className="rounded-md border overflow-x-auto">
            <Table className="w-full min-w-full">
              <thead className="bg-canvas-soft">
                <tr>
                  <th className="w-10 px-3 py-3" />
                  <th className="px-6 py-3 text-left text-xs font-medium text-ink-mute uppercase">Contrato</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-ink-mute uppercase">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-ink-mute uppercase">Criado em</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-ink-mute uppercase">Casos</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-ink-mute uppercase">Ações</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-hairline">
                {clienteKeys.map((clienteKey) => {
                  const group = groups[clienteKey]
                  const isClientOpen = !!expandedClients[clienteKey]
                  return (
                    <Fragment key={clienteKey}>
                      {/* Client header row */}
                      <tr className="bg-canvas-soft hover:bg-hairline">
                        <td className="px-3 py-3">
                          <button
                            className="rounded p-1 hover:bg-hairline"
                            onClick={() => setExpandedClients((prev) => ({ ...prev, [clienteKey]: !isClientOpen }))}
                          >
                            {isClientOpen ? <ChevronDown className="h-4 w-4 text-ink" /> : <ChevronRight className="h-4 w-4 text-ink" />}
                          </button>
                        </td>
                        <td colSpan={4} className="px-6 py-3 text-sm font-semibold text-ink">
                          {group.clienteNome}
                          <span className="ml-2 text-xs font-normal text-ink-mute">({group.contratos.length} contrato{group.contratos.length !== 1 ? 's' : ''})</span>
                        </td>
                      </tr>

                      {/* Contract rows for this client */}
                      {isClientOpen && group.contratos.map((item) => {
                        const isOpen = !!expanded[item.id]
                        return (
                          <Fragment key={item.id}>
                            <tr className="hover:bg-canvas-soft">
                              <td className="px-3 py-4 pl-8">
                                <button
                                  className="rounded p-1 hover:bg-canvas-soft"
                                  onClick={() => setExpanded((prev) => ({ ...prev, [item.id]: !isOpen }))}
                                >
                                  {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                </button>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-ink">
                                {(() => {
                                  const display = formatContratoDisplay(item.numero_sequencial, item.nome_contrato)
                                  return (
                                    <>
                                      <span>{display.primary}</span>
                                      {display.secondary && (
                                        <span className="ml-2 text-xs font-normal text-ink-mute">— {display.secondary}</span>
                                      )}
                                    </>
                                  )
                                })()}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${statusPill(item.status)}`}>
                                  {formatContractStatus(item.status)}
                                </span>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-ink-secondary font-tabular">{fmtData(item.created_at)}</td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-ink-secondary font-tabular">{getVisibleCasos(item.casos).length}</td>
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
                              <tr className="bg-canvas-soft/40">
                                <td colSpan={5} className="px-6 py-4 pl-12">
                                  <div className="rounded-md border bg-white overflow-hidden">
                                    <Table className="w-full min-w-full">
                                      <thead className="bg-canvas-soft">
                                        <tr>
                                          <th className="px-4 py-2 text-left text-xs font-medium text-ink-mute uppercase">Caso</th>
                                          <th className="px-4 py-2 text-left text-xs font-medium text-ink-mute uppercase">Produto</th>
                                          <th className="px-4 py-2 text-left text-xs font-medium text-ink-mute uppercase">Responsável</th>
                                          <th className="px-4 py-2 text-left text-xs font-medium text-ink-mute uppercase">Centro de custo</th>
                                          <th className="px-4 py-2 text-left text-xs font-medium text-ink-mute uppercase">Revisor</th>
                                          <th className="px-4 py-2 text-left text-xs font-medium text-ink-mute uppercase">Status</th>
                                          <th className="px-4 py-2 text-left text-xs font-medium text-ink-mute uppercase">Criado em</th>
                                          <th className="px-4 py-2 text-right text-xs font-medium text-ink-mute uppercase">Ações</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-hairline">
                                        {item.casos?.length ? (
                                          (() => {
                                            const visibleCasos = getVisibleCasos(item.casos)
                                            return visibleCasos.length > 0
                                              ? visibleCasos.map((caso) => (
                                            <tr key={caso.id}>
                                              <td className="px-4 py-3 text-sm text-ink">
                                                <span className="inline-flex items-center gap-1">
                                                  <span>{caso.parte_de_carteira_id ? (caso.nome || 'Processo sem identificador') : `${caso.numero || '-'} - ${caso.nome}`}</span>
                                                  {caso.parte_de_carteira_id ? (
                                                    <Badge className="ml-1 bg-white text-[10px] font-normal text-ink-secondary">Processo da carteira</Badge>
                                                  ) : (caso.processos_carteira_count ?? 0) > 0 ? (
                                                    <Badge className="ml-1 bg-white text-[10px] font-normal text-ink-secondary">Carteira ({caso.processos_carteira_count})</Badge>
                                                  ) : null}
                                                </span>
                                              </td>
                                              <td className="px-4 py-3 text-sm text-ink-secondary">{caso.produto_nome || '-'}</td>
                                              <td className="px-4 py-3 text-sm text-ink-secondary">{caso.responsavel_nome || '-'}</td>
                                              <td className="px-4 py-3 text-sm text-ink-secondary">{caso.centro_custo_nome || '-'}</td>
                                              <td className="px-4 py-3 text-sm text-ink-secondary">{caso.revisor_nome || '-'}</td>
                                              <td className="px-4 py-3 text-sm">
                                                <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${caseStatusPill(caso.status || 'rascunho')}`}>
                                                  {caso.status || 'rascunho'}
                                                </span>
                                              </td>
                                              <td className="px-4 py-3 text-sm text-ink-secondary font-tabular">{fmtData(caso.created_at)}</td>
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
                                              : (
                                                <tr>
                                                  <td colSpan={5} className="px-4 py-6 text-center text-sm text-ink-mute">
                                                    Nenhum caso cadastrado para este contrato
                                                  </td>
                                                </tr>
                                              )
                                          })()
                                        ) : (
                                          <tr>
                                            <td colSpan={5} className="px-4 py-6 text-center text-sm text-ink-mute">
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
