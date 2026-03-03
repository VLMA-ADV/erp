'use client'

import PrestadorForm from '@/components/prestadores/prestador-form'

export default function FornecedorForm({ fornecedorId }: { fornecedorId?: string }) {
  return (
    <PrestadorForm
      prestadorId={fornecedorId}
      redirectBasePath="/pessoas/fornecedores"
      permissionPrefixes={['people.fornecedores', 'people.prestadores']}
      getEndpoint="get-fornecedor"
      createEndpoint="create-fornecedor"
      updateEndpoint="update-fornecedor"
      entityResponseKey="fornecedor"
      entityNameField="nome_fornecedor"
      entityLabel="fornecedor"
      entityPluralLabel="fornecedores"
    />
  )
}
