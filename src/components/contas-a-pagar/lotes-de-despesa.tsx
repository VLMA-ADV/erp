'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'
import { Button } from '@/components/ui/button'
import { CommandSelect } from '@/components/ui/command-select'
import { DatePicker } from '@/components/ui/date-picker'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MoneyInput } from '@/components/ui/money-input'
import { useToast } from '@/components/ui/toast'

/**
 * Lotes de adiantamento, do lado do financeiro (pedido Filipe 11/08).
 *
 * Aqui a Jessika cria o lote para uma pessoa e, quando ela devolve o lote
 * fechado, valida. Aprovar gera o acerto: sobrou vira conta a receber (ela
 * devolve), faltou vira conta a pagar (o VLMA reembolsa). Zerado nao gera nada.
 *
 * O adiantamento em si — a transferencia entre contas do proprio VLMA — nao vira
 * lancamento: o lote guarda origem, destino e data para a conciliacao. Se
 * virasse lancamento, o mesmo dinheiro contaria duas vezes, uma no adiantamento
 * e outra nas despesas que a pessoa lanca.
 */
interface Lote {
  id: string
  colaborador_user_id: string
  colaborador_nome: string | null
  valor: number
  descricao: string
  status: 'aberto' | 'em_validacao' | 'fechado' | 'cancelado'
  saldo: number
  total_gasto: number
  qtd_despesas: number
  conta_origem_descricao: string | null
  conta_destino_descricao: string | null
  data_transferencia: string | null
  fechamento_solicitado_em: string | null
  validado_em: string | null
}

interface Pessoa {
  user_id: string
  nome: string
}

interface ContaBancaria {
  id: string
  banco: string
  descricao: string | null
}

const STATUS_LABEL: Record<Lote['status'], string> = {
  aberto: 'Aberto',
  em_validacao: 'Aguardando validação',
  fechado: 'Fechado',
  cancelado: 'Cancelado',
}

const STATUS_STYLE: Record<Lote['status'], string> = {
  aberto: 'bg-blue-50 text-blue-700',
  em_validacao: 'bg-amber-50 text-amber-700',
  fechado: 'bg-green-50 text-green-700',
  cancelado: 'bg-secondary text-ink-mute',
}

function formatMoney(valor: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(valor || 0))
}

function formatDate(valor: string | null) {
  if (!valor) return '—'
  const [ano, mes, dia] = valor.slice(0, 10).split('-')
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : valor
}

const formVazio = {
  colaborador_user_id: '',
  valor: '',
  descricao: '',
  conta_bancaria_origem_id: '',
  conta_bancaria_destino_id: '',
  data_transferencia: '',
}

export default function LotesDeDespesa() {
  const { hasPermission } = usePermissionsContext()
  const { success, error: toastError } = useToast()

  const podeGerir = hasPermission('finance.contas_pagar.write')

  const [lotes, setLotes] = useState<Lote[]>([])
  const [pessoas, setPessoas] = useState<Pessoa[]>([])
  const [contas, setContas] = useState<ContaBancaria[]>([])
  const [carregando, setCarregando] = useState(true)
  const [enviando, setEnviando] = useState(false)
  const [dialogAberto, setDialogAberto] = useState(false)
  const [form, setForm] = useState(formVazio)

  const carregarLotes = useCallback(async () => {
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data, error } = await supabase.rpc('get_lotes_despesa', {
        p_user_id: user.id,
        p_filtros: {},
      })
      if (error) throw error
      setLotes((data || []) as Lote[])
    } catch (err) {
      console.error(err)
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => {
    void carregarLotes()
  }, [carregarLotes])

  useEffect(() => {
    if (!podeGerir) return
    void (async () => {
      try {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return

        const { data: lista } = await supabase.rpc('get_pessoas_para_lote', {
          p_user_id: session.user.id,
        })
        setPessoas((lista || []) as Pessoa[])

        const { data: listas } = await supabase.rpc('cp_listas', { p_user_id: session.user.id })
        setContas(((listas as { contas_bancarias?: ContaBancaria[] })?.contas_bancarias || []))
      } catch (err) {
        console.error(err)
      }
    })()
  }, [podeGerir])

  const pessoaOptions = useMemo(
    () => pessoas.map((pessoa) => ({ value: pessoa.user_id, label: pessoa.nome })),
    [pessoas],
  )

  const contaOptions = useMemo(
    () => contas.map((c) => ({ value: c.id, label: c.descricao ? `${c.banco} — ${c.descricao}` : c.banco })),
    [contas],
  )

  const criar = async () => {
    if (!form.colaborador_user_id) { toastError('Escolha a pessoa do lote'); return }
    if (!Number(form.valor)) { toastError('Informe o valor adiantado'); return }
    if (!form.descricao.trim()) { toastError('Descreva o lote'); return }

    try {
      setEnviando(true)
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { error } = await supabase.rpc('criar_lote_despesa', {
        p_user_id: user.id,
        p_payload: {
          colaborador_user_id: form.colaborador_user_id,
          valor: Number(form.valor),
          descricao: form.descricao.trim(),
          conta_bancaria_origem_id: form.conta_bancaria_origem_id || null,
          conta_bancaria_destino_id: form.conta_bancaria_destino_id || null,
          data_transferencia: form.data_transferencia || null,
        },
      })
      if (error) throw error
      success('Lote criado')
      setDialogAberto(false)
      setForm(formVazio)
      await carregarLotes()
    } catch (err) {
      console.error(err)
      toastError(err instanceof Error ? err.message : 'Erro ao criar o lote')
    } finally {
      setEnviando(false)
    }
  }

  const validar = async (lote: Lote, acao: 'aprovar' | 'reabrir') => {
    const resumo =
      lote.saldo > 0
        ? `Sobrou ${formatMoney(lote.saldo)} — vai gerar uma conta a receber de ${lote.colaborador_nome || 'a pessoa'}.`
        : lote.saldo < 0
          ? `Faltou ${formatMoney(Math.abs(lote.saldo))} — vai gerar uma conta a pagar para ${lote.colaborador_nome || 'a pessoa'}.`
          : 'O lote fechou zerado — nenhum lançamento será criado.'

    const pergunta = acao === 'aprovar'
      ? `${resumo}\n\nAprovar e fechar o lote?`
      : 'Devolver o lote para a pessoa continuar lançando?'
    if (!window.confirm(pergunta)) return

    try {
      setEnviando(true)
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { error } = await supabase.rpc('validar_lote_despesa', {
        p_user_id: user.id,
        p_lote_id: lote.id,
        p_acao: acao,
        p_observacao: null,
      })
      if (error) throw error
      success(acao === 'aprovar' ? 'Lote fechado e acerto lançado' : 'Lote devolvido')
      await carregarLotes()
    } catch (err) {
      console.error(err)
      toastError(err instanceof Error ? err.message : 'Erro ao validar o lote')
    } finally {
      setEnviando(false)
    }
  }

  if (carregando) return <div className="h-24 animate-pulse rounded-lg bg-secondary" />

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-medium text-ink">Lotes de despesa</h2>
          <p className="text-sm text-ink-mute">
            Adiantamentos por pessoa. A transferência entre as contas do escritório fica registrada
            aqui para conferência; só a sobra ou a falta do fechamento vira lançamento.
          </p>
        </div>
        {podeGerir ? <Button onClick={() => setDialogAberto(true)}>+ Novo lote</Button> : null}
      </div>

      {lotes.length === 0 ? (
        <p className="rounded-lg border border-hairline bg-canvas-soft/40 p-4 text-sm text-ink-mute">
          Nenhum lote criado ainda.
        </p>
      ) : (
        <ul className="space-y-2">
          {lotes.map((lote) => (
            <li key={lote.id} className="rounded-lg border border-hairline bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">{lote.colaborador_nome || 'Sem nome'}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[lote.status]}`}>
                      {STATUS_LABEL[lote.status]}
                    </span>
                  </p>
                  <p className="mt-0.5 text-sm text-ink-secondary">{lote.descricao}</p>
                  <p className="mt-1 text-xs text-ink-mute">
                    Adiantado {formatMoney(lote.valor)} · gasto {formatMoney(lote.total_gasto)} em{' '}
                    {lote.qtd_despesas} lançamento{lote.qtd_despesas === 1 ? '' : 's'}
                    {lote.data_transferencia ? ` · transferido em ${formatDate(lote.data_transferencia)}` : ''}
                  </p>
                  {lote.conta_origem_descricao || lote.conta_destino_descricao ? (
                    <p className="text-xs text-ink-mute">
                      {lote.conta_origem_descricao || '—'} → {lote.conta_destino_descricao || '—'}
                    </p>
                  ) : null}
                </div>

                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-eyebrow">{lote.saldo < 0 ? 'A reembolsar' : 'Saldo'}</p>
                    <p className={`font-tabular text-xl font-light ${lote.saldo < 0 ? 'text-red-600' : 'text-ink'}`}>
                      {formatMoney(Math.abs(lote.saldo))}
                    </p>
                  </div>
                  {podeGerir && lote.status === 'em_validacao' ? (
                    <div className="flex flex-col gap-1.5">
                      <Button onClick={() => void validar(lote, 'aprovar')} disabled={enviando}>
                        Aprovar
                      </Button>
                      <Button variant="outline" onClick={() => void validar(lote, 'reabrir')} disabled={enviando}>
                        Devolver
                      </Button>
                    </div>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={dialogAberto} onOpenChange={(aberto) => { setDialogAberto(aberto); if (!aberto) setForm(formVazio) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Novo lote de despesas</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1 md:col-span-2">
              <Label>Pessoa</Label>
              <CommandSelect
                value={form.colaborador_user_id}
                onValueChange={(valor) => setForm((prev) => ({ ...prev, colaborador_user_id: valor }))}
                options={pessoaOptions}
                placeholder="Selecione a pessoa"
                searchPlaceholder="Buscar pessoa..."
                emptyText="Nenhuma pessoa encontrada."
                disabled={enviando}
              />
            </div>

            <div className="space-y-1">
              <Label>Valor adiantado</Label>
              <MoneyInput
                value={form.valor}
                onValueChange={(valor) => setForm((prev) => ({ ...prev, valor }))}
                placeholder="0,00"
                disabled={enviando}
              />
            </div>

            <div className="space-y-1">
              <Label>Data da transferência</Label>
              <DatePicker
                value={form.data_transferencia}
                onChange={(valor) => setForm((prev) => ({ ...prev, data_transferencia: valor }))}
              />
            </div>

            <div className="space-y-1 md:col-span-2">
              <Label>Descrição</Label>
              <Input
                value={form.descricao}
                onChange={(evento) => setForm((prev) => ({ ...prev, descricao: evento.target.value }))}
                placeholder="Ex: Adiantamento diligências agosto"
                disabled={enviando}
              />
            </div>

            <div className="space-y-1">
              <Label>Conta de origem</Label>
              <CommandSelect
                value={form.conta_bancaria_origem_id}
                onValueChange={(valor) => setForm((prev) => ({ ...prev, conta_bancaria_origem_id: valor }))}
                options={[{ value: '', label: 'Não informar' }, ...contaOptions]}
                placeholder="Não informar"
                searchPlaceholder="Buscar conta..."
                emptyText="Nenhuma conta cadastrada."
                disabled={enviando}
              />
            </div>

            <div className="space-y-1">
              <Label>Conta de destino</Label>
              <CommandSelect
                value={form.conta_bancaria_destino_id}
                onValueChange={(valor) => setForm((prev) => ({ ...prev, conta_bancaria_destino_id: valor }))}
                options={[{ value: '', label: 'Não informar' }, ...contaOptions]}
                placeholder="Não informar"
                searchPlaceholder="Buscar conta..."
                emptyText="Nenhuma conta cadastrada."
                disabled={enviando}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogAberto(false)} disabled={enviando}>
              Cancelar
            </Button>
            <Button onClick={() => void criar()} disabled={enviando}>
              {enviando ? 'Criando...' : 'Criar lote'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
