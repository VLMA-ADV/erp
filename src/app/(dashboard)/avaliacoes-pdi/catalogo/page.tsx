'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

interface Carreira { codigo: string; nome: string; ordem: number }
interface Regua { codigo: string; rotulo: string; ordem: number; progride: boolean; bonus_pdi: boolean; plr_plus_elegivel: boolean; reflexo: string }
interface Pilar { trilha: string; numero: number; nome: string }
interface Dna { numero: number; nome: string }
interface Skill { trilha: string; pilar_numero: number; nivel_codigo: string; item_codigo: string; titulo: string | null; descricao: string | null; ordem: number }
interface Quadro { carreira_codigo: string; cargo_codigo: string; coluna: string; salario: number | null; observacao: string | null }
interface Catalogo { carreiras: Carreira[]; regua: Regua[]; pilares: Pilar[]; dna: Dna[]; skills: Skill[]; quadro_remuneracao: Quadro[] }

const NIVEIS = [
  { codigo: 'ESTAGIARIO', label: 'Estagiário' },
  { codigo: 'JUNIOR', label: 'Júnior' },
  { codigo: 'PLENO', label: 'Pleno' },
  { codigo: 'SENIOR', label: 'Sênior' },
]

const CARGO_ORDER = ['ESTAG1', 'ESTAG2', 'JR1', 'JR2', 'JR3', 'JR4', 'JR5', 'PL1', 'PL2', 'PL3', 'PL4', 'PL5', 'SR1', 'SR2', 'SR3', 'SR4', 'SR5', 'SR6', 'SR7', 'SR8']
const CARGO_LABEL: Record<string, string> = {
  ESTAG1: 'Estágio 1', ESTAG2: 'Estágio 2',
  JR1: 'Júnior 1', JR2: 'Júnior 2', JR3: 'Júnior 3', JR4: 'Júnior 4', JR5: 'Júnior 5',
  PL1: 'Pleno 1', PL2: 'Pleno 2', PL3: 'Pleno 3', PL4: 'Pleno 4', PL5: 'Pleno 5',
  SR1: 'Sênior 1', SR2: 'Sênior 2', SR3: 'Sênior 3', SR4: 'Sênior 4', SR5: 'Sênior 5', SR6: 'Sênior 6', SR7: 'Sênior 7', SR8: 'Sênior 8',
}
const COLUNAS = [
  { codigo: 'I', label: 'Carreira I' },
  { codigo: 'T_10', label: 'Líder/Estrat. +10%' },
  { codigo: 'T_20', label: 'Líder/Estrat. +20%' },
]
const TRILHA_LABEL: Record<string, string> = { base: 'Skills base (por faixa)', lideranca: 'Adicional — Liderança', estrategico: 'Adicional — Estratégico' }

function money(v: number | null) {
  if (v == null) return '—'
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 }).format(v)
}

function faixaColor(codigo: string): string {
  switch (codigo) {
    case 'baixa_performance': return 'bg-red-50 text-red-700 border-red-200'
    case 'a_melhorar': return 'bg-amber-50 text-amber-700 border-amber-200'
    case 'dentro_da_media': return 'bg-secondary text-ink-secondary border-hairline'
    case 'acima_do_esperado': return 'bg-primary-soft-bg text-primary-soft-fg border-primary/30'
    case 'fora_da_curva': return 'bg-emerald-50 text-emerald-700 border-emerald-200'
    default: return 'bg-secondary text-ink-secondary border-hairline'
  }
}

function Check({ on }: { on: boolean }) {
  return <span className={on ? 'text-emerald-600 font-semibold' : 'text-ink-mute'}>{on ? 'Sim' : 'Não'}</span>
}

export default function CatalogoPdpPage() {
  const [data, setData] = useState<Catalogo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const supabase = createClient()
        const { data: res, error: err } = await supabase.rpc('get_pdi_catalogo')
        if (err) { setError(err.message); return }
        setData(res as Catalogo)
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [])

  const quadroMap = useMemo(() => {
    const m: Record<string, Record<string, number | null>> = {}
    for (const r of data?.quadro_remuneracao || []) {
      const key = `${r.carreira_codigo}|${r.coluna}`
      if (!m[r.cargo_codigo]) m[r.cargo_codigo] = {}
      m[r.cargo_codigo][key] = r.salario
    }
    return m
  }, [data])

  const carreirasQuadro = useMemo(
    () => (data?.carreiras || []).filter((c) => ['CONTENCIOSO', 'CONSULTORIA'].includes(c.codigo)),
    [data],
  )

  return (
    <div className="container mx-auto px-6 py-10">
      <header className="mb-8">
        <span className="text-eyebrow">PESSOAS · PDP · FASE 0</span>
        <h1 className="mt-2 display-lg text-ink">Catálogo do PDP</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-mute">
          Dados de referência importados do Programa de Desenvolvimento Profissional 2026: carreiras, régua de avaliação,
          quadro de remuneração, matriz de skills e DNA VLMA. Base para o módulo de avaliação (Fase 1).
        </p>
        <Link href="/avaliacoes-pdi" className="mt-3 inline-block text-sm text-primary underline underline-offset-2">← voltar para Avaliações PDI</Link>
      </header>

      {loading ? <p className="text-sm text-ink-mute">Carregando catálogo…</p> : null}
      {error ? <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">Erro: {error}</p> : null}

      {data ? (
        <div className="space-y-12">
          {/* Régua */}
          <section>
            <h2 className="display-md mb-1 text-ink">Régua de avaliação</h2>
            <p className="mb-4 text-sm text-ink-mute">Escala única aplicada a todos os itens dos 3 eixos e ao resultado.</p>
            <div className="overflow-hidden rounded-xl border border-hairline bg-card">
              <table className="w-full text-sm">
                <thead className="bg-secondary text-xs text-ink-mute">
                  <tr className="text-left">
                    <th className="px-4 py-2 font-medium">Faixa</th>
                    <th className="px-4 py-2 font-medium">Progride</th>
                    <th className="px-4 py-2 font-medium">Bônus PDI</th>
                    <th className="px-4 py-2 font-medium">PLR Plus</th>
                    <th className="px-4 py-2 font-medium">Reflexo</th>
                  </tr>
                </thead>
                <tbody>
                  {data.regua.map((f) => (
                    <tr key={f.codigo} className="border-t border-hairline">
                      <td className="px-4 py-2.5">
                        <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${faixaColor(f.codigo)}`}>{f.rotulo}</span>
                      </td>
                      <td className="px-4 py-2.5"><Check on={f.progride} /></td>
                      <td className="px-4 py-2.5"><Check on={f.bonus_pdi} /></td>
                      <td className="px-4 py-2.5"><Check on={f.plr_plus_elegivel} /></td>
                      <td className="px-4 py-2.5 text-ink-secondary">{f.reflexo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Carreiras */}
          <section>
            <h2 className="display-md mb-1 text-ink">Carreiras (PCR)</h2>
            <p className="mb-4 text-sm text-ink-mute">5 carreiras · níveis Estagiário → Sênior · progressão em I / T / Y.</p>
            <div className="flex flex-wrap gap-2">
              {data.carreiras.map((c) => (
                <span key={c.codigo} className="rounded-full border border-hairline bg-card px-3 py-1.5 text-sm text-ink">{c.nome}</span>
              ))}
            </div>
          </section>

          {/* Quadro de remuneração */}
          <section>
            <h2 className="display-md mb-1 text-ink">Quadro de remuneração (QCRJ)</h2>
            <p className="mb-4 text-sm text-ink-mute">Salário por faixa × carreira. Colunas T = adicional Líder/Estratégico (10% a 20%).</p>
            <div className="overflow-x-auto rounded-xl border border-hairline bg-card">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="bg-secondary text-xs text-ink-mute">
                    <th className="px-3 py-2 text-left font-medium" rowSpan={2}>Faixa</th>
                    {carreirasQuadro.map((c) => (
                      <th key={c.codigo} className="border-l border-hairline px-3 py-2 text-center font-semibold text-ink" colSpan={3}>{c.nome}</th>
                    ))}
                  </tr>
                  <tr className="bg-secondary text-[10px] text-ink-mute">
                    {carreirasQuadro.map((c) => (
                      COLUNAS.map((col) => (
                        <th key={`${c.codigo}-${col.codigo}`} className="border-l border-hairline px-3 py-1 text-right font-medium">{col.label}</th>
                      ))
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {CARGO_ORDER.filter((cargo) => quadroMap[cargo]).map((cargo) => (
                    <tr key={cargo} className="border-t border-hairline">
                      <td className="px-3 py-2 font-medium text-ink">{CARGO_LABEL[cargo]}</td>
                      {carreirasQuadro.map((c) => (
                        COLUNAS.map((col) => {
                          const v = quadroMap[cargo]?.[`${c.codigo}|${col.codigo}`]
                          return <td key={`${cargo}-${c.codigo}-${col.codigo}`} className="border-l border-hairline px-3 py-2 text-right font-tabular text-ink-secondary">{money(v ?? null)}</td>
                        })
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Matriz de skills */}
          <section>
            <h2 className="display-md mb-1 text-ink">Matriz de skills</h2>
            <p className="mb-4 text-sm text-ink-mute">5 pilares base (itens por faixa) + trilhas adicionais Liderança e Estratégico.</p>
            <div className="space-y-8">
              {['base', 'lideranca', 'estrategico'].map((trilha) => {
                const pilaresTrilha = data.pilares.filter((p) => p.trilha === trilha).sort((a, b) => a.numero - b.numero)
                if (pilaresTrilha.length === 0) return null
                return (
                  <div key={trilha}>
                    <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-primary-soft-fg">{TRILHA_LABEL[trilha]}</h3>
                    <div className="space-y-4">
                      {pilaresTrilha.map((p) => {
                        const skillsPilar = data.skills.filter((s) => s.trilha === trilha && s.pilar_numero === p.numero)
                        return (
                          <div key={`${trilha}-${p.numero}`} className="overflow-hidden rounded-xl border border-hairline bg-card">
                            <div className="border-b border-hairline bg-canvas-soft px-4 py-2 text-sm font-semibold text-ink">{p.numero}. {p.nome}</div>
                            <div className="grid gap-px bg-hairline sm:grid-cols-2 lg:grid-cols-4">
                              {(trilha === 'base' ? NIVEIS.map((n) => n.codigo) : ['TODOS']).map((niv) => {
                                const items = skillsPilar.filter((s) => s.nivel_codigo === niv)
                                if (items.length === 0) return null
                                const titulo = items[0]?.titulo
                                const nivLabel = trilha === 'base' ? (NIVEIS.find((n) => n.codigo === niv)?.label || niv) : 'Todos os níveis elegíveis'
                                return (
                                  <div key={niv} className="bg-card p-3">
                                    <div className="text-eyebrow">{nivLabel}</div>
                                    <div className="mt-1 text-sm font-medium text-ink">{titulo}</div>
                                    <ul className="mt-1.5 space-y-1">
                                      {items.filter((i) => i.descricao).map((i) => (
                                        <li key={i.item_codigo} className="text-xs text-ink-mute">
                                          <span className="font-tabular text-ink-secondary">{i.item_codigo}</span> {i.descricao}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          {/* DNA */}
          <section>
            <h2 className="display-md mb-1 text-ink">DNA VLMA</h2>
            <p className="mb-4 text-sm text-ink-mute">6 valores culturais — avaliados para alinhamento, não compõem a média final.</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {data.dna.map((d) => (
                <div key={d.numero} className="rounded-xl border border-hairline bg-card p-4">
                  <div className="font-tabular text-2xl font-light text-primary">{d.numero}</div>
                  <div className="mt-1 text-sm font-medium text-ink">{d.nome}</div>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  )
}
