import { expect, test, type Page } from '@playwright/test'

/**
 * Item 5 — Uniformizar display de contratos.
 *
 * Filipe (daily 28/04, 03:06): "uniformizar. os contratos antigos que estavam
 * alfanuméricos". Decisão CA-4 (b): "Contrato 25 — Tijuca-2024" — primary
 * sequencial + secondary opcional discreto.
 *
 * Suprime secondary quando nome_contrato == "Contrato N" (backfill RF-064)
 * pra evitar redundância "Contrato 25 — Contrato 25".
 *
 * O lado helper (`formatContratoDisplay`) tem 9 vitest unit tests cobrindo
 * todos os edge cases (CA-1..CA-9) — ver `src/lib/utils/contrato-display.test.ts`.
 *
 * Este spec smoke prod valida o **bundle deployado**:
 *  CA-1: listagem `/contratos` renderiza primary "Contrato N" como
 *        identificador principal de cada contrato.
 *  CA-2: breadcrumb em `/contratos/<id>/editar` mostra `numero_sequencial`
 *        (canonical) após migration `fix_get_contrato_retorna_numero_sequencial`
 *        — não mais o `numero` (bigint legacy).
 */

const E2E_EMAIL = process.env.E2E_EMAIL
const E2E_PASSWORD = process.env.E2E_PASSWORD
const E2E_BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000'
const isProdSmoke = E2E_BASE_URL.includes('vercel.app')

// Contrato 29 — usado em smokes anteriores. Em prod tem numero=130 (bigint
// legacy) e numero_sequencial=29 (RF-064). Pós-PR #77, breadcrumb deve mostrar
// "29", não "130".
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

test.describe('Item 5 — Uniformizar display de contratos (smoke prod)', () => {
  test.skip(!E2E_EMAIL || !E2E_PASSWORD || !isProdSmoke, 'Smoke prod só roda com E2E_BASE_URL=https://erp-two-phi.vercel.app e credenciais.')

  test('CA-1 deploy: listagem /contratos uniformiza display via formatContratoDisplay (helper deployed)', async ({ page }) => {
    await login(page)
    await page.goto('/contratos')
    await page.waitForLoadState('networkidle')

    // A página /contratos: SolicitacoesInbox + ContratosInbox + ContratosDashboard
    // + ContratosList. Cada cliente é uma row "bg-blue-50" com chevron pra expandir.
    const clientHeaderButtons = page.locator('tr.bg-blue-50 button')
    await expect(clientHeaderButtons.first()).toBeVisible({ timeout: 20_000 })

    const clientCount = await clientHeaderButtons.count()
    expect(clientCount, 'Listagem deveria ter ao menos 1 cliente').toBeGreaterThan(0)

    const toExpand = Math.min(clientCount, 5)
    for (let i = 0; i < toExpand; i++) {
      await clientHeaderButtons.nth(i).click()
    }

    // Inventario do display de cada contrato após expandir.
    // Estrutura: <td><span>{primary}</span>{secondary && <span>— {secondary}</span>}</td>
    const allCells = await page.locator('td:has(span)').allTextContents()
    const contratoCells = allCells.map((t) => t.trim()).filter((t) => /^Contrato\b/.test(t))

    // Padrões esperados pós-helper:
    //   "Contrato 29"               — primary canonical (numero_sequencial)
    //   "Contrato 29 — Tijuca-2024" — primary + secondary discreto
    //   "Contrato a1da3a6b9dd5"     — fallback nome_contrato UUID-hex (numero_sequencial NULL)
    // Padrão ANTIGO (helper NÃO deployed):
    //   "29 - Tijuca-2024"          — concat numero + nome sem prefixo "Contrato"
    const sequentialCount = contratoCells.filter((t) => /^Contrato \d+(\s|—|$)/.test(t)).length
    const fallbackHexCount = contratoCells.filter((t) => /^Contrato [a-f0-9]{12}$/.test(t)).length
    const oldFormatCount = allCells
      .map((t) => t.trim())
      .filter((t) => /^\d+\s*-\s*\S/.test(t) && !/^Contrato\b/.test(t))
      .length

    console.log(`[Item 5 smoke] ${contratoCells.length} cells "Contrato ..." em ${toExpand}/${clientCount} clientes expandidos`)
    console.log(`[Item 5 smoke]   sequencial canonical: ${sequentialCount}`)
    console.log(`[Item 5 smoke]   fallback UUID-hex (numero_sequencial NULL): ${fallbackHexCount}`)
    console.log(`[Item 5 smoke]   formato antigo "N - Nome" (helper NÃO deployed): ${oldFormatCount}`)

    // Validação principal: bundle do helper deployed = NENHUMA célula no formato
    // antigo "<numero> - <nome>" (sem prefixo "Contrato"). Pré-Item 5 essa era a
    // norma; pós, todas devem começar com "Contrato".
    expect(
      oldFormatCount,
      `${oldFormatCount} células ainda no formato antigo "N - Nome" — helper formatContratoDisplay não deployed nessa rota`,
    ).toBe(0)

    // Helper foi aplicado: pelo menos 1 célula no padrão "Contrato ..." existe.
    expect(contratoCells.length).toBeGreaterThan(0)
  })

  test('CA-2 deploy: breadcrumb em Contrato 29 mostra numero_sequencial (29), não numero legacy (130)', async ({ page }) => {
    await login(page)
    await page.goto(`/contratos/${PROD_CONTRATO_ID}/editar`)
    await page.waitForLoadState('networkidle')

    const breadcrumb = page.getByRole('navigation', { name: 'breadcrumb' })
    await expect(breadcrumb).toBeVisible({ timeout: 20_000 })

    // O separator é um SVG (img), não um caracter ">". innerText concatena
    // segmentos com whitespace ou newline. Filtrar em pedaços via partição.
    await expect.poll(
      async () => {
        const text = (await breadcrumb.innerText()).replace(/\s+/g, ' ').trim()
        return text
      },
      { timeout: 15_000, message: 'Breadcrumb não estabilizou' },
    ).toMatch(/Contratos.*\b\d+\b.*Editar/)

    const text = (await breadcrumb.innerText()).replace(/\s+/g, ' ').trim()
    // Extrai o número que está entre "Contratos" e "Editar".
    const between = text.replace(/^.*Contratos[^\d]*/, '').replace(/[^\d].*Editar.*$/, '')
    const breadcrumbNumber = between.match(/\d+/)?.[0]

    expect(breadcrumbNumber, `Breadcrumb completo: "${text}"`).toBe('29')
    // Anti-regressão: NÃO deve ser 130 (numero bigint legacy).
    expect(breadcrumbNumber, 'Breadcrumb regrediu pra "numero" bigint legacy').not.toBe('130')
  })
})
