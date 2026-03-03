'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MoneyInput } from '@/components/ui/money-input'
import { NativeSelect } from '@/components/ui/native-select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'
import { fetchCEPData } from '@/lib/utils/validation'
import { maskCEP, maskCpfCnpj, maskPhone, onlyDigits } from '@/lib/utils/masks'

type PrestadorPayload = {
  nome_prestador: string
  cpf_cnpj: string
  tipo_documento: 'cpf' | 'cnpj'
  conta_contabil: string
  servico_recorrente: boolean
  valor_recorrente: string
  categoria_prestador_parceiro_id: string
  cep: string
  rua: string
  numero: string
  complemento: string
  cidade: string
  estado: string
  resp_nome: string
  resp_email: string
  resp_cpf: string
  resp_telefone: string
  resp_whatsapp: string
  resp_cep: string
  resp_rua: string
  resp_numero: string
  resp_complemento: string
  resp_cidade: string
  resp_estado: string
  banco: string
  conta_com_digito: string
  agencia: string
  chave_pix: string
}

const emptyPayload: PrestadorPayload = {
  nome_prestador: '',
  cpf_cnpj: '',
  tipo_documento: 'cnpj',
  conta_contabil: '',
  servico_recorrente: false,
  valor_recorrente: '',
  categoria_prestador_parceiro_id: '',
  cep: '',
  rua: '',
  numero: '',
  complemento: '',
  cidade: '',
  estado: '',
  resp_nome: '',
  resp_email: '',
  resp_cpf: '',
  resp_telefone: '',
  resp_whatsapp: '',
  resp_cep: '',
  resp_rua: '',
  resp_numero: '',
  resp_complemento: '',
  resp_cidade: '',
  resp_estado: '',
  banco: '',
  conta_com_digito: '',
  agencia: '',
  chave_pix: '',
}

export default function PrestadorForm({
  prestadorId,
  redirectBasePath = '/pessoas/prestadores',
  permissionPrefixes = ['people.prestadores'],
  getEndpoint = 'get-prestador',
  createEndpoint = 'create-prestador',
  updateEndpoint = 'update-prestador',
  entityResponseKey = 'prestador',
  entityNameField = 'nome_prestador',
  entityLabel = 'prestador',
  entityPluralLabel = 'prestadores',
}: {
  prestadorId?: string
  redirectBasePath?: string
  permissionPrefixes?: string[]
  getEndpoint?: string
  createEndpoint?: string
  updateEndpoint?: string
  entityResponseKey?: 'prestador' | 'fornecedor'
  entityNameField?: 'nome_prestador' | 'nome_fornecedor'
  entityLabel?: string
  entityPluralLabel?: string
}) {
  const router = useRouter()
  const { hasPermission } = usePermissionsContext()

  const canWrite =
    permissionPrefixes.some((prefix) =>
      hasPermission(`${prefix}.write`) || hasPermission(`${prefix}.*`)
    ) ||
    hasPermission('people.*') ||
    hasPermission('*')

  const [loading, setLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(!!prestadorId)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<PrestadorPayload>(emptyPayload)
  const [cepPreenchido, setCepPreenchido] = useState(false)
  const [lastCepFetched, setLastCepFetched] = useState<string>('')
  const [respCepPreenchido, setRespCepPreenchido] = useState(false)
  const [lastRespCepFetched, setLastRespCepFetched] = useState<string>('')
  const [categoriasOptions, setCategoriasOptions] = useState<Array<{ id: string; nome: string }>>([])

  const isEdit = useMemo(() => !!prestadorId, [prestadorId])

  useEffect(() => {
    if (!prestadorId) return

    const fetchPrestador = async () => {
      setInitialLoading(true)
      setError(null)
      try {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return

        const resp = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/${getEndpoint}?id=${prestadorId}`,
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
          setError(data.error || `Erro ao carregar ${entityLabel}`)
          return
        }

        const prestador = data.data?.[entityResponseKey] || {}
        const ri = data.data?.responsavel_interno || {}
        const bank = data.data?.dados_bancarios || {}
        const tipoDocumento: 'cpf' | 'cnpj' =
          prestador.tipo_documento === 'cpf' ? 'cpf' : 'cnpj'

        setForm({
          ...emptyPayload,
          nome_prestador: prestador[entityNameField] || '',
          cpf_cnpj: maskCpfCnpj(prestador.cpf_cnpj || '', tipoDocumento),
          tipo_documento: tipoDocumento,
          conta_contabil: prestador.conta_contabil || '',
          servico_recorrente: !!prestador.servico_recorrente,
          valor_recorrente:
            prestador.valor_recorrente !== null && prestador.valor_recorrente !== undefined
              ? String(prestador.valor_recorrente)
              : '',
          categoria_prestador_parceiro_id: prestador.categoria_prestador_parceiro_id || '',
          cep: maskCEP(prestador.cep || ''),
          rua: prestador.rua || '',
          numero: prestador.numero || '',
          complemento: prestador.complemento || '',
          cidade: prestador.cidade || '',
          estado: prestador.estado || '',
          resp_nome: ri.nome || '',
          resp_email: ri.email || '',
          resp_cpf: maskCpfCnpj(ri.cpf || '', 'cpf'),
          resp_telefone: maskPhone(ri.telefone || ''),
          resp_whatsapp: maskPhone(ri.whatsapp || ''),
          resp_cep: maskCEP(ri.cep || ''),
          resp_rua: ri.rua || '',
          resp_numero: ri.numero || '',
          resp_complemento: ri.complemento || '',
          resp_cidade: ri.cidade || '',
          resp_estado: ri.estado || '',
          banco: bank.banco || '',
          conta_com_digito: bank.conta_com_digito || '',
          agencia: bank.agencia || '',
          chave_pix: bank.chave_pix || '',
        })
      } catch (e) {
        console.error(e)
        setError(`Erro ao carregar ${entityLabel}`)
      } finally {
        setInitialLoading(false)
      }
    }

    fetchPrestador()
  }, [entityLabel, entityNameField, entityResponseKey, getEndpoint, prestadorId])

  useEffect(() => {
    const fetchCategorias = async () => {
      try {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return

        const resp = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-categorias-prestadores-parceiros`,
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              'Content-Type': 'application/json',
            },
          }
        )
        const data = await resp.json()
        if (!resp.ok) return
        setCategoriasOptions((data.data || []).filter((item: any) => item.ativo !== false))
      } catch (e) {
        console.error(e)
      }
    }

    fetchCategorias()
  }, [])

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

  const handleRespCepChange = async (value: string) => {
    const masked = maskCEP(value)
    const digits = masked.replace(/\D/g, '')

    setForm((prev) => ({ ...prev, resp_cep: masked }))

    if (digits.length !== 8) {
      setRespCepPreenchido(false)
      return
    }

    if (digits === lastRespCepFetched) return
    setLastRespCepFetched(digits)

    const data = await fetchCEPData(digits)
    if (!data || data.erro) {
      setRespCepPreenchido(false)
      return
    }

    setForm((prev) => ({
      ...prev,
      resp_rua: data.logradouro || prev.resp_rua,
      resp_cidade: data.localidade || prev.resp_cidade,
      resp_estado: (data.uf || prev.resp_estado || '').toUpperCase(),
    }))
    setRespCepPreenchido(true)
  }

  const submit = async () => {
    setError(null)

    if (!canWrite) {
      setError('Você não tem permissão para realizar esta operação')
      return
    }
    if (!form.nome_prestador.trim() || !form.cpf_cnpj.trim()) {
      setError('Nome e CPF/CNPJ são obrigatórios')
      return
    }
    if (!form.resp_nome.trim()) {
      setError('Responsável é obrigatório')
      return
    }
    if (form.servico_recorrente && !form.valor_recorrente.trim()) {
      setError('Valor recorrente é obrigatório quando o serviço é recorrente')
      return
    }

    setLoading(true)
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const url = isEdit
        ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/${updateEndpoint}`
        : `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/${createEndpoint}`

      const body: any = {
        [entityNameField]: form.nome_prestador,
        cpf_cnpj: onlyDigits(form.cpf_cnpj),
        tipo_documento: form.tipo_documento,
        conta_contabil: form.conta_contabil || null,
        servico_recorrente: form.servico_recorrente,
        valor_recorrente: form.valor_recorrente ? parseFloat(form.valor_recorrente) : null,
        rua: form.rua || null,
        numero: form.numero || null,
        complemento: form.complemento || null,
        cidade: form.cidade || null,
        estado: form.estado || null,
        cep: onlyDigits(form.cep) || null,
        resp_nome: form.resp_nome || null,
        resp_email: form.resp_email || null,
        resp_cpf: onlyDigits(form.resp_cpf) || null,
        resp_telefone: onlyDigits(form.resp_telefone) || null,
        resp_whatsapp: onlyDigits(form.resp_whatsapp) || null,
        resp_cep: onlyDigits(form.resp_cep) || null,
        resp_rua: form.resp_rua || null,
        resp_numero: form.resp_numero || null,
        resp_complemento: form.resp_complemento || null,
        resp_cidade: form.resp_cidade || null,
        resp_estado: form.resp_estado || null,
        banco: form.banco || null,
        conta_com_digito: form.conta_com_digito || null,
        agencia: form.agencia || null,
        chave_pix: form.chave_pix || null,
        categoria_servico_id: null,
        categoria_prestador_parceiro_id: form.categoria_prestador_parceiro_id || null,
      }
      if (isEdit) body.id = prestadorId

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
        setError(data.error || `Erro ao salvar ${entityLabel}`)
        return
      }

      router.push(redirectBasePath)
      router.refresh()
    } catch (e) {
      console.error(e)
      setError(`Erro ao salvar ${entityLabel}`)
    } finally {
      setLoading(false)
    }
  }

  if (!canWrite) {
    return (
      <div className="rounded-md bg-red-50 p-4">
        <p className="text-sm text-red-800">
          Você não tem permissão para criar/editar {entityPluralLabel}
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
      {error && (
        <div className="rounded-md bg-red-50 p-4">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      <Tabs defaultValue="dados-gerais" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="dados-gerais">Dados Gerais</TabsTrigger>
          <TabsTrigger value="endereco">Endereço</TabsTrigger>
          <TabsTrigger value="responsavel">Responsável</TabsTrigger>
          <TabsTrigger value="bancarios">Bancários</TabsTrigger>
        </TabsList>

        <TabsContent value="dados-gerais">
          <Card>
            <CardHeader>
              <CardTitle>Dados Gerais</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="nome">Nome *</Label>
                  <Input
                    id="nome"
                    value={form.nome_prestador}
                    onChange={(e) =>
                      setForm({ ...form, nome_prestador: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cpf_cnpj">CPF/CNPJ *</Label>
                  <Input
                    id="cpf_cnpj"
                    value={form.cpf_cnpj}
                    maxLength={form.tipo_documento === 'cpf' ? 14 : 18}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        cpf_cnpj: maskCpfCnpj(e.target.value, form.tipo_documento),
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tipo_documento">Tipo documento</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { value: 'cpf', label: 'CPF' },
                      { value: 'cnpj', label: 'CNPJ' },
                    ].map((item) => {
                      const active = form.tipo_documento === item.value
                      return (
                        <Button
                          key={item.value}
                          type="button"
                          variant={active ? 'default' : 'outline'}
                          onClick={() => {
                            const next = item.value as 'cpf' | 'cnpj'
                            setForm((prev) => ({
                              ...prev,
                              tipo_documento: next,
                              cpf_cnpj: maskCpfCnpj(prev.cpf_cnpj, next),
                            }))
                          }}
                        >
                          {item.label}
                        </Button>
                      )
                    })}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="categoria_prestador_parceiro_id">Categoria</Label>
                  <NativeSelect
                    id="categoria_prestador_parceiro_id"
                    value={form.categoria_prestador_parceiro_id}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, categoria_prestador_parceiro_id: e.target.value }))
                    }
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Selecione...</option>
                    {categoriasOptions.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.nome}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="conta_contabil">Conta Contábil</Label>
                  <Input
                    id="conta_contabil"
                    value={form.conta_contabil}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, conta_contabil: e.target.value }))
                    }
                    placeholder="Ex.: 2.1.01.0004"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Serviço recorrente</Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={form.servico_recorrente}
                      onChange={(e) =>
                        setForm({ ...form, servico_recorrente: e.target.checked })
                      }
                    />
                    <span className="text-sm text-gray-700">Sim</span>
                  </div>
                </div>
                {form.servico_recorrente && (
                  <div className="space-y-2">
                    <Label htmlFor="valor_recorrente">Valor recorrente *</Label>
                    <MoneyInput
                      value={form.valor_recorrente}
                      onValueChange={(value) => setForm({ ...form, valor_recorrente: value })}
                    />
                  </div>
                )}
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

        <TabsContent value="responsavel">
          <Card>
            <CardHeader>
              <CardTitle>Responsável Interno</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="resp_nome">Nome *</Label>
                  <Input id="resp_nome" value={form.resp_nome} onChange={(e) => setForm({ ...form, resp_nome: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="resp_email">E-mail</Label>
                  <Input id="resp_email" value={form.resp_email} onChange={(e) => setForm({ ...form, resp_email: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="resp_cpf">CPF</Label>
                  <Input
                    id="resp_cpf"
                    value={form.resp_cpf}
                    maxLength={14}
                    onChange={(e) => setForm({ ...form, resp_cpf: maskCpfCnpj(e.target.value, 'cpf') })}
                    placeholder="000.000.000-00"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="resp_telefone">Telefone</Label>
                  <Input
                    id="resp_telefone"
                    value={form.resp_telefone}
                    maxLength={15}
                    onChange={(e) => setForm({ ...form, resp_telefone: maskPhone(e.target.value) })}
                    placeholder="(00) 00000-0000"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="resp_whatsapp">WhatsApp</Label>
                  <Input
                    id="resp_whatsapp"
                    value={form.resp_whatsapp}
                    maxLength={15}
                    onChange={(e) => setForm({ ...form, resp_whatsapp: maskPhone(e.target.value) })}
                    placeholder="(00) 00000-0000"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="resp_cep">CEP</Label>
                  <Input
                    id="resp_cep"
                    value={form.resp_cep}
                    maxLength={9}
                    onChange={(e) => handleRespCepChange(e.target.value)}
                    placeholder="00000-000"
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="resp_rua">Rua</Label>
                  <Input
                    id="resp_rua"
                    value={form.resp_rua}
                    readOnly={respCepPreenchido}
                    className={respCepPreenchido ? 'cursor-not-allowed bg-gray-100' : ''}
                    onChange={(e) => setForm({ ...form, resp_rua: e.target.value })}
                    placeholder={respCepPreenchido ? 'Preenchido automaticamente pelo CEP' : ''}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="resp_numero">Número</Label>
                  <Input id="resp_numero" value={form.resp_numero} onChange={(e) => setForm({ ...form, resp_numero: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="resp_complemento">Complemento</Label>
                  <Input id="resp_complemento" value={form.resp_complemento} onChange={(e) => setForm({ ...form, resp_complemento: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="resp_cidade">Cidade</Label>
                  <Input
                    id="resp_cidade"
                    value={form.resp_cidade}
                    readOnly={respCepPreenchido}
                    className={respCepPreenchido ? 'cursor-not-allowed bg-gray-100' : ''}
                    onChange={(e) => setForm({ ...form, resp_cidade: e.target.value })}
                    placeholder={respCepPreenchido ? 'Preenchido automaticamente pelo CEP' : ''}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="resp_estado">Estado (UF)</Label>
                  <Input
                    id="resp_estado"
                    maxLength={2}
                    value={form.resp_estado}
                    readOnly={respCepPreenchido}
                    className={respCepPreenchido ? 'cursor-not-allowed bg-gray-100' : ''}
                    onChange={(e) => setForm({ ...form, resp_estado: e.target.value.toUpperCase() })}
                    placeholder={respCepPreenchido ? 'Preenchido automaticamente pelo CEP' : 'SP'}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="bancarios">
          <Card>
            <CardHeader>
              <CardTitle>Dados Bancários (opcional)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="banco">Banco</Label>
                  <Input id="banco" value={form.banco} onChange={(e) => setForm({ ...form, banco: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="conta">Conta com dígito</Label>
                  <Input id="conta" value={form.conta_com_digito} onChange={(e) => setForm({ ...form, conta_com_digito: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="agencia">Agência</Label>
                  <Input id="agencia" value={form.agencia} onChange={(e) => setForm({ ...form, agencia: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pix">Chave PIX</Label>
                  <Input id="pix" value={form.chave_pix} onChange={(e) => setForm({ ...form, chave_pix: e.target.value })} />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="flex items-center justify-end gap-3">
        <Button variant="outline" onClick={() => router.push(redirectBasePath)} disabled={loading}>
          Cancelar
        </Button>
        <Button onClick={submit} disabled={loading}>
          {loading ? 'Salvando...' : isEdit ? 'Atualizar' : 'Criar'}
        </Button>
      </div>
    </div>
  )
}
