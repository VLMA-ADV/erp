'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { formatContratoDisplay } from '@/lib/utils/contrato-display'
import { abrirFichaBoleto, copiarTexto } from '@/lib/utils/boleto-ficha'
import { gerarRelatorioTimesheetPdf, type TimesheetPdfRow } from '@/lib/utils/timesheet-report-pdf'
import { abrirDocumentoDoKit, gerarERegistrarDocumento } from '@/lib/faturamento/documentos-kit'
import NotaDespesaPreview, { type NotaDespesaData } from './nota-despesa-preview'
import FaturaEmailPreview, { type FaturaEmailData } from './fatura-email-preview'
import NfsePreviewDialog, { type AjustesDaNota } from './nfse-preview-dialog'
import BarraFiltros from './composicao/filtros-composicao'
import ResumoStatus from './composicao/resumo-status'
import ClienteCard, { acaoKey, type AcoesKit } from './composicao/cliente-card'
import AjustesKitDialog from './composicao/ajustes-kit-dialog'
import {
  FILTROS_VAZIOS,
  formatMoney,
  isoHoje,
  labelCaso,
  labelCompetencia,
  labelCompetenciaCurta,
  type ComposicaoPayload,
  type FiltrosComposicao,
  type KitCaso,
} from './composicao/types'

// "Composição da fatura": a Jéssica (financeiro) monta aqui o kit que vai ao
// cliente — NFS-e, boleto, relatório de timesheet e nota de débito — e manda
// por e-mail. Desde o lote C (Filipe, 21/09) o kit é por CASO e COMPETÊNCIA,
// vem pronto do banco (get_composicao_fatura) e cada documento gerado fica
// registrado: quem, quando, qual arquivo. A tela é só a mão que aperta os
// botões; o que é kit, o que bloqueia exclusão e o status de cada um é
// decidido na RPC, para a tela e o e-mail nunca discordarem.

const FUNCTIONS = () => `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1`

function competenciaCorrente() {
  return `${new Date().toISOString().slice(0, 7)}-01`
}

/** 'YYYY-MM-01' → 'YYYY-MM' (nome de arquivo). */
const anoMes = (competencia: string) => competencia.slice(0, 7)

interface CertificadoItau {
  configurado: boolean
  dias_restantes: number | null
  vence_em: string | null
  pode_renovar: boolean
  erro: string | null
}

export default function ComposicaoDaFaturaList() {
  const { toast: notify, success, error: toastError } = useToast()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [payload, setPayload] = useState<ComposicaoPayload | null>(null)
  const [filtros, setFiltros] = useState<FiltrosComposicao>(FILTROS_VAZIOS)
  const [busca, setBusca] = useState('')
  // "<chave do kit>:<ação>" em andamento — trava só o botão certo.
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [cert, setCert] = useState<CertificadoItau | null>(null)

  // Diálogos
  const [ajustesKit, setAjustesKit] = useState<KitCaso | null>(null)
  const [nfseKit, setNfseKit] = useState<KitCaso | null>(null)
  const [notaKit, setNotaKit] = useState<KitCaso | null>(null)
  const [notaData, setNotaData] = useState<NotaDespesaData | null>(null)
  const [emailKit, setEmailKit] = useState<KitCaso | null>(null)
  const [emailData, setEmailData] = useState<FaturaEmailData | null>(null)
  const [enviandoEmail, setEnviandoEmail] = useState(false)

  // A competência padrão só é conhecida depois da primeira resposta (a lista
  // de meses com kit vem da RPC). Primeira chamada sem filtro; se o mês
  // corrente existe, ele vira o padrão, senão o mais recente.
  const inicializado = useRef(false)
  const filtrosRef = useRef(filtros)
  filtrosRef.current = filtros

  const carregar = useCallback(async (f: FiltrosComposicao, opts: { silencioso?: boolean } = {}) => {
    if (!opts.silencioso) setLoading(true)
    setError(null)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setError('Sessão expirada. Entre de novo para continuar.'); return null }
      const { data, error: rpcErr } = await supabase.rpc('get_composicao_fatura', {
        p_user_id: user.id,
        p_competencia: f.competencia,
        p_cliente_id: f.clienteId,
        p_contrato_id: f.contratoId,
        p_caso_id: f.casoId,
        p_regra: f.regra,
        p_status_kit: f.statusKit,
      })
      if (rpcErr) { setError(rpcErr.message || 'Erro ao carregar a composição da fatura'); return null }
      const dados = data as ComposicaoPayload
      setPayload(dados)
      return dados
    } catch (err) {
      console.error(err)
      setError('Erro ao carregar a composição da fatura')
      return null
    } finally {
      if (!opts.silencioso) setLoading(false)
    }
  }, [])

  /** Recarrega com os filtros atuais sem piscar a tela (depois de uma ação). */
  const recarregar = useCallback(() => carregar(filtrosRef.current, { silencioso: true }), [carregar])

  useEffect(() => {
    if (inicializado.current) return
    inicializado.current = true
    void (async () => {
      const dados = await carregar(FILTROS_VAZIOS)
      const meses = dados?.opcoes.competencias ?? []
      const atual = competenciaCorrente()
      const padrao = meses.includes(atual) ? atual : meses[0] ?? null
      if (padrao) setFiltros((f) => ({ ...f, competencia: padrao }))

      // Certificado do Itaú: só interessa quando está perto de vencer.
      try {
        const rc = await fetch('/api/boletos/certificado')
        if (rc.ok) setCert(await rc.json())
      } catch {
        // Sem certificado configurado ainda é o normal; não é erro de tela.
      }
    })()
  }, [carregar])

  // Filtros reconsultam a RPC com debounce; a busca por texto é só de tela.
  const primeiroFiltro = useRef(true)
  useEffect(() => {
    if (primeiroFiltro.current) { primeiroFiltro.current = false; return }
    const t = setTimeout(() => { void carregar(filtros) }, 300)
    return () => clearTimeout(t)
  }, [filtros, carregar])

  const clientesVisiveis = useMemo(() => {
    const lista = payload?.clientes ?? []
    const termo = busca.trim().toLocaleLowerCase('pt-BR')
    if (!termo) return lista
    return lista
      .map((c) => {
        if (c.nome.toLocaleLowerCase('pt-BR').includes(termo)) return c
        const casos = c.casos.filter((k) => labelCaso(k).toLocaleLowerCase('pt-BR').includes(termo))
        return casos.length ? { ...c, casos, kits: casos.length, valor_total: casos.reduce((a, k) => a + k.valor_total, 0) } : null
      })
      .filter((c): c is NonNullable<typeof c> => c !== null)
  }, [payload, busca])

  const executar = async (kit: KitCaso, acao: string, fn: () => Promise<void>) => {
    const key = acaoKey(kit, acao)
    if (ocupado) return
    setOcupado(key)
    try {
      await fn()
    } finally {
      setOcupado(null)
    }
  }

  const sessao = async () => {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Sessão expirada. Entre de novo para continuar.')
    return { supabase, session, userId: session.user.id }
  }

  // ── NFS-e ──────────────────────────────────────────────────────────────
  // A prévia é a mesma do Fluxo de faturamento (NfsePreviewDialog com
  // caso_id) e a emissão é a mesma edge (emit-nfse). A edge não recebe
  // item_ids: cobre todos os itens aprovados do caso — o que, para um caso
  // com duas competências abertas, é mais do que este kit. O aviso fica na
  // confirmação.
  const emitirNfse = async (descricaoServico: string, ajustes?: AjustesDaNota) => {
    const kit = nfseKit
    if (!kit) return
    setNfseKit(null)
    await executar(kit, 'nfse', async () => {
      try {
        const { session } = await sessao()
        const resp = await fetch(`${FUNCTIONS()}/emit-nfse`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contrato_id: kit.contrato_id,
            ...(kit.caso_id ? { caso_id: kit.caso_id } : {}),
            ...(ajustes ? { ajustes } : {}),
            ...(descricaoServico.trim() ? { descricao_servico: descricaoServico } : {}),
          }),
        })
        const corpo = await resp.json().catch(() => ({}))
        if (!resp.ok) { toastError(corpo.error || 'A prefeitura recusou a emissão.'); return }
        if (corpo.partial) {
          toastError(corpo.message || 'Emissão parcial — alguns pagadores foram recusados.')
        } else {
          const n = Number(corpo.n_notas ?? 1)
          success(n > 1 ? `${n} NFS-e enviadas (rateio). Status: ${corpo.focus_status}` : `NFS-e enviada. Status: ${corpo.focus_status}`)
        }
        await recarregar()
        // A prefeitura leva alguns segundos a minutos para autorizar, e só
        // então existem número e PDF. Duas consultas curtas resolvem o caso
        // comum sem prender a tela (mesmo truque da tela antiga).
        const perguntarDesfecho = async (esperaMs: number) => {
          await new Promise((r) => setTimeout(r, esperaMs))
          await fetch(`${FUNCTIONS()}/consultar-nfse`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          }).catch(() => null)
          await recarregar()
        }
        void perguntarDesfecho(4000).then(() => perguntarDesfecho(12000))
      } catch (e) {
        toastError(e instanceof Error ? e.message : 'Erro de rede ao emitir a NFS-e.')
      }
    })
  }

  // ── Boleto ─────────────────────────────────────────────────────────────
  // A tela trabalha por kit/nota; a emissão trabalha por conta a receber —
  // bol_lancamento_da_nota faz a ponte. Confirmação explícita: registra o
  // título no banco de verdade e o cliente pode pagar.
  const emitirBoleto = (kit: KitCaso) => executar(kit, 'boleto', async () => {
    const nfse = kit.documentos.nfse
    if (!nfse) { notify('Emita a NFS-e primeiro — o boleto é gerado sobre ela.'); return }
    try {
      const { supabase, userId } = await sessao()
      const { data, error: e } = await supabase.rpc('bol_lancamento_da_nota', { p_user_id: userId, p_nota_id: nfse.id })
      if (e) { toastError(e.message); return }
      const info = data as {
        encontrado: boolean; motivo?: string; lancamento_id?: string
        descricao?: string; valor?: number; vencimento?: string; ja_baixado?: boolean
      }
      if (!info?.encontrado) { toastError(info?.motivo || 'Conta a receber não encontrada.'); return }
      if (info.ja_baixado) { notify('Esta fatura já foi recebida — não há o que cobrar.'); return }

      const venc = (info.vencimento || '').split('-').reverse().join('/')
      const ok = window.confirm(
        `Registrar boleto no Itaú?\n\n${info.descricao}\n${formatMoney(info.valor || 0)} — vence ${venc}\n\n` +
        'O título passa a existir no banco e o cliente pode pagar.',
      )
      if (!ok) return

      const resp = await fetch('/api/boletos/emitir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lancamento_id: info.lancamento_id }),
      })
      const corpo = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        // O Itaú diz qual campo recusou e por quê — mostrar, senão vira "HTTP 400".
        const campos = (corpo as { detalhe?: { campos?: Array<{ mensagem?: string }> } }).detalhe?.campos
        const motivo = Array.isArray(campos) && campos.length ? ' ' + campos.map((c) => c.mensagem).filter(Boolean).join(' ') : ''
        toastError((corpo.error || 'Não foi possível emitir o boleto.') + motivo)
        return
      }
      success('Boleto registrado no Itaú.')
      await recarregar()
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Erro de rede ao emitir o boleto.')
    }
  })

  const verBoleto = async (boletoId: string) => {
    const erro = await abrirFichaBoleto(boletoId)
    if (erro) toastError(erro)
  }

  const copiar = async (texto: string, rotulo: string) => {
    if (await copiarTexto(texto)) success(`${rotulo} copiada.`)
    else toastError('O navegador não deixou copiar. Selecione o texto e copie.')
  }

  const abrirUrl = async (url: string) => {
    try {
      const ok = await abrirDocumentoDoKit(url)
      if (!ok) toastError('O navegador bloqueou a aba. Libere pop-ups para este site e tente de novo.')
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Não foi possível abrir o documento.')
    }
  }

  // ── Relatório de timesheet ─────────────────────────────────────────────
  // PDF com pdf-lib a partir das linhas que a RPC já traz (snapshot da
  // revisão), subido ao bucket e registrado (D12-a). Regerar substitui.
  const gerarRelatorio = (kit: KitCaso) => executar(kit, 'relatorio', async () => {
    const itensTs = kit.itens.filter((i) => i.origem_tipo === 'timesheet')
    const rows: TimesheetPdfRow[] = itensTs
      .flatMap((item) => item.linhas_timesheet.map((l) => ({
        data: l.data ?? item.data_referencia ?? '',
        profissional: l.profissional ?? '',
        cargo: l.cargo,
        descricao: l.descricao ?? item.descricao,
        horas: Number(l.horas || 0),
        valorHora: l.valor_hora ?? null,
        valor: l.valor ?? null,
      })))
      .sort((a, b) => a.data.localeCompare(b.data))
    if (rows.length === 0) { notify('Este kit não tem horas para relatar.'); return }
    try {
      const clienteNome = payload?.clientes.find((c) => c.casos.some((k) => k.chave === kit.chave))?.nome ?? ''
      const bytes = await gerarRelatorioTimesheetPdf({
        titulo: 'Relatório de timesheet',
        cliente: clienteNome,
        casoLabel: kit.caso_id ? labelCaso(kit) : null,
        contratoLabel: formatContratoDisplay(kit.contrato_numero, kit.contrato_nome).full,
        competenciaLabel: labelCompetenciaCurta(kit.competencia),
        mostrarValor: true,
        rows,
      })
      const { path } = await gerarERegistrarDocumento({
        tipo: 'relatorio_timesheet',
        bytes,
        nomeArquivo: `Relatorio-timesheet-${anoMes(kit.competencia)}${kit.caso_numero ? `-caso-${kit.caso_numero}` : ''}.pdf`,
        casoId: kit.caso_id,
        contratoId: kit.contrato_id,
        competencia: kit.competencia,
        itemIds: itensTs.map((i) => i.id),
        metadata: { horas: kit.horas, linhas: rows.length },
      })
      success('Relatório de timesheet gerado e registrado no kit.')
      await recarregar()
      const abriu = await abrirDocumentoDoKit(path).catch(() => false)
      if (!abriu) notify('O navegador bloqueou a aba — use o botão "Abrir" na linha do relatório.')
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Não foi possível gerar o relatório.')
    }
  })

  // ── Nota de débito ─────────────────────────────────────────────────────
  // A prévia/PDF é a NotaDespesaPreview de sempre (nota + comprovantes). Os
  // comprovantes precisam do id da DESPESA (origem_id), que a RPC do kit não
  // traz — vem do get-revisao-fatura filtrado pelo kit, uma chamada por clique.
  const abrirNotaDebito = (kit: KitCaso) => executar(kit, 'nota', async () => {
    const despesas = kit.itens.filter((i) => i.origem_tipo === 'despesa')
    if (despesas.length === 0) { notify('Este kit não tem despesas reembolsáveis.'); return }
    const origemPorItem = new Map<string, string>()
    try {
      const { session } = await sessao()
      const params = new URLSearchParams({ contrato: kit.contrato_id, competencia: anoMes(kit.competencia) })
      if (kit.caso_id) params.set('caso', kit.caso_id)
      const resp = await fetch(`${FUNCTIONS()}/get-revisao-fatura?${params.toString()}`, {
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      })
      const corpo = await resp.json().catch(() => ({}))
      for (const raw of (corpo.data ?? []) as Array<{ id?: string; origem_id?: string | null }>) {
        if (raw.id && raw.origem_id) origemPorItem.set(raw.id, raw.origem_id)
      }
    } catch (e) {
      console.error('origem das despesas', e)
      notify('Não foi possível localizar os comprovantes; a nota sai sem eles.')
    }
    const clienteNome = payload?.clientes.find((c) => c.casos.some((k) => k.chave === kit.chave))?.nome ?? ''
    setNotaKit(kit)
    setNotaData({
      clienteNome,
      contratoLabel: formatContratoDisplay(kit.contrato_numero, kit.contrato_nome).full,
      casoLabel: kit.caso_id ? `${kit.caso_numero ? `${kit.caso_numero} - ` : ''}${kit.caso_nome}` : null,
      documentoNumero: null,
      emissao: isoHoje(),
      vencimento: kit.documentos.boleto?.vencimento ?? kit.conta_receber?.vencimento ?? isoHoje(),
      despesaIds: despesas.map((i) => origemPorItem.get(i.id)).filter((v): v is string => !!v),
      itens: despesas.map((i) => ({
        data_lancamento: i.despesa?.data ?? i.data_referencia ?? '',
        categoria: i.despesa?.categoria ?? '',
        descricao: i.despesa?.descricao ?? i.descricao,
        valor: Number(i.valor || 0),
      })),
    })
  })

  const registrarNotaDebito = async (bytes: Uint8Array, nomeArquivo: string) => {
    const kit = notaKit
    if (!kit) return
    await gerarERegistrarDocumento({
      tipo: 'nota_debito',
      bytes,
      nomeArquivo: `Nota-de-debito-${anoMes(kit.competencia)}${kit.caso_numero ? `-caso-${kit.caso_numero}` : ''}.pdf`,
      casoId: kit.caso_id,
      contratoId: kit.contrato_id,
      competencia: kit.competencia,
      itemIds: kit.itens.filter((i) => i.origem_tipo === 'despesa').map((i) => i.id),
      metadata: { valor_total: kit.valor_despesa, arquivo_baixado: nomeArquivo },
    })
    success('Nota de débito registrada no kit.')
    await recarregar()
  }

  // ── Toggle "relatório vai no e-mail" (D15-a) ───────────────────────────
  // Grava pela edge update-caso, que exige contracts.casos.write e passa o
  // payload pela RPC update_caso. Um payload parcial faria a edge mandar
  // polo=null e a RPC apagar o polo de um caso contencioso — por isso o caso
  // é lido antes (get-contrato) e natureza/polo vão junto, como o cadastro faz.
  const toggleRelatorio = (kit: KitCaso, valor: boolean) => executar(kit, 'toggle', async () => {
    if (!kit.caso_id) return
    const aplicarLocal = (v: boolean) => setPayload((p) => p ? {
      ...p,
      clientes: p.clientes.map((c) => ({
        ...c,
        casos: c.casos.map((k) => (k.caso_id === kit.caso_id ? { ...k, enviar_relatorio_timesheet: v } : k)),
      })),
    } : p)
    aplicarLocal(valor)
    try {
      const { session } = await sessao()
      const headers = { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }
      const rc = await fetch(`${FUNCTIONS()}/get-contrato?id=${kit.contrato_id}`, { headers })
      const contrato = await rc.json().catch(() => ({}))
      const casos = (contrato?.data?.casos ?? contrato?.casos ?? []) as Array<Record<string, unknown>>
      const caso = casos.find((c) => c.id === kit.caso_id)
      if (!rc.ok || !caso) throw new Error(contrato?.error || 'Não foi possível ler o cadastro do caso.')

      const regras = Array.isArray(caso.regras_financeiras) ? (caso.regras_financeiras as Array<Record<string, unknown>>) : []
      const cfg = (caso.regra_cobranca_config ?? {}) as Record<string, unknown>
      const natureza = [
        caso.natureza_caso,
        cfg.natureza_caso,
        regras[0]?.natureza_caso,
        (regras[0]?.regra_cobranca_config as Record<string, unknown> | undefined)?.natureza_caso,
      ].map((v) => String(v || '').trim().toLowerCase()).find(Boolean) || ''

      const resp = await fetch(`${FUNCTIONS()}/update-caso`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          id: kit.caso_id,
          enviar_relatorio_timesheet: valor,
          ...(natureza ? { natureza_caso: natureza } : {}),
          ...(caso.polo ? { polo: caso.polo } : {}),
        }),
      })
      const corpo = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(corpo.error || 'Não foi possível salvar a configuração do caso.')
      success(valor ? 'O relatório de timesheet passa a ir no e-mail deste caso.' : 'O relatório de timesheet não vai mais no e-mail deste caso.')
    } catch (e) {
      aplicarLocal(!valor)
      toastError(e instanceof Error ? e.message : 'Não foi possível salvar a configuração do caso.')
    }
  })

  // ── E-mail ─────────────────────────────────────────────────────────────
  const abrirEmail = (kit: KitCaso) => executar(kit, 'email', async () => {
    try {
      const { supabase, userId } = await sessao()
      const { data, error: e } = await supabase.rpc('get_dados_envio_fatura', {
        p_user_id: userId,
        p_contrato_id: kit.contrato_id,
        p_caso_id: kit.caso_id,
        p_competencia: kit.competencia,
      })
      if (e) { toastError(e.message); return }
      const dados = (data ?? {}) as {
        cliente_nome?: string
        destinatarios?: string[]
        nota?: { id: string; numero: number | null } | null
        anexos?: Array<{ tipo: string; nome: string | null; url: string | null }>
      }
      const anexos = dados.anexos ?? []
      const temHoras = kit.itens.some((i) => i.origem_tipo === 'timesheet')
      const temDespesa = kit.itens.some((i) => i.origem_tipo === 'despesa')
      const nomesAnexos = anexos.map((a) => a.nome || a.tipo)
      if (!anexos.some((a) => a.tipo === 'nfse')) nomesAnexos.unshift('NFS-e (pendente — ainda sem PDF)')
      setEmailKit(kit)
      setEmailData({
        clienteNome: dados.cliente_nome || payload?.clientes.find((c) => c.casos.some((k) => k.chave === kit.chave))?.nome || '',
        contratoLabel: `${formatContratoDisplay(kit.contrato_numero, kit.contrato_nome).full}${kit.caso_id ? ` · ${labelCaso(kit)}` : ''}`,
        destinatarioEmail: (dados.destinatarios ?? []).join(', ') || null,
        nfseNumero: kit.documentos.nfse?.nfse_numero ?? (dados.nota?.numero != null ? String(dados.nota.numero) : null),
        mesReferencia: labelCompetencia(kit.competencia),
        vencimento: (kit.documentos.boleto?.vencimento ?? kit.conta_receber?.vencimento ?? '').slice(0, 10).split('-').reverse().join('/') || '____',
        anexos: nomesAnexos,
        completo: temHoras || temDespesa,
        temRelatorio: anexos.some((a) => a.tipo === 'relatorio_timesheet'),
      })
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Não foi possível montar a prévia do e-mail.')
    }
  })

  const enviarFatura = async (assunto: string, corpo: string, para: string) => {
    const kit = emailKit
    if (!kit) return
    setEnviandoEmail(true)
    try {
      const supabase = createClient()
      const destinatarios = para.split(/[,;]/).map((s) => s.trim()).filter(Boolean)
      const { data, error: e } = await supabase.functions.invoke('enviar-fatura', {
        body: { contrato_id: kit.contrato_id, caso_id: kit.caso_id, competencia: kit.competencia, assunto, corpo, destinatarios },
      })
      const resposta = data as { enviado?: boolean; destinatarios?: string[]; anexos?: string[]; error?: string } | null
      if (e || resposta?.error || !resposta?.enviado) {
        toastError(resposta?.error || (e instanceof Error ? e.message : 'Não foi possível enviar a fatura.'))
        return
      }
      setEmailData(null)
      setEmailKit(null)
      success(`Fatura enviada para ${(resposta.destinatarios || []).join(', ')}${resposta.anexos?.length ? ` com ${resposta.anexos.length} anexo(s)` : ''}.`)
      await recarregar()
    } catch (err) {
      console.error(err)
      toastError('Erro ao enviar a fatura.')
    } finally {
      setEnviandoEmail(false)
    }
  }

  // ── Excluir kit (D11-a) ────────────────────────────────────────────────
  const excluirKit = (kit: KitCaso) => executar(kit, 'excluir', async () => {
    if (!kit.pode_excluir) { toastError(kit.motivo_bloqueio || 'Este kit não pode ser excluído.'); return }
    const docs = [
      kit.documentos.relatorio_timesheet ? 'o relatório de timesheet' : null,
      kit.documentos.nota_debito ? 'a nota de débito' : null,
      kit.documentos.nfse && kit.documentos.nfse.status === 'gerado' ? 'a NFS-e com erro' : null,
    ].filter(Boolean)
    const ok = window.confirm(
      `Excluir o kit de ${labelCaso(kit)} (${labelCompetencia(kit.competencia)})?\n\n` +
      `Os ${kit.itens.length} item(ns) voltam para a Revisão como "Liberado" e somem daqui` +
      (docs.length ? `; ${docs.join(', ')} ficam cancelados.` : '.') +
      '\n\nNada é apagado da revisão — dá para aprovar de novo.',
    )
    if (!ok) return
    try {
      const { supabase, userId } = await sessao()
      const { data, error: e } = await supabase.rpc('excluir_kit', {
        p_user_id: userId,
        p_caso_id: kit.caso_id,
        p_contrato_id: kit.contrato_id,
        p_competencia: kit.competencia,
      })
      if (e) { toastError(e.message); return }
      const r = data as { ok?: boolean; itens_devolvidos?: number; motivo?: string | null }
      if (!r?.ok) { toastError(r?.motivo || 'Não foi possível excluir o kit.'); return }
      success(`Kit excluído: ${r.itens_devolvidos ?? 0} item(ns) devolvido(s) para a revisão.`)
      await recarregar()
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Erro ao excluir o kit.')
    }
  })

  const acoes: AcoesKit = {
    ocupado,
    onEmitirNfse: (kit) => {
      if (kit.documentos.nfse && kit.documentos.nfse.status === 'gerado' && ['autorizado', 'processando'].includes(kit.documentos.nfse.focus_status ?? '')) {
        notify('Este kit já tem NFS-e emitida.')
        return
      }
      setNfseKit(kit)
    },
    onAbrirUrl: (url) => void abrirUrl(url),
    onEmitirBoleto: (kit) => void emitirBoleto(kit),
    onVerBoleto: (id) => void verBoleto(id),
    onCopiar: (texto, rotulo) => void copiar(texto, rotulo),
    onGerarRelatorio: (kit) => void gerarRelatorio(kit),
    onGerarNotaDebito: (kit) => void abrirNotaDebito(kit),
    onEditarAjustes: (kit) => setAjustesKit(kit),
    onToggleRelatorio: (kit, valor) => void toggleRelatorio(kit, valor),
    onEmail: (kit) => void abrirEmail(kit),
    onExcluir: (kit) => void excluirKit(kit),
  }

  // Um caso com mais de uma competência aberta: a NFS-e cobre todos os itens
  // aprovados do caso, não só este kit — aviso na prévia.
  const casosComVariosKits = useMemo(() => {
    const contagem = new Map<string, number>()
    for (const c of payload?.clientes ?? []) for (const k of c.casos) if (k.caso_id) contagem.set(k.caso_id, (contagem.get(k.caso_id) ?? 0) + 1)
    return contagem
  }, [payload])

  return (
    <div className="space-y-5">
      {error ? (
        <Alert className="border border-destructive/30 bg-destructive/10 text-destructive">
          <AlertTitle>Atenção</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {/* Certificado do Itaú perto de vencer. O banco só aceita renovação nos
          últimos 30 dias, uma vez por ano — se essa janela passar, é refazer o
          processo inteiro. Silêncio aqui vira boleto parado lá na frente. */}
      {cert?.configurado && (cert.erro || (cert.dias_restantes !== null && cert.dias_restantes <= 60)) ? (
        <Alert
          className={
            cert.erro || (cert.dias_restantes ?? 0) < 0
              ? 'border-destructive/40 bg-destructive/10 text-destructive'
              : (cert.dias_restantes ?? 0) <= 30
                ? 'border-orange-400 bg-orange-50 text-orange-900'
                : 'border-amber-300 bg-amber-50 text-amber-900'
          }
        >
          <AlertTitle>
            {cert.erro
              ? 'Certificado do Itaú com problema'
              : (cert.dias_restantes ?? 0) < 0
                ? `Certificado do Itaú venceu em ${cert.vence_em}`
                : `Certificado do Itaú vence em ${cert.dias_restantes} dia(s)`}
          </AlertTitle>
          <AlertDescription>
            {cert.erro
              ? `Não foi possível ler o certificado (${cert.erro}). Enquanto isso, nenhum boleto é emitido.`
              : (cert.dias_restantes ?? 0) < 0
                ? 'A emissão de boletos está parada. Passada a data não há renovação: é refazer o processo com o banco.'
                : cert.pode_renovar
                  ? 'A janela de renovação já está aberta — o Itaú só aceita nos últimos 30 dias. É a hora de renovar.'
                  : `Vence em ${cert.vence_em}. A renovação só é aceita nos últimos 30 dias; este é um aviso antecipado.`}
          </AlertDescription>
        </Alert>
      ) : null}

      <BarraFiltros
        opcoes={payload?.opcoes ?? null}
        filtros={filtros}
        busca={busca}
        onChange={setFiltros}
        onBusca={setBusca}
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
        <div className="flex-1">
          <ResumoStatus
            resumo={payload?.resumo ?? null}
            ativo={filtros.statusKit}
            onSelecionar={(status) => setFiltros((f) => ({ ...f, statusKit: status }))}
          />
        </div>
        <div className="flex items-start justify-end">
          <Button variant="outline" size="sm" onClick={() => void carregar(filtros)} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Atualizar
          </Button>
        </div>
      </div>

      {loading && !payload ? (
        <div className="flex items-center justify-center rounded-md border bg-white py-16 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Carregando composição da fatura...
        </div>
      ) : clientesVisiveis.length === 0 ? (
        <div className="rounded-md border bg-white py-16 text-center text-sm text-muted-foreground">
          {busca.trim()
            ? 'Nenhum cliente ou caso bate com a busca.'
            : Object.values(filtros).some(Boolean)
              ? 'Nenhum kit com esses filtros. Limpe os filtros ou escolha outra competência.'
              : 'Nenhum item aprovado pelo financeiro disponível para composição.'}
        </div>
      ) : (
        <div className={loading ? 'space-y-4 opacity-60 transition-opacity' : 'space-y-4'}>
          {clientesVisiveis.map((cliente) => (
            <ClienteCard key={cliente.cliente_id ?? cliente.nome} cliente={cliente} acoes={acoes} />
          ))}
        </div>
      )}

      <AjustesKitDialog
        kit={ajustesKit}
        onClose={() => setAjustesKit(null)}
        onSalvo={() => {
          setAjustesKit(null)
          success('Impostos e pagadores salvos no cadastro.')
          void recarregar()
        }}
      />

      <NfsePreviewDialog
        open={nfseKit !== null}
        contratoId={nfseKit?.contrato_id ?? null}
        casoId={nfseKit?.caso_id ?? null}
        contratoLabel={nfseKit
          ? `${formatContratoDisplay(nfseKit.contrato_numero, nfseKit.contrato_nome).full}${nfseKit.caso_id ? ` · ${labelCaso(nfseKit)}` : ''}` +
            (nfseKit.caso_id && (casosComVariosKits.get(nfseKit.caso_id) ?? 0) > 1
              ? ' — atenção: a nota cobre todos os itens aprovados do caso, de todas as competências'
              : '')
          : null}
        onClose={() => setNfseKit(null)}
        onConfirmEmit={(descricao, ajustes) => void emitirNfse(descricao, ajustes)}
      />

      <NotaDespesaPreview
        open={!!notaData}
        onClose={() => { setNotaData(null); setNotaKit(null) }}
        data={notaData}
        onGerado={registrarNotaDebito}
      />

      <FaturaEmailPreview
        open={!!emailData}
        onClose={() => { setEmailData(null); setEmailKit(null) }}
        data={emailData}
        enviando={enviandoEmail}
        onEnviar={(assunto, corpo, para) => void enviarFatura(assunto, corpo, para)}
      />
    </div>
  )
}
