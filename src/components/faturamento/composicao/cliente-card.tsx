'use client'

import { useState } from 'react'
import {
  AlertTriangle,
  Banknote,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  FileText,
  Loader2,
  Mail,
  Pencil,
  Printer,
  Receipt,
  Trash2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils/cn'
import { formatContratoDisplay } from '@/lib/utils/contrato-display'
import { formatHorasMin } from '@/lib/utils/format-horas'
import { formatarLinhaDigitavel } from '@/lib/utils/boleto-ficha'
import {
  STATUS_KIT_INFO,
  dataBR,
  dataHoraBR,
  formatMoney,
  labelCaso,
  labelCompetencia,
  labelOrigem,
  labelRegra,
  piorStatus,
  type ClienteKits,
  type DocGerado,
  type KitCaso,
} from './types'

/** Ações que o bloco do caso dispara; quem orquestra (a lista) implementa. */
export interface AcoesKit {
  /** Chave da ação em andamento ("<chave do kit>:<acao>") — trava o botão certo. */
  ocupado: string | null
  onEmitirNfse: (kit: KitCaso) => void
  onAbrirUrl: (url: string) => void
  onEmitirBoleto: (kit: KitCaso) => void
  onVerBoleto: (boletoId: string) => void
  onCopiar: (texto: string, rotulo: string) => void
  onGerarRelatorio: (kit: KitCaso) => void
  onGerarNotaDebito: (kit: KitCaso) => void
  onEditarAjustes: (kit: KitCaso) => void
  onToggleRelatorio: (kit: KitCaso, valor: boolean) => void
  onEmail: (kit: KitCaso) => void
  onExcluir: (kit: KitCaso) => void
}

export const acaoKey = (kit: KitCaso, acao: string) => `${kit.chave}:${acao}`

// Cartão por CLIENTE (Filipe, 21/09, D13-a) com um bloco por caso dentro.
export default function ClienteCard({ cliente, acoes }: { cliente: ClienteKits; acoes: AcoesKit }) {
  const pior = piorStatus(cliente.casos)
  const info = STATUS_KIT_INFO[pior]
  return (
    <section className={cn('overflow-hidden rounded-xl border-2 bg-white shadow-sm', info.bordaCard)}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-canvas-soft px-5 py-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-ink">{cliente.nome}</h2>
          <Badge className={info.badge}>{info.label}</Badge>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-ink-mute">{cliente.kits} {cliente.kits === 1 ? 'kit' : 'kits'}</span>
          <span className="text-base font-semibold font-tabular text-ink">{formatMoney(cliente.valor_total)}</span>
        </div>
      </header>
      <div className="divide-y">
        {cliente.casos.map((kit) => (
          <KitCasoBloco key={kit.chave} kit={kit} clienteNome={cliente.nome} acoes={acoes} />
        ))}
      </div>
    </section>
  )
}

function KitCasoBloco({ kit, clienteNome, acoes }: { kit: KitCaso; clienteNome: string; acoes: AcoesKit }) {
  const info = STATUS_KIT_INFO[kit.status_kit]
  const docs = kit.documentos
  const nfse = docs.nfse
  const temHoras = kit.itens.some((i) => i.origem_tipo === 'timesheet')
  const temDespesa = kit.itens.some((i) => i.origem_tipo === 'despesa')
  const nfseViva = !!nfse && nfse.status === 'gerado'
  const nfseAutorizada = nfseViva && nfse.focus_status === 'autorizado'
  const contratoLabel = formatContratoDisplay(kit.contrato_numero, kit.contrato_nome).full
  const ocupado = (acao: string) => acoes.ocupado === acaoKey(kit, acao)
  const enviadoOk = !!kit.envio && !kit.envio.erro

  return (
    <div className={cn('border-l-4 px-5 py-4', info.borda)}>
      {/* Cabeçalho do caso */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-ink">{labelCaso(kit)}</h3>
            <Badge className={info.badge}>{info.label}</Badge>
          </div>
          <p className="mt-0.5 text-xs text-ink-mute">
            {contratoLabel} · {labelRegra(kit.regra_cobranca)} · {labelCompetencia(kit.competencia)}
          </p>
        </div>
        <div className="text-right text-sm">
          <p className="font-semibold font-tabular text-ink">{formatMoney(kit.valor_total)}</p>
          <p className="text-xs text-ink-mute">
            {kit.horas > 0 ? `${formatHorasMin(kit.horas)} · ` : ''}
            serviço {formatMoney(kit.valor_servico)}
            {kit.valor_despesa > 0 ? ` · despesas ${formatMoney(kit.valor_despesa)}` : ''}
          </p>
        </div>
      </div>

      {/* Impostos e pagadores (D14-b): editáveis enquanto a NFS-e não saiu. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-secondary">
        <span>
          <span className="text-ink-mute">Impostos:</span>{' '}
          <strong className="font-medium text-ink">{kit.grupo_imposto?.nome ?? 'não definido'}</strong>
        </span>
        <span className="text-hairline">|</span>
        <span>
          <span className="text-ink-mute">Pagadores:</span>{' '}
          <strong className="font-medium text-ink">
            {kit.pagadores.length
              ? kit.pagadores.map((p) => `${p.nome ?? 'cliente'} ${Number(p.percentual).toFixed(0)}%`).join(', ')
              : clienteNome}
          </strong>
        </span>
        {nfseViva ? (
          <span className="text-ink-mute" title="A NFS-e já foi emitida com estes dados; para alterar, cancele-a em Notas geradas.">
            (definido na NF)
          </span>
        ) : (
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => acoes.onEditarAjustes(kit)}>
            <Pencil className="mr-1 h-3 w-3" /> Editar
          </Button>
        )}
      </div>

      {/* Relatório de timesheet vai no e-mail (D15-a): configuração do caso. */}
      {kit.caso_id ? (
        <label className="mt-2 flex w-fit cursor-pointer items-center gap-2 text-xs text-ink-secondary">
          <input
            type="checkbox"
            role="switch"
            aria-checked={kit.enviar_relatorio_timesheet}
            checked={kit.enviar_relatorio_timesheet}
            disabled={ocupado('toggle')}
            onChange={(e) => acoes.onToggleRelatorio(kit, e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          Relatório de timesheet vai no e-mail
          {ocupado('toggle') ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
        </label>
      ) : null}

      <ItensKit kit={kit} />

      {/* Documentos do kit */}
      <div className="mt-3 divide-y rounded-md border">
        {/* 1. NFS-e */}
        <DocumentoLinha
          icon={<FileText className="h-4 w-4" />}
          titulo="NFS-e"
          status={
            !nfse || nfse.status !== 'gerado'
              ? { tipo: 'pendente', texto: nfse ? 'Cancelada — emitir de novo' : 'Pendente' }
              : nfse.focus_status === 'autorizado'
                ? { tipo: 'ok', texto: `Autorizada${nfse.nfse_numero ? ` nº ${nfse.nfse_numero}` : ''} em ${dataHoraBR(nfse.created_at)}` }
                : nfse.focus_status === 'processando'
                  ? { tipo: 'andamento', texto: 'Em processamento na prefeitura' }
                  : { tipo: 'erro', texto: `Erro na emissão (${nfse.focus_status ?? 'sem status'}) — emitir de novo` }
          }
          valor={nfse?.valor_total ?? kit.valor_servico}
          acoes={
            nfseViva && (nfse.focus_status === 'autorizado' || nfse.focus_status === 'processando') ? (
              nfse.arquivo_url ? (
                <Button variant="outline" size="sm" onClick={() => acoes.onAbrirUrl(nfse.arquivo_url!)}>
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Abrir
                </Button>
              ) : (
                <span className="text-xs text-ink-mute">PDF aparece quando a prefeitura autorizar</span>
              )
            ) : (
              <Button size="sm" onClick={() => acoes.onEmitirNfse(kit)} disabled={ocupado('nfse') || kit.valor_servico <= 0}>
                {ocupado('nfse') ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                Emitir
              </Button>
            )
          }
        />

        {/* 2. Boleto — sai em cima da conta a receber, que só existe com a NF autorizada. */}
        <DocumentoLinha
          icon={<Banknote className="h-4 w-4" />}
          titulo="Boleto"
          status={
            docs.boleto
              ? docs.boleto.status === 'erro'
                ? { tipo: 'erro', texto: 'Erro no registro — emitir de novo' }
                : ['cancelado', 'baixado'].includes(docs.boleto.status)
                  ? { tipo: 'pendente', texto: `${docs.boleto.status} — emitir de novo` }
                  : ['pago', 'liquidado'].includes(docs.boleto.status)
                    ? { tipo: 'ok', texto: `Pago · vencia ${dataBR(docs.boleto.vencimento)}` }
                    : { tipo: 'ok', texto: `Registrado no Itaú · vence ${dataBR(docs.boleto.vencimento)}` }
              : nfseAutorizada
                ? { tipo: 'pendente', texto: 'Pendente — registra o título no Itaú' }
                : { tipo: 'pendente', texto: 'Aguarda a NFS-e autorizada' }
          }
          valor={docs.boleto?.valor ?? kit.conta_receber?.valor ?? null}
          acoes={
            docs.boleto && !['erro', 'cancelado', 'baixado'].includes(docs.boleto.status) ? (
              <>
                <Button variant="outline" size="sm" onClick={() => acoes.onVerBoleto(docs.boleto!.id)}>
                  <Printer className="mr-1.5 h-3.5 w-3.5" /> Ver ficha
                </Button>
                {docs.boleto.linha_digitavel ? (
                  <Button variant="ghost" size="sm" onClick={() => acoes.onCopiar(docs.boleto!.linha_digitavel!, 'Linha digitável')}>
                    <Copy className="mr-1.5 h-3.5 w-3.5" /> Copiar linha
                  </Button>
                ) : null}
                {docs.boleto.pix_emv ? (
                  <Button variant="ghost" size="sm" onClick={() => acoes.onCopiar(docs.boleto!.pix_emv!, 'Pix copia e cola')}>
                    <Copy className="mr-1.5 h-3.5 w-3.5" /> Copiar Pix
                  </Button>
                ) : null}
              </>
            ) : (
              <Button size="sm" onClick={() => acoes.onEmitirBoleto(kit)} disabled={!nfseAutorizada || ocupado('boleto')}>
                {ocupado('boleto') ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                Emitir
              </Button>
            )
          }
          rodape={
            docs.boleto?.linha_digitavel && !['erro', 'cancelado', 'baixado'].includes(docs.boleto.status) ? (
              <code className="rounded border bg-muted/40 px-2 py-0.5 font-mono text-[11px] text-ink">
                {formatarLinhaDigitavel(docs.boleto.linha_digitavel)}
              </code>
            ) : null
          }
        />

        {/* 3. Relatório de timesheet — só quando há horas. */}
        {temHoras ? (
          <DocumentoLinha
            icon={<Clock className="h-4 w-4" />}
            titulo="Relatório de timesheet"
            status={statusDocGerado(docs.relatorio_timesheet)}
            valor={null}
            descricao={`${formatHorasMin(kit.horas)} em ${kit.itens.filter((i) => i.origem_tipo === 'timesheet').length} lançamento(s)`}
            acoes={
              <>
                {docs.relatorio_timesheet?.arquivo_url ? (
                  <Button variant="outline" size="sm" onClick={() => acoes.onAbrirUrl(docs.relatorio_timesheet!.arquivo_url!)}>
                    <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Abrir
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant={docs.relatorio_timesheet ? 'ghost' : 'default'}
                  onClick={() => acoes.onGerarRelatorio(kit)}
                  disabled={ocupado('relatorio')}
                >
                  {ocupado('relatorio') ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                  {docs.relatorio_timesheet ? 'Gerar de novo' : 'Gerar'}
                </Button>
              </>
            }
          />
        ) : null}

        {/* 4. Nota de débito — só quando há despesa reembolsável. */}
        {temDespesa ? (
          <DocumentoLinha
            icon={<Receipt className="h-4 w-4" />}
            titulo="Nota de débito"
            status={statusDocGerado(docs.nota_debito)}
            valor={kit.valor_despesa}
            acoes={
              <>
                {docs.nota_debito?.arquivo_url ? (
                  <Button variant="outline" size="sm" onClick={() => acoes.onAbrirUrl(docs.nota_debito!.arquivo_url!)}>
                    <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Abrir
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant={docs.nota_debito ? 'ghost' : 'default'}
                  onClick={() => acoes.onGerarNotaDebito(kit)}
                  disabled={ocupado('nota')}
                >
                  {docs.nota_debito ? 'Gerar de novo' : 'Gerar'}
                </Button>
              </>
            }
          />
        ) : null}
      </div>

      {/* Rodapé: envio e ações do kit */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs">
          {kit.envio ? (
            <p className={kit.envio.erro ? 'text-destructive' : 'text-green-700'}>
              {kit.envio.erro ? '✕ Falhou o envio' : '✓ Enviada'} em {dataHoraBR(kit.envio.enviado_em)}
              {' para '}{kit.envio.destinatario}
              {kit.envio.por ? ` · por ${kit.envio.por}` : ''}
              {kit.envio.total > 1 ? ` · ${kit.envio.total} envios` : ''}
              {kit.envio.erro ? ` — ${kit.envio.erro}` : ''}
            </p>
          ) : (
            <p className="text-ink-mute">E-mail ainda não enviado.</p>
          )}
          {kit.conta_receber?.pago_em ? (
            <p className="text-emerald-800">Recebido em {dataBR(kit.conta_receber.pago_em)}.</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => acoes.onExcluir(kit)}
            disabled={!kit.pode_excluir || ocupado('excluir')}
            title={kit.pode_excluir ? 'Devolve os itens para a revisão' : (kit.motivo_bloqueio ?? 'Kit bloqueado')}
            className="text-destructive hover:text-destructive"
          >
            {ocupado('excluir') ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-1.5 h-3.5 w-3.5" />}
            Excluir este kit
          </Button>
          <Button variant={enviadoOk ? 'outline' : 'default'} size="sm" onClick={() => acoes.onEmail(kit)} disabled={ocupado('email')}>
            <Mail className="mr-1.5 h-3.5 w-3.5" />
            {enviadoOk ? 'Reenviar e-mail' : 'Pré-visualizar e-mail'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function statusDocGerado(doc: DocGerado | null): StatusDoc {
  if (!doc) return { tipo: 'pendente', texto: 'Não gerado' }
  return { tipo: 'ok', texto: `Gerado em ${dataHoraBR(doc.gerado_em)}${doc.gerado_por ? ` por ${doc.gerado_por}` : ''}` }
}

interface StatusDoc {
  tipo: 'pendente' | 'andamento' | 'ok' | 'erro'
  texto: string
}

const STATUS_DOC_CLASS: Record<StatusDoc['tipo'], string> = {
  pendente: 'border-amber-200 bg-amber-50 text-amber-800',
  andamento: 'border-blue-200 bg-blue-50 text-blue-800',
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  erro: 'border-red-200 bg-red-50 text-red-800',
}

function DocumentoLinha({
  icon,
  titulo,
  status,
  descricao,
  valor,
  acoes,
  rodape,
}: {
  icon: React.ReactNode
  titulo: string
  status: StatusDoc
  descricao?: string
  valor: number | null
  acoes: React.ReactNode
  rodape?: React.ReactNode
}) {
  return (
    <div className="px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="text-ink-mute">{icon}</span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-ink">{titulo}</span>
              <Badge className={STATUS_DOC_CLASS[status.tipo]}>{status.tipo === 'erro' ? <AlertTriangle className="mr-1 h-3 w-3" /> : null}{status.texto}</Badge>
            </div>
            {descricao ? <p className="text-xs text-ink-mute">{descricao}</p> : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {valor != null && valor > 0 ? <span className="mr-1 text-sm font-tabular text-ink">{formatMoney(valor)}</span> : null}
          {acoes}
        </div>
      </div>
      {rodape ? <div className="mt-1.5 pl-7">{rodape}</div> : null}
    </div>
  )
}

// Itens do kit, compactos e expansíveis: origem, descrição, data, horas, valor.
function ItensKit({ kit }: { kit: KitCaso }) {
  const [aberto, setAberto] = useState(false)
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="flex items-center gap-1 text-xs font-medium text-ink-secondary hover:text-ink"
      >
        {aberto ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        {kit.itens.length} {kit.itens.length === 1 ? 'item' : 'itens'} no kit
      </button>
      {aberto ? (
        <div className="mt-1.5 overflow-x-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-ink-mute">
              <tr>
                <th className="px-2 py-1.5 font-medium">Origem</th>
                <th className="px-2 py-1.5 font-medium">Descrição</th>
                <th className="px-2 py-1.5 font-medium">Data</th>
                <th className="px-2 py-1.5 text-right font-medium">Horas</th>
                <th className="px-2 py-1.5 text-right font-medium">Valor</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {kit.itens.map((item) => (
                <tr key={item.id} className={item.status === 'faturado' ? 'text-ink-mute' : ''}>
                  <td className="whitespace-nowrap px-2 py-1.5">
                    {labelOrigem(item.origem_tipo)}
                    {item.status === 'faturado' ? <span className="ml-1 text-[10px] uppercase">faturado</span> : null}
                  </td>
                  <td className="max-w-[420px] truncate px-2 py-1.5" title={item.descricao}>
                    {item.origem_tipo === 'timesheet' && item.linhas_timesheet.length > 1
                      ? `${item.linhas_timesheet.length} lançamentos · ${item.descricao}`
                      : item.origem_tipo === 'despesa' && item.despesa?.categoria
                        ? `${item.despesa.categoria} · ${item.descricao}`
                        : item.descricao}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5">{dataBR(item.despesa?.data ?? item.data_referencia)}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right font-tabular">{item.horas > 0 ? formatHorasMin(item.horas) : '—'}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right font-tabular">{formatMoney(item.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}
