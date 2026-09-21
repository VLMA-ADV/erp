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
import type { KitCaso } from './types'

// Grupo de impostos e pagadores editáveis no kit (Filipe, 21/09, D14-b),
// enquanto a NFS-e não saiu. É o mesmo par de RPCs que o bloco "Ajustes desta
// nota" da prévia usa (get_opcoes_ajuste_nota + aplicar_ajustes_no_cadastro),
// e o mesmo formato de pagadores [{cliente_id, percentual}] — aqui grava
// direto no cadastro (contrato + caso), sem "só nesta nota": a nota ainda não
// existe, o que vale é o cadastro.
export default function AjustesKitDialog({
  kit,
  onClose,
  onSalvo,
}: {
  kit: KitCaso | null
  onClose: () => void
  onSalvo: () => void
}) {
  const [carregando, setCarregando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [grupos, setGrupos] = useState<Array<{ id: string; nome: string }>>([])
  const [clientes, setClientes] = useState<Array<{ id: string; nome: string }>>([])
  const [grupoImpostoId, setGrupoImpostoId] = useState('')
  const [pagadores, setPagadores] = useState<Array<{ cliente_id: string; percentual: string }>>([])

  useEffect(() => {
    if (!kit) return
    setErro(null)
    setGrupoImpostoId(kit.grupo_imposto?.id ?? '')
    setPagadores(kit.pagadores.map((p) => ({ cliente_id: p.cliente_id, percentual: String(Number(p.percentual || 0)) })))
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
    const lista = pagadores
      .filter((p) => p.cliente_id)
      .map((p) => ({ cliente_id: p.cliente_id, percentual: lerNumero(p.percentual) || 0 }))
    if (lista.length === 0) { setErro('Informe ao menos um pagador.'); return }
    if (Math.abs(soma - 100) > 0.01) {
      setErro(`Os percentuais somam ${soma.toFixed(2)}%. Ajuste para 100% antes de salvar.`)
      return
    }
    const grupoMudou = (grupoImpostoId || '') !== (kit.grupo_imposto?.id ?? '')
    const pagadoresMudaram =
      lista.length !== kit.pagadores.length ||
      lista.some((p, i) => p.cliente_id !== kit.pagadores[i]?.cliente_id || Math.abs(p.percentual - Number(kit.pagadores[i]?.percentual || 0)) > 0.01)
    if (!grupoMudou && !pagadoresMudaram) { onClose(); return }

    setSalvando(true)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setErro('Sessão expirada.'); return }
      const { error } = await supabase.rpc('aplicar_ajustes_no_cadastro', {
        p_user_id: user.id,
        p_contrato_id: kit.contrato_id,
        p_caso_id: kit.caso_id,
        p_pagadores: pagadoresMudaram ? lista : null,
        p_grupo_imposto_id: grupoMudou && grupoImpostoId ? grupoImpostoId : null,
        p_dia_pagamento: null,
        p_valor_fixo: null,
      })
      if (error) { setErro(error.message); return }
      onSalvo()
    } catch (e) {
      console.error('aplicar_ajustes_no_cadastro', e)
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
            {kit?.caso_id
              ? 'Vale para o cadastro do caso (pagadores) e do contrato (grupo de impostos), a partir da próxima NFS-e.'
              : 'Sem caso: só o grupo de impostos do contrato pode ser alterado aqui.'}
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

            {erro ? (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{erro}</p>
            ) : null}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button onClick={() => void salvar()} disabled={salvando || carregando}>
            {salvando ? 'Salvando…' : 'Salvar no cadastro'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
