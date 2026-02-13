'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { validateCPF, formatCPF, validateOAB, formatPhone, formatCEP, fetchCEPData } from '@/lib/utils/validation'
import { useColaboradorFormData } from '@/lib/hooks/use-colaborador-form-data'
import { LoadingProgressWithSteps } from '@/components/ui/loading-progress'
import { MoneyInput } from '@/components/ui/money-input'

interface ColaboradorEditFormProps {
  colaboradorId: string
}

export default function ColaboradorEditForm({ colaboradorId }: ColaboradorEditFormProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [loadingStep, setLoadingStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [colaboradorPermissionIds, setColaboradorPermissionIds] = useState<string[]>([])
  const [cepPreenchido, setCepPreenchido] = useState(false)
  
  // Usar hook compartilhado para dados de formulário (cache em memória)
  const { cargos, areas, roles, permissions, loading: loadingFormData } = useColaboradorFormData()
  
  // Form fields - Dados Pessoais
  const [dadosPessoais, setDadosPessoais] = useState({
    nome: '',
    email: '',
    cpf: '',
    data_nascimento: '',
    categoria: 'estagiario',
    oab: '',
  })

  // Form fields - Contato
  const [contato, setContato] = useState({
    cep: '',
    whatsapp: '',
    rua: '',
    numero: '',
    complemento: '',
    cidade: '',
    estado: '',
  })

  // Form fields - Profissional
  const [profissional, setProfissional] = useState({
    cargo_id: '',
    area_id: '',
    categoria_profissional: '',
    adicional: '',
    percentual_adicional: '',
    salario: '',
  })

  const permissoesSistema = [
    { value: 'socio', label: 'Sócio' },
    { value: 'advogado', label: 'Advogado' },
    { value: 'administrativo', label: 'Administrativo' },
    { value: 'estagiario', label: 'Estagiário' },
  ]

  const categoriasProfissionais = [
    { value: 'contencioso', label: 'Contencioso' },
    { value: 'consultoria', label: 'Consultoria' },
    { value: 'administrativo', label: 'Administrativo' },
    { value: 'coordenacao', label: 'Coordenação' },
    { value: 'socios', label: 'Sócios' },
  ]

  // Form fields - Bancário
  const [bancario, setBancario] = useState({
    banco: '',
    conta_com_digito: '',
    agencia: '',
    chave_pix: '',
  })

  // Form fields - Benefícios e Permissões
  const [beneficios, setBeneficios] = useState<string[]>([])
  const [roleIds, setRoleIds] = useState<string[]>([])

  useEffect(() => {
    async function fetchInitialData() {
      try {
        setLoading(true)
        setLoadingStep(1) // Buscando dados do colaborador
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()

        if (!session) {
          router.push('/login')
          return
        }

        const headers = {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        }

        // Fetch colaborador
        setLoadingStep(2) // Processando dados
        const colaboradorResponse = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-colaborador?id=${colaboradorId}`,
          { method: 'GET', headers }
        )

        if (!colaboradorResponse.ok) {
          const errorData = await colaboradorResponse.json()
          setError(errorData.error || 'Erro ao carregar dados do colaborador')
          setLoading(false)
          return
        }

        const colaboradorResult = await colaboradorResponse.json()
        const colaborador = colaboradorResult.data
        setLoadingStep(3) // Dados carregados, preenchendo formulário

        // Preencher dados pessoais
        setDadosPessoais({
          nome: colaborador.nome || '',
          email: colaborador.email || '',
          cpf: colaborador.cpf || '',
          data_nascimento: colaborador.data_nascimento || '',
          categoria: colaborador.categoria || 'estagiario',
          oab: colaborador.oab || '',
        })

        // Preencher contato (assumindo que os dados de endereço estão no colaborador)
        setContato({
          cep: colaborador.cep || '',
          whatsapp: colaborador.whatsapp || '',
          rua: colaborador.rua || '',
          numero: colaborador.numero || '',
          complemento: colaborador.complemento || '',
          cidade: colaborador.cidade || '',
          estado: colaborador.estado || '',
        })

        // Se houver CEP, marcar como preenchido
        if (colaborador.cep) {
          setCepPreenchido(true)
        }

        // Preencher profissional
        setProfissional({
          cargo_id: colaborador.cargo_id || '',
          area_id: colaborador.area_id || '',
          categoria_profissional: colaborador.categoria_profissional || '',
          adicional: colaborador.adicional || '',
          percentual_adicional: colaborador.percentual_adicional?.toString() || '',
          salario: colaborador.salario?.toString() || '',
        })

        // Preencher bancário
        setBancario({
          banco: colaborador.banco || '',
          conta_com_digito: colaborador.conta_com_digito || '',
          agencia: colaborador.agencia || '',
          chave_pix: colaborador.chave_pix || '',
        })

        // Preencher benefícios
        if (colaborador.colaboradores_beneficios) {
          setBeneficios(colaborador.colaboradores_beneficios.map((b: any) => b.beneficio || b))
        }

        // Preencher roles do colaborador (já vem do get_colaborador_complete)
        if (colaborador.user_roles && colaborador.user_roles.length > 0) {
          setRoleIds(colaborador.user_roles.map((r: any) => r.role_id))
        }

        // Preencher permissões do colaborador (já vem do get_colaborador_complete)
        setLoadingStep(4) // Carregando permissões
        if (colaborador.permissions && Array.isArray(colaborador.permissions) && colaborador.permissions.length > 0) {
          const permissionIds = colaborador.permissions.map((p: any) => p.permission_id || p.id)
          setColaboradorPermissionIds(permissionIds)
        } else {
          // Se não houver permissões diretas, buscar via API (fallback)
          const colaboradorPermissionsResponse = await fetch(
            `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-colaborador-permissions?id=${colaboradorId}`,
            { method: 'GET', headers }
          )
          if (colaboradorPermissionsResponse.ok) {
            const colaboradorPermissionsData = await colaboradorPermissionsResponse.json()
            if (colaboradorPermissionsData.data && Array.isArray(colaboradorPermissionsData.data)) {
              const fetchedPermissionIds = colaboradorPermissionsData.data.map((p: any) => p.permission_id || p)
              setColaboradorPermissionIds(fetchedPermissionIds)
            }
          }
        }

        setLoadingStep(5) // Completo
      } catch (err) {
        console.error('Error fetching initial data:', err)
        setError('Erro ao carregar dados do colaborador')
      } finally {
        setLoading(false)
      }
    }

    fetchInitialData()
  }, [colaboradorId, router])

  // useEffect para pré-preencher permissões baseado na categoria quando necessário
  useEffect(() => {
    async function prefillPermissionsIfNeeded() {
      // Só executar se:
      // 1. Não estiver carregando
      // 2. Não houver permissões já atribuídas
      // 3. Permissions do hook estiverem carregadas
      // 4. Categoria estiver definida
      if (!loading && !loadingFormData && 
          colaboradorPermissionIds.length === 0 && 
          Object.keys(permissions).length > 0 &&
          dadosPessoais.categoria) {
        await loadPermissionsByCategory(dadosPessoais.categoria)
      }
    }

    prefillPermissionsIfNeeded()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, loadingFormData, colaboradorPermissionIds.length, permissions, dadosPessoais.categoria])

  const handleDadosPessoaisChange = async (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    
    let formattedValue = value
    if (name === 'cpf') {
      formattedValue = formatCPF(value)
    }
    
    setDadosPessoais((prev) => ({
      ...prev,
      [name]: formattedValue,
    }))

    // Se a categoria mudou, pré-preencher permissões
    if (name === 'categoria' && value) {
      await loadPermissionsByCategory(value)
    }
  }

  const loadPermissionsByCategory = async (categoria: string) => {
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) return

      const headers = {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      }

      // Buscar permissões da role correspondente à categoria
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-permissions-by-role?role_name=${categoria}`,
        { method: 'GET', headers }
      )

      if (response.ok) {
        const data = await response.json()
        if (data.data && Array.isArray(data.data)) {
          const permissionIds = data.data.map((p: any) => p.permission_id || p)
          setColaboradorPermissionIds(permissionIds)
          
          // Também atualizar as roles correspondentes (usar roles do hook)
          if (roles.length > 0) {
            const role = roles.find((r: any) => r.nome.toLowerCase() === categoria.toLowerCase())
            if (role) {
              setRoleIds([role.id])
            }
          }
        }
      }
    } catch (err) {
      console.error('Error loading permissions by category:', err)
    }
  }

  const handleContatoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    
    let formattedValue = value
    if (name === 'whatsapp') {
      formattedValue = formatPhone(value.replace(/\D/g, '').slice(0, 11))
    } else if (name === 'cep') {
      formattedValue = formatCEP(value)
    }
    
    setContato((prev) => ({
      ...prev,
      [name]: formattedValue,
    }))

    // Buscar dados do CEP quando completo (8 dígitos)
    if (name === 'cep') {
      const cleanCEP = value.replace(/\D/g, '')
      if (cleanCEP.length === 8) {
        const cepData = await fetchCEPData(cleanCEP)
        if (cepData && !cepData.erro) {
          setCepPreenchido(true)
          setContato((prev) => ({
            ...prev,
            cep: formattedValue,
            rua: cepData.logradouro || '',
            cidade: cepData.localidade || '',
            estado: cepData.uf || '',
            complemento: cepData.complemento || prev.complemento,
          }))
        } else {
          setCepPreenchido(false)
        }
      } else if (cleanCEP.length < 8) {
        // Se o CEP foi apagado ou está incompleto, limpar os campos
        setCepPreenchido(false)
        setContato((prev) => ({
          ...prev,
          rua: '',
          cidade: '',
          estado: '',
        }))
      }
    }
  }

  const handleProfissionalChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setProfissional((prev) => ({
      ...prev,
      [name]: value,
    }))
  }

  const handleBancarioChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setBancario((prev) => ({
      ...prev,
      [name]: value,
    }))
  }

  const toggleBeneficio = (beneficio: string) => {
    setBeneficios((prev) =>
      prev.includes(beneficio)
        ? prev.filter((b) => b !== beneficio)
        : [...prev, beneficio]
    )
  }

  const toggleRole = (roleId: string) => {
    setRoleIds((prev) =>
      prev.includes(roleId)
        ? prev.filter((r) => r !== roleId)
        : [...prev, roleId]
    )
  }

  // Função para obter role sugerida baseada na categoria
  const getSuggestedRoleId = (): string | null => {
    if (roles.length === 0 || !dadosPessoais.categoria) return null
    const suggestedRole = roles.find(
      (role) => role.nome.toLowerCase() === dadosPessoais.categoria.toLowerCase()
    )
    return suggestedRole?.id || null
  }

  const validateForm = (): string | null => {
    if (!validateCPF(dadosPessoais.cpf)) {
      return 'CPF inválido'
    }
    
    if (dadosPessoais.categoria === 'advogado' && dadosPessoais.oab && !validateOAB(dadosPessoais.oab)) {
      return 'OAB deve estar no formato: OAB/SP 123456'
    }
    
    if (!profissional.cargo_id) {
      return 'Cargo é obrigatório'
    }

    if (profissional.adicional && !profissional.percentual_adicional) {
      return 'Percentual adicional é obrigatório quando adicional é selecionado'
    }

    if (profissional.percentual_adicional) {
      const percentual = parseFloat(profissional.percentual_adicional)
      if (percentual < 0 || percentual > 20) {
        return 'Percentual adicional deve estar entre 0% e 20%'
      }
    }
    
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    
    const validationError = validateForm()
    if (validationError) {
      setError(validationError)
      return
    }
    
    setSaving(true)

    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        router.push('/login')
        return
      }

      // Limpar formatação do CPF antes de enviar
      const cleanCPF = dadosPessoais.cpf.replace(/\D/g, '')

      const formData = {
        id: colaboradorId,
        ...dadosPessoais,
        cpf: cleanCPF, // CPF sem formatação
        ...contato,
        ...profissional,
        ...bancario,
        area_id: profissional.area_id || null,
        categoria_profissional: profissional.categoria_profissional || null,
        adicional: profissional.adicional || null,
        percentual_adicional: profissional.percentual_adicional ? parseFloat(profissional.percentual_adicional) : null,
        salario: profissional.salario ? parseFloat(profissional.salario) : null,
        data_nascimento: dadosPessoais.data_nascimento || null,
        beneficios,
        role_ids: roleIds,
        permission_ids: colaboradorPermissionIds, // Incluir permission_ids para atualização
      }

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/update-colaborador`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(formData),
        }
      )

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Erro ao atualizar colaborador')
        setSaving(false)
        return
      }

      router.push('/pessoas/colaboradores')
    } catch (err) {
      setError('Erro ao atualizar colaborador. Tente novamente.')
      setSaving(false)
    }
  }

  if (loading || loadingFormData) {
    return (
      <LoadingProgressWithSteps
        isLoading={true}
        currentStep={loadingStep}
        totalSteps={5}
        stepLabels={['Buscando dados', 'Processando', 'Preenchendo formulário', 'Carregando permissões', 'Finalizando']}
        message="Carregando dados do colaborador..."
      />
    )
  }

  const suggestedRoleId = getSuggestedRoleId()

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Tabs defaultValue="dados-pessoais" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="dados-pessoais">Dados Pessoais</TabsTrigger>
          <TabsTrigger value="dados-profissionais">Dados Profissionais</TabsTrigger>
          <TabsTrigger value="dados-bancarios">Dados Bancários</TabsTrigger>
          <TabsTrigger value="permissoes">Permissões</TabsTrigger>
        </TabsList>

        {/* Aba 1: Dados Pessoais */}
        <TabsContent value="dados-pessoais">
          <Card>
            <CardHeader>
              <CardTitle>Dados Pessoais</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="nome">Nome Completo *</Label>
                  <Input
                    id="nome"
                    name="nome"
                    required
                    value={dadosPessoais.nome}
                    onChange={handleDadosPessoaisChange}
                    className="mt-1"
                  />
                </div>

                <div>
                  <Label htmlFor="email">E-mail *</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    required
                    value={dadosPessoais.email}
                    onChange={handleDadosPessoaisChange}
                    className="mt-1"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Se alterar o e-mail, ele será atualizado no sistema de autenticação
                  </p>
                </div>

                <div>
                  <Label htmlFor="cpf">CPF *</Label>
                  <Input
                    id="cpf"
                    name="cpf"
                    required
                    value={dadosPessoais.cpf}
                    onChange={handleDadosPessoaisChange}
                    className="mt-1"
                    placeholder="000.000.000-00"
                    maxLength={14}
                  />
                </div>

                <div>
                  <Label htmlFor="data_nascimento">Data de Nascimento</Label>
                  <Input
                    id="data_nascimento"
                    name="data_nascimento"
                    type="date"
                    value={dadosPessoais.data_nascimento}
                    onChange={handleDadosPessoaisChange}
                    className="mt-1"
                  />
                </div>

                <div>
                  <Label>Permissão no sistema *</Label>
                  <div className="mt-1 grid grid-cols-2 gap-2">
                    {permissoesSistema.map((item) => {
                      const active = dadosPessoais.categoria === item.value
                      return (
                        <Button
                          key={item.value}
                          type="button"
                          variant={active ? 'default' : 'outline'}
                          className="justify-start"
                          onClick={() =>
                            handleDadosPessoaisChange({
                              target: { name: 'categoria', value: item.value },
                            } as React.ChangeEvent<HTMLInputElement>)
                          }
                        >
                          {item.label}
                        </Button>
                      )
                    })}
                  </div>
                </div>

                {dadosPessoais.categoria === 'advogado' && (
                  <div>
                    <Label htmlFor="oab">OAB *</Label>
                    <Input
                      id="oab"
                      name="oab"
                      required
                      value={dadosPessoais.oab}
                      onChange={handleDadosPessoaisChange}
                      className="mt-1"
                      placeholder="OAB/SP 123456"
                    />
                  </div>
                )}

                <div>
                  <Label htmlFor="whatsapp">WhatsApp</Label>
                  <Input
                    id="whatsapp"
                    name="whatsapp"
                    value={contato.whatsapp}
                    onChange={handleContatoChange}
                    className="mt-1"
                    placeholder="(00) 00000-0000"
                    maxLength={15}
                  />
                </div>

                <div>
                  <Label htmlFor="cep">CEP</Label>
                  <Input
                    id="cep"
                    name="cep"
                    value={contato.cep}
                    onChange={handleContatoChange}
                    className="mt-1"
                    placeholder="00000-000"
                    maxLength={9}
                  />
                </div>

                <div>
                  <Label htmlFor="rua">Rua</Label>
                  <Input
                    id="rua"
                    name="rua"
                    value={contato.rua}
                    readOnly={cepPreenchido}
                    className={`mt-1 ${cepPreenchido ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                    placeholder={cepPreenchido ? 'Preenchido automaticamente pelo CEP' : ''}
                  />
                </div>

                <div>
                  <Label htmlFor="numero">Número</Label>
                  <Input
                    id="numero"
                    name="numero"
                    value={contato.numero}
                    onChange={handleContatoChange}
                    className="mt-1"
                  />
                </div>

                <div>
                  <Label htmlFor="complemento">Complemento</Label>
                  <Input
                    id="complemento"
                    name="complemento"
                    value={contato.complemento}
                    onChange={handleContatoChange}
                    className="mt-1"
                  />
                </div>

                <div>
                  <Label htmlFor="cidade">Cidade</Label>
                  <Input
                    id="cidade"
                    name="cidade"
                    value={contato.cidade}
                    readOnly={cepPreenchido}
                    className={`mt-1 ${cepPreenchido ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                    placeholder={cepPreenchido ? 'Preenchido automaticamente pelo CEP' : ''}
                  />
                </div>

                <div>
                  <Label htmlFor="estado">Estado (UF)</Label>
                  <Input
                    id="estado"
                    name="estado"
                    value={contato.estado}
                    readOnly={cepPreenchido}
                    className={`mt-1 ${cepPreenchido ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                    maxLength={2}
                    placeholder={cepPreenchido ? 'Preenchido automaticamente pelo CEP' : 'SP'}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Aba 2: Dados Profissionais */}
        <TabsContent value="dados-profissionais">
          <Card>
            <CardHeader>
              <CardTitle>Dados Profissionais</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="cargo_id">Cargo *</Label>
                  <NativeSelect
                    id="cargo_id"
                    name="cargo_id"
                    required
                    value={profissional.cargo_id}
                    onChange={handleProfissionalChange}
                    className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Selecione um cargo</option>
                    {cargos.map((cargo) => (
                      <option key={cargo.id} value={cargo.id}>
                        {cargo.nome}
                      </option>
                    ))}
                  </NativeSelect>
                </div>

                <div>
                  <Label htmlFor="area_id">Centro de custo</Label>
                  <NativeSelect
                    id="area_id"
                    name="area_id"
                    value={profissional.area_id}
                    onChange={handleProfissionalChange}
                    className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Selecione um centro de custo</option>
                    {areas.map((area) => (
                      <option key={area.id} value={area.id}>
                        {area.nome}
                      </option>
                    ))}
                  </NativeSelect>
                </div>

                <div className="md:col-span-2">
                  <Label>Categoria</Label>
                  <div className="mt-1 grid grid-cols-2 gap-2 md:grid-cols-5">
                    {categoriasProfissionais.map((item) => {
                      const active = profissional.categoria_profissional === item.value
                      return (
                        <Button
                          key={item.value}
                          type="button"
                          variant={active ? 'default' : 'outline'}
                          className="justify-start"
                          onClick={() =>
                            setProfissional((prev) => ({
                              ...prev,
                              categoria_profissional: item.value,
                            }))
                          }
                        >
                          {item.label}
                        </Button>
                      )
                    })}
                  </div>
                </div>

                <div className="md:col-span-2">
                  <Label>Função adicional</Label>
                  <div className="mt-1 grid grid-cols-2 gap-2 md:grid-cols-3">
                    {[
                      { value: 'lideranca', label: 'Liderança' },
                      { value: 'estrategico', label: 'Estratégico' },
                    ].map((item) => {
                      const active = profissional.adicional === item.value
                      return (
                        <Button
                          key={item.value}
                          type="button"
                          variant={active ? 'default' : 'outline'}
                          className="justify-start"
                          onClick={() =>
                            setProfissional((prev) => ({
                              ...prev,
                              adicional: active ? '' : item.value,
                              percentual_adicional: active ? '' : (prev.percentual_adicional || '0'),
                            }))
                          }
                        >
                          {item.label}
                        </Button>
                      )
                    })}
                    <Button
                      type="button"
                      variant={!profissional.adicional ? 'default' : 'outline'}
                      className="justify-start"
                      onClick={() =>
                        setProfissional((prev) => ({
                          ...prev,
                          adicional: '',
                          percentual_adicional: '',
                        }))
                      }
                    >
                      Sem adicional
                    </Button>
                  </div>
                </div>

                {profissional.adicional ? (
                  <div>
                    <Label htmlFor="percentual_adicional">% adicional</Label>
                    <div className="mt-2 space-y-2">
                      <input
                        id="percentual_adicional"
                        name="percentual_adicional"
                        type="range"
                        min={0}
                        max={20}
                        step={1}
                        value={Number(profissional.percentual_adicional || 0)}
                        onChange={(e) =>
                          setProfissional((prev) => ({
                            ...prev,
                            percentual_adicional: e.target.value,
                          }))
                        }
                        className="w-full"
                      />
                      <p className="text-sm font-medium text-gray-700">
                        {Number(profissional.percentual_adicional || 0)}%
                      </p>
                    </div>
                  </div>
                ) : null}

                <div>
                  <Label htmlFor="salario">Salário</Label>
                  <MoneyInput
                    value={profissional.salario}
                    onValueChange={(value) =>
                      setProfissional((prev) => ({
                        ...prev,
                        salario: value,
                      }))
                    }
                  />
                </div>
              </div>

              <div className="mt-6">
                <Label className="mb-2 block">Benefícios</Label>
                <div className="space-y-2">
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={beneficios.includes('plano_saude')}
                      onChange={() => toggleBeneficio('plano_saude')}
                      className="rounded border-gray-300"
                    />
                    <span>Plano de Saúde</span>
                  </label>
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={beneficios.includes('auxilio_previdenciaria')}
                      onChange={() => toggleBeneficio('auxilio_previdenciaria')}
                      className="rounded border-gray-300"
                    />
                    <span>Auxílio Previdenciária</span>
                  </label>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Aba 3: Dados Bancários */}
        <TabsContent value="dados-bancarios">
          <Card>
            <CardHeader>
              <CardTitle>Dados Bancários</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="banco">Banco</Label>
                  <Input
                    id="banco"
                    name="banco"
                    value={bancario.banco}
                    onChange={handleBancarioChange}
                    className="mt-1"
                  />
                </div>

                <div>
                  <Label htmlFor="agencia">Agência</Label>
                  <Input
                    id="agencia"
                    name="agencia"
                    value={bancario.agencia}
                    onChange={handleBancarioChange}
                    className="mt-1"
                  />
                </div>

                <div>
                  <Label htmlFor="conta_com_digito">Conta com Dígito</Label>
                  <Input
                    id="conta_com_digito"
                    name="conta_com_digito"
                    value={bancario.conta_com_digito}
                    onChange={handleBancarioChange}
                    className="mt-1"
                  />
                </div>

                <div>
                  <Label htmlFor="chave_pix">Chave PIX</Label>
                  <Input
                    id="chave_pix"
                    name="chave_pix"
                    value={bancario.chave_pix}
                    onChange={handleBancarioChange}
                    className="mt-1"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Aba 4: Permissões */}
        <TabsContent value="permissoes">
          <Card>
            <CardHeader>
              <CardTitle>Permissões</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {Object.entries(permissions).map(([categoria, perms]) => (
                  <div key={categoria} className="space-y-2">
                    <h3 className="text-lg font-semibold text-gray-900 capitalize">
                      {categoria === 'dashboard' ? 'Dashboard' :
                       categoria === 'crm' ? 'CRM' :
                       categoria === 'people' ? 'Pessoas' :
                       categoria === 'contracts' ? 'Contratos' :
                       categoria === 'operations' ? 'Operações' :
                       categoria === 'finance' ? 'Financeiro' :
                       categoria === 'reports' ? 'Relatórios' :
                       categoria}
                    </h3>
                    <div className="ml-4 space-y-2">
                      {perms.map((perm) => (
                        <label
                          key={perm.id}
                          className="flex items-center space-x-2 rounded p-2 hover:bg-gray-50"
                        >
                          <input
                            type="checkbox"
                            checked={colaboradorPermissionIds.includes(perm.id)}
                            onChange={() => {
                              setColaboradorPermissionIds((prev) =>
                                prev.includes(perm.id)
                                  ? prev.filter((id) => id !== perm.id)
                                  : [...prev, perm.id]
                              )
                            }}
                            className="rounded border-gray-300"
                          />
                          <span className="text-sm text-gray-700">
                            {perm.descricao || perm.chave}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
                {Object.keys(permissions).length === 0 && (
                  <p className="text-sm text-gray-500">Nenhuma permissão disponível.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {error && (
        <div className="rounded-md bg-red-50 p-4">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      <div className="flex justify-end gap-4">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? 'Salvando...' : 'Salvar'}
        </Button>
      </div>
    </form>
  )
}
