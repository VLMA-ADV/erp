'use client'

import { useEffect, useMemo, useState } from 'react'
import { Plus, Pencil, Trash2, ChevronDown, ChevronRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'

interface Conta {
  id: string
  codigo: string
  grupo: string
  sintetica: string
  analitica: string
  natureza: string
  ativo: boolean
}

const emptyForm = { id: '', codigo: '', grupo: '', sintetica: '', analitica: '', natureza: 'Devedora', ativo: true }

export default function PlanoDeContasList() {
  const { hasPermission } = usePermissionsContext()
  const canRead = hasPermission('finance.contas_pagar.read') || hasPermission('config.*') || hasPermission('*')
  const canWrite = hasPermission('finance.contas_pagar.write') || hasPermission('config.*') || hasPermission('*')

  const [contas, setContas] = useState<Conta[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState({ ...emptyForm })
  const [saving, setSaving] = useState(false)

  const fetchContas = async () => {
    try {
      setLoading(true)
      const supabase = createClient()
      const { data, error: e } = await supabase.rpc('plano_contas_listar')
      if (e) { setError(e.message); return }
      setContas((data as Conta[]) || [])
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (canRead) fetchContas()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead])

  const grupos = useMemo(() => Array.from(new Set(contas.map((c) => c.grupo))).sort(), [contas])
  const sinteticas = useMemo(() => Array.from(new Set(contas.map((c) => c.sintetica))).sort(), [contas])

  // Filtro + árvore grupo -> sintética -> analíticas
  const tree = useMemo(() => {
    const term = search.trim().toLowerCase()
    const rows = term
      ? contas.filter((c) =>
          [c.codigo, c.grupo, c.sintetica, c.analitica].some((v) => v.toLowerCase().includes(term)))
      : contas
    const byGrupo = new Map<string, Map<string, Conta[]>>()
    for (const c of rows) {
      if (!byGrupo.has(c.grupo)) byGrupo.set(c.grupo, new Map())
      const bySin = byGrupo.get(c.grupo)!
      if (!bySin.has(c.sintetica)) bySin.set(c.sintetica, [])
      bySin.get(c.sintetica)!.push(c)
    }
    return byGrupo
  }, [contas, search])

  const openNew = () => { setForm({ ...emptyForm }); setModalOpen(true) }
  const openEdit = (c: Conta) => {
    setForm({ id: c.id, codigo: c.codigo, grupo: c.grupo, sintetica: c.sintetica, analitica: c.analitica, natureza: c.natureza, ativo: c.ativo })
    setModalOpen(true)
  }

  const save = async () => {
    if (!form.codigo.trim() || !form.grupo.trim() || !form.sintetica.trim() || !form.analitica.trim()) {
      setError('Código, grupo, conta sintética e analítica são obrigatórios'); return
    }
    try {
      setSaving(true)
      const supabase = createClient()
      const { error: e } = await supabase.rpc('plano_contas_upsert', {
        p_id: form.id || null,
        p_codigo: form.codigo.trim(),
        p_grupo: form.grupo.trim(),
        p_sintetica: form.sintetica.trim(),
        p_analitica: form.analitica.trim(),
        p_natureza: form.natureza,
        p_ativo: form.ativo,
      })
      if (e) { setError(e.message); return }
      setModalOpen(false)
      setOk(form.id ? 'Conta atualizada.' : 'Conta criada.')
      setError(null)
      await fetchContas()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (c: Conta) => {
    if (!confirm(`Excluir a conta "${c.analitica}" (${c.codigo})?`)) return
    try {
      const supabase = createClient()
      const { data, error: e } = await supabase.rpc('plano_contas_excluir', { p_id: c.id })
      if (e) { setError(e.message); return }
      const res = data as { inativado?: boolean; aviso?: string }
      setOk(res?.inativado ? (res.aviso || 'Conta inativada.') : 'Conta excluída.')
      setError(null)
      await fetchContas()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  if (!canRead) {
    return (
      <div className="rounded-md bg-red-50 p-4">
        <p className="text-sm text-red-800">Você não tem permissão para visualizar o plano de contas.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-800">{error}</div>
      )}
      {ok && (
        <div className="rounded-md bg-green-50 p-4 text-sm text-green-800">{ok}</div>
      )}

      <div className="flex items-center justify-between gap-3">
        <Input
          placeholder="Buscar por código, grupo, conta…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        {canWrite && (
          <Button onClick={openNew}>
            <Plus className="mr-2 h-4 w-4" /> Nova conta
          </Button>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-ink-mute">Carregando…</p>
      ) : tree.size === 0 ? (
        <p className="text-sm text-ink-mute">Nenhuma conta encontrada.</p>
      ) : (
        <div className="space-y-3">
          {Array.from(tree.entries()).map(([grupo, bySin]) => {
            const isCollapsed = collapsed[grupo]
            const totalGrupo = Array.from(bySin.values()).reduce((n, arr) => n + arr.length, 0)
            return (
              <div key={grupo} className="overflow-hidden rounded-lg border border-line">
                <button
                  type="button"
                  onClick={() => setCollapsed((s) => ({ ...s, [grupo]: !s[grupo] }))}
                  className="flex w-full items-center justify-between bg-surface-2 px-4 py-2.5 text-left"
                >
                  <span className="flex items-center gap-2 text-sm font-semibold text-primary">
                    {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    {grupo}
                  </span>
                  <span className="text-xs text-ink-mute">{totalGrupo} conta(s)</span>
                </button>

                {!isCollapsed && (
                  <div className="divide-y divide-line">
                    {Array.from(bySin.entries()).map(([sintetica, arr]) => (
                      <div key={sintetica} className="px-4 py-2">
                        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-mute">{sintetica}</p>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <tbody>
                              {arr.map((c) => (
                                <tr key={c.id} className="border-t border-line/60 first:border-t-0">
                                  <td className="w-24 py-1.5 pr-3 font-mono text-xs text-ink-mute tabular-nums">{c.codigo}</td>
                                  <td className="py-1.5 pr-3">
                                    <span className={c.ativo ? '' : 'text-ink-mute line-through'}>{c.analitica}</span>
                                    {!c.ativo && <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-ink-mute">inativa</span>}
                                  </td>
                                  <td className="w-24 py-1.5 pr-3 text-xs text-ink-mute">{c.natureza}</td>
                                  {canWrite && (
                                    <td className="w-20 py-1.5 text-right">
                                      <button onClick={() => openEdit(c)} className="mr-1 inline-flex rounded p-1 text-ink-mute hover:bg-surface-2 hover:text-ink" title="Editar">
                                        <Pencil className="h-3.5 w-3.5" />
                                      </button>
                                      <button onClick={() => remove(c)} className="inline-flex rounded p-1 text-ink-mute hover:bg-red-50 hover:text-red-600" title="Excluir">
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    </td>
                                  )}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form.id ? 'Editar conta' : 'Nova conta'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="pc-codigo">Código</Label>
              <Input id="pc-codigo" placeholder="ex.: 5.5.01" value={form.codigo}
                onChange={(e) => setForm((f) => ({ ...f, codigo: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="pc-grupo">Grupo</Label>
              <Input id="pc-grupo" list="pc-grupos" placeholder="Selecione ou digite um grupo" value={form.grupo}
                onChange={(e) => setForm((f) => ({ ...f, grupo: e.target.value }))} />
              <datalist id="pc-grupos">{grupos.map((g) => <option key={g} value={g} />)}</datalist>
            </div>
            <div>
              <Label htmlFor="pc-sintetica">Conta sintética</Label>
              <Input id="pc-sintetica" list="pc-sinteticas" placeholder="Selecione ou digite" value={form.sintetica}
                onChange={(e) => setForm((f) => ({ ...f, sintetica: e.target.value }))} />
              <datalist id="pc-sinteticas">{sinteticas.map((s) => <option key={s} value={s} />)}</datalist>
            </div>
            <div>
              <Label htmlFor="pc-analitica">Conta analítica</Label>
              <Input id="pc-analitica" placeholder="Nome da conta analítica" value={form.analitica}
                onChange={(e) => setForm((f) => ({ ...f, analitica: e.target.value }))} />
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <Label htmlFor="pc-natureza">Natureza</Label>
                <NativeSelect id="pc-natureza" value={form.natureza}
                  onChange={(e) => setForm((f) => ({ ...f, natureza: e.target.value }))}>
                  <option value="Devedora">Devedora</option>
                  <option value="Credora">Credora</option>
                </NativeSelect>
              </div>
              <div className="flex items-end pb-1">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.ativo}
                    onChange={(e) => setForm((f) => ({ ...f, ativo: e.target.checked }))} />
                  Ativa
                </label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)} disabled={saving}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Salvando…' : 'Salvar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
