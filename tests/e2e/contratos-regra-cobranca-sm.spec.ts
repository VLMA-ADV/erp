import { expect, test, type Page } from '@playwright/test'

/**
 * Bug A — Salário Mínimo como sub-modo de Mensalidade de processo.
 *
 * Dois grupos de testes:
 *
 * 1. Route-mock (CA-1..CA-6): roda com `E2E_EMAIL` e `E2E_PASSWORD` setados e
 *    `E2E_BASE_URL` apontando pra um servidor local em modo PRODUÇÃO (`npm run
 *    build && PORT=3010 npm start`). NÃO usar `npm run dev` — `reactStrictMode`
 *    em dev duplica `useEffect` e o hook `usePermissions` (src/lib/hooks/use-
 *    permissions.ts) acaba abortando antes de popular `permissions`, deixando
 *    o caso-form em modo read-only (canWrite=false). Em build prod isso não
 *    acontece.
 *
 * 2. Smoke prod (CA-1 deploy): roda com `E2E_BASE_URL=https://erp-two-phi.vercel
 *    .app` e credenciais reais do Filipe. Cobre o cenário end-to-end pós-deploy
 *    contra um contrato Coritiba real. Frágil proposital — pega bundle
 *    quebrado / env var faltando. Não cobre lógica de hidratação compat.
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
  await page.route('**/functions/v1/get-salario-minimo**', async (route) => {
    // fetchSalarioMinimoAtual retorna o body cru — sem envelope `data`.
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
  // <Label> sem htmlFor + <NativeSelect> (=> <select>); CSS sibling encontra o select
  // adjacente ao label com o texto "Regra de cobrança".
  return page.locator('label:has-text("Regra de cobrança") + select')
}

test.describe('Bug A — Regra de cobrança: Salário Mínimo como sub-modo de Mensalidade de processo (route-mock)', () => {
  test.skip(!E2E_EMAIL || !E2E_PASSWORD || isProdSmoke, 'Defina E2E_EMAIL e E2E_PASSWORD (e baseURL local em modo PROD: npm run build && PORT=3010 npm start) para executar.')

  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('CA-1: select tem 5 opções, sem "Salário Mínimo" solto', async ({ page }) => {
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
    expect(optionTexts.filter((t) => t.trim() !== '')).toEqual([
      'Selecione...',
      'Hora',
      'Mensal',
      'Mensalidade de processo',
      'Projeto',
      'Êxito',
    ])
    expect(optionTexts.some((t) => /Salário Mínimo/i.test(t))).toBeFalsy()
  })

  test('CA-2/CA-3: selecionar "Mensalidade de processo" abre ChoiceCards Valor/SM (default Valor)', async ({ page }) => {
    await setupCommonMocks(page, {
      id: MOCK_CASO_ID,
      nome: 'Caso Mock',
      produto_id: MOCK_PRODUTO_ID,
      responsavel_id: MOCK_RESPONSAVEL_ID,
      regra_cobranca: 'mensal',
      regra_cobranca_config: { valor_mensal: '1000' },
    })
    await gotoFinanceiro(page)

    await regraSelect(page).selectOption('mensalidade_processo')

    const bloco = page.getByTestId('bloco-mensalidade-processo')
    await expect(bloco).toBeVisible()
    await expect(bloco.getByText('Configuração de mensalidade de processo')).toBeVisible()
    await expect(bloco.getByRole('button', { name: 'Valor' })).toBeVisible()
    await expect(bloco.getByRole('button', { name: 'Salário Mínimo' })).toBeVisible()
    await expect(bloco.getByText('Valor mensal do projeto')).toBeVisible()
  })

  test('CA-4: clicar ChoiceCard "Salário Mínimo" abre input quantidade + cartão de cálculo dinâmico', async ({ page }) => {
    await setupCommonMocks(page, {
      id: MOCK_CASO_ID,
      nome: 'Caso Mock',
      produto_id: MOCK_PRODUTO_ID,
      responsavel_id: MOCK_RESPONSAVEL_ID,
      regra_cobranca: 'mensalidade_processo',
      regra_cobranca_config: { valor_mensal: '1000' },
    })
    await gotoFinanceiro(page)

    const bloco = page.getByTestId('bloco-mensalidade-processo')
    await expect(bloco).toBeVisible()
    await bloco.getByRole('button', { name: 'Salário Mínimo' }).click()

    await expect(bloco.getByText('Quantidade de SM', { exact: true })).toBeVisible()
    const qtyInput = bloco.getByPlaceholder('Ex: 2,5')
    await qtyInput.fill('2.5')
    await expect(bloco.getByText(/2,5\s*SM\s*×\s*R\$\s*1\.500,00\s*=\s*R\$\s*3\.750,00/)).toBeVisible()
  })

  test('CA-5/CA-6: caso legado salario_minimo hidrata como Mensalidade de processo + modo SM', async ({ page }) => {
    await setupCommonMocks(page, {
      id: MOCK_CASO_ID,
      nome: 'Caso Legado SM',
      produto_id: MOCK_PRODUTO_ID,
      responsavel_id: MOCK_RESPONSAVEL_ID,
      regra_cobranca: 'salario_minimo',
      regra_cobranca_config: { quantidade_sm: 3 },
    })
    await gotoFinanceiro(page)

    const select = regraSelect(page)
    await expect(select).toHaveValue('mensalidade_processo')

    const bloco = page.getByTestId('bloco-mensalidade-processo')
    await expect(bloco).toBeVisible()
    // Estado "SM selected": o input de quantidade aparece + cartão de cálculo dinâmico mostra o cálculo correto.
    // (ChoiceCards é um <button> simples sem aria-pressed; o estado se verifica pelo bloco renderizado.)
    await expect(bloco.getByText('Quantidade de SM', { exact: true })).toBeVisible()
    await expect(bloco.getByText('Valor mensal do projeto')).toHaveCount(0)
    await expect(bloco.getByPlaceholder('Ex: 2,5')).toHaveValue('3')
    await expect(bloco.getByText(/3\s*SM\s*×\s*R\$\s*1\.500,00\s*=\s*R\$\s*4\.500,00/)).toBeVisible()
  })
})

test.describe('Bug A — smoke prod (sem mocks, valida bundle deployado)', () => {
  const PROD_CONTRATO_ID = 'e7606061-d7e3-4e4d-a475-24dccc0cfe9b'

  test.skip(!E2E_EMAIL || !E2E_PASSWORD || !isProdSmoke, 'Smoke prod só roda com E2E_BASE_URL=https://erp-two-phi.vercel.app e credenciais.')

  test('CA-1 deploy: select de regra de cobrança tem "Mensalidade de processo" e NÃO tem "Salário Mínimo" solto', async ({ page }) => {
    await login(page)
    await page.goto(`/contratos/${PROD_CONTRATO_ID}/editar`)
    await page.waitForLoadState('networkidle')

    // Avançar até o caso (contrato-form Etapa 2 → caso → Regras financeiras).
    // Depende do estado do contrato; se o spec falhar aqui, o smoke já indica
    // que o deploy levantou mas a UI não chega na tela esperada (sinal frágil
    // proposital: pega bundle quebrado, não cobre lógica).
    await page.getByRole('button', { name: /Regras financeiras/i }).first().click({ trial: true }).catch(() => undefined)

    const select = regraSelect(page).first()
    await expect(select).toBeVisible({ timeout: 15_000 })
    const optionTexts = await select.locator('option').allInnerTexts()
    expect(optionTexts).toContain('Mensalidade de processo')
    expect(optionTexts.some((t) => /Salário Mínimo/i.test(t))).toBeFalsy()
    expect(optionTexts.filter((t) => t.trim() !== '').length).toBe(6)
  })
})
