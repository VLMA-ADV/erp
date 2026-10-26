'use client'

import Link from 'next/link'
import PainelMetas from '@/components/pdi/painel-metas'

const ANO = 2026

export default function PainelMetasPage() {
  return (
    <div className="container mx-auto px-6 py-10">
      <header className="mb-6">
        <span className="text-eyebrow">PESSOAS · PDI {ANO} · METAS</span>
        <h1 className="mt-2 display-lg text-ink">Painel de metas</h1>
        <p className="mt-2 text-sm text-ink-mute">Evolução das metas do PDI por pessoa, meta e período — progresso e autoavaliação.</p>
        <Link href="/avaliacoes-pdi" className="mt-3 inline-block text-sm text-primary underline underline-offset-2">← Avaliações PDI</Link>
      </header>
      <PainelMetas ano={ANO} />
    </div>
  )
}
