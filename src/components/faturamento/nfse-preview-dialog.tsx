'use client'

import { useEffect, useState } from 'react'
import { FileText, Loader2, Printer, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

// Placeholder de aliquotas — a definir com Jessica (financeiro Voa Legal)
// Valores tipicos para advocacia em Curitiba/PR.
const ALIQUOTAS_PADRAO = {
  iss: 3.5,
  irrf: 1.5, // PJ acima de R$ 666,67
  inss: 11, // PJ servico de natureza tecnica
  pis: 0.65,
  cofins: 3,
  csll: 1, // PJ acima de R$ 5.000 acumulado mes
  // Limite minimo para retencao quando tomador e PJ
  retencaoMinimaPJ: 666.67,
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
  const aliquotaIss = Number(data?.grupoImposto?.aliquota_iss ?? ALIQUOTAS_PADRAO.iss)
  const tipoTomador =
    data?.tomador?.cnpj && String(data.tomador.cnpj).replace(/\D/g, '').length === 14 ? 'PJ' : 'PF'
  const retencoesAtivas = tipoTomador === 'PJ' && valorBruto >= ALIQUOTAS_PADRAO.retencaoMinimaPJ

  const valorIss = Math.round(valorBruto * aliquotaIss) / 100
  const valorIrrf = retencoesAtivas ? Math.round(valorBruto * ALIQUOTAS_PADRAO.irrf) / 100 : 0
  const valorInss = retencoesAtivas ? Math.round(valorBruto * ALIQUOTAS_PADRAO.inss) / 100 : 0
  const valorPis = retencoesAtivas ? Math.round(valorBruto * ALIQUOTAS_PADRAO.pis) / 100 : 0
  const valorCofins = retencoesAtivas ? Math.round(valorBruto * ALIQUOTAS_PADRAO.cofins) / 100 : 0
  const valorCsll = retencoesAtivas ? Math.round(valorBruto * ALIQUOTAS_PADRAO.csll) / 100 : 0
  const totalRetencoes = valorIss + valorIrrf + valorInss + valorPis + valorCofins + valorCsll
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
                    <td className="py-1 text-right font-tabular">{fmtPct(ALIQUOTAS_PADRAO.irrf)}</td>
                    <td className="py-1 text-right text-red-600 font-tabular">{retencoesAtivas ? `- ${fmtMoney(valorIrrf)}` : '— não aplicado'}</td>
                    <td className="py-1 text-right text-xs text-amber-700">a confirmar</td>
                  </tr>
                  <tr className="border-t border-hairline">
                    <td className="py-1 text-ink-secondary">INSS</td>
                    <td className="py-1 text-right font-tabular">{fmtPct(ALIQUOTAS_PADRAO.inss)}</td>
                    <td className="py-1 text-right text-red-600 font-tabular">{retencoesAtivas ? `- ${fmtMoney(valorInss)}` : '— não aplicado'}</td>
                    <td className="py-1 text-right text-xs text-amber-700">a confirmar</td>
                  </tr>
                  <tr className="border-t border-hairline">
                    <td className="py-1 text-ink-secondary">PIS</td>
                    <td className="py-1 text-right font-tabular">{fmtPct(ALIQUOTAS_PADRAO.pis)}</td>
                    <td className="py-1 text-right text-red-600 font-tabular">{retencoesAtivas ? `- ${fmtMoney(valorPis)}` : '— não aplicado'}</td>
                    <td className="py-1 text-right text-xs text-amber-700">a confirmar</td>
                  </tr>
                  <tr className="border-t border-hairline">
                    <td className="py-1 text-ink-secondary">COFINS</td>
                    <td className="py-1 text-right font-tabular">{fmtPct(ALIQUOTAS_PADRAO.cofins)}</td>
                    <td className="py-1 text-right text-red-600 font-tabular">{retencoesAtivas ? `- ${fmtMoney(valorCofins)}` : '— não aplicado'}</td>
                    <td className="py-1 text-right text-xs text-amber-700">a confirmar</td>
                  </tr>
                  <tr className="border-t border-hairline">
                    <td className="py-1 text-ink-secondary">CSLL</td>
                    <td className="py-1 text-right font-tabular">{fmtPct(ALIQUOTAS_PADRAO.csll)}</td>
                    <td className="py-1 text-right text-red-600 font-tabular">{retencoesAtivas ? `- ${fmtMoney(valorCsll)}` : '— não aplicado'}</td>
                    <td className="py-1 text-right text-xs text-amber-700">a confirmar</td>
                  </tr>
                </tbody>
              </table>
              {!retencoesAtivas && (
                <p className="mt-2 text-xs text-ink-mute italic">
                  {tipoTomador === 'PF'
                    ? '* Tomador é pessoa física — IRRF/INSS/PIS/COFINS/CSLL não são retidos na origem.'
                    : `* Valor bruto abaixo do limite mínimo de R$ ${ALIQUOTAS_PADRAO.retencaoMinimaPJ.toLocaleString('pt-BR')} para retenções PJ.`}
                </p>
              )}
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
