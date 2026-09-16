'use client'

// Relatorio pedido pelo Filipe em 11/09: "cliente, contrato, caso e regra de
// cobranca [...] verifiquei alguns casos por hora sem regra de cobranca e
// alguns valores fixos que estao sendo considerados conforme os lancamentos de
// horas". Em 16/09 ele escolheu: carteira inteira, com filtro de quem faturou
// no mes. Os tres alertas sao o motivo do pedido e ficam em destaque.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'

interface Linha {
  cliente: string
  contrato_numero: number | null
  contrato_nome: string | null
  caso_numero: number | null
  caso_nome: string | null
  caso_status: string | null
  regra_cobranca: string
  valor_hora: number | null
  valor_fixo: number | null
  valor_regra: number | null
  dia_pagamento: number | null
  responsavel: string | null
  itens_no_mes: number | null
  horas_no_mes: number | null
  valor_no_mes: number | null
  faturou_no_mes: boolean
  alerta_sem_regra: boolean
  alerta_hora_sem_valor: boolean
  alerta_fixo_com_horas: boolean
}

const REGRA_LABEL: Record<string, string> = {
  hora: 'Hora',
  hora_com_cap: 'Hora com teto',
  mensal: 'Mensalidade',
  mensalidade_processo: 'Mensalidade de processo',
  mensalidade_carteira: 'Mensalidade de carteira',
  salario_minimo: 'Salário mínimo',
  projeto: 'Projeto',
  projeto_parcela: 'Projeto parcelado',
  projeto_parcelado: 'Projeto parcelado',
  pro_labore: 'Pró-labore',
  pro_labore_parcelado: 'Pró-labore parcelado',
  exito: 'Êxito',
}

const money = (v: number | null | undefined) =>
  v == null ? '—' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)

const horas = (v: number | null | undefined) => {
  if (!v) return '—'
  const total = Math.round(v * 60)
  const h = Math.floor(total / 60)
  const m = total % 60
  return m ? `${h}h ${m}min` : `${h}h`
}

type Filtro = 'todos' | 'faturou' | 'nao_faturou' | 'alertas'

export default function RelatorioCarteira({ userId }: { userId: string }) {
  const { error: toastError } = useToast()
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [carregando, setCarregando] = useState(true)
  const [mes, setMes] = useState(() => new Date().toISOString().slice(0, 7))
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [busca, setBusca] = useState('')

  const carregar = useCallback(async () => {
    setCarregando(true)
    try {
      const supabase = createClient()
      const { data, error } = await supabase.rpc('get_relatorio_carteira_regras', {
        p_user_id: userId,
        p_mes: `${mes}-01`,
      })
      if (error) { toastError(error.message || 'Erro ao carregar o relatório'); return }
      setLinhas(Array.isArray(data) ? (data as Linha[]) : [])
    } finally {
      setCarregando(false)
    }
  }, [userId, mes, toastError])

  useEffect(() => { void carregar() }, [carregar])

  const temAlerta = (l: Linha) => l.alerta_sem_regra || l.alerta_hora_sem_valor || l.alerta_fixo_com_horas

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return linhas.filter((l) => {
      if (filtro === 'faturou' && !l.faturou_no_mes) return false
      if (filtro === 'nao_faturou' && l.faturou_no_mes) return false
      if (filtro === 'alertas' && !temAlerta(l)) return false
      if (!termo) return true
      return [l.cliente, l.contrato_nome, l.caso_nome, String(l.caso_numero ?? ''), String(l.contrato_numero ?? '')]
        .some((c) => (c || '').toLowerCase().includes(termo))
    })
  }, [linhas, filtro, busca])

  const resumo = useMemo(() => ({
    total: linhas.length,
    faturaram: linhas.filter((l) => l.faturou_no_mes).length,
    semRegra: linhas.filter((l) => l.alerta_sem_regra).length,
    horaSemValor: linhas.filter((l) => l.alerta_hora_sem_valor).length,
    fixoComHoras: linhas.filter((l) => l.alerta_fixo_com_horas).length,
  }), [linhas])

  const exportar = () => {
    const cols: Array<[string, (l: Linha) => string]> = [
      ['Cliente', (l) => l.cliente || ''],
      ['Nº contrato', (l) => String(l.contrato_numero ?? '')],
      ['Contrato', (l) => l.contrato_nome || ''],
      ['Nº caso', (l) => String(l.caso_numero ?? '')],
      ['Caso', (l) => l.caso_nome || ''],
      ['Status do caso', (l) => l.caso_status || ''],
      ['Regra de cobrança', (l) => REGRA_LABEL[l.regra_cobranca] || l.regra_cobranca || ''],
      ['Valor/hora', (l) => (l.valor_hora == null ? '' : String(l.valor_hora).replace('.', ','))],
      ['Valor fixo', (l) => (l.valor_fixo ?? l.valor_regra) == null ? '' : String(l.valor_fixo ?? l.valor_regra).replace('.', ',')],
      ['Dia de pagamento', (l) => String(l.dia_pagamento ?? '')],
      ['Responsável', (l) => l.responsavel || ''],
      ['Faturou no mês', (l) => (l.faturou_no_mes ? 'Sim' : 'Não')],
      ['Itens no mês', (l) => String(l.itens_no_mes ?? 0)],
      ['Horas no mês', (l) => (l.horas_no_mes == null ? '' : String(l.horas_no_mes).replace('.', ','))],
      ['Valor no mês', (l) => (l.valor_no_mes == null ? '' : String(l.valor_no_mes).replace('.', ','))],
      ['Sem regra', (l) => (l.alerta_sem_regra ? 'Sim' : '')],
      ['Hora sem valor', (l) => (l.alerta_hora_sem_valor ? 'Sim' : '')],
      ['Valor fixo cobrando hora', (l) => (l.alerta_fixo_com_horas ? 'Sim' : '')],
    ]
    const linhasCsv = [
      cols.map((c) => `"${c[0]}"`).join(';'),
      ...visiveis.map((l) => cols.map((c) => `"${c[1](l).replace(/"/g, '""')}"`).join(';')),
    ]
    const blob = new Blob(['﻿' + linhasCsv.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `carteira-regras-${mes}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const Chip = ({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs ${ativo ? 'bg-ink text-white border-ink' : 'text-ink-mute hover:text-ink'}`}
    >
      {children}
    </button>
  )

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-5">
        {[
          ['Casos', resumo.total, ''],
          ['Faturaram no mês', resumo.faturaram, ''],
          ['Sem regra de cobrança', resumo.semRegra, 'text-amber-700'],
          ['Hora sem valor/hora', resumo.horaSemValor, 'text-amber-700'],
          ['Valor fixo cobrando hora', resumo.fixoComHoras, 'text-red-700'],
        ].map(([label, valor, cor]) => (
          <div key={String(label)} className="rounded-xl border bg-white p-4">
            <p className="text-[11px] uppercase tracking-wide text-ink-mute">{label}</p>
            <p className={`mt-1 text-xl font-semibold font-tabular ${cor || 'text-ink'}`}>{valor as number}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-white p-3">
        <label className="text-sm text-ink-mute">Mês</label>
        <input
          type="month"
          value={mes}
          onChange={(e) => setMes(e.target.value)}
          className="rounded-full border px-3 py-1 text-sm"
        />
        <Chip ativo={filtro === 'todos'} onClick={() => setFiltro('todos')}>Todos</Chip>
        <Chip ativo={filtro === 'faturou'} onClick={() => setFiltro('faturou')}>Faturaram no mês</Chip>
        <Chip ativo={filtro === 'nao_faturou'} onClick={() => setFiltro('nao_faturou')}>Não faturaram</Chip>
        <Chip ativo={filtro === 'alertas'} onClick={() => setFiltro('alertas')}>Só com alerta</Chip>
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar cliente, contrato ou caso..."
          className="min-w-[220px] flex-1 rounded-full border px-3 py-1 text-sm"
        />
        <Button size="sm" variant="outline" onClick={exportar} disabled={visiveis.length === 0}>
          Exportar Excel (CSV)
        </Button>
      </div>

      <div className="rounded-xl border bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-ink-mute">
                <th className="p-2">Cliente</th>
                <th className="p-2">Contrato</th>
                <th className="p-2">Caso</th>
                <th className="p-2">Regra</th>
                <th className="p-2 text-right">Valor/hora</th>
                <th className="p-2 text-right">Valor fixo</th>
                <th className="p-2 text-right">No mês</th>
                <th className="p-2">Atenção</th>
              </tr>
            </thead>
            <tbody>
              {carregando ? (
                <tr><td colSpan={8} className="p-6 text-center text-ink-mute">Carregando...</td></tr>
              ) : visiveis.length === 0 ? (
                <tr><td colSpan={8} className="p-6 text-center text-ink-mute">Nenhum caso para os filtros escolhidos.</td></tr>
              ) : visiveis.map((l, i) => (
                <tr key={`${l.caso_numero}-${i}`} className="border-t align-top">
                  <td className="p-2">{l.cliente}</td>
                  <td className="p-2 whitespace-nowrap">{l.contrato_numero ? `${l.contrato_numero} — ` : ''}{l.contrato_nome || '—'}</td>
                  <td className="p-2">{l.caso_numero ? `${l.caso_numero} - ` : ''}{l.caso_nome || '—'}</td>
                  <td className="p-2 whitespace-nowrap">{REGRA_LABEL[l.regra_cobranca] || l.regra_cobranca}</td>
                  <td className="p-2 text-right font-tabular">{l.valor_hora ? money(l.valor_hora) : '—'}</td>
                  <td className="p-2 text-right font-tabular">{money(l.valor_fixo ?? l.valor_regra)}</td>
                  <td className="p-2 text-right font-tabular whitespace-nowrap">
                    {l.faturou_no_mes ? `${l.itens_no_mes} · ${horas(l.horas_no_mes)} · ${money(l.valor_no_mes)}` : '—'}
                  </td>
                  <td className="p-2">
                    <div className="flex flex-wrap gap-1">
                      {l.alerta_sem_regra && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-800">sem regra</span>}
                      {l.alerta_hora_sem_valor && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-800">hora sem valor</span>}
                      {l.alerta_fixo_com_horas && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] text-red-800">fixo cobrando hora</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-[11px] text-ink-mute">
        {visiveis.length} de {linhas.length} caso(s). Casos e contratos encerrados ficam de fora.
      </p>
    </div>
  )
}
