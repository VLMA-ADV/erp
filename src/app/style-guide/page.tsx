import { Button } from '@/components/ui/button'

export const metadata = { title: 'Design System · VLMA' }

function Swatch({ nome, hex, papel, dark }: { nome: string; hex: string; papel: string; dark?: boolean }) {
  return (
    <div className="overflow-hidden rounded-xl border border-hairline">
      <div className="h-20" style={{ background: hex }} />
      <div className="p-3">
        <div className="text-sm font-medium text-ink">{nome}</div>
        <div className="font-tabular text-xs text-ink-mute">{hex}</div>
        <div className="text-eyebrow mt-1">{papel}</div>
      </div>
    </div>
  )
}

function Wave({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 260 48" className={className} fill="none" aria-label="VLMA">
      <path
        d="M6 30 L26 30 L40 14 L54 38 L78 30 L78 18 L108 18 L122 38 L150 14 L178 38 L200 16 L222 38 L240 22"
        stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"
      />
      <circle cx="170" cy="16" r="6" fill="#FF9900" />
    </svg>
  )
}

export default function StyleGuidePage() {
  return (
    <div className="min-h-screen bg-canvas">
      <header className="gradient-mesh border-b border-hairline">
        <div className="container mx-auto px-6 py-12">
          <div className="text-ink"><Wave className="h-12 w-auto" /></div>
          <span className="text-eyebrow mt-4 block">Design System</span>
          <h1 className="display-lg mt-1 text-ink">Identidade VLMA aplicada</h1>
          <p className="mt-2 max-w-xl text-ink-mute">
            Tokens de cor, tipografia híbrida (Darker Grotesque nos títulos, Inter no corpo) e componentes reais do ERP com a nova marca.
          </p>
        </div>
      </header>

      <main className="container mx-auto space-y-12 px-6 py-12">
        <section>
          <span className="text-eyebrow">Paleta</span>
          <h2 className="display-md mt-1 mb-4 text-ink">Cores da marca</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Swatch nome="Base · cinza" hex="#F5F5F5" papel="fundo neutro" />
            <Swatch nome="Laranja" hex="#FF9900" papel="primária · CTA" />
            <Swatch nome="Vermelho" hex="#FF3333" papel="secundária · perigo" />
            <Swatch nome="Escuro (ink)" hex="#1E1423" papel="texto · complementar" />
          </div>
        </section>

        <section>
          <span className="text-eyebrow">Tipografia</span>
          <h2 className="display-md mt-1 mb-4 text-ink">Darker Grotesque + Inter</h2>
          <div className="rounded-xl border border-hairline bg-card p-6">
            <h1 className="display-xl text-ink">Olá, olá!</h1>
            <h3 className="display-lg mt-2 text-ink">Título de seção</h3>
            <p className="text-eyebrow mt-4">Legenda · caixa alta</p>
            <p className="mt-2 max-w-2xl text-ink-secondary">
              Texto corrido em Inter Regular para leitura confortável em telas densas — tabelas, formulários e listas. Os títulos usam Darker Grotesque para carregar a personalidade da marca.
            </p>
            <p className="font-tabular mt-3 text-lg text-ink">0123456789 · R$ 4.632.000,00</p>
          </div>
        </section>

        <section>
          <span className="text-eyebrow">Componentes</span>
          <h2 className="display-md mt-1 mb-4 text-ink">Botões, badges e cards</h2>
          <div className="space-y-6 rounded-xl border border-hairline bg-card p-6">
            <div className="flex flex-wrap items-center gap-3">
              <Button>Ação primária</Button>
              <Button variant="outline">Secundária</Button>
              <Button variant="ghost">Fantasma</Button>
              <Button variant="destructive">Excluir</Button>
            </div>

            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">Em andamento</span>
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">Aprovado</span>
              <span className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">Atrasado</span>
              <span className="rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-ink-secondary">Rascunho</span>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="rounded-xl border border-hairline bg-card p-4">
                <div className="text-eyebrow">Oportunidades</div>
                <div className="font-tabular mt-1 text-3xl font-light text-ink">29</div>
                <div className="mt-2 h-1.5 rounded-full bg-secondary"><div className="h-1.5 w-3/4 rounded-full bg-primary" /></div>
              </div>
              <div className="rounded-xl border border-hairline bg-card p-4">
                <div className="text-eyebrow">Valor potencial</div>
                <div className="font-tabular mt-1 text-2xl font-light text-ink">R$ 4,6M</div>
                <div className="mt-2 h-1.5 rounded-full bg-secondary"><div className="h-1.5 w-1/2 rounded-full bg-destructive" /></div>
              </div>
              <div className="space-y-2 rounded-xl border border-hairline bg-card p-4">
                <label className="text-xs text-ink-mute">Campo de texto</label>
                <input
                  className="h-9 w-full rounded-md border border-hairline-input bg-background px-3 text-sm text-ink outline-none focus:ring-2 focus:ring-ring"
                  placeholder="Digite aqui…"
                  defaultValue="Conteúdo"
                />
              </div>
            </div>
          </div>
        </section>

        <section>
          <span className="text-eyebrow">Aplicação</span>
          <h2 className="display-md mt-1 mb-4 text-ink">Exemplo de cabeçalho de página</h2>
          <div className="overflow-hidden rounded-xl border border-hairline">
            <div className="flex">
              <aside className="hidden w-48 shrink-0 p-4 text-sm sm:block" style={{ background: 'hsl(var(--brand-dark))' }}>
                <div className="text-white/90"><Wave className="h-7 w-auto" /></div>
                <nav className="mt-6 space-y-1">
                  <div className="rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground">Dashboard</div>
                  <div className="rounded-md px-3 py-2 text-white/70">Contratos</div>
                  <div className="rounded-md px-3 py-2 text-white/70">CRM</div>
                  <div className="rounded-md px-3 py-2 text-white/70">Financeiro</div>
                </nav>
              </aside>
              <div className="flex-1 bg-canvas p-6">
                <span className="text-eyebrow">Comercial</span>
                <h3 className="display-lg mt-1 text-ink">CRM</h3>
                <p className="mt-1 text-sm text-ink-mute">Acompanhe oportunidades da prospecção à conversão.</p>
                <div className="mt-4 flex gap-2">
                  <Button>Novo card</Button>
                  <Button variant="outline">Atualizar</Button>
                </div>
              </div>
            </div>
          </div>
        </section>
        <section>
          <span className="text-eyebrow">Exemplos de telas</span>
          <h2 className="display-md mt-1 mb-4 text-ink">Como ficaria no sistema</h2>

          <div className="space-y-6">
            {/* Dashboard */}
            <div className="overflow-hidden rounded-xl border border-hairline bg-canvas">
              <div className="border-b border-hairline px-5 py-3">
                <span className="text-eyebrow">Financeiro</span>
                <h4 className="display-md text-ink">Dashboard</h4>
              </div>
              <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-4">
                {[
                  { l: 'Contratos ativos', v: '402' },
                  { l: 'Casos ativos', v: '1.068' },
                  { l: 'Novos no mês', v: '618' },
                  { l: 'Valor potencial', v: 'R$ 4,6M' },
                ].map((k) => (
                  <div key={k.l} className="rounded-xl bg-secondary p-4">
                    <div className="text-eyebrow">{k.l}</div>
                    <div className="font-tabular mt-1 text-2xl font-light text-ink">{k.v}</div>
                  </div>
                ))}
                <div className="col-span-2 rounded-xl border border-hairline bg-card p-4 sm:col-span-4">
                  <div className="text-eyebrow mb-3">Por centro de custo</div>
                  <div className="space-y-2">
                    {[
                      { n: 'Trabalhista', w: '100%', v: 349 },
                      { n: 'Contencioso', w: '79%', v: 276 },
                      { n: 'Societário', w: '30%', v: 105 },
                      { n: 'Tributário', w: '12%', v: 42 },
                    ].map((b, i) => (
                      <div key={b.n} className="text-sm">
                        <div className="flex justify-between text-ink-secondary"><span>{b.n}</span><span className="font-tabular">{b.v}</span></div>
                        <div className="mt-1 h-2 rounded-full bg-secondary"><div className="h-2 rounded-full" style={{ width: b.w, background: i === 0 ? '#FF9900' : i === 1 ? '#FF3333' : '#1E1423' }} /></div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* CRM card */}
              <div className="rounded-xl border border-hairline bg-canvas-soft p-4">
                <div className="text-eyebrow mb-3">CRM · card de oportunidade</div>
                <div className="rounded-xl border border-hairline bg-card p-4 shadow-sm">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-medium text-ink">Força Agro LTDA</div>
                      <div className="text-xs text-ink-mute">Agronegócio</div>
                    </div>
                    <span className="rounded-full bg-primary-soft px-2 py-0.5 text-xs font-semibold" style={{ background: 'hsl(var(--primary-soft-bg))', color: 'hsl(var(--primary-soft-fg))' }}>Em standby</span>
                  </div>
                  <div className="mt-3 space-y-1.5 text-xs text-ink-mute">
                    <div>Tributário · Consultivo</div>
                    <div className="font-tabular text-base font-medium text-ink">R$ 70.000</div>
                    <div>Global: R$ 120.000 · parcelado</div>
                    <div>
                      <div className="flex justify-between"><span>Temperatura</span><span className="font-medium text-ink">80%</span></div>
                      <div className="mt-1 h-1.5 rounded-full bg-secondary"><div className="h-1.5 rounded-full" style={{ width: '80%', background: 'hsl(28 90% 50%)' }} /></div>
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button size="sm">Editar</Button>
                    <Button size="sm" variant="outline">Mover</Button>
                  </div>
                </div>
              </div>

              {/* Tabela */}
              <div className="rounded-xl border border-hairline bg-canvas-soft p-4">
                <div className="text-eyebrow mb-3">Colaboradores · lista</div>
                <div className="overflow-hidden rounded-xl border border-hairline bg-card">
                  <table className="w-full text-sm">
                    <thead className="bg-secondary">
                      <tr className="text-left text-xs text-ink-mute">
                        <th className="px-3 py-2 font-medium">Nome</th>
                        <th className="px-3 py-2 font-medium">Cargo</th>
                        <th className="px-3 py-2 text-center font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { n: 'Amanda Del Vechio', c: 'Senior 4', a: true },
                        { n: 'Leonardo Pimentel', c: 'Sócio', a: true },
                        { n: 'Tiago Ecker', c: 'Pleno 1', a: false },
                      ].map((r) => (
                        <tr key={r.n} className="border-t border-hairline">
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-2">
                              <span className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-medium" style={{ background: 'hsl(var(--primary-soft-bg))', color: 'hsl(var(--primary-soft-fg))' }}>{r.n.split(' ').map((p) => p[0]).slice(0, 2).join('')}</span>
                              <span className="text-ink">{r.n}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-ink-secondary">{r.c}</td>
                          <td className="px-3 py-2.5 text-center">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${r.a ? 'bg-emerald-50 text-emerald-700' : 'bg-secondary text-ink-mute'}`}>{r.a ? 'Ativo' : 'Inativo'}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Login */}
            <div className="rounded-xl border border-hairline bg-canvas-soft p-6">
              <div className="text-eyebrow mb-3">Tela de login</div>
              <div className="mx-auto max-w-sm rounded-xl border border-hairline bg-card p-6 text-center">
                <div className="mx-auto w-fit text-ink"><Wave className="h-9 w-auto" /></div>
                <span className="text-eyebrow mt-4 block">VLMA · ERP</span>
                <h3 className="display-md mt-1 text-ink">Entre na sua conta</h3>
                <div className="mt-5 space-y-3 text-left">
                  <input className="h-10 w-full rounded-md border border-hairline-input bg-background px-3 text-sm text-ink outline-none focus:ring-2 focus:ring-ring" placeholder="seu@email.com" />
                  <input className="h-10 w-full rounded-md border border-hairline-input bg-background px-3 text-sm text-ink outline-none focus:ring-2 focus:ring-ring" placeholder="••••••••" />
                  <Button className="w-full">Entrar</Button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
