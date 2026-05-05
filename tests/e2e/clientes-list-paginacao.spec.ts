import { expect, test, type Page, type Route } from '@playwright/test'

/**
 * Fix paginação /pessoas/clientes (Filipe WhatsApp 05/05 15:57 BRT).
 *
 * Causa raiz: edge get-clientes retornava 1000 itens (hard cap) e front filtrava
 * client-side. "Zendur", "Zacarias" e qualquer cliente após "Ó" sumiam da UI.
 *
 * Solução: RPC SECURITY DEFINER list_clientes_paginated com filtro server-side.
 * Frontend chama via supabase.rpc(), bypassando a edge.
 *
 * Dois grupos:
 * 1. Route-mock (CA-1, CA-2): build PROD local (npm run build && PORT=3010 npm start).
 * 2. Smoke prod (CA-3): E2E_BASE_URL=https://erp-two-phi.vercel.app, busca real por "Zendur".
 */

const E2E_EMAIL = process.env.E2E_EMAIL
const E2E_PASSWORD = process.env.E2E_PASSWORD
const E2E_BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000'
const isProdSmoke = E2E_BASE_URL.includes('vercel.app')

function permissionsResponse(extra: string[] = []) {
  return {
    permissions: [
      'crm.clientes.read',
      'crm.clientes.write',
      ...extra,
    ],
  }
}

function rpcClientesPayload(items: Array<{ id: string; nome: string; cnpj?: string | null }>) {
  return {
    data: items.map((c) => ({
      id: c.id,
      nome: c.nome,
      cnpj: c.cnpj ?? null,
      tipo: 'pessoa_juridica',
      cliente_estrangeiro: false,
      grupo_economico_id: null,
      ativo: true,
      created_at: '2026-05-05T12:00:00Z',
    })),
    total: items.length,
    limit: 5000,
    offset: 0,
  }
}

async function setupBaseMocks(page: Page) {
  await page.route('**/functions/v1/get-user-permissions**', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(permissionsResponse()),
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

test.describe('Clientes — paginação via RPC (route-mock)', () => {
  test.skip(
    !E2E_EMAIL || !E2E_PASSWORD || isProdSmoke,
    'Defina E2E_EMAIL/E2E_PASSWORD e baseURL local (npm run build && PORT=3010 npm start) para executar.',
  )

  test.beforeEach(async ({ page }) => {
    await login(page)
    await setupBaseMocks(page)
  })

  test('CA-1: /pessoas/clientes invoca RPC list_clientes_paginated (não a edge get-clientes)', async ({ page }) => {
    let rpcCalled = false
    let edgeCalled = false

    await page.route('**/rest/v1/rpc/list_clientes_paginated', async (route: Route) => {
      rpcCalled = true
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(rpcClientesPayload([
          { id: 'cliente-1', nome: 'Cliente Mock A' },
          { id: 'cliente-2', nome: 'Cliente Mock B' },
        ])),
      })
    })
    await page.route('**/functions/v1/get-clientes**', async (route: Route) => {
      edgeCalled = true
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      })
    })

    await page.goto('/pessoas/clientes')

    // Aguarda lista renderizar (uma das linhas mockadas)
    await expect(page.locator('text=Cliente Mock A')).toBeVisible({ timeout: 15_000 })

    expect(rpcCalled).toBe(true)
    expect(edgeCalled).toBe(false)
  })

  test('CA-2: digitar "Zendur" envia p_search=Zendur na RPC', async ({ page }) => {
    let lastBody: Record<string, unknown> | null = null

    await page.route('**/rest/v1/rpc/list_clientes_paginated', async (route: Route) => {
      try {
        lastBody = JSON.parse(route.request().postData() || '{}') as Record<string, unknown>
      } catch {
        lastBody = {}
      }
      const search = String((lastBody as { p_search?: string | null })?.p_search ?? '')
      const items = search.toLowerCase().includes('zendur')
        ? [{ id: 'zendur-id', nome: 'Zendur Empreendimentos e Participações Ltda' }]
        : [
            { id: 'cliente-a', nome: 'Cliente Mock A' },
            { id: 'cliente-b', nome: 'Cliente Mock B' },
          ]
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(rpcClientesPayload(items)),
      })
    })

    await page.goto('/pessoas/clientes')
    await expect(page.locator('text=Cliente Mock A')).toBeVisible({ timeout: 15_000 })

    await page.getByPlaceholder('Buscar por nome ou CNPJ...').fill('Zendur')
    await expect(page.locator('text=Zendur Empreendimentos')).toBeVisible({ timeout: 10_000 })

    expect(lastBody).not.toBeNull()
    expect((lastBody as { p_search?: string | null })?.p_search).toBe('Zendur')
  })
})

test.describe('Clientes — smoke prod (sem mocks)', () => {
  test.skip(
    !E2E_EMAIL || !E2E_PASSWORD || !isProdSmoke,
    'Smoke prod só roda com E2E_BASE_URL=https://erp-two-phi.vercel.app e credenciais.',
  )

  test('CA-3 deploy: busca por "Zendur" encontra cliente importado em 05/05', async ({ page }) => {
    await login(page)
    await page.goto('/pessoas/clientes')
    await page.waitForLoadState('networkidle')

    // Lista carrega (qualquer cliente visível serve para confirmar render)
    await expect(page.getByPlaceholder('Buscar por nome ou CNPJ...')).toBeVisible({ timeout: 20_000 })

    await page.getByPlaceholder('Buscar por nome ou CNPJ...').fill('Zendur')

    // Aguarda Zendur aparecer (RPC server-side com ILIKE)
    await expect(page.locator('text=Zendur')).toBeVisible({ timeout: 15_000 })
  })
})
