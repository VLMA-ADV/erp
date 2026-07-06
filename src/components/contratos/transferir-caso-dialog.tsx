'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'

interface ContratoOpt { id: string; numero: string | number | null; cliente_nome: string; status: string }

export default function TransferirCasoDialog({
  open,
  onOpenChange,
  casoId,
  contratoAtualId,
  onDone,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  casoId: string
  contratoAtualId: string
  onDone: () => void
}) {
  const { success, error: toastError } = useToast()
  const [lista, setLista] = useState<ContratoOpt[]>([])
  const [busca, setBusca] = useState('')
  const [sel, setSel] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(false)

  useEffect(() => {
    if (!open) { setBusca(''); setSel(''); return }
    const load = async () => {
      try {
        setFetching(true)
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return
        const { data, error } = await supabase.rpc('get_contratos_lista', { p_user_id: session.user.id })
        if (!error && data) setLista((data as ContratoOpt[]).filter((c) => c.id !== contratoAtualId))
      } catch (e) { console.error(e) } finally { setFetching(false) }
    }
    void load()
  }, [open, contratoAtualId])

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase()
    if (!t) return lista.slice(0, 50)
    return lista.filter((c) => `${c.cliente_nome} ${c.numero}`.toLowerCase().includes(t)).slice(0, 50)
  }, [lista, busca])

  const transferir = async () => {
    if (!sel) return
    try {
      setLoading(true)
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { toastError('Sessão expirada.'); return }
      const { error } = await supabase.rpc('transferir_caso', {
        p_user_id: session.user.id,
        p_caso_id: casoId,
        p_novo_contrato_id: sel,
      })
      if (error) { toastError(error.message || 'Erro ao transferir'); return }
      success('Caso transferido')
      onOpenChange(false)
      onDone()
    } catch (e) {
      console.error(e); toastError('Erro ao transferir caso')
    } finally { setLoading(false) }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !loading && onOpenChange(v)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Transferir caso para outro contrato</DialogTitle>
        </DialogHeader>
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por cliente ou número do contrato…"
          className="h-9 w-full rounded-md border border-hairline-input bg-background px-3 text-sm text-ink outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="mt-2 max-h-72 overflow-y-auto rounded-md border border-hairline">
          {fetching ? (
            <p className="p-4 text-sm text-ink-mute">Carregando contratos…</p>
          ) : filtrados.length === 0 ? (
            <p className="p-4 text-sm text-ink-mute">Nenhum contrato encontrado.</p>
          ) : (
            filtrados.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSel(c.id)}
                className={`flex w-full items-center justify-between gap-2 border-b border-hairline px-3 py-2 text-left text-sm last:border-b-0 hover:bg-canvas-soft ${sel === c.id ? 'bg-brand-purple-soft' : ''}`}
              >
                <span className="min-w-0 truncate text-ink">{c.cliente_nome}</span>
                <span className="shrink-0 text-xs text-ink-mute">Contrato {String(c.numero ?? '—')}</span>
              </button>
            ))
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Cancelar</Button>
          <Button onClick={() => void transferir()} disabled={!sel || loading}>
            {loading ? 'Transferindo…' : 'Transferir'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
