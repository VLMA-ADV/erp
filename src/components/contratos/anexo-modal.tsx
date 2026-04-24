'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createClient } from '@/lib/supabase/client'

interface AnexoModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'contrato' | 'caso'
  targetId: string
  onSuccess: () => void
}

export default function AnexoModal({ open, onOpenChange, mode, targetId, onSuccess }: AnexoModalProps) {
  const [nome, setNome] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setNome('')
    setFile(null)
    setError(null)
  }

  const toBase64 = (f: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.readAsDataURL(f)
      reader.onload = () => {
        const result = String(reader.result || '')
        const base64 = result.includes(',') ? result.split(',')[1] : result
        resolve(base64)
      }
      reader.onerror = reject
    })

  const submit = async () => {
    setError(null)
    if (!nome.trim()) {
      setError('Nome do anexo é obrigatório')
      return
    }
    if (!file) {
      setError('Selecione um arquivo')
      return
    }

    try {
      setLoading(true)
      const base64 = await toBase64(file)
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setError('Sessão expirada')
        return
      }

      const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/${
        mode === 'contrato' ? 'create-contrato-anexo' : 'create-caso-anexo'
      }`

      const body = {
        nome,
        arquivo_nome: file.name,
        mime_type: file.type || null,
        arquivo_base64: base64,
        ...(mode === 'contrato' ? { contrato_id: targetId } : { caso_id: targetId }),
      }

      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      const data = await resp.json()
      if (!resp.ok) {
        setError(data.error || 'Erro ao enviar anexo')
        return
      }

      onOpenChange(false)
      reset()
      onSuccess()
    } catch (e) {
      console.error(e)
      setError('Erro ao enviar anexo')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v)
        if (!v) reset()
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === 'contrato' ? 'Inserir Anexo do Contrato' : 'Inserir Anexo do Caso'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {error && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</div>
          )}

          <div className="space-y-2">
            <Label htmlFor="anexo_nome">Nome do anexo</Label>
            <Input
              id="anexo_nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex: Contrato assinado"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="anexo_file">Arquivo</Label>
            <Input
              id="anexo_file"
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={loading}>
            {loading ? 'Enviando...' : 'Enviar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
