'use client'

import { useEffect, useState } from 'react'
import { FileText, Loader2, Printer, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

// Lista oficial do contador Guilherme (mensagem WhatsApp 21/05 16:24):
//   COFINS 3,00% (mínimo cálculo R$ 215,34, mínimo retenção R$ 6,46)
//   CSLL   1,00% (mínimo cálculo R$ 215,34, mínimo retenção R$ 2,15)
//   PIS    0,65% (mínimo cálculo R$ 215,34, mínimo retenção R$ 1,40)
//   IRRF   1,50% (mínimo cálculo R$ 666,67, mínimo retenção R$ 10,00)
// Sem INSS — confirmado pelo contador que VLMA não retém INSS na fonte.
const ALIQUOTAS_VOA_LEGAL = {
  iss: { aliquota: 3.5, label: 'ISS' }, // municipal Curitiba, fiscal real
  irrf: { aliquota: 1.5, minCalc: 666.67, minRet: 10, label: 'IRRF' },
  pis: { aliquota: 0.65, minCalc: 215.34, minRet: 1.4, label: 'PIS' },
  cofins: { aliquota: 3, minCalc: 215.34, minRet: 6.46, label: 'COFINS' },
  csll: { aliquota: 1, minCalc: 215.34, minRet: 2.15, label: 'CSLL' },
}

// 7 Grupos de impostos da VLMA (mensagem contador 21/05 16:24 + decisão Filipe na call 20/05):
type GrupoImpostoNome = 'PJ Nacional' | 'PF Nacional' | 'Estrangeiro' | 'IRRF' | 'PJ sem mínimo' | 'IRRF sem mínimo' | 'Sem IRRF'

interface RegraGrupo {
  retem: { irrf: boolean; pis: boolean; cofins: boolean; csll: boolean }
  respeitaMinimo: boolean
  observacao: string
}

const REGRAS_GRUPOS: Record<GrupoImpostoNome, RegraGrupo> = {
  'PJ Nacional': {
    retem: { irrf: true, pis: true, cofins: true, csll: true },
    respeitaMinimo: true,
    observacao: 'Retenção dos 4 impostos respeitando valor mínimo',
  },
  'PF Nacional': {
    retem: { irrf: false, pis: false, cofins: false, csll: false },
    respeitaMinimo: false,
    observacao: 'Sem retenções',
  },
  Estrangeiro: {
    retem: { irrf: false, pis: false, cofins: false, csll: false },
    respeitaMinimo: false,
    observacao: 'Sem retenções',
  },
  IRRF: {
    retem: { irrf: true, pis: false, cofins: false, csll: false },
    respeitaMinimo: true,
    observacao: 'Apenas IRRF, respeitando valor mínimo',
  },
  'PJ sem mínimo': {
    retem: { irrf: true, pis: true, cofins: true, csll: true },
    respeitaMinimo: false,
    observacao: 'Retenção dos 4 impostos, independente de valor',
  },
  'IRRF sem mínimo': {
    retem: { irrf: true, pis: false, cofins: false, csll: false },
    respeitaMinimo: false,
    observacao: 'Apenas IRRF, independente de valor',
  },
  'Sem IRRF': {
    retem: { irrf: false, pis: true, cofins: true, csll: true },
    respeitaMinimo: true,
    observacao: 'COFINS + CSLL + PIS (sem IRRF)',
  },
}

function inferGrupoFallback(tipoTomador: 'PF' | 'PJ' | null): GrupoImpostoNome {
  if (tipoTomador === 'PF') return 'PF Nacional'
  return 'PJ Nacional'
}

function fmtMoney(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtPct(value: number): string {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) + '%'
}

function formatCnpjCpf(doc: string | null | undefined): string {
  if (!doc) return '—'
  const digits = doc.replace(/\D/g, '')
  if (digits.length === 14) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`
  }
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`
  }
  return doc
}

function formatCep(cep: string | null | undefined): string {
  if (!cep) return '—'
  const digits = cep.replace(/\D/g, '')
  if (digits.length === 8) return `${digits.slice(0, 5)}-${digits.slice(5)}`
  return cep
}

interface NfsePreviewDialogProps {
  open: boolean
  contratoId: string | null
  contratoLabel?: string | null
  onClose: () => void
  onConfirmEmit?: () => void
}

interface DatasetItem {
  id: string
  valor: number
  snapshot: Record<string, any>
}

interface PreviewData {
  itens: DatasetItem[]
  contrato: any | null
  tomador: any | null
  grupoImposto: any | null
  prestador: {
    nome: string
    cnpj: string
    inscricaoMunicipal: string
    endereco: string
    municipio: string
  }
}

export default function NfsePreviewDialog({
  open,
  contratoId,
  contratoLabel,
  onClose,
  onConfirmEmit,
}: NfsePreviewDialogProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<PreviewData | null>(null)

  useEffect(() => {
    if (!open || !contratoId) {
      setData(null)
      setError(null)
      return
    }
    void loadPreviewData(contratoId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, contratoId])

  const loadPreviewData = async (id: string) => {
    try {
      setLoading(true)
      setError(null)
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setError('Sessão expirada — faça login novamente.')
        return
      }

      const { data: tenantId } = await supabase.rpc('get_tenant_for_user', { p_user_id: user.id })
      if (!tenantId) {
        setError('Usuário não associado a tenant.')
        return
      }

      const { data: dataset } = await supabase.rpc('get_billing_items_aprovados_full', {
        p_tenant_id: tenantId,
        p_contrato_id: id,
      })

      if (!dataset || !dataset.itens || dataset.itens.length === 0) {
        setError('Nenhum item aprovado encontrado para gerar a prévia.')
        return
      }

      const { data: cfg } = await supabase.rpc('get_focus_nfe_config', { p_tenant_id: tenantId })

      setData({
        itens: dataset.itens as DatasetItem[],
        contrato: dataset.contrato || null,
        tomador: dataset.tomador || null,
        grupoImposto: dataset.grupo_imposto || null,
        prestador: {
          nome: 'Di Lascio, Vosgerau & Advogados Associados',
          cnpj: cfg?.cnpj || '14491612000139',
          inscricaoMunicipal: cfg?.inscricao_municipal || '6265382',
          endereco: cfg
            ? `${cfg.logradouro_prestador || ''}, ${cfg.numero_prestador || ''} — ${cfg.bairro_prestador || ''} · CEP ${formatCep(cfg.cep_prestador)}`
            : 'Rua Cândido Xavier, 602 — Água Verde · CEP 80240-280',
          municipio: 'Curitiba/PR',
        },
      })
    } catch (e) {
      console.error('NfsePreviewDialog.loadPreviewData', e)
      setError('Erro ao carregar dados da prévia.')
    } finally {
      setLoading(false)
    }
  }

  const valorBruto = data?.itens.reduce((s, i) => s + Number(i.valor ?? 0), 0) ?? 0
  const aliquotaIss = Number(data?.grupoImposto?.aliquota_iss ?? ALIQUOTAS_VOA_LEGAL.iss.aliquota)
  const tipoTomador =
    data?.tomador?.cnpj && String(data.tomador.cnpj).replace(/\D/g, '').length === 14 ? 'PJ' : 'PF'

  // Determina o grupo de impostos do contrato.
  // Preferência: dados do banco (colunas retem_* + aliquota_* + min_*).
  // Fallback: REGRAS_GRUPOS hardcoded por nome (compatibilidade com grupos antigos sem colunas).
  const grupoFromDb = data?.grupoImposto
  const grupoNomeRaw = grupoFromDb?.nome as string | undefined
  const grupoNome: GrupoImpostoNome = (grupoNomeRaw && REGRAS_GRUPOS[grupoNomeRaw as GrupoImpostoNome])
    ? (grupoNomeRaw as GrupoImpostoNome)
    : inferGrupoFallback(tipoTomador)
  const regraFallback = REGRAS_GRUPOS[grupoNome]

  // Helper que prefere o valor do banco se preenchido, senão usa o fallback hardcoded.
  const grupoConfig = {
    retemIrrf: grupoFromDb?.retem_irrf ?? regraFallback.retem.irrf,
    retemPis: grupoFromDb?.retem_pis ?? regraFallback.retem.pis,
    retemCofins: grupoFromDb?.retem_cofins ?? regraFallback.retem.cofins,
    retemCsll: grupoFromDb?.retem_csll ?? regraFallback.retem.csll,
    respeitaMinimo: grupoFromDb?.respeita_minimo ?? regraFallback.respeitaMinimo,
    aliquotaIrrf: Number(grupoFromDb?.aliquota_irrf ?? ALIQUOTAS_VOA_LEGAL.irrf.aliquota),
    aliquotaPis: Number(grupoFromDb?.aliquota_pis ?? ALIQUOTAS_VOA_LEGAL.pis.aliquota),
    aliquotaCofins: Number(grupoFromDb?.aliquota_cofins ?? ALIQUOTAS_VOA_LEGAL.cofins.aliquota),
    aliquotaCsll: Number(grupoFromDb?.aliquota_csll ?? ALIQUOTAS_VOA_LEGAL.csll.aliquota),
    minCalcIrrf: Number(grupoFromDb?.min_calc_irrf ?? ALIQUOTAS_VOA_LEGAL.irrf.minCalc),
    minCalcPisCofinsCsll: Number(grupoFromDb?.min_calc_pis_cofins_csll ?? ALIQUOTAS_VOA_LEGAL.pis.minCalc),
    minRetIrrf: Number(grupoFromDb?.min_ret_irrf ?? ALIQUOTAS_VOA_LEGAL.irrf.minRet),
    minRetPis: Number(grupoFromDb?.min_ret_pis ?? ALIQUOTAS_VOA_LEGAL.pis.minRet),
    minRetCofins: Number(grupoFromDb?.min_ret_cofins ?? ALIQUOTAS_VOA_LEGAL.cofins.minRet),
    minRetCsll: Number(grupoFromDb?.min_ret_csll ?? ALIQUOTAS_VOA_LEGAL.csll.minRet),
  }

  // Calcula retenção respeitando o min_calc/min_ret específicos de cada imposto.
  const calcRetencao = (imp: 'irrf' | 'pis' | 'cofins' | 'csll'): { valor: number; aplicado: boolean; motivo?: string } => {
    const retem = imp === 'irrf' ? grupoConfig.retemIrrf
      : imp === 'pis' ? grupoConfig.retemPis
      : imp === 'cofins' ? grupoConfig.retemCofins
      : grupoConfig.retemCsll
    if (!retem) return { valor: 0, aplicado: false, motivo: 'não aplica neste grupo' }

    const aliquota = imp === 'irrf' ? grupoConfig.aliquotaIrrf
      : imp === 'pis' ? grupoConfig.aliquotaPis
      : imp === 'cofins' ? grupoConfig.aliquotaCofins
      : grupoConfig.aliquotaCsll

    const minCalc = imp === 'irrf' ? grupoConfig.minCalcIrrf : grupoConfig.minCalcPisCofinsCsll
    const minRet = imp === 'irrf' ? grupoConfig.minRetIrrf
      : imp === 'pis' ? grupoConfig.minRetPis
      : imp === 'cofins' ? grupoConfig.minRetCofins
      : grupoConfig.minRetCsll

    if (grupoConfig.respeitaMinimo && valorBruto < minCalc) {
      return { valor: 0, aplicado: false, motivo: `bruto < mín. R$ ${minCalc.toLocaleString('pt-BR')}` }
    }
    const valor = Math.round(valorBruto * aliquota) / 100
    if (grupoConfig.respeitaMinimo && valor < minRet) {
      return { valor: 0, aplicado: false, motivo: `retenção < mín. R$ ${minRet.toLocaleString('pt-BR')}` }
    }
    return { valor, aplicado: true }
  }

  const valorIss = Math.round(valorBruto * aliquotaIss) / 100
  const retIrrf = calcRetencao('irrf')
  const retPis = calcRetencao('pis')
  const retCofins = calcRetencao('cofins')
  const retCsll = calcRetencao('csll')
  const totalRetencoes = valorIss + retIrrf.valor + retPis.valor + retCofins.valor + retCsll.valor
  const valorLiquido = Math.round((valorBruto - totalRetencoes) * 100) / 100

  // IBPT (Lei 12.741) — defaults da Voa Legal
  const pctFederais = Number(data?.grupoImposto?.pct_trib_federais ?? 10.38)
  const pctEstaduais = Number(data?.grupoImposto?.pct_trib_estaduais ?? 0)
  const pctMunicipais = Number(data?.grupoImposto?.pct_trib_municipais ?? 2.5)

  const itensPorCaso = new Map<string, { caso: string; valor: number; count: number; descricoes: Set<string> }>()
  for (const item of data?.itens || []) {
    const snap = item.snapshot || {}
    const caso = `Caso ${snap.caso_numero ?? '?'} — ${snap.caso_nome ?? 'sem nome'}`
    if (!itensPorCaso.has(caso)) itensPorCaso.set(caso, { caso, valor: 0, count: 0, descricoes: new Set() })
    const entry = itensPorCaso.get(caso)!
    entry.valor += Number(item.valor ?? 0)
    entry.count += 1
    if (snap.timesheet_descricao) entry.descricoes.add(String(snap.timesheet_descricao))
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Prévia da NFS-e (rascunho) — {contratoLabel || 'contrato'}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-ink-mute">
            <Loader2 className="h-5 w-5 animate-spin" /> Carregando dados fiscais...
          </div>
        ) : error ? (
          <Alert className="border border-destructive/30 bg-destructive/10 text-destructive">
            <AlertTitle>Erro</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : data ? (
          <div id="nfse-preview-print" className="space-y-4 text-sm">
            {/* Aviso */}
            <Alert className="border-amber-300 bg-amber-50 text-amber-900">
              <AlertTitle>Prévia sem valor fiscal</AlertTitle>
              <AlertDescription>
                Este documento é uma simulação da NFS-e antes da emissão real.
                As alíquotas de retenção (IRRF, INSS, PIS, COFINS, CSLL) estão{' '}
                <strong>preliminares e devem ser confirmadas com o financeiro</strong>.
                Apenas o ISS ({fmtPct(aliquotaIss)}) é a alíquota fiscal aplicada na nota oficial.
              </AlertDescription>
            </Alert>

            {/* Cabeçalho NFS-e */}
            <div className="rounded-lg border border-hairline bg-white p-4">
              <div className="border-b border-hairline pb-2 mb-2">
                <p className="text-xs uppercase tracking-wide text-ink-mute">PRESTADOR DE SERVIÇOS</p>
                <p className="font-semibold text-ink">{data.prestador.nome}</p>
                <p className="text-xs text-ink-mute">
                  CNPJ {formatCnpjCpf(data.prestador.cnpj)} · IM {data.prestador.inscricaoMunicipal} · {data.prestador.municipio}
                </p>
                <p className="text-xs text-ink-mute">{data.prestador.endereco}</p>
              </div>

              <div className="border-b border-hairline pb-2 mb-2">
                <p className="text-xs uppercase tracking-wide text-ink-mute">TOMADOR DOS SERVIÇOS</p>
                <p className="font-semibold text-ink">{data.tomador?.nome || '—'}</p>
                <p className="text-xs text-ink-mute">
                  {data.tomador?.tipo === 'pessoa_juridica' ? 'CNPJ' : 'CPF'} {formatCnpjCpf(data.tomador?.cnpj)} · Tipo {tipoTomador}
                </p>
                <p className="text-xs text-ink-mute">
                  {data.tomador?.rua || '—'}, {data.tomador?.numero || '—'}
                  {data.tomador?.complemento ? `, ${data.tomador.complemento}` : ''} — {data.tomador?.bairro || '—'} · CEP {formatCep(data.tomador?.cep)} · {data.tomador?.cidade || '—'}/{data.tomador?.estado || '—'}
                </p>
              </div>

              <div>
                <p className="text-xs uppercase tracking-wide text-ink-mute">DISCRIMINAÇÃO DOS SERVIÇOS</p>
                <table className="w-full text-xs mt-1">
                  <thead className="text-left text-ink-mute">
                    <tr>
                      <th className="py-1">Descrição</th>
                      <th className="py-1 text-right">Itens</th>
                      <th className="py-1 text-right">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from(itensPorCaso.values()).map((c) => (
                      <tr key={c.caso} className="border-t border-hairline">
                        <td className="py-1 text-ink-secondary">
                          <div>{c.caso}</div>
                          {c.descricoes.size > 0 && (
                            <div className="text-xs text-ink-mute italic">
                              {Array.from(c.descricoes).slice(0, 2).join('; ')}
                              {c.descricoes.size > 2 && '…'}
                            </div>
                          )}
                        </td>
                        <td className="py-1 text-right text-ink-secondary font-tabular">{c.count}</td>
                        <td className="py-1 text-right text-ink font-medium font-tabular">{fmtMoney(c.valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Breakdown de impostos */}
            <div className="rounded-lg border border-hairline bg-white p-4">
              <p className="text-xs uppercase tracking-wide text-ink-mute mb-2">RETENÇÕES E IMPOSTOS</p>
              <table className="w-full text-sm">
                <thead className="text-xs text-ink-mute text-left">
                  <tr>
                    <th className="py-1">Imposto</th>
                    <th className="py-1 text-right">Alíquota</th>
                    <th className="py-1 text-right">Valor retido</th>
                    <th className="py-1 text-right">Observação</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-hairline">
                    <td className="py-1 font-medium text-ink">ISS</td>
                    <td className="py-1 text-right font-tabular">{fmtPct(aliquotaIss)}</td>
                    <td className="py-1 text-right text-red-600 font-tabular">- {fmtMoney(valorIss)}</td>
                    <td className="py-1 text-right text-xs text-ink-mute">municipal · fiscal</td>
                  </tr>
                  <tr className="border-t border-hairline">
                    <td className="py-1 text-ink-secondary">IRRF</td>
                    <td className="py-1 text-right font-tabular">{fmtPct(ALIQUOTAS_VOA_LEGAL.irrf.aliquota)}</td>
                    <td className="py-1 text-right text-red-600 font-tabular">{retIrrf.aplicado ? `- ${fmtMoney(retIrrf.valor)}` : '— não aplicado'}</td>
                    <td className="py-1 text-right text-xs text-ink-mute">{retIrrf.motivo || 'contador'}</td>
                  </tr>
                  <tr className="border-t border-hairline">
                    <td className="py-1 text-ink-secondary">PIS</td>
                    <td className="py-1 text-right font-tabular">{fmtPct(ALIQUOTAS_VOA_LEGAL.pis.aliquota)}</td>
                    <td className="py-1 text-right text-red-600 font-tabular">{retPis.aplicado ? `- ${fmtMoney(retPis.valor)}` : '— não aplicado'}</td>
                    <td className="py-1 text-right text-xs text-ink-mute">{retPis.motivo || 'contador'}</td>
                  </tr>
                  <tr className="border-t border-hairline">
                    <td className="py-1 text-ink-secondary">COFINS</td>
                    <td className="py-1 text-right font-tabular">{fmtPct(ALIQUOTAS_VOA_LEGAL.cofins.aliquota)}</td>
                    <td className="py-1 text-right text-red-600 font-tabular">{retCofins.aplicado ? `- ${fmtMoney(retCofins.valor)}` : '— não aplicado'}</td>
                    <td className="py-1 text-right text-xs text-ink-mute">{retCofins.motivo || 'contador'}</td>
                  </tr>
                  <tr className="border-t border-hairline">
                    <td className="py-1 text-ink-secondary">CSLL</td>
                    <td className="py-1 text-right font-tabular">{fmtPct(ALIQUOTAS_VOA_LEGAL.csll.aliquota)}</td>
                    <td className="py-1 text-right text-red-600 font-tabular">{retCsll.aplicado ? `- ${fmtMoney(retCsll.valor)}` : '— não aplicado'}</td>
                    <td className="py-1 text-right text-xs text-ink-mute">{retCsll.motivo || 'contador'}</td>
                  </tr>
                </tbody>
              </table>
              <div className="mt-2 rounded-md bg-canvas-soft border border-hairline p-2 text-xs text-ink-secondary">
                <p>
                  <strong>Grupo de impostos:</strong> {grupoNome}
                  {data.grupoImposto?.nome && data.grupoImposto.nome !== grupoNome && (
                    <span className="text-amber-700"> (contrato configurado como &quot;{data.grupoImposto.nome}&quot; — usando fallback)</span>
                  )}
                </p>
                <p className="text-ink-mute">{grupoFromDb?.descricao || regraFallback.observacao}</p>
              </div>
            </div>

            {/* Total */}
            <div className="rounded-lg border-2 border-hairline bg-canvas-soft p-4">
              <div className="flex justify-between text-sm">
                <span className="text-ink-mute">Valor bruto dos serviços</span>
                <span className="font-semibold text-ink font-tabular">{fmtMoney(valorBruto)}</span>
              </div>
              <div className="flex justify-between text-sm mt-1">
                <span className="text-ink-mute">Total de retenções</span>
                <span className="text-red-600 font-tabular">- {fmtMoney(totalRetencoes)}</span>
              </div>
              <div className="border-t border-hairline mt-2 pt-2 flex justify-between items-end">
                <span className="text-base font-semibold text-ink">VALOR LÍQUIDO A RECEBER</span>
                <span className="text-2xl font-bold text-emerald-700 font-tabular">{fmtMoney(valorLiquido)}</span>
              </div>
            </div>

            {/* IBPT info */}
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <p className="font-medium">Informativo IBPT (Lei 12.741)</p>
              <p>
                Tributos federais: {fmtPct(pctFederais)} · Estaduais: {fmtPct(pctEstaduais)} · Municipais: {fmtPct(pctMunicipais)}
              </p>
              <p className="mt-1 text-xs text-amber-800">
                Valor aproximado dos tributos contidos no valor dos serviços, conforme registro IBPT padrão para advocacia.
              </p>
            </div>
          </div>
        ) : null}

        <DialogFooter className="flex justify-between gap-2 print:hidden">
          <Button variant="outline" onClick={onClose}>
            <X className="mr-2 h-4 w-4" /> Fechar
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => window.print()}
              disabled={loading || !!error || !data}
            >
              <Printer className="mr-2 h-4 w-4" /> Imprimir prévia
            </Button>
            {onConfirmEmit && (
              <Button
                className="bg-green-700 hover:bg-green-800 text-white"
                onClick={onConfirmEmit}
                disabled={loading || !!error || !data}
              >
                <FileText className="mr-2 h-4 w-4" /> Confirmar e emitir
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
