export interface RefetchDecisionInput {
  visibilityState: DocumentVisibilityState
  lastFetchAt: number | null
  now: number
  minGapMs?: number
}

const DEFAULT_MIN_GAP_MS = 2000

export function shouldRefetchOnVisibility({
  visibilityState,
  lastFetchAt,
  now,
  minGapMs = DEFAULT_MIN_GAP_MS,
}: RefetchDecisionInput): boolean {
  if (visibilityState !== 'visible') return false
  if (lastFetchAt === null) return true
  return now - lastFetchAt >= minGapMs
}
