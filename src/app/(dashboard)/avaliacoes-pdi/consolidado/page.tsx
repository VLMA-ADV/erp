'use client'

import Link from 'next/link'
import PdiConsolidado from '@/components/pdi/pdi-consolidado'

export default function ConsolidadoPage() {
  return (
    <div className="container mx-auto px-6 py-10">
      <header className="mb-6">
        <span className="text-eyebrow">PESSOAS · PDI 2026 · CONSOLIDAÇÃO</span>
        <h1 className="mt-2 display-lg text-ink">Consolidação do PDI</h1>
        <p className="mt-2 text-sm text-ink-mute">Visão geral do ciclo por área, hierarquia e faixa — onde atuar prioritariamente.</p>
        <Link href="/avaliacoes-pdi" className="mt-3 inline-block text-sm text-primary underline underline-offset-2">← Avaliações PDI</Link>
      </header>
      <PdiConsolidado />
    </div>
  )
}
