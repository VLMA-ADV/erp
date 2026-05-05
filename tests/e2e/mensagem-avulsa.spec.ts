import { expect, test, type Page, type Route } from '@playwright/test'

/**
 * Feature F — Solicitação de Mensagem solta (daily Filipe 30/04 + 04/05).
 *
 * Dois grupos:
 * 1. Route-mock (CA-1..CA-4): roda contra build PROD local
 *    (`npm run build && PORT=3010 npm start`). NÃO usar `npm run dev` —
 *    `reactStrictMode` em dev duplica `useEffect` e o hook `usePermissions`
 *    aborta antes de popular permissions, deixando inbox sem botão.
 * 2. Smoke prod (CA-5): roda com `E2E_BASE_URL=https://erp-two-phi.vercel.app`
 *    e credenciais reais do Filipe — pega bundle quebrado / env var faltando.
 */

const E2E_EMAIL = process.env.E2E_EMAIL
const E2E_PASSWORD = process.env.E2E_PASSWORD
const E2E_BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000'
const isProdSmoke = E2E_BASE_URL.includes('vercel.app')

const MOCK_CLIENTE_ID = 'cliente-mock-id'
const MOCK_CASO_ID = 'caso-mock-id'

function permissionsResponse(extra: string[] = []) {
  return {
    permissions: [
      'contracts.solicitacoes.read',
      'contracts.solicitacoes.write',
      'contracts.contratos.read',
      'crm.clientes.write',
      ...extra,
    ],
  }
}

function clientesResponse() {
  return {
    data: [
      { id: MOCK_CLIENTE_ID, nome: 'Cliente Mock' },
      { id: 'outro-cliente', nome: 'Outro Cliente' },
    ],
  }
}

function contratosResponse() {
  return {
    data: [
      {
        id: 'contrato-mock-id',
        cliente_id: MOCK_CLIENTE_ID,
        nome_contrato: 'Contrato Mock',
        casos: [
          { id: MOCK_CASO_ID, nome: 'Caso Mock 1' },
          { id: 'caso-outro-id', nome: 'Caso Mock 2' },
        ],
      },
      {
        id: 'contrato-outro-id',
        cliente_id: 'outro-cliente',
        nome_contrato: 'Contrato Outro',
        casos: [{ id: 'caso-outro-cliente', nome: 'Caso de Outro Cliente' }],
      },
    ],
  }
}

async function setupBaseMocks(page: Page) {
  await page.route('**/functions/v1/get-user-permissions**', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(permissionsResponse()),
    })
  })
  // Plan C: inbox lê via supabase-js → /rest/v1/solicitacao_mensagens (schema contracts).
  await page.route('**/rest/v1/solicitacao_mensagens**', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    })
  })
  // Edge legacy ainda servida por ContratosInbox (mensagens vinculadas).
  await page.route('**/functions/v1/list-contratos-inbox-mensagens**', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ mensagens: [], total: 0 }),
    })
  })
  await page.route('**/functions/v1/get-clientes**', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(clientesResponse()),
    })
  })
  await page.route('**/functions/v1/get-contratos**', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(contratosResponse()),
    })
  })
  // Demais inboxes — devolvem vazio para não bloquear a tela
  await page.route('**/functions/v1/get-solicitacoes-contrato**', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) })
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

test.describe('Mensagem avulsa (route-mock)', () => {
  test.skip(
    !E2E_EMAIL || !E2E_PASSWORD || isProdSmoke,
    'Defina E2E_EMAIL/E2E_PASSWORD e baseURL local (npm run build && PORT=3010 npm start) para executar.',
  )

  test.beforeEach(async ({ page }) => {
    await login(page)
    await setupBaseMocks(page)
  })

  test('CA-1: card "Mensagens" aparece em /contratos com badge e botão "Nova mensagem"', async ({ page }) => {
    await page.goto('/contratos')
    await expect(page.getByRole('button', { name: 'Nova mensagem' })).toBeVisible({ timeout: 15_000 })
    // exact: true para não colidir com "Nenhuma mensagem recente" do ContratosInbox legacy.
    await expect(page.getByText('Nenhuma mensagem', { exact: true })).toBeVisible()
  })

  test('CA-2: clicar "Nova mensagem" abre dialog com 4 campos (Cliente / Caso / Mensagem / Arquivos)', async ({ page }) => {
    await page.goto('/contratos')
    await page.getByRole('button', { name: 'Nova mensagem' }).click()
    const dialog = page.getByTestId('mensagem-avulsa-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Cliente', { exact: true })).toBeVisible()
    await expect(dialog.getByText('Caso', { exact: true })).toBeVisible()
    await expect(dialog.getByText('Mensagem', { exact: true })).toBeVisible()
    await expect(dialog.getByText('Arquivos', { exact: true })).toBeVisible()
  })

  test('CA-3: cascata Cliente→Caso (caso desabilitado sem cliente; lista filtra ao selecionar cliente)', async ({ page }) => {
    await page.goto('/contratos')
    await page.getByRole('button', { name: 'Nova mensagem' }).click()
    const dialog = page.getByTestId('mensagem-avulsa-dialog')
    await expect(dialog).toBeVisible()

    // Antes de selecionar cliente: campo de Caso renderiza placeholder informativo
    await expect(dialog.locator('text=Selecione o cliente primeiro')).toBeVisible()

    // CommandSelect usa role=combobox no Button trigger. nth(0) = cliente, nth(1) = caso.
    // Opções no popover renderizam como <button>, não role=option.
    await dialog.getByRole('combobox').nth(0).click()
    await page.getByRole('button', { name: 'Cliente Mock', exact: true }).click()

    await dialog.getByRole('combobox').nth(1).click()
    await expect(page.getByRole('button', { name: 'Caso Mock 1', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Caso Mock 2', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Caso de Outro Cliente', exact: true })).toHaveCount(0)
  })

  test('CA-4: criar mensagem invoca RPC create_mensagem_avulsa com payload correto', async ({ page }) => {
    let rpcBody: Record<string, unknown> | null = null
    // Plan C: form posta direto via supabase.rpc → /rest/v1/rpc/create_mensagem_avulsa.
    await page.route('**/rest/v1/rpc/create_mensagem_avulsa', async (route: Route) => {
      try {
        rpcBody = JSON.parse(route.request().postData() || '{}') as Record<string, unknown>
      } catch {
        rpcBody = {}
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'mensagem-criada-id',
          tenant_id: 'tenant-mock',
          cliente_id: MOCK_CLIENTE_ID,
          caso_id: MOCK_CASO_ID,
        }),
      })
    })

    await page.goto('/contratos')
    await page.getByRole('button', { name: 'Nova mensagem' }).click()
    const dialog = page.getByTestId('mensagem-avulsa-dialog')
    await expect(dialog).toBeVisible()

    await dialog.getByRole('combobox').nth(0).click()
    await page.getByRole('button', { name: 'Cliente Mock', exact: true }).click()

    await dialog.getByRole('combobox').nth(1).click()
    await page.getByRole('button', { name: 'Caso Mock 1', exact: true }).click()

    await dialog.getByRole('textbox').last().fill('Teste F mensagem avulsa')

    await dialog.getByRole('button', { name: 'Registrar mensagem' }).click()

    await expect(dialog).toBeHidden({ timeout: 5_000 })
    expect(rpcBody).not.toBeNull()
    const payload = rpcBody?.p_payload as Record<string, unknown> | undefined
    expect(payload?.mensagem).toBe('Teste F mensagem avulsa')
    expect(payload?.cliente_id).toBe(MOCK_CLIENTE_ID)
    expect(payload?.caso_id).toBe(MOCK_CASO_ID)
    expect(rpcBody?.p_user_id).toBeTruthy()
  })
})

test.describe('Mensagem avulsa — smoke prod (sem mocks, valida bundle deployado)', () => {
  test.skip(
    !E2E_EMAIL || !E2E_PASSWORD || !isProdSmoke,
    'Smoke prod só roda com E2E_BASE_URL=https://erp-two-phi.vercel.app e credenciais.',
  )

  test('CA-5 deploy: card "Mensagens" visível em /contratos pós-deploy', async ({ page }) => {
    await login(page)
    await page.goto('/contratos')
    await page.waitForLoadState('networkidle')
    const card = page.locator('text=Mensagens').first()
    await expect(card).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('button', { name: 'Nova mensagem' })).toBeVisible()
  })
})
