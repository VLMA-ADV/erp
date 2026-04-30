import { expect, test, type Page } from '@playwright/test'

/**
 * Item 4 — Ativar/desativar colaborador.
 *
 * Filipe daily 28/04: queria conseguir ativar/desativar colaboradores. A
 * funcionalidade ja existia (botao Power em ColaboradoresActions, gated por
 * permission `people.colaboradores.write`), mas Filipe esta no role
 * `advogado` e a permission so estava atribuida a `socio`/`administrativo`.
 *
 * Fix: INSERT em core.role_permissions atribuindo `people.colaboradores.write`
 * ao role `advogado` via Cursor MCP (idempotente NOT EXISTS guard).
 *
 * Smoke read-only: login Filipe -> /pessoas/colaboradores -> confirma
 * coluna "Acoes" com botao toggle (Power icon) visivel em pelo menos 1 row.
 */

const E2E_EMAIL = process.env.E2E_EMAIL
const E2E_PASSWORD = process.env.E2E_PASSWORD
const E2E_BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000'
const isProdSmoke = E2E_BASE_URL.includes('vercel.app')

async function login(page: Page) {
  await page.context().clearCookies()
  await page.goto('/login')
  await page.getByLabel('E-mail').waitFor({ state: 'visible', timeout: 30_000 })
  await page.getByLabel('E-mail').fill(E2E_EMAIL || '')
  await page.getByLabel('Senha').fill(E2E_PASSWORD || '')
  await page.getByRole('button', { name: 'Entrar' }).click()
  await page.waitForURL(/\/home/, { timeout: 30_000 })
}

test.describe('Item 4 — Ativar/desativar colaborador (smoke prod)', () => {
  test.skip(
    !E2E_EMAIL || !E2E_PASSWORD || !isProdSmoke,
    'Smoke prod so roda com E2E_BASE_URL=https://erp-two-phi.vercel.app e credenciais.',
  )

  test('CA-1 deploy: Filipe (advogado) ve botao Ativar/Desativar na lista', async ({ page }) => {
    await login(page)
    await page.goto('/pessoas/colaboradores')
    await page.waitForLoadState('networkidle')

    // Coluna "Acoes" so aparece se canEdit (people.colaboradores.write) for true
    await expect(page.getByRole('columnheader', { name: 'Ações' })).toBeVisible({
      timeout: 15_000,
    })

    // Pelo menos 1 row deve ter o botao toggle (renderiza Power icon dentro
    // de Tooltip com content "Desativar" se ativo, "Ativar" se inativo).
    // Sem clicar — apenas confirma presenca, evitando mutacao em prod.
    const toggleButtons = page.locator('button:has(svg.lucide-power)')
    await expect(toggleButtons.first()).toBeVisible({ timeout: 10_000 })
    const count = await toggleButtons.count()
    expect(count).toBeGreaterThan(0)
  })
})
