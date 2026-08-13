'use client'

/**
 * Fluxo de caixa do mes, dia a dia (pedido Filipe 12/08).
 *
 * Mesmo formato do grafico do Timesheet: todos os dias do mes no eixo, sem
 * pular dia sem movimento — assim da para ver de longe onde o mes aperta.
 * Vermelha = a pagar, verde = a receber, tracejada = saldo projetado.
 *
 * SVG na mao em vez de biblioteca de grafico: sao tres series e ~31 pontos, e
 * o projeto ja desenha assim no Timesheet e no Resumo de despesas.
 */
export interface DiaFluxo {
  data: string
  pagar: number
  receber: number
  saldo_projetado: number
}

export interface FluxoMensal {
  mes_inicio: string
  mes_fim: string
  saldo_inicial: number
  dias: DiaFluxo[]
  total_pagar: number
  total_receber: number
  saldo_final: number
  atrasado_anterior: { pagar: number; receber: number }
  // Mesmas linhas que cp_rotina_diaria devolve, para a tela reaproveitar a
  // mesma lista. O tipo concreto (Row) mora no dashboard.
  pagar: unknown[]
  receber: unknown[]
}

function formatMoney(valor: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(valor || 0))
}

function formatCurto(valor: number) {
  const abs = Math.abs(valor)
  if (abs >= 1000) return `${valor < 0 ? '-' : ''}R$ ${(abs / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}k`
  return formatMoney(valor)
}

const LARGURA = 1000
const ALTURA = 260
const PAD_ESQ = 8
const PAD_DIR = 8
const PAD_TOPO = 16
const PAD_BASE = 28

export default function FluxoMensalChart({ fluxo }: { fluxo: FluxoMensal }) {
  const dias = fluxo.dias || []
  if (dias.length === 0) return null

  const valores = dias.flatMap((d) => [Number(d.pagar), Number(d.receber)])
  const saldos = dias.map((d) => Number(d.saldo_projetado))

  // Duas escalas: as barras de movimento (pagar/receber) e o saldo, que anda
  // numa ordem de grandeza bem diferente. Uma escala so achataria o movimento
  // diario a ponto de nao dar para ler.
  const maxMov = Math.max(1, ...valores)
  const minSaldo = Math.min(...saldos, 0)
  const maxSaldo = Math.max(...saldos, 0)
  const spanSaldo = Math.max(1, maxSaldo - minSaldo)

  const larguraUtil = LARGURA - PAD_ESQ - PAD_DIR
  const alturaUtil = ALTURA - PAD_TOPO - PAD_BASE
  const x = (i: number) => PAD_ESQ + (dias.length === 1 ? larguraUtil / 2 : (i * larguraUtil) / (dias.length - 1))
  const yMov = (v: number) => PAD_TOPO + alturaUtil - (v / maxMov) * alturaUtil
  const ySaldo = (v: number) => PAD_TOPO + alturaUtil - ((v - minSaldo) / spanSaldo) * alturaUtil

  const linha = (get: (d: DiaFluxo) => number, escala: (v: number) => number) =>
    dias.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${escala(get(d)).toFixed(1)}`).join(' ')

  const hoje = new Date().toISOString().slice(0, 10)
  const indiceHoje = dias.findIndex((d) => d.data === hoje)

  const temAtrasado = Number(fluxo.atrasado_anterior?.pagar || 0) > 0 || Number(fluxo.atrasado_anterior?.receber || 0) > 0

  return (
    <div className="rounded-lg border border-hairline bg-white p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-eyebrow">Fluxo de caixa do mês</p>
          <p className="mt-1 text-sm text-ink-mute">
            Saldo inicial <span className="font-tabular text-ink">{formatMoney(fluxo.saldo_inicial)}</span>
            {' · '}projetado no fim do mês{' '}
            <span className={`font-tabular font-medium ${fluxo.saldo_final < 0 ? 'text-red-600' : 'text-ink'}`}>
              {formatMoney(fluxo.saldo_final)}
            </span>
          </p>
        </div>
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <li className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded bg-red-500" />
            <span className="text-ink-secondary">A pagar</span>
            <span className="font-tabular text-ink">{formatMoney(fluxo.total_pagar)}</span>
          </li>
          <li className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded bg-green-600" />
            <span className="text-ink-secondary">A receber</span>
            <span className="font-tabular text-ink">{formatMoney(fluxo.total_receber)}</span>
          </li>
          <li className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded border-t-2 border-dashed border-amber-500" />
            <span className="text-ink-secondary">Saldo projetado</span>
          </li>
        </ul>
      </div>

      {temAtrasado ? (
        <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          O dia 1 carrega o que venceu antes e ainda está em aberto:{' '}
          {Number(fluxo.atrasado_anterior.pagar) > 0 ? `${formatMoney(fluxo.atrasado_anterior.pagar)} a pagar` : ''}
          {Number(fluxo.atrasado_anterior.pagar) > 0 && Number(fluxo.atrasado_anterior.receber) > 0 ? ' e ' : ''}
          {Number(fluxo.atrasado_anterior.receber) > 0 ? `${formatMoney(fluxo.atrasado_anterior.receber)} a receber` : ''}.
        </p>
      ) : null}

      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${LARGURA} ${ALTURA}`} className="h-64 w-full min-w-[720px]" role="img" aria-label="Fluxo de caixa do mês">
          {/* zero da escala de saldo, quando o projetado chega a ficar negativo */}
          {minSaldo < 0 ? (
            <line x1={PAD_ESQ} x2={LARGURA - PAD_DIR} y1={ySaldo(0)} y2={ySaldo(0)}
              stroke="hsl(var(--destructive))" strokeWidth={1} strokeDasharray="2 4" opacity={0.5} />
          ) : null}

          {indiceHoje >= 0 ? (
            <line x1={x(indiceHoje)} x2={x(indiceHoje)} y1={PAD_TOPO} y2={PAD_TOPO + alturaUtil}
              stroke="hsl(var(--primary))" strokeWidth={1} opacity={0.35} />
          ) : null}

          <path d={linha((d) => Number(d.saldo_projetado), ySaldo)} fill="none"
            stroke="#F59E0B" strokeWidth={2} strokeDasharray="6 4" strokeLinejoin="round" />
          <path d={linha((d) => Number(d.receber), yMov)} fill="none"
            stroke="#16A34A" strokeWidth={2} strokeLinejoin="round" />
          <path d={linha((d) => Number(d.pagar), yMov)} fill="none"
            stroke="#EF4444" strokeWidth={2} strokeLinejoin="round" />

          {dias.map((d, i) => {
            const temMov = Number(d.pagar) > 0 || Number(d.receber) > 0
            if (!temMov) return null
            return (
              <g key={d.data}>
                {Number(d.pagar) > 0 ? <circle cx={x(i)} cy={yMov(Number(d.pagar))} r={3} fill="#EF4444" /> : null}
                {Number(d.receber) > 0 ? <circle cx={x(i)} cy={yMov(Number(d.receber))} r={3} fill="#16A34A" /> : null}
                <title>
                  {`Dia ${d.data.slice(8, 10)} — a pagar ${formatMoney(Number(d.pagar))}, a receber ${formatMoney(Number(d.receber))}, saldo ${formatMoney(Number(d.saldo_projetado))}`}
                </title>
              </g>
            )
          })}

          {/* Numero do dia: de 2 em 2 quando o mes e longo, para nao virar borrao */}
          {dias.map((d, i) => {
            const numero = Number(d.data.slice(8, 10))
            const mostra = dias.length <= 16 || numero % 2 === 1 || i === dias.length - 1
            if (!mostra) return null
            return (
              <text key={`lbl-${d.data}`} x={x(i)} y={ALTURA - 10} textAnchor="middle"
                className="fill-ink-mute" style={{ fontSize: 11 }}>
                {numero}
              </text>
            )
          })}
        </svg>
      </div>

      <p className="mt-1 text-center text-[11px] text-ink-mute">
        Passe o mouse num dia com movimento para ver os valores · pico de saída {formatCurto(Math.max(0, ...dias.map((d) => Number(d.pagar))))}
      </p>
    </div>
  )
}
