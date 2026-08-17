'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import ContasAPagarDashboard from './contas-a-pagar-dashboard'
import LotesDeDespesa from './lotes-de-despesa'

/**
 * Abas do módulo de contas a pagar e receber.
 *
 * Filipe, 17/08: "Lote - transformar esse botão visível na tela em uma aba em
 * cima do mês, e aí ao clicar eu visualizo os lotes das pessoas".
 *
 * Antes os lotes ocupavam um bloco fixo no topo da página, acima do fluxo do
 * mês — o financeiro passava por eles todo dia para chegar no que usa toda
 * hora. Agora são duas abas e o fluxo abre primeiro.
 *
 * O NÚMERO NA ABA é o aviso que ele pediu ("o fechar o lote deve mandar aviso
 * para o financeiro para poder baixar"). Não existe sistema de notificação
 * nenhum no ERP hoje, e inventar um (e-mail, push, caixa de entrada) para um
 * caso só seria construir a coisa errada. Quando alguém fecha o lote, ele
 * entra em "aguardando validação" e o contador aparece na aba — o financeiro
 * vê ao abrir a tela, que é onde ele já está.
 */
export default function ContasAPagarAbas() {
  const [aba, setAba] = useState<'fluxo' | 'lotes'>('fluxo')
  const [aguardando, setAguardando] = useState(0)

  const contar = useCallback(async () => {
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase.rpc('get_lotes_despesa', {
        p_user_id: user.id,
        p_filtros: { status: 'em_validacao' },
      })
      const lista = Array.isArray(data) ? data : (data as { lotes?: unknown[] } | null)?.lotes
      setAguardando(Array.isArray(lista) ? lista.length : 0)
    } catch {
      // Contador é enfeite: se falhar, a aba aparece sem número em vez de
      // derrubar a tela inteira do financeiro.
      setAguardando(0)
    }
  }, [])

  useEffect(() => { void contar() }, [contar])

  const ABAS = [
    { key: 'fluxo' as const, label: 'Fluxo do mês' },
    { key: 'lotes' as const, label: 'Lotes de despesa' },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-1 border-b border-hairline">
        {ABAS.map((a) => (
          <button
            key={a.key}
            onClick={() => setAba(a.key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
              aba === a.key
                ? 'border-primary text-ink'
                : 'border-transparent text-ink-mute hover:text-ink'
            }`}
          >
            {a.label}
            {a.key === 'lotes' && aguardando > 0 ? (
              <span
                title={`${aguardando} lote(s) fechado(s) esperando você baixar`}
                className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800"
              >
                {aguardando}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {aba === 'fluxo' ? <ContasAPagarDashboard /> : <LotesDeDespesa onMudou={contar} />}
    </div>
  )
}
