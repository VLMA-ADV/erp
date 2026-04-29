import { expect, test, type Page } from '@playwright/test'

/**
 * Item 3 — Êxito: ChoiceCards Porcentagem / Valor.
 *
 * Filipe (daily 28/04, 04:09): regra `exito` hoje só tem "porcentagem do
 * valor da ação". Adicionar ChoiceCards Porcentagem (default) / Valor —
 * modo Valor abre MoneyInput "Valor fixo do êxito" e ignora a porcentagem.
 *
 * Tradução só na UI, ZERO migration. State preserva campos existentes
 * (`percentual_exito`, `valor_acao`, `valor_exito_calculado`,
 * `data_pagamento_exito`) e adiciona `exito_modo` + `exito_valor_fixo` no
 * `regra_cobranca_config` (JSONB).
 *
 * Compat: caso legado sem `exito_modo` carrega em modo Porcentagem (default).
 *
 * IMPORTANTE: rodar contra build prod local (`npm run build && PORT=3010 npm
 * start`), NUNCA `npm run dev` — `reactStrictMode` em dev duplica `useEffect`
 * e trava `usePermissions`, deixando o caso-form em modo read-only.
 */

const E2E_EMAIL = process.env.E2E_EMAIL
const E2E_PASSWORD = process.env.E2E_PASSWORD
const E2E_BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000'
const isProdSmoke = E2E_BASE_URL.includes('vercel.app')

const MOCK_CONTRATO_ID = '11111111-2222-3333-4444-555555555555'
const MOCK_CASO_ID = '99999999-8888-7777-6666-555555555555'
const MOCK_CLIENTE_ID = 'cliente-mock-id'
const MOCK_PRODUTO_ID = 'produto-mock-id'
const MOCK_RESPONSAVEL_ID = 'resp-mock-id'

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
  await page.route('**/functions/v1/get-user-permissions**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        permissions: [
          'contracts.contratos.read',
          'contracts.contratos.write',
          'contracts.casos.read',
          'contracts.casos.write',
        ],
      }),
    })
  })
  await page.route('**/functions/v1/get-contrato-form-options**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(buildFormOptionsResponse()) })
  })
  await page.route('**/functions/v1/get-cargos**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [{ id: 'cargo-1', nome: 'Sócio', ativo: true }] }),
    })
  })
  await page.route('**/functions/v1/get-contrato**', async (route) => {
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

async function gotoFinanceiro(page: Page) {
  await page.goto(`/contratos/${MOCK_CONTRATO_ID}/casos/${MOCK_CASO_ID}/editar`)
  await page.getByRole('button', { name: /Regras financeiras/i }).click()
}

function regraSelect(page: Page) {
  return page.locator('label:has-text("Regra de cobrança") + select')
}

test.describe('Item 3 — Regra de cobrança Êxito: ChoiceCards Porcentagem/Valor (route-mock)', () => {
  test.skip(!E2E_EMAIL || !E2E_PASSWORD || isProdSmoke, 'Defina E2E_EMAIL e E2E_PASSWORD (e baseURL local em modo PROD: npm run build && PORT=3010 npm start) para executar.')

  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('CA-1: selecionar Êxito mostra ChoiceCards Porcentagem/Valor (default Porcentagem)', async ({ page }) => {
    await setupCommonMocks(page, {
      id: MOCK_CASO_ID,
      nome: 'Caso Mock',
      produto_id: MOCK_PRODUTO_ID,
      responsavel_id: MOCK_RESPONSAVEL_ID,
      regra_cobranca: 'mensal',
      regra_cobranca_config: { valor_mensal: '1000' },
    })
    await gotoFinanceiro(page)

    await regraSelect(page).selectOption('exito')

    const bloco = page.getByTestId('bloco-exito')
    await expect(bloco).toBeVisible()
    await expect(bloco.getByText('Configuração de cobrança por Êxito')).toBeVisible()
    await expect(bloco.getByRole('button', { name: 'Porcentagem' })).toBeVisible()
    await expect(bloco.getByRole('button', { name: 'Valor' })).toBeVisible()
    // Default = Porcentagem: os 3 inputs originais aparecem.
    await expect(bloco.getByText('Porcentagem de êxito (%)')).toBeVisible()
    await expect(bloco.getByText('Valor da ação')).toBeVisible()
    await expect(bloco.getByText('Data de pagamento')).toBeVisible()
    // Modo Valor não está ativo.
    await expect(bloco.getByText('Valor fixo do êxito')).toHaveCount(0)
  })

  test('CA-2/CA-3: clicar "Valor" troca pra MoneyInput "Valor fixo do êxito" e some % + valor da ação', async ({ page }) => {
    await setupCommonMocks(page, {
      id: MOCK_CASO_ID,
      nome: 'Caso Mock',
      produto_id: MOCK_PRODUTO_ID,
      responsavel_id: MOCK_RESPONSAVEL_ID,
      regra_cobranca: 'exito',
      regra_cobranca_config: {},
    })
    await gotoFinanceiro(page)

    const bloco = page.getByTestId('bloco-exito')
    await expect(bloco).toBeVisible()
    await bloco.getByRole('button', { name: 'Valor' }).click()

    await expect(bloco.getByText('Valor fixo do êxito')).toBeVisible()
    await expect(bloco.getByText('Data de pagamento')).toBeVisible()
    // Modo Porcentagem não está mais ativo: % e valor da ação não devem aparecer.
    await expect(bloco.getByText('Porcentagem de êxito (%)')).toHaveCount(0)
    await expect(bloco.getByText('Valor da ação')).toHaveCount(0)
  })

  test('CA-4: caso legado com `percentual_exito` mas sem `exito_modo` hidrata em modo Porcentagem', async ({ page }) => {
    await setupCommonMocks(page, {
      id: MOCK_CASO_ID,
      nome: 'Caso Legado Êxito',
      produto_id: MOCK_PRODUTO_ID,
      responsavel_id: MOCK_RESPONSAVEL_ID,
      regra_cobranca: 'exito',
      regra_cobranca_config: { percentual_exito: '20', valor_acao: '10000' },
    })
    await gotoFinanceiro(page)

    const bloco = page.getByTestId('bloco-exito')
    await expect(bloco).toBeVisible()
    await expect(bloco.getByText('Porcentagem de êxito (%)')).toBeVisible()
    // Valor preenchido na hidratação.
    const percentInput = bloco.locator('input[type="number"]').first()
    await expect(percentInput).toHaveValue('20')
    // Modo Valor não está ativo.
    await expect(bloco.getByText('Valor fixo do êxito')).toHaveCount(0)
  })

  test('CA-5: caso com `exito_modo=valor` + `exito_valor_fixo` carrega no modo Valor', async ({ page }) => {
    await setupCommonMocks(page, {
      id: MOCK_CASO_ID,
      nome: 'Caso Êxito Valor Fixo',
      produto_id: MOCK_PRODUTO_ID,
      responsavel_id: MOCK_RESPONSAVEL_ID,
      regra_cobranca: 'exito',
      regra_cobranca_config: { exito_modo: 'valor', exito_valor_fixo: '5000' },
    })
    await gotoFinanceiro(page)

    const bloco = page.getByTestId('bloco-exito')
    await expect(bloco).toBeVisible()
    await expect(bloco.getByText('Valor fixo do êxito')).toBeVisible()
    // Modo Porcentagem não aparece.
    await expect(bloco.getByText('Porcentagem de êxito (%)')).toHaveCount(0)
    await expect(bloco.getByText('Valor da ação')).toHaveCount(0)
  })
})

test.describe('Item 3 — smoke prod (sem mocks, valida bundle deployado)', () => {
  const PROD_CONTRATO_ID = 'e7606061-d7e3-4e4d-a475-24dccc0cfe9b'

  test.skip(!E2E_EMAIL || !E2E_PASSWORD || !isProdSmoke, 'Smoke prod só roda com E2E_BASE_URL=https://erp-two-phi.vercel.app e credenciais.')

  test('CA-1 deploy: caso-form com regra=Êxito renderiza ChoiceCards Porcentagem/Valor', async ({ page }) => {
    await login(page)
    await page.goto(`/contratos/${PROD_CONTRATO_ID}/casos/novo`)
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: /Regras financeiras/i }).first().click()

    const select = regraSelect(page).first()
    await expect(select).toBeVisible({ timeout: 15_000 })
    await select.selectOption('exito')

    const bloco = page.getByTestId('bloco-exito').first()
    await expect(bloco).toBeVisible({ timeout: 15_000 })
    await expect(bloco.getByRole('button', { name: 'Porcentagem' })).toBeVisible()
    await expect(bloco.getByRole('button', { name: 'Valor' })).toBeVisible()
  })
})
