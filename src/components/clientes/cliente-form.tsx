'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'
import { fetchCEPData } from '@/lib/utils/validation'
import { maskCEP, maskCPF, maskCNPJ, maskPhone, onlyDigits } from '@/lib/utils/masks'

type GrupoEconomico = { id: string; nome: string }
type Segmento = { id: string; nome: string; ativo: boolean }

type ClientePayload = {
  nome: string
  cliente_estrangeiro: boolean
  cnpj: string
  conta_contabil: string
  tipo: 'pessoa_fisica' | 'pessoa_juridica' | ''
  cep: string
  rua: string
  numero: string
  complemento: string
  cidade: string
  estado: string
  regime_fiscal: string
  grupo_economico_id: string
  observacoes: string
  segmento_ids: string[]
  resp_int_nome: string
  resp_int_email: string
  resp_int_whatsapp: string
  resp_int_data_nascimento: string
  resp_fin_nome: string
  resp_fin_email: string
  resp_fin_whatsapp: string
}

const emptyPayload: ClientePayload = {
  nome: '',
  cliente_estrangeiro: false,
  cnpj: '',
  conta_contabil: '',
  tipo: '',
  cep: '',
  rua: '',
  numero: '',
  complemento: '',
  cidade: '',
  estado: '',
  regime_fiscal: '',
  grupo_economico_id: '',
  observacoes: '',
  segmento_ids: [],
  resp_int_nome: '',
  resp_int_email: '',
  resp_int_whatsapp: '',
  resp_int_data_nascimento: '',
  resp_fin_nome: '',
  resp_fin_email: '',
  resp_fin_whatsapp: '',
}

export default function ClienteForm({ clienteId }: { clienteId?: string }) {
  const router = useRouter()
  const { hasPermission } = usePermissionsContext()

  const canWrite = hasPermission('crm.clientes.write') || hasPermission('crm.clientes.*')

  const [loading, setLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(!!clienteId)
  const [error, setError] = useState<string | null>(null)
  const [optionsError, setOptionsError] = useState<string | null>(null)
  const [form, setForm] = useState<ClientePayload>(emptyPayload)
  const [cepPreenchido, setCepPreenchido] = useState(false)
  const [lastCepFetched, setLastCepFetched] = useState<string>('')

  const [grupos, setGrupos] = useState<GrupoEconomico[]>([])
  const [segmentos, setSegmentos] = useState<Segmento[]>([])

  const isEdit = useMemo(() => !!clienteId, [clienteId])
  const segmentosAtivos = useMemo(
    () => segmentos.filter((s) => s.ativo !== false),
    [segmentos]
  )

  useEffect(() => {
    const fetchOptions = async () => {
      setOptionsError(null)
      try {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return

        const [grResp, segResp] = await Promise.all([
          fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-grupos-economicos`, {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              'Content-Type': 'application/json',
            },
          }),
          fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-segmentos-economicos`, {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              'Content-Type': 'application/json',
            },
          }),
        ])

        const grData = await grResp.json()
        const segData = await segResp.json()
        if (grResp.ok) {
          setGrupos(Array.isArray(grData.data) ? grData.data : [])
        } else {
          setOptionsError(grData.error || 'Erro ao carregar grupos econômicos')
        }

        if (segResp.ok) {
          setSegmentos(Array.isArray(segData.data) ? segData.data : [])
        } else {
          setOptionsError(segData.error || 'Erro ao carregar segmentos econômicos')
        }
      } catch (e) {
        console.error(e)
        setOptionsError('Erro ao carregar dados auxiliares (grupos/segmentos)')
      }
    }

    fetchOptions()
  }, [])

  useEffect(() => {
    if (!clienteId) return

    const fetchCliente = async () => {
      setInitialLoading(true)
      setError(null)
      try {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return

        const resp = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-cliente?id=${clienteId}`,
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              'Content-Type': 'application/json',
            },
          }
        )
        const data = await resp.json()
        if (!resp.ok) {
          setError(data.error || 'Erro ao carregar cliente')
          return
        }

        const cliente = data.data?.cliente || {}
        const segmentoIds = (data.data?.segmento_ids || []) as string[]
        const ri = (data.data?.responsaveis_internos || [])[0] || {}
        const rf = (data.data?.responsaveis_financeiros || [])[0] || {}
        const clienteEstrangeiro = !!cliente.cliente_estrangeiro

        const tipoCliente = (cliente.tipo || '') as ClientePayload['tipo']
        const documentoMasked =
          clienteEstrangeiro
            ? ''
            : tipoCliente === 'pessoa_fisica'
              ? maskCPF(cliente.cnpj || '')
              : maskCNPJ(cliente.cnpj || '')

        setForm({
          ...emptyPayload,
          nome: cliente.nome || '',
          cliente_estrangeiro: clienteEstrangeiro,
          cnpj: documentoMasked,
          conta_contabil: cliente.conta_contabil || '',
          tipo: tipoCliente,
          cep: maskCEP(cliente.cep || ''),
          rua: cliente.rua || '',
          numero: cliente.numero || '',
          complemento: cliente.complemento || '',
          cidade: cliente.cidade || '',
          estado: cliente.estado || '',
          regime_fiscal: cliente.regime_fiscal || '',
          grupo_economico_id: cliente.grupo_economico_id || '',
          observacoes: cliente.observacoes || '',
          segmento_ids: segmentoIds,
          resp_int_nome: ri.nome || '',
          resp_int_email: ri.email || '',
          resp_int_whatsapp: maskPhone(ri.whatsapp || ''),
          resp_int_data_nascimento: ri.data_nascimento || '',
          resp_fin_nome: rf.nome || '',
          resp_fin_email: rf.email || '',
          resp_fin_whatsapp: maskPhone(rf.whatsapp || ''),
        })
      } catch (e) {
        console.error(e)
        setError('Erro ao carregar cliente')
      } finally {
        setInitialLoading(false)
      }
    }

    fetchCliente()
  }, [clienteId])

  const handleCepChange = async (value: string) => {
    const masked = maskCEP(value)
    const digits = masked.replace(/\D/g, '')

    setForm((prev) => ({ ...prev, cep: masked }))

    if (digits.length !== 8) {
      setCepPreenchido(false)
      return
    }

    if (digits === lastCepFetched) return
    setLastCepFetched(digits)

    const data = await fetchCEPData(digits)
    if (!data || data.erro) {
      setCepPreenchido(false)
      return
    }

    setForm((prev) => ({
      ...prev,
      rua: data.logradouro || prev.rua,
      cidade: data.localidade || prev.cidade,
      estado: data.uf || prev.estado,
    }))
    setCepPreenchido(true)
  }

  const selectedSegmentoId = form.segmento_ids[0] || ''

  const submit = async () => {
    setError(null)

    if (!canWrite) {
      setError('Você não tem permissão para realizar esta operação')
      return
    }
    if (!form.nome.trim()) {
      setError('Nome é obrigatório')
      return
    }
    if (!form.cliente_estrangeiro && !form.cnpj.trim()) {
      setError(form.tipo === 'pessoa_fisica' ? 'CPF é obrigatório para pessoa física' : 'CNPJ é obrigatório para cliente não estrangeiro')
      return
    }

    setLoading(true)
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const url = isEdit
        ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/update-cliente`
        : `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/create-cliente`

      const body: any = {
        nome: form.nome,
        cliente_estrangeiro: form.cliente_estrangeiro,
        cnpj: form.cnpj ? onlyDigits(form.cnpj) : null,
        conta_contabil: form.conta_contabil || null,
        tipo: form.tipo || null,
        cep: onlyDigits(form.cep) || null,
        rua: form.rua || null,
        numero: form.numero || null,
        complemento: form.complemento || null,
        cidade: form.cidade || null,
        estado: form.estado || null,
        regime_fiscal: form.regime_fiscal || null,
        grupo_economico_id: form.grupo_economico_id || null,
        observacoes: form.observacoes || null,
        segmento_ids: form.segmento_ids,
        resp_int_nome: form.resp_int_nome || null,
        resp_int_email: form.resp_int_email || null,
        resp_int_whatsapp: onlyDigits(form.resp_int_whatsapp) || null,
        resp_int_data_nascimento: form.resp_int_data_nascimento || null,
        resp_fin_nome: form.resp_fin_nome || null,
        resp_fin_email: form.resp_fin_email || null,
        resp_fin_whatsapp: onlyDigits(form.resp_fin_whatsapp) || null,
      }
      if (isEdit) body.id = clienteId

      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
      const data = await resp.json()
      if (!resp.ok) {
        setError(data.error || 'Erro ao salvar cliente')
        return
      }

      router.push('/pessoas/clientes')
      router.refresh()
    } catch (e) {
      console.error(e)
      setError('Erro ao salvar cliente')
    } finally {
      setLoading(false)
    }
  }

  if (!canWrite) {
    return (
      <div className="rounded-md bg-red-50 p-4">
        <p className="text-sm text-red-800">
          Você não tem permissão para criar/editar clientes
        </p>
      </div>
    )
  }

  if (initialLoading) {
    return (
      <div className="rounded-md border p-4">
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-10 rounded bg-gray-200"></div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {(error || optionsError) && (
        <div className="rounded-md bg-red-50 p-4">
          <p className="text-sm text-red-800">{error || optionsError}</p>
        </div>
      )}

      <Tabs defaultValue="dados-gerais" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="dados-gerais">Dados Gerais</TabsTrigger>
          <TabsTrigger value="endereco">Endereço</TabsTrigger>
          <TabsTrigger value="segmentos-obs">Segmentos/Obs</TabsTrigger>
          <TabsTrigger value="responsaveis">Responsáveis</TabsTrigger>
        </TabsList>

        <TabsContent value="dados-gerais">
          <Card>
            <CardHeader>
              <CardTitle>Dados Gerais</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="nome">Nome/Razão social *</Label>
                  <Input id="nome" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Cliente estrangeiro</Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={form.cliente_estrangeiro}
                      onChange={(e) =>
                        setForm({ ...form, cliente_estrangeiro: e.target.checked })
                      }
                    />
                    <span className="text-sm text-gray-700">Sim</span>
                  </div>
                </div>
                {!form.cliente_estrangeiro && (
                  <div className="space-y-2">
                    <Label htmlFor="cnpj">{form.tipo === 'pessoa_fisica' ? 'CPF *' : 'CNPJ *'}</Label>
                    <Input
                      id="cnpj"
                      value={form.cnpj}
                      maxLength={form.tipo === 'pessoa_fisica' ? 14 : 18}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          cnpj: form.tipo === 'pessoa_fisica' ? maskCPF(e.target.value) : maskCNPJ(e.target.value),
                        })
                      }
                    />
                  </div>
                )}
                <div className="space-y-2">
                  <Label>Tipo</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { value: 'pessoa_fisica', label: 'Pessoa física' },
                      { value: 'pessoa_juridica', label: 'Pessoa jurídica' },
                    ].map((item) => {
                      const active = form.tipo === item.value
                      return (
                        <Button
                          key={item.value}
                          type="button"
                          variant={active ? 'default' : 'outline'}
                          className="justify-start"
                          onClick={() => {
                            const tipo = item.value as ClientePayload['tipo']
                            const documento = onlyDigits(form.cnpj || '')
                            setForm({
                              ...form,
                              tipo,
                              cnpj: tipo === 'pessoa_fisica' ? maskCPF(documento) : maskCNPJ(documento),
                            })
                          }}
                        >
                          {item.label}
                        </Button>
                      )
                    })}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Regime fiscal</Label>
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                    {['Simples Nacional', 'Lucro Real', 'Lucro Presumido'].map((regime) => {
                      const active = form.regime_fiscal === regime
                      return (
                        <Button
                          key={regime}
                          type="button"
                          variant={active ? 'default' : 'outline'}
                          className="justify-start"
                          onClick={() => setForm({ ...form, regime_fiscal: regime })}
                        >
                          {regime}
                        </Button>
                      )
                    })}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="conta_contabil">Conta Contábil</Label>
                  <Input
                    id="conta_contabil"
                    value={form.conta_contabil}
                    onChange={(e) => setForm({ ...form, conta_contabil: e.target.value })}
                    placeholder="Ex.: 1.1.01.0030"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="endereco">
          <Card>
            <CardHeader>
              <CardTitle>Endereço (opcional)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="cep">CEP</Label>
                  <Input
                    id="cep"
                    value={form.cep}
                    maxLength={9}
                    onChange={(e) => handleCepChange(e.target.value)}
                    placeholder="00000-000"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="rua">Rua</Label>
                  <Input
                    id="rua"
                    value={form.rua}
                    readOnly={cepPreenchido}
                    className={cepPreenchido ? 'bg-gray-100 cursor-not-allowed' : ''}
                    onChange={(e) => setForm({ ...form, rua: e.target.value })}
                    placeholder={cepPreenchido ? 'Preenchido automaticamente pelo CEP' : ''}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="numero">Número</Label>
                  <Input id="numero" value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="complemento">Complemento</Label>
                  <Input id="complemento" value={form.complemento} onChange={(e) => setForm({ ...form, complemento: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cidade">Cidade</Label>
                  <Input
                    id="cidade"
                    value={form.cidade}
                    readOnly={cepPreenchido}
                    className={cepPreenchido ? 'bg-gray-100 cursor-not-allowed' : ''}
                    onChange={(e) => setForm({ ...form, cidade: e.target.value })}
                    placeholder={cepPreenchido ? 'Preenchido automaticamente pelo CEP' : ''}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="estado">Estado (UF)</Label>
                  <Input
                    id="estado"
                    value={form.estado}
                    maxLength={2}
                    readOnly={cepPreenchido}
                    className={cepPreenchido ? 'bg-gray-100 cursor-not-allowed' : ''}
                    onChange={(e) => setForm({ ...form, estado: e.target.value })}
                    placeholder={cepPreenchido ? 'Preenchido automaticamente pelo CEP' : 'SP'}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="segmentos-obs">
          <Card>
            <CardHeader>
              <CardTitle>Segmentos e Observações</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <h2 className="text-base font-semibold">Grupo econômico (opcional)</h2>
                <div className="mt-4 max-w-md space-y-2">
                  <Label htmlFor="grupo">Grupo econômico</Label>
                  <NativeSelect
                    id="grupo"
                    value={form.grupo_economico_id}
                    onChange={(e) =>
                      setForm({ ...form, grupo_economico_id: e.target.value })
                    }
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Sem grupo</option>
                    {grupos.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.nome}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              </div>

              <div>
                <h2 className="text-base font-semibold">Segmentos econômicos (opcional)</h2>
                {segmentosAtivos.length > 0 ? (
                  <div className="mt-4 space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="segmento_id">Segmento econômico</Label>
                        <NativeSelect
                          id="segmento_id"
                          value={selectedSegmentoId}
                          onChange={(e) => {
                            const id = e.target.value
                            setForm((prev) => ({
                              ...prev,
                              segmento_ids: id ? [id] : [],
                            }))
                          }}
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        >
                          <option value="">Sem segmento</option>
                          {segmentosAtivos.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.nome}
                            </option>
                          ))}
                        </NativeSelect>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 space-y-2">
                    {segmentos.length === 0 ? (
                      <p className="text-sm text-gray-500">Nenhum segmento cadastrado</p>
                    ) : (
                      <p className="text-sm text-gray-500">
                        Nenhum segmento ativo encontrado. Ative um segmento em Configuração &gt; Segmentos Econômicos.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div>
                <h2 className="text-base font-semibold">Observações</h2>
                <div className="mt-4 space-y-2">
                  <Label htmlFor="obs">Observações</Label>
                  <Textarea
                    id="obs"
                    value={form.observacoes}
                    onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
                    className="min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="responsaveis">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Responsável interno (opcional)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="ri_nome">Nome</Label>
                    <Input id="ri_nome" value={form.resp_int_nome} onChange={(e) => setForm({ ...form, resp_int_nome: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ri_email">E-mail</Label>
                    <Input id="ri_email" value={form.resp_int_email} onChange={(e) => setForm({ ...form, resp_int_email: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ri_whats">WhatsApp</Label>
                    <Input
                      id="ri_whats"
                      value={form.resp_int_whatsapp}
                      maxLength={15}
                      onChange={(e) => setForm({ ...form, resp_int_whatsapp: maskPhone(e.target.value) })}
                      placeholder="(00) 00000-0000"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ri_nasc">Data nascimento</Label>
                    <Input id="ri_nasc" type="date" value={form.resp_int_data_nascimento} onChange={(e) => setForm({ ...form, resp_int_data_nascimento: e.target.value })} />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Responsável financeiro (opcional)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="rf_nome">Nome</Label>
                    <Input id="rf_nome" value={form.resp_fin_nome} onChange={(e) => setForm({ ...form, resp_fin_nome: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="rf_email">E-mail</Label>
                    <Input id="rf_email" value={form.resp_fin_email} onChange={(e) => setForm({ ...form, resp_fin_email: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="rf_whats">WhatsApp</Label>
                    <Input
                      id="rf_whats"
                      value={form.resp_fin_whatsapp}
                      maxLength={15}
                      onChange={(e) => setForm({ ...form, resp_fin_whatsapp: maskPhone(e.target.value) })}
                      placeholder="(00) 00000-0000"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      <div className="flex items-center justify-end gap-3">
        <Button variant="outline" onClick={() => router.push('/pessoas/clientes')} disabled={loading}>
          Cancelar
        </Button>
        <Button onClick={submit} disabled={loading}>
          {loading ? 'Salvando...' : isEdit ? 'Atualizar' : 'Criar'}
        </Button>
      </div>
    </div>
  )
}
