// Relatório de timesheet (pedido Filipe 20/07) — layout provisório, o cliente
// vai definir o definitivo depois. Abre numa aba própria pronta pra imprimir /
// salvar em PDF, com os dados filtrados da tela que o gerou.

export interface TimesheetReportRow {
  data: string
  cliente: string
  caso: string
  profissional?: string
  descricao: string
  horas?: string
  valor?: number | null
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const money = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)

export function openTimesheetReport({
  titulo,
  subtitulo,
  rows,
  mostrarValor,
}: {
  titulo: string
  subtitulo?: string
  rows: TimesheetReportRow[]
  mostrarValor?: boolean
}) {
  const totalValor = rows.reduce((s, r) => s + Number(r.valor || 0), 0)
  const geradoEm = new Date().toLocaleString('pt-BR')

  const linhas = rows
    .map(
      (r) => `<tr>
        <td class="nowrap">${esc(r.data || '—')}</td>
        <td>${esc(r.cliente || '—')}</td>
        <td>${esc(r.caso || '—')}</td>
        <td>${esc(r.profissional || '—')}</td>
        <td class="desc">${esc(r.descricao || '—')}</td>
        <td class="num">${esc(r.horas || '—')}</td>
        ${mostrarValor ? `<td class="num">${r.valor != null ? money(Number(r.valor)) : '—'}</td>` : ''}
      </tr>`,
    )
    .join('')

  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8" />
<title>${esc(titulo)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; color: #1f2937; margin: 32px; }
  header { border-bottom: 3px solid #E8871E; padding-bottom: 12px; margin-bottom: 16px; }
  h1 { font-size: 20px; margin: 0; color: #5B3A8E; }
  .sub { color: #6b7280; font-size: 12px; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th { text-align: left; text-transform: uppercase; font-size: 9px; letter-spacing: .04em; color: #6b7280; border-bottom: 1px solid #e5e7eb; padding: 6px 8px; }
  td { border-bottom: 1px solid #f3f4f6; padding: 6px 8px; vertical-align: top; }
  td.num, th.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  td.nowrap { white-space: nowrap; }
  td.desc { max-width: 420px; }
  tfoot td { font-weight: 600; border-top: 2px solid #e5e7eb; }
  .toolbar { margin: 16px 0; }
  .toolbar button { background: #E8871E; color: #fff; border: 0; border-radius: 999px; padding: 8px 18px; font-size: 13px; cursor: pointer; }
  footer { margin-top: 24px; color: #9ca3af; font-size: 10px; }
  @media print { .toolbar { display: none; } body { margin: 12mm; } }
</style></head><body>
<header>
  <h1>${esc(titulo)}</h1>
  <p class="sub">${esc(subtitulo || '')} · ${rows.length} lançamento(s) · gerado em ${esc(geradoEm)}</p>
</header>
<div class="toolbar"><button onclick="window.print()">Imprimir / salvar PDF</button></div>
<table>
  <thead><tr>
    <th>Data</th><th>Cliente</th><th>Caso</th><th>Profissional</th><th>Descrição</th><th class="num">Horas</th>${mostrarValor ? '<th class="num">Valor</th>' : ''}
  </tr></thead>
  <tbody>${linhas}</tbody>
  ${mostrarValor ? `<tfoot><tr><td colspan="6">Total</td><td class="num">${money(totalValor)}</td></tr></tfoot>` : ''}
</table>
<footer>VLMA ERP — relatório de timesheet (layout provisório)</footer>
</body></html>`

  const win = window.open('', '_blank')
  if (!win) return false
  win.document.write(html)
  win.document.close()
  return true
}
