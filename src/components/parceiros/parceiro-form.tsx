'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'
import { fetchCEPData } from '@/lib/utils/validation'
import { maskCEP, maskCNPJ, maskCPF, maskPhone, onlyDigits } from '@/lib/utils/masks'

type ParceiroPayload = {
  nome_escritorio: string
  cnpj: string
  conta_contabil: string
  categoria_prestador_parceiro_id: string
  cep: string
  rua: string
  numero: string
  complemento: string
  cidade: string
  estado: string

  adv_nome: string
  adv_email: string
  adv_oab: string
  adv_cpf: string
  adv_whatsapp: string

  fin_nome: string
  fin_email: string
  fin_whatsapp: string

  banco: string
  conta_com_digito: string
  agencia: string
  chave_pix: string
}

const emptyPayload: ParceiroPayload = {
  nome_escritorio: '',
  cnpj: '',
  conta_contabil: '',
  categoria_prestador_parceiro_id: '',
  cep: '',
  rua: '',
  numero: '',
  complemento: '',
  cidade: '',
  estado: '',
  adv_nome: '',
  adv_email: '',
  adv_oab: '',
  adv_cpf: '',
  adv_whatsapp: '',
  fin_nome: '',
  fin_email: '',
  fin_whatsapp: '',
  banco: '',
  conta_com_digito: '',
  agencia: '',
  chave_pix: '',
}

export default function ParceiroForm({ parceiroId }: { parceiroId?: string }) {
  const router = useRouter()
  const { hasPermission } = usePermissionsContext()

  const canWrite =
    hasPermission('people.parceiros.write') || hasPermission('people.parceiros.*')

  const [loading, setLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(!!parceiroId)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<ParceiroPayload>(emptyPayload)
  const [cepPreenchido, setCepPreenchido] = useState(false)
  const [lastCepFetched, setLastCepFetched] = useState<string>('')
  const [categoriasOptions, setCategoriasOptions] = useState<Array<{ id: string; nome: string }>>([])

  const isEdit = useMemo(() => !!parceiroId, [parceiroId])

  useEffect(() => {
    if (!parceiroId) return

    const fetchParceiro = async () => {
      setInitialLoading(true)
      setError(null)
      try {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return

        const resp = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-parceiro?id=${parceiroId}`,
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
          setError(data.error || 'Erro ao carregar parceiro')
          return
        }

        const parceiro = data.data?.parceiro || {}
        const adv = data.data?.advogado_responsavel || {}
        const fin = data.data?.responsavel_financeiro || {}
        const bank = data.data?.dados_bancarios || {}

        setForm({
          ...emptyPayload,
          nome_escritorio: parceiro.nome_escritorio || '',
          cnpj: maskCNPJ(parceiro.cnpj || ''),
          conta_contabil: parceiro.conta_contabil || '',
          categoria_prestador_parceiro_id: parceiro.categoria_prestador_parceiro_id || '',
          cep: maskCEP(parceiro.cep || ''),
          rua: parceiro.rua || '',
          numero: parceiro.numero || '',
          complemento: parceiro.complemento || '',
          cidade: parceiro.cidade || '',
          estado: parceiro.estado || '',
          adv_nome: adv.nome || '',
          adv_email: adv.email || '',
          adv_oab: adv.oab || '',
          adv_cpf: maskCPF(adv.cpf || ''),
          adv_whatsapp: maskPhone(adv.whatsapp || ''),
          fin_nome: fin.nome || '',
          fin_email: fin.email || '',
          fin_whatsapp: maskPhone(fin.whatsapp || ''),
          banco: bank.banco || '',
          conta_com_digito: bank.conta_com_digito || '',
          agencia: bank.agencia || '',
          chave_pix: bank.chave_pix || '',
        })
      } catch (e) {
        console.error(e)
        setError('Erro ao carregar parceiro')
      } finally {
        setInitialLoading(false)
      }
    }

    fetchParceiro()
  }, [parceiroId])

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

  const submit = async () => {
    setError(null)

    if (!canWrite) {
      setError('Você não tem permissão para realizar esta operação')
      return
    }
    if (!form.nome_escritorio.trim() || !form.cnpj.trim()) {
      setError('Nome do escritório e CNPJ são obrigatórios')
      return
    }

    setLoading(true)
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const url = isEdit
        ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/update-parceiro`
        : `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/create-parceiro`

      const body: any = {
        nome_escritorio: form.nome_escritorio,
        cnpj: onlyDigits(form.cnpj),
        conta_contabil: form.conta_contabil || null,
        categoria_prestador_parceiro_id: form.categoria_prestador_parceiro_id || null,
        cep: onlyDigits(form.cep) || null,
        rua: form.rua || null,
        numero: form.numero || null,
        complemento: form.complemento || null,
        cidade: form.cidade || null,
        estado: form.estado || null,

        adv_nome: form.adv_nome || null,
        adv_email: form.adv_email || null,
        adv_oab: form.adv_oab || null,
        adv_cpf: onlyDigits(form.adv_cpf) || null,
        adv_whatsapp: onlyDigits(form.adv_whatsapp) || null,

        fin_nome: form.fin_nome || null,
        fin_email: form.fin_email || null,
        fin_whatsapp: onlyDigits(form.fin_whatsapp) || null,

        banco: form.banco || null,
        conta_com_digito: form.conta_com_digito || null,
        agencia: form.agencia || null,
        chave_pix: form.chave_pix || null,
      }

      if (isEdit) body.id = parceiroId

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
        setError(data.error || 'Erro ao salvar parceiro')
        return
      }

      router.push('/pessoas/parceiros')
      router.refresh()
    } catch (e) {
      console.error(e)
      setError('Erro ao salvar parceiro')
    } finally {
      setLoading(false)
    }
  }

  if (!canWrite) {
    return (
      <div className="rounded-md bg-red-50 p-4">
        <p className="text-sm text-red-800">
          Você não tem permissão para criar/editar parceiros
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
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="dados-gerais">Dados Gerais</TabsTrigger>
          <TabsTrigger value="endereco">Endereço</TabsTrigger>
          <TabsTrigger value="advogado">Advogado</TabsTrigger>
          <TabsTrigger value="financeiro">Financeiro</TabsTrigger>
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
                  <Label htmlFor="nome_escritorio">Nome do escritório *</Label>
                  <Input
                    id="nome_escritorio"
                    value={form.nome_escritorio}
                    onChange={(e) => setForm({ ...form, nome_escritorio: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cnpj">CNPJ *</Label>
                  <Input
                    id="cnpj"
                    value={form.cnpj}
                    maxLength={18}
                    onChange={(e) => setForm({ ...form, cnpj: maskCNPJ(e.target.value) })}
                  />
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
                    onChange={(e) => setForm({ ...form, conta_contabil: e.target.value })}
                    placeholder="Ex.: 1.1.02.0001"
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
                  <Input
                    id="numero"
                    value={form.numero}
                    onChange={(e) => setForm({ ...form, numero: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="complemento">Complemento</Label>
                  <Input
                    id="complemento"
                    value={form.complemento}
                    onChange={(e) => setForm({ ...form, complemento: e.target.value })}
                  />
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

        <TabsContent value="advogado">
          <Card>
            <CardHeader>
              <CardTitle>Advogado Responsável (opcional)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="adv_nome">Nome</Label>
                  <Input id="adv_nome" value={form.adv_nome} onChange={(e) => setForm({ ...form, adv_nome: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="adv_email">E-mail</Label>
                  <Input id="adv_email" value={form.adv_email} onChange={(e) => setForm({ ...form, adv_email: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="adv_oab">OAB</Label>
                  <Input id="adv_oab" value={form.adv_oab} onChange={(e) => setForm({ ...form, adv_oab: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="adv_cpf">CPF</Label>
                  <Input
                    id="adv_cpf"
                    value={form.adv_cpf}
                    maxLength={14}
                    onChange={(e) => setForm({ ...form, adv_cpf: maskCPF(e.target.value) })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="adv_whatsapp">WhatsApp</Label>
                  <Input
                    id="adv_whatsapp"
                    value={form.adv_whatsapp}
                    maxLength={15}
                    onChange={(e) => setForm({ ...form, adv_whatsapp: maskPhone(e.target.value) })}
                    placeholder="(00) 00000-0000"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="financeiro">
          <Card>
            <CardHeader>
              <CardTitle>Responsável Financeiro (opcional)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="fin_nome">Nome</Label>
                  <Input id="fin_nome" value={form.fin_nome} onChange={(e) => setForm({ ...form, fin_nome: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fin_email">E-mail</Label>
                  <Input id="fin_email" value={form.fin_email} onChange={(e) => setForm({ ...form, fin_email: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fin_whatsapp">WhatsApp</Label>
                  <Input
                    id="fin_whatsapp"
                    value={form.fin_whatsapp}
                    maxLength={15}
                    onChange={(e) => setForm({ ...form, fin_whatsapp: maskPhone(e.target.value) })}
                    placeholder="(00) 00000-0000"
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
        <Button variant="outline" onClick={() => router.push('/pessoas/parceiros')} disabled={loading}>
          Cancelar
        </Button>
        <Button onClick={submit} disabled={loading}>
          {loading ? 'Salvando...' : isEdit ? 'Atualizar' : 'Criar'}
        </Button>
      </div>
    </div>
  )
}
