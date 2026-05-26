'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/native-select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useToast } from '@/components/ui/toast'

interface EntityConfig {
  label: string
  key: string
  columns: { key: string; label: string; default: boolean }[]
  statusOptions?: { value: string; label: string }[]
}

const ENTITIES: EntityConfig[] = [
  {
    label: 'Clientes',
    key: 'clientes',
    columns: [
      { key: 'id', label: 'ID', default: false },
      { key: 'nome', label: 'Nome', default: true },
      { key: 'cnpj', label: 'CNPJ', default: true },
      { key: 'tipo', label: 'Tipo', default: true },
      { key: 'cliente_estrangeiro', label: 'Estrangeiro', default: false },
      { key: 'cep', label: 'CEP', default: false },
      { key: 'rua', label: 'Rua', default: false },
      { key: 'numero', label: 'Número', default: false },
      { key: 'complemento', label: 'Complemento', default: false },
      { key: 'bairro', label: 'Bairro', default: false },
      { key: 'cidade', label: 'Cidade', default: true },
      { key: 'estado', label: 'Estado', default: true },
      { key: 'codigo_ibge', label: 'Cód. IBGE', default: false },
      { key: 'email', label: 'E-mail', default: true },
      { key: 'telefone', label: 'Telefone', default: true },
      { key: 'regime_fiscal', label: 'Regime Fiscal', default: false },
      { key: 'ativo', label: 'Ativo', default: true },
      { key: 'created_at', label: 'Criado em', default: false },
    ],
    statusOptions: [
      { value: 'ativo', label: 'Ativo' },
      { value: 'inativo', label: 'Inativo' },
    ],
  },
  {
    label: 'Contratos',
    key: 'contratos',
    columns: [
      { key: 'id', label: 'ID', default: false },
      { key: 'numero_sequencial', label: 'Nº Sequencial', default: true },
      { key: 'nome_contrato', label: 'Nome do Contrato', default: true },
      { key: 'status', label: 'Status', default: true },
      { key: 'regime_fiscal', label: 'Regime Fiscal', default: false },
      { key: 'forma_entrada', label: 'Forma de Entrada', default: false },
      { key: 'created_at', label: 'Criado em', default: false },
      { key: 'created_by', label: 'Criado por', default: false },
      { key: 'cliente_nome', label: 'Cliente', default: true },
      { key: 'cliente_cnpj', label: 'CNPJ do Cliente', default: true },
      { key: 'cliente_tipo', label: 'Tipo do Cliente', default: false },
      { key: 'grupo_imposto_nome', label: 'Grupo de Imposto', default: true },
      { key: 'total_casos', label: 'Total de Casos', default: true },
    ],
    statusOptions: [
      { value: 'ativo', label: 'Ativo' },
      { value: 'encerrado', label: 'Encerrado' },
      { value: 'suspenso', label: 'Suspenso' },
    ],
  },
  {
    label: 'Casos',
    key: 'casos',
    columns: [
      { key: 'id', label: 'ID', default: false },
      { key: 'numero', label: 'Número', default: true },
      { key: 'nome', label: 'Nome', default: true },
      { key: 'contrato_id', label: 'ID do Contrato', default: false },
      { key: 'status', label: 'Status', default: true },
      { key: 'created_at', label: 'Criado em', default: false },
      { key: 'contrato_numero_sequencial', label: 'Nº Contrato', default: true },
      { key: 'contrato_nome', label: 'Nome do Contrato', default: true },
      { key: 'cliente_nome', label: 'Cliente', default: true },
    ],
    statusOptions: [
      { value: 'ativo', label: 'Ativo' },
      { value: 'encerrado', label: 'Encerrado' },
      { value: 'suspenso', label: 'Suspenso' },
    ],
  },
  {
    label: 'Billing Items',
    key: 'billing_items',
    columns: [
      { key: 'id', label: 'ID', default: false },
      { key: 'contrato_id', label: 'ID do Contrato', default: false },
      { key: 'caso_id', label: 'ID do Caso', default: false },
      { key: 'status', label: 'Status', default: true },
      { key: 'valor_aprovado', label: 'Valor Aprovado', default: true },
      { key: 'valor_revisado', label: 'Valor Revisado', default: true },
      { key: 'created_at', label: 'Criado em', default: true },
      { key: 'contrato_nome', label: 'Contrato', default: true },
      { key: 'cliente_nome', label: 'Cliente', default: true },
    ],
    statusOptions: [
      { value: 'pendente', label: 'Pendente' },
      { value: 'aprovado', label: 'Aprovado' },
      { value: 'revisado', label: 'Revisado' },
    ],
  },
  {
    label: 'Notas Geradas',
    key: 'notas_geradas',
    columns: [
      { key: 'id', label: 'ID', default: false },
      { key: 'numero', label: 'Número', default: true },
      { key: 'status', label: 'Status', default: true },
      { key: 'tipo_documento', label: 'Tipo Documento', default: true },
      { key: 'focus_ref', label: 'Ref. Focus', default: true },
      { key: 'focus_status', label: 'Status Focus', default: true },
      { key: 'created_at', label: 'Criado em', default: true },
      { key: 'contrato_nome', label: 'Contrato', default: true },
      { key: 'caso_nome', label: 'Caso', default: true },
    ],
    statusOptions: [
      { value: 'emitida', label: 'Emitida' },
      { value: 'cancelada', label: 'Cancelada' },
    ],
  },
]

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
      return new Date(value).toLocaleDateString('pt-BR')
    }
    return value
  }
  return String(value)
}

function generateCSV(columns: { key: string; label: string }[], rows: Record<string, unknown>[]): string {
  const BOM = '﻿'
  const header = columns.map((c) => `"${c.label}"`).join(';')
  const lines = rows.map((row) =>
    columns.map((c) => {
      const val = formatCellValue(row[c.key])
      return `"${val.replace(/"/g, '""')}"`
    }).join(';')
  )
  return BOM + header + '\n' + lines.join('\n')
}

interface ReportBuilderProps {
  userId: string
}

export default function ReportBuilder({ userId }: ReportBuilderProps) {
  const { success, error: toastError } = useToast()
  const supabase = createClient()

  const [entity, setEntity] = useState('')
  const [selectedColumns, setSelectedColumns] = useState<string[]>([])
  const [filterStatus, setFilterStatus] = useState('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [data, setData] = useState<Record<string, unknown>[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)

  const PAGE_SIZE = 50

  const entityConfig = ENTITIES.find((e) => e.key === entity)

  useEffect(() => {
    const cfg = ENTITIES.find((e) => e.key === entity)
    if (cfg) {
      setSelectedColumns(cfg.columns.filter((c) => c.default).map((c) => c.key))
    } else {
      setSelectedColumns([])
    }
    setData([])
    setTotal(0)
    setPage(0)
    setFilterStatus('')
    setFilterDateFrom('')
    setFilterDateTo('')
  }, [entity])

  const toggleColumn = (col: string) => {
    setSelectedColumns((prev) =>
      prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]
    )
  }

  const selectAllColumns = () => {
    if (entityConfig) {
      setSelectedColumns(entityConfig.columns.map((c) => c.key))
    }
  }

  const deselectAllColumns = () => {
    setSelectedColumns([])
  }

  const buildFilters = useCallback(() => {
    const filters: Record<string, string> = {}
    if (filterStatus) filters.status = filterStatus
    if (filterDateFrom) filters.date_from = filterDateFrom
    if (filterDateTo) filters.date_to = filterDateTo
    return filters
  }, [filterStatus, filterDateFrom, filterDateTo])

  const fetchPreview = useCallback(async (pageNum: number) => {
    if (!entity || selectedColumns.length === 0) return
    setLoading(true)
    try {
      const { data: result, error } = await supabase.rpc('report_builder', {
        p_user_id: userId,
        p_entity: entity,
        p_columns: selectedColumns,
        p_filters: buildFilters(),
        p_limit: PAGE_SIZE,
        p_offset: pageNum * PAGE_SIZE,
      })
      if (error) {
        toastError(`Erro ao carregar: ${error.message}`)
        return
      }
      setData(result.data || [])
      setTotal(result.total || 0)
      setPage(pageNum)
    } catch {
      toastError('Erro inesperado ao carregar dados')
    } finally {
      setLoading(false)
    }
  }, [entity, selectedColumns, buildFilters, userId, supabase, toastError])

  const handleExportCSV = async () => {
    if (!entity || !entityConfig || selectedColumns.length === 0) return
    setExporting(true)
    try {
      const { data: result, error } = await supabase.rpc('report_builder', {
        p_user_id: userId,
        p_entity: entity,
        p_columns: selectedColumns,
        p_filters: buildFilters(),
        p_limit: 5000,
        p_offset: 0,
      })
      if (error) {
        toastError(`Erro ao exportar: ${error.message}`)
        return
      }
      const cols = entityConfig.columns.filter((c) => selectedColumns.includes(c.key))
      const csv = generateCSV(cols, result.data || [])
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const date = new Date().toISOString().slice(0, 10)
      a.href = url
      a.download = `relatorio-${entity}-${date}.csv`
      a.click()
      URL.revokeObjectURL(url)
      success(`CSV exportado: ${(result.data || []).length} registros`)
    } catch {
      toastError('Erro inesperado ao exportar')
    } finally {
      setExporting(false)
    }
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)
  const visibleColumns = entityConfig
    ? entityConfig.columns.filter((c) => selectedColumns.includes(c.key))
    : []

  return (
    <div className="space-y-6">
      {/* Entity selector */}
      <Card>
        <CardHeader>
          <CardTitle>1. Selecionar entidade</CardTitle>
        </CardHeader>
        <CardContent>
          <NativeSelect value={entity} onChange={(e) => setEntity(e.target.value)}>
            <option value="">Selecione uma entidade...</option>
            {ENTITIES.map((e) => (
              <option key={e.key} value={e.key}>{e.label}</option>
            ))}
          </NativeSelect>
        </CardContent>
      </Card>

      {entityConfig && (
        <>
          {/* Column selector */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>2. Escolher colunas</CardTitle>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={selectAllColumns}>
                    Selecionar tudo
                  </Button>
                  <Button variant="ghost" size="sm" onClick={deselectAllColumns}>
                    Limpar
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {entityConfig.columns.map((col) => (
                  <label
                    key={col.key}
                    className="flex items-center gap-2 text-sm cursor-pointer select-none"
                  >
                    <input
                      type="checkbox"
                      checked={selectedColumns.includes(col.key)}
                      onChange={() => toggleColumn(col.key)}
                      className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                    />
                    {col.label}
                  </label>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Filters */}
          <Card>
            <CardHeader>
              <CardTitle>3. Filtros opcionais</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {entityConfig.statusOptions && (
                  <div>
                    <Label>Status</Label>
                    <NativeSelect value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                      <option value="">Todos</option>
                      {entityConfig.statusOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </NativeSelect>
                  </div>
                )}
                <div>
                  <Label>Data início</Label>
                  <Input
                    type="date"
                    value={filterDateFrom}
                    onChange={(e) => setFilterDateFrom(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Data fim</Label>
                  <Input
                    type="date"
                    value={filterDateTo}
                    onChange={(e) => setFilterDateTo(e.target.value)}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex gap-3">
            <Button
              onClick={() => fetchPreview(0)}
              disabled={loading || selectedColumns.length === 0}
            >
              {loading ? 'Carregando...' : 'Gerar Preview'}
            </Button>
            <Button
              variant="outline"
              onClick={handleExportCSV}
              disabled={exporting || selectedColumns.length === 0}
            >
              {exporting ? 'Exportando...' : 'Exportar Excel (CSV)'}
            </Button>
          </div>

          {/* Data preview */}
          {data.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>
                    Preview — {total} registro{total !== 1 ? 's' : ''} encontrado{total !== 1 ? 's' : ''}
                  </CardTitle>
                  <span className="text-sm text-ink-mute">
                    Página {page + 1} de {totalPages}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {visibleColumns.map((col) => (
                        <TableHead key={col.key}>{col.label}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.map((row, idx) => (
                      <TableRow key={idx}>
                        {visibleColumns.map((col) => (
                          <TableCell key={col.key}>
                            {formatCellValue(row[col.key])}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                {totalPages > 1 && (
                  <div className="flex items-center justify-center gap-2 mt-4">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page === 0 || loading}
                      onClick={() => fetchPreview(page - 1)}
                    >
                      Anterior
                    </Button>
                    <span className="text-sm text-ink-mute">
                      {page + 1} / {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= totalPages - 1 || loading}
                      onClick={() => fetchPreview(page + 1)}
                    >
                      Próxima
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {data.length === 0 && total === 0 && !loading && page === 0 && entity && (
            <Card>
              <CardContent className="py-8 text-center text-sm text-ink-mute">
                Selecione as colunas desejadas e clique em &quot;Gerar Preview&quot; para visualizar os dados.
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
