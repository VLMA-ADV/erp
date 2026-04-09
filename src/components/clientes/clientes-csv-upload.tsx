'use client'

import { useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Upload, X, FileText, Loader2 } from 'lucide-react'

interface CsvRow {
  nome: string
  cnpj: string
  tipo: 'pessoa_juridica' | 'pessoa_fisica'
}

interface ImportResult {
  criados: number
  duplicatas: number
  erros: string[]
}

interface Props {
  onComplete: () => void
}

function parseCsv(text: string): CsvRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) return []

  const header = lines[0].toLowerCase().split(/[;,\t]/).map((h) => h.trim().replace(/^"|"$/g, ''))
  const nomeIdx = header.findIndex((h) =>
    h === 'nome' || h === 'nome do cliente' || h === 'razao_social' || h === 'razao social' || h === 'nome/razão social'
  )
  const cnpjIdx = header.findIndex((h) =>
    h === 'cnpj' || h === 'cpf' || h === 'cnpj/cpf' || h === 'cpf/cnpj' || h === 'cpf_cnpj' || h === 'documento'
  )
  const categoriaIdx = header.findIndex((h) =>
    h === 'categoria' || h === 'tipo' || h === 'tipo pessoa' || h === 'tipo_pessoa'
  )

  if (nomeIdx === -1 || cnpjIdx === -1) return []

  const rows: CsvRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(/[;,\t]/).map((c) => c.trim().replace(/^"|"$/g, ''))
    const nome = cols[nomeIdx]?.trim()
    const cnpj = cols[cnpjIdx]?.trim().replace(/[.\-/\s]/g, '')
    const categoriaRaw = categoriaIdx >= 0 ? (cols[categoriaIdx]?.trim().toLowerCase() || '') : ''
    const tipo: 'pessoa_juridica' | 'pessoa_fisica' =
      categoriaRaw.includes('física') || categoriaRaw.includes('fisica') || categoriaRaw === 'pf'
        ? 'pessoa_fisica'
        : 'pessoa_juridica'
    if (nome && cnpj) {
      rows.push({ nome, cnpj, tipo })
    }
  }
  return rows
}

export default function ClientesCsvUpload({ onComplete }: Props) {
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [rows, setRows] = useState<CsvRow[]>([])
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setFile(null)
    setRows([])
    setResult(null)
    setError(null)
  }

  const handleFile = (f: File) => {
    reset()
    setFile(f)
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      const parsed = parseCsv(text)
      if (parsed.length === 0) {
        setError('CSV invalido. Verifique se possui colunas "nome" e "cnpj" no cabecalho.')
        return
      }
      setRows(parsed)
    }
    reader.readAsText(f, 'UTF-8')
  }

  const handleImport = async () => {
    if (rows.length === 0) return
    setImporting(true)
    setError(null)
    setResult(null)

    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { setError('Sessao expirada'); return }

      const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
      const headers = {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      }

      const res = await fetch(`${baseUrl}/functions/v1/get-clientes`, {
        method: 'GET', headers,
      })
      const existing = ((await res.json()).data || []) as Array<{ cnpj: string | null }>
      const existingCnpjs = new Set(
        existing.map((c) => (c.cnpj || '').replace(/[.\-/\s]/g, '')).filter(Boolean)
      )

      let criados = 0
      let duplicatas = 0
      const erros: string[] = []

      for (const row of rows) {
        if (existingCnpjs.has(row.cnpj)) {
          duplicatas++
          continue
        }

        const resp = await fetch(`${baseUrl}/functions/v1/create-cliente`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            nome: row.nome,
            cnpj: row.cnpj,
            tipo: row.tipo,
            ativo: true,
          }),
        })

        if (resp.ok) {
          criados++
          existingCnpjs.add(row.cnpj)
        } else {
          const d = await resp.json().catch(() => ({}))
          erros.push(`${row.nome}: ${d.error || 'erro desconhecido'}`)
        }
      }

      setResult({ criados, duplicatas, erros })
      if (criados > 0) onComplete()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro na importacao')
    } finally {
      setImporting(false)
    }
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Upload className="mr-2 h-4 w-4" />
        Importar CSV
      </Button>
    )
  }

  return (
    <div className="rounded-lg border bg-white p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-sm">Importar clientes via CSV</h3>
        <Button variant="ghost" size="sm" onClick={() => { reset(); setOpen(false) }}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <p className="text-xs text-slate-500">
        Colunas aceitas: <strong>Nome do Cliente</strong> (ou <em>nome</em>) e <strong>CNPJ/CPF</strong> (ou <em>cnpj</em>). Coluna <strong>Categoria</strong> opcional para distinguir PF/PJ. Separador: vírgula, ponto-e-vírgula ou tab.
      </p>

      {!file && (
        <div
          className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition-colors"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
        >
          <FileText className="h-8 w-8 mx-auto mb-2 text-slate-400" />
          <p className="text-sm text-slate-600">Arraste um CSV aqui ou clique para selecionar</p>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.txt"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
          />
        </div>
      )}

      {file && rows.length > 0 && !result && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <FileText className="h-4 w-4 text-blue-500" />
            <span>{file.name}</span>
            <span className="text-slate-500">— {rows.length} cliente(s) encontrado(s)</span>
            <Button variant="ghost" size="sm" onClick={reset}>
              <X className="h-3 w-3" />
            </Button>
          </div>

          <div className="max-h-40 overflow-y-auto rounded border text-xs">
            <table className="w-full">
              <thead className="bg-slate-50 sticky top-0">
                <tr>
                  <th className="text-left p-2 font-medium">#</th>
                  <th className="text-left p-2 font-medium">Nome</th>
                  <th className="text-left p-2 font-medium">CNPJ</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 10).map((r, i) => (
                  <tr key={i} className="border-t">
                    <td className="p-2 text-slate-400">{i + 1}</td>
                    <td className="p-2">{r.nome}</td>
                    <td className="p-2 font-mono">{r.cnpj}</td>
                  </tr>
                ))}
                {rows.length > 10 && (
                  <tr className="border-t">
                    <td colSpan={3} className="p-2 text-slate-400 text-center">
                      ... e mais {rows.length - 10} linha(s)
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <Button onClick={handleImport} disabled={importing}>
            {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            {importing ? 'Importando...' : `Importar ${rows.length} cliente(s)`}
          </Button>
        </div>
      )}

      {error && (
        <div className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {result && (
        <div className="space-y-2">
          <div className="rounded bg-green-50 p-3 text-sm text-green-700">
            <strong>{result.criados}</strong> cliente(s) criado(s)
            {result.duplicatas > 0 && <>, <strong>{result.duplicatas}</strong> duplicata(s) ignorada(s)</>}
          </div>
          {result.erros.length > 0 && (
            <div className="rounded bg-amber-50 p-3 text-sm text-amber-700">
              <p className="font-medium mb-1">{result.erros.length} erro(s):</p>
              <ul className="list-disc pl-4 space-y-0.5">
                {result.erros.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}
          <Button variant="outline" size="sm" onClick={() => { reset(); setOpen(false) }}>
            Fechar
          </Button>
        </div>
      )}
    </div>
  )
}
