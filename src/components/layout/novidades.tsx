'use client'

import { useState, useEffect } from 'react'

export const APP_VERSION = '1.24.1'

interface ChangeItem {
  title: string
  desc: string
}
interface Release {
  version: string
  date: string
  destaque?: boolean
  items: ChangeItem[]
}

// Mantenha o mais recente no topo. `destaque` realça o release novo.
const CHANGELOG: Release[] = [
  {
    version: '1.24.1',
    date: '09/07/2026',
    destaque: true,
    items: [
      {
        title: 'Revisão de fatura: histórico mais simples',
        desc: 'No histórico de cada item, as colunas "Autor" e "Responsável" viraram uma só ("Responsável"), ao lado da etapa. E os papéis passaram a se chamar Envio / Revisão / Aprovação (em vez de Usuário / Revisor / Aprovador).',
      },
    ],
  },
  {
    version: '1.24.0',
    date: '09/07/2026',
    destaque: false,
    items: [
      {
        title: 'Horas de casos "projeto" aparecem na aba Projeto',
        desc: 'Quando um caso é do tipo projeto mas tem horas lançadas, essas horas passam a aparecer para aprovação na aba "Projeto" (Revisão de fatura e Fluxo de faturamento), e não mais em "Horas".',
      },
    ],
  },
  {
    version: '1.23.2',
    date: '08/07/2026',
    destaque: false,
    items: [
      {
        title: 'Timesheet: horas visíveis por centro de custo',
        desc: 'Coordenadores e sócios de uma área passam a ver as horas apenas das pessoas do seu centro de custo. Sócios diretores continuam vendo o escritório todo.',
      },
      {
        title: 'Revisão de fatura: por centro de custo + revisor automático',
        desc: 'Na revisão de fatura, cada coordenador/sócio vê apenas os itens do seu centro de custo (diretores e financeiro veem tudo). E, quando o caso usa revisor automático por centro de custo, o revisor passa a ser o coordenador da área — some o "Sem revisor definido".',
      },
    ],
  },
  {
    version: '1.23.1',
    date: '08/07/2026',
    destaque: false,
    items: [
      {
        title: 'Correção: enviar caso de salário mínimo para faturamento',
        desc: 'Casos com regra "salário mínimo" que davam "nenhum item disponível" ao enviar para revisão passam a gerar o item corretamente (valor = quantidade de SM × salário mínimo vigente).',
      },
    ],
  },
  {
    version: '1.23.0',
    date: '08/07/2026',
    destaque: false,
    items: [
      {
        title: 'CRM: filtro por intervalo de datas',
        desc: 'No pipeline do CRM, o filtro de mês virou um seletor de datas (De / até), que ocupa menos espaço e permite qualquer intervalo.',
      },
      {
        title: 'Timesheet: duração em horas e minutos',
        desc: 'A coluna de tempo do timesheet passa a mostrar a duração como "Xh Ymin" (ex.: 2h 30min) em vez de só o total de minutos.',
      },
      {
        title: 'Gráficos: detalhe ao passar o mouse',
        desc: 'Nos gráficos de rosca (donut) e na evolução mensal de contratos, ao passar o mouse aparece o detalhe da métrica (rótulo, valor e percentual).',
      },
    ],
  },
  {
    version: '1.22.0',
    date: '08/07/2026',
    destaque: false,
    items: [
      {
        title: 'Correção: solicitar novo contrato',
        desc: 'Corrigido o erro ao salvar uma solicitação de contrato com centro de custo — a validação apontava para a tabela errada. Agora salva normalmente.',
      },
      {
        title: 'Contratos: editar abre em nova aba',
        desc: 'Os botões de visualizar e editar contrato agora abrem em uma nova aba, sem perder a lista.',
      },
      {
        title: 'Contratos: contrato clicável nos indicadores',
        desc: 'Nos detalhamentos dos indicadores (ex.: "Regra de cobrança"), o nome do contrato virou link e abre o contrato em nova aba.',
      },
      {
        title: 'Logo VLMA na tela de login',
        desc: 'A tela de login agora exibe a marca VLMA.',
      },
      {
        title: 'Alterar a própria senha pelo painel',
        desc: 'Novo "Meu perfil" (rodapé do menu) onde cada usuário pode alterar a própria senha sem precisar do fluxo de "esqueci minha senha".',
      },
    ],
  },
  {
    version: '1.21.2',
    date: '08/07/2026',
    items: [
      {
        title: 'Revisão de fatura: quem enviou e quem revisa',
        desc: 'Na revisão de fatura, a tela agora mostra de forma confiável quem lançou/enviou a origem (timesheet ou regra) e quem é o revisor. Quando o caso não tem revisor cadastrado, aparece "Sem revisor definido" em vez de ficar em branco.',
      },
    ],
  },
  {
    version: '1.21.1',
    date: '07/07/2026',
    items: [
      {
        title: 'Faturamento: casos de salário mínimo em "Itens a faturar"',
        desc: 'Casos com regra "Mensalidade de processo" no formato salário mínimo passam a aparecer na etapa "Itens a faturar", com o valor calculado (quantidade de SM × salário mínimo vigente). Antes eles ficavam invisíveis nessa etapa.',
      },
    ],
  },
  {
    version: '1.21.0',
    date: '06/07/2026',
    items: [
      {
        title: 'Contratos: conciliação financeira das parcelas',
        desc: 'Na configuração de parcelas do caso, cada parcela agora pode ser marcada como "Faturada" (NF emitida) e "Paga" (crédito baixado), com data de registro. O financeiro acompanha o que já foi emitido e recebido, parcela a parcela.',
      },
    ],
  },
  {
    version: '1.20.0',
    date: '06/07/2026',
    items: [
      {
        title: 'Contratos: transferir caso',
        desc: 'Nas ações do caso, o botão "Transferir" permite mover o caso para outro contrato, com busca por cliente ou número do contrato.',
      },
      {
        title: 'Contratos: valor fechado no mês por regra',
        desc: 'Novo indicador no painel com o valor dos casos fechados no mês, por regra de cobrança (projeto = valor total, hora = valor da hora, mensalidade = projeção anual).',
      },
      {
        title: 'Timesheet: lista cronológica',
        desc: 'Os lançamentos passam a ser agrupados por dia (com total de minutos), facilitando a leitura do que foi lançado em cada data.',
      },
      {
        title: 'Usabilidade: abrir em nova aba e permanecer na tela',
        desc: 'Visualizar um caso agora abre em nova aba. E ao salvar a edição de cliente, colaborador ou prestador, você permanece na própria tela (não volta mais para a lista).',
      },
      {
        title: 'Identidade visual',
        desc: 'Ajuste das cores para seguir o manual de marca oficial (laranja, roxo-escuro e vermelho).',
      },
    ],
  },
  {
    version: '1.19.0',
    date: '05/07/2026',
    items: [
      {
        title: 'PDI: consolidação do ciclo',
        desc: 'Novo painel de consolidação para sócios e coordenadores: indicadores do ciclo, "onde atuar prioritariamente" (críticos, em risco, discrepâncias, a melhorar), progresso por área e por hierarquia, distribuição por faixa, ranking de pessoas e autoavaliação × progresso.',
      },
      {
        title: 'Timesheet: minhas horas',
        desc: 'Resumo pessoal no topo do Timesheet para todo colaborador — horas de hoje, da semana e do mês, com quebra por cliente e por caso. A tela ganhou as abas "Meus lançamentos" e "Gestão da equipe".',
      },
    ],
  },
  {
    version: '1.18.0',
    date: '05/07/2026',
    items: [
      {
        title: 'Abas em telas com muita informação',
        desc: 'Clientes, Despesas, CRM, Contratos e a avaliação do PDI passaram a organizar o conteúdo em abas, deixando cada tela mais leve e focada.',
      },
    ],
  },
  {
    version: '1.17.0',
    date: '04/07/2026',
    items: [
      {
        title: 'PDI: bônus e PLR',
        desc: 'Na avaliação do gestor, painel de Bônus e PLR conforme o PDP (13º, Bônus PDI, PLR Plus e Bônus Comercial), com os critérios e a elegibilidade por faixa.',
      },
    ],
  },
  {
    version: '1.16.0',
    date: '04/07/2026',
    items: [
      {
        title: 'Colaborador: carreira e logo oficial',
        desc: 'Novo campo Carreira no cadastro do colaborador (Contencioso, Consultoria, Plus, Jr. Partner, Administrativo/Financeiro). Logo oficial VLMA na barra lateral.',
      },
      {
        title: 'PDI: salário sugerido na progressão',
        desc: 'Ao aplicar a progressão de cargo, o salário sugerido do quadro de remuneração já vem preenchido (e é ajustável).',
      },
    ],
  },
  {
    version: '1.15.0',
    date: '03/07/2026',
    items: [
      {
        title: 'PDI: avaliação pelo gestor',
        desc: 'Sócios e coordenadores avaliam a equipe: autoavaliação × avaliação do gestor lado a lado, validação de metas, faixa final, parecer e aplicação da progressão de cargo/salário.',
      },
      {
        title: 'Solicitações de contrato: excluir',
        desc: 'Agora é possível excluir solicitações de contrato antigas.',
      },
      {
        title: 'Correção: menu lateral',
        desc: 'O menu lateral não "recarrega" mais ao navegar entre as telas.',
      },
    ],
  },
  {
    version: '1.14.0',
    date: '29/06/2026',
    items: [
      {
        title: 'CRM: novos campos e colunas',
        desc: 'Card de oportunidade ganhou data, valor global, forma de pagamento (à vista/parcelado), valor em caixa no mês e valor futuro projetado. Duas novas colunas no funil: "Em standby" e "Êxito/projetado".',
      },
      {
        title: 'CRM: filtro de mês',
        desc: 'Filtro de mês no topo do CRM (pela data de cadastro do card) para focar nas oportunidades do período.',
      },
    ],
  },
  {
    version: '1.13.0',
    date: '25/06/2026',
    items: [
      {
        title: 'Gestão de horas (sócios e coordenadores)',
        desc: 'No Timesheet, sócios e coordenadores veem um painel da equipe do seu centro de custo: minhas horas, horas da equipe, distribuição por pessoa, cliente e caso, e projeção de faturamento (horas lançadas e aprovadas × valor/hora do caso). Com filtros de mês e cliente.',
      },
    ],
  },
  {
    version: '1.12.0',
    date: '24/06/2026',
    items: [
      {
        title: 'Dashboard de Despesas',
        desc: 'Resumo no topo de Despesas: lançado hoje, na semana e no mês, total do período, e quebras por cliente e por caso. Com filtros de mês e cliente, mantendo a lista existente.',
      },
    ],
  },
  {
    version: '1.11.0',
    date: '23/06/2026',
    items: [
      {
        title: 'Duplicar caso',
        desc: 'Na tela de Novo Caso, use "Duplicar de um caso existente": filtre por cliente, escolha o caso de origem e o contrato destino — os dados são copiados (sem anexos) para você revisar e salvar, sem preencher tudo de novo.',
      },
    ],
  },
  {
    version: '1.10.0',
    date: '22/06/2026',
    items: [
      {
        title: 'Conversa na solicitação de contrato',
        desc: 'Além do formulário, dá para trocar mensagens na solicitação. Cada pessoa vê só as próprias mensagens; o financeiro (administrativo e sócios) vê todas.',
      },
      {
        title: 'Lida / providência tomada',
        desc: 'O financeiro pode marcar cada mensagem como "lida" e "providência tomada", deixando o acompanhamento claro para todos.',
      },
    ],
  },
  {
    version: '1.9.0',
    date: '21/06/2026',
    items: [
      {
        title: 'Dashboard de Contratos turbinado',
        desc: 'Clique em qualquer item dos gráficos para ver os contratos daquele grupo num popup. Centros de custo agora aparecem corretos (antes muitos caíam em "Sem centro").',
      },
      {
        title: 'Filtro de mês + fechados por regra',
        desc: 'Novo filtro de mês no topo do dashboard e um indicador de casos fechados no mês por regra de cobrança (projeto, hora, fixo, mensal…).',
      },
    ],
  },
  {
    version: '1.8.0',
    date: '20/06/2026',
    items: [
      {
        title: 'Card do CRM enriquecido',
        desc: 'O card de oportunidade agora mostra, em ordem: cliente, segmento, centro de custo, serviço, produto, valor, fase, temperatura, responsável, cidade, observações e anexos.',
      },
      {
        title: 'Temperatura em barra (0–100%)',
        desc: 'A temperatura de fechamento passou a ser uma barra de 0% a 100% ajustável direto no card. O segmento e a cidade são puxados automaticamente do cadastro do cliente.',
      },
    ],
  },
  {
    version: '1.7.0',
    date: '19/06/2026',
    items: [
      {
        title: 'Painel do CRM',
        desc: 'Novo minidashboard no topo do CRM: total de oportunidades e valor, valor por fase, e quebras por centro de custo, produto, responsável, segmento econômico e temperatura — com um mini mapa do Brasil por estado.',
      },
      {
        title: 'Temperatura de fechamento',
        desc: 'Defina a temperatura de cada oportunidade direto no card do Kanban. Você pode criar suas próprias temperaturas (além de Quente/Morno/Frio) pelo seletor.',
      },
    ],
  },
  {
    version: '1.6.0',
    date: '18/06/2026',
    items: [
      {
        title: 'Foto dos colaboradores',
        desc: 'Cada colaborador pode ter uma foto: clique no avatar na lista de Colaboradores para enviar/trocar a imagem, que vira a miniatura da pessoa.',
      },
      {
        title: 'Painel de colaboradores',
        desc: 'Novo minidashboard no topo de Colaboradores: total de pessoas e quebras por categoria, cargo, centro de custo e função adicional. O salário aparece por pessoa na lista.',
      },
    ],
  },
  {
    version: '1.5.0',
    date: '17/06/2026',
    items: [
      {
        title: 'Excluir lançamentos de timesheet e despesas',
        desc: 'Agora dá para excluir um lançamento de timesheet ou de despesa direto da lista, pelo botão de lixeira (com confirmação). Lançamentos já aprovados ficam protegidos e não podem ser excluídos.',
      },
    ],
  },
  {
    version: '1.4.0',
    date: '15/06/2026',
    items: [
      {
        title: 'Composição da fatura',
        desc: 'Novo item em Faturamento: reúne, por cliente e contrato, o "kit" da fatura dos itens aprovados pelo financeiro — nota fiscal de serviço, boleto, relatório de timesheet e nota de despesa, tudo em um só lugar.',
      },
      {
        title: 'Nota de despesa em PDF',
        desc: 'Gere a nota de despesa no formato padrão do escritório (capa, detalhamento das despesas reembolsáveis por contrato/caso e dados bancários) e imprima ou salve em PDF.',
      },
      {
        title: 'Prévia do e-mail ao cliente',
        desc: 'Visualize o e-mail de cobrança (enviado via Resend) antes do envio, com o texto padrão e a lista de anexos para conferência.',
      },
      {
        title: 'Contas a pagar e receber no menu',
        desc: 'O módulo de Contas a pagar e receber passou a ser um item próprio do menu, separado do Faturamento.',
      },
    ],
  },
  {
    version: '1.3.0',
    date: '12/06/2026',
    items: [
      {
        title: 'PDF da NFS-e na lista de notas',
        desc: 'Clique em "Atualizar NFS-e" em Financeiro → Notas Geradas para consultar a prefeitura: notas autorizadas ganham o link do PDF na coluna Arquivo, além do número e código de verificação.',
      },
      {
        title: 'Cancelamento de NFS-e',
        desc: 'Cancele notas direto da lista: notas autorizadas são canceladas na prefeitura (com justificativa), e as demais são marcadas como canceladas no sistema.',
      },
    ],
  },
  {
    version: '1.2.0',
    date: '10/06/2026',
    items: [
      {
        title: 'Contas a Pagar e Fluxo de Caixa',
        desc: 'Novo módulo no Financeiro: lance despesas (fixas/variáveis, recorrentes e reembolsáveis), acompanhe a rotina diária com despesas, receitas e saldo do dia, dê baixa e reagende contas que atrasam. As notas fiscais emitidas viram contas a receber automaticamente, e o saldo inicial da conta é lançado manualmente.',
      },
      {
        title: 'Descrição editável na NFS-e',
        desc: 'Agora você revisa e edita a descrição do serviço na prévia da nota antes de emitir — nome do caso, dados bancários e textos legais já vêm preenchidos.',
      },
    ],
  },
  {
    version: '1.1.0',
    date: '09/06/2026',
    items: [
      {
        title: 'Relatório de Colaboradores',
        desc: 'Nova opção em Relatórios → Personalizados: gere a base completa de colaboradores (cargo, centro de custo, contato, status e dados cadastrais) com filtros e exportação para Excel.',
      },
      {
        title: 'Permissões padronizadas',
        desc: 'Acesso por perfil ficou mais claro e consistente — cada cargo enxerga apenas o que é do seu escopo.',
      },
    ],
  },
  {
    version: '1.0.0',
    date: '04/02/2026',
    items: [
      { title: 'Lançamento do ERP', desc: 'Contratos, Casos, CRM, Faturamento, Timesheet, Pessoas e Configurações.' },
    ],
  },
]

export default function Novidades() {
  const [open, setOpen] = useState(false)
  const [temNovidade, setTemNovidade] = useState(false)

  useEffect(() => {
    try {
      setTemNovidade(localStorage.getItem('vlma_versao_vista') !== APP_VERSION)
    } catch {
      /* localStorage indisponível */
    }
  }, [])

  const abrir = () => {
    setOpen(true)
    setTemNovidade(false)
    try {
      localStorage.setItem('vlma_versao_vista', APP_VERSION)
    } catch {
      /* noop */
    }
  }

  return (
    <>
      <button
        onClick={abrir}
        className="group mt-0.5 flex items-center gap-1.5 text-xs text-ink-mute transition-colors hover:text-brand-purple"
        title="Ver novidades"
      >
        <span>Versão {APP_VERSION}</span>
        {temNovidade && (
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-purple opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-purple" />
          </span>
        )}
        <span
          className={`rounded-pill px-1.5 py-px text-[10px] font-semibold transition-colors ${
            temNovidade
              ? 'bg-primary-soft-bg text-primary-deep'
              : 'text-ink-mute group-hover:text-primary'
          }`}
        >
          Novidades
        </span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-brand-dark/40 p-4 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md overflow-hidden rounded-xl bg-canvas shadow-lift-2 animate-in fade-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* header com degradê da marca */}
            <div className="bg-gradient-to-br from-brand-dark to-primary-press px-6 py-5 text-white">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary-soft-bg/90">
                Novidades
              </p>
              <h2 className="mt-1 text-xl font-bold tracking-tight">O que há de novo</h2>
              <p className="mt-1 text-sm text-white/80">Versão {APP_VERSION} · VLMA ERP</p>
            </div>

            {/* conteúdo */}
            <div className="max-h-[60vh] space-y-6 overflow-y-auto px-6 py-5">
              {CHANGELOG.map((rel) => (
                <div key={rel.version}>
                  <div className="mb-3 flex items-center gap-2">
                    <span
                      className={`rounded-pill px-2 py-0.5 text-xs font-bold ${
                        rel.destaque
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-canvas-soft text-ink-mute'
                      }`}
                    >
                      v{rel.version}
                    </span>
                    <span className="text-xs text-ink-mute">{rel.date}</span>
                  </div>
                  <div className="space-y-3">
                    {rel.items.map((it) => (
                      <div
                        key={it.title}
                        className={`flex gap-3 rounded-lg p-3 ${
                          rel.destaque ? 'bg-primary-soft-bg/40' : 'bg-canvas-soft'
                        }`}
                      >
                        <div>
                          <h3 className="text-sm font-semibold text-ink">{it.title}</h3>
                          <p className="mt-0.5 text-[13px] leading-snug text-ink-secondary">
                            {it.desc}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* footer */}
            <div className="flex justify-end border-t border-hairline px-6 py-3">
              <button
                onClick={() => setOpen(false)}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-deep"
              >
                Entendi
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
