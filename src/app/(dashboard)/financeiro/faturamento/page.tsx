import { redirect } from 'next/navigation'
import Link from 'next/link'
import ItensAFaturarList from '@/components/faturamento/itens-a-faturar-list'
import RevisaoDeFaturaList from '@/components/faturamento/revisao-de-fatura-list'
import GerarFaturamentoMesButton from '@/components/faturamento/gerar-faturamento-mes-button'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * Tela única de faturamento — PROTÓTIPO PARA VALIDAÇÃO.
 *
 * Junta numa página só o que hoje mora em "1. Itens a faturar" e "2. Revisão de
 * fatura", que era o pedido do cliente: parar de transbordar informação de uma
 * página para outra.
 *
 * Deliberadamente montada por COMPOSIÇÃO: reusa os dois componentes existentes sem
 * alterar nenhum deles. Se a tela for descartada, basta apagar este arquivo — as
 * telas 1, 2 e 3 continuam intactas e em uso.
 *
 * NÃO está no menu de propósito: o acesso é por link direto, para o cliente validar
 * sem que o escritório inteiro caia aqui no meio da virada.
 *
 * Pendência conhecida (fica para a rodada de setembro): a consulta que alimenta a
 * seção "aguardando liberação" não filtra por centro de custo — devolve o escritório
 * inteiro. Enquanto isso não for resolvido, esta tela é para quem já enxerga tudo.
 */
export default async function FaturamentoUnificadoPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  return (
    <div className="container mx-auto px-6 py-12">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="text-eyebrow">FINANCEIRO · PROTÓTIPO</span>
          <h1 className="mt-2 display-lg text-ink">Faturamento</h1>
          <p className="mt-2 max-w-2xl text-sm text-ink-mute">
            Tudo numa tela só: o que está aguardando liberação e o que já está em revisão.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <GerarFaturamentoMesButton redirectAfterSuccess={false} />
        </div>
      </header>

      <div className="mb-8 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <strong>Tela em validação.</strong> As telas <em>1. Itens a faturar</em>,{' '}
        <em>2. Revisão de fatura</em> e <em>3. Fluxo</em> continuam funcionando normalmente —
        nada foi desligado. Use esta aqui para dizer se o formato serve.
      </div>

      <section className="mb-12">
        <div className="mb-3 flex items-baseline gap-3">
          <h2 className="text-lg font-semibold text-ink">Aguardando liberação</h2>
          <span className="text-xs text-ink-mute">
            lançamentos e regras que ainda não foram para a revisão
          </span>
        </div>
        <ItensAFaturarList />
      </section>

      <section>
        <div className="mb-3 flex items-baseline gap-3">
          <h2 className="text-lg font-semibold text-ink">Em revisão e aprovação</h2>
          <span className="text-xs text-ink-mute">
            já liberados — revisar, aprovar e faturar
          </span>
        </div>
        <RevisaoDeFaturaList />
      </section>

      <footer className="mt-12 border-t border-hairline pt-6 text-sm text-ink-mute">
        Voltar para as telas atuais:{' '}
        <Link href="/financeiro/itens-a-faturar" className="text-primary underline underline-offset-2">
          Itens a faturar
        </Link>
        {' · '}
        <Link href="/financeiro/revisao-de-fatura" className="text-primary underline underline-offset-2">
          Revisão de fatura
        </Link>
      </footer>
    </div>
  )
}
