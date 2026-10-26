'use client'

import { FaixaBadge, type FaixaOpcao } from '@/components/pdi/faixa'
import { TRILHA_ROTULO, resumirPilares, type PreviaPessoa } from '@/lib/pdi/previa'

function data(iso: string | null | undefined): string | null {
  return iso ? new Date(iso).toLocaleDateString('pt-BR') : null
}

function Faixas({ regua, codigos }: { regua: FaixaOpcao[]; codigos: string[] }) {
  if (codigos.length === 0) return <span className="text-xs text-ink-mute">—</span>
  return <span className="flex flex-wrap gap-1">{codigos.map((c) => <FaixaBadge key={c} regua={regua} codigo={c} />)}</span>
}

/**
 * Avaliação prévia de uma pessoa — só leitura (pedido do cliente 26/10):
 * skills da carreira por pilar (faixa da autoavaliação × faixa do gestor) e
 * DNA VLMA (o que a pessoa escreveu/marcou). Vem de get_avaliacao_previa_pdi.
 */
export default function AvaliacaoPrevia({ pessoa, regua }: { pessoa: PreviaPessoa | undefined; regua: FaixaOpcao[] }) {
  if (!pessoa) {
    return <p className="text-xs text-ink-mute" data-testid="pdi-previa-vazia">Sem avaliação prévia gravada (skills e DNA VLMA).</p>
  }
  const pilares = resumirPilares(pessoa.skills)
  const temGestor = pilares.some((p) => p.faixas_gestor.length > 0)
  const enviada = data(pessoa.autoavaliacao_enviada_at)
  const gestor = data(pessoa.avaliacao_gestor_enviada_at)
  let trilhaAnterior = ''

  return (
    <div className="space-y-3" data-testid="pdi-previa">
      <p className="text-xs text-ink-mute">
        {enviada ? `Autoavaliação enviada em ${enviada}` : 'Autoavaliação não enviada'}
        {gestor ? ` · avaliação do gestor concluída em ${gestor}${pessoa.gestor_nome ? ` (${pessoa.gestor_nome})` : ''}` : ''}
      </p>
      <div className="grid gap-3 lg:grid-cols-2">
        <div>
          <p className="text-eyebrow mb-1.5">Skills da carreira</p>
          {pilares.length === 0 ? (
            <p className="text-xs text-ink-mute">Nenhuma faixa marcada.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-ink-mute">
                  <th className="py-1 pr-2 font-medium">Pilar</th>
                  <th className="py-1 pr-2 font-medium">Autoavaliação</th>
                  {temGestor ? <th className="py-1 font-medium">Gestor</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {pilares.map((p) => {
                  const cabecalho = p.trilha !== trilhaAnterior && p.trilha !== 'base'
                  trilhaAnterior = p.trilha
                  return [
                    cabecalho ? (
                      <tr key={`${p.trilha}-h`}><td colSpan={temGestor ? 3 : 2} className="pt-2 text-[11px] font-semibold text-ink-secondary">{TRILHA_ROTULO[p.trilha] ?? p.trilha}</td></tr>
                    ) : null,
                    <tr key={`${p.trilha}-${p.pilar_numero}`} className="align-top">
                      <td className="py-1.5 pr-2 text-ink">{p.pilar_numero}. {p.pilar_nome}</td>
                      <td className="py-1.5 pr-2"><Faixas regua={regua} codigos={p.faixas_auto} /></td>
                      {temGestor ? <td className="py-1.5"><Faixas regua={regua} codigos={p.faixas_gestor} /></td> : null}
                    </tr>,
                  ]
                })}
              </tbody>
            </table>
          )}
        </div>
        <div>
          <p className="text-eyebrow mb-1.5">DNA VLMA</p>
          {pessoa.dna.length === 0 ? (
            <p className="text-xs text-ink-mute">Nada preenchido.</p>
          ) : (
            <ul className="space-y-1.5">
              {pessoa.dna.map((d) => (
                <li key={d.numero} className="text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink"><span className="font-tabular text-primary">{d.numero}.</span> {d.nome}</span>
                    {d.faixa_auto ? <FaixaBadge regua={regua} codigo={d.faixa_auto} /> : null}
                  </div>
                  {d.texto_auto ? <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-ink-secondary" title={d.texto_auto}>{d.texto_auto}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
