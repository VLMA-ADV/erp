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
 * Edge `update-contrato` tinha workaround direto na tabela, mas
 * `create-contrato` não — e `get_contrato` não retornava no jsonb.
 *
 * Fix em DB (Cursor MCP): migration `add_responsavel_prospeccao_e_canal_em_
 * contratos` aplicada no DEV. Smoke SQL verde.
 *
 * Smoke prod aqui valida persistência end-to-end via UI: selecionar
 * responsável + canal, salvar, recarregar, confirmar que valores ficaram.
 *
 * IMPORTANTE: rodar contra build prod (Vercel deploy) ou local em modo
 * PRODUÇÃO (`npm run build && PORT=3010 npm start`). NÃO usar `npm run
 * dev` — `reactStrictMode` em dev duplica `useEffect` e trava
 * `usePermissions` (memory `feedback_strictmode_dev_caso_form`).
 */

const E2E_EMAIL = process.env.E2E_EMAIL
const E2E_PASSWORD = process.env.E2E_PASSWORD
const E2E_BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000'
const isProdSmoke = E2E_BASE_URL.includes('vercel.app')

// Contrato 29 — sugerido por Eduardo, tem forma_entrada=prospeccao
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

test.describe('Item 1 — Responsável da prospecção persiste (smoke prod)', () => {
  test.skip(!E2E_EMAIL || !E2E_PASSWORD || !isProdSmoke, 'Smoke prod só roda com E2E_BASE_URL=https://erp-two-phi.vercel.app e credenciais.')

  test('CA-1 deploy: editar Contrato 29 → trocar Responsável da prospecção → salvar → recarregar → valor persiste', async ({ page }) => {
    await login(page)
    await page.goto(`/contratos/${PROD_CONTRATO_ID}/editar`)
    await page.waitForLoadState('networkidle')

    // O campo Responsável da prospecção só aparece se forma_entrada=prospeccao.
    // Se Contrato 29 estiver com 'organico', o teste deve falhar com mensagem clara.
    const respLabel = page.getByText('Responsável da prospecção').first()
    await expect(respLabel, 'Contrato 29 deveria estar com forma_entrada=prospeccao').toBeVisible({ timeout: 15_000 })

    // Capturar valor atual (se houver) para validar round-trip.
    const respSelect = page.locator('label:has-text("Responsável da prospecção")').locator('..').locator('select, [role="combobox"]').first()
    const initialValue = await respSelect.inputValue().catch(() => '')

    // Pegar opções disponíveis (CommandSelect ou NativeSelect — dependendo do build).
    const options = await respSelect.locator('option').allInnerTexts().catch(() => [] as string[])
    const candidates = options.filter((o) => o.trim() && !/Selecione/i.test(o))
    expect(candidates.length, 'precisa ter ao menos 2 colaboradores pra trocar valor').toBeGreaterThanOrEqual(2)

    // Escolher uma opção diferente da atual (ou a primeira disponível).
    const next = candidates.find((o) => o !== initialValue) || candidates[0]
    // CommandSelect renderiza <button> não <select>; cobrir os 2 caminhos.
    if ((await respSelect.evaluate((el) => el.tagName.toLowerCase()).catch(() => '')) === 'select') {
      await respSelect.selectOption({ label: next })
    } else {
      await respSelect.click()
      await page.getByRole('option', { name: next }).click()
    }

    // Salvar (pode ser "Salvar contrato" ou "Atualizar"; pegar o botão primário do form).
    await page.getByRole('button', { name: /Salvar|Atualizar/i }).first().click()

    // Aguardar feedback de sucesso (toast ou redirect).
    await page.waitForLoadState('networkidle')

    // Hard reload para ler do DB.
    await page.goto(`/contratos/${PROD_CONTRATO_ID}/editar`)
    await page.waitForLoadState('networkidle')

    // Reler o select e confirmar que o valor selecionado é `next`.
    const respSelectAfter = page.locator('label:has-text("Responsável da prospecção")').locator('..').locator('select, [role="combobox"]').first()
    await expect(respSelectAfter).toBeVisible({ timeout: 15_000 })
    const finalValue = await respSelectAfter.inputValue().catch(async () => {
      // CommandSelect: ler texto do botão.
      return (await respSelectAfter.innerText()).trim()
    })
    expect(finalValue, 'responsavel_prospeccao_id não persistiu após reload').toContain(next.split(' ')[0]) // matchSubstring tolerante a "Nome (cargo)"
  })

  test('CA-2 deploy: campo "Canal de prospecção" persiste após salvar e recarregar', async ({ page }) => {
    await login(page)
    await page.goto(`/contratos/${PROD_CONTRATO_ID}/editar`)
    await page.waitForLoadState('networkidle')

    const canalInput = page.getByLabel('Canal de prospecção')
    await expect(canalInput, 'Contrato 29 deveria mostrar campo de canal').toBeVisible({ timeout: 15_000 })

    const stamp = `Smoke ${Date.now() % 100000}`
    await canalInput.fill(stamp)

    await page.getByRole('button', { name: /Salvar|Atualizar/i }).first().click()
    await page.waitForLoadState('networkidle')

    await page.goto(`/contratos/${PROD_CONTRATO_ID}/editar`)
    await page.waitForLoadState('networkidle')

    const canalAfter = page.getByLabel('Canal de prospecção')
    await expect(canalAfter).toHaveValue(stamp)
  })
})
