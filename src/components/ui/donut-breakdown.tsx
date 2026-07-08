'use client'

// Paleta de marca VLMA para gráficos (laranja + roxo + tons quentes; sem azul frio).
const DONUT_PALETTE = ['#FF9900', '#7A5CE0', '#FF3333', '#1E1423', '#FFC266', '#B45309', '#A8A29E']
const OUTROS_COLOR = '#cbd5e1'

export interface DonutGroup {
  label: string
  count: number
}

export function DonutBreakdown({
  titulo,
  grupos,
  labelMap,
  maxSlices = 6,
}: {
  titulo: string
  grupos: DonutGroup[]
  labelMap?: Record<string, string>
  maxSlices?: number
}) {
  const sorted = [...(grupos || [])].sort((a, b) => b.count - a.count)
  let slices = sorted
  if (sorted.length > maxSlices) {
    const head = sorted.slice(0, maxSlices - 1)
    const restTotal = sorted.slice(maxSlices - 1).reduce((s, g) => s + g.count, 0)
    slices = [...head, { label: 'Outros', count: restTotal }]
  }
  const total = slices.reduce((s, g) => s + g.count, 0)
  const r = 42
  const cx = 60
  const cy = 60
  const circ = 2 * Math.PI * r
  const color = (g: DonutGroup, i: number) => (g.label === 'Outros' ? OUTROS_COLOR : DONUT_PALETTE[i % DONUT_PALETTE.length])

  let offset = 0
  return (
    <div className="rounded-xl border border-hairline bg-card p-4">
      <p className="text-eyebrow mb-3">{titulo}</p>
      {total === 0 ? (
        <p className="text-sm text-ink-mute">—</p>
      ) : (
        <div className="flex items-center gap-4">
          <svg viewBox="0 0 120 120" className="h-28 w-28 shrink-0 -rotate-90">
            <circle cx={cx} cy={cy} r={r} fill="none" stroke="hsl(var(--secondary))" strokeWidth={16} />
            {slices.map((g, i) => {
              const dash = (g.count / total) * circ
              const pct = Math.round((g.count / total) * 100)
              const node = (
                <circle
                  key={g.label}
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill="none"
                  stroke={color(g, i)}
                  strokeWidth={16}
                  strokeDasharray={`${dash} ${circ - dash}`}
                  strokeDashoffset={-offset}
                >
                  <title>{`${labelMap?.[g.label] || g.label}: ${g.count} (${pct}%)`}</title>
                </circle>
              )
              offset += dash
              return node
            })}
          </svg>
          <ul className="min-w-0 flex-1 space-y-1">
            {slices.map((g, i) => (
              <li key={g.label} className="flex items-center gap-2 text-xs">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: color(g, i) }} />
                <span className="truncate text-ink-secondary">{labelMap?.[g.label] || g.label}</span>
                <span className="ml-auto font-tabular font-medium text-ink">{g.count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export default DonutBreakdown
