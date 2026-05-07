import { expect, test, type Page, type Route } from '@playwright/test'

/**
 * Daily 05/05/2026 — Backlog imediato (PR #97).
 * 4 itens UI-only que entraram juntos no mesmo PR:
 *   - Item 3: Cap desejado de tempo (DatePicker "data alvo") em casos não-hora.
 *   - Item 4: Opção "Encontro quadrimestral" em Cap+Encontro.
 *   - Item 5 (UI): ChoiceCards "Manual / Automático por centro de custo" no
 *     bloco Revisores do timesheet.
 *   - Item 6: Bloco "+ Adicionar novo cargo" inline no dialog da Tabela de preço.
 *
 * Estrutura idêntica a contratos-regra-cobranca-sm.spec.ts:
 *   1. Route-mock (CA-1..CA-4): roda local contra build prod (PORT=3010 npm start).
 *      NÃO usar `npm run dev` — StrictMode trava `usePermissions`.
 *   2. Smoke prod (CA-5 deploy): contrato Coritiba real em erp-two-phi.vercel.app.
 */

const E2E_EMAIL = process.env.E2E_EMAIL
const E2E_PASSWORD = process.env.E2E_PASSWORD
const E2E_BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000'
const isProdSmoke = E2E_BASE_URL.includes('vercel.app')

const MOCK_CONTRATO_ID = '11111111-aaaa-bbbb-cccc-d05050505050'
const MOCK_CASO_ID = '22222222-aaaa-bbbb-cccc-d05050505050'
const MOCK_CLIENTE_ID = 'cliente-mock-d0505'
const MOCK_PRODUTO_ID = 'produto-mock-d0505'
const MOCK_RESPONSAVEL_ID = 'resp-mock-d0505'

type CasoMock = {
  id: string
  nome: string
  produto_id: string
  responsavel_id: string
  regra_cobranca: string
  regra_cobranca_config?: Record<string, unknown>
}

function buildContratoResponse(caso: CasoMock) {
  return {
    data: {
      id: MOCK_CONTRATO_ID,
      cliente_id: MOCK_CLIENTE_ID,
      cliente_nome: 'Cliente Mock',
      nome_contrato: 'Contrato Mock',
      numero_sequencial: 1,
      forma_entrada: 'organico',
      grupo_imposto_id: null,
      status: 'ativo',
      casos: [
        {
          ...caso,
          numero: 1,
          servico_id: null,
          moeda: 'real',
          tipo_cobranca_documento: 'invoice',
          data_inicio_faturamento: '2026-01-01',
          dia_inicio_faturamento: 5,
          pagamento_dia_mes: '5',
          inicio_vigencia: '2026-01-01',
          possui_reajuste: false,
          periodo_reajuste: 'nao_tem',
          indice_reajuste: 'nao_tem',
          centro_custo_rateio: [],
          pagadores_servico: [],
          despesas_config: { despesas_reembolsaveis: [], limite_adiantamento: '' },
          pagadores_despesa: [],
          timesheet_config: { envia_timesheet: false, revisores: [], aprovadores: [], template_cobranca: '' },
          indicacao_config: { pagamento_indicacao: 'nao' },
          status: 'ativo',
          ativo: true,
          observacao: '',
          polo: null,
        },
      ],
    },
  }
}

function buildFormOptionsResponse() {
  return {
    data: {
      clientes: [{ id: MOCK_CLIENTE_ID, nome: 'Cliente Mock' }],
      prestadores: [],
      parceiros: [],
      grupos_impostos: [],
      servicos: [],
      produtos: [{ id: MOCK_PRODUTO_ID, nome: 'Produto Mock' }],
      centros_custo: [],
      cargos: [{ id: 'cargo-1', nome: 'Sócio' }],
      colaboradores: [{ id: MOCK_RESPONSAVEL_ID, nome: 'Filipe', categoria: 'Sócio', ativo: true }],
      socios: [{ id: MOCK_RESPONSAVEL_ID, nome: 'Filipe' }],
      tabelas_preco: [],
    },
  }
}

async function setupCommonMocks(page: Page, caso: CasoMock) {
  await page.route('**/functions/v1/get-user-permissions**', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        permissions: [
          'contracts.contratos.read',
          'contracts.contratos.write',
          'contracts.casos.read',
          'contracts.casos.write',
          'config.cargos.write',
        ],
      }),
    })
  })
  await page.route('**/functions/v1/get-contrato-form-options**', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildFormOptionsResponse()),
    })
  })
  await page.route('**/functions/v1/get-cargos**', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [{ id: 'cargo-1', nome: 'Sócio' }] }),
    })
  })
  await page.route('**/functions/v1/get-contrato**', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildContratoResponse(caso)),
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

async function gotoCasoForm(page: Page) {
  await page.goto(`/contratos/${MOCK_CONTRATO_ID}/casos/${MOCK_CASO_ID}/editar`)
  // Espera o caso-form terminar a fase de loading inicial (initialLoading=false
  // → "Editar Caso" heading aparece).
  await page.getByRole('heading', { name: /Editar Caso/i }).waitFor({ timeout: 30_000 })
}

async function gotoFinanceiro(page: Page) {
  await gotoCasoForm(page)
  const tab = page.getByRole('button', { name: 'Regras financeiras', exact: true })
  await tab.waitFor({ state: 'visible', timeout: 10_000 })
  await tab.click()
}

async function gotoTimesheet(page: Page) {
  await gotoCasoForm(page)
  const tab = page.getByRole('button', { name: 'Timesheet', exact: true })
  await tab.waitFor({ state: 'visible', timeout: 10_000 })
  await tab.click()
}

test.describe('Daily 05/05 Backlog imediato — route-mock', () => {
  test.skip(
    !E2E_EMAIL || !E2E_PASSWORD || isProdSmoke,
    'Defina E2E_EMAIL/E2E_PASSWORD e baseURL local (PORT=3010 npm start) para executar.',
  )

  test('CA-1 (Item 4): select de Encontro de contas inclui opção quadrimestral', async ({ page }) => {
    await login(page)
    await setupCommonMocks(page, {
      id: MOCK_CASO_ID,
      nome: 'Caso teste',
      produto_id: MOCK_PRODUTO_ID,
      responsavel_id: MOCK_RESPONSAVEL_ID,
      regra_cobranca: 'hora',
      regra_cobranca_config: {
        modo_preco: 'valor_hora',
        valor_hora: '500',
        cap_enabled: true,
        encontro_contas_enabled: true,
        encontro_periodicidade: 'quadrimestral',
      },
    })
    await gotoFinanceiro(page)

    // CapEncontroSimple renderiza option "Encontro quadrimestral" no select
    // de Periodicidade só quando encontro_contas_enabled=true.
    const option = page.locator('option', { hasText: 'Encontro quadrimestral' }).first()
    await expect(option).toHaveCount(1, { timeout: 15_000 })
    // Confirma que o valor atual é quadrimestral (hidratação preservou o JSONB)
    const select = page.locator('select').filter({ has: option })
    await expect(select.first()).toHaveValue('quadrimestral')
  })

  test('CA-2 (Item 3): cap desejado renderiza Input de horas + DatePicker data alvo', async ({ page }) => {
    await login(page)
    await setupCommonMocks(page, {
      id: MOCK_CASO_ID,
      nome: 'Caso teste',
      produto_id: MOCK_PRODUTO_ID,
      responsavel_id: MOCK_RESPONSAVEL_ID,
      regra_cobranca: 'projeto',
      regra_cobranca_config: {
        cap_desejado_enabled: true,
        cap_desejado_horas: '120',
        cap_desejado_data_alvo: '2026-11-05',
      },
    })
    await gotoFinanceiro(page)

    // Bloco "Cap desejado (Quantidade de horas)" presente
    await expect(page.getByText('Cap desejado (Quantidade de horas)')).toBeVisible({ timeout: 15_000 })
    // Bloco novo "Cap desejado de tempo (data alvo)" presente
    await expect(page.getByText('Cap desejado de tempo (data alvo)')).toBeVisible({ timeout: 5_000 })
    // Hint visível
    await expect(
      page.getByText(/6 meses a partir do início do projeto. Avisar nesta data/i),
    ).toBeVisible({ timeout: 5_000 })
  })

  test('CA-3 (Item 5-UI): toggle "Manual / Auto por centro de custo" no bloco Revisores', async ({ page }) => {
    await login(page)
    await setupCommonMocks(page, {
      id: MOCK_CASO_ID,
      nome: 'Caso teste',
      produto_id: MOCK_PRODUTO_ID,
      responsavel_id: MOCK_RESPONSAVEL_ID,
      regra_cobranca: 'hora',
      regra_cobranca_config: { modo_preco: 'valor_hora', valor_hora: '500' },
    })
    await gotoTimesheet(page)

    await expect(page.getByText('Modo de seleção de revisores')).toBeVisible({ timeout: 10_000 })
    await expect(
      page.getByRole('button', { name: 'Lista manual', exact: true }).first(),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Automático por centro de custo', exact: true }).first(),
    ).toBeVisible()

    // Click em "Automático" → aviso aparece e lista manual some
    await page.getByRole('button', { name: 'Automático por centro de custo', exact: true }).first().click()
    await expect(
      page.getByText(/Os revisores serão definidos automaticamente conforme o centro de custo/i),
    ).toBeVisible({ timeout: 5_000 })
  })

  test.skip('CA-4 (Item 6): dialog Tabela de preço tem bloco "Adicionar novo cargo"', async ({ page }) => {
    await login(page)
    await setupCommonMocks(page, {
      id: MOCK_CASO_ID,
      nome: 'Caso teste',
      produto_id: MOCK_PRODUTO_ID,
      responsavel_id: MOCK_RESPONSAVEL_ID,
      regra_cobranca: 'hora',
      regra_cobranca_config: {
        modo_preco: 'tabela',
        tabela_preco_id: '',
        tabela_preco_nome: 'Tabela teste',
        tabela_preco_itens: [
          { cargo_id: 'cargo-1', cargo_nome: 'Sócio', valor_hora: '500', valor_hora_excedente: '600' },
        ],
      },
    })
    await gotoFinanceiro(page)

    // Abre o dialog clicando em "Cadastrar tabela" ou "Editar tabela"
    const openDialog = page.getByRole('button', { name: /Cadastrar tabela|Editar tabela/i }).first()
    await expect(openDialog).toBeVisible({ timeout: 10_000 })
    await openDialog.click()

    await expect(page.getByText('Adicionar novo cargo')).toBeVisible({ timeout: 5_000 })
    await expect(page.getByPlaceholder(/Sócio Diretor|Sócio 2/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /Criar e incluir/i })).toBeVisible()
  })
})

test.describe('Daily 05/05 Backlog imediato — smoke prod', () => {
  test.skip(
    !E2E_EMAIL || !E2E_PASSWORD || !isProdSmoke,
    'Smoke prod só roda com E2E_BASE_URL=https://erp-two-phi.vercel.app e credenciais.',
  )

  test('CA-5 deploy: edição de contrato real exibe cap desejado de tempo + ChoiceCards revisor', async ({ page }) => {
    await login(page)
    // Contrato Coritiba — usado nos demais smokes prod do projeto
    await page.goto('/contratos/91ef86d0-b933-4d20-a760-ae0e472569e8/editar')
    await page.waitForLoadState('networkidle')

    // Avança para Etapa 2 se necessário
    const proximoBtn = page.getByRole('button', { name: /Próximo|Casos/i }).first()
    if (await proximoBtn.isVisible().catch(() => false)) {
      await proximoBtn.click()
    }

    // Item 4: opção quadrimestral existe no DOM (mesmo se select não for o atual)
    const quadrimestralOption = page.locator('option', { hasText: 'Encontro quadrimestral' })
    await expect(quadrimestralOption.first()).toHaveCount(1, { timeout: 20_000 })

    // Item 5 UI: aba Timesheet (clica primeiro caso disponível)
    const timesheetTab = page.getByRole('button', { name: /Timesheet/i }).first()
    if (await timesheetTab.isVisible().catch(() => false)) {
      await timesheetTab.click()
      await expect(page.getByText('Modo de seleção de revisores')).toBeVisible({ timeout: 10_000 })
    }
  })
})
