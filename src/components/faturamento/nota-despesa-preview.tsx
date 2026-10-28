'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/toast'
import { divisaoDaNota, montarNotaComComprovantes, percentualBR, totalDaNota, type AnexoDespesa } from '@/lib/utils/nota-despesa-pdf'
import type { PagadorRelatorio } from '@/lib/utils/timesheet-report-pdf'
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

/** Uma ND do rateio, pronta para registrar. */
export interface NotaDebitoGerada {
  bytes: Uint8Array
  nomeArquivo: string
  numeroDocumento: number | null
  pagadorClienteId: string
  percentual: number
  valor: number
}

export interface NotaDespesaData {
  clienteNome: string
  clienteEndereco?: string | null
  clienteDocumento?: string | null
  contratoLabel: string
  casoLabel?: string | null
  /** Nº do documento (numeração única, out/2026) — sai no título: "Nota de Débito nº 16". */
  documentoNumero?: string | null
  /**
   * "setembro/2026" — mês do SERVIÇO das despesas (competência do kit − 1;
   * ver lib/faturamento/competencia-do-servico.ts). Sem ele a nota sai sem a
   * linha de competência, como antes.
   */
  competenciaLabel?: string | null
  emissao: string
  vencimento: string
  itens: NotaDespesaItem[]
  /** Ids das despesas de origem, para juntar os comprovantes no PDF. */
  despesaIds?: string[]
  /**
   * Pagadores do kit (nome e percentual do rateio). Com rateio — ou pagador
   * único diferente do cliente — a nota ganha a "Divisão por pagador" depois
   * do total (cliente, out/2026). Um pagador igual ao cliente (ou nenhum) =
   * nota de sempre. Ver divisaoDaNota em lib/utils/nota-despesa-pdf.ts.
   */
  pagadores?: PagadorRelatorio[] | null
  /**
   * Rateio das despesas (Filipe 29/10): esta nota é a de UM pagador. O total
   * das despesas continua impresso e o "Valor a pagar" é a parte dele.
   */
  parte?: { nome: string; percentual: number; valor: number } | null
  /**
   * Kit só de despesas com vários pagadores (Filipe 29/10): ao baixar, sai
   * uma nota por pagador (destinatário e "Valor a pagar" = parte dele).
   * `valor` já vem dividido (divisaoPorPagador: o último absorve os centavos).
   */
  rateioPagadores?: Array<{ clienteId: string; nome: string; percentual: number; valor: number }> | null
  /**
   * Kit só de despesas (Filipe 16/10: "não deixa mudar o vencimento"): a ND é
   * quem cria a conta a receber do boleto, então a prévia ganha o campo de
   * vencimento — como o "Vencimento do boleto" da prévia da NFS-e. Sem isto
   * (kit com serviço, outras telas) o vencimento é só o impresso.
   */
  vencimentoEditavel?: boolean
  /**
   * Vencimento que o campo já traz (ISO): o da conta a receber atual. Sem
   * isso, "Gerar de novo" sem mexer no campo recriaria a conta pela regra e
   * perderia a data escolhida antes.
   */
  vencimentoInicial?: string | null
  /** Por que o vencimento não muda mais (boleto vivo ou conta já baixada). */
  vencimentoTravadoMotivo?: string | null
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

// "Divisão por pagador" (mesmos números do PDF — divisaoDaNota): vazio sem rateio.
function divisaoHtml(data: NotaDespesaData) {
  const divisao = divisaoDaNota(data)
  if (!divisao) return ''
  const linhas = divisao
    .map((d) => `<tr>
      <td class="item">${escapeHtml(d.nome)}</td>
      <td class="item num" style="width:26mm">${percentualBR(d.percentual)}</td>
      <td class="item num" style="width:26mm">${money(d.valor)}</td>
    </tr>`)
    .join('')
  return `<table class="itens divisao" style="margin-top:5mm;width:auto;min-width:55%;margin-left:auto">
    <thead class="cab"><tr>
      <th>Divisão por pagador</th>
      <th class="num">Percentual</th>
      <th class="num">Valor (R$)</th>
    </tr></thead>
    <tbody>${linhas}</tbody>
  </table>`
}

// HTML completo da nota — papel timbrado compartilhado (documento-vlma.ts),
// A4 paisagem com logo, a pedido do Filipe em 27/08.
function buildNotaHtml(data: NotaDespesaData) {
  const total = totalDaNota(data)
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
    <tr class="total"><td class="lbl" colspan="3">Total${data.parte ? ' das despesas' : ''}</td><td class="num">${money(total)}</td></tr>
    ${data.parte ? `<tr class="total"><td class="lbl" colspan="3">Parte de ${escapeHtml(data.parte.nome)} (${percentualBR(data.parte.percentual)})</td><td class="num">${money(data.parte.valor)}</td></tr>` : ''}
    <tr class="totalgeral"><td class="lbl" colspan="3">Valor a pagar&nbsp;&nbsp;R$</td><td class="num">${money(data.parte ? data.parte.valor : total)}</td></tr>
  </table>${divisaoHtml(data)}`

  // Mesma moldura do relatório de horas: logo, timbre, paisagem e rodapé.
  return montarDocumento({
    doc: {
      titulo: 'Nota de Débito',
      emissao: dataBR(data.emissao),
      vencimento: dataBR(data.vencimento),
      competencia: data.competenciaLabel || undefined,
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
  onGerado,
  reservarNumero,
  onGeradoRateio,
}: {
  open: boolean
  onClose: () => void
  data: NotaDespesaData | null
  /**
   * Chamado com o PDF montado (nota + comprovantes) logo depois do download.
   * A Composição da fatura usa para REGISTRAR o documento no kit (Filipe,
   * 21/09, D12-a); as outras telas seguem só baixando.
   */
  onGerado?: (
    bytes: Uint8Array,
    nomeArquivo: string,
    numeroDocumento?: number | null,
    /** Vencimento escolhido na prévia (ISO); null = regra do caso/contrato. */
    vencimento?: string | null,
  ) => Promise<void> | void
  /**
   * Reserva o nº do documento ANTES de montar o PDF (ele sai impresso). Só a
   * Composição passa — é quem registra. Regerar a mesma nota devolve o mesmo nº.
   */
  reservarNumero?: (pagadorClienteId?: string) => Promise<number | null>
  /** Rateio das despesas (data.rateioPagadores): as NDs de todos os pagadores, de uma vez. */
  onGeradoRateio?: (notas: NotaDebitoGerada[], vencimento?: string | null) => Promise<void> | void
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  // Número reservado ao montar o PDF: a prévia passa a mostrá-lo também.
  const [numeroReservado, setNumeroReservado] = useState<string | null>(null)
  // Vazio = regra de sempre (vencimento_para_nota: dia de pagamento do caso
  // ou +7 dias). Preenchido, sai impresso na nota e vai como
  // vencimento_override para a conta a receber/boleto, igual à NFS-e.
  const [vencimentoEscolhido, setVencimentoEscolhido] = useState('')
  useEffect(() => {
    setNumeroReservado(null)
    setVencimentoEscolhido((data?.vencimentoInicial || '').slice(0, 10))
  }, [data])
  const podeEscolherVencimento = !!data?.vencimentoEditavel && !data?.vencimentoTravadoMotivo
  const vencimentoValido = podeEscolherVencimento && /^\d{4}-\d{2}-\d{2}$/.test(vencimentoEscolhido) ? vencimentoEscolhido : null
  const dataComAjustes = useMemo(() => {
    if (!data) return null
    let d = data
    if (vencimentoValido) d = { ...d, vencimento: vencimentoValido }
    if (numeroReservado) d = { ...d, documentoNumero: numeroReservado }
    return d
  }, [data, numeroReservado, vencimentoValido])
  const html = useMemo(() => (dataComAjustes ? buildNotaHtml(dataComAjustes) : ''), [dataComAjustes])
  const { error: toastError, success } = useToast()
  const [montando, setMontando] = useState(false)

  // Bug 6.3 (Filipe, 24/09): a nota saía "com comprovantes" sem nenhum porque a
  // tela não achava a despesa de origem e ninguém era avisado antes de gerar.
  // Quando falta origem para alguma linha, o aviso fica na cara, antes do botão.
  const despesasSemOrigem = data
    ? Math.max(0, data.itens.length - new Set((data.despesaIds || []).filter(Boolean)).size)
    : 0

  // Nota + comprovantes num PDF so (Filipe, 11/09). Os arquivos vem um a um
  // pela edge que ja existe (get-despesa-arquivo), que checa permissao.
  const baixarComComprovantes = async () => {
    if (!data || montando) return
    setMontando(true)
    try {
      if (data.rateioPagadores && data.rateioPagadores.length > 1 && onGeradoRateio) {
        await baixarRateio(data.rateioPagadores)
        return
      }
      // Nº do documento primeiro: sem ele o PDF registrado sairia sem número.
      let numeroDocumento: number | null = null
      let dataPdf = vencimentoValido ? { ...data, vencimento: vencimentoValido } : data
      if (reservarNumero) {
        try {
          numeroDocumento = await reservarNumero()
        } catch (e) {
          toastError(e instanceof Error ? e.message : 'Não foi possível numerar a nota de débito.')
          return
        }
        if (numeroDocumento) {
          dataPdf = { ...dataPdf, documentoNumero: String(numeroDocumento) }
          setNumeroReservado(String(numeroDocumento))
        }
      }
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { toastError('Sessão expirada.'); return }
      const ids = (data.despesaIds || []).filter(Boolean)
      let anexos: AnexoDespesa[] = []
      if (ids.length > 0) {
        const { data: lista, error } = await supabase.rpc('get_anexos_das_despesas', {
          p_user_id: session.user.id,
          p_despesa_ids: ids,
        })
        if (error) { toastError(error.message || 'Erro ao listar os comprovantes'); return }
        anexos = (Array.isArray(lista) ? lista : []) as AnexoDespesa[]
      }

      const baixarAnexo = async (kind: 'primario' | 'extra', id: string) => {
        const resp = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-despesa-arquivo?kind=${kind}&id=${id}`,
          { headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' } },
        )
        const payload = await resp.json().catch(() => ({}))
        if (!resp.ok || !payload.arquivo_base64) return null
        return { base64: payload.arquivo_base64 as string, mime: (payload.mime_type as string) ?? null }
      }

      const { bytes, anexados, naoAnexados } = await montarNotaComComprovantes({ data: dataPdf, anexos, baixarAnexo })
      const numeroNoNome = dataPdf.documentoNumero ? `n${dataPdf.documentoNumero}-` : ''
      const nomeArquivo = `nota-de-debito-${numeroNoNome}${(data.clienteNome || 'cliente').replace(/[^\w]+/g, '-').toLowerCase()}.pdf`
      const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = nomeArquivo
      a.click()
      URL.revokeObjectURL(a.href)

      // Registro no kit vem DEPOIS do download: se o registro falhar, a pessoa
      // já tem o arquivo na mão e o erro aparece separado.
      if (onGerado) {
        try {
          await onGerado(bytes, nomeArquivo, numeroDocumento, vencimentoValido)
        } catch (e) {
          console.error('registrar nota de débito', e)
          toastError(e instanceof Error ? e.message : 'O PDF foi baixado, mas não foi possível registrá-lo no kit.')
        }
      }

      if (naoAnexados.length > 0) {
        toastError(`PDF gerado com ${anexados} comprovante(s). ${naoAnexados.length} não pôde(ram) ser anexado(s) — veja a última página.`)
      } else if (anexados > 0) {
        success(`PDF gerado com ${anexados} comprovante(s).`)
      } else if (ids.length === 0) {
        // Sem id de despesa nem dá para procurar arquivo: isso é falha da
        // tela, não "despesa sem anexo" — avisa como erro para não passar batido.
        toastError('PDF gerado SEM comprovantes: as despesas de origem não foram localizadas.')
      } else {
        success('PDF gerado (as despesas não têm comprovante cadastrado).')
      }
    } catch (e) {
      console.error(e)
      toastError('Erro ao montar o PDF com os comprovantes.')
    } finally {
      setMontando(false)
    }
  }

  // Comprovantes da nota: lista e arquivos, baixados uma vez só mesmo quando
  // saem várias notas (rateio).
  const carregarComprovantes = async () => {
    if (!data) return null
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { toastError('Sessão expirada.'); return null }
    const ids = (data.despesaIds || []).filter(Boolean)
    let anexos: AnexoDespesa[] = []
    if (ids.length > 0) {
      const { data: lista, error } = await supabase.rpc('get_anexos_das_despesas', {
        p_user_id: session.user.id,
        p_despesa_ids: ids,
      })
      if (error) { toastError(error.message || 'Erro ao listar os comprovantes'); return null }
      anexos = (Array.isArray(lista) ? lista : []) as AnexoDespesa[]
    }
    const cache = new Map<string, Promise<{ base64: string; mime: string | null } | null>>()
    const baixarAnexo = (kind: 'primario' | 'extra', id: string) => {
      const chave = `${kind}:${id}`
      if (!cache.has(chave)) {
        cache.set(chave, (async () => {
          const resp = await fetch(
            `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-despesa-arquivo?kind=${kind}&id=${id}`,
            { headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' } },
          )
          const payload = await resp.json().catch(() => ({}))
          if (!resp.ok || !payload.arquivo_base64) return null
          return { base64: payload.arquivo_base64 as string, mime: (payload.mime_type as string) ?? null }
        })())
      }
      return cache.get(chave)!
    }
    return { anexos, baixarAnexo, ids }
  }

  // Rateio das despesas (Filipe 29/10): uma nota por pagador, cada uma com o
  // nº dela (a numeração separa por pagador), baixadas e registradas juntas.
  const baixarRateio = async (pagadores: NonNullable<NotaDespesaData['rateioPagadores']>) => {
    if (!data || !onGeradoRateio) return
    const comprovantes = await carregarComprovantes()
    if (!comprovantes) return
    const notas: NotaDebitoGerada[] = []
    let naoAnexados = 0
    for (const p of pagadores) {
      let numeroDocumento: number | null = null
      if (reservarNumero) {
        try {
          numeroDocumento = await reservarNumero(p.clienteId)
        } catch (e) {
          toastError(e instanceof Error ? e.message : 'Não foi possível numerar a nota de débito.')
          return
        }
      }
      const dataPdf: NotaDespesaData = {
        ...data,
        ...(vencimentoValido ? { vencimento: vencimentoValido } : {}),
        clienteNome: p.nome,
        clienteDocumento: null,
        clienteEndereco: null,
        documentoNumero: numeroDocumento ? String(numeroDocumento) : null,
        parte: { nome: p.nome, percentual: p.percentual, valor: p.valor },
      }
      const r = await montarNotaComComprovantes({ data: dataPdf, anexos: comprovantes.anexos, baixarAnexo: comprovantes.baixarAnexo })
      naoAnexados = Math.max(naoAnexados, r.naoAnexados.length)
      const nomeArquivo = `nota-de-debito-${numeroDocumento ? `n${numeroDocumento}-` : ''}${p.nome.replace(/[^\w]+/g, '-').toLowerCase()}.pdf`
      const blob = new Blob([r.bytes as BlobPart], { type: 'application/pdf' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = nomeArquivo
      a.click()
      URL.revokeObjectURL(a.href)
      notas.push({ bytes: r.bytes, nomeArquivo, numeroDocumento, pagadorClienteId: p.clienteId, percentual: p.percentual, valor: p.valor })
    }
    try {
      await onGeradoRateio(notas, vencimentoValido)
    } catch (e) {
      console.error('registrar notas de débito do rateio', e)
      toastError(e instanceof Error ? e.message : 'Os PDFs foram baixados, mas não foi possível registrá-los no kit.')
      return
    }
    if (naoAnexados > 0) toastError(`${naoAnexados} comprovante(s) não puderam ser anexados — veja a última página de cada nota.`)
    else if (comprovantes.ids.length === 0) toastError('Notas geradas SEM comprovantes: as despesas de origem não foram localizadas.')
  }

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
        {despesasSemOrigem > 0 ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {despesasSemOrigem === data?.itens.length
              ? 'Não foi possível localizar as despesas de origem: o PDF sai sem comprovantes. Feche e tente de novo; se persistir, baixe os arquivos pela tela de Despesas.'
              : `${despesasSemOrigem} de ${data?.itens.length} despesa(s) sem origem localizada — o PDF sai só com os comprovantes das demais.`}
          </p>
        ) : null}
        {data?.rateioPagadores && data.rateioPagadores.length > 1 ? (
          <p className="rounded-md border border-hairline bg-canvas-soft px-3 py-2 text-sm text-ink">
            Despesas divididas entre {data.rateioPagadores.length} pagadores: sai uma nota de débito para cada, com conta a receber e boleto próprios —{' '}
            {data.rateioPagadores.map((p) => `${p.nome} (${percentualBR(p.percentual)}, R$ ${money(p.valor)})`).join('; ')}.
          </p>
        ) : null}
        {data?.vencimentoEditavel ? (
          <div className="flex flex-wrap items-end gap-3 rounded-md border border-hairline bg-canvas-soft px-3 py-2 text-sm">
            <label className="space-y-1">
              <span className="block text-xs text-ink-mute">Vencimento do boleto</span>
              <input
                type="date"
                value={vencimentoEscolhido}
                onChange={(e) => setVencimentoEscolhido(e.target.value)}
                disabled={!podeEscolherVencimento || montando}
                className="rounded-md border px-2 py-1"
              />
            </label>
            <p className="max-w-md text-xs text-ink-mute">
              {data.vencimentoTravadoMotivo
                ? data.vencimentoTravadoMotivo
                : 'Vazio mantém a regra do caso (dia de pagamento ou 7 dias). A data escolhida sai na nota e na conta a receber ao baixar o PDF.'}
            </p>
          </div>
        ) : null}
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
          <Button variant="outline" onClick={() => void baixarComComprovantes()} disabled={montando}>
            {montando
              ? 'Montando PDF...'
              : data?.rateioPagadores && data.rateioPagadores.length > 1
                ? `Gerar ${data.rateioPagadores.length} notas com comprovantes (PDF)`
                : 'Baixar com comprovantes (PDF)'}
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
