'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { RotateCcw, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'

// Reinicia o faturamento do mês corrente para testes ponta a ponta (só admin).
// Apaga itens/lotes do período e devolve os timesheets para lançamento.
// O RPC recusa se houver nota fiscal emitida no período.
export default function ResetFaturamentoButton() {
  const router = useRouter()
  const supabase = createClient()
  const { success, error: toastError } = useToast()
  const [busy, setBusy] = useState(false)

  const reset = async () => {
    const inicio = new Date()
    inicio.setDate(1)
    const fim = new Date(inicio.getFullYear(), inicio.getMonth() + 1, 0)
    const label = inicio.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
    if (!window.confirm(`Reiniciar o faturamento de ${label}? Itens e lotes do período serão apagados e as horas voltam para lançamento. (Ação de teste — não afeta timesheets nem contratos.)`)) return
    try {
      setBusy(true)
      const { data, error } = await supabase.rpc('reset_faturamento_periodo', {
        p_data_inicio: inicio.toISOString().slice(0, 10),
        p_data_fim: fim.toISOString().slice(0, 10),
      })
      if (error) {
        toastError(error.message || 'Erro ao reiniciar faturamento')
        return
      }
      const r = data as { itens_removidos?: number; lotes_removidos?: number; timesheets_devolvidos?: number }
      success(`Faturamento reiniciado: ${r?.itens_removidos ?? 0} itens e ${r?.lotes_removidos ?? 0} lotes removidos; ${r?.timesheets_devolvidos ?? 0} horas devolvidas ao lançamento.`)
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button variant="outline" className="text-destructive hover:bg-destructive/5" onClick={() => void reset()} disabled={busy}>
      {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
      Reiniciar mês (teste)
    </Button>
  )
}
