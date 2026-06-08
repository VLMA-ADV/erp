'use client'

import { useState, useEffect } from 'react'

export const APP_VERSION = '1.1.0'

interface ChangeItem {
  icon: string
  title: string
  desc: string
}
interface Release {
  version: string
  date: string
  destaque?: boolean
  items: ChangeItem[]
}

// Mantenha o mais recente no topo. `destaque` realça o release novo.
const CHANGELOG: Release[] = [
  {
    version: '1.1.0',
    date: '09/06/2026',
    destaque: true,
    items: [
      {
        icon: '📊',
        title: 'Relatório de Colaboradores',
        desc: 'Nova opção em Relatórios → Personalizados: gere a base completa de colaboradores (cargo, centro de custo, contato, status e dados cadastrais) com filtros e exportação para Excel.',
      },
      {
        icon: '⚙️',
        title: 'Permissões padronizadas',
        desc: 'Acesso por perfil ficou mais claro e consistente — cada cargo enxerga apenas o que é do seu escopo.',
      },
    ],
  },
  {
    version: '1.0.0',
    date: '04/02/2026',
    items: [
      { icon: '🚀', title: 'Lançamento do ERP', desc: 'Contratos, Casos, CRM, Faturamento, Timesheet, Pessoas e Configurações.' },
    ],
  },
]

export default function Novidades() {
  const [open, setOpen] = useState(false)
  const [temNovidade, setTemNovidade] = useState(false)

  useEffect(() => {
    try {
      setTemNovidade(localStorage.getItem('vlma_versao_vista') !== APP_VERSION)
    } catch {
      /* localStorage indisponível */
    }
  }, [])

  const abrir = () => {
    setOpen(true)
    setTemNovidade(false)
    try {
      localStorage.setItem('vlma_versao_vista', APP_VERSION)
    } catch {
      /* noop */
    }
  }

  return (
    <>
      <button
        onClick={abrir}
        className="group mt-0.5 flex items-center gap-1.5 text-xs text-ink-mute transition-colors hover:text-primary"
        title="Ver novidades"
      >
        <span>Versão {APP_VERSION}</span>
        {temNovidade && (
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
          </span>
        )}
        <span
          className={`rounded-pill px-1.5 py-px text-[10px] font-semibold transition-colors ${
            temNovidade
              ? 'bg-primary-soft-bg text-primary-deep'
              : 'text-ink-mute group-hover:text-primary'
          }`}
        >
          Novidades
        </span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-brand-dark/40 p-4 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md overflow-hidden rounded-xl bg-canvas shadow-lift-2 animate-in fade-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* header com degradê da marca */}
            <div className="bg-gradient-to-br from-brand-dark to-primary-press px-6 py-5 text-white">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary-soft-bg/90">
                Novidades
              </p>
              <h2 className="mt-1 text-xl font-bold tracking-tight">O que há de novo</h2>
              <p className="mt-1 text-sm text-white/80">Versão {APP_VERSION} · VLMA ERP</p>
            </div>

            {/* conteúdo */}
            <div className="max-h-[60vh] space-y-6 overflow-y-auto px-6 py-5">
              {CHANGELOG.map((rel) => (
                <div key={rel.version}>
                  <div className="mb-3 flex items-center gap-2">
                    <span
                      className={`rounded-pill px-2 py-0.5 text-xs font-bold ${
                        rel.destaque
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-canvas-soft text-ink-mute'
                      }`}
                    >
                      v{rel.version}
                    </span>
                    <span className="text-xs text-ink-mute">{rel.date}</span>
                  </div>
                  <div className="space-y-3">
                    {rel.items.map((it) => (
                      <div
                        key={it.title}
                        className={`flex gap-3 rounded-lg p-3 ${
                          rel.destaque ? 'bg-primary-soft-bg/40' : 'bg-canvas-soft'
                        }`}
                      >
                        <span className="text-xl leading-none">{it.icon}</span>
                        <div>
                          <h3 className="text-sm font-semibold text-ink">{it.title}</h3>
                          <p className="mt-0.5 text-[13px] leading-snug text-ink-secondary">
                            {it.desc}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* footer */}
            <div className="flex justify-end border-t border-hairline px-6 py-3">
              <button
                onClick={() => setOpen(false)}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-deep"
              >
                Entendi
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
