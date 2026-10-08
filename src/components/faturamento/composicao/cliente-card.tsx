'use client'

import { useState } from 'react'
import {
  AlertTriangle,
  Banknote,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  FileStack,
  FileText,
  Loader2,
  Mail,
  Pencil,
  Printer,
  Receipt,
  RotateCcw,
  Undo2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils/cn'
import { formatContratoDisplay } from '@/lib/utils/contrato-display'
import { formatHorasMin } from '@/lib/utils/format-horas'
import { formatarLinhaDigitavel } from '@/lib/utils/boleto-ficha'
import {
  SITUACAO_INFO,
  STATUS_KIT_INFO,
  baseDoBoleto,
  boletoEmitido,
  dataBR,
  dataHoraBR,
  formatMoney,
  gruposParaNotaUnica,
  iniciaisCliente,
  kitComVariasNotas,
  kitSoDespesas,
  labelCaso,
  labelCompetencia,
  labelOrigem,
  labelRegra,
  nfseConjuntaViva,
  nfseEmitida,
  nfsesDoKit,
  progressoDoKit,
  situacaoDosKits,
  somarProgresso,
  type ClienteKits,
  type DocGerado,
  type DocNfsePagador,
  type KitCaso,
  type ProgressoKit,
} from './types'

/** Ações que o bloco do caso dispara; quem orquestra (a lista) implementa. */
export interface AcoesKit {
  /** Chave da ação em andamento ("<chave do kit>:<acao>") — trava o botão certo. */
  ocupado: string | null
  onEmitirNfse: (kit: KitCaso) => void
  /**
   * Nota única do contrato (Filipe 07/10, Charles Sturmer casos 1873 e 1877):
   * uma NFS-e para todos os kits do mesmo contrato+competência. Recebe os
   * kits que ela vai cobrir; quem orquestra abre a prévia sem caso_id.
   */
  onEmitirNotaUnica: (kits: KitCaso[]) => void
  onAbrirUrl: (url: string) => void
  /**
   * Sem `notaId`, o boleto do kit (como sempre). Com `notaId`, o boleto da
   * NFS-e daquele pagador — kit com rateio, uma nota por pagador (08/10).
   */
  onEmitirBoleto: (kit: KitCaso, notaId?: string) => void
  onVerBoleto: (boletoId: string) => void
  onCopiar: (texto: string, rotulo: string) => void
  onGerarRelatorio: (kit: KitCaso) => void
  onGerarNotaDebito: (kit: KitCaso) => void
  onEditarAjustes: (kit: KitCaso) => void
  onToggleRelatorio: (kit: KitCaso, valor: boolean) => void
  onEmail: (kit: KitCaso) => void
  /** "Devolver para revisão" (excluir_kit): os itens voltam para a etapa de aprovação, com a revisão preservada (Filipe 28/09). */
  onExcluir: (kit: KitCaso) => void
  /** Baixa manual do kit (finalizar_kit) — Filipe 24/09: o e-mail ainda vai pelo Gmail. */
  onFinalizar: (kit: KitCaso) => void
  onReabrir: (kit: KitCaso) => void
  /** Seleção em massa (6.1): chaves dos kits marcados. */
  selecionados: ReadonlySet<string>
  onSelecionar: (kit: KitCaso, marcar: boolean) => void
}

export const acaoKey = (kit: KitCaso, acao: string) => `${kit.chave}:${acao}`

// Cartão por CLIENTE (Filipe, 21/09, D13-a) com um bloco por caso dentro.
// O cabeçalho resume quanto do kit está montado (documentos emitidos sobre
// os necessários — progressoDoKit); a esteira status_kit fica no bloco do caso.
export default function ClienteCard({ cliente, acoes }: { cliente: ClienteKits; acoes: AcoesKit }) {
  const progresso = somarProgresso(cliente.casos)
  const situacao = SITUACAO_INFO[situacaoDosKits(cliente.casos)]
  // Contratos deste cliente com ≥ 2 casos a faturar no mesmo mês: oferece a
  // nota única (Filipe 07/10). Cada grupo vira um botão; a competência é a da
  // aba, então normalmente é um por contrato.
  const gruposNotaUnica = gruposParaNotaUnica(cliente.casos)
  return (
    <section className="flex flex-col overflow-hidden rounded-xl border border-hairline bg-white shadow-lift-1">
      <header className="border-b border-hairline bg-canvas-soft px-5 py-4">
        <div className="flex items-start gap-3">
          <div
            aria-hidden
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft-bg text-sm font-semibold text-primary-soft-fg"
          >
            {iniciaisCliente(cliente.nome)}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold text-ink" title={cliente.nome}>{cliente.nome}</h2>
            <p className="text-xs text-ink-mute">{cliente.kits} {cliente.kits === 1 ? 'kit' : 'kits'}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="text-base font-semibold font-tabular text-ink">{formatMoney(cliente.valor_total)}</span>
            <Badge className={situacao.badge}>{situacao.label}</Badge>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <BarraSegmentada progresso={progresso} />
          <span className="shrink-0 text-xs font-tabular text-ink-secondary">
            {progresso.emitidos}/{progresso.necessarios} · {progresso.pct}%
          </span>
        </div>
        {gruposNotaUnica.length ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {gruposNotaUnica.map((grupo) => {
              const primeiro = grupo[0]
              const chave = `${primeiro.contrato_id}|${primeiro.competencia}`
              const total = grupo.reduce((a, k) => a + Number(k.valor_servico || 0), 0)
              const ocupadoGrupo = acoes.ocupado === `nota-unica:${chave}`
              return (
                <Button
                  key={chave}
                  variant="outline"
                  size="sm"
                  onClick={() => acoes.onEmitirNotaUnica(grupo)}
                  disabled={!!acoes.ocupado}
                  title={`Uma NFS-e só para ${grupo.map((k) => labelCaso(k)).join(', ')} (${labelCompetencia(primeiro.competencia)}). O boleto sai sobre ela, um para todos os casos.`}
                >
                  {ocupadoGrupo ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FileStack className="mr-1.5 h-3.5 w-3.5" />}
                  Emitir nota única · {formatContratoDisplay(primeiro.contrato_numero, primeiro.contrato_nome).full}
                  <span className="ml-1 font-normal text-ink-mute">({grupo.length} casos · {formatMoney(total)})</span>
                </Button>
              )
            })}
          </div>
        ) : null}
      </header>
      <div className="divide-y divide-hairline">
        {cliente.casos.map((kit) => (
          <KitCasoBloco key={kit.chave} kit={kit} clienteNome={cliente.nome} acoes={acoes} />
        ))}
      </div>
    </section>
  )
}

/** Um segmento por documento necessário; verde os que já saíram. */
function BarraSegmentada({ progresso }: { progresso: ProgressoKit }) {
  if (progresso.necessarios === 0) {
    return <div className="h-2 flex-1 rounded-pill bg-hairline" />
  }
  return (
    <div
      className="flex flex-1 gap-0.5"
      role="progressbar"
      aria-valuenow={progresso.pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${progresso.emitidos} de ${progresso.necessarios} documentos emitidos`}
    >
      {progresso.segmentos.map((emitido, i) => (
        <div
          key={i}
          className={cn(
            'h-2 flex-1 first:rounded-l-pill last:rounded-r-pill transition-colors',
            emitido ? 'bg-emerald-500' : 'bg-hairline',
          )}
        />
      ))}
    </div>
  )
}

/** Stepper das 4 etapas do kit (mock do Filipe, 24/09): NF · Boleto · Timesheet · Despesas. */
function StepperKit({ progresso }: { progresso: ProgressoKit }) {
  const pendentes = progresso.necessarios - progresso.emitidos
  return (
    <div className="mt-3">
      <div className="flex items-center gap-3">
        <ol
          className="flex flex-1 items-center gap-1"
          aria-label={`${progresso.emitidos} de ${progresso.necessarios} documentos emitidos`}
        >
          {progresso.etapas.map((etapa, i) => (
            <li key={etapa.rotulo} className="flex min-w-0 flex-1 items-center gap-1">
              {i > 0 ? (
                <span
                  aria-hidden
                  className={cn('h-0.5 w-3 shrink-0 rounded-pill sm:w-5', etapa.necessaria && etapa.emitida ? 'bg-emerald-500' : 'bg-hairline')}
                />
              ) : null}
              <span
                className={cn(
                  'flex items-center gap-1 rounded-pill border px-2 py-0.5 text-[11px] font-medium transition-colors',
                  !etapa.necessaria
                    ? 'border-dashed border-hairline text-ink-mute/60'
                    : etapa.emitida
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                      : 'border-amber-200 bg-amber-50 text-amber-800',
                )}
                title={
                  !etapa.necessaria
                    ? `${etapa.rotulo}: não se aplica a este kit`
                    : etapa.emitida
                      ? `${etapa.rotulo}: emitido`
                      : `${etapa.rotulo}: pendente`
                }
              >
                {etapa.necessaria && etapa.emitida ? <Check className="h-3 w-3" /> : null}
                {etapa.rotulo}
              </span>
            </li>
          ))}
        </ol>
        <span className="shrink-0 text-xs font-tabular text-ink-secondary">
          {progresso.emitidos}/{progresso.necessarios} · {progresso.pct}%
        </span>
      </div>
      <p className={cn('mt-1 text-xs font-medium', pendentes > 0 ? 'text-orange-600' : 'text-emerald-700')}>
        {pendentes > 0
          ? `${pendentes} ${pendentes === 1 ? 'documento pendente' : 'documentos pendentes'}`
          : 'Todos os documentos emitidos'}
      </p>
    </div>
  )
}

function KitCasoBloco({ kit, clienteNome, acoes }: { kit: KitCaso; clienteNome: string; acoes: AcoesKit }) {
  const info = STATUS_KIT_INFO[kit.status_kit]
  const docs = kit.documentos
  const nfse = docs.nfse
  // Relatório sempre que há horas (Filipe 24/09, 6.2): a RPC soma todos os
  // lançamentos, inclusive os de valor 0 em casos mensais/projeto.
  const temHoras = kit.horas > 0 || kit.itens.some((i) => i.origem_tipo === 'timesheet')
  const temDespesa = kit.valor_despesa > 0 || kit.itens.some((i) => i.origem_tipo === 'despesa')
  const nfseViva = !!nfse && nfse.status === 'gerado'
  const nfseAutorizada = nfseViva && nfse.focus_status === 'autorizado'
  // NFS-e conjunta do contrato (07/10): este kit não emite outra nem sai
  // sozinho da composição; o boleto é o da nota conjunta, um para todos.
  const nfConjunta = nfseConjuntaViva(kit)
  // Kit só de despesas (07/10, Elizir caso 360): o boleto sai sobre a conta a
  // receber que a nota de débito cria — sem NFS-e. Com a RPC antiga
  // (boleto_base ausente) o kit continua preso à NFS-e, como antes.
  const soDespesas = kitSoDespesas(kit)
  const baseBoleto = baseDoBoleto(kit)
  const boletoPelaNotaDebito = baseBoleto === 'nota_debito' && !!docs.nota_debito
  const podeEmitirBoleto = baseBoleto === 'nfse' ? nfseAutorizada : boletoPelaNotaDebito
  const contaDaNotaDebito = boletoPelaNotaDebito && docs.nota_debito?.lancamento_id ? kit.conta_receber : null
  const bloqueioDevolver = !kit.pode_excluir
    ? (kit.motivo_bloqueio ?? 'Kit bloqueado')
    : nfConjunta
      ? 'NFS-e conjunta com outros casos'
      : null
  const contratoLabel = formatContratoDisplay(kit.contrato_numero, kit.contrato_nome).full
  const ocupado = (acao: string) => acoes.ocupado === acaoKey(kit, acao)
  const enviadoOk = !!kit.envio && !kit.envio.erro
  const progresso = progressoDoKit(kit)
  const pendentes = progresso.necessarios - progresso.emitidos
  const lancamentosTs = kit.lancamentos_timesheet ?? kit.itens.filter((i) => i.origem_tipo === 'timesheet').length
  const finalizado = kit.finalizado
  const selecionado = acoes.selecionados.has(kit.chave)
  // Rateio já emitido (Filipe 08/10, caso 318): uma NFS-e e um boleto por
  // pagador no lugar das linhas únicas. Com 0 ou 1 nota, tudo como antes.
  const variasNotas = kitComVariasNotas(kit)

  return (
    <div
      className={cn(
        'border-l-4 px-5 py-4 transition-colors',
        info.borda,
        finalizado && 'bg-green-50/40',
        selecionado && 'bg-primary-soft-bg/40',
      )}
    >
      {/* Cabeçalho do caso */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0 accent-primary disabled:cursor-not-allowed"
            checked={selecionado}
            disabled={!!bloqueioDevolver}
            title={bloqueioDevolver ?? 'Selecionar este kit'}
            aria-label={`Selecionar o kit de ${labelCaso(kit)}`}
            onChange={(e) => acoes.onSelecionar(kit, e.target.checked)}
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-ink">{labelCaso(kit)}</h3>
              <Badge className={info.badge}>
                {finalizado ? <CheckCircle2 className="mr-1 h-3 w-3" /> : null}
                {info.label}
              </Badge>
            </div>
            <p className="mt-0.5 text-xs text-ink-mute">
              {contratoLabel} · {labelRegra(kit.regra_cobranca)} · {labelCompetencia(kit.competencia)}
            </p>
          </div>
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

      <StepperKit progresso={progresso} />

      {/* Impostos e pagadores (D14-b): editáveis enquanto a NFS-e não saiu.
          Desde 25/09 o ajuste vale por padrão só para este kit (finance.kits.ajustes). */}
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
        {kit.ajustes_do_kit || kit.ajustes_kit ? (
          <Badge
            className="border-violet-200 bg-violet-50 text-violet-800"
            title="Impostos/pagadores ajustados só para este faturamento; o cadastro do caso não mudou."
          >
            ajustado neste kit
          </Badge>
        ) : null}
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
      <div className="mt-3 divide-y divide-hairline rounded-lg border border-hairline">
        {variasNotas ? (
          nfsesDoKit(kit).map((nota) => (
            <DocumentosDoPagador key={nota.id} kit={kit} nota={nota} acoes={acoes} />
          ))
        ) : (
          <>
            {/* 1. NFS-e */}
            <DocumentoLinha
              icon={<FileText className="h-4 w-4" />}
              titulo="NFS-e"
              status={
                !nfse || nfse.status !== 'gerado'
                  ? nfse
                    ? { tipo: 'pendente', badge: 'Cancelada', explicacao: 'A nota anterior foi cancelada — emita de novo.' }
                    : soDespesas
                      ? { tipo: 'pendente', badge: 'Não se aplica', explicacao: 'Kit só de despesas — não há serviço a faturar; o boleto sai sobre a nota de débito.' }
                      : { tipo: 'pendente', badge: 'Pendente', explicacao: 'Emita a nota fiscal na prefeitura — o boleto é gerado sobre ela.' }
                  : nfse.focus_status === 'autorizado'
                    ? { tipo: 'ok', badge: nfse.nfse_numero ? `NFS-e nº ${nfse.nfse_numero}` : 'Emitida', explicacao: `Autorizada em ${dataHoraBR(nfse.created_at)}${nfConjunta ? ' · uma nota para os casos do contrato' : ''}` }
                    : nfse.focus_status === 'processando'
                      ? { tipo: 'andamento', badge: 'Processando', explicacao: 'Em processamento na prefeitura — o PDF aparece quando autorizar.' }
                      : { tipo: 'erro', badge: 'Erro', explicacao: `Erro na emissão (${nfse.focus_status ?? 'sem status'}) — emita de novo.` }
              }
              extra={
                nfConjunta ? (
                  <Badge
                    className="border-indigo-200 bg-indigo-50 text-indigo-800"
                    title="Esta NFS-e cobre mais de um caso do contrato. O boleto é um só, sobre ela; para devolver este kit, cancele a nota em Notas geradas."
                  >
                    NF conjunta
                  </Badge>
                ) : null
              }
              valor={nfse?.valor_total ?? kit.valor_servico}
              acoes={
                nfseEmitida(nfse) ? (
                  nfse?.arquivo_url ? (
                    <Button variant="outline" size="sm" onClick={() => acoes.onAbrirUrl(nfse.arquivo_url!)}>
                      <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Abrir
                    </Button>
                  ) : (
                    <span className="text-xs text-ink-mute">Aguardando PDF</span>
                  )
                ) : nfConjunta ? (
                  // Nota conjunta com erro/sem status: quem resolve é a nota, em Notas geradas.
                  <span className="text-xs text-ink-mute">Nota conjunta do contrato</span>
                ) : (
                  <Button size="sm" onClick={() => acoes.onEmitirNfse(kit)} disabled={ocupado('nfse') || kit.valor_servico <= 0}>
                    {ocupado('nfse') ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                    Emitir
                  </Button>
                )
              }
            />

            {/* 2. Boleto — sai em cima da conta a receber: a da NFS-e autorizada ou,
                num kit só de despesas, a que a nota de débito criou (07/10). */}
            <DocumentoLinha
              icon={<Banknote className="h-4 w-4" />}
              titulo="Boleto"
              status={
                docs.boleto
                  ? docs.boleto.status === 'erro'
                    ? { tipo: 'erro', badge: 'Erro', explicacao: 'Erro no registro no Itaú — emita de novo.' }
                    : ['cancelado', 'baixado'].includes(docs.boleto.status)
                      ? { tipo: 'pendente', badge: 'Pendente', explicacao: `Boleto anterior ${docs.boleto.status} — emita de novo.` }
                      : ['pago', 'liquidado'].includes(docs.boleto.status)
                        ? { tipo: 'ok', badge: docs.boleto.nosso_numero ? `Boleto nº ${docs.boleto.nosso_numero}` : 'Pago', explicacao: `Pago · vencia ${dataBR(docs.boleto.vencimento)}` }
                        : { tipo: 'ok', badge: docs.boleto.nosso_numero ? `Boleto nº ${docs.boleto.nosso_numero}` : 'Emitido', explicacao: `Registrado no Itaú · vence ${dataBR(docs.boleto.vencimento)}${nfConjunta ? ' · um boleto para os casos da nota conjunta' : boletoPelaNotaDebito ? ' · sobre a nota de débito' : ''}` }
                  : boletoPelaNotaDebito
                    ? { tipo: 'pendente', badge: 'Pendente', explicacao: 'Boleto das despesas, sem nota fiscal — registra o título no Itaú sobre a conta da nota de débito.' }
                    : nfseAutorizada
                      ? { tipo: 'pendente', badge: 'Pendente', explicacao: nfConjunta ? 'Registra o título no Itaú sobre a nota conjunta — um boleto para todos os casos dela.' : 'Registra o título no Itaú sobre a conta a receber da nota.' }
                      : soDespesas && kit.boleto_base !== undefined
                        ? { tipo: 'pendente', badge: 'Pendente', explicacao: 'Gere a nota de débito primeiro — o boleto das despesas é gerado sobre ela.' }
                        : { tipo: 'pendente', badge: 'Pendente', explicacao: 'Emita a nota fiscal primeiro — o boleto é gerado sobre ela.' }
              }
              valor={docs.boleto?.valor ?? kit.conta_receber?.valor ?? null}
              acoes={
                boletoEmitido(docs.boleto) ? (
                  <>
                    <Button variant="outline" size="sm" onClick={() => acoes.onVerBoleto(docs.boleto!.id)}>
                      <Printer className="mr-1.5 h-3.5 w-3.5" /> Ver ficha
                    </Button>
                    {docs.boleto!.linha_digitavel ? (
                      <Button variant="ghost" size="sm" onClick={() => acoes.onCopiar(docs.boleto!.linha_digitavel!, 'Linha digitável')}>
                        <Copy className="mr-1.5 h-3.5 w-3.5" /> Copiar linha
                      </Button>
                    ) : null}
                    {docs.boleto!.pix_emv ? (
                      <Button variant="ghost" size="sm" onClick={() => acoes.onCopiar(docs.boleto!.pix_emv!, 'Pix copia e cola')}>
                        <Copy className="mr-1.5 h-3.5 w-3.5" /> Copiar Pix
                      </Button>
                    ) : null}
                  </>
                ) : (
                  <Button size="sm" onClick={() => acoes.onEmitirBoleto(kit)} disabled={!podeEmitirBoleto || ocupado('boleto')}>
                    {ocupado('boleto') ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                    Emitir
                  </Button>
                )
              }
              rodape={
                docs.boleto?.linha_digitavel && boletoEmitido(docs.boleto) ? (
                  <code className="rounded border border-hairline bg-canvas-soft px-2 py-0.5 font-mono text-[11px] text-ink">
                    {formatarLinhaDigitavel(docs.boleto.linha_digitavel)}
                  </code>
                ) : null
              }
            />
          </>
        )}

        {/* 3. Relatório de timesheet — só quando há horas. */}
        {temHoras ? (
          <DocumentoLinha
            icon={<Clock className="h-4 w-4" />}
            titulo="Relatório de timesheet"
            status={statusDocGerado(docs.relatorio_timesheet, `${formatHorasMin(kit.horas)} em ${lancamentosTs} lançamento(s)`)}
            // Filipe 28/09: "é importante ter a info na tela de que originalmente
            // aquele caso precisa enviar o relatório" — o toggle acima continua
            // valendo; o badge só espelha a configuração na própria linha.
            extra={
              kit.caso_id ? (
                kit.enviar_relatorio_timesheet ? (
                  <Badge className="border-emerald-200 bg-emerald-50 text-emerald-800" title="O caso está configurado para enviar o relatório de timesheet junto com a nota.">
                    Cliente recebe relatório
                  </Badge>
                ) : (
                  <Badge className="border-hairline bg-canvas-soft text-ink-mute" title="O caso está configurado para NÃO enviar o relatório de timesheet no e-mail.">
                    Não vai no e-mail
                  </Badge>
                )
              ) : null
            }
            valor={null}
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

        {/* 4. Despesas (nota de débito) — só quando há despesa reembolsável. */}
        {temDespesa ? (
          <DocumentoLinha
            icon={<Receipt className="h-4 w-4" />}
            titulo="Despesas"
            status={
              docs.nota_debito
                ? statusDocGerado(
                    docs.nota_debito,
                    'Nota de débito',
                    // Kit só de despesas (07/10): a nota de débito criou a conta a receber do boleto.
                    contaDaNotaDebito
                      ? `conta a receber criada · vence ${dataBR(contaDaNotaDebito.vencimento)}`
                      : docs.nota_debito.lancamento_id
                        ? 'conta a receber criada'
                        : null,
                  )
                : {
                    tipo: 'pendente',
                    badge: 'Pendente',
                    explicacao: soDespesas && kit.boleto_base !== undefined
                      ? 'Despesas reembolsáveis do período (nota de débito) — ao gerar, cria a conta a receber do boleto.'
                      : 'Despesas reembolsáveis do período (nota de débito).',
                  }
            }
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

      {/* Rodapé: envio, baixa e ações do kit */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 text-xs">
          {finalizado ? (
            <p className="font-medium text-green-800">
              <CheckCircle2 className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />
              Finalizado em {dataHoraBR(finalizado.em)}
              {finalizado.por_nome ? ` por ${finalizado.por_nome}` : ''}
              {finalizado.obs ? ` — ${finalizado.obs}` : ''}
            </p>
          ) : null}
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
          {/* Mesmo botão de sempre: abre a prévia do e-mail. O rótulo diz o que
              vai junto — só o que já foi emitido. */}
          <Button
            variant={enviadoOk ? 'outline' : 'default'}
            size="sm"
            onClick={() => acoes.onEmail(kit)}
            disabled={ocupado('email')}
            title={
              pendentes > 0
                ? `Pré-visualizar o e-mail com o que já está pronto (faltam ${pendentes} documento(s)). Nada é enviado sem confirmar.`
                : 'Pré-visualizar o e-mail com o kit completo. Nada é enviado sem confirmar.'
            }
          >
            {ocupado('email') ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Mail className="mr-1.5 h-3.5 w-3.5" />}
            {enviadoOk ? 'Reenviar e-mail' : pendentes > 0 ? 'Enviar o que está pronto' : 'Enviar kit'}
          </Button>
          {/* Finalizar = baixa manual (Filipe 24/09). As ações de emitir continuam
              disponíveis num kit finalizado; "Reabrir" só zera a baixa. */}
          {finalizado ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => acoes.onReabrir(kit)}
              disabled={ocupado('finalizar')}
              title="Desfaz a baixa manual; nada é apagado"
            >
              {ocupado('finalizar') ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="mr-1.5 h-3.5 w-3.5" />}
              Reabrir
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => acoes.onFinalizar(kit)}
              disabled={ocupado('finalizar')}
              className="bg-green-700 text-white hover:bg-green-800"
              title="Dá baixa manual no kit (o e-mail ao cliente vai por fora). Os documentos continuam podendo ser emitidos."
            >
              {ocupado('finalizar') ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}
              Finalizar faturamento
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => acoes.onExcluir(kit)}
            disabled={!!bloqueioDevolver || ocupado('excluir')}
            title={bloqueioDevolver ?? 'Devolve os itens para a revisão (nada é apagado)'}
            className="text-ink-mute hover:text-destructive"
          >
            {ocupado('excluir') ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Undo2 className="mr-1.5 h-3.5 w-3.5" />}
            Devolver para revisão
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * NFS-e e boleto de UM pagador num kit com rateio (uma nota por pagador).
 * Mesmo comportamento das linhas únicas: abrir a nota; emitir, ver ficha,
 * copiar linha e Pix do boleto daquela nota.
 */
function DocumentosDoPagador({ kit, nota, acoes }: { kit: KitCaso; nota: DocNfsePagador; acoes: AcoesKit }) {
  const pagador = nota.pagador?.nome?.trim() || 'Pagador'
  const autorizada = nota.status === 'gerado' && nota.focus_status === 'autorizado'
  const boleto = nota.boleto
  const ocupadoBoleto = acoes.ocupado === acaoKey(kit, `boleto:${nota.id}`)
  const numero = nota.nfse_numero ?? (nota.numero != null ? String(nota.numero) : null)
  return (
    <>
      <DocumentoLinha
        icon={<FileText className="h-4 w-4" />}
        titulo={`NFS-e${numero ? ` nº ${numero}` : ''} · ${pagador}`}
        status={
          autorizada
            ? { tipo: 'ok', badge: 'Autorizada', explicacao: `Nota de ${pagador} · uma NFS-e por pagador (rateio)` }
            : nota.focus_status === 'processando'
              ? { tipo: 'andamento', badge: 'Processando', explicacao: 'Em processamento na prefeitura — o PDF aparece quando autorizar.' }
              : { tipo: 'erro', badge: 'Erro', explicacao: `Situação na prefeitura: ${nota.focus_status ?? 'sem status'}.` }
        }
        valor={nota.valor_total}
        acoes={
          nota.arquivo_url ? (
            <Button variant="outline" size="sm" onClick={() => acoes.onAbrirUrl(nota.arquivo_url!)}>
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Abrir
            </Button>
          ) : (
            <span className="text-xs text-ink-mute">Aguardando PDF</span>
          )
        }
      />
      <DocumentoLinha
        icon={<Banknote className="h-4 w-4" />}
        titulo={`Boleto · ${pagador}`}
        status={
          boleto
            ? boleto.status === 'erro'
              ? { tipo: 'erro', badge: 'Erro', explicacao: 'Erro no registro no Itaú — emita de novo.' }
              : ['cancelado', 'baixado'].includes(boleto.status)
                ? { tipo: 'pendente', badge: 'Pendente', explicacao: `Boleto anterior ${boleto.status} — emita de novo.` }
                : ['pago', 'liquidado'].includes(boleto.status)
                  ? { tipo: 'ok', badge: boleto.nosso_numero ? `Boleto nº ${boleto.nosso_numero}` : 'Pago', explicacao: `Pago · vencia ${dataBR(boleto.vencimento)}` }
                  : { tipo: 'ok', badge: boleto.nosso_numero ? `Boleto nº ${boleto.nosso_numero}` : 'Emitido', explicacao: `Registrado no Itaú · vence ${dataBR(boleto.vencimento)} · em nome de ${pagador}` }
            : autorizada
              ? { tipo: 'pendente', badge: 'Pendente', explicacao: `Registra o título no Itaú sobre a conta a receber da nota de ${pagador}.` }
              : { tipo: 'pendente', badge: 'Pendente', explicacao: 'A nota ainda não foi autorizada — o boleto é gerado sobre ela.' }
        }
        valor={boleto?.valor ?? nota.conta_receber?.valor ?? null}
        acoes={
          boletoEmitido(boleto) ? (
            <>
              <Button variant="outline" size="sm" onClick={() => acoes.onVerBoleto(boleto!.id)}>
                <Printer className="mr-1.5 h-3.5 w-3.5" /> Ver ficha
              </Button>
              {boleto!.linha_digitavel ? (
                <Button variant="ghost" size="sm" onClick={() => acoes.onCopiar(boleto!.linha_digitavel!, 'Linha digitável')}>
                  <Copy className="mr-1.5 h-3.5 w-3.5" /> Copiar linha
                </Button>
              ) : null}
              {boleto!.pix_emv ? (
                <Button variant="ghost" size="sm" onClick={() => acoes.onCopiar(boleto!.pix_emv!, 'Pix copia e cola')}>
                  <Copy className="mr-1.5 h-3.5 w-3.5" /> Copiar Pix
                </Button>
              ) : null}
            </>
          ) : (
            <Button size="sm" onClick={() => acoes.onEmitirBoleto(kit, nota.id)} disabled={!autorizada || ocupadoBoleto}>
              {ocupadoBoleto ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              Emitir
            </Button>
          )
        }
        rodape={
          boleto?.linha_digitavel && boletoEmitido(boleto) ? (
            <code className="rounded border border-hairline bg-canvas-soft px-2 py-0.5 font-mono text-[11px] text-ink">
              {formatarLinhaDigitavel(boleto.linha_digitavel)}
            </code>
          ) : null
        }
      />
    </>
  )
}

function statusDocGerado(doc: DocGerado | null, resumo: string, complemento: string | null = null): StatusDoc {
  if (!doc) return { tipo: 'pendente', badge: 'Pendente', explicacao: resumo }
  return {
    tipo: 'ok',
    badge: 'Emitido',
    explicacao: `${resumo} · gerado em ${dataHoraBR(doc.gerado_em)}${doc.gerado_por ? ` por ${doc.gerado_por}` : ''}${complemento ? ` · ${complemento}` : ''}`,
  }
}

interface StatusDoc {
  tipo: 'pendente' | 'andamento' | 'ok' | 'erro'
  /** Texto curto do badge (PENDENTE, EMITIDO, NFS-e nº…). */
  badge: string
  /** Uma linha de explicação embaixo do título. */
  explicacao: string
}

const STATUS_DOC_CLASS: Record<StatusDoc['tipo'], { badge: string; icone: string }> = {
  pendente: { badge: 'border-amber-200 bg-amber-50 text-amber-800', icone: 'bg-amber-50 text-amber-600' },
  andamento: { badge: 'border-blue-200 bg-blue-50 text-blue-800', icone: 'bg-blue-50 text-blue-600' },
  ok: { badge: 'border-emerald-200 bg-emerald-50 text-emerald-800', icone: 'bg-emerald-50 text-emerald-600' },
  erro: { badge: 'border-red-200 bg-red-50 text-red-800', icone: 'bg-red-50 text-red-600' },
}

function DocumentoLinha({
  icon,
  titulo,
  status,
  extra,
  valor,
  acoes,
  rodape,
}: {
  icon: React.ReactNode
  titulo: string
  status: StatusDoc
  /** Badge adicional ao lado do status (ex.: se o relatório vai no e-mail). */
  extra?: React.ReactNode
  valor: number | null
  acoes: React.ReactNode
  rodape?: React.ReactNode
}) {
  const classes = STATUS_DOC_CLASS[status.tipo]
  return (
    <div className="px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-md', classes.icone)}>{icon}</span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-ink">{titulo}</span>
              <Badge className={classes.badge}>
                {status.tipo === 'erro' ? <AlertTriangle className="mr-1 h-3 w-3" /> : null}
                {status.badge}
              </Badge>
              {extra}
            </div>
            <p className="text-xs text-ink-mute">{status.explicacao}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {valor != null && valor > 0 ? <span className="mr-1 text-sm font-tabular text-ink">{formatMoney(valor)}</span> : null}
          {acoes}
        </div>
      </div>
      {rodape ? <div className="mt-1.5 pl-11">{rodape}</div> : null}
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
        <div className="mt-1.5 overflow-x-auto rounded-md border border-hairline">
          <table className="w-full text-xs">
            <thead className="bg-canvas-soft text-left text-[11px] uppercase tracking-wide text-ink-mute">
              <tr>
                <th className="px-2 py-1.5 font-medium">Origem</th>
                <th className="px-2 py-1.5 font-medium">Descrição</th>
                <th className="px-2 py-1.5 font-medium">Data</th>
                <th className="px-2 py-1.5 text-right font-medium">Horas</th>
                <th className="px-2 py-1.5 text-right font-medium">Valor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
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
