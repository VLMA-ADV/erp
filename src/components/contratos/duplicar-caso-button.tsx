'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { CommandSelect } from '@/components/ui/command-select'
import { Copy, Loader2 } from 'lucide-react'

interface Opt { value: string; label: string }
interface Props { contratoIdAtual: string }

export default function DuplicarCasoButton({ contratoIdAtual }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [clientes, setClientes] = useState<Opt[]>([])
  const [casos, setCasos] = useState<Opt[]>([])
  const [contratos, setContratos] = useState<Opt[]>([])
  const [clienteId, setClienteId] = useState('')
  const [origemCasoId, setOrigemCasoId] = useState('')
  const [destinoContratoId, setDestinoContratoId] = useState(contratoIdAtual)
  const [loadingClientes, setLoadingClientes] = useState(false)
  const [loadingOpcoes, setLoadingOpcoes] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const getHeaders = async () => {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return null
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    return {
      Authorization: `Bearer ${session.access_token}`,
      ...(anonKey ? { apikey: anonKey } : {}),
      'Content-Type': 'application/json',
    }
  }

  const base = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/duplicar-caso`

  const abrir = async () => {
    setOpen(true)
    setError(null)
    if (clientes.length > 0) return
    try {
      setLoadingClientes(true)
      const headers = await getHeaders()
      if (!headers) return
      const res = await fetch(base, { headers })
      const payload = await res.json().catch(() => ({}))
      if (res.ok) setClientes(((payload.data || []) as Array<{ id: string; nome: string }>).map((c) => ({ value: c.id, label: c.nome })))
    } finally {
      setLoadingClientes(false)
    }
  }

  const onCliente = async (id: string) => {
    setClienteId(id)
    setOrigemCasoId('')
    setCasos([])
    setContratos([])
    if (!id) return
    try {
      setLoadingOpcoes(true)
      const headers = await getHeaders()
      if (!headers) return
      const res = await fetch(`${base}?cliente_id=${id}`, { headers })
      const payload = await res.json().catch(() => ({}))
      if (res.ok && payload.data) {
        const cs = (payload.data.casos || []) as Array<{ id: string; numero: number; nome: string; contrato_nome: string }>
        const cts = (payload.data.contratos || []) as Array<{ id: string; numero: number; numero_sequencial: number | null; nome: string }>
        setCasos(cs.map((c) => ({ value: c.id, label: `#${c.numero} — ${c.nome} (${c.contrato_nome})` })))
        const ctOpts = cts.map((c) => ({ value: c.id, label: `Contrato ${c.numero_sequencial ?? c.numero} — ${c.nome}` }))
        setContratos(ctOpts)
        // default destino: contrato atual se for deste cliente, senão o primeiro
        setDestinoContratoId(ctOpts.some((o) => o.value === contratoIdAtual) ? contratoIdAtual : (ctOpts[0]?.value || ''))
      }
    } finally {
      setLoadingOpcoes(false)
    }
  }

  const duplicar = async () => {
    if (!origemCasoId || !destinoContratoId) {
      setError('Selecione o caso de origem e o contrato destino')
      return
    }
    try {
      setBusy(true)
      setError(null)
      const headers = await getHeaders()
      if (!headers) return
      const res = await fetch(base, {
        method: 'POST',
        headers,
        body: JSON.stringify({ origem_caso_id: origemCasoId, contrato_destino_id: destinoContratoId }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(payload.error || 'Erro ao duplicar caso')
        return
      }
      setOpen(false)
      router.push(`/contratos/${payload.contrato_id}/casos/${payload.id}/editar`)
    } catch (err) {
      console.error(err)
      setError('Erro ao duplicar caso')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={() => void abrir()}>
        <Copy className="mr-2 h-4 w-4" /> Duplicar de um caso existente
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Duplicar caso</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Cliente de origem</label>
              <CommandSelect
                value={clienteId}
                onValueChange={(v) => void onCliente(v)}
                options={clientes}
                placeholder={loadingClientes ? 'Carregando…' : 'Selecione o cliente'}
                searchPlaceholder="Buscar cliente..."
                emptyText="Nenhum cliente com casos."
                disabled={busy}
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Caso de origem</label>
              <CommandSelect
                value={origemCasoId}
                onValueChange={setOrigemCasoId}
                options={casos}
                placeholder={loadingOpcoes ? 'Carregando…' : (clienteId ? 'Selecione o caso' : 'Escolha o cliente primeiro')}
                searchPlaceholder="Buscar caso..."
                emptyText="Nenhum caso para este cliente."
                disabled={busy || !clienteId}
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Contrato destino</label>
              <CommandSelect
                value={destinoContratoId}
                onValueChange={setDestinoContratoId}
                options={contratos}
                placeholder={clienteId ? 'Selecione o contrato destino' : 'Escolha o cliente primeiro'}
                searchPlaceholder="Buscar contrato..."
                emptyText="Nenhum contrato ativo para este cliente."
                disabled={busy || !clienteId}
              />
              <p className="text-xs text-ink-mute">Os dados são copiados (sem anexos). Você poderá revisar e ajustar em seguida.</p>
            </div>

            {error ? <p className="text-sm text-red-600">{error}</p> : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancelar</Button>
            <Button onClick={() => void duplicar()} disabled={busy || !origemCasoId || !destinoContratoId}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Copy className="mr-2 h-4 w-4" />}
              Duplicar e revisar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
