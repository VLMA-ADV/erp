'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, RotateCcw } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { useToast } from '@/components/ui/toast'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'
import { formatContratoDisplay } from '@/lib/utils/contrato-display'
import { formatHorasMin } from '@/lib/utils/format-horas'
import {
  PERMISSAO_RESTAURAR_LIXEIRA,
  RETENCAO_LIXEIRA_MESES,
  ROTULO_TIPO_LIXEIRA,
  avisosDeRestauracao,
  chaveDoItem,
  filtrarLixeira,
  lerPayloadLixeira,
  mesesDaLixeira,
  parametrosDeRestauracao,
  rotuloDiasRestantes,
  rotuloMesLixeira,
  tipoDoItem,
  mostraValor,
  type ItemLixeira,
  type TipoItemLixeira,
} from '@/lib/faturamento/lixeira'

/**
 * Lixeira do faturamento, por 12 meses: lançamentos de hora excluídos da fila
 * de faturar (etapa 1) e timesheets/despesas apagados nas telas de lançamento
 * (etapa 2, soft delete) e itens ignorados na revisão (etapa 3, Filipe 30/10 —
 * voltam para a revisão do mês deles). Itens cancelados na revisão não entram:
 * já voltam sozinhos para a fila.
 *
 * Restaurar (restaurar_lixeira_faturamento, uma chamada para os três tipos)
 * devolve o registro como estava e o põe na fila do mês corrente (competência
 * futura é mantida). Exige a
 * permissão nominal finance.faturamento.lixeira.restore. O botão só aparece
 * quando o hook de permissões tem a chave E a RPC confirma (pode_restaurar):
 * get_user_permissions devolve todas as chaves para sócio e administrativo,
 * então só o hook mostraria o botão para quem a RPC recusa.
 */

function fmtData(iso: string | null | undefined) {
  if (!iso) return '—'
  const [a, m, d] = iso.slice(0, 10).split('-')
  return d && m && a ? `${d}/${m}/${a}` : iso
}

function fmtValor(v: number | string | null | undefined) {
  const n = Number(v)
  return Number.isFinite(n) ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—'
}

const COR_TIPO: Record<TipoItemLixeira, string> = {
  excluido_fila: 'bg-canvas-soft text-ink-secondary',
  timesheet_apagado: 'bg-red-50 text-red-700',
  despesa_apagada: 'bg-red-50 text-red-700',
  item_ignorado: 'bg-amber-50 text-amber-800',
}

function fmtMesCurto(iso: string | null | undefined) {
  if (!iso) return '—'
  const [a, m] = iso.split('-')
  return m && a ? `${m}/${a}` : iso
}

export default function LixeiraFaturamentoList({
  onRestaurado,
  onTotalChange,
}: {
  /** Depois de restaurar: a tela recarrega fila e abas. */
  onRestaurado?: () => void
  onTotalChange?: (total: number) => void
}) {
  const { hasPermission } = usePermissionsContext()
  const { success, error: toastError } = useToast()
  const [itens, setItens] = useState<ItemLixeira[]>([])
  const [podeRestaurarRpc, setPodeRestaurarRpc] = useState(false)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [mes, setMes] = useState('')
  const [tipo, setTipo] = useState<TipoItemLixeira | ''>('')
  const [selecionados, setSelecionados] = useState<string[]>([])
  const [confirmando, setConfirmando] = useState(false)
  const [restaurando, setRestaurando] = useState(false)

  const podeRestaurar = hasPermission(PERMISSAO_RESTAURAR_LIXEIRA) && podeRestaurarRpc

  const carregar = useCallback(async () => {
    try {
      setCarregando(true)
      setErro(null)
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data, error } = await supabase.rpc('get_lixeira_faturamento', { p_user_id: user.id })
      if (error) throw error
      const payload = lerPayloadLixeira(data)
      setItens(payload.itens)
      setPodeRestaurarRpc(payload.pode_restaurar)
      setSelecionados((prev) => prev.filter((chave) => payload.itens.some((i) => chaveDoItem(i) === chave)))
      onTotalChange?.(payload.itens.length)
    } catch (err) {
      console.error(err)
      setErro('Erro ao carregar a lixeira do faturamento.')
    } finally {
      setCarregando(false)
    }
    // Sem toast/callbacks nas dependências: mudam de identidade a cada render
    // e fariam o useEffect recarregar sem parar (mesmo motivo do PostergadosList).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { void carregar() }, [carregar])

  // Excluir da fila em outra parte da tela dispara o mesmo evento.
  useEffect(() => {
    const onMudou = () => { void carregar() }
    window.addEventListener('faturamento:gerado', onMudou)
    return () => window.removeEventListener('faturamento:gerado', onMudou)
  }, [carregar])

  const meses = useMemo(() => mesesDaLixeira(itens), [itens])
  const visiveis = useMemo(() => filtrarLixeira(itens, { busca, mes, tipo }), [itens, busca, mes, tipo])
  const selecionadosItens = useMemo(
    () => itens.filter((i) => selecionados.includes(chaveDoItem(i))),
    [itens, selecionados],
  )
  const avisos = useMemo(() => avisosDeRestauracao(selecionadosItens), [selecionadosItens])
  const destinos = useMemo(
    () => Array.from(new Set(selecionadosItens.map((i) => i.mes_destino))).sort(),
    [selecionadosItens],
  )

  const todosVisiveisMarcados = visiveis.length > 0 && visiveis.every((i) => selecionados.includes(chaveDoItem(i)))

  const marcar = (ids: string[], marcado: boolean) => {
    setSelecionados((prev) => (marcado ? Array.from(new Set([...prev, ...ids])) : prev.filter((id) => !ids.includes(id))))
  }

  const restaurar = async () => {
    if (selecionados.length === 0) return
    try {
      setRestaurando(true)
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data, error } = await supabase.rpc('restaurar_lixeira_faturamento', {
        p_user_id: user.id,
        ...parametrosDeRestauracao(selecionadosItens),
      })
      if (error) throw error
      const afetados = Number((data as { afetados?: number })?.afetados || 0)
      const ignorados = Number((data as { ignorados?: number })?.ignorados || 0)
      if (afetados > 0) success(`${afetados} lançamento(s) restaurado(s).`)
      if (ignorados > 0) toastError(`${ignorados} lançamento(s) não puderam ser restaurados (fora do prazo, já liberados ou despesa de lote já fechado).`)
      setSelecionados([])
      setConfirmando(false)
      await carregar()
      onRestaurado?.()
    } catch (err) {
      console.error(err)
      toastError(err instanceof Error && err.message ? err.message : 'Erro ao restaurar da lixeira')
    } finally {
      setRestaurando(false)
    }
  }

  if (carregando && itens.length === 0) return <p className="p-6 text-sm text-ink-mute">Carregando…</p>
  if (erro) return <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive">{erro}</p>

  if (itens.length === 0) {
    return (
      <p className="rounded-lg border border-hairline bg-white p-6 text-sm text-ink-mute">
        Lixeira vazia. O que for excluído da fila de faturar, ignorado na revisão, e os timesheets e despesas apagados ficam aqui por {RETENCAO_LIXEIRA_MESES} meses.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[240px] flex-1 space-y-1">
          <label className="text-sm font-medium" htmlFor="lixeira-busca">Busca</label>
          <Input
            id="lixeira-busca"
            value={busca}
            onChange={(event) => setBusca(event.target.value)}
            placeholder="Cliente, contrato, caso, profissional, descrição…"
          />
        </div>
        <div className="w-48 space-y-1">
          <label className="text-sm font-medium" htmlFor="lixeira-tipo">Tipo</label>
          <NativeSelect id="lixeira-tipo" value={tipo} onChange={(event) => setTipo(event.target.value as TipoItemLixeira | '')}>
            <option value="">Todos</option>
            {(Object.keys(ROTULO_TIPO_LIXEIRA) as TipoItemLixeira[]).map((t) => (
              <option key={t} value={t}>{ROTULO_TIPO_LIXEIRA[t]}</option>
            ))}
          </NativeSelect>
        </div>
        <div className="w-48 space-y-1">
          <label className="text-sm font-medium" htmlFor="lixeira-mes">Mês de origem</label>
          <NativeSelect id="lixeira-mes" value={mes} onChange={(event) => setMes(event.target.value)}>
            <option value="">Todos</option>
            {meses.map((m) => (
              <option key={m} value={m}>{fmtMesCurto(m)}</option>
            ))}
          </NativeSelect>
        </div>
        {podeRestaurar ? (
          <Button
            onClick={() => setConfirmando(true)}
            disabled={selecionados.length === 0 || restaurando}
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Restaurar{selecionados.length > 0 ? ` (${selecionados.length})` : ''}
          </Button>
        ) : null}
      </div>

      <p className="text-sm text-ink-mute">
        {visiveis.length} de {itens.length} lançamento(s). Cada um fica aqui por {RETENCAO_LIXEIRA_MESES} meses
        depois de excluído ou apagado; passado o prazo, só sai da lixeira — nada é apagado de verdade.
      </p>

      <div className="overflow-x-auto rounded-lg border border-hairline bg-white">
        <table className="w-full min-w-[1100px] text-sm">
          <thead className="border-b border-hairline text-left text-xs uppercase tracking-wide text-ink-mute">
            <tr>
              {podeRestaurar ? (
                <th className="w-8 p-3">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-hairline"
                    aria-label="Selecionar todos"
                    checked={todosVisiveisMarcados}
                    onChange={(event) => marcar(visiveis.map(chaveDoItem), event.target.checked)}
                  />
                </th>
              ) : null}
              <th className="p-3">Tipo</th>
              <th className="p-3">Cliente / contrato / caso</th>
              <th className="p-3">Lançamento</th>
              <th className="p-3 text-right">Horas / valor</th>
              <th className="p-3">Por / quando</th>
              <th className="p-3">Mês de origem</th>
              <th className="p-3 text-right">Sai em</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {visiveis.map((i) => {
              const contrato = formatContratoDisplay(i.contrato_numero_sequencial ?? i.contrato_numero, i.contrato_nome)
              const chave = chaveDoItem(i)
              const t = tipoDoItem(i)
              const marcado = selecionados.includes(chave)
              return (
                <tr key={chave} className={marcado ? 'bg-canvas-soft' : undefined}>
                  {podeRestaurar ? (
                    <td className="p-3 align-top">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-hairline"
                        aria-label="Selecionar lançamento"
                        checked={marcado}
                        onChange={(event) => marcar([chave], event.target.checked)}
                      />
                    </td>
                  ) : null}
                  <td className="p-3 align-top">
                    <span className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] ${COR_TIPO[t]}`}>
                      {ROTULO_TIPO_LIXEIRA[t]}
                    </span>
                  </td>
                  <td className="p-3 align-top">
                    <p className="font-medium text-ink">{i.cliente_nome || '—'}</p>
                    <p className="text-xs text-ink-mute">{contrato.full}</p>
                    <p className="text-xs text-ink-mute">
                      {i.caso_numero ? `${i.caso_numero} - ` : ''}{i.caso_nome || '—'}
                    </p>
                  </td>
                  <td className="p-3 align-top">
                    <p className="text-ink">{i.profissional_nome || '—'} · <span className="font-tabular">{fmtData(i.data_lancamento)}</span></p>
                    <p className="mt-0.5 max-w-md text-xs text-ink-mute">
                      {(t === 'despesa_apagada' || t === 'item_ignorado') && i.categoria ? `${i.categoria} · ` : ''}{i.descricao || '—'}
                    </p>
                  </td>
                  <td className="p-3 text-right align-top font-tabular">
                    {mostraValor(i) ? fmtValor(i.valor) : formatHorasMin(i.horas)}
                  </td>
                  <td className="p-3 align-top">
                    <p className="text-ink">{i.excluido_por_nome || '—'}</p>
                    <p className="text-xs text-ink-mute font-tabular">{fmtData(i.excluido_em)}</p>
                    {i.motivo ? <p className="mt-0.5 max-w-xs text-xs text-ink-mute">“{i.motivo}”</p> : null}
                  </td>
                  <td className="p-3 align-top">
                    <p className="font-tabular text-ink-mute">{fmtMesCurto(i.mes_original)}</p>
                    {i.nfse_no_mes_original ? (
                      <span className="mt-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800">NFS-e {i.nfse_no_mes_original}</span>
                    ) : i.kit_no_mes_original ? (
                      <span className="mt-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800">kit montado</span>
                    ) : null}
                  </td>
                  <td className="p-3 text-right align-top font-tabular text-ink-mute">{rotuloDiasRestantes(i.dias_restantes)}</td>
                </tr>
              )
            })}
            {visiveis.length === 0 ? (
              <tr>
                <td colSpan={podeRestaurar ? 8 : 7} className="p-6 text-center text-sm text-ink-mute">
                  Nada encontrado com esses filtros.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <Dialog open={confirmando} onOpenChange={(open) => !open && !restaurando && setConfirmando(false)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Restaurar {selecionados.length} lançamento(s)</DialogTitle>
            <DialogDescription>
              Voltam como estavam e entram na fila de faturamento de{' '}
              {destinos.length > 0 ? destinos.map(rotuloMesLixeira).join(', ') : 'este mês'}; saem da lixeira.
              Apagados voltam também para as telas de Timesheet e Despesas. Ignorados voltam para a
              revisão do mês deles, com o valor lançado.
            </DialogDescription>
          </DialogHeader>
          {avisos.length > 0 ? (
            <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-medium">Atenção</p>
              <ul className="list-disc space-y-1 pl-5">
                {avisos.map((a) => <li key={a}>{a}</li>)}
              </ul>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmando(false)} disabled={restaurando}>
              Cancelar
            </Button>
            <Button onClick={() => void restaurar()} disabled={restaurando}>
              {restaurando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
              Restaurar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
