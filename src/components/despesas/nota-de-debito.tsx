'use client'

import { useEffect, useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'
import { Button } from '@/components/ui/button'
import { CommandSelect } from '@/components/ui/command-select'
import { DatePicker } from '@/components/ui/date-picker'
import { Label } from '@/components/ui/label'

/**
 * Relatorio das despesas reembolsaveis, por cliente, para a nota de debito
 * (pedido Filipe 11/08).
 *
 * "Reembolsavel" aqui quer dizer REPASSAVEL AO CLIENTE — e a mesma marcacao que
 * o lancamento ja tem e que leva a despesa ao faturamento. Nao tem relacao com o
 * acerto do lote, que e entre o escritorio e a pessoa.
 *
 * Por isso o relatorio mostra o que ja virou item de cobranca: cobrar de novo na
 * nota de debito seria cobrar o cliente duas vezes pela mesma despesa. Por
 * padrao essas ficam de fora.
 */
interface Despesa {
  id: string
  cliente_id: string | null
  cliente_nome: string | null
  caso_numero: number | null
  caso_nome: string | null
  data_lancamento: string | null
  categoria: string | null
  descricao: string | null
  valor: number | null
  status: string | null
  reembolsavel?: boolean
  ja_faturada?: boolean
  created_by_nome: string | null
}

function formatMoney(valor: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(valor || 0))
}

function formatDate(valor: string | null) {
  if (!valor) return '—'
  const [ano, mes, dia] = valor.slice(0, 10).split('-')
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : valor
}

function baixarCsv(linhas: string[][], nome: string) {
  const escapar = (celula: string) => `"${String(celula ?? '').replace(/"/g, '""')}"`
  // BOM para o Excel abrir os acentos certo.
  const conteudo = '﻿' + linhas.map((linha) => linha.map(escapar).join(';')).join('\r\n')
  const url = URL.createObjectURL(new Blob([conteudo], { type: 'text/csv;charset=utf-8;' }))
  const link = document.createElement('a')
  link.href = url
  link.download = nome
  link.click()
  URL.revokeObjectURL(url)
}

export default function NotaDeDebito() {
  const { hasPermission } = usePermissionsContext()
  const podeVer =
    hasPermission('finance.contas_pagar.read') ||
    hasPermission('finance.contas_pagar.write') ||
    hasPermission('operations.despesas.manage')

  const [itens, setItens] = useState<Despesa[]>([])
  const [carregando, setCarregando] = useState(true)
  const [dataInicio, setDataInicio] = useState('')
  const [dataFim, setDataFim] = useState('')
  const [clienteId, setClienteId] = useState('')
  const [incluirFaturadas, setIncluirFaturadas] = useState(false)

  useEffect(() => {
    if (!podeVer) { setCarregando(false); return }
    void (async () => {
      try {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return
        const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        const resposta = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-despesas`, {
          method: 'GET',
          cache: 'no-store',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            ...(anonKey ? { apikey: anonKey } : {}),
            'Content-Type': 'application/json',
          },
        })
        const payload = await resposta.json().catch(() => ({}))
        if (resposta.ok) setItens((Array.isArray(payload.data) ? payload.data : []) as Despesa[])
      } catch (err) {
        console.error(err)
      } finally {
        setCarregando(false)
      }
    })()
  }, [podeVer])

  const clienteOptions = useMemo(() => {
    const unicos = new Map<string, string>()
    for (const item of itens) {
      if (item.cliente_id && !unicos.has(item.cliente_id)) {
        unicos.set(item.cliente_id, item.cliente_nome || 'Cliente sem nome')
      }
    }
    return [
      { value: '', label: 'Todos os clientes' },
      ...Array.from(unicos.entries())
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')),
    ]
  }, [itens])

  const selecionadas = useMemo(
    () =>
      itens.filter((item) => {
        if (item.reembolsavel === false) return false
        if (item.status === 'cancelado') return false
        if (!incluirFaturadas && item.ja_faturada) return false
        if (clienteId && item.cliente_id !== clienteId) return false
        const data = (item.data_lancamento || '').slice(0, 10)
        if (dataInicio && data < dataInicio) return false
        if (dataFim && data > dataFim) return false
        return true
      }),
    [itens, clienteId, dataInicio, dataFim, incluirFaturadas],
  )

  const porCliente = useMemo(() => {
    const mapa = new Map<string, { nome: string; itens: Despesa[]; total: number }>()
    for (const item of selecionadas) {
      const chave = item.cliente_id || 'sem-cliente'
      const grupo = mapa.get(chave) || { nome: item.cliente_nome || 'Sem cliente', itens: [], total: 0 }
      grupo.itens.push(item)
      grupo.total += Number(item.valor || 0)
      mapa.set(chave, grupo)
    }
    return Array.from(mapa.values()).sort((a, b) => b.total - a.total)
  }, [selecionadas])

  const totalGeral = useMemo(
    () => selecionadas.reduce((soma, item) => soma + Number(item.valor || 0), 0),
    [selecionadas],
  )

  const exportar = () => {
    const linhas: string[][] = [
      ['Cliente', 'Caso', 'Data', 'Categoria', 'Descrição', 'Pessoa', 'Valor', 'Já faturada'],
    ]
    for (const grupo of porCliente) {
      for (const item of grupo.itens) {
        linhas.push([
          grupo.nome,
          `${item.caso_numero ? `${item.caso_numero} - ` : ''}${item.caso_nome || ''}`,
          formatDate(item.data_lancamento),
          item.categoria || '',
          item.descricao || '',
          item.created_by_nome || '',
          String(Number(item.valor || 0).toFixed(2)).replace('.', ','),
          item.ja_faturada ? 'sim' : 'não',
        ])
      }
      linhas.push([grupo.nome, '', '', '', 'TOTAL DO CLIENTE', '', String(grupo.total.toFixed(2)).replace('.', ','), ''])
    }
    baixarCsv(linhas, `nota-de-debito-${new Date().toISOString().slice(0, 10)}.csv`)
  }

  if (!podeVer) {
    return (
      <p className="rounded-lg border border-hairline bg-canvas-soft/40 p-4 text-sm text-ink-mute">
        Este relatório é do financeiro. Peça acesso a contas a pagar e receber se precisar dele.
      </p>
    )
  }

  if (carregando) return <div className="h-32 animate-pulse rounded-lg bg-secondary" />

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 rounded-md border bg-muted/20 p-3 md:grid-cols-4">
        <div className="space-y-1">
          <Label>Data início</Label>
          <DatePicker value={dataInicio} onChange={setDataInicio} />
        </div>
        <div className="space-y-1">
          <Label>Data fim</Label>
          <DatePicker value={dataFim} onChange={setDataFim} />
        </div>
        <div className="space-y-1">
          <Label>Cliente</Label>
          <CommandSelect
            value={clienteId}
            onValueChange={setClienteId}
            options={clienteOptions}
            placeholder="Todos os clientes"
            searchPlaceholder="Buscar cliente..."
            emptyText="Nenhum cliente encontrado."
          />
        </div>
        <div className="flex items-end">
          <label className="flex items-start gap-2 text-sm text-ink-secondary">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={incluirFaturadas}
              onChange={(evento) => setIncluirFaturadas(evento.target.checked)}
            />
            <span>
              Incluir as que já foram para a fatura
              <span className="mt-0.5 block text-xs text-ink-mute">
                Fora por padrão: cobrar de novo seria cobrar duas vezes.
              </span>
            </span>
          </label>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-secondary">
          <span className="font-medium text-ink">{formatMoney(totalGeral)}</span> em{' '}
          {selecionadas.length} lançamento{selecionadas.length === 1 ? '' : 's'} reembolsável
          {selecionadas.length === 1 ? '' : 'eis'}, em {porCliente.length} cliente
          {porCliente.length === 1 ? '' : 's'}
        </p>
        <Button variant="outline" onClick={exportar} disabled={selecionadas.length === 0}>
          <Download className="mr-2 h-4 w-4" />
          Exportar CSV
        </Button>
      </div>

      {porCliente.length === 0 ? (
        <p className="rounded-lg border border-hairline bg-canvas-soft/40 p-4 text-sm text-ink-mute">
          Nenhuma despesa reembolsável no período.
        </p>
      ) : (
        <div className="space-y-3">
          {porCliente.map((grupo) => (
            <section key={grupo.nome} className="overflow-hidden rounded-lg border border-hairline bg-card">
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline bg-canvas-soft px-4 py-2.5">
                <span className="font-medium text-ink">{grupo.nome}</span>
                <span className="font-tabular text-sm text-ink">
                  {formatMoney(grupo.total)}
                  <span className="text-ink-mute"> · {grupo.itens.length}</span>
                </span>
              </header>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase text-ink-mute">
                      <th className="px-4 py-2 font-medium">Data</th>
                      <th className="px-4 py-2 font-medium">Caso</th>
                      <th className="px-4 py-2 font-medium">Descrição</th>
                      <th className="px-4 py-2 font-medium">Pessoa</th>
                      <th className="px-4 py-2 text-right font-medium">Valor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hairline">
                    {grupo.itens.map((item) => (
                      <tr key={item.id}>
                        <td className="whitespace-nowrap px-4 py-2 font-tabular text-ink-secondary">
                          {formatDate(item.data_lancamento)}
                        </td>
                        <td className="px-4 py-2 text-ink-secondary">
                          {item.caso_numero ? `${item.caso_numero} - ` : ''}
                          {item.caso_nome || '—'}
                        </td>
                        <td className="max-w-[360px] px-4 py-2">
                          <p className="line-clamp-2 text-ink-secondary">{item.descricao || '—'}</p>
                          <span className="mt-0.5 inline-flex items-center gap-1.5">
                            {item.categoria ? (
                              <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-ink-mute">
                                {item.categoria}
                              </span>
                            ) : null}
                            {item.ja_faturada ? (
                              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                                Já na fatura
                              </span>
                            ) : null}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-ink-secondary">{item.created_by_nome || '—'}</td>
                        <td className="whitespace-nowrap px-4 py-2 text-right font-tabular text-ink">
                          {formatMoney(Number(item.valor || 0))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
