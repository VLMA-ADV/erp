'use client'

import { useEffect, useMemo, useState } from 'react'
import { Mail, Paperclip, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export interface FaturaEmailData {
  clienteNome: string
  contratoLabel: string
  destinatarioEmail?: string | null
  nfseNumero?: string | null
  mesReferencia: string
  vencimento: string
  anexos: string[]
  // determina o template: completo (horas/despesas) x simples (projeto/manutenção)
  completo: boolean
}

// Templates de cobrança fornecidos pelo escritório (enviados via Resend).
function montarCorpo(data: FaturaEmailData) {
  const nfse = data.nfseNumero || '____'
  const tratamento = `Sr. ${data.clienteNome}, boa tarde.`
  if (data.completo) {
    return `${tratamento}

Segue anexa a NFSe ${nfse}, referente às horas trabalhadas no mês de ${data.mesReferencia}, a nota de despesas cujas custas foram adiantadas pelo escritório, assim como os boletos bancários para pagamento, com vencimento em ${data.vencimento}.

Além disso, segue também o relatório para conferência.

Gentileza acusar o recebimento desta mensagem.

Atenciosamente,`
  }
  return `${tratamento}

Segue anexa a NFSe ${nfse} referente ao projeto contratado para a taxa de manutenção, assim como o boleto bancário para pagamento com vencimento em ${data.vencimento}.

Gentileza acusar o recebimento desta mensagem.

Atenciosamente,`
}

export default function FaturaEmailPreview({
  open,
  onClose,
  data,
  onEnviar,
}: {
  open: boolean
  onClose: () => void
  data: FaturaEmailData | null
  onEnviar: () => void
}) {
  const [para, setPara] = useState('')
  const [assunto, setAssunto] = useState('')
  const [corpo, setCorpo] = useState('')

  const corpoPadrao = useMemo(() => (data ? montarCorpo(data) : ''), [data])

  useEffect(() => {
    if (!data) return
    setPara(data.destinatarioEmail || '')
    setAssunto(`VLMA Advogados — Fatura ${data.contratoLabel}`)
    setCorpo(corpoPadrao)
  }, [data, corpoPadrao])

  return (
    <Dialog open={open} onOpenChange={(value) => (!value ? onClose() : undefined)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4" />
            Pré-visualização do e-mail ao cliente
          </DialogTitle>
          <DialogDescription>
            Como a mensagem chegará ao cliente (enviada via Resend). Revise antes de aprovar o envio.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="email-para">Para</Label>
            <Input
              id="email-para"
              value={para}
              onChange={(event) => setPara(event.target.value)}
              placeholder="e-mail cadastrado do cliente"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="email-assunto">Assunto</Label>
            <Input id="email-assunto" value={assunto} onChange={(event) => setAssunto(event.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="email-corpo">Mensagem</Label>
            <Textarea
              id="email-corpo"
              value={corpo}
              onChange={(event) => setCorpo(event.target.value)}
              className="min-h-[200px] whitespace-pre-wrap"
            />
          </div>

          {data && data.anexos.length > 0 ? (
            <div className="rounded-md border bg-muted/30 p-3">
              <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">Anexos</p>
              <ul className="space-y-1">
                {data.anexos.map((anexo) => (
                  <li key={anexo} className="flex items-center gap-2 text-sm text-ink">
                    <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
                    {anexo}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
          <Button onClick={onEnviar}>
            <Send className="mr-2 h-4 w-4" />
            Aprovar e enviar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
