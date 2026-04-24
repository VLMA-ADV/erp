'use client'

import PrestadoresList from '@/components/prestadores/prestadores-list'

export default function FornecedoresList() {
  return (
    <PrestadoresList
      basePath="/pessoas/fornecedores"
      entityLabel="fornecedor"
      entityPluralLabel="fornecedores"
      fetchEndpoint="list-fornecedores"
      permissionPrefixes={['people.fornecedores', 'people.prestadores']}
      nameField="nome_fornecedor"
      toggleEndpoint="toggle-fornecedor-status"
    />
  )
}
