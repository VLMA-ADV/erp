'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Loader2, Send } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Input } from '@/components/ui/input'
import { Table } from '@/components/ui/table'
import { Tooltip } from '@/components/ui/tooltip'
import { useToast } from '@/components/ui/toast'

interface CasoAgrupado {
  caso_id: string
  caso_numero: number | null
  caso_nome: string
  total_horas: string
  total_valor: string
  total_itens: number
  extrato?: Array<{
    tipo: string
    descricao: string
    data_referencia: string | null
    horas: string
    valor: string
  }>
}

interface ContratoAgrupado {
  contrato_id: string
  contrato_numero: number | null
  contrato_nome: string
  total_horas: string
  total_valor: string
  total_itens: number
  casos: CasoAgrupado[]
}

interface ClienteAgrupado {
  cliente_id: string
  cliente_nome: string
  total_horas: string
  total_valor: string
  total_itens: number
  contratos: ContratoAgrupado[]
}

function toDateInput(date: Date) {
  return date.toISOString().slice(0, 10)
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}

function formatMoney(value: number | string | null | undefined) {
  const amount = Number(value || 0)
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount)
}

function formatHours(value: number | string | null | undefined) {
  const amount = Number(value || 0)
  return amount.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDate(value: string | null | undefined) {
  if (!value) return '-'
  const [year, month, day] = value.split('-')
  if (!year || !month || !day) return value
  return `${day}/${month}/${year}`
}

export default function ItensAFaturarList() {
  const today = new Date()
  const { success, error: toastError } = useToast()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<ClienteAgrupado[]>([])
  const [search, setSearch] = useState('')
  const [dateStart, setDateStart] = useState(toDateInput(startOfMonth(today)))
  const [dateEnd, setDateEnd] = useState(toDateInput(endOfMonth(today)))
  const [expandedClientes, setExpandedClientes] = useState<Record<string, boolean>>({})
  const [expandedContratos, setExpandedContratos] = useState<Record<string, boolean>>({})
  const [expandedCasos, setExpandedCasos] = useState<Record<string, boolean>>({})
  const [sendingTarget, setSendingTarget] = useState<string | null>(null)

  const loadItems = async () => {
    try {
      setLoading(true)
      setError(null)
      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) return

      const params = new URLSearchParams({
        data_inicio: dateStart,
        data_fim: dateEnd,
      })
      if (search.trim()) params.set('search', search.trim())

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-itens-a-faturar?${params.toString()}`,
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
        setError(payload.error || 'Erro ao carregar itens a faturar')
        setItems([])
        return
      }

      const data = (payload.data || []) as ClienteAgrupado[]
      setItems(data)

      const nextExpandedClientes: Record<string, boolean> = {}
      const nextExpandedContratos: Record<string, boolean> = {}
      const nextExpandedCasos: Record<string, boolean> = {}
      for (const cliente of data) {
        nextExpandedClientes[cliente.cliente_id] = false
        for (const contrato of cliente.contratos || []) {
          nextExpandedContratos[contrato.contrato_id] = false
          for (const caso of contrato.casos || []) {
            nextExpandedCasos[caso.caso_id] = false
          }
        }
      }
      setExpandedClientes(nextExpandedClientes)
      setExpandedContratos(nextExpandedContratos)
      setExpandedCasos(nextExpandedCasos)
    } catch (err) {
      console.error(err)
      setError('Erro ao carregar itens a faturar')
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadItems()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const totals = useMemo(() => {
    return items.reduce(
      (acc, cliente) => {
        acc.valor += Number(cliente.total_valor || 0)
        acc.horas += Number(cliente.total_horas || 0)
        acc.itens += Number(cliente.total_itens || 0)
        return acc
      },
      { valor: 0, horas: 0, itens: 0 },
    )
  }, [items])

  const startFlow = async (targetType: 'cliente' | 'contrato', targetId: string, label: string) => {
    try {
      setSendingTarget(targetId)
      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) return

      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/start-faturamento`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          data_inicio: dateStart,
          data_fim: dateEnd,
          alvo_tipo: targetType,
          alvo_id: targetId,
          search: search.trim() || null,
        }),
      })

      const payload = await response.json()
      if (!response.ok) {
        toastError(payload.error || `Erro ao enviar ${label} para revisão`)
        return
      }

      const created = Number(payload?.data?.itens_criados || 0)
      const batchNumber = payload?.data?.batch_numero
      success(
        batchNumber
          ? `${label} enviado para revisão no lote #${batchNumber} (${created} itens).`
          : `${label} enviado para revisão (${created} itens).`,
      )
      await loadItems()
    } catch (err) {
      console.error(err)
      toastError(`Erro ao enviar ${label} para revisão`)
    } finally {
      setSendingTarget(null)
    }
  }

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
          <label className="text-sm font-medium">Data inicial</label>
          <DatePicker value={dateStart} onChange={setDateStart} />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Data final</label>
          <DatePicker value={dateEnd} onChange={setDateEnd} />
        </div>
        <div className="space-y-1 md:col-span-2">
          <label className="text-sm font-medium">Busca</label>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Cliente, contrato, caso ou código"
          />
        </div>
      </div>

      <div className="flex items-center justify-between rounded-md border bg-muted/30 p-3">
        <div className="text-sm text-muted-foreground">
          <span className="mr-4">Clientes: <strong className="text-foreground">{items.length}</strong></span>
          <span className="mr-4">Itens: <strong className="text-foreground">{totals.itens}</strong></span>
          <span>Horas: <strong className="text-foreground">{formatHours(totals.horas)}</strong></span>
        </div>
        <div className="text-sm font-semibold">{formatMoney(totals.valor)}</div>
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
              <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">Valor em aberto</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Carregando...
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Nenhum item encontrado para o período informado.
                </td>
              </tr>
            ) : (
              items.map((cliente) => {
                const clienteExpanded = expandedClientes[cliente.cliente_id]
                return (
                  <Fragment key={cliente.cliente_id}>
                    <tr key={cliente.cliente_id} className="bg-muted/10">
                      <td className="px-4 py-3 font-semibold">
                        <button
                          className="inline-flex items-center gap-2"
                          onClick={() =>
                            setExpandedClientes((prev) => ({ ...prev, [cliente.cliente_id]: !clienteExpanded }))
                          }
                        >
                          {clienteExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          {cliente.cliente_nome}
                        </button>
                      </td>
                      <td className="px-4 py-3">{formatHours(cliente.total_horas)}</td>
                      <td className="px-4 py-3">{cliente.total_itens}</td>
                      <td className="px-4 py-3 text-right font-semibold">{formatMoney(cliente.total_valor)}</td>
                      <td className="px-4 py-3 text-right">
                        <Tooltip content={sendingTarget === cliente.cliente_id ? 'Enviando cliente...' : 'Enviar cliente'}>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={!!sendingTarget}
                            onClick={() => void startFlow('cliente', cliente.cliente_id, `Cliente ${cliente.cliente_nome}`)}
                          >
                            {sendingTarget === cliente.cliente_id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Send className="h-4 w-4" />
                            )}
                          </Button>
                        </Tooltip>
                      </td>
                    </tr>

                    {clienteExpanded &&
                      (cliente.contratos || []).map((contrato) => {
                        const contratoExpanded = expandedContratos[contrato.contrato_id]
                        return (
                          <Fragment key={contrato.contrato_id}>
                            <tr key={contrato.contrato_id}>
                              <td className="px-4 py-3 pl-10">
                                <button
                                  className="inline-flex items-center gap-2"
                                  onClick={() =>
                                    setExpandedContratos((prev) => ({
                                      ...prev,
                                      [contrato.contrato_id]: !contratoExpanded,
                                    }))
                                  }
                                >
                                  {contratoExpanded ? (
                                    <ChevronDown className="h-4 w-4" />
                                  ) : (
                                    <ChevronRight className="h-4 w-4" />
                                  )}
                                  {contrato.contrato_numero ? `${contrato.contrato_numero} - ` : ''}{contrato.contrato_nome}
                                </button>
                              </td>
                              <td className="px-4 py-3">{formatHours(contrato.total_horas)}</td>
                              <td className="px-4 py-3">{contrato.total_itens}</td>
                              <td className="px-4 py-3 text-right">{formatMoney(contrato.total_valor)}</td>
                              <td className="px-4 py-3 text-right">
                                <Tooltip
                                  content={sendingTarget === contrato.contrato_id ? 'Enviando contrato...' : 'Enviar contrato'}
                                >
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    disabled={!!sendingTarget}
                                    onClick={() =>
                                      void startFlow(
                                        'contrato',
                                        contrato.contrato_id,
                                        `Contrato ${contrato.contrato_numero ? `${contrato.contrato_numero} - ` : ''}${contrato.contrato_nome}`,
                                      )
                                    }
                                  >
                                    {sendingTarget === contrato.contrato_id ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Send className="h-4 w-4" />
                                    )}
                                  </Button>
                                </Tooltip>
                              </td>
                            </tr>

                            {contratoExpanded &&
                              (contrato.casos || []).map((caso) => {
                                const casoExpanded = expandedCasos[caso.caso_id]
                                const extrato = Array.isArray(caso.extrato) ? caso.extrato : []
                                return (
                                  <Fragment key={caso.caso_id}>
                                    <tr>
                                      <td className="px-4 py-3 pl-16 text-muted-foreground">
                                        <button
                                          className="inline-flex items-center gap-2"
                                          onClick={() =>
                                            setExpandedCasos((prev) => ({ ...prev, [caso.caso_id]: !casoExpanded }))
                                          }
                                        >
                                          {casoExpanded ? (
                                            <ChevronDown className="h-4 w-4" />
                                          ) : (
                                            <ChevronRight className="h-4 w-4" />
                                          )}
                                          {caso.caso_numero ? `${caso.caso_numero} - ` : ''}{caso.caso_nome}
                                        </button>
                                      </td>
                                      <td className="px-4 py-3 text-muted-foreground">{formatHours(caso.total_horas)}</td>
                                      <td className="px-4 py-3 text-muted-foreground">{caso.total_itens}</td>
                                      <td className="px-4 py-3 text-right text-muted-foreground">{formatMoney(caso.total_valor)}</td>
                                      <td className="px-4 py-3 text-right text-xs text-muted-foreground">-</td>
                                    </tr>

                                    {casoExpanded &&
                                      extrato.map((linha, index) => (
                                        <tr key={`${caso.caso_id}-linha-${index}`} className="bg-muted/5">
                                          <td className="px-4 py-2 pl-24 text-xs text-muted-foreground">
                                            {(linha.descricao || linha.tipo) + ' • ' + formatDate(linha.data_referencia)}
                                          </td>
                                          <td className="px-4 py-2 text-xs text-muted-foreground">
                                            {formatHours(linha.horas)}
                                          </td>
                                          <td className="px-4 py-2 text-xs text-muted-foreground">
                                            -
                                          </td>
                                          <td className="px-4 py-2 text-right text-xs text-muted-foreground">
                                            {formatMoney(linha.valor)}
                                          </td>
                                          <td className="px-4 py-2 text-right text-xs text-muted-foreground">-</td>
                                        </tr>
                                      ))}
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
    </div>
  )
}
