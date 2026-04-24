import { expect, test } from '@playwright/test'

const E2E_EMAIL = process.env.E2E_EMAIL
const E2E_PASSWORD = process.env.E2E_PASSWORD

test.describe('Faturamento - Itens, Revisão e Permissões', () => {
  test.skip(!E2E_EMAIL || !E2E_PASSWORD, 'Defina E2E_EMAIL e E2E_PASSWORD para executar os cenários.')

  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('E-mail').fill(E2E_EMAIL || '')
    await page.getByLabel('Senha').fill(E2E_PASSWORD || '')
    await page.getByRole('button', { name: 'Entrar' }).click()
    await page.waitForURL(/\/home/)
  })

  test('itens a faturar: abas por regra + envio em massa de múltiplos casos', async ({ page }) => {
    const getItensResponse = [
      {
        cliente_id: 'cli-1',
        cliente_nome: 'Cliente A',
        total_horas: '10',
        total_valor: '900',
        total_itens: 3,
        contratos: [
          {
            contrato_id: 'ctr-1',
            contrato_numero: 100,
            contrato_nome: 'Contrato A',
            total_horas: '10',
            total_valor: '900',
            total_itens: 3,
            casos: [
              {
                caso_id: 'caso-1',
                caso_numero: 1,
                caso_nome: 'Caso A',
                total_horas: '8',
                total_valor: '650',
                total_itens: 2,
                extrato: [
                  {
                    tipo: 'timesheet',
                    descricao: 'Timesheet',
                    data_referencia: '2026-03-01',
                    horas: '8',
                    valor: '400',
                  },
                  {
                    tipo: 'mensalidade_processo',
                    descricao: 'Mensalidade de processo',
                    data_referencia: '2026-03-01',
                    horas: '0',
                    valor: '250',
                  },
                ],
              },
              {
                caso_id: 'caso-2',
                caso_numero: 2,
                caso_nome: 'Caso B',
                total_horas: '2',
                total_valor: '250',
                total_itens: 1,
                extrato: [
                  {
                    tipo: 'projeto',
                    descricao: 'Projeto',
                    data_referencia: '2026-03-01',
                    horas: '2',
                    valor: '250',
                  },
                ],
              },
            ],
          },
        ],
      },
    ]

    await page.route('**/functions/v1/get-itens-a-faturar**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: getItensResponse }),
      })
    })

    let capturedPayload: Record<string, unknown> | null = null
    await page.route('**/functions/v1/start-faturamento', async (route) => {
      capturedPayload = JSON.parse(route.request().postData() || '{}') as Record<string, unknown>
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { itens_criados: 3 } }),
      })
    })

    await page.goto('/financeiro/itens-a-faturar')
    await page.getByRole('tab', { name: 'Mensalidade de processo' }).click()
    await expect(page.getByText('Mensalidade de processo')).toBeVisible()

    await page.getByRole('tab', { name: 'Todas' }).click()
    await page.getByRole('button', { name: 'Cliente A' }).click()
    await page.getByRole('button', { name: '100 - Contrato A' }).click()

    const caseCheckboxes = page.locator('tbody tr td input[type="checkbox"]')
    await caseCheckboxes.nth(2).check()
    await caseCheckboxes.nth(3).check()

    await page.getByRole('button', { name: /Enviar selecionados \(2\)/ }).click()

    expect(capturedPayload).not.toBeNull()
    expect(capturedPayload?.alvo_tipo).toBe('caso')
    expect(Array.isArray(capturedPayload?.alvo_ids)).toBeTruthy()
    expect((capturedPayload?.alvo_ids as unknown[])?.length).toBe(2)
  })

  test('revisão: exibe status/responsável e bloqueia configuração de revisores sem permissão manage', async ({ page }) => {
    await page.route('**/functions/v1/get-user-permissions**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          permissions: ['finance.faturamento.read', 'finance.faturamento.review'],
        }),
      })
    })

    await page.route('**/functions/v1/list-colaboradores**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            { id: 'col-1', nome: 'Filipe', categoria: 'Sócio' },
            { id: 'col-2', nome: 'Bruna Menegale Bogucheski', categoria: 'Sócio' },
          ],
        }),
      })
    })

    await page.route('**/functions/v1/get-contratos**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: 'ctr-1',
              numero: 10,
              nome_contrato: 'Contrato A',
              casos: [
                {
                  id: 'caso-1',
                  numero: 1,
                  nome: 'Caso A',
                  timesheet_config: {
                    revisores: [{ colaborador_id: 'col-1', ordem: 1 }],
                    aprovadores: [{ colaborador_id: 'col-2', ordem: 1 }],
                  },
                },
              ],
            },
          ],
        }),
      })
    })

    await page.route('**/functions/v1/get-revisao-fatura**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              billing_item_id: 'bi-1',
              contrato_id: 'ctr-1',
              caso_id: 'caso-1',
              status: 'em_revisao',
              origem_tipo: 'timesheet',
              data_referencia: '2026-03-01',
              cliente_nome: 'Cliente A',
              contrato_nome: 'Contrato A',
              contrato_numero: 10,
              caso_nome: 'Caso A',
              caso_numero: 1,
              regra_nome: 'Timesheet',
              horas_informadas: 2,
              valor_informado: 300,
              responsavel_revisao_nome: 'Filipe',
              timesheet_data_lancamento: '2026-03-01',
              timesheet_horas: 2,
              timesheet_descricao: 'Atividade',
              timesheet_profissional: 'Filipe',
              timesheet_valor_hora: 150,
              snapshot: {},
            },
          ],
        }),
      })
    })

    await page.goto('/financeiro/revisao-de-fatura')

    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Responsável atual' })).toBeVisible()
    await expect(page.getByText('Filipe')).toBeVisible()

    await expect(page.locator('button:has(svg.lucide-settings-2)')).toHaveCount(0)
  })

  test('revisão: item aprovado não permite avançar nem editar fluxo', async ({ page }) => {
    await page.route('**/functions/v1/get-user-permissions**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          permissions: ['finance.faturamento.manage', 'finance.faturamento.approve'],
        }),
      })
    })

    await page.route('**/functions/v1/list-colaboradores**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [{ id: 'col-1', nome: 'Filipe', categoria: 'Sócio' }] }),
      })
    })

    await page.route('**/functions/v1/get-contratos**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      })
    })

    await page.route('**/functions/v1/get-revisao-fatura**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              billing_item_id: 'bi-2',
              contrato_id: 'ctr-2',
              caso_id: 'caso-2',
              status: 'aprovado',
              origem_tipo: 'regra_financeira',
              data_referencia: '2026-03-01',
              cliente_nome: 'Cliente B',
              contrato_nome: 'Contrato B',
              contrato_numero: 11,
              caso_nome: 'Caso B',
              caso_numero: 2,
              regra_nome: 'Mensalidade de processo',
              valor_informado: 550,
              valor_aprovado: 550,
              snapshot: {},
            },
          ],
        }),
      })
    })

    await page.goto('/financeiro/revisao-de-fatura')
    await page.getByRole('button', { name: 'Cliente B' }).click()
    await page.getByRole('button', { name: '11 - Contrato B' }).click()
    await page.getByRole('button', { name: '2 - Caso B' }).click()

    await page.locator('button:has(svg.lucide-square-pen)').first().click()
    await expect(page.getByText(/Item em status Aprovado/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /Avançar/i })).toHaveCount(0)
  })

  test('revisão: em aprovação com múltiplos aprovadores avança para o próximo aprovador sem mudar status', async ({ page }) => {
    await page.route('**/functions/v1/get-user-permissions**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          permissions: ['finance.faturamento.manage', 'finance.faturamento.approve'],
        }),
      })
    })

    await page.route('**/functions/v1/list-colaboradores**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            { id: 'col-1', nome: 'Filipe', categoria: 'Sócio' },
            { id: 'col-2', nome: 'Bruna Menegale Bogucheski', categoria: 'Sócio' },
            { id: 'col-3', nome: 'Fernanda Silva', categoria: 'Sócio' },
          ],
        }),
      })
    })

    await page.route('**/functions/v1/get-contratos**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: 'ctr-1',
              numero: 10,
              nome_contrato: 'Contrato A',
              casos: [
                {
                  id: 'caso-1',
                  numero: 1,
                  nome: 'Caso A',
                  timesheet_config: {
                    revisores: [{ colaborador_id: 'col-1', ordem: 1 }],
                    aprovadores: [
                      { colaborador_id: 'col-2', ordem: 1 },
                      { colaborador_id: 'col-3', ordem: 2 },
                    ],
                  },
                },
              ],
            },
          ],
        }),
      })
    })

    await page.route('**/functions/v1/get-revisao-fatura**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              billing_item_id: 'bi-chain-1',
              contrato_id: 'ctr-1',
              caso_id: 'caso-1',
              status: 'em_aprovacao',
              origem_tipo: 'regra_financeira',
              data_referencia: '2026-03-01',
              cliente_nome: 'Cliente A',
              contrato_nome: 'Contrato A',
              contrato_numero: 10,
              caso_nome: 'Caso A',
              caso_numero: 1,
              regra_nome: 'Mensalidade',
              valor_informado: 500,
              valor_revisado: 500,
              valor_aprovado: 500,
              responsavel_aprovacao_nome: 'Bruna Menegale Bogucheski',
              snapshot: {
                aprovador_ordem_atual: 1,
                responsavel_aprovacao_nome: 'Bruna Menegale Bogucheski',
              },
            },
          ],
        }),
      })
    })

    const updatePayloads: Array<Record<string, unknown>> = []
    await page.route('**/functions/v1/update-revisao-fatura-item', async (route) => {
      const payload = JSON.parse(route.request().postData() || '{}') as Record<string, unknown>
      updatePayloads.push(payload)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { ok: true } }),
      })
    })

    let setStatusCalled = false
    await page.route('**/functions/v1/set-revisao-fatura-status', async (route) => {
      setStatusCalled = true
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { ok: true } }),
      })
    })

    await page.goto('/financeiro/revisao-de-fatura')
    await page.getByRole('button', { name: 'Cliente A' }).click()
    await page.getByRole('button', { name: '10 - Contrato A' }).click()
    await page.getByRole('button', { name: '1 - Caso A' }).click()

    await page.locator('button:has(svg.lucide-check)').first().click()
    await page.getByRole('button', { name: /Avançar para próximo aprovador/i }).click()

    const movedInChain = updatePayloads.some((payload) => {
      const snapshotPatch = (payload.snapshot_patch || {}) as Record<string, unknown>
      return Number(snapshotPatch.aprovador_ordem_atual || 0) === 2
    })

    expect(movedInChain).toBeTruthy()
    expect(setStatusCalled).toBeFalsy()
  })

  test('revisão: item aprovado permite faturar com payload de desconto/rateio', async ({ page }) => {
    await page.route('**/functions/v1/get-user-permissions**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          permissions: ['finance.faturamento.manage', 'finance.faturamento.approve'],
        }),
      })
    })

    await page.route('**/functions/v1/list-colaboradores**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [{ id: 'col-1', nome: 'Filipe', categoria: 'Sócio' }] }),
      })
    })

    await page.route('**/functions/v1/get-contratos**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      })
    })

    await page.route('**/functions/v1/get-revisao-fatura**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              billing_item_id: 'bi-fat-1',
              contrato_id: 'ctr-2',
              caso_id: 'caso-2',
              status: 'aprovado',
              origem_tipo: 'regra_financeira',
              data_referencia: '2026-03-01',
              cliente_nome: 'Cliente C',
              contrato_nome: 'Contrato C',
              contrato_numero: 12,
              caso_nome: 'Caso C',
              caso_numero: 3,
              regra_nome: 'Projeto',
              valor_informado: 1000,
              valor_aprovado: 1000,
              snapshot: {},
            },
          ],
        }),
      })
    })

    let capturedFaturarPayload: Record<string, unknown> | null = null
    await page.route('**/functions/v1/faturar-revisao-item', async (route) => {
      capturedFaturarPayload = JSON.parse(route.request().postData() || '{}') as Record<string, unknown>
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            billing_item_id: 'bi-fat-1',
            status: 'faturado',
            note_numero: 123,
          },
        }),
      })
    })

    await page.goto('/financeiro/revisao-de-fatura')
    await page.getByRole('button', { name: 'Cliente C' }).click()
    await page.getByRole('button', { name: '12 - Contrato C' }).click()
    await page.getByRole('button', { name: '3 - Caso C' }).click()

    await page.locator('button:has(svg.lucide-square-pen)').first().click()
    await page.getByRole('button', { name: /^Faturar$/ }).click()
    await expect(page.getByRole('dialog').getByText('Faturar item')).toBeVisible()

    await page.getByRole('button', { name: /Confirmar faturamento/i }).click()

    expect(capturedFaturarPayload).not.toBeNull()
    expect(capturedFaturarPayload?.billing_item_id).toBe('bi-fat-1')
    expect(Number(capturedFaturarPayload?.desconto_valor || 0)).toBe(0)
    expect(Array.isArray(capturedFaturarPayload?.rateio_pagadores)).toBeTruthy()
  })
})
