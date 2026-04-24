'use client'

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Save } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DatePicker } from '@/components/ui/date-picker'
import { Label } from '@/components/ui/label'
import { MoneyInput } from '@/components/ui/money-input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useToast } from '@/components/ui/toast'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'

interface SalarioMinimoAtual {
  valor: number | string | null
  vigencia_desde: string | null
  updated_at: string | null
}

interface SalarioMinimoHistoricoItem extends SalarioMinimoAtual {
  updated_by_nome?: string | null
  updated_by?: string | null
}

function todayInput() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function formatMoney(value: number | string | null | undefined) {
  const numeric = Number(value ?? 0)
  if (!Number.isFinite(numeric)) return 'R$ 0,00'
  return numeric.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatDate(value: string | null | undefined) {
  if (!value) return '-'
  const [dateOnly] = value.split('T')
  const [y, m, d] = dateOnly.split('-')
  if (!y || !m || !d) return value
  return `${d}/${m}/${y}`
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return formatDate(value)
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

async function getAccessToken() {
  const supabase = createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  return session?.access_token ?? null
}

async function fetchSalarioMinimoAtual(): Promise<SalarioMinimoAtual> {
  const token = await getAccessToken()
  if (!token) throw new Error('Sessão expirada')

  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-salario-minimo`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  })
  const data: unknown = await response.json()
  if (!response.ok) {
    const error = data && typeof data === 'object' && 'error' in data ? String(data.error) : 'Erro ao carregar salário mínimo'
    throw new Error(error)
  }
  return data as SalarioMinimoAtual
}

async function fetchHistorico(): Promise<SalarioMinimoHistoricoItem[]> {
  const token = await getAccessToken()
  if (!token) throw new Error('Sessão expirada')

  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-salario-minimo-historico?limit=5`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  })
  const body: unknown = await response.json()
  if (!response.ok) {
    const error = body && typeof body === 'object' && 'error' in body ? String(body.error) : 'Erro ao carregar histórico'
    throw new Error(error)
  }
  if (body && typeof body === 'object' && 'data' in body && Array.isArray(body.data)) {
    return body.data as SalarioMinimoHistoricoItem[]
  }
  return []
}

export default function SalarioMinimoForm() {
  const { hasPermission, loading: permissionsLoading } = usePermissionsContext()
  const { success, error: toastError } = useToast()
  const queryClient = useQueryClient()
  const [valor, setValor] = useState('')
  const [vigenciaDesde, setVigenciaDesde] = useState(todayInput())
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const canRead = hasPermission('config.salario_minimo.read')
  const canWrite = hasPermission('config.salario_minimo.write')

  const atualQuery = useQuery({
    queryKey: ['salario-minimo-atual'],
    queryFn: fetchSalarioMinimoAtual,
    enabled: canRead,
  })

  const historicoQuery = useQuery({
    queryKey: ['salario-minimo-historico', 5],
    queryFn: fetchHistorico,
    enabled: canRead,
  })

  const current = atualQuery.data
  const history = useMemo(() => historicoQuery.data ?? [], [historicoQuery.data])

  const submit = async () => {
    setFormError(null)
    const numeric = Number(String(valor || '').replace(',', '.'))
    if (!Number.isFinite(numeric) || numeric <= 0) {
      setFormError('Informe um valor maior que zero')
      return
    }
    if (!vigenciaDesde) {
      setFormError('Informe a vigência desde')
      return
    }

    try {
      setSubmitting(true)
      const token = await getAccessToken()
      if (!token) throw new Error('Sessão expirada')

      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/update-salario-minimo`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          valor: numeric,
          vigencia_desde: vigenciaDesde,
        }),
      })
      const body: unknown = await response.json()
      if (!response.ok) {
        const message = body && typeof body === 'object' && 'error' in body ? String(body.error) : 'Erro ao atualizar salário mínimo'
        throw new Error(message)
      }

      setValor('')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['salario-minimo-atual'] }),
        queryClient.invalidateQueries({ queryKey: ['salario-minimo-historico', 5] }),
      ])
      success('Salário mínimo atualizado com sucesso.')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao atualizar salário mínimo'
      setFormError(message)
      toastError(message)
    } finally {
      setSubmitting(false)
    }
  }

  if (permissionsLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando permissões...
      </div>
    )
  }

  if (!canRead) {
    return (
      <Alert className="border-red-200 bg-red-50 text-red-800">
        <AlertDescription>Sem permissão</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Valor vigente</CardTitle>
          <CardDescription>Valor manual usado no cálculo das novas regras de cobrança por salário mínimo.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {atualQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando valor atual...
            </div>
          ) : atualQuery.isError ? (
            <Alert className="border-red-200 bg-red-50 text-red-800">
              <AlertDescription>{atualQuery.error.message}</AlertDescription>
            </Alert>
          ) : (
            <div className="rounded-md border bg-muted/20 p-4">
              <div className="text-3xl font-bold">
                {formatMoney(current?.valor)}{' '}
                <span className="text-base font-medium text-muted-foreground">
                  vigente desde {formatDate(current?.vigencia_desde)}
                </span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">Atualizado em {formatDateTime(current?.updated_at)}</p>
            </div>
          )}

          {formError ? (
            <Alert className="border-red-200 bg-red-50 text-red-800">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_220px_auto] md:items-end">
            <div className="space-y-2">
              <Label>Valor</Label>
              <MoneyInput value={valor} onValueChange={setValor} disabled={!canWrite || submitting} />
            </div>
            <div className="space-y-2">
              <Label>Vigência desde</Label>
              <DatePicker value={vigenciaDesde} onChange={setVigenciaDesde} disabled={!canWrite || submitting} />
            </div>
            <Button type="button" onClick={submit} disabled={!canWrite || submitting}>
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Atualizar
            </Button>
          </div>

          {!canWrite ? <p className="text-sm text-muted-foreground">Seu usuário pode visualizar, mas não editar o salário mínimo.</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Histórico</CardTitle>
          <CardDescription>Últimas 5 vigências registradas.</CardDescription>
        </CardHeader>
        <CardContent>
          {historicoQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando histórico...
            </div>
          ) : historicoQuery.isError ? (
            <Alert className="border-red-200 bg-red-50 text-red-800">
              <AlertDescription>{historicoQuery.error.message}</AlertDescription>
            </Alert>
          ) : history.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem histórico registrado.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Valor</TableHead>
                  <TableHead>Vigência</TableHead>
                  <TableHead>Atualizado em</TableHead>
                  <TableHead>Quem editou</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((item, index) => (
                  <TableRow key={`${item.vigencia_desde ?? 'sem-data'}-${index}`}>
                    <TableCell className="font-medium">{formatMoney(item.valor)}</TableCell>
                    <TableCell>{formatDate(item.vigencia_desde)}</TableCell>
                    <TableCell>{formatDateTime(item.updated_at)}</TableCell>
                    <TableCell>{item.updated_by_nome || item.updated_by || 'Não informado'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
