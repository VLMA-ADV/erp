import Link from 'next/link'
import fs from 'node:fs'
import path from 'node:path'

const sections = [
  { id: 'visao-geral', title: 'Visão Geral' },
  { id: 'arquitetura', title: 'Arquitetura e Stack' },
  { id: 'estrutura', title: 'Estrutura do Projeto' },
  { id: 'banco', title: 'Banco de Dados' },
  { id: 'apis', title: 'APIs e Edge Functions' },
  { id: 'processos', title: 'Processos de Negócio' },
  { id: 'deploy', title: 'Execução e Deploy' },
  { id: 'handover', title: 'Handover Técnico' },
]

const stacks = [
  { label: 'Frontend', value: 'Next.js 14 (App Router) + React 18 + TypeScript' },
  { label: 'UI', value: 'Tailwind CSS + componentes internos (shadcn-based)' },
  { label: 'Autenticação', value: 'Supabase Auth' },
  { label: 'Backend/API', value: 'Supabase Edge Functions (Deno)' },
  { label: 'Banco', value: 'PostgreSQL (Supabase) com schemas por domínio' },
  { label: 'Testes', value: 'Playwright (E2E) + type-check (tsc)' },
  { label: 'Deploy', value: 'Netlify (frontend) + Supabase (DB/Functions)' },
]

const estrutura = [
  {
    pasta: 'src/app',
    descricao: 'Rotas do Next.js (auth, dashboard e páginas do sistema).',
    exemplos: ['/login', '/home', '/contratos', '/financeiro/revisao-de-fatura'],
  },
  {
    pasta: 'src/components',
    descricao: 'Componentes de domínio (clientes, contratos, timesheet, faturamento, despesas etc).',
    exemplos: ['src/components/contratos', 'src/components/faturamento', 'src/components/ui'],
  },
  {
    pasta: 'src/lib',
    descricao: 'Infra de cliente Supabase, hooks de permissão, contexto e utilitários.',
    exemplos: ['src/lib/supabase/client.ts', 'src/lib/supabase/server.ts', 'src/lib/hooks/use-permissions.ts'],
  },
  {
    pasta: 'supabase/migrations',
    descricao: 'DDL e evolução de schema (fonte da verdade do banco).',
    exemplos: ['migrações de schemas core/crm/people/contracts/operations/finance/documents'],
  },
  {
    pasta: 'supabase/functions',
    descricao: 'APIs do sistema (CRUD e fluxos operacionais/faturamento).',
    exemplos: ['get-contratos', 'create-timesheet', 'start-faturamento', 'get-revisao-fatura'],
  },
  {
    pasta: 'documentação',
    descricao: 'Documentação funcional e de entidades já existente em Markdown.',
    exemplos: ['documentação/entidades.md', 'documentação/regras_negocio.md', 'documentação/infraestrutura.md'],
  },
  {
    pasta: 'tests/e2e',
    descricao: 'Cenários E2E críticos do fluxo de faturamento/revisão.',
    exemplos: ['tests/e2e/faturamento-fluxo-revisao.spec.ts'],
  },
]

const schemas = [
  {
    nome: 'core',
    objetivo: 'Tenant, RBAC, permissões e estrutura transversal.',
    tabelas: ['core.tenants', 'core.tenant_users', 'core.permissions', 'core.role_permissions'],
  },
  {
    nome: 'crm',
    objetivo: 'Clientes e metadados comerciais.',
    tabelas: ['crm.clientes', 'crm.segmentos'],
  },
  {
    nome: 'people',
    objetivo: 'Colaboradores e estrutura organizacional.',
    tabelas: ['people.colaboradores', 'people.cargos', 'people.areas'],
  },
  {
    nome: 'contracts',
    objetivo: 'Contratos, casos, regras financeiras e configuração de revisão/aprovação.',
    tabelas: ['contracts.contratos', 'contracts.casos', 'contracts.solicitacoes_contrato', 'contracts.grupos_impostos'],
  },
  {
    nome: 'operations',
    objetivo: 'Execução operacional e lançamentos de base.',
    tabelas: ['operations.timesheets', 'operations.despesas'],
  },
  {
    nome: 'finance',
    objetivo: 'Orquestração do ciclo de faturamento (batch, item, revisão, nota e auditoria).',
    tabelas: ['finance.billing_batches', 'finance.billing_items', 'finance.billing_item_audit', 'finance.billing_notes'],
  },
  {
    nome: 'documents',
    objetivo: 'GED, anexos e templates.',
    tabelas: ['documents.documentos', 'documents.templates_email'],
  },
]

const bancoPilares = [
  'Isolamento por tenant em todas as consultas (campo tenant_id + validação por core.tenant_users).',
  'Permissões finas em runtime via get_user_permissions (RBAC efetivo no backend).',
  'Fluxo financeiro orientado a snapshot: revisão altera snapshot/valor revisado-aprovado sem mutar cadastro-base.',
  'Migrations versionadas em supabase/migrations são a fonte de verdade do schema.',
]

const tabelasFaturamento = [
  {
    tabela: 'finance.billing_batches',
    funcao: 'Agrupa execução de envio para faturamento por período/alvo.',
    campos: 'status, alvo_tipo, alvo_id, data_inicio, data_fim, numero',
  },
  {
    tabela: 'finance.billing_items',
    funcao: 'Representa cada item faturável (timesheet, despesa ou regra financeira).',
    campos: 'origem_tipo, origem_id, status, horas_*, valor_*, snapshot',
  },
  {
    tabela: 'finance.billing_item_audit',
    funcao: 'Trilha campo-a-campo do que foi alterado na revisão/aprovação.',
    campos: 'action, field_name, old_value, new_value, changed_by, changed_at',
  },
  {
    tabela: 'finance.billing_notes',
    funcao: 'Registro de documentos gerados após faturamento.',
    campos: 'tipo_documento, status, arquivo_url, metadata, numero',
  },
]

const constraintsCriticas = [
  'finance.billing_items: índice único por timesheet (origem_tipo=timesheet, status <> cancelado) evita cobrança duplicada.',
  'finance.billing_items: índice único por regra financeira + período evita repetição de mensalidade/projeto por janela.',
  'finance.billing_batches e billing_items: status controlado por CHECK para manter máquina de estados consistente.',
  'finance.tenant_counters + triggers set_billing_*_numero: numeração sequencial por tenant.',
]

const bancoJornadaDados = [
  {
    etapa: '1) Contexto de acesso',
    descricao: 'Usuário autenticado em auth.users é vinculado ao tenant em core.tenant_users; esse vínculo filtra todas as RPCs.',
    impacto: 'Impede vazamento de dados entre clientes (multi-tenant real).',
  },
  {
    etapa: '2) Base comercial',
    descricao: 'crm.clientes alimenta contracts.contratos; contratos organizam contracts.casos e suas regras financeiras.',
    impacto: 'Sem cliente/contrato/caso ativo, não há item elegível para faturamento.',
  },
  {
    etapa: '3) Execução operacional',
    descricao: 'operations.timesheets e operations.despesas registram produção e custos do caso.',
    impacto: 'Esses registros são as principais origens do faturamento.',
  },
  {
    etapa: '4) Projeção financeira',
    descricao: 'finance.billing_items materializa snapshot do que será cobrado, separado do cadastro original.',
    impacto: 'Revisão/aprovação altera o snapshot financeiro sem corromper o histórico operacional.',
  },
  {
    etapa: '5) Fechamento',
    descricao: 'finance.billing_notes registra documentos gerados e rastreabilidade de cobrança.',
    impacto: 'Fecha o ciclo com trilha auditável por item e lote.',
  },
]

const maquinasEstadoBanco = [
  {
    entidade: 'Contratos (contracts.contratos.status)',
    fluxo: 'rascunho -> solicitacao -> validacao -> ativo -> encerrado',
    regra: 'Rascunho é usado para preparação interna; ativo habilita operação/faturamento.',
  },
  {
    entidade: 'Timesheet (operations.timesheets.status)',
    fluxo: 'em_lancamento -> revisao -> aprovado',
    regra: 'Só itens elegíveis entram no faturamento; após inclusão, revisão ocorre no fluxo financeiro.',
  },
  {
    entidade: 'Despesa (operations.despesas.status)',
    fluxo: 'em_lancamento -> revisao -> aprovado -> cancelado',
    regra: 'Despesas em lançamento podem virar origem_tipo=despesa no faturamento.',
  },
  {
    entidade: 'Item faturável (finance.billing_items.status)',
    fluxo: 'disponivel -> em_revisao -> em_aprovacao -> aprovado -> faturado | cancelado',
    regra: 'Valor/hora efetivos usam precedência aprovado > revisado > informado.',
  },
]

const checklistDiagnosticoBanco = [
  {
    pergunta: 'Item não aparece em Itens a faturar',
    verificar: 'Status da origem (timesheet/despesa), período selecionado, contrato/caso ativo e conflito de índice único já faturado.',
  },
  {
    pergunta: 'Usuário não consegue avançar etapa',
    verificar: 'Permissões em get_user_permissions e se o status atual permite a transição solicitada.',
  },
  {
    pergunta: 'Valor divergente entre telas',
    verificar: 'Se a tela está usando precedência correta: valor_aprovado -> valor_revisado -> valor_informado.',
  },
  {
    pergunta: 'Responsável não aparece no fluxo',
    verificar: 'Configuração de revisores/aprovadores no caso (timesheet_config) e fallback de carregamento do contrato.',
  },
]

const apiPipeline = [
  '1) Frontend chama /functions/v1/<edge> com Authorization Bearer token.',
  '2) Edge valida token com supabase.auth.getUser(token).',
  '3) Edge consulta get_user_permissions para autorização por ação.',
  '4) Edge executa RPC (SECURITY DEFINER) no banco.',
  '5) Banco aplica regras de tenant, status e integridade.',
  '6) Edge retorna payload JSON padronizado ({ data } ou { error, details }).',
]

type ApiSectionKey =
  | 'seguranca'
  | 'faturamento'
  | 'operacoes'
  | 'contratos'
  | 'solicitacoes'
  | 'crm'
  | 'pessoas'
  | 'config'
  | 'outros'

type ApiItem = {
  nome: string
  rota: string
  metodo: 'GET' | 'POST'
  permissoes: string[]
  rpcs: string[]
}

type ApiSection = {
  key: ApiSectionKey
  titulo: string
  descricao: string
  items: ApiItem[]
}

const apiSectionMeta: Record<ApiSectionKey, Omit<ApiSection, 'items'>> = {
  seguranca: {
    key: 'seguranca',
    titulo: 'Segurança e Permissões',
    descricao: 'RBAC, permissões de usuário e papéis.',
  },
  faturamento: {
    key: 'faturamento',
    titulo: 'Faturamento',
    descricao: 'Itens a faturar, fluxo, revisão, aprovação e notas.',
  },
  operacoes: {
    key: 'operacoes',
    titulo: 'Operações',
    descricao: 'Timesheets e despesas (entrada operacional).',
  },
  contratos: {
    key: 'contratos',
    titulo: 'Contratos, Casos e Anexos',
    descricao: 'Gestão contratual, casos e anexos de documentos.',
  },
  solicitacoes: {
    key: 'solicitacoes',
    titulo: 'Solicitações de Contrato',
    descricao: 'Abertura e conclusão de solicitações.',
  },
  crm: {
    key: 'crm',
    titulo: 'CRM',
    descricao: 'Clientes e dados comerciais.',
  },
  pessoas: {
    key: 'pessoas',
    titulo: 'Pessoas',
    descricao: 'Colaboradores, parceiros, prestadores e fornecedores.',
  },
  config: {
    key: 'config',
    titulo: 'Configurações',
    descricao: 'Cargos, áreas, roles, serviços, categorias e afins.',
  },
  outros: {
    key: 'outros',
    titulo: 'Outros',
    descricao: 'APIs utilitárias ou não classificadas.',
  },
}

const apiSectionOrder: ApiSectionKey[] = ['seguranca', 'faturamento', 'operacoes', 'contratos', 'solicitacoes', 'crm', 'pessoas', 'config', 'outros']

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b))
}

function extractByRegex(content: string, pattern: RegExp): string[] {
  const out: string[] = []
  let match = pattern.exec(content)
  while (match) {
    if (match[1]) out.push(match[1])
    match = pattern.exec(content)
  }
  return uniqueSorted(out)
}

function inferMethod(apiName: string, content: string): 'GET' | 'POST' {
  if (/req\.method\s*!==\s*["']POST["']/.test(content)) return 'POST'
  if (/req\.method\s*!==\s*["']GET["']/.test(content)) return 'GET'
  if (apiName.startsWith('get-') || apiName.startsWith('list-')) return 'GET'
  return 'POST'
}

function classifyApi(apiName: string): ApiSectionKey {
  if (apiName.includes('permissions') || apiName.includes('role') || apiName === 'get-user-permissions') return 'seguranca'
  if (
    apiName.includes('faturamento') ||
    apiName.includes('itens-a-faturar') ||
    apiName.includes('revisao-fatura') ||
    apiName.includes('notas-geradas')
  ) return 'faturamento'
  if (apiName.includes('timesheet') || apiName.includes('despesa')) return 'operacoes'
  if (apiName.includes('solicitacao-contrato')) return 'solicitacoes'
  if (apiName.includes('contrato') || apiName.includes('caso') || apiName.includes('anexo') || apiName.includes('tabela-preco')) return 'contratos'
  if (apiName.includes('cliente')) return 'crm'
  if (
    apiName.includes('colaborador') ||
    apiName.includes('fornecedor') ||
    apiName.includes('parceiro') ||
    apiName.includes('prestador')
  ) return 'pessoas'
  if (
    apiName.includes('area') ||
    apiName.includes('cargo') ||
    apiName.includes('grupo-economico') ||
    apiName.includes('segmento-economico') ||
    apiName.includes('servico') ||
    apiName.includes('categoria-')
  ) return 'config'
  return 'outros'
}

function buildApiSections(): ApiSection[] {
  const functionsDir = path.join(process.cwd(), 'supabase', 'functions')
  if (!fs.existsSync(functionsDir)) {
    return apiSectionOrder.map((key) => ({ ...apiSectionMeta[key], items: [] }))
  }

  const dirs = fs
    .readdirSync(functionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))

  const buckets = new Map<ApiSectionKey, ApiItem[]>()
  for (const key of apiSectionOrder) buckets.set(key, [])

  for (const dirName of dirs) {
    const indexPath = path.join(functionsDir, dirName, 'index.ts')
    if (!fs.existsSync(indexPath)) continue

    const content = fs.readFileSync(indexPath, 'utf-8')
    const item: ApiItem = {
      nome: dirName,
      rota: `/functions/v1/${dirName}`,
      metodo: inferMethod(dirName, content),
      permissoes: extractByRegex(content, /permission_key === ["']([^"']+)["']/g),
      rpcs: extractByRegex(content, /\.rpc\(["']([^"']+)["']/g),
    }

    const section = classifyApi(dirName)
    buckets.get(section)?.push(item)
  }

  return apiSectionOrder.map((key) => ({
    ...apiSectionMeta[key],
    items: (buckets.get(key) || []).sort((a, b) => a.nome.localeCompare(b.nome)),
  }))
}

const apiSections = buildApiSections()
const totalApiCount = apiSections.reduce((acc, section) => acc + section.items.length, 0)

const apiObservacoes = [
  'Edge functions do projeto validam token manualmente no código (auth.getUser), mesmo quando o deploy usa verify_jwt desativado.',
  'Para leitura/listagem, filtros são enviados por query string; para mutação, payload JSON.',
  'Erros de regra de negócio nas RPCs são propagados como 500 com details para diagnóstico rápido.',
]

const fluxoContratoCaso = [
  {
    etapa: 'Cliente',
    descricao: 'Cadastro base em crm.clientes; inclui potencial_cliente (baixo/medio/alto).',
    saida: 'Cliente apto para solicitação/contrato.',
  },
  {
    etapa: 'Solicitação de contrato',
    descricao: 'Usuário abre solicitação com cliente, proposta e descrição; pode gerar rascunho vinculado.',
    saida: 'Contrato em status solicitacao ou rascunho (dependendo da origem/perfil).',
  },
  {
    etapa: 'Contrato',
    descricao: 'Status operacional: rascunho -> solicitacao -> validacao -> ativo -> encerrado.',
    saida: 'Contrato ativo para receber casos/timesheet/despesas.',
  },
  {
    etapa: 'Caso',
    descricao: 'Define regra de cobrança e cadeia de revisores/aprovadores que será refletida no faturamento.',
    saida: 'Caso ativo e elegível para operação.',
  },
]

const fluxoOperacional = [
  {
    modulo: 'Timesheet',
    status: 'em_lancamento -> revisao -> aprovado',
    regra: 'Após envio ao faturamento, item de origem vai para revisão sem duplicar cobrança.',
  },
  {
    modulo: 'Despesas',
    status: 'em_lancamento -> revisao -> aprovado -> cancelado',
    regra: 'Despesas em lançamento entram como origem_tipo=despesa no faturamento.',
  },
]

const fluxoFaturamento = [
  {
    fase: 'Itens a faturar',
    detalhe: 'RPC get_itens_a_faturar consolida elegíveis por período e hierarquia Cliente > Contrato > Caso.',
  },
  {
    fase: 'Iniciar fluxo',
    detalhe: 'start_faturamento_flow cria batch e billing_items (timesheet/despesa/regra financeira).',
  },
  {
    fase: 'Revisão',
    detalhe: 'update_revisao_fatura_item altera apenas dados da etapa de revisão, com registro em billing_item_audit.',
  },
  {
    fase: 'Aprovação',
    detalhe: 'set_revisao_fatura_status move item entre em_revisao, em_aprovacao e aprovado.',
  },
  {
    fase: 'Faturado/nota',
    detalhe: 'faturar_revisao_item finaliza item e gera registro em billing_notes.',
  },
]

const guardrailsProcesso = [
  'Visibilidade por etapa: usuário vê sua etapa atual e histórico anterior; não edita etapas já concluídas de terceiros.',
  'Admin pode trocar responsável apenas em etapas ainda não realizadas.',
  'Valor aprovado não deve sobrescrever valor revisado (campos separados em billing_items).',
  'Prioridade de cálculo de valor/horas no fluxo: aprovado -> revisado -> informado.',
]

const visoesUsuario = [
  {
    perfil: 'Sócio / Administrativo',
    ve: 'Visão ampla de contratos, casos, faturamento e cadastros.',
    acoes: 'Pode operar etapas críticas conforme permissões (manage/review/approve), inclusive ajustes de responsáveis em etapas pendentes.',
    observacao: 'Na prática é o perfil de governança do fluxo.',
  },
  {
    perfil: 'Financeiro / Controladoria',
    ve: 'Itens a faturar, fluxo, revisão e notas geradas.',
    acoes: 'Inicia faturamento, revisa/aprova conforme regra interna e fecha ciclo de cobrança.',
    observacao: 'Depende das permissões finance.faturamento.* atribuídas ao role.',
  },
  {
    perfil: 'Advogado / Operação jurídica',
    ve: 'Contratos/casos autorizados + seus lançamentos operacionais.',
    acoes: 'Lança timesheet/despesa e participa da revisão quando configurado como responsável da etapa.',
    observacao: 'Não é um papel fixo; tudo depende de role_permissions.',
  },
  {
    perfil: 'Estagiário / Apoio operacional',
    ve: 'Visão restrita para execução do trabalho diário.',
    acoes: 'Normalmente realiza lançamento operacional e consulta status.',
    observacao: 'Ações administrativas e financeiras costumam ficar bloqueadas.',
  },
]

const regrasFuncionaisCriticas = [
  'Toda ação de negócio exige tenant ativo + permissão explícita no backend (não confiar só no frontend).',
  'Contrato/caso encerrados não devem gerar novos itens operacionais ou financeiros.',
  'Revisão e aprovação alteram o snapshot do item faturável, preservando o lançamento original.',
  'A etapa do usuário define o que ele vê e pode editar no modal de revisão/aprovação.',
  'Itens já faturados/cancelados não voltam para edição comum do fluxo.',
  'Despesas e timesheets entram no mesmo motor de faturamento para manter total consolidado por cliente/contrato/caso.',
]

const jornadasPorPapel = [
  {
    titulo: 'Jornada: Operação jurídica',
    passos: [
      'Seleciona cliente/caso e lança timesheet ou despesa.',
      'Acompanha mudança de status quando item entra em revisão.',
      'Se for responsável da etapa, ajusta sua linha e avança para próxima etapa.',
    ],
  },
  {
    titulo: 'Jornada: Financeiro',
    passos: [
      'Filtra período em Itens a faturar e inicia lote.',
      'Monitora fluxo por status e resolve pendências de revisão/aprovação.',
      'Conclui faturamento do item e acompanha nota/documento gerado.',
    ],
  },
  {
    titulo: 'Jornada: Gestão (sócio/admin)',
    passos: [
      'Configura contrato, caso, regras de cobrança e cadeia de responsáveis.',
      'Ajusta responsáveis pendentes quando necessário para destravar operação.',
      'Audita histórico de alterações e valida fechamento financeiro.',
    ],
  },
]

const docsRelacionados = [
  'documentação/infraestrutura.md',
  'documentação/regras_negocio.md',
  'documentação/telas_sistema.md',
  'documentação/entidades.md',
  'documentação/entidades/core.md',
  'documentação/entidades/crm.md',
  'documentação/entidades/people.md',
  'documentação/entidades/contracts.md',
  'documentação/entidades/operations.md',
  'documentação/entidades/finance.md',
  'documentação/entidades/documents.md',
  'README_SETUP.md',
  'README_DEPLOY.md',
  'ENV_VARIABLES.md',
]

const comandos = [
  { cmd: 'npm install', desc: 'Instalar dependências do projeto.' },
  { cmd: 'npm run dev', desc: 'Subir aplicação local.' },
  { cmd: 'npm run type-check', desc: 'Validação estática de tipos.' },
  { cmd: 'npm run lint', desc: 'Lint do projeto.' },
  { cmd: 'npm run e2e', desc: 'Cenários E2E com Playwright.' },
  { cmd: 'supabase db push', desc: 'Aplicar migrations no projeto Supabase.' },
  { cmd: 'npm run supabase:deploy:functions', desc: 'Deploy das edge functions (script do projeto).' },
]

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">ERP-VLMA</p>
            <h1 className="text-2xl font-bold">Documentação Técnica do Projeto</h1>
            <p className="mt-1 text-sm text-slate-600">Guia de handover para continuidade do desenvolvimento e operação.</p>
          </div>
          <div className="text-right text-xs text-slate-500">
            <p>Rota pública interna: <span className="font-mono">/docs</span></p>
            <p>Atualizado em: 18/03/2026</p>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-6 px-6 py-6 lg:grid-cols-[280px_1fr]">
        <aside className="h-fit rounded-xl border bg-white p-4 shadow-sm lg:sticky lg:top-6">
          <p className="mb-3 text-sm font-semibold text-slate-700">Navegação</p>
          <nav>
            <ul className="space-y-1">
              {sections.map((section) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="block rounded-md px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100 hover:text-slate-900"
                  >
                    {section.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="mt-6 rounded-lg border bg-slate-50 p-3 text-xs text-slate-600">
            <p className="font-semibold text-slate-800">Acessos rápidos</p>
            <p className="mt-1">
              <Link href="/home" className="underline">Dashboard</Link>
              {' · '}
              <Link href="/login" className="underline">Login</Link>
            </p>
          </div>
        </aside>

        <main className="space-y-6">
          <section id="visao-geral" className="scroll-mt-24 rounded-xl border bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold">Visão Geral</h2>
            <p className="mt-3 text-sm leading-6 text-slate-700">
              O ERP-VLMA é um sistema para operação jurídica com foco em contratos, casos, timesheet, despesas e faturamento.
              A arquitetura é multi-tenant e baseada em Supabase (Auth, Database, Edge Functions), com frontend em Next.js.
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Objetivo</p>
                <p className="mt-1 text-sm text-slate-700">Centralizar cadastro, execução operacional e ciclo completo de faturamento.</p>
              </div>
              <div className="rounded-lg border bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Público interno</p>
                <p className="mt-1 text-sm text-slate-700">Sócios, advogados, administrativo e estagiários com permissões diferentes.</p>
              </div>
            </div>
          </section>

          <section id="arquitetura" className="scroll-mt-24 rounded-xl border bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold">Arquitetura e Stack</h2>
            <div className="mt-4 overflow-x-auto rounded-lg border">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-4 py-2 font-semibold">Camada</th>
                    <th className="px-4 py-2 font-semibold">Tecnologia</th>
                  </tr>
                </thead>
                <tbody>
                  {stacks.map((item) => (
                    <tr key={item.label} className="border-t">
                      <td className="px-4 py-2 font-medium text-slate-800">{item.label}</td>
                      <td className="px-4 py-2 text-slate-700">{item.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section id="estrutura" className="scroll-mt-24 rounded-xl border bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold">Estrutura do Projeto</h2>
            <p className="mt-3 text-sm text-slate-700">Seções principais para entender rapidamente onde cada responsabilidade fica.</p>
            <div className="mt-4 space-y-3">
              {estrutura.map((item) => (
                <article key={item.pasta} className="rounded-lg border p-4">
                  <h3 className="font-mono text-sm font-semibold text-slate-800">{item.pasta}</h3>
                  <p className="mt-1 text-sm text-slate-700">{item.descricao}</p>
                  <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Exemplos</p>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {item.exemplos.map((exemplo) => (
                      <span key={exemplo} className="rounded bg-slate-100 px-2 py-1 font-mono text-xs text-slate-700">
                        {exemplo}
                      </span>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section id="banco" className="scroll-mt-24 rounded-xl border bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold">Banco de Dados</h2>
            <p className="mt-3 text-sm leading-6 text-slate-700">
              O banco é PostgreSQL (Supabase) com separação por domínio e validação de tenant/permissão em toda operação.
              Para manutenção, considere <span className="font-mono">supabase/migrations</span> como fonte primária de verdade.
            </p>
            <p className="mt-2 text-sm text-slate-700">
              A forma mais rápida de entender o sistema é ler os dados em cadeia:
              <span className="font-semibold"> usuário/tenant {'->'} cliente {'->'} contrato {'->'} caso {'->'} operação {'->'} faturamento</span>.
            </p>

            <div className="mt-4 rounded-lg border bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-800">Pilares da modelagem</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
                {bancoPilares.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>

            <div className="mt-4 rounded-lg border p-4">
              <p className="text-sm font-semibold text-slate-800">Leitura guiada do fluxo de dados</p>
              <div className="mt-3 space-y-3">
                {bancoJornadaDados.map((item) => (
                  <article key={item.etapa} className="rounded-md border bg-slate-50 p-3">
                    <p className="text-sm font-semibold text-slate-800">{item.etapa}</p>
                    <p className="mt-1 text-sm text-slate-700">{item.descricao}</p>
                    <p className="mt-1 text-xs text-slate-600">
                      <span className="font-semibold">Impacto:</span> {item.impacto}
                    </p>
                  </article>
                ))}
              </div>
            </div>

            <div className="mt-4 overflow-x-auto rounded-lg border">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-4 py-2 font-semibold">Schema</th>
                    <th className="px-4 py-2 font-semibold">Objetivo</th>
                    <th className="px-4 py-2 font-semibold">Tabelas-chave</th>
                  </tr>
                </thead>
                <tbody>
                  {schemas.map((schema) => (
                    <tr key={schema.nome} className="border-t align-top">
                      <td className="px-4 py-2 font-mono text-xs font-semibold text-slate-800">{schema.nome}</td>
                      <td className="px-4 py-2 text-slate-700">{schema.objetivo}</td>
                      <td className="px-4 py-2 text-slate-700">
                        <div className="flex flex-wrap gap-1.5">
                          {schema.tabelas.map((tabela) => (
                            <span key={tabela} className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs">
                              {tabela}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4">
              <p className="text-sm font-semibold text-slate-800">Núcleo do faturamento</p>
              <div className="mt-2 overflow-x-auto rounded-lg border">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-4 py-2 font-semibold">Tabela</th>
                      <th className="px-4 py-2 font-semibold">Função</th>
                      <th className="px-4 py-2 font-semibold">Campos críticos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tabelasFaturamento.map((item) => (
                      <tr key={item.tabela} className="border-t align-top">
                        <td className="px-4 py-2 font-mono text-xs font-semibold text-slate-800">{item.tabela}</td>
                        <td className="px-4 py-2 text-slate-700">{item.funcao}</td>
                        <td className="px-4 py-2 font-mono text-xs text-slate-700">{item.campos}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-4 rounded-lg border p-4">
              <p className="text-sm font-semibold text-slate-800">Constraints e índices que evitam regressão financeira</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
                {constraintsCriticas.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>

            <div className="mt-4 rounded-lg border p-4">
              <p className="text-sm font-semibold text-slate-800">Máquinas de estado no banco</p>
              <div className="mt-2 overflow-x-auto rounded border">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Entidade</th>
                      <th className="px-3 py-2 font-semibold">Fluxo</th>
                      <th className="px-3 py-2 font-semibold">Regra de negócio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {maquinasEstadoBanco.map((item) => (
                      <tr key={item.entidade} className="border-t align-top">
                        <td className="px-3 py-2 font-semibold text-slate-800">{item.entidade}</td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-700">{item.fluxo}</td>
                        <td className="px-3 py-2 text-slate-700">{item.regra}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-4 rounded-lg border bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-800">Checklist rápido de diagnóstico</p>
              <div className="mt-2 space-y-2">
                {checklistDiagnosticoBanco.map((item) => (
                  <div key={item.pergunta} className="rounded-md border bg-white p-3">
                    <p className="text-sm font-semibold text-slate-800">{item.pergunta}</p>
                    <p className="mt-1 text-sm text-slate-700">{item.verificar}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section id="apis" className="scroll-mt-24 rounded-xl border bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold">APIs e Edge Functions</h2>
            <p className="mt-3 text-sm leading-6 text-slate-700">
              A aplicação consome principalmente endpoints em <span className="font-mono">/functions/v1/*</span> (Supabase Edge Functions).
              O frontend envia JWT do usuário logado no header <span className="font-mono">Authorization: Bearer &lt;token&gt;</span>.
            </p>
            <p className="mt-2 text-sm text-slate-700">
              APIs mapeadas automaticamente do diretório <span className="font-mono">supabase/functions</span>:
              <span className="ml-1 font-semibold">{totalApiCount}</span> endpoints.
            </p>

            <div className="mt-4 rounded-lg border bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-800">Pipeline padrão de requisição</p>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-700">
                {apiPipeline.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ol>
            </div>

            <div className="mt-4 space-y-4">
              {apiSections.map((section) => (
                <article key={section.key} className="rounded-lg border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-800">{section.titulo}</h3>
                    <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-700">
                      {section.items.length} APIs
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{section.descricao}</p>

                  {section.items.length === 0 ? (
                    <p className="mt-3 text-xs text-slate-500">Nenhuma API detectada nesta seção.</p>
                  ) : (
                    <div className="mt-3 grid gap-3 lg:grid-cols-2">
                      {section.items.map((item) => (
                        <div key={item.nome} className="rounded-md border bg-slate-50 p-3">
                          <p className="font-mono text-xs font-semibold text-slate-800">{item.nome}</p>
                          <p className="mt-1 font-mono text-[11px] text-slate-600">{item.rota}</p>
                          <p className="mt-2 text-xs text-slate-700">
                            <span className="font-semibold">Método:</span> {item.metodo}
                          </p>
                          <p className="mt-1 text-xs text-slate-700">
                            <span className="font-semibold">Permissões:</span>{' '}
                            {item.permissoes.length > 0 ? item.permissoes.join(', ') : '-'}
                          </p>
                          <p className="mt-1 text-xs text-slate-700">
                            <span className="font-semibold">RPCs:</span>{' '}
                            {item.rpcs.length > 0 ? item.rpcs.join(', ') : '-'}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>

            <div className="mt-4 rounded-lg border p-4">
              <p className="text-sm font-semibold text-slate-800">Observações de operação</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
                {apiObservacoes.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </section>

          <section id="processos" className="scroll-mt-24 rounded-xl border bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold">Processos de Negócio</h2>
            <p className="mt-3 text-sm leading-6 text-slate-700">
              A operação gira em três trilhas conectadas: <span className="font-semibold">Contrato/Caso</span>,
              <span className="font-semibold"> Execução Operacional</span> e <span className="font-semibold">Faturamento</span>.
              O objetivo é manter rastreabilidade do lançamento original até a nota gerada.
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-700">
              As visões de tela e ações não são fixas por cargo; o sistema usa RBAC por permissão. Por isso, ao onboard de um novo usuário,
              a primeira checagem deve ser sempre o conjunto de permissões aplicado ao role.
            </p>

            <div className="mt-4 rounded-lg border p-4">
              <p className="text-sm font-semibold text-slate-800">Visão por tipo de usuário (referência operacional)</p>
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                {visoesUsuario.map((item) => (
                  <article key={item.perfil} className="rounded-md border bg-slate-50 p-3">
                    <p className="text-sm font-semibold text-slate-800">{item.perfil}</p>
                    <p className="mt-1 text-sm text-slate-700"><span className="font-semibold">Vê:</span> {item.ve}</p>
                    <p className="mt-1 text-sm text-slate-700"><span className="font-semibold">Ações:</span> {item.acoes}</p>
                    <p className="mt-1 text-xs text-slate-600">{item.observacao}</p>
                  </article>
                ))}
              </div>
            </div>

            <div className="mt-4 rounded-lg border bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-800">Regras funcionais que não podem quebrar</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
                {regrasFuncionaisCriticas.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>

            <div className="mt-4 rounded-lg border p-4">
              <p className="text-sm font-semibold text-slate-800">Trilha 1: Cliente {'->'} Contrato {'->'} Caso</p>
              <div className="mt-2 overflow-x-auto rounded border">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Etapa</th>
                      <th className="px-3 py-2 font-semibold">Descrição</th>
                      <th className="px-3 py-2 font-semibold">Saída</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fluxoContratoCaso.map((item) => (
                      <tr key={item.etapa} className="border-t align-top">
                        <td className="px-3 py-2 font-semibold text-slate-800">{item.etapa}</td>
                        <td className="px-3 py-2 text-slate-700">{item.descricao}</td>
                        <td className="px-3 py-2 text-slate-700">{item.saida}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-4 rounded-lg border p-4">
              <p className="text-sm font-semibold text-slate-800">Trilha 2: Operação (timesheet/despesa)</p>
              <div className="mt-2 overflow-x-auto rounded border">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Módulo</th>
                      <th className="px-3 py-2 font-semibold">Status principais</th>
                      <th className="px-3 py-2 font-semibold">Regra operacional</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fluxoOperacional.map((item) => (
                      <tr key={item.modulo} className="border-t align-top">
                        <td className="px-3 py-2 font-semibold text-slate-800">{item.modulo}</td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-700">{item.status}</td>
                        <td className="px-3 py-2 text-slate-700">{item.regra}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-4 rounded-lg border p-4">
              <p className="text-sm font-semibold text-slate-800">Trilha 3: Faturamento ponta a ponta</p>
              <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-slate-700">
                {fluxoFaturamento.map((item) => (
                  <li key={item.fase}>
                    <span className="font-semibold">{item.fase}: </span>
                    {item.detalhe}
                  </li>
                ))}
              </ol>
            </div>

            <div className="mt-4 rounded-lg border bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-800">Guardrails de negócio já implementados</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
                {guardrailsProcesso.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>

            <div className="mt-4 rounded-lg border p-4">
              <p className="text-sm font-semibold text-slate-800">Jornadas práticas por papel</p>
              <div className="mt-3 grid gap-3 lg:grid-cols-3">
                {jornadasPorPapel.map((jornada) => (
                  <article key={jornada.titulo} className="rounded-md border bg-slate-50 p-3">
                    <p className="text-sm font-semibold text-slate-800">{jornada.titulo}</p>
                    <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-700">
                      {jornada.passos.map((passo) => (
                        <li key={passo}>{passo}</li>
                      ))}
                    </ol>
                  </article>
                ))}
              </div>
            </div>
          </section>

          <section id="deploy" className="scroll-mt-24 rounded-xl border bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold">Execução e Deploy</h2>
            <div className="mt-4 overflow-x-auto rounded-lg border">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-4 py-2 font-semibold">Comando</th>
                    <th className="px-4 py-2 font-semibold">Uso</th>
                  </tr>
                </thead>
                <tbody>
                  {comandos.map((item) => (
                    <tr key={item.cmd} className="border-t">
                      <td className="px-4 py-2 font-mono text-xs text-slate-800">{item.cmd}</td>
                      <td className="px-4 py-2 text-slate-700">{item.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-sm text-slate-700">
              Consulte também: <span className="font-mono">README_SETUP.md</span>, <span className="font-mono">README_DEPLOY.md</span> e <span className="font-mono">ENV_VARIABLES.md</span>.
            </p>
          </section>

          <section id="handover" className="scroll-mt-24 rounded-xl border bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold">Handover Técnico</h2>
            <p className="mt-3 text-sm text-slate-700">
              Para quem assumir o projeto, a sequência recomendada é: entender entidades, rodar localmente, validar permissões,
              revisar fluxo de faturamento ponta a ponta e só então iniciar mudanças estruturais.
            </p>

            <div className="mt-4 rounded-lg border bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-800">Checklist inicial</p>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-700">
                <li>Configurar `.env` com as chaves corretas do Supabase.</li>
                <li>Subir app com `npm run dev` e validar login.</li>
                <li>Confirmar permissões do perfil no menu e nas ações.</li>
                <li>Validar contratos, casos, timesheet, despesas e faturamento.</li>
                <li>Executar `npm run type-check` e `npm run e2e` antes de deploy.</li>
              </ol>
            </div>

            <div className="mt-4 rounded-lg border p-4">
              <p className="text-sm font-semibold text-slate-800">Documentos já existentes no repositório</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {docsRelacionados.map((doc) => (
                  <span key={doc} className="rounded bg-slate-100 px-2 py-1 font-mono text-xs text-slate-700">
                    {doc}
                  </span>
                ))}
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  )
}
