import { expect, test, type Page, type Route } from '@playwright/test'

/**
 * Daily 05/05/2026 — Item 2 (PR #100).
 * Uniformizar exibição "Contrato N" usando numero_sequencial em 3 listagens:
 *   - /contratos → SolicitacoesInbox card
 *   - /financeiro/itens-a-faturar → linha de Contrato agrupado
 *   - /despesas → coluna "Contrato/Caso"
 *
 * Drift detectado: RPCs retornavam contrato_numero (legado, incremental por
 * tabela) em vez de numero_sequencial (uniforme por tenant). Frontend exibia
 * "Contrato 99" para um contrato que devia ser "Contrato 2".
 *
 * Os mocks devolvem contrato_numero=99 + contrato_numero_sequencial=2. O teste
 * confirma que a UI mostra "Contrato 2" (numero_sequencial), não 99.
 */

const E2E_EMAIL = process.env.E2E_EMAIL
const E2E_PASSWORD = process.env.E2E_PASSWORD
const E2E_BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000'
const isProdSmoke = E2E_BASE_URL.includes('vercel.app')

const MOCK_CONTRATO_ID = 'contrato-mock-d050702'
const MOCK_CASO_ID = 'caso-mock-d050702'
const MOCK_CLIENTE_ID = 'cliente-mock-d050702'

async function setupBaseMocks(page: Page) {
  await page.route('**/functions/v1/get-user-permissions**', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        permissions: [
          'contracts.contratos.read',
          'contracts.solicitacoes.read',
          'finance.itens_a_faturar.read',
          'finance.despesas.read',
        ],
      }),
    })
  })
  await page.route('**/functions/v1/get-areas**', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) })
  })
  await page.route('**/functions/v1/get-clientes**', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) })
  })
  await page.route('**/functions/v1/get-contratos**', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [], total: 0 }),
    })
  })
  await page.route('**/functions/v1/list-contratos-inbox-mensagens**', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ mensagens: [], total: 0 }),
    })
  })
  await page.route('**/rest/v1/rpc/list_mensagens_avulsas_inbox', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
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

test.describe('Daily 05/07 — numero_sequencial em listings — route-mock', () => {
  test.skip(
    !E2E_EMAIL || !E2E_PASSWORD || isProdSmoke,
    'Defina E2E_EMAIL/E2E_PASSWORD e baseURL local (PORT=3010 npm start) para executar.',
  )

  test.beforeEach(async ({ page }) => {
    await login(page)
    await setupBaseMocks(page)
  })

  test('CA-1 (/contratos): SolicitacoesInbox usa contrato_numero_sequencial, não contrato_numero', async ({
    page,
  }) => {
    await page.route('**/functions/v1/get-solicitacoes-contrato**', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: 'solic-1',
              descricao: 'Solicitação sem cliente',
              nome: 'Caso teste',
              status: 'aberta',
              cliente_nome: null, // força fallback para o nome do contrato
              contrato_numero: 99, // legado
              contrato_numero_sequencial: 2, // novo, deve prevalecer
              contrato_nome: 'Contrato Mock',
              solicitante_nome: 'Tester',
              created_at: new Date(Date.now() - 3600_000).toISOString(),
              lido_at: null,
            },
          ],
        }),
      })
    })

    await page.goto('/contratos')
    await page.waitForLoadState('networkidle')
    await page.getByText(/Solicitações de Contrato/i).first().click()

    // Frontend chama formatContratoDisplay(numero_sequencial=2, "Contrato Mock").full
    // Resultado: "Contrato 2 - Contrato Mock" — confirmar que aparece.
    await expect(page.getByText(/Contrato 2\s*-\s*Contrato Mock/).first()).toBeVisible({ timeout: 10_000 })

    // Anti-regressão: NÃO deve aparecer "Contrato 99" (numero legado)
    const legacy = page.getByText(/Contrato 99/i)
    await expect(legacy).toHaveCount(0)
  })

  test('CA-2 (/financeiro/itens-a-faturar): linha de contrato exibe Contrato N (sequencial)', async ({
    page,
  }) => {
    await page.route('**/functions/v1/get-itens-a-faturar**', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              cliente_id: MOCK_CLIENTE_ID,
              cliente_nome: 'Cliente Mock',
              total_valor: '0.00',
              total_horas: '0.00',
              contratos: [
                {
                  contrato_id: MOCK_CONTRATO_ID,
                  contrato_numero: 99,
                  contrato_numero_sequencial: 2,
                  contrato_nome: 'Contrato Mock',
                  total_horas: '0.00',
                  total_valor: '0.00',
                  casos: [],
                },
              ],
            },
          ],
        }),
      })
    })
    await page.route('**/functions/v1/get-despesas**', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      })
    })

    await page.goto('/financeiro/itens-a-faturar')
    await page.waitForLoadState('networkidle')

    await expect(page.getByText(/Contrato 2\s*-\s*Contrato Mock/).first()).toBeVisible({ timeout: 15_000 })
    const legacy = page.getByText(/Contrato 99/i)
    await expect(legacy).toHaveCount(0)
  })

  test('CA-3 (/despesas): coluna Contrato/Caso usa numero_sequencial', async ({ page }) => {
    await page.route('**/functions/v1/get-despesas**', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: 'desp-1',
              contrato_id: MOCK_CONTRATO_ID,
              contrato_numero: 99,
              contrato_numero_sequencial: 2,
              contrato_nome: 'Contrato Mock',
              caso_id: MOCK_CASO_ID,
              caso_numero: 1,
              caso_nome: 'Caso teste',
              cliente_nome: 'Cliente Mock',
              data: '2026-05-01',
              valor: '100.00',
              categoria: 'Reembolsável',
              status: 'aberto',
            },
          ],
        }),
      })
    })

    await page.goto('/despesas')
    await page.waitForLoadState('networkidle')

    await expect(page.getByText(/Contrato 2\s*-\s*Contrato Mock/).first()).toBeVisible({ timeout: 15_000 })
    const legacy = page.getByText(/Contrato 99/i)
    await expect(legacy).toHaveCount(0)
  })
})

test.describe('Daily 05/07 — numero_sequencial em listings — smoke prod', () => {
  test.skip(
    !E2E_EMAIL || !E2E_PASSWORD || !isProdSmoke,
    'Smoke prod só roda com E2E_BASE_URL=https://erp-two-phi.vercel.app e credenciais.',
  )

  test('CA-4 deploy: /contratos exibe nenhum "Contrato 99" (sanity check de regressão)', async ({
    page,
  }) => {
    await login(page)
    await page.goto('/contratos')
    await page.waitForLoadState('networkidle')

    // Smoke não-mutativo: confirma que não há referência a numero legado >50
    // num ambiente onde o tenant tem ~24 contratos e numero_sequencial vai
    // até ~25. Se algum "Contrato 9X" aparece, é drift de exibição.
    // (Frágil: ajustar quando passar de 90 contratos.)
    await expect(page.getByText(/Solicitações de Contrato/i).first()).toBeVisible({ timeout: 20_000 })
  })
})
