'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/toast'

/**
 * Configuração da cobrança por boleto (Itaú).
 *
 * A tabela finance.boleto_config existe desde 14/08, mas até aqui só dava para
 * preenchê-la por SQL — o que não serve para quem decide, que é o escritório.
 * Esta tela é o que faltava para o Filipe responder as seis decisões de
 * negócio sem depender de mim.
 *
 * O texto de cada campo é escrito para advogado, não para quem integra API: o
 * que a escolha significa para o cliente que recebe o boleto, não o código que
 * vai no payload.
 */
interface Config {
  ativo: boolean
  id_beneficiario: string | null
  codigo_carteira: string
  codigo_especie: string
  nosso_numero_inicio: number
  nosso_numero_fim: number
  multa_tipo: 'isento' | 'valor' | 'percentual'
  multa_valor: number | null
  multa_percentual: number | null
  multa_dias: number
  juros_ativo: boolean
  juros_percentual_mes: number | null
  juros_dias: number
  desconto_expresso: boolean
  protesto_ativo: boolean
  protesto_dias: number | null
  negativacao_ativo: boolean
  negativacao_dias: number | null
  dias_limite_pagamento: number | null
  forma_envio: 'escritorio' | 'itau'
}

const VAZIO: Config = {
  ativo: false, id_beneficiario: '', codigo_carteira: '109', codigo_especie: '01',
  nosso_numero_inicio: 1, nosso_numero_fim: 99999999,
  multa_tipo: 'isento', multa_valor: null, multa_percentual: null, multa_dias: 1,
  juros_ativo: false, juros_percentual_mes: null, juros_dias: 1,
  desconto_expresso: false,
  protesto_ativo: false, protesto_dias: null,
  negativacao_ativo: false, negativacao_dias: null,
  dias_limite_pagamento: null, forma_envio: 'escritorio',
}

function Secao({ numero, titulo, descricao, children }: {
  numero: number; titulo: string; descricao: string; children: React.ReactNode
}) {
  return (
    <section className="rounded-lg border border-hairline bg-white p-5">
      <div className="mb-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-ink">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
            {numero}
          </span>
          {titulo}
        </h2>
        <p className="mt-1.5 text-sm text-ink-mute">{descricao}</p>
      </div>
      {children}
    </section>
  )
}

export default function CobrancaBoletoForm() {
  const { success, error: toastError } = useToast()
  const [cfg, setCfg] = useState<Config>(VAZIO)
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [testando, setTestando] = useState(false)
  const [conexao, setConexao] = useState<{ ok: boolean; texto: string } | null>(null)

  const set = <K extends keyof Config>(k: K, v: Config[K]) => setCfg((p) => ({ ...p, [k]: v }))

  const carregar = useCallback(async () => {
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase.rpc('bol_config_get', { p_user_id: user.id })
      if (data) setCfg({ ...VAZIO, ...(data as Partial<Config>) })
    } catch (err) {
      console.error(err)
    } finally {
      setCarregando(false)
    }
    // O toast vem do contexto e muda de identidade a cada render; incluí-lo
    // aqui prenderia a tela em "carregando" para sempre.
  }, [])

  useEffect(() => { void carregar() }, [carregar])

  const salvar = async () => {
    if (cfg.ativo && !cfg.id_beneficiario?.trim()) {
      toastError('Para ligar a cobrança é preciso informar o beneficiário do Itaú.')
      return
    }
    try {
      setSalvando(true)
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { error } = await supabase.rpc('bol_config_upsert', { p_user_id: user.id, p_config: cfg })
      if (error) throw error
      success('Configuração salva')
      await carregar()
    } catch (err) {
      console.error(err)
      toastError(err instanceof Error ? err.message : 'Erro ao salvar')
    } finally {
      setSalvando(false)
    }
  }

  const testar = async () => {
    try {
      setTestando(true)
      setConexao(null)
      const r = await fetch('/api/boletos/testar-conexao')
      const d = await r.json()
      setConexao(
        d.ok
          ? { ok: true, texto: `Conectado ao Itaú em ${d.ms}ms. Certificado válido até ${d.certificado?.vence_em}.` }
          : { ok: false, texto: d.detalhe || d.error || `Falhou na etapa: ${d.etapa}` },
      )
    } catch {
      setConexao({ ok: false, texto: 'Não foi possível falar com o servidor.' })
    } finally {
      setTestando(false)
    }
  }

  if (carregando) return <p className="p-6 text-sm text-ink-mute">Carregando…</p>

  return (
    <div className="space-y-5">
      <Secao
        numero={1}
        titulo="Conexão com o banco"
        descricao="Estes dados vêm do Itaú. Sem eles o boleto não sai — o banco precisa saber de qual conta a cobrança parte."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="space-y-1 md:col-span-2">
            <Label>Beneficiário (id_beneficiario)</Label>
            <Input
              value={cfg.id_beneficiario ?? ''}
              onChange={(e) => set('id_beneficiario', e.target.value)}
              placeholder="peça ao Itaú — identifica a conta de cobrança"
            />
          </div>
          <div className="space-y-1">
            <Label>Carteira</Label>
            <Input value={cfg.codigo_carteira} onChange={(e) => set('codigo_carteira', e.target.value)} />
            <p className="text-xs text-ink-mute">Padrão 109. Confirme com o gerente.</p>
          </div>
          <div className="space-y-1">
            <Label>Espécie do título</Label>
            <Input value={cfg.codigo_especie} onChange={(e) => set('codigo_especie', e.target.value)} />
            <p className="text-xs text-ink-mute">01 = duplicata de serviço.</p>
          </div>
          <div className="space-y-1">
            <Label>Nosso número — de</Label>
            <Input
              type="number"
              value={cfg.nosso_numero_inicio}
              onChange={(e) => set('nosso_numero_inicio', Number(e.target.value))}
            />
          </div>
          <div className="space-y-1">
            <Label>Nosso número — até</Label>
            <Input
              type="number"
              value={cfg.nosso_numero_fim}
              onChange={(e) => set('nosso_numero_fim', Number(e.target.value))}
            />
            <p className="text-xs text-ink-mute">A faixa que o banco liberou para a conta.</p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-hairline pt-4">
          <Button variant="outline" onClick={() => void testar()} disabled={testando}>
            {testando ? 'Testando…' : 'Testar conexão com o Itaú'}
          </Button>
          {conexao ? (
            <span className={`text-sm ${conexao.ok ? 'text-green-700' : 'text-destructive'}`}>
              {conexao.ok ? '✓ ' : '✕ '}{conexao.texto}
            </span>
          ) : (
            <span className="text-xs text-ink-mute">Não emite nada — só confere se o banco responde.</span>
          )}
        </div>
      </Secao>

      <Secao
        numero={2}
        titulo="O que cobrar de quem atrasar"
        descricao="Tudo começa desligado. Um boleto que cobra a menos é um problema comercial; um que cobra encargo que o cliente nunca combinou é um problema jurídico."
      >
        <div className="space-y-4">
          <div>
            <Label>Multa por atraso</Label>
            <div className="mt-1.5 flex flex-wrap items-center gap-3">
              <select
                className="h-10 rounded-md border border-hairline px-3 text-sm"
                value={cfg.multa_tipo}
                onChange={(e) => set('multa_tipo', e.target.value as Config['multa_tipo'])}
              >
                <option value="isento">Não cobrar multa</option>
                <option value="percentual">Percentual sobre o valor</option>
                <option value="valor">Valor fixo em reais</option>
              </select>
              {cfg.multa_tipo === 'percentual' ? (
                <Input
                  className="w-28" type="number" step="0.01" placeholder="2,00"
                  value={cfg.multa_percentual ?? ''}
                  onChange={(e) => set('multa_percentual', e.target.value === '' ? null : Number(e.target.value))}
                />
              ) : null}
              {cfg.multa_tipo === 'valor' ? (
                <Input
                  className="w-32" type="number" step="0.01" placeholder="50,00"
                  value={cfg.multa_valor ?? ''}
                  onChange={(e) => set('multa_valor', e.target.value === '' ? null : Number(e.target.value))}
                />
              ) : null}
              {cfg.multa_tipo !== 'isento' ? (
                <span className="text-sm text-ink-mute">
                  a partir de
                  <Input
                    className="mx-2 inline-block w-16" type="number"
                    value={cfg.multa_dias}
                    onChange={(e) => set('multa_dias', Number(e.target.value))}
                  />
                  dia(s) de atraso
                </span>
              ) : null}
            </div>
          </div>

          <div>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox" className="h-4 w-4"
                checked={cfg.juros_ativo}
                onChange={(e) => set('juros_ativo', e.target.checked)}
              />
              Cobrar juros por atraso
            </label>
            {cfg.juros_ativo ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-mute">
                <Input
                  className="w-24" type="number" step="0.01" placeholder="1,00"
                  value={cfg.juros_percentual_mes ?? ''}
                  onChange={(e) => set('juros_percentual_mes', e.target.value === '' ? null : Number(e.target.value))}
                />
                % ao mês, a partir de
                <Input
                  className="w-16" type="number"
                  value={cfg.juros_dias}
                  onChange={(e) => set('juros_dias', Number(e.target.value))}
                />
                dia(s)
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox" className="h-4 w-4"
                  checked={cfg.protesto_ativo}
                  onChange={(e) => set('protesto_ativo', e.target.checked)}
                />
                Mandar a protesto
              </label>
              {cfg.protesto_ativo ? (
                <div className="mt-2 flex items-center gap-2 text-sm text-ink-mute">
                  após
                  <Input
                    className="w-16" type="number"
                    value={cfg.protesto_dias ?? ''}
                    onChange={(e) => set('protesto_dias', e.target.value === '' ? null : Number(e.target.value))}
                  />
                  dia(s) do vencimento
                </div>
              ) : (
                <p className="mt-1 text-xs text-ink-mute">O banco protesta automaticamente. Pesa na relação.</p>
              )}
            </div>
            <div>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox" className="h-4 w-4"
                  checked={cfg.negativacao_ativo}
                  onChange={(e) => set('negativacao_ativo', e.target.checked)}
                />
                Negativar o cliente
              </label>
              {cfg.negativacao_ativo ? (
                <div className="mt-2 flex items-center gap-2 text-sm text-ink-mute">
                  após
                  <Input
                    className="w-16" type="number"
                    value={cfg.negativacao_dias ?? ''}
                    onChange={(e) => set('negativacao_dias', e.target.value === '' ? null : Number(e.target.value))}
                  />
                  dia(s) do vencimento
                </div>
              ) : (
                <p className="mt-1 text-xs text-ink-mute">Inclui o CNPJ do cliente nos órgãos de proteção.</p>
              )}
            </div>
          </div>
        </div>
      </Secao>

      <Secao
        numero={3}
        titulo="Prazo e entrega"
        descricao="Até quando o boleto aceita pagamento, e quem manda ele para o cliente."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <Label>Aceitar pagamento até</Label>
            <div className="flex items-center gap-2 text-sm text-ink-mute">
              <Input
                className="w-20" type="number" placeholder="—"
                value={cfg.dias_limite_pagamento ?? ''}
                onChange={(e) => set('dias_limite_pagamento', e.target.value === '' ? null : Number(e.target.value))}
              />
              dia(s) depois do vencimento
            </div>
            <p className="text-xs text-ink-mute">Em branco, o boleto segue pagável sem prazo limite.</p>
          </div>
          <div className="space-y-1">
            <Label>Quem entrega o boleto</Label>
            <select
              className="h-10 w-full rounded-md border border-hairline px-3 text-sm"
              value={cfg.forma_envio}
              onChange={(e) => set('forma_envio', e.target.value as Config['forma_envio'])}
            >
              <option value="escritorio">O escritório, junto da fatura</option>
              <option value="itau">O Itaú, por e-mail</option>
            </select>
            <p className="text-xs text-ink-mute">
              Pelo escritório, o boleto vai anexo no mesmo e-mail da nota — o cliente recebe tudo de uma vez.
            </p>
          </div>
        </div>
      </Secao>

      <Secao
        numero={4}
        titulo="Ligar a cobrança"
        descricao="Enquanto estiver desligada, nenhum boleto é gerado, mesmo com tudo preenchido."
      >
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox" className="h-4 w-4"
            checked={cfg.ativo}
            onChange={(e) => set('ativo', e.target.checked)}
          />
          Emitir boletos pelo ERP
        </label>
        {cfg.ativo ? (
          <Alert className="mt-3 border-amber-300 bg-amber-50 text-amber-900">
            <AlertTitle>Não existe ambiente de teste nesta API</AlertTitle>
            <AlertDescription>
              A credencial do Itaú aponta direto para produção. O primeiro boleto será real e cobrável — faça com
              valor baixo, num cliente conhecido, e dê baixa em seguida.
            </AlertDescription>
          </Alert>
        ) : null}
      </Secao>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => void carregar()} disabled={salvando}>Descartar</Button>
        <Button onClick={() => void salvar()} disabled={salvando}>
          {salvando ? 'Salvando…' : 'Salvar configuração'}
        </Button>
      </div>
    </div>
  )
}
