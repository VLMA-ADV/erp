'use client'

import { useState } from 'react'
import RevisaoDeFaturaList from '@/components/faturamento/revisao-de-fatura-list'
import GerarFaturamentoMesButton from '@/components/faturamento/gerar-faturamento-mes-button'
import ResetFaturamentoButton from '@/components/faturamento/reset-faturamento-button'
import { competenciaAtual } from '@/lib/faturamento/competencia'

/**
 * Tela única de faturamento (client). A page só autentica e monta isto.
 *
 * O estado compartilhado é um só: a competência da aba ativa da Revisão. Ela
 * nasce na lista (que lê o localStorage do usuário e as competências abertas)
 * e sobe por callback; daqui desce para o "Gerar faturamento do mês", que
 * passa a gerar o mês da aba — não o mês corrente.
 */
export default function FaturamentoUnificado() {
  const [competencia, setCompetencia] = useState(competenciaAtual())

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="text-eyebrow">FINANCEIRO</span>
          <h1 className="mt-2 display-lg text-ink">Faturamento</h1>
          <p className="mt-2 max-w-2xl text-sm text-ink-mute">
            Uma aba por mês de faturamento: o que ainda está na fila, o que está em revisão e
            aprovação, e o que já foi faturado.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ResetFaturamentoButton />
          <GerarFaturamentoMesButton redirectAfterSuccess={false} competencia={competencia} />
        </div>
      </header>

      <RevisaoDeFaturaList onCompetenciaChange={setCompetencia} />
    </>
  )
}
