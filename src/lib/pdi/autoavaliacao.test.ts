import { describe, expect, it } from 'vitest'
import {
  copiarMetas,
  destinosDeCopia,
  ehPeriodoHistorico,
  metaJaNoPeriodo,
  periodoCorrente,
  situacaoDevolver,
  tituloAutoavaliacao,
  type MetaPeriodo,
} from './metas'
import { previaPorColaborador, resumirPilares, type PreviaSkillItem } from './previa'
import { etapaPdi, mostraCompetencias } from './etapa'

describe('registro histórico', () => {
  it('1º semestre de 2026 (e trimestres dele) é histórico; 2º semestre não', () => {
    expect(ehPeriodoHistorico(2026, 'S1')).toBe(true)
    expect(ehPeriodoHistorico(2026, 'T1')).toBe(true)
    expect(ehPeriodoHistorico(2026, 'T2')).toBe(true)
    expect(ehPeriodoHistorico(2026, 'S2')).toBe(false)
    expect(ehPeriodoHistorico(2026, 'T3')).toBe(false)
    expect(ehPeriodoHistorico(2025, 'S2')).toBe(true)
    expect(ehPeriodoHistorico(2027, 'S1')).toBe(false)
  })

  it('não oferece período histórico como destino de cópia', () => {
    expect(destinosDeCopia('S2', new Set(), 2026)).toEqual(['T3', 'T4'])
    expect(destinosDeCopia('S2', new Set())).toEqual(['S1', 'T1', 'T2', 'T3', 'T4'])
  })
})

describe('títulos e período corrente', () => {
  it('rotula as duas autoavaliações do ano', () => {
    expect(tituloAutoavaliacao('S1')).toBe('Autoavaliação de maio (1º semestre)')
    expect(tituloAutoavaliacao('S2')).toBe('Autoavaliação de outubro (2º semestre)')
    expect(tituloAutoavaliacao('T3')).toBe('Autoavaliação do 3º trimestre')
  })

  it('até junho é 1º semestre; de julho em diante, 2º', () => {
    expect(periodoCorrente(new Date(2026, 5, 30))).toBe('S1')
    expect(periodoCorrente(new Date(2026, 6, 1))).toBe('S2')
    expect(periodoCorrente(new Date(2026, 9, 26))).toBe('S2')
  })
})

describe('situacaoDevolver ("Voltar para edição")', () => {
  it('só período enviado, fora do histórico e sem avaliação do sócio', () => {
    expect(situacaoDevolver(2026, undefined)).toBe('nao_enviado')
    expect(situacaoDevolver(2026, { periodo: 'S2', enviado_em: null })).toBe('nao_enviado')
    expect(situacaoDevolver(2026, { periodo: 'S2', enviado_em: '2026-10-26' })).toBe('pode')
    expect(situacaoDevolver(2026, { periodo: 'S2', enviado_em: '2026-10-26', avaliado_socio: true })).toBe('avaliado_socio')
    expect(situacaoDevolver(2026, { periodo: 'S1', enviado_em: '2026-05-20' })).toBe('historico')
    // a flag do servidor vale mesmo se a regra local disser outra coisa
    expect(situacaoDevolver(2027, { periodo: 'S1', enviado_em: '2027-05-20', historico: true })).toBe('historico')
  })
})

describe('"Continua valendo"', () => {
  const s1: MetaPeriodo[] = [
    { id: 'a', periodo: 'S1', nome: 'Publicar artigo técnico', comentario: 'feito metade', progresso_pct: 50, faixa_auto: 'dentro_da_media', faixa_final: 'acima_do_esperado', anexos: [] },
    { id: 'b', periodo: 'S1', nome: 'Captar 2 clientes', comentario: null, progresso_pct: 20, faixa_auto: 'a_melhorar' },
  ]
  const s2: MetaPeriodo[] = [{ id: 'x', periodo: 'S2', nome: '  publicar ARTIGO tecnico ', comentario: null, progresso_pct: 0, faixa_auto: null }]

  it('reconhece a meta que já está no destino (caixa, acento e espaços)', () => {
    expect(metaJaNoPeriodo(s1[0], s2)).toBe(true)
    expect(metaJaNoPeriodo(s1[1], s2)).toBe(false)
    expect(metaJaNoPeriodo({ nome: '  ' }, [{ nome: '' }])).toBe(false)
  })

  it('copia sem duplicar e com a entrega em branco', () => {
    let i = 0
    const out = copiarMetas(s1, s2, 'S2', () => `n${++i}`)
    expect(out).toHaveLength(2)
    expect(out[1]).toMatchObject({ periodo: 'S2', nome: 'Captar 2 clientes', faixa_auto: null, faixa_final: null, progresso_pct: 0, comentario: null, _new: true })
  })
})

describe('avaliação prévia', () => {
  const sk = (p: Partial<PreviaSkillItem>): PreviaSkillItem => ({
    trilha: 'base', pilar_numero: 1, pilar_nome: 'Técnica', item_codigo: '1.1', faixa_auto: null, faixa_gestor: null, ...p,
  })

  it('resume por pilar com as faixas distintas, base primeiro', () => {
    const r = resumirPilares([
      sk({ trilha: 'lideranca', pilar_numero: 6, pilar_nome: 'Gestão', faixa_auto: 'dentro_da_media' }),
      sk({ pilar_numero: 2, pilar_nome: 'Alta performance', item_codigo: '2.1', faixa_auto: 'acima_do_esperado', faixa_gestor: 'dentro_da_media' }),
      sk({ pilar_numero: 2, pilar_nome: 'Alta performance', item_codigo: '2.2', faixa_auto: 'acima_do_esperado', faixa_gestor: 'a_melhorar' }),
      sk({ item_codigo: '1.1', faixa_auto: 'dentro_da_media' }),
    ])
    expect(r.map((p) => `${p.trilha}:${p.pilar_numero}`)).toEqual(['base:1', 'base:2', 'lideranca:6'])
    expect(r[1]).toMatchObject({ faixas_auto: ['acima_do_esperado'], faixas_gestor: ['dentro_da_media', 'a_melhorar'], itens: 2 })
    expect(r[0].faixas_gestor).toEqual([])
  })

  it('indexa por colaborador', () => {
    const m = previaPorColaborador({ ano: 2026, escopo: 'todos', pessoas: [{ colaborador_id: 'c1', nome: 'X', avaliacao_id: 'a', autoavaliacao_enviada_at: null, avaliacao_gestor_enviada_at: null, gestor_nome: null, skills: [], dna: [] }] })
    expect(m.get('c1')?.avaliacao_id).toBe('a')
    expect(previaPorColaborador(null).size).toBe(0)
  })
})

describe('etapa do Meu PDI', () => {
  it('padrão é a etapa de metas (sem competências); "completa" volta tudo', () => {
    expect(etapaPdi(undefined)).toBe('metas')
    expect(etapaPdi('qualquer')).toBe('metas')
    expect(etapaPdi('completa')).toBe('completa')
    expect(mostraCompetencias('metas')).toBe(false)
    expect(mostraCompetencias('completa')).toBe(true)
  })
})
