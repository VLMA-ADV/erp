'use client'

import { useMemo, useRef } from 'react'
import { Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

// Dados fixos do escritório (extraídos do modelo de Nota de Despesas da VLMA).
const ESCRITORIO = {
  razao: 'Di Lascio, Vosgerau & Advogados Associados',
  cnpj: '14.491.612/0001-39',
  im: '6265382',
  ie: 'isento',
  endereco: 'Rua Cândido Xavier, 602 - 2º andar - Água Verde',
  cidade: '80240-280 - Curitiba - PR - Brasil',
  favorecido: 'Di Lascio & Advogados Associados',
  banco: 'Banco Itaú (341) - Ag. 3835 C/C. 31141-0',
  rodape: 'CURITIBA  Rua Cândido Xavier, 602, 2º and  (41) 3153-4010',
  site: 'http://www.vlma.com.br',
}

export interface NotaDespesaItem {
  data_lancamento: string
  categoria: string
  descricao: string
  valor: number
}

export interface NotaDespesaData {
  clienteNome: string
  clienteEndereco?: string | null
  clienteDocumento?: string | null
  contratoLabel: string
  casoLabel?: string | null
  documentoNumero?: string | null
  emissao: string
  vencimento: string
  itens: NotaDespesaItem[]
}

function money(v: number) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function dataBR(value: string | null | undefined) {
  if (!value) return '—'
  const dt = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value)
  if (Number.isNaN(dt.getTime())) return value
  return dt.toLocaleDateString('pt-BR')
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// HTML completo da nota (A4) — usado no preview via iframe e na impressão/Salvar PDF.
function buildNotaHtml(data: NotaDespesaData) {
  const total = data.itens.reduce((acc, item) => acc + Number(item.valor || 0), 0)
  const linhas = data.itens
    .map(
      (item) => `
        <tr>
          <td class="num">${dataBR(item.data_lancamento)}</td>
          <td>${escapeHtml(item.categoria || '—')}</td>
          <td>${escapeHtml(item.descricao || '—')}</td>
          <td class="val">${money(item.valor)}</td>
        </tr>`,
    )
    .join('')

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8" />
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 11px; margin: 0; }
  .logo { text-align: right; font-weight: 700; letter-spacing: 6px; font-size: 22px; }
  .muted { color: #555; }
  h1 { font-size: 14px; margin: 0; }
  .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; }
  .firma { font-size: 10px; line-height: 1.45; }
  .firma strong { font-size: 11px; }
  .docbox { width: 240px; }
  .docrow { display: flex; justify-content: space-between; border-top: 1px solid #ddd; padding: 3px 0; }
  .docrow strong { font-variant-numeric: tabular-nums; }
  .destino { margin-top: 22px; line-height: 1.45; }
  .destino .nome { font-weight: 700; font-size: 12px; }
  .secao { margin-top: 24px; }
  .barra { background: #ececec; padding: 4px 8px; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  th { text-align: left; font-size: 10px; border-bottom: 1px solid #333; padding: 4px 6px; }
  td { padding: 5px 6px; vertical-align: top; border-bottom: 1px solid #f0f0f0; }
  td.val, th.val, td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .totais { margin-top: 8px; }
  .totais .linha { display: flex; justify-content: flex-end; gap: 40px; padding: 4px 6px; }
  .totais .destaque { border-top: 2px solid #333; font-weight: 700; font-size: 12px; }
  .banco { margin-top: 36px; font-size: 10px; line-height: 1.5; }
  .rodape { margin-top: 40px; border-top: 1px solid #ddd; padding-top: 6px; font-size: 9px; color: #666; display:flex; justify-content:space-between; }
</style></head>
<body>
  <div class="top">
    <div class="firma">
      <strong>${escapeHtml(ESCRITORIO.razao)}</strong><br/>
      CNPJ: ${ESCRITORIO.cnpj}<br/>
      I.M.: ${ESCRITORIO.im}&nbsp;&nbsp;I.E.: ${ESCRITORIO.ie}<br/>
      ${escapeHtml(ESCRITORIO.endereco)}<br/>
      ${escapeHtml(ESCRITORIO.cidade)}
    </div>
    <div class="logo">VLMA</div>
  </div>

  <div class="top" style="margin-top:18px;">
    <div><h1>Nota de Despesas</h1></div>
    <div class="docbox">
      <div class="docrow"><span class="muted">Emissão</span><strong>${dataBR(data.emissao)}</strong></div>
      <div class="docrow"><span class="muted">Vencimento</span><strong>${dataBR(data.vencimento)}</strong></div>
      <div class="docrow"><span class="muted">Documento nº</span><strong>${escapeHtml(data.documentoNumero || '—')}</strong></div>
    </div>
  </div>

  <div class="destino">
    <div class="nome">${escapeHtml(data.clienteNome)}</div>
    ${data.clienteDocumento ? `<div>${escapeHtml(data.clienteDocumento)}</div>` : ''}
    ${data.clienteEndereco ? `<div class="muted">${escapeHtml(data.clienteEndereco)}</div>` : ''}
  </div>

  <div class="secao">
    <div class="barra">Contrato&nbsp;&nbsp;${escapeHtml(data.contratoLabel)}</div>
    ${data.casoLabel ? `<div class="barra" style="background:#f5f5f5;font-weight:600;">Caso&nbsp;&nbsp;${escapeHtml(data.casoLabel)}</div>` : ''}
    <table>
      <thead>
        <tr><th class="num">Data</th><th>Categoria</th><th>Descrição</th><th class="val">Valor</th></tr>
      </thead>
      <tbody>${linhas || '<tr><td colspan="4" class="muted">Sem despesas reembolsáveis aprovadas.</td></tr>'}</tbody>
    </table>
    <div class="totais">
      <div class="linha"><span class="muted">Total</span><strong>${money(total)}</strong></div>
      <div class="linha destaque"><span>Valor a pagar&nbsp;R$</span><span>${money(total)}</span></div>
    </div>
  </div>

  <div class="banco">
    <strong>Instruções para pagamento bancário:</strong><br/>
    Favorecido: ${escapeHtml(ESCRITORIO.favorecido)}<br/>
    CNPJ ${ESCRITORIO.cnpj}<br/>
    ${ESCRITORIO.banco}
  </div>

  <div class="rodape"><span>${escapeHtml(ESCRITORIO.rodape)}<br/>${ESCRITORIO.site}</span></div>
</body></html>`
}

export default function NotaDespesaPreview({
  open,
  onClose,
  data,
}: {
  open: boolean
  onClose: () => void
  data: NotaDespesaData | null
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const html = useMemo(() => (data ? buildNotaHtml(data) : ''), [data])

  const handlePrint = () => {
    const win = iframeRef.current?.contentWindow
    if (!win) return
    win.focus()
    win.print()
  }

  return (
    <Dialog open={open} onOpenChange={(value) => (!value ? onClose() : undefined)}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Nota de Despesas</DialogTitle>
          <DialogDescription>
            Pré-visualização no formato do escritório. Use “Imprimir / Salvar PDF” para gerar o documento.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md border bg-white">
          <iframe
            ref={iframeRef}
            title="Nota de Despesas"
            srcDoc={html}
            className="h-[65vh] w-full rounded-md"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
          <Button onClick={handlePrint}>
            <Printer className="mr-2 h-4 w-4" />
            Imprimir / Salvar PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
