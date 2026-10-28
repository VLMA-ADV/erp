'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatContratoDisplay } from '@/lib/utils/contrato-display'
import { contratoNumeroExibicao, formatMoney, labelCaso, labelCompetencia, type KitCaso } from './types'

// Escolha dos kits do relatório consolidado (Filipe, 16/10): todos do
// contrato marcados; a pessoa desmarca o que não entra. Ver
// relatorio-consolidado.ts.
export default function RelatorioConsolidadoDialog({
  grupo,
  gerando,
  onClose,
  onGerar,
}: {
  grupo: KitCaso[] | null
  gerando: boolean
  onClose: () => void
  onGerar: (kits: KitCaso[]) => void
}) {
  const [marcados, setMarcados] = useState<ReadonlySet<string>>(new Set())
  useEffect(() => {
    setMarcados(new Set((grupo ?? []).map((k) => k.chave)))
  }, [grupo])

  const primeiro = grupo?.[0]
  const escolhidos = (grupo ?? []).filter((k) => marcados.has(k.chave))
  const jaTemRelatorio = escolhidos.filter((k) => k.documentos.relatorio_timesheet)

  const alternar = (kit: KitCaso, marcar: boolean) => setMarcados((atual) => {
    const novo = new Set(atual)
    if (marcar) novo.add(kit.chave)
    else novo.delete(kit.chave)
    return novo
  })

  return (
    <Dialog open={!!grupo} onOpenChange={(v) => (!v && !gerando ? onClose() : undefined)}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Relatório consolidado</DialogTitle>
          <DialogDescription>
            {primeiro
              ? `${formatContratoDisplay(contratoNumeroExibicao(primeiro), primeiro.contrato_nome).full} · ${labelCompetencia(primeiro.competencia)}. `
              : ''}
            Um relatório só, com uma seção por caso, o valor fixo no fim e o total geral.
          </DialogDescription>
        </DialogHeader>

        <ul className="divide-y divide-hairline rounded-lg border border-hairline">
          {(grupo ?? []).map((kit) => (
            <li key={kit.chave}>
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={marcados.has(kit.chave)}
                  onChange={(e) => alternar(kit, e.target.checked)}
                  disabled={gerando}
                />
                <span className="min-w-0 flex-1 truncate text-ink">{labelCaso(kit)}</span>
                <span className="shrink-0 font-tabular text-xs text-ink-mute">{formatMoney(kit.valor_servico)}</span>
              </label>
            </li>
          ))}
        </ul>

        {jaTemRelatorio.length ? (
          <p className="text-xs text-ink-mute">
            {jaTemRelatorio.length === 1 ? 'O relatório já gerado deste caso é substituído' : `Os relatórios já gerados de ${jaTemRelatorio.length} casos são substituídos`} pelo consolidado.
          </p>
        ) : null}
        <p className="text-xs text-ink-mute">
          No e-mail, o consolidado vai uma vez só, no kit do primeiro caso que envia relatório.
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={gerando}>Cancelar</Button>
          <Button onClick={() => onGerar(escolhidos)} disabled={gerando || escolhidos.length < 2}>
            {gerando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            Gerar relatório ({escolhidos.length} casos)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
