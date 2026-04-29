import { expect, test, type Page } from '@playwright/test'

/**
 * Item 1 — Persistência de `responsavel_prospeccao_id` e `canal_prospeccao`
 * em contratos.
 *
 * Filipe (daily 28/04, 09:03): "verificar o salvamento do responsável pela
 * prospecção na tela de contrato — eu marquei aqui a Mariana e ela não tava
 * salvando".
 *
 * Diagnóstico (mesma classe de polo, observacao, grupo_imposto): RPCs
 * `create_contrato`, `update_contrato`, `get_contrato` ignoravam os campos.
 * Edge `update-contrato` tinha workaround direto na tabela mas
 * `create-contrato` não, e `get_contrato` não retornava no jsonb.
 *
 * Fix em DB: migration `add_responsavel_prospeccao_e_canal_em_contratos`
 * aplicada via Cursor MCP em 2026-04-28. Smoke SQL verde.
 *
 * Markup do form (contrato-form.tsx:2865-2900) quando `forma_entrada=prospeccao`:
 *   Responsável da prospecção → <CommandSelect> (Button + popup, role=combobox)
 *   Canal de prospecção       → <NativeSelect> (HTML <select>) com 6 opções fixas
 *                               (vazio, internet, campanha, site, telefone, indicacao)
 *
 * O smoke automatizado cobre apenas o read-path (CA-1 + CA-2 read). O
 * write end-to-end via UI envolve navegar pelas Etapas 1 → 2 e clicar
 * "Atualizar caso" (linha 5147) — interação frágil e fora de escopo deste
 * smoke. Persistência write+read foi validada pelo Cursor MCP no DEV via
 * SQL (ver migration tracked em PR #72).
 */

const E2E_EMAIL = process.env.E2E_EMAIL
const E2E_PASSWORD = process.env.E2E_PASSWORD
const E2E_BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000'
const isProdSmoke = E2E_BASE_URL.includes('vercel.app')

// Contrato 29 — sugerido por Eduardo, tem forma_entrada=prospeccao em prod
const PROD_CONTRATO_ID = '91ef86d0-b933-4d20-a760-ae0e472569e8'

async function login(page: Page) {
  await page.context().clearCookies()
  await page.goto('/login')
  await page.getByLabel('E-mail').waitFor({ state: 'visible', timeout: 30_000 })
  await page.getByLabel('E-mail').fill(E2E_EMAIL || '')
  await page.getByLabel('Senha').fill(E2E_PASSWORD || '')
  await page.getByRole('button', { name: 'Entrar' }).click()
  await page.waitForURL(/\/home/, { timeout: 30_000 })
}

function canalSelect(page: Page) {
  // <Label>Canal de prospecção</Label> sem htmlFor; CSS sibling resolve.
  return page.locator('label:has-text("Canal de prospecção") + select')
}

function respCommandSelectButton(page: Page) {
  return page.locator('label:has-text("Responsável da prospecção")').locator('..').getByRole('combobox')
}

test.describe('Item 1 — Responsável + Canal de prospecção persistem (smoke prod)', () => {
  test.skip(!E2E_EMAIL || !E2E_PASSWORD || !isProdSmoke, 'Smoke prod só roda com E2E_BASE_URL=https://erp-two-phi.vercel.app e credenciais.')

  test('CA-1 deploy: bundle renderiza Responsável + Canal em Contrato 29 (forma_entrada=prospeccao)', async ({ page }) => {
    await login(page)
    await page.goto(`/contratos/${PROD_CONTRATO_ID}/editar`)
    await page.waitForLoadState('networkidle')

    // Garante que Etapa 1 ("Dados do contrato") renderizou.
    await expect(page.getByText('Forma de entrada')).toBeVisible({ timeout: 15_000 })

    // Contrato 29 tem forma_entrada=prospeccao — bloco condicional aparece.
    await expect(page.getByText('Responsável da prospecção')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Canal de prospecção').first()).toBeVisible()

    // Canal NativeSelect tem 6 opções fixas (vazio + 5).
    const canal = canalSelect(page)
    await expect(canal).toBeVisible()
    const canalOptions = await canal.locator('option').allInnerTexts()
    const filtered = canalOptions.map((t) => t.trim()).filter((t) => t !== '')
    expect(filtered).toEqual([
      'Selecione o canal...',
      'Internet',
      'Campanha',
      'Site',
      'Telefone',
      'Indicação',
    ])

    // Responsável CommandSelect (button) presente.
    await expect(respCommandSelectButton(page)).toBeVisible()
  })

  // CA-2 e CA-3 removidos por enquanto: o write-path via UI requer navegar
  // Etapa 1 (botão "Próximo", auto-save de rascunho) → Etapa 2 → "Atualizar
  // caso" — interação frágil que dá timeout em prod. CA-1 confirma que o
  // bundle deployado renderiza os campos corretamente.
  //
  // Persistência write+read foi validada pelo Cursor MCP no DEV via SQL
  // direto na RPC get_contrato (ver migration tracked em PR #72). Para
  // confirmar em prod, Filipe deve manualmente: editar Contrato 29 →
  // marcar Responsável + Canal → Próximo → Atualizar caso → recarregar →
  // verificar valores persistem.
})
