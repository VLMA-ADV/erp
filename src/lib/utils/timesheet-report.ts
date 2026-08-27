// Relatório de timesheet no papel timbrado do escritório.
//
// Filipe, 27/08: "queria te pedir pra deixar o relatório de timesheet e nota de
// débito nesse layout aqui (com logo e em formato paisagem)", mandando uma Nota
// de Honorários do sistema antigo.
//
// O layout anterior era o provisório que ele mesmo aprovou como temporário em
// 20/07. A estrutura agora segue o modelo dele: agrupa por Contrato, dentro
// dele por Caso, cada caso com suas linhas e um total, e o total do contrato no
// fim. A moldura (logo, timbre, rodapé) mora em documento-vlma.ts, para a nota
// de débito sair igual.

import {
  abrirDocumento,
  dataBR,
  esc,
  money,
  montarDocumento,
  type DestinatarioDoc,
} from './documento-vlma'

export interface TimesheetReportRow {
  data: string
  cliente: string
  caso: string
  /** Quando vem, vira o cabeçalho cinza "Contrato". Sem ele, agrupa só por caso. */
  contrato?: string
  profissional?: string
  descricao: string
  horas?: string
  valor?: number | null
}

export function openTimesheetReport({
  titulo,
  subtitulo,
  rows,
  mostrarValor,
  destinatario,
  documento,
}: {
  titulo: string
  subtitulo?: string
  rows: TimesheetReportRow[]
  mostrarValor?: boolean
  destinatario?: DestinatarioDoc
  documento?: { emissao?: string; vencimento?: string; numero?: string | number }
}) {
  // Agrupa preservando a ordem de chegada: quem gerou já ordenou como queria.
  const porContrato = new Map<string, Map<string, TimesheetReportRow[]>>()
  for (const r of rows) {
    const c = r.contrato || r.cliente || '—'
    const k = r.caso || '—'
    if (!porContrato.has(c)) porContrato.set(c, new Map())
    const casos = porContrato.get(c)!
    if (!casos.has(k)) casos.set(k, [])
    casos.get(k)!.push(r)
  }

  const colspan = mostrarValor ? 4 : 3
  const soma = (linhas: TimesheetReportRow[]) =>
    linhas.reduce((s, l) => s + Number(l.valor || 0), 0)

  // O <thead> sobe para o topo da tabela por definicao do HTML — se so as
  // colunas ficassem aqui, "Data / Descricao / ..." apareceria ACIMA da linha
  // do caso. Por isso a linha do caso entra junto: alem de sair na ordem certa,
  // um caso que quebra de pagina repete o nome dele no topo da pagina seguinte.
  const cabecalhoCaso = (caso: string) => `<thead class="cab">
      <tr class="caso"><td colspan="${colspan + 1}"><span class="lbl">Caso</span>&nbsp;&nbsp;&nbsp;${esc(caso)}</td></tr>
      <tr>
        <th style="width:22mm">Data</th>
        <th>Descrição</th>
        <th style="width:38mm">Profissional</th>
        <th class="num" style="width:20mm">Horas</th>
        ${mostrarValor ? '<th class="num" style="width:26mm">Valor (R$)</th>' : ''}
      </tr></thead>`

  let corpo = ''
  for (const [contrato, casos] of porContrato) {
    corpo += `<table class="itens">
      <tr class="grupo"><td colspan="${colspan + 1}">Contrato&nbsp;&nbsp;&nbsp;${esc(contrato)}</td></tr>
    </table>`

    let totalContrato = 0
    for (const [caso, linhas] of casos) {
      const totalCaso = soma(linhas)
      totalContrato += totalCaso
      corpo += `<table class="itens">
        ${cabecalhoCaso(caso)}
        <tbody>
          ${linhas.map((l) => `<tr>
            <td class="item nowrap">${esc(dataBR(l.data))}</td>
            <td class="item">${esc(l.descricao || '—')}</td>
            <td class="item">${esc(l.profissional || '—')}</td>
            <td class="item num">${esc(l.horas || '—')}</td>
            ${mostrarValor ? `<td class="item num">${l.valor != null ? money(Number(l.valor)) : '—'}</td>` : ''}
          </tr>`).join('')}
        </tbody>
        ${mostrarValor ? `<tr class="total">
          <td class="lbl" colspan="${colspan}">Total</td>
          <td class="num">${money(totalCaso)}</td>
        </tr>` : ''}
      </table>`
    }

    if (mostrarValor) {
      // 'break-before: avoid' para o total nao amanhecer sozinho no topo da
      // pagina seguinte, separado do contrato que ele soma.
      corpo += `<table class="itens" style="break-before:avoid"><tr class="total">
        <td class="lbl" colspan="${colspan}">Total do contrato</td>
        <td class="num" style="width:26mm">${money(totalContrato)}</td>
      </tr></table>`
    }
  }

  const totalGeral = soma(rows)
  const rodapeExtra = mostrarValor && porContrato.size > 1
    ? `<table class="itens"><tr class="totalgeral">
         <td class="lbl">Total geral</td>
         <td class="num" style="width:26mm">${money(totalGeral)}</td>
       </tr></table>`
    : ''

  const html = montarDocumento({
    doc: {
      titulo,
      emissao: documento?.emissao ?? new Date().toLocaleDateString('pt-BR'),
      vencimento: documento?.vencimento,
      numero: documento?.numero,
    },
    destinatario: destinatario ?? (subtitulo ? { nome: subtitulo } : undefined),
    conteudo: corpo,
    rodapeExtra,
  })

  return abrirDocumento(html)
}
