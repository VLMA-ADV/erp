// Etapa do ciclo do PDI que o "Meu PDI" mostra (pedido do cliente 26/10/2026).
//
//   'metas'    → autoavaliação semestral (maio/outubro): a tela tem só as metas
//                (cadastro, autoavaliação, progresso, comentário, anexos e envio).
//   'completa' → ciclo de janeiro: volta skills da carreira, DNA VLMA,
//                feedbacks mensais e o "Enviar competências".
//
// Nada foi apagado: dados, RPCs (get/salvar_minha_avaliacao_pdi) e o código das
// seções continuam lá, só não aparecem na etapa 'metas'.
//
// Para reativar em janeiro: troque ETAPA_PADRAO para 'completa' (e faça o
// deploy), ou defina NEXT_PUBLIC_PDI_ETAPA=completa no ambiente da Vercel e
// faça um redeploy — a variável vence o padrão.

export type EtapaPdi = 'metas' | 'completa'

const ETAPA_PADRAO: EtapaPdi = 'metas'

export function etapaPdi(valor: string | undefined = process.env.NEXT_PUBLIC_PDI_ETAPA): EtapaPdi {
  return valor === 'completa' || valor === 'metas' ? valor : ETAPA_PADRAO
}

/** Skills, DNA, feedbacks e "Enviar competências" aparecem no Meu PDI? */
export function mostraCompetencias(etapa: EtapaPdi = etapaPdi()): boolean {
  return etapa === 'completa'
}
