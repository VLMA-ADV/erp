'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

// Foto dos colaboradores por nome (pedido 21/07: avatares no timesheet e nas
// etapas 1 e 3 do faturamento, como já existe na revisão). Busca única por tela.
function normalizeNome(nome: string) {
  return nome
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

export function useFotosColaboradores() {
  const [fotos, setFotos] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    const load = async () => {
      try {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/list-colaboradores?page=1&limit=500&_ts=${Date.now()}`,
          {
            method: 'GET',
            cache: 'no-store',
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              'Content-Type': 'application/json',
            },
          },
        )
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) return
        const raw = Array.isArray(payload.data)
          ? payload.data
          : Array.isArray(payload.colaboradores)
            ? payload.colaboradores
            : []
        const map = new Map<string, string>()
        for (const c of raw as Array<{ nome?: string; foto_url?: string | null }>) {
          if (c?.nome && c?.foto_url) map.set(normalizeNome(c.nome), c.foto_url)
        }
        setFotos(map)
      } catch (err) {
        console.error(err)
      }
    }
    void load()
  }, [])

  return (nome: string | null | undefined) => (nome ? fotos.get(normalizeNome(nome)) || null : null)
}

// Avatar (foto ou iniciais) + nome — mesmo visual da revisão de fatura.
export function iniciaisDe(nome: string) {
  return (
    (nome || '?')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() || '')
      .join('') || '?'
  )
}
