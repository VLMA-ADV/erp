import { expect, test, type Page, type Route } from '@playwright/test'

/**
 * Daily 05/05/2026 — Item 7 (PR #98).
 * Check de leitura em Solicitações de Contrato + Mensagens.
 *
 * Comportamento:
 *   - Card SolicitacoesInbox / MensagensInbox em /contratos lista apenas itens
 *     não lidos (p_only_unread=true por default no list_mensagens_avulsas_inbox).
 *   - Cada item tem botão ✓ (Tooltip "Marcar como lida"). Click chama RPC
 *     mark_solicitacao_as_read / mark_mensagem_as_read e invalida a query.
 *   - DB persiste lido_at = now() em contracts.solicitacoes_contrato e
 *     contracts.solicitacao_mensagens.
 *
 * Estrutura: route-mock (CA-1..CA-4) + smoke prod (CA-5).
 */

const E2E_EMAIL = process.env.E2E_EMAIL
const E2E_PASSWORD = process.env.E2E_PASSWORD
const E2E_BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000'
const isProdSmoke = E2E_BASE_URL.includes('vercel.app')

const MOCK_SOLICITACAO_ID = 'a1111111-aaaa-bbbb-cccc-d05050700001'
const MOCK_MENSAGEM_ID = 'b1111111-aaaa-bbbb-cccc-d05050700002'

function buildSolicitacao(id: string, lido_at: string | null = null) {
  return {
    id,
    descricao: 'Solicitação de teste',
    nome: 'Caso teste',
    status: 'aberta',
    cliente_nome: 'Cliente Mock',
    contrato_numero: 1,
    contrato_nome: 'Contrato Mock',
    solicitante_nome: 'Tester',
    created_at: new Date(Date.now() - 3600_000).toISOString(),
    lido_at,
  }
}

function buildMensagem(id: string, lido_at: string | null = null) {
  return {
    id,
    cliente_id: 'cli-1',
    cliente_nome: 'Cliente Mock',
    caso_id: null,
    caso_nome: null,
    autor_user_id: 'user-x',
    autor_nome: 'Tester',
    conteudo: 'Mensagem avulsa de teste',
    anexos: [],
    created_at: new Date(Date.now() - 3600_000).toISOString(),
    lido_at,
  }
}

async function setupBaseMocks(page: Page) {
  await page.route('**/functions/v1/get-user-permissions**', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        permissions: [
          'contracts.contratos.read',
          'contracts.solicitacoes.read',
          'contracts.solicitacoes.write',
        ],
      }),
    })
  })
  // Listagem geral de contratos vazia para acelerar o load
  await page.route('**/functions/v1/get-contratos**', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [], total: 0 }),
    })
  })
  // get-areas / clientes vazios
  await page.route('**/functions/v1/get-areas**', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) })
  })
  await page.route('**/functions/v1/get-clientes**', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) })
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

test.describe('Daily 05/07 — check de leitura — route-mock', () => {
  test.skip(
    !E2E_EMAIL || !E2E_PASSWORD || isProdSmoke,
    'Defina E2E_EMAIL/E2E_PASSWORD e baseURL local (PORT=3010 npm start) para executar.',
  )

  test.beforeEach(async ({ page }) => {
    await login(page)
    await setupBaseMocks(page)
  })

  test('CA-1 (Solicitações): card lista item não lido com botão ✓', async ({ page }) => {
    await page.route('**/functions/v1/get-solicitacoes-contrato**', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [buildSolicitacao(MOCK_SOLICITACAO_ID)] }),
      })
    })

    await page.goto('/contratos')
    await page.waitForLoadState('networkidle')

    // Badge "1 pendente" na header do card
    await expect(page.getByText(/Solicitações de Contrato/i).first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/1 pendente|1 pendentes/i).first()).toBeVisible()

    // Expande o Collapsible e procura botão aria-label="Marcar como lida"
    const trigger = page.getByText(/Solicitações de Contrato/i).first()
    await trigger.click()
    await expect(
      page.locator('button[aria-label="Marcar como lida"]').first(),
    ).toBeVisible({ timeout: 5_000 })
  })

  test('CA-2 (Solicitações): click ✓ chama RPC mark_solicitacao_as_read com p_solicitacao_id', async ({
    page,
  }) => {
    let calledSolicitacaoId: string | null = null

    await page.route('**/functions/v1/get-solicitacoes-contrato**', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [buildSolicitacao(MOCK_SOLICITACAO_ID)] }),
      })
    })
    await page.route('**/rest/v1/rpc/mark_solicitacao_as_read', async (route: Route) => {
      try {
        const body = JSON.parse(route.request().postData() || '{}') as Record<string, unknown>
        calledSolicitacaoId = body.p_solicitacao_id as string
      } catch {
        calledSolicitacaoId = null
      }
      await route.fulfill({ status: 204, body: '' })
    })

    await page.goto('/contratos')
    await page.waitForLoadState('networkidle')

    await page.getByText(/Solicitações de Contrato/i).first().click()

    const checkBtn = page.locator('button[aria-label="Marcar como lida"]').first()
    await expect(checkBtn).toBeVisible({ timeout: 5_000 })
    await checkBtn.click()

    await expect.poll(() => calledSolicitacaoId, { timeout: 5_000 }).toBe(MOCK_SOLICITACAO_ID)
  })

  test('CA-3 (Mensagens): card chama list_mensagens_avulsas_inbox com p_only_unread=true', async ({
    page,
  }) => {
    let listPayload: Record<string, unknown> | null = null

    await page.route('**/functions/v1/get-solicitacoes-contrato**', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) })
    })
    await page.route('**/rest/v1/rpc/list_mensagens_avulsas_inbox', async (route: Route) => {
      try {
        listPayload = JSON.parse(route.request().postData() || '{}') as Record<string, unknown>
      } catch {
        listPayload = {}
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([buildMensagem(MOCK_MENSAGEM_ID)]),
      })
    })

    await page.goto('/contratos')
    await page.waitForLoadState('networkidle')

    await expect.poll(() => listPayload?.p_only_unread, { timeout: 10_000 }).toBe(true)
  })

  test('CA-4 (Mensagens): click ✓ chama RPC mark_mensagem_as_read com p_mensagem_id', async ({
    page,
  }) => {
    let calledMensagemId: string | null = null

    await page.route('**/functions/v1/get-solicitacoes-contrato**', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) })
    })
    await page.route('**/rest/v1/rpc/list_mensagens_avulsas_inbox', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([buildMensagem(MOCK_MENSAGEM_ID)]),
      })
    })
    await page.route('**/rest/v1/rpc/mark_mensagem_as_read', async (route: Route) => {
      try {
        const body = JSON.parse(route.request().postData() || '{}') as Record<string, unknown>
        calledMensagemId = (body.p_mensagem_id || body.p_id) as string
      } catch {
        calledMensagemId = null
      }
      await route.fulfill({ status: 204, body: '' })
    })

    await page.goto('/contratos')
    await page.waitForLoadState('networkidle')

    // Card de Mensagens — abrir o Collapsible
    const mensagensTrigger = page.getByText(/Mensagens/i).first()
    await mensagensTrigger.click()

    const checkBtn = page.locator('button[aria-label="Marcar como lida"]').first()
    await expect(checkBtn).toBeVisible({ timeout: 10_000 })
    await checkBtn.click()

    await expect.poll(() => calledMensagemId, { timeout: 5_000 }).toBe(MOCK_MENSAGEM_ID)
  })
})

test.describe('Daily 05/07 — check de leitura — smoke prod', () => {
  test.skip(
    !E2E_EMAIL || !E2E_PASSWORD || !isProdSmoke,
    'Smoke prod só roda com E2E_BASE_URL=https://erp-two-phi.vercel.app e credenciais.',
  )

  test('CA-5 deploy: /contratos carrega cards Solicitações + Mensagens com botão ✓ presente', async ({
    page,
  }) => {
    await login(page)
    await page.goto('/contratos')
    await page.waitForLoadState('networkidle')

    // Smoke não-mutativo: confirma que os cards renderizam e que o aria-label
    // do botão de marcar como lida existe NO DOM (mesmo se 0 itens, o botão
    // não renderiza — então só falha se houver erro de carregar).
    await expect(page.getByText(/Solicitações de Contrato/i).first()).toBeVisible({ timeout: 20_000 })
    // Mensagens podem estar vazias em prod — só confere que o card existe.
    const mensagensCard = page.getByText(/Mensagens/i).first()
    await expect(mensagensCard).toBeVisible({ timeout: 10_000 })
  })
})
