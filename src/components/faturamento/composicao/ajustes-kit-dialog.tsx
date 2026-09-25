'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/native-select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { lerNumero } from '@/lib/utils/numero-br'
import { labelCompetencia, type KitCaso } from './types'

// Grupo de impostos e pagadores editáveis no kit (Filipe, 21/09, D14-b),
// enquanto a NFS-e não saiu. As opções vêm da mesma RPC da prévia
// (get_opcoes_ajuste_nota) e o formato de pagadores é o mesmo.
//
// Desde 25/09 (print 5 do Filipe: "outra PJ paga no lugar da original só
// naquele mês; o faturamento continua em nome do cliente original, só o
// pagador mudou") o ajuste vale por padrão SÓ para este kit — gravado em
// finance.kits.ajustes por salvar_ajustes_kit — e só vai para o cadastro do
// caso/contrato quando a pessoa marca "Salvar também no cadastro".
export default function AjustesKitDialog({
  kit,
  onClose,
  onSalvo,
}: {
  kit: KitCaso | null
  onClose: () => void
  onSalvo: (resultado: { alteradoNoCadastro: boolean }) => void
}) {
  const [carregando, setCarregando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [grupos, setGrupos] = useState<Array<{ id: string; nome: string }>>([])
  const [clientes, setClientes] = useState<Array<{ id: string; nome: string }>>([])
  const [grupoImpostoId, setGrupoImpostoId] = useState('')
  const [pagadores, setPagadores] = useState<Array<{ cliente_id: string; percentual: string }>>([])
  const [salvarNoCadastro, setSalvarNoCadastro] = useState(false)

  useEffect(() => {
    if (!kit) return
    setErro(null)
    setSalvarNoCadastro(false)
    // Pré-preenche com o ajuste do kit quando existe; senão com o cadastro
    // (a RPC já devolve grupo_imposto/pagadores refletindo o ajuste, mas o
    // ajustes_kit é a fonte explícita).
    const ajuste = kit.ajustes_kit
    setGrupoImpostoId(ajuste?.grupo_imposto_id ?? kit.grupo_imposto?.id ?? '')
    const pagadoresIniciais = ajuste?.pagadores?.length ? ajuste.pagadores : kit.pagadores
    setPagadores(pagadoresIniciais.map((p) => ({ cliente_id: p.cliente_id, percentual: String(Number(p.percentual || 0)) })))
    let cancelado = false
    const carregar = async () => {
      setCarregando(true)
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { setErro('Sessão expirada.'); return }
        const { data, error } = await supabase.rpc('get_opcoes_ajuste_nota', { p_user_id: user.id })
        if (error) { setErro(error.message); return }
        if (cancelado) return
        const opcoes = (data ?? {}) as { grupos?: Array<{ id: string; nome: string }>; clientes?: Array<{ id: string; nome: string }> }
        setGrupos(opcoes.grupos ?? [])
        setClientes(opcoes.clientes ?? [])
      } catch (e) {
        console.error('get_opcoes_ajuste_nota', e)
        if (!cancelado) setErro('Não foi possível carregar as opções.')
      } finally {
        if (!cancelado) setCarregando(false)
      }
    }
    void carregar()
    return () => { cancelado = true }
  }, [kit])

  const soma = pagadores.reduce((acc, p) => acc + (lerNumero(p.percentual) || 0), 0)

  const salvar = async () => {
    if (!kit || salvando) return
    setErro(null)
    // Sem caso só o grupo de impostos vale (pagadores são do caso).
    const lista = kit.caso_id
      ? pagadores
          .filter((p) => p.cliente_id)
          .map((p) => ({
            cliente_id: p.cliente_id,
            nome: clientes.find((c) => c.id === p.cliente_id)?.nome ?? null,
            percentual: lerNumero(p.percentual) || 0,
          }))
      : []
    if (kit.caso_id && lista.length === 0) { setErro('Informe ao menos um pagador.'); return }
    if (kit.caso_id && Math.abs(soma - 100) > 0.01) {
      setErro(`Os percentuais somam ${soma.toFixed(2)}%. Ajuste para 100% antes de salvar.`)
      return
    }
    const grupoMudou = (grupoImpostoId || '') !== (kit.grupo_imposto?.id ?? '')
    const pagadoresMudaram =
      lista.length !== kit.pagadores.length ||
      lista.some((p, i) => p.cliente_id !== kit.pagadores[i]?.cliente_id || Math.abs(p.percentual - Number(kit.pagadores[i]?.percentual || 0)) > 0.01)
    if (!grupoMudou && !pagadoresMudaram && !salvarNoCadastro) { onClose(); return }

    setSalvando(true)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setErro('Sessão expirada.'); return }
      // Mesmo formato de `ajustes` que emit-nfse aceita no body e que a
      // prévia monta como AjustesDaNota.
      const { data, error } = await supabase.rpc('salvar_ajustes_kit', {
        p_user_id: user.id,
        p_contrato_id: kit.contrato_id,
        p_caso_id: kit.caso_id,
        p_competencia: kit.competencia,
        p_ajustes: {
          grupo_imposto_id: grupoImpostoId || null,
          pagadores: lista.length ? lista : null,
        },
        p_salvar_no_cadastro: salvarNoCadastro,
      })
      if (error) { setErro(error.message); return }
      const r = (data ?? {}) as { ok?: boolean; alterado_no_cadastro?: boolean; motivo?: string; error?: string }
      if (r.ok === false) { setErro(r.motivo || r.error || 'Não foi possível salvar os ajustes.'); return }
      onSalvo({ alteradoNoCadastro: !!r.alterado_no_cadastro })
    } catch (e) {
      console.error('salvar_ajustes_kit', e)
      setErro('Não foi possível salvar os ajustes.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Dialog open={!!kit} onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Impostos e pagadores</DialogTitle>
          <DialogDescription>
            Vale só para este faturamento (competência {labelCompetencia(kit?.competencia)}). O cadastro do caso não muda.
            {kit && !kit.caso_id ? ' Sem caso: só o grupo de impostos pode ser alterado aqui.' : ''}
          </DialogDescription>
        </DialogHeader>

        {carregando ? (
          <div className="flex items-center gap-2 py-6 text-sm text-ink-mute">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando opções…
          </div>
        ) : (
          <div className="space-y-4 text-sm">
            <label className="block space-y-1">
              <span className="text-xs text-ink-mute">Regime tributário (grupo de impostos)</span>
              <NativeSelect value={grupoImpostoId} onChange={(e) => setGrupoImpostoId(e.target.value)}>
                <option value="">— Sem grupo definido —</option>
                {grupos.map((g) => <option key={g.id} value={g.id}>{g.nome}</option>)}
              </NativeSelect>
            </label>

            {kit?.caso_id ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-ink-mute">
                    Pagadores — os percentuais precisam somar 100% (hoje: {soma.toFixed(2)}%)
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPagadores((l) => [...l, { cliente_id: '', percentual: '0' }])}
                  >
                    Incluir pagador
                  </Button>
                </div>
                {pagadores.map((p, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <NativeSelect
                      value={p.cliente_id}
                      onChange={(e) => setPagadores((l) => l.map((x, j) => (j === i ? { ...x, cliente_id: e.target.value } : x)))}
                      className="min-w-[240px] flex-1"
                    >
                      <option value="">Selecione o cliente</option>
                      {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                    </NativeSelect>
                    <input
                      value={p.percentual}
                      onChange={(e) => setPagadores((l) => l.map((x, j) => (j === i ? { ...x, percentual: e.target.value } : x)))}
                      inputMode="decimal"
                      className="h-10 w-20 rounded-md border px-2 text-right"
                    />
                    <span className="text-xs text-ink-mute">%</span>
                    <Button size="sm" variant="outline" onClick={() => setPagadores((l) => l.filter((_, j) => j !== i))}>
                      Remover
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}

            <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-secondary">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={salvarNoCadastro}
                onChange={(e) => setSalvarNoCadastro(e.target.checked)}
              />
              Salvar também no cadastro do caso/contrato (vale para as próximas faturas)
            </label>

            {erro ? (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{erro}</p>
            ) : null}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button onClick={() => void salvar()} disabled={salvando || carregando}>
            {salvando ? 'Salvando…' : salvarNoCadastro ? 'Salvar no kit e no cadastro' : 'Salvar neste kit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
