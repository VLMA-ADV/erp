'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Loader2, Send } from 'lucide-react'

interface Mensagem {
  id: string
  mensagem: string
  created_at: string
  autor_id: string
  autor: {
    id: string
    nome_completo: string
  } | null
}

interface Props {
  solicitacaoId: string
}

function formatDateTime(value: string) {
  const dt = new Date(value)
  if (Number.isNaN(dt.getTime())) return '-'
  return dt.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function SolicitacaoMensagens({ solicitacaoId }: Props) {
  const [mensagens, setMensagens] = useState<Mensagem[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [texto, setTexto] = useState('')
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

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

  const fetchMensagens = async () => {
    try {
      setLoading(true)
      setError(null)
      const headers = await getHeaders()
      if (!headers) return

      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-solicitacao-mensagens?solicitacao_id=${solicitacaoId}`,
        { method: 'GET', headers },
      )
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(payload.error || 'Erro ao carregar mensagens')
        return
      }
      setMensagens((payload.data || []) as Mensagem[])
    } catch (err) {
      console.error(err)
      setError('Erro ao carregar mensagens')
    } finally {
      setLoading(false)
    }
  }

  const enviarMensagem = async () => {
    if (!texto.trim()) return
    try {
      setSending(true)
      setError(null)
      const headers = await getHeaders()
      if (!headers) return

      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/create-solicitacao-mensagem`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ solicitacao_id: solicitacaoId, mensagem: texto.trim() }),
        },
      )
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(payload.error || 'Erro ao enviar mensagem')
        return
      }
      setTexto('')
      await fetchMensagens()
    } catch (err) {
      console.error(err)
      setError('Erro ao enviar mensagem')
    } finally {
      setSending(false)
    }
  }

  useEffect(() => {
    void fetchMensagens()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solicitacaoId])

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [mensagens])

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-slate-800">Histórico de atualizações</h3>

      <div
        ref={listRef}
        className="max-h-64 min-h-[80px] overflow-y-auto rounded-lg border bg-slate-50 p-3 space-y-3"
      >
        {loading ? (
          <p className="text-xs text-slate-500">Carregando mensagens...</p>
        ) : mensagens.length === 0 ? (
          <p className="text-xs text-slate-500">Nenhuma mensagem ainda.</p>
        ) : (
          mensagens.map((msg) => (
            <div key={msg.id} className="rounded-md bg-white border p-3 text-sm shadow-sm">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="font-medium text-slate-800 text-xs">
                  {msg.autor?.nome_completo || 'Usuário'}
                </span>
                <span className="text-xs text-slate-400">{formatDateTime(msg.created_at)}</span>
              </div>
              <p className="whitespace-pre-wrap text-slate-700">{msg.mensagem}</p>
            </div>
          ))
        )}
      </div>

      {error && (
        <p className="text-xs text-red-600">{error}</p>
      )}

      <div className="flex gap-2">
        <Textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Escreva uma atualização..."
          rows={2}
          className="flex-1 resize-none"
          disabled={sending}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              void enviarMensagem()
            }
          }}
        />
        <Button
          size="sm"
          onClick={() => void enviarMensagem()}
          disabled={sending || !texto.trim()}
          className="self-end"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          <span className="ml-1 hidden sm:inline">Enviar atualização</span>
        </Button>
      </div>
      <p className="text-xs text-slate-400">Ctrl+Enter para enviar</p>
    </div>
  )
}
