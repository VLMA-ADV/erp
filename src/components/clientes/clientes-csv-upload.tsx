'use client'

import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FileText, Loader2, Upload, X } from 'lucide-react'
import { parseClientesCsv } from './clientes-csv'

interface ImportResult {
  criados: number
  duplicatas: number
  erros: string[]
}

interface Props {
  onComplete: () => void
}

export default function ClientesCsvUpload({ onComplete }: Props) {
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [rows, setRows] = useState<Array<{ nome: string; cnpj: string }>>([])
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setFile(null)
    setRows([])
    setResult(null)
    setErrors([])
    if (inputRef.current) inputRef.current.value = ''
  }

  const handleFile = (f: File) => {
    reset()
    setFile(f)
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      const parsed = parseClientesCsv(text)
      if (parsed.rows.length === 0) {
        setErrors(parsed.errors.length ? parsed.errors : ['CSV inválido. Verifique se possui colunas "nome" e "cnpj".'])
        return
      }
      setRows(parsed.rows)
      setErrors(parsed.errors)
    }
    reader.readAsText(f, 'UTF-8')
  }

  const handleImport = async () => {
    if (rows.length === 0 || errors.length > 0) return
    setImporting(true)
    setResult(null)

    try {
      const response = await fetch('/api/clientes/import-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setErrors([payload.error || 'Erro na importação'])
        return
      }

      const data = payload.data || {}
      const nextResult = {
        criados: Number(data.criados || 0),
        duplicatas: Number(data.duplicatas || 0),
        erros: Array.isArray(data.erros)
          ? data.erros.map((entry: unknown) => {
              if (typeof entry === 'string') return entry
              if (entry && typeof entry === 'object') {
                const row = entry as Record<string, unknown>
                return [row.nome, row.cnpj, row.erro].filter((value) => typeof value === 'string' && value.length > 0).join(' - ')
              }
              return 'Erro desconhecido'
            })
          : [],
      }

      setResult(nextResult)
      if (nextResult.criados > 0) onComplete()
    } catch (e: unknown) {
      setErrors([e instanceof Error ? e.message : 'Erro na importação'])
    } finally {
      setImporting(false)
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Upload className="mr-2 h-4 w-4" />
        Importar CSV
      </Button>

      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen)
          if (!nextOpen && !importing) reset()
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Importar clientes via CSV</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <p className="text-xs text-slate-500">
              Colunas aceitas: <strong>nome</strong> e <strong>cnpj</strong>. Colunas extras são ignoradas. O lote é processado de forma transacional.
            </p>

            {!file ? (
              <div
                className="cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition-colors hover:border-blue-400 hover:bg-blue-50/50"
                onClick={() => inputRef.current?.click()}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault()
                  const droppedFile = event.dataTransfer.files[0]
                  if (droppedFile) handleFile(droppedFile)
                }}
              >
                <FileText className="mx-auto mb-2 h-8 w-8 text-slate-400" />
                <p className="text-sm text-slate-600">Arraste um CSV aqui ou clique para selecionar</p>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".csv,.txt"
                  className="hidden"
                  onChange={(event) => {
                    const selectedFile = event.target.files?.[0]
                    if (selectedFile) handleFile(selectedFile)
                  }}
                />
              </div>
            ) : null}

            {file ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <FileText className="h-4 w-4 text-blue-500" />
                  <span>{file.name}</span>
                  <span className="text-slate-500">- {rows.length} cliente(s) encontrado(s)</span>
                  <Button variant="ghost" size="sm" onClick={reset} disabled={importing}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>

                {rows.length > 0 ? (
                  <div className="max-h-40 overflow-y-auto rounded border text-xs">
                    <table className="w-full">
                      <thead className="sticky top-0 bg-slate-50">
                        <tr>
                          <th className="p-2 text-left font-medium">#</th>
                          <th className="p-2 text-left font-medium">Nome</th>
                          <th className="p-2 text-left font-medium">CNPJ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.slice(0, 10).map((row, index) => (
                          <tr key={`${row.cnpj}_${index}`} className="border-t">
                            <td className="p-2 text-slate-400">{index + 1}</td>
                            <td className="p-2">{row.nome}</td>
                            <td className="p-2 font-mono">{row.cnpj}</td>
                          </tr>
                        ))}
                        {rows.length > 10 ? (
                          <tr className="border-t">
                            <td colSpan={3} className="p-2 text-center text-slate-400">
                              ... e mais {rows.length - 10} linha(s)
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            ) : null}

            {errors.length > 0 ? (
              <div className="rounded bg-red-50 p-3 text-sm text-red-700">
                <p className="mb-1 font-medium">{errors.length} erro(s) encontrados</p>
                <ul className="list-disc space-y-0.5 pl-4">
                  {errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {result ? (
              <div className="space-y-2">
                <div className="rounded bg-green-50 p-3 text-sm text-green-700">
                  <strong>{result.criados}</strong> cliente(s) criado(s), <strong>{result.duplicatas}</strong> duplicata(s) ignorada(s) e <strong>{result.erros.length}</strong> erro(s).
                </div>
                {result.erros.length > 0 ? (
                  <div className="rounded bg-amber-50 p-3 text-sm text-amber-700">
                    <p className="mb-1 font-medium">Detalhes dos erros</p>
                    <ul className="list-disc space-y-0.5 pl-4">
                      {result.erros.map((error) => (
                        <li key={error}>{error}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={importing}>
              Fechar
            </Button>
            <Button onClick={handleImport} disabled={importing || rows.length === 0 || errors.length > 0}>
              {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              {importing ? 'Importando...' : `Importar ${rows.length} cliente(s)`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
