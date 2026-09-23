'use client'

import { useEffect, useState } from 'react'

function iniciais(nome?: string | null) {
  const partes = String(nome || '').trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) return '?'
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase()
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase()
}

/**
 * Mesma regra do inbox de mensagens: foto_url vem crua da RPC e pode não abrir
 * (path antigo, bucket privado); se a imagem falhar, cai nas iniciais em vez de
 * mostrar ícone quebrado.
 */
export default function AvatarAutor({
  nome,
  foto,
  tamanho = 'md',
}: {
  nome?: string | null
  foto?: string | null
  tamanho?: 'sm' | 'md'
}) {
  const [fotoQuebrada, setFotoQuebrada] = useState(false)
  useEffect(() => setFotoQuebrada(false), [foto])
  const dim = tamanho === 'sm' ? 'h-7 w-7 text-[10px]' : 'h-9 w-9 text-xs'
  if (foto && !fotoQuebrada) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={foto}
        alt=""
        className={`${dim} shrink-0 rounded-full object-cover`}
        onError={() => setFotoQuebrada(true)}
      />
    )
  }
  return (
    <span
      className={`${dim} flex shrink-0 items-center justify-center rounded-full bg-sky-100 font-semibold text-sky-700`}
      title={nome || undefined}
    >
      {iniciais(nome)}
    </span>
  )
}
