export interface TimesheetTemplate {
  id: string
  categoria: string
  texto: string
}

export const TIMESHEET_TEMPLATES: TimesheetTemplate[] = [
  { id: 'demandas-gerais-1', categoria: 'Demandas Gerais', texto: 'Demandas Gerais' },
  { id: 'demandas-gerais-2', categoria: 'Demandas Gerais', texto: 'Elaboração de Procuração para [descrever finalidade]' },
  { id: 'demandas-gerais-3', categoria: 'Demandas Gerais', texto: 'Due diligence do imóvel [rural/urbano + Número matrícula], localizado na [endereço], na cidade de [-]/[Estado], que a [Cliente] pretende adquirir' },
  { id: 'demandas-gerais-4', categoria: 'Demandas Gerais', texto: 'Upload do documento [-] na plataforma de assinaturas, bem como acompanhamento da demanda' },
  { id: 'demandas-gerais-5', categoria: 'Demandas Gerais', texto: 'Acompanhamento [mensal/semanal] de [especificar demanda]' },
  { id: 'demandas-gerais-6', categoria: 'Demandas Gerais', texto: 'Auditoria de Contratos de [-] a fim de [-]' },
  { id: 'demandas-gerais-7', categoria: 'Demandas Gerais', texto: 'Revisão minuciosa de minuta do Contrato de [-], validando qualificações das partes, estrutura das cláusulas, formatação, ortografia e gramática' },
  { id: 'demandas-gerais-8', categoria: 'Demandas Gerais', texto: 'Análise prévia/Providências Iniciais da demanda [-]' },

  { id: 'notif-1', categoria: 'Notificações Extrajudiciais', texto: 'Elaboração de Notificação Extrajudicial para [-], com assunto [-]' },
  { id: 'notif-2', categoria: 'Notificações Extrajudiciais', texto: 'Elaboração de Resposta à Notificação Extrajudicial de [-], sobre [-]' },
  { id: 'notif-3', categoria: 'Notificações Extrajudiciais', texto: 'Análise de Notificação Extrajudicial recebida de [-], referente ao tema [-]' },
  { id: 'notif-4', categoria: 'Notificações Extrajudiciais', texto: 'Envio de Notificação Extrajudicial sobre [-] pelos Correios, à/ao [nome do destinatário]' },
  { id: 'notif-5', categoria: 'Notificações Extrajudiciais', texto: 'Revisão e Ajustes na Notificação Extrajudicial para [-], com assunto [-]' },
  { id: 'notif-6', categoria: 'Notificações Extrajudiciais', texto: 'Acompanhamento do Recebimento da Notificação Extrajudicial enviada em [-]' },

  { id: 'docs-1', categoria: 'Elaboração de Documentos', texto: 'Elaboração de Contrato/Aditivo/Distrato [-], a ser celebrado com [-], visando [-]' },
  { id: 'docs-2', categoria: 'Elaboração de Documentos', texto: 'Revisão/Análise de [-], a ser celebrado com [-], com objeto [-]' },

  { id: 'pesquisa-1', categoria: 'Pesquisas', texto: 'Elaboração de parecer sobre o tema [-]' },
  { id: 'pesquisa-2', categoria: 'Pesquisas', texto: 'Elaboração de pesquisa sobre [-], no sistema [-], com o intuito de [-]' },
  { id: 'pesquisa-3', categoria: 'Pesquisas', texto: 'Consulta à normativa [-] do [-], a fim de identificar [intuito da pesquisa]' },

  { id: 'cliente-1', categoria: 'Contato com o Cliente', texto: 'Contato telefônico com o cliente [-], para tratar a respeito da demanda [-]' },
  { id: 'cliente-2', categoria: 'Contato com o Cliente', texto: 'Acompanhamento da demanda [-] e envio de e-mail para [nome do cliente]' },
  { id: 'cliente-3', categoria: 'Contato com o Cliente', texto: 'Resposta à [-], por meio de e-mail/troca de mensagens, em relação à demanda [-]' },
  { id: 'cliente-4', categoria: 'Contato com o Cliente', texto: 'Realização de reunião com [-], para tratar a respeito da demanda [-]' },
  { id: 'cliente-5', categoria: 'Contato com o Cliente', texto: 'Realização de videoconferência com o cliente [-], para tratar a respeito da demanda [-]' },

  { id: 'cartorio-1', categoria: 'Diligências de Cartório', texto: 'Realização de protocolo presencial/online, frente ao [-] Cartório de Registro de Imóveis de [-], a fim de [-]' },
  { id: 'cartorio-2', categoria: 'Diligências de Cartório', texto: 'Trâmites junto ao Cartório [-] para elaboração de minuta de [procuração pública/inventário]' },
  { id: 'cartorio-3', categoria: 'Diligências de Cartório', texto: 'Envio de e-mail para Cartório [-], a fim de [-], para [tarefa/cliente]' },
  { id: 'cartorio-4', categoria: 'Diligências de Cartório', texto: 'Providências junto ao Registro de imóveis para o registro do inventário na matrícula dos imóveis inventariados' },
  { id: 'cartorio-5', categoria: 'Diligências de Cartório', texto: 'Elaboração de minuta de inventário de [-]' },
  { id: 'cartorio-6', categoria: 'Diligências de Cartório', texto: 'Solicitação das certidões obrigatórias de [-] para [-]' },
  { id: 'cartorio-7', categoria: 'Diligências de Cartório', texto: 'Conferência de minuta de [-], validando qualificações das partes e conteúdo, com contato ao Cartório [-] para ajustes' },
  { id: 'cartorio-8', categoria: 'Diligências de Cartório', texto: 'Emissão de Certidões Negativas de Débitos municipais, estaduais e federais, em nome de [-], para o processo de [-]' },
  { id: 'cartorio-9', categoria: 'Diligências de Cartório', texto: 'Emissão de certidões atualizadas dos herdeiros e de [-] para elaboração da minuta de inventário' },
  { id: 'cartorio-10', categoria: 'Diligências de Cartório', texto: 'Emissão de Simples Visualização da Matrícula de número [-], para o processo de [-]' },
  { id: 'cartorio-11', categoria: 'Diligências de Cartório', texto: 'Tempo destinado à ida ao Cartório de Registro de Imóveis, para [descrever atividade] do processo [descrever o processo], do [nome do cliente]' },
]

