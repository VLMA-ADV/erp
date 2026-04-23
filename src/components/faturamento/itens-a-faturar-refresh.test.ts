import { describe, expect, it } from 'vitest'
import { shouldRefetchOnVisibility } from './itens-a-faturar-refresh'

describe('shouldRefetchOnVisibility', () => {
  it('retorna false quando documento está hidden', () => {
    expect(
      shouldRefetchOnVisibility({
        visibilityState: 'hidden',
        lastFetchAt: null,
        now: 1_000_000,
      }),
    ).toBe(false)
  })

  it('retorna true quando documento está visible e nunca buscou', () => {
    expect(
      shouldRefetchOnVisibility({
        visibilityState: 'visible',
        lastFetchAt: null,
        now: 1_000_000,
      }),
    ).toBe(true)
  })

  it('retorna false quando visible mas último fetch foi recente (<2s)', () => {
    const lastFetchAt = 1_000_000
    expect(
      shouldRefetchOnVisibility({
        visibilityState: 'visible',
        lastFetchAt,
        now: lastFetchAt + 1_500,
      }),
    ).toBe(false)
  })

  it('retorna true quando visible e último fetch passou do minGap (>=2s)', () => {
    const lastFetchAt = 1_000_000
    expect(
      shouldRefetchOnVisibility({
        visibilityState: 'visible',
        lastFetchAt,
        now: lastFetchAt + 2_000,
      }),
    ).toBe(true)
    expect(
      shouldRefetchOnVisibility({
        visibilityState: 'visible',
        lastFetchAt,
        now: lastFetchAt + 5_000,
      }),
    ).toBe(true)
  })

  it('aceita minGapMs customizado', () => {
    const lastFetchAt = 1_000_000
    expect(
      shouldRefetchOnVisibility({
        visibilityState: 'visible',
        lastFetchAt,
        now: lastFetchAt + 500,
        minGapMs: 100,
      }),
    ).toBe(true)
    expect(
      shouldRefetchOnVisibility({
        visibilityState: 'visible',
        lastFetchAt,
        now: lastFetchAt + 500,
        minGapMs: 1_000,
      }),
    ).toBe(false)
  })
})
