// Metas do PDI por período (pedido do cliente 26/10/2026): o colaborador
// lança as metas de um período, dá a autoavaliação e envia; o período trava e
// cai na caixa do coordenador da área. Aqui fica só a lógica pura — períodos,
// cópia de metas entre períodos, validação do envio e as agregações do painel
// — para ser testada sem banco. As RPCs ficam em ./api.ts.

export type PeriodoCodigo = 'S1' | 'S2' | 'T1' | 'T2' | 'T3' | 'T4'

export const PERIODOS: Array<{ codigo: PeriodoCodigo; rotulo: string; curto: string }> = [
  { codigo: 'S1', rotulo: '1º semestre', curto: '1º sem' },
  { codigo: 'S2', rotulo: '2º semestre', curto: '2º sem' },
  { codigo: 'T1', rotulo: '1º trimestre', curto: '1º tri' },
  { codigo: 'T2', rotulo: '2º trimestre', curto: '2º tri' },
  { codigo: 'T3', rotulo: '3º trimestre', curto: '3º tri' },
  { codigo: 'T4', rotulo: '4º trimestre', curto: '4º tri' },
]

export function rotuloPeriodo(codigo: string | null | undefined): string {
  return PERIODOS.find((p) => p.codigo === codigo)?.rotulo ?? (codigo || '—')
}

export function curtoPeriodo(codigo: string | null | undefined): string {
  return PERIODOS.find((p) => p.codigo === codigo)?.curto ?? (codigo || '—')
}

export function ordemPeriodo(codigo: string | null | undefined): number {
  const i = PERIODOS.findIndex((p) => p.codigo === codigo)
  return i < 0 ? PERIODOS.length : i
}

export const FAIXAS_ORDEM = ['baixa_performance', 'a_melhorar', 'dentro_da_media', 'acima_do_esperado', 'fora_da_curva'] as const

export interface AnexoMeta {
  id: string
  arquivo_nome: string
  mime_type: string | null
  tamanho_bytes: number | null
  storage_path: string
  created_at?: string
}

export interface MetaPeriodo {
  /** id do banco, ou temporário ('new-…') enquanto não foi salva. */
  id: string
  periodo: PeriodoCodigo
  nome: string | null
  descricao?: string | null
  indicadores?: string | null
  comentario: string | null
  progresso_pct: number | null
  faixa_auto: string | null
  /** Avaliação do sócio/coordenador — só leitura para o colaborador. */
  faixa_final?: string | null
  anexos?: AnexoMeta[]
  _new?: boolean
}

export interface EnvioPeriodo {
  periodo: PeriodoCodigo
  enviado_em: string | null
  envios?: number
  reaberto_em?: string | null
}

export function normalizarNomeMeta(nome: string | null | undefined): string {
  return (nome ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * "Copiar as metas acima": leva as metas de um período para outro como ponto
 * de partida. Vai só o que define a meta (nome, descrição, indicadores); a
 * entrega do período novo começa em branco — sem autoavaliação, progresso 0,
 * sem comentário, sem anexos e sem a avaliação do sócio. Meta que já existe no
 * destino (mesmo nome, ignorando caixa/acentos/espaços) não é duplicada, e
 * meta sem nome não é copiada.
 */
export function copiarMetas(
  origem: MetaPeriodo[],
  destinoAtual: MetaPeriodo[],
  periodoDestino: PeriodoCodigo,
  novoId: () => string,
): MetaPeriodo[] {
  const jaTem = new Set(destinoAtual.map((m) => normalizarNomeMeta(m.nome)).filter(Boolean))
  const copiadas: MetaPeriodo[] = []
  for (const m of origem) {
    const chave = normalizarNomeMeta(m.nome)
    if (!chave || jaTem.has(chave)) continue
    jaTem.add(chave)
    copiadas.push({
      id: novoId(),
      periodo: periodoDestino,
      nome: (m.nome ?? '').trim(),
      descricao: m.descricao ?? null,
      indicadores: m.indicadores ?? null,
      comentario: null,
      progresso_pct: 0,
      faixa_auto: null,
      faixa_final: null,
      anexos: [],
      _new: true,
    })
  }
  return [...destinoAtual, ...copiadas]
}

/** Mesmas regras que salvar_minhas_metas_pdi aplica no envio. */
export function validarEnvioPeriodo(metas: MetaPeriodo[]): string | null {
  if (metas.length === 0) return 'Cadastre ao menos uma meta antes de enviar.'
  const semNome = metas.filter((m) => !normalizarNomeMeta(m.nome)).length
  if (semNome > 0) return `${semNome} meta(s) sem nome.`
  const semFaixa = metas.filter((m) => !m.faixa_auto).length
  if (semFaixa > 0) return `${semFaixa} meta(s) sem autoavaliação.`
  return null
}

/** Payload de salvar_minhas_metas_pdi (id vazio = meta nova). */
export function payloadMetas(metas: MetaPeriodo[]) {
  return metas.map((m) => ({
    id: m._new ? '' : m.id,
    nome: m.nome,
    ...(m._new ? { descricao: m.descricao ?? null, indicadores: m.indicadores ?? null } : {}),
    comentario: m.comentario,
    progresso_pct: Math.max(0, Math.min(100, Math.round(Number(m.progresso_pct ?? 0)))),
    faixa_auto: m.faixa_auto,
  }))
}

/** Períodos para onde dá para copiar: os outros, que não estão enviados. */
export function destinosDeCopia(origem: PeriodoCodigo, enviados: Set<string>): PeriodoCodigo[] {
  return PERIODOS.map((p) => p.codigo).filter((c) => c !== origem && !enviados.has(c))
}

// ---------------------------------------------------------------------------
// Painel
// ---------------------------------------------------------------------------

export interface PainelPessoa {
  colaborador_id: string
  nome: string
  area: string
  cargo: string | null
  avaliacao_id: string | null
}

export interface PainelMeta {
  meta_id: string
  colaborador_id: string
  periodo: PeriodoCodigo
  nome: string | null
  faixa_auto: string | null
  faixa_final: string | null
  progresso_pct: number
  qtd_anexos: number
}

export interface PainelEnvio {
  colaborador_id: string
  periodo: PeriodoCodigo
  enviado_em: string
}

export interface PainelDados {
  pessoas: PainelPessoa[]
  metas: PainelMeta[]
  envios: PainelEnvio[]
}

export interface PainelFiltro {
  periodo?: PeriodoCodigo | null
  area?: string | null
}

export interface PessoaResumo {
  pessoa: PainelPessoa
  metas: PainelMeta[]
  progresso: number | null
  /** Períodos (com meta) e se cada um foi enviado. */
  periodos: Array<{ periodo: PeriodoCodigo; enviado: boolean; enviado_em: string | null }>
}

export interface AreaResumo {
  area: string
  pessoas: number
  metas: number
  progresso: number | null
  integrantes: PessoaResumo[]
}

export interface PainelResumo {
  kpis: {
    pessoas: number
    pessoasComMetas: number
    metas: number
    progressoMedio: number | null
    enviados: number
    pendentes: number
  }
  porArea: AreaResumo[]
  porFaixa: Array<{ codigo: string; total: number }>
  semAutoavaliacao: number
  pessoas: PessoaResumo[]
}

function media(valores: number[]): number | null {
  if (valores.length === 0) return null
  return Math.round(valores.reduce((s, v) => s + v, 0) / valores.length)
}

/**
 * Agrega as linhas cruas de get_painel_metas_pdi.
 *
 * Unidade de envio = pessoa × período que tem ao menos uma meta: "enviados"
 * conta as que já foram enviadas, "pendentes" as que ainda não. Pessoa sem
 * meta no filtro entra em "pessoas" mas não em enviados/pendentes.
 * Progresso médio é a média simples das metas (cada meta pesa igual).
 */
export function agregarPainel(dados: PainelDados, filtro: PainelFiltro = {}): PainelResumo {
  const pessoas = dados.pessoas.filter((p) => !filtro.area || p.area === filtro.area)
  const ids = new Set(pessoas.map((p) => p.colaborador_id))
  const metas = dados.metas.filter((m) => ids.has(m.colaborador_id) && (!filtro.periodo || m.periodo === filtro.periodo))
  const enviado = new Map<string, string>()
  for (const e of dados.envios) enviado.set(`${e.colaborador_id}|${e.periodo}`, e.enviado_em)

  const metasPorPessoa = new Map<string, PainelMeta[]>()
  for (const m of metas) {
    const lista = metasPorPessoa.get(m.colaborador_id) ?? []
    lista.push(m)
    metasPorPessoa.set(m.colaborador_id, lista)
  }

  let enviados = 0
  let pendentes = 0
  const resumos: PessoaResumo[] = pessoas.map((p) => {
    const ms = (metasPorPessoa.get(p.colaborador_id) ?? []).slice()
      .sort((a, b) => ordemPeriodo(a.periodo) - ordemPeriodo(b.periodo))
    const periodos = Array.from(new Set(ms.map((m) => m.periodo)))
      .sort((a, b) => ordemPeriodo(a) - ordemPeriodo(b))
      .map((periodo) => {
        const em = enviado.get(`${p.colaborador_id}|${periodo}`) ?? null
        if (em) enviados += 1
        else pendentes += 1
        return { periodo, enviado: Boolean(em), enviado_em: em }
      })
    return { pessoa: p, metas: ms, progresso: media(ms.map((m) => m.progresso_pct ?? 0)), periodos }
  })

  const areas = new Map<string, PessoaResumo[]>()
  for (const r of resumos) {
    const lista = areas.get(r.pessoa.area) ?? []
    lista.push(r)
    areas.set(r.pessoa.area, lista)
  }
  const porArea: AreaResumo[] = Array.from(areas.entries()).map(([area, integrantes]) => {
    const ms = integrantes.flatMap((i) => i.metas)
    return {
      area,
      pessoas: integrantes.length,
      metas: ms.length,
      progresso: media(ms.map((m) => m.progresso_pct ?? 0)),
      integrantes: integrantes.slice().sort((a, b) => a.pessoa.nome.localeCompare(b.pessoa.nome, 'pt-BR')),
    }
  }).sort((a, b) => (b.progresso ?? -1) - (a.progresso ?? -1) || a.area.localeCompare(b.area, 'pt-BR'))

  const porFaixa = FAIXAS_ORDEM.map((codigo) => ({ codigo, total: metas.filter((m) => m.faixa_auto === codigo).length }))

  return {
    kpis: {
      pessoas: pessoas.length,
      pessoasComMetas: resumos.filter((r) => r.metas.length > 0).length,
      metas: metas.length,
      progressoMedio: media(metas.map((m) => m.progresso_pct ?? 0)),
      enviados,
      pendentes,
    },
    porArea,
    porFaixa,
    semAutoavaliacao: metas.filter((m) => !m.faixa_auto).length,
    pessoas: resumos,
  }
}
