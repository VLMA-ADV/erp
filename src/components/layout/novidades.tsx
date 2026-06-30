'use client'

import { useState, useEffect } from 'react'

export const APP_VERSION = '1.14.0'

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
    version: '1.14.0',
    date: '29/06/2026',
    destaque: true,
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
        className="group mt-0.5 flex items-center gap-1.5 text-xs text-ink-mute transition-colors hover:text-primary"
        title="Ver novidades"
      >
        <span>Versão {APP_VERSION}</span>
        {temNovidade && (
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
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
