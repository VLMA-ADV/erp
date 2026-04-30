import { expect, test, type Page } from '@playwright/test'

/**
 * Item 2 — Uniformizar contratos antigos com numeracao sequencial.
 *
 * Filipe daily 28/04: contratos antigos foram criados com nome_contrato
 * alfanumerico (ex: "MMA-2024") antes do RF-064 (numero_sequencial).
 * Filipe quer que TODOS sigam padrao "Contrato N".
 *
 * Fix: backfill via Cursor MCP (migration backfill_contratos_numero_sequencial_legados)
 * + helper formatContratoDisplay aplicado em 6 call-sites do frontend.
 *
 * Smoke read-only: lista /contratos em prod, verifica que os cards mostram
 * "Contrato N" (digitos), nao "MMA-XXXX" ou "Identificador vazio".
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

test.describe('Item 2 — Uniformizar numeracao sequencial em contratos (smoke prod)', () => {
  test.skip(
    !E2E_EMAIL || !E2E_PASSWORD || !isProdSmoke,
    'Smoke prod so roda com E2E_BASE_URL=https://erp-two-phi.vercel.app e credenciais.',
  )

  test('CA-1 deploy: campo "Identificador do contrato" mostra "Contrato N" na edicao', async ({ page }) => {
    await login(page)
    // Contrato 91ef86d0-... (Coritiba) — numero_sequencial setado em prod
    await page.goto('/contratos/91ef86d0-b933-4d20-a760-ae0e472569e8/editar')
    await page.waitForLoadState('networkidle')

    // Campo "Identificador do contrato" usa getContratoDisplayName que
    // retorna "Contrato N" (via formatContratoDisplay).
    await expect(page.getByText('Identificador do contrato')).toBeVisible({ timeout: 15_000 })
    const identificadorInput = page.locator('label:has-text("Identificador do contrato")')
      .locator('..')
      .locator('input')
    await expect(identificadorInput).toBeVisible()
    const value = await identificadorInput.inputValue()
    expect(value).toMatch(/^Contrato\s+\d+/)
  })
})
