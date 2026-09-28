'use client'

import { formatRateio, type SolicitacaoContratoItem } from './solicitacao-contrato-api'

/**
 * Campos que quem monta o contrato precisa ler sem abrir a solicitação
 * (Filipe 07/08), agora nos blocos do formulário de 28/09. Usado na lista e
 * na caixa de entrada. Só mostra o que foi preenchido.
 */
export default function SolicitacaoContratoDetalhes({ item }: { item: SolicitacaoContratoItem }) {
  const rateio = formatRateio(item.centro_custo_rateio) || item.centro_custo_nome || ''
  const servico = [
    rateio ? ['Centro de custo', rateio] : null,
    item.servico_nome ? ['Serviço', item.servico_nome] : null,
    item.produto_nome ? ['Produto', item.produto_nome] : null,
    item.timesheet_descricao ? ['Timesheet', item.timesheet_descricao] : null,
    item.responsavel_vlma_nome ? ['Responsável', item.responsavel_vlma_nome] : null,
  ].filter((entry): entry is [string, string] => entry !== null)
  const financeiro = [
    item.regra_cobranca_texto ? ['Cobrança', item.regra_cobranca_texto] : null,
    item.indicacao_cross_sell ? ['Indicação', item.indicacao_cross_sell] : null,
    item.contatos_financeiro ? ['Financeiro', item.contatos_financeiro] : null,
  ].filter((entry): entry is [string, string] => entry !== null)

  if (servico.length === 0 && financeiro.length === 0) return null

  return (
    <div className="mt-2 space-y-1.5 text-xs">
      {servico.length ? (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-0.5 sm:grid-cols-2">
          {servico.map(([label, value]) => (
            <div key={label} className={label === 'Centro de custo' ? 'sm:col-span-2' : ''}>
              <dt className="inline text-ink-mute">{label}: </dt>
              <dd className="inline whitespace-pre-wrap text-ink-secondary">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {financeiro.length ? (
        <dl className="grid grid-cols-1 gap-y-0.5">
          {financeiro.map(([label, value]) => (
            <div key={label}>
              <dt className="inline text-ink-mute">{label}: </dt>
              <dd className="inline whitespace-pre-wrap text-ink-secondary">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  )
}
