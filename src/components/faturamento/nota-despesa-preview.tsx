'use client'

import { useMemo, useRef } from 'react'
import { Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { montarDocumento } from '@/lib/utils/documento-vlma'
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

// HTML completo da nota — papel timbrado compartilhado (documento-vlma.ts),
// A4 paisagem com logo, a pedido do Filipe em 27/08.
function buildNotaHtml(data: NotaDespesaData) {
  const total = data.itens.reduce((acc, item) => acc + Number(item.valor || 0), 0)
  const linhas = data.itens
    .map(
      (item) => `
        <tr>
          <td class="item nowrap">${dataBR(item.data_lancamento)}</td>
          <td class="item">${escapeHtml(item.categoria || '—')}</td>
          <td class="item">${escapeHtml(item.descricao || '—')}</td>
          <td class="item num">${money(item.valor)}</td>
        </tr>`,
    )
    .join('')

  const bancoHtml = `<div style="margin-top:8mm;font-size:7.6pt;line-height:1.5">
    <strong>Instruções para pagamento bancário:</strong><br/>
    Favorecido: ${escapeHtml(ESCRITORIO.favorecido)}<br/>
    CNPJ ${ESCRITORIO.cnpj}<br/>
    ${ESCRITORIO.banco}
  </div>`

  // Contrato e caso moram dentro do <thead> junto com as colunas: o thead sobe
  // para o topo da tabela por definicao do HTML, entao deixa-los fora inverteria
  // a ordem. De quebra, tudo isso repete se a nota passar de uma pagina.
  const conteudo = `<table class="itens">
    <thead class="cab">
    <tr class="grupo"><td colspan="4">Contrato&nbsp;&nbsp;&nbsp;${escapeHtml(data.contratoLabel)}</td></tr>
    ${data.casoLabel ? `<tr class="caso"><td colspan="4"><span class="lbl">Caso</span>&nbsp;&nbsp;&nbsp;${escapeHtml(data.casoLabel)}</td></tr>` : ''}
    <tr>
      <th style="width:22mm">Data</th>
      <th style="width:45mm">Categoria</th>
      <th>Descrição</th>
      <th class="num" style="width:26mm">Valor (R$)</th>
    </tr></thead>
    <tbody>${linhas || '<tr><td class="item" colspan="4">Sem despesas reembolsáveis aprovadas.</td></tr>'}</tbody>
    <tr class="total"><td class="lbl" colspan="3">Total</td><td class="num">${money(total)}</td></tr>
    <tr class="totalgeral"><td class="lbl" colspan="3">Valor a pagar&nbsp;&nbsp;R$</td><td class="num">${money(total)}</td></tr>
  </table>`

  // Mesma moldura do relatório de horas: logo, timbre, paisagem e rodapé.
  return montarDocumento({
    doc: {
      titulo: 'Nota de Débito',
      emissao: dataBR(data.emissao),
      vencimento: dataBR(data.vencimento),
      numero: data.documentoNumero || undefined,
    },
    destinatario: {
      nome: data.clienteNome,
      documento: data.clienteDocumento || undefined,
      endereco: data.clienteEndereco || undefined,
    },
    conteudo,
    rodapeExtra: bancoHtml,
  })
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
