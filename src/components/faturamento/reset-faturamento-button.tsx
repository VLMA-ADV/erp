'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { RotateCcw, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'

// Botão de emergência: zera o faturamento do mês corrente.
// Apaga itens/lotes do período e devolve os timesheets para lançamento — NÃO apaga
// hora lançada. O RPC recusa se houver nota fiscal emitida no período.
//
// Salvaguardas (pedido do cliente, 28/07): nome que diz a verdade (antes era
// "Reiniciar mês (teste)", que minimizava), confirmação exigindo digitar o mês,
// botão escondido de quem não tem a capacidade, e registro de quem apertou.
export default function ResetFaturamentoButton() {
  const router = useRouter()
  const supabase = createClient()
  const { success, error: toastError } = useToast()
  const { hasPermission } = usePermissionsContext()
  const [busy, setBusy] = useState(false)

  // O RPC exige finance.faturamento.manage; esconder o botão de quem tomaria erro.
  const podeZerar = hasPermission('finance.faturamento.manage') || hasPermission('finance.*') || hasPermission('*')
  if (!podeZerar) return null

  const reset = async () => {
    const inicio = new Date()
    inicio.setDate(1)
    const fim = new Date(inicio.getFullYear(), inicio.getMonth() + 1, 0)
    const mes = inicio.toLocaleDateString('pt-BR', { month: 'long' }).toLowerCase()
    const label = inicio.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })

    // Confirmação por digitação: impede clique acidental numa ação que apaga o mês.
    const digitado = window.prompt(
      `ZERAR O FATURAMENTO DE ${label.toUpperCase()}\n\n` +
      `Os itens e lotes do período serão APAGADOS e todo o trabalho de revisão do mês será perdido.\n` +
      `As horas lançadas NÃO são apagadas — voltam para "em lançamento" e podem ser reenviadas.\n\n` +
      `Para confirmar, digite o mês: ${mes}`,
      '',
    )
    if (digitado === null) return
    if (digitado.trim().toLowerCase() !== mes) {
      toastError('Confirmação não confere — nada foi alterado.')
      return
    }

    try {
      setBusy(true)
      const p_data_inicio = inicio.toISOString().slice(0, 10)
      const p_data_fim = fim.toISOString().slice(0, 10)
      const { data, error } = await supabase.rpc('reset_faturamento_periodo', { p_data_inicio, p_data_fim })
      if (error) {
        toastError(error.message || 'Erro ao zerar o faturamento')
        return
      }
      const r = data as { itens_removidos?: number; lotes_removidos?: number; timesheets_devolvidos?: number }
      success(
        `Faturamento zerado: ${r?.itens_removidos ?? 0} itens e ${r?.lotes_removidos ?? 0} lotes removidos; ` +
        `${r?.timesheets_devolvidos ?? 0} horas devolvidas ao lançamento.`,
      )

      // Registro de quem apertou. Falha aqui não desfaz nem bloqueia o que já foi feito.
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const { data: tenantRows } = await supabase.rpc('get_user_tenant', { p_user_id: session?.user?.id })
        const tenantId = Array.isArray(tenantRows) ? tenantRows[0]?.tenant_id : null
        if (tenantId && session?.user?.id) {
          await supabase.rpc('create_audit_log', {
            p_tenant_id: tenantId,
            p_tipo_entidade: 'faturamento',
            p_entidade_id: null,
            p_acao: 'zerar_faturamento_mes',
            p_user_id: session.user.id,
            p_dados_anteriores: null,
            p_dados_novos: { periodo_inicio: p_data_inicio, periodo_fim: p_data_fim, ...(r || {}) },
            p_ip_address: null,
            p_user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
          })
        }
      } catch (logErr) {
        console.error('audit zerar_faturamento_mes', logErr)
      }

      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button
      variant="outline"
      className="text-destructive hover:bg-destructive/5"
      onClick={() => void reset()}
      disabled={busy}
      title="Apaga o faturamento do mês corrente. As horas lançadas não são apagadas."
    >
      {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
      Zerar faturamento do mês
    </Button>
  )
}
