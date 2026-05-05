import { expect, test, type Page, type Route } from '@playwright/test'

/**
 * Daily Filipe 04/05 22:03 (WhatsApp): solicitação NÃO cria contrato automático.
 * "Pode tirar essa amarra e deixar como se fosse uma mensagem mesmo no inbox ali"
 *
 * Plan C-bis: frontend bypassa edge create-solicitacao-contrato (fallback
 * defensivo criava contrato) e chama RPC direto via supabase.rpc.
 * Migration aditiva (CREATE OR REPLACE) ajusta RPC para não inserir em contratos.
 *
 * Two groups:
 *   1. Route-mock (CA-1, CA-2): roda contra build PROD local (PORT=3010 npm start).
 *   2. Smoke prod (CA-3): roda com E2E_BASE_URL=https://erp-two-phi.vercel.app.
 */

const E2E_EMAIL = process.env.E2E_EMAIL
const E2E_PASSWORD = process.env.E2E_PASSWORD
const E2E_BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000'
const isProdSmoke = E2E_BASE_URL.includes('vercel.app')

const MOCK_CLIENTE_ID = '00000000-0000-0000-0000-000000000111'
const MOCK_SOLICITACAO_ID = '00000000-0000-0000-0000-000000000222'

function permissionsResponse() {
  return {
    permissions: [
      'contracts.solicitacoes.read',
      'contracts.solicitacoes.write',
      'contracts.contratos.read',
      'crm.clientes.write',
    ],
  }
}

function clientesResponse() {
  return {
    data: [{ id: MOCK_CLIENTE_ID, nome: 'Cliente Mock' }],
  }
}

function emptySolicitacoesResponse() {
  return { data: [] }
}

async function setupBaseMocks(page: Page) {
  await page.route('**/functions/v1/get-user-permissions**', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(permissionsResponse()),
    })
  })
  await page.route('**/functions/v1/get-clientes**', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(clientesResponse()),
    })
  })
  await page.route('**/functions/v1/get-solicitacoes-contrato**', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(emptySolicitacoesResponse()),
    })
  })
  await page.route('**/functions/v1/get-areas**', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) })
  })
  // Inboxes secundárias retornam vazio para não bloquear a tela.
  await page.route('**/rest/v1/solicitacao_mensagens**', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
  })
  await page.route('**/functions/v1/list-contratos-inbox-mensagens**', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ mensagens: [], total: 0 }),
    })
  })
}

async function login(page: Page) {
  await page.context().clearCookies()
  await page.goto('/login')
  await page.getByLabel('E-mail').waitFor({ state: 'visible', timeout: 30_000 })
  await page.getByLabel('E-mail').fill(E2E_EMAIL || '')
  await page.getByLabel('Senha').fill(E2E_PASSWORD || '')
  await page.getByRole('button', { name: 'Entrar' }).click()
  await page.waitForURL(/\/home/, { timeout: 30_000 })
}

test.describe('Solicitação sem contrato auto (route-mock)', () => {
  test.skip(
    !E2E_EMAIL || !E2E_PASSWORD || isProdSmoke,
    'Defina E2E_EMAIL/E2E_PASSWORD e baseURL local (PORT=3010 npm start) para executar.',
  )

  test.beforeEach(async ({ page }) => {
    await login(page)
    await setupBaseMocks(page)
  })

  test('CA-1: submit chama RPC create_solicitacao_contrato e NÃO bate na edge', async ({ page }) => {
    let rpcBody: Record<string, unknown> | null = null
    let edgeHit = false

    await page.route('**/rest/v1/rpc/create_solicitacao_contrato', async (route: Route) => {
      try {
        rpcBody = JSON.parse(route.request().postData() || '{}') as Record<string, unknown>
      } catch {
        rpcBody = {}
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: MOCK_SOLICITACAO_ID, contrato_id: null }),
      })
    })

    // Edge não pode ser chamada — Plan C-bis bypassa. Se for chamada, marca flag.
    await page.route('**/functions/v1/create-solicitacao-contrato', async (route: Route) => {
      edgeHit = true
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { id: 'edge-fallback-id' } }),
      })
    })

    await page.goto('/solicitacoes-contrato?action=new')

    // Dialog custom (sem role=dialog). Ancorar por heading do título.
    const heading = page.getByRole('heading', { name: 'Nova solicitação de abertura de contrato' })
    await expect(heading).toBeVisible({ timeout: 15_000 })

    // Comboboxes do form (Cliente=nth(0), Centro de custo=nth(1)).
    await page.getByRole('combobox').nth(0).click()
    await page.getByRole('button', { name: 'Cliente Mock', exact: true }).click()

    await page.getByPlaceholder('Nome do caso').fill('Solicitação teste sem contrato')
    await page
      .getByPlaceholder('Descreva a solicitação para o financeiro concluir o cadastro')
      .fill('Teste daily 04/05')

    await page.getByRole('button', { name: 'Criar solicitação' }).click()

    await expect(heading).toBeHidden({ timeout: 10_000 })

    expect(edgeHit).toBe(false)
    expect(rpcBody).not.toBeNull()
    const payload = rpcBody?.p_payload as Record<string, unknown> | undefined
    expect(payload?.cliente_id).toBe(MOCK_CLIENTE_ID)
    expect(payload?.nome).toBe('Solicitação teste sem contrato')
    expect(rpcBody?.p_user_id).toBeTruthy()
  })

  test('CA-2: inbox renderiza solicitação com contrato Pendente quando contrato_id null', async ({ page }) => {
    // Override do mock base para retornar 1 solicitação sem contrato_id.
    await page.route('**/functions/v1/get-solicitacoes-contrato**', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: MOCK_SOLICITACAO_ID,
              nome: 'Solicitação Pendente',
              descricao: 'Aguardando aprovação',
              status: 'aberta',
              cliente_id: MOCK_CLIENTE_ID,
              cliente_nome: 'Cliente Mock',
              contrato_id: null,
              contrato_numero: null,
              contrato_nome: null,
              solicitante_user_id: 'user-x',
              solicitante_nome: 'Tester',
              created_at: new Date().toISOString(),
              anexos: [],
            },
          ],
        }),
      })
    })

    await page.goto('/solicitacoes-contrato')

    // Linha da solicitação aparece. Coluna de contrato exibe "-" (sem contrato_id).
    await expect(page.getByText('Solicitação Pendente').first()).toBeVisible({ timeout: 15_000 })
  })
})

test.describe('Solicitação sem contrato auto — smoke prod', () => {
  test.skip(
    !E2E_EMAIL || !E2E_PASSWORD || !isProdSmoke,
    'Smoke prod só roda com E2E_BASE_URL=https://erp-two-phi.vercel.app e credenciais.',
  )

  test('CA-3 deploy: form de Solicitação carrega em /solicitacoes-contrato pós-deploy', async ({ page }) => {
    await login(page)
    await page.goto('/solicitacoes-contrato')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: /Solicitações de Contrato/i })).toBeVisible({ timeout: 20_000 })
  })
})
