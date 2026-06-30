'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { useToast } from '@/components/ui/toast'

interface PreviewPorRegra {
  casos: number
  valor_total: number
}

interface PreviewResponse {
  competencia: string
  periodo_inicio: string
  periodo_fim: string
  contratos_elegiveis: number
  casos_elegiveis: number
  ja_existentes_no_periodo: number
  estimado_itens_novos: number
  valor_estimado_total: number
  por_regra: Record<string, PreviewPorRegra>
}

const REGRA_LABEL: Record<string, string> = {
  mensal: 'Mensal',
  mensalidade_processo: 'Mensalidade de processo',
  mensalidade_carteira: 'Mensalidade de carteira',
  salario_minimo: 'Salário mínimo',
}

const MESES_PT = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

function getCurrentCompetencia(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function compOptions(): Array<{ value: string; label: string }> {
  const opts: Array<{ value: string; label: string }> = []
  const now = new Date()
  for (let i = -6; i <= 2; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const label = `${MESES_PT[d.getMonth()]} / ${d.getFullYear()}`
    opts.push({ value, label })
  }
  return opts
}

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

interface Props {
  redirectAfterSuccess?: boolean
  onSuccess?: () => void
}

export default function GerarFaturamentoMesButton({ redirectAfterSuccess = true, onSuccess }: Props) {
  const router = useRouter()
  const { success, error: toastError } = useToast()
  const supabase = createClient()

  const [open, setOpen] = useState(false)
  const [competencia, setCompetencia] = useState(getCurrentCompetencia())
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const loadPreview = useCallback(async () => {
    setLoadingPreview(true)
    setPreview(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user?.id) {
        toastError('Sem sessão ativa')
        return
      }
      const { data, error } = await supabase.rpc('gerar_faturamento_mes_preview', {
        p_user_id: session.user.id,
        p_competencia: competencia,
      })
      if (error) {
        toastError(`Erro ao calcular preview: ${error.message}`)
        return
      }
      setPreview(data as PreviewResponse)
    } catch {
      toastError('Erro inesperado ao calcular preview')
    } finally {
      setLoadingPreview(false)
    }
  }, [competencia, supabase, toastError])

  const confirmGerar = useCallback(async () => {
    if (!preview) return
    setConfirming(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        toastError('Sem sessão ativa')
        return
      }
      const resp = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/start-faturamento`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          data_inicio: preview.periodo_inicio,
          data_fim: preview.periodo_fim,
          alvo_tipo: 'itens',
        }),
      })
      const data = await resp.json()
      if (!resp.ok) {
        toastError(data.error || 'Erro ao gerar faturamento do mês')
        return
      }
      const itemsCount = typeof data === 'object' && data && 'items_count' in data
        ? Number((data as Record<string, unknown>).items_count ?? 0)
        : 0
      success(`Faturamento do mês gerado: ${itemsCount} item${itemsCount !== 1 ? 's' : ''} processado${itemsCount !== 1 ? 's' : ''}.`)
      setOpen(false)
      setPreview(null)
      onSuccess?.()
      if (redirectAfterSuccess) {
        router.push('/financeiro/fluxo-de-faturamento')
        router.refresh()
      } else {
        router.refresh()
      }
    } catch {
      toastError('Erro inesperado ao gerar faturamento do mês')
    } finally {
      setConfirming(false)
    }
  }, [preview, supabase, toastError, success, onSuccess, redirectAfterSuccess, router])

  const openModal = () => {
    setOpen(true)
    setPreview(null)
    setCompetencia(getCurrentCompetencia())
  }

  return (
    <>
      <Button onClick={openModal} className="gap-2">
        <Sparkles className="h-4 w-4" />
        Gerar faturamento do mês
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Gerar faturamento do mês</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="competencia">Competência</Label>
              <div className="flex gap-2">
                <NativeSelect
                  id="competencia"
                  value={competencia}
                  onChange={(e) => { setCompetencia(e.target.value); setPreview(null) }}
                  className="flex-1"
                >
                  {compOptions().map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </NativeSelect>
                <Button variant="outline" onClick={loadPreview} disabled={loadingPreview}>
                  {loadingPreview ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    'Calcular'
                  )}
                </Button>
              </div>
              <p className="text-[11px] text-ink-mute">
                Clique em <span className="font-medium">Calcular</span> para ver quantos itens serão gerados.
              </p>
            </div>

            {preview && (
              <div className="space-y-3 rounded-lg border bg-canvas-soft/40 p-4">
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-ink-mute">Contratos</p>
                    <p className="text-2xl font-semibold font-tabular text-ink">{preview.contratos_elegiveis}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-ink-mute">Casos elegíveis</p>
                    <p className="text-2xl font-semibold font-tabular text-ink">{preview.casos_elegiveis}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-ink-mute">Já existentes</p>
                    <p className={`text-2xl font-semibold font-tabular ${preview.ja_existentes_no_periodo > 0 ? 'text-amber-700' : 'text-ink-mute'}`}>
                      {preview.ja_existentes_no_periodo}
                    </p>
                  </div>
                </div>

                <div className="border-t pt-3">
                  <p className="mb-2 text-[11px] uppercase tracking-wider text-ink-mute">Por regra mensal</p>
                  <div className="space-y-1.5">
                    {Object.entries(preview.por_regra ?? {}).length === 0 ? (
                      <p className="text-xs text-ink-mute">Nenhuma regra elegível no período.</p>
                    ) : (
                      Object.entries(preview.por_regra ?? {})
                        .sort(([, a], [, b]) => Number(b.valor_total) - Number(a.valor_total))
                        .map(([regra, info]) => (
                          <div key={regra} className="flex items-center justify-between text-sm">
                            <span className="text-ink">{REGRA_LABEL[regra] ?? regra}</span>
                            <span className="text-ink-mute font-tabular">
                              {info.casos} caso{info.casos !== 1 ? 's' : ''} · {formatBRL(Number(info.valor_total))}
                            </span>
                          </div>
                        ))
                    )}
                  </div>
                </div>

                <div className="flex items-baseline justify-between border-t pt-3">
                  <span className="text-sm text-ink">Valor estimado total</span>
                  <span className="text-lg font-semibold text-ink font-tabular">{formatBRL(Number(preview.valor_estimado_total))}</span>
                </div>

                <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800">
                  A operação é idempotente — rodar de novo não duplica os itens já criados.
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={confirming}>
              Cancelar
            </Button>
            <Button onClick={confirmGerar} disabled={!preview || confirming || preview.casos_elegiveis === 0}>
              {confirming ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Gerando...</>
              ) : (
                'Confirmar geração'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
