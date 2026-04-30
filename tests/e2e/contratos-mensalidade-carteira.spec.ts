import { expect, test, type Page } from '@playwright/test'

/**
 * Mensalidade de Carteira (daily Filipe 28/04/2026).
 *
 * Dois grupos:
 *
 * 1. Route-mock (CA-1..CA-4): roda contra build PROD local
 *    (`npm run build && PORT=3010 npm start`). NÃO usar `npm run dev` —
 *    `reactStrictMode` em dev duplica `useEffect` e o hook `usePermissions`
 *    aborta antes de popular permissions, deixando caso-form em read-only.
 *    Memory `feedback_strictmode_dev_caso_form.md`.
 *
 * 2. Smoke prod (CA-5 deploy): roda com `E2E_BASE_URL=https://erp-two-phi.vercel
 *    .app` e credenciais reais do Filipe. Pega bundle quebrado / env var faltando.
 */

const E2E_EMAIL = process.env.E2E_EMAIL
const E2E_PASSWORD = process.env.E2E_PASSWORD
const E2E_BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000'
const isProdSmoke = E2E_BASE_URL.includes('vercel.app')

const MOCK_CONTRATO_ID = '11111111-2222-3333-4444-555555555555'
const MOCK_CASO_ID = '99999999-8888-7777-6666-555555555555'
const MOCK_MATRIZ_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
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
  parte_de_carteira_id?: string | null
  processos_carteira_count?: number
  observacao?: string | null
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
          observacao: caso.observacao ?? '',
          polo: null,
          parte_de_carteira_id: caso.parte_de_carteira_id ?? null,
          processos_carteira_count: caso.processos_carteira_count ?? 0,
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
  await page.route('**/functions/v1/get-salario-minimo**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ valor: 1500, vigencia_desde: '2026-01-01' }),
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

test.describe('Mensalidade de Carteira (route-mock)', () => {
  test.skip(
    !E2E_EMAIL || !E2E_PASSWORD || isProdSmoke,
    'Defina E2E_EMAIL e E2E_PASSWORD (e baseURL local em modo PROD: npm run build && PORT=3010 npm start) para executar.',
  )

  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('CA-1: select tem opção "Mensalidade de Carteira" + bloco aparece ao selecionar', async ({ page }) => {
    await setupCommonMocks(page, {
      id: MOCK_CASO_ID,
      nome: 'Caso Mock',
      produto_id: MOCK_PRODUTO_ID,
      responsavel_id: MOCK_RESPONSAVEL_ID,
      regra_cobranca: 'mensal',
      regra_cobranca_config: { valor_mensal: '1000' },
    })
    await gotoFinanceiro(page)

    const select = regraSelect(page)
    await expect(select).toBeVisible()
    const optionTexts = await select.locator('option').allInnerTexts()
    expect(optionTexts).toContain('Mensalidade de Carteira')

    await select.selectOption('mensalidade_carteira')

    const bloco = page.getByTestId('bloco-mensalidade-carteira')
    await expect(bloco).toBeVisible()
    await expect(bloco.getByText('Configuração de mensalidade de carteira')).toBeVisible()
    await expect(bloco.getByText('Carteira de processos (CSV)')).toBeVisible()
    await expect(bloco.getByText('Valor mensal da carteira')).toBeVisible()
  })

  test('CA-2: upload de CSV com 3 válidas + 1 inválida mostra preview e contador', async ({ page }) => {
    await setupCommonMocks(page, {
      id: MOCK_CASO_ID,
      nome: 'Caso Mock',
      produto_id: MOCK_PRODUTO_ID,
      responsavel_id: MOCK_RESPONSAVEL_ID,
      regra_cobranca: 'mensalidade_carteira',
      regra_cobranca_config: {},
    })
    await gotoFinanceiro(page)

    const bloco = page.getByTestId('bloco-mensalidade-carteira')
    await expect(bloco).toBeVisible()

    const csvContent = [
      'numero_processo;identificador',
      '0001234-56.2024.8.26.0100;João da Silva',
      '0007890-12.2024.8.26.0100;Maria Souza',
      '0003344-77.2024.8.26.0100;Empresa XYZ',
      '0009999-99.2024.8.26.0100;',
    ].join('\n')

    await bloco.locator('input[type="file"]').setInputFiles({
      name: 'carteira.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csvContent, 'utf-8'),
    })

    const preview = page.getByTestId('preview-carteira')
    await expect(preview).toBeVisible()
    await expect(preview.getByText(/3 processo\(s\) válido\(s\), 1 ignorado\(s\)/)).toBeVisible()
    await expect(preview.getByText('João da Silva')).toBeVisible()
    await expect(preview.getByText('Maria Souza')).toBeVisible()
    await expect(preview.getByText('Empresa XYZ')).toBeVisible()
  })

  test('CA-3: caso filho (parte_de_carteira_id setado) renderiza aviso âmbar e bloqueia upload', async ({ page }) => {
    await setupCommonMocks(page, {
      id: MOCK_CASO_ID,
      nome: 'Processo da carteira',
      produto_id: MOCK_PRODUTO_ID,
      responsavel_id: MOCK_RESPONSAVEL_ID,
      regra_cobranca: 'mensalidade_carteira',
      regra_cobranca_config: { numero_processo: '0001234-56', identificador: 'João' },
      parte_de_carteira_id: MOCK_MATRIZ_ID,
    })
    await gotoFinanceiro(page)

    const bloco = page.getByTestId('bloco-mensalidade-carteira')
    await expect(bloco).toBeVisible()
    await expect(
      bloco.getByText(/Este caso é um processo de uma carteira/i),
    ).toBeVisible()
    await expect(bloco.locator('input[type="file"]')).toHaveCount(0)
  })

  test('CA-4: limpar carteira remove preview e zera contador', async ({ page }) => {
    await setupCommonMocks(page, {
      id: MOCK_CASO_ID,
      nome: 'Caso Mock',
      produto_id: MOCK_PRODUTO_ID,
      responsavel_id: MOCK_RESPONSAVEL_ID,
      regra_cobranca: 'mensalidade_carteira',
      regra_cobranca_config: {},
    })
    await gotoFinanceiro(page)

    const bloco = page.getByTestId('bloco-mensalidade-carteira')
    const csvContent = ['numero_processo,identificador', '0001-01,A', '0002-02,B'].join('\n')
    await bloco.locator('input[type="file"]').setInputFiles({
      name: 'carteira.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csvContent, 'utf-8'),
    })

    const preview = page.getByTestId('preview-carteira')
    await expect(preview).toBeVisible()
    await expect(preview.getByText('A')).toBeVisible()

    await preview.getByRole('button', { name: 'Limpar' }).click()
    await expect(page.getByTestId('preview-carteira')).toHaveCount(0)
  })
})

test.describe('Mensalidade de Carteira — smoke prod (sem mocks, valida bundle deployado)', () => {
  const PROD_CONTRATO_ID = 'e7606061-d7e3-4e4d-a475-24dccc0cfe9b'

  test.skip(
    !E2E_EMAIL || !E2E_PASSWORD || !isProdSmoke,
    'Smoke prod só roda com E2E_BASE_URL=https://erp-two-phi.vercel.app e credenciais.',
  )

  test('CA-5 deploy: select tem "Mensalidade de Carteira" pós-deploy', async ({ page }) => {
    await login(page)
    await page.goto(`/contratos/${PROD_CONTRATO_ID}/casos/novo`)
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: /Regras financeiras/i }).first().click()

    const select = regraSelect(page).first()
    await expect(select).toBeVisible({ timeout: 15_000 })
    const optionTexts = await select.locator('option').allInnerTexts()
    expect(optionTexts).toContain('Mensalidade de Carteira')
    expect(optionTexts.filter((t) => t.trim() !== '').length).toBe(7)
  })
})
