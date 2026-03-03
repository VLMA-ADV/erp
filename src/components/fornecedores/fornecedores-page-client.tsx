'use client'

import PrestadoresPageClient from '@/components/prestadores/prestadores-page-client'

export default function FornecedoresPageClient() {
  return (
    <PrestadoresPageClient
      title="Fornecedores"
      description="Gerencie os fornecedores"
      createLabel="Novo Fornecedor"
      basePath="/pessoas/fornecedores"
      permissionPrefixes={['people.fornecedores', 'people.prestadores']}
    />
  )
}
