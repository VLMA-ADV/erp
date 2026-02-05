'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'
import { LoadingProgressWithSteps } from '@/components/ui/loading-progress'

interface ColaboradorViewProps {
  colaboradorId: string
}

export default function ColaboradorView({ colaboradorId }: ColaboradorViewProps) {
  const router = useRouter()
  const { hasPermission } = usePermissionsContext()
  const [loading, setLoading] = useState(true)
  const [loadingStep, setLoadingStep] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [colaborador, setColaborador] = useState<any>(null)
  const [userRoles, setUserRoles] = useState<any[]>([])
  const [permissions, setPermissions] = useState<Record<string, Array<{ id: string; chave: string; descricao: string }>>>({})
  const [colaboradorPermissionIds, setColaboradorPermissionIds] = useState<string[]>([])

  useEffect(() => {
    async function fetchColaborador() {
      try {
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

        // Usar get-colaborador que já retorna tudo (otimizado)
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-colaborador?id=${colaboradorId}`,
          {
            method: 'GET',
            headers,
          }
        )

        const result = await response.json()

        if (!response.ok) {
          setError(result.error || 'Erro ao carregar dados do colaborador')
          setLoading(false)
          return
        }

        setColaborador(result.data)
        setLoadingStep(2) // Dados do colaborador carregados

        // Preencher roles do colaborador (já vem do get_colaborador_complete)
        if (result.data.user_roles && result.data.user_roles.length > 0) {
          setUserRoles(result.data.user_roles)
        }

        // Buscar todas as permissões disponíveis (usar hook compartilhado seria melhor, mas por enquanto manter)
        setLoadingStep(3) // Buscando permissões
        const permissionsResponse = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-permissions`,
          { method: 'GET', headers }
        )
        if (permissionsResponse.ok) {
          const permissionsData = await permissionsResponse.json()
          setPermissions(permissionsData.data || {})
        }

        // Preencher permissões do colaborador (já vem do get_colaborador_complete)
        if (result.data.permissions && Array.isArray(result.data.permissions) && result.data.permissions.length > 0) {
          const permissionIds = result.data.permissions.map((p: any) => p.permission_id || p.id)
          setColaboradorPermissionIds(permissionIds)
        } else {
          // Fallback: buscar via API se não vier na resposta
          const colaboradorPermissionsResponse = await fetch(
            `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-colaborador-permissions?id=${colaboradorId}`,
            { method: 'GET', headers }
          )
          if (colaboradorPermissionsResponse.ok) {
            const colaboradorPermissionsData = await colaboradorPermissionsResponse.json()
            if (colaboradorPermissionsData.data && Array.isArray(colaboradorPermissionsData.data)) {
              setColaboradorPermissionIds(colaboradorPermissionsData.data.map((p: any) => p.permission_id || p))
            }
          }
        }

        setLoadingStep(4) // Completo
      } catch (err) {
        setError('Erro ao carregar dados do colaborador')
      } finally {
        setLoading(false)
      }
    }

    fetchColaborador()
  }, [colaboradorId, router])

  if (loading) {
    return (
      <LoadingProgressWithSteps
        isLoading={true}
        currentStep={loadingStep}
        totalSteps={4}
        stepLabels={['Carregando dados', 'Processando informações', 'Buscando permissões', 'Finalizando']}
        message="Carregando dados do colaborador..."
      />
    )
  }

  if (error) {
    return (
      <div className="rounded-md bg-red-50 p-4">
        <p className="text-sm text-red-800">{error}</p>
      </div>
    )
  }

  if (!colaborador) {
    return <div>Colaborador não encontrado</div>
  }

  const canEdit = hasPermission('people.colaboradores.write')

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{colaborador.nome}</h1>
        {canEdit && (
          <Button
            variant="outline"
            onClick={() => router.push(`/pessoas/colaboradores/${colaboradorId}/editar`)}
          >
            Editar
          </Button>
        )}
      </div>

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
                  <p className="text-sm font-medium text-gray-500">Nome Completo</p>
                  <p className="text-sm">{colaborador.nome}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500">E-mail</p>
                  <p className="text-sm">{colaborador.email}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500">CPF</p>
                  <p className="text-sm">{colaborador.cpf}</p>
                </div>
                {colaborador.data_nascimento && (
                  <div>
                    <p className="text-sm font-medium text-gray-500">Data de Nascimento</p>
                    <p className="text-sm">
                      {new Date(colaborador.data_nascimento).toLocaleDateString('pt-BR')}
                    </p>
                  </div>
                )}
                <div>
                  <p className="text-sm font-medium text-gray-500">Categoria</p>
                  <p className="text-sm capitalize">{colaborador.categoria}</p>
                </div>
                {colaborador.oab && (
                  <div>
                    <p className="text-sm font-medium text-gray-500">OAB</p>
                    <p className="text-sm">{colaborador.oab}</p>
                  </div>
                )}
                {colaborador.whatsapp && (
                  <div>
                    <p className="text-sm font-medium text-gray-500">WhatsApp</p>
                    <p className="text-sm">{colaborador.whatsapp}</p>
                  </div>
                )}
                {(colaborador.cep || colaborador.rua || colaborador.numero || colaborador.cidade) && (
                  <>
                    {colaborador.cep && (
                      <div>
                        <p className="text-sm font-medium text-gray-500">CEP</p>
                        <p className="text-sm">{colaborador.cep}</p>
                      </div>
                    )}
                    {colaborador.rua && (
                      <div>
                        <p className="text-sm font-medium text-gray-500">Rua</p>
                        <p className="text-sm">{colaborador.rua}</p>
                      </div>
                    )}
                    {colaborador.numero && (
                      <div>
                        <p className="text-sm font-medium text-gray-500">Número</p>
                        <p className="text-sm">{colaborador.numero}</p>
                      </div>
                    )}
                    {colaborador.complemento && (
                      <div>
                        <p className="text-sm font-medium text-gray-500">Complemento</p>
                        <p className="text-sm">{colaborador.complemento}</p>
                      </div>
                    )}
                    {colaborador.cidade && (
                      <div>
                        <p className="text-sm font-medium text-gray-500">Cidade</p>
                        <p className="text-sm">{colaborador.cidade}</p>
                      </div>
                    )}
                    {colaborador.estado && (
                      <div>
                        <p className="text-sm font-medium text-gray-500">Estado</p>
                        <p className="text-sm">{colaborador.estado}</p>
                      </div>
                    )}
                  </>
                )}
                <div>
                  <p className="text-sm font-medium text-gray-500">Status</p>
                  <span
                    className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                      colaborador.ativo
                        ? 'bg-green-100 text-green-800'
                        : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {colaborador.ativo ? 'Ativo' : 'Inativo'}
                  </span>
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
                {colaborador.cargos && (
                  <div>
                    <p className="text-sm font-medium text-gray-500">Cargo</p>
                    <p className="text-sm">{colaborador.cargos.nome}</p>
                  </div>
                )}
                {colaborador.areas && (
                  <div>
                    <p className="text-sm font-medium text-gray-500">Área</p>
                    <p className="text-sm">{colaborador.areas.nome}</p>
                  </div>
                )}
                {colaborador.adicional && (
                  <div>
                    <p className="text-sm font-medium text-gray-500">Adicional</p>
                    <p className="text-sm capitalize">{colaborador.adicional}</p>
                  </div>
                )}
                {colaborador.percentual_adicional && (
                  <div>
                    <p className="text-sm font-medium text-gray-500">Percentual Adicional</p>
                    <p className="text-sm">{colaborador.percentual_adicional}%</p>
                  </div>
                )}
                {colaborador.salario && (
                  <div>
                    <p className="text-sm font-medium text-gray-500">Salário</p>
                    <p className="text-sm">
                      {new Intl.NumberFormat('pt-BR', {
                        style: 'currency',
                        currency: 'BRL',
                      }).format(parseFloat(colaborador.salario))}
                    </p>
                  </div>
                )}
              </div>

              {colaborador.colaboradores_beneficios && colaborador.colaboradores_beneficios.length > 0 && (
                <div className="mt-6">
                  <p className="text-sm font-medium text-gray-500 mb-2">Benefícios</p>
                  <ul className="list-disc list-inside space-y-1">
                    {colaborador.colaboradores_beneficios.map((beneficio: any, index: number) => (
                      <li key={index} className="text-sm capitalize">
                        {typeof beneficio === 'string' 
                          ? beneficio.replace('_', ' ')
                          : beneficio.beneficio?.replace('_', ' ') || beneficio
                        }
                      </li>
                    ))}
                  </ul>
                </div>
              )}
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
              {(colaborador.banco || colaborador.agencia || colaborador.conta_com_digito || colaborador.chave_pix) ? (
                <div className="grid grid-cols-2 gap-4">
                  {colaborador.banco && (
                    <div>
                      <p className="text-sm font-medium text-gray-500">Banco</p>
                      <p className="text-sm">{colaborador.banco}</p>
                    </div>
                  )}
                  {colaborador.agencia && (
                    <div>
                      <p className="text-sm font-medium text-gray-500">Agência</p>
                      <p className="text-sm">{colaborador.agencia}</p>
                    </div>
                  )}
                  {colaborador.conta_com_digito && (
                    <div>
                      <p className="text-sm font-medium text-gray-500">Conta com Dígito</p>
                      <p className="text-sm">{colaborador.conta_com_digito}</p>
                    </div>
                  )}
                  {colaborador.chave_pix && (
                    <div>
                      <p className="text-sm font-medium text-gray-500">Chave PIX</p>
                      <p className="text-sm">{colaborador.chave_pix}</p>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-500">Nenhum dado bancário cadastrado</p>
              )}
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
              {userRoles.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">Roles Atribuídas:</h3>
                  <div className="flex flex-wrap gap-2">
                    {userRoles.map((role: any) => (
                      <span
                        key={role.role_id || role.id}
                        className="inline-flex px-3 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800"
                      >
                        {role.role_nome || role.nome}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {Object.keys(permissions).length > 0 ? (
                <div className="space-y-6">
                  {Object.entries(permissions).map(([categoria, perms]) => {
                    const permsDoColaborador = perms.filter(perm => 
                      colaboradorPermissionIds.includes(perm.id)
                    )
                    
                    if (permsDoColaborador.length === 0) {
                      return null
                    }

                    return (
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
                          {permsDoColaborador.map((perm) => (
                            <div
                              key={perm.id}
                              className="flex items-center space-x-2 rounded p-2 bg-green-50 border border-green-200"
                            >
                              <svg
                                className="h-4 w-4 text-green-600"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M5 13l4 4L19 7"
                                />
                              </svg>
                              <span className="text-sm text-gray-700">
                                {perm.descricao || perm.chave}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                  {colaboradorPermissionIds.length === 0 && (
                    <p className="text-sm text-gray-500">
                      Nenhuma permissão atribuída ao colaborador.
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-500">
                  Nenhuma permissão disponível ou não foi possível carregar as permissões.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
