'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import RolesTable from './roles-table'
import RolesSearch from './roles-search'
import RoleModal from './role-modal'
import RoleViewModal from './role-view-modal'
import { Button } from '@/components/ui/button'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'
import { Plus } from 'lucide-react'

interface Role {
  id: string
  nome: string
  descricao: string | null
  ativo: boolean
  role_permissions?: Array<{
    permission_id: string
    permissions: {
      id: string
      chave: string
      descricao: string
      categoria: string
    }
  }>
}

interface Permission {
  id: string
  chave: string
  descricao: string
  categoria: string
}

export default function RolesList() {
  const { hasPermission } = usePermissionsContext()
  const [roles, setRoles] = useState<Role[]>([])
  const [permissions, setPermissions] = useState<Record<string, Permission[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [viewModalOpen, setViewModalOpen] = useState(false)
  const [editingRole, setEditingRole] = useState<Role | null>(null)
  const [viewingRole, setViewingRole] = useState<Role | null>(null)

  const canWrite = hasPermission('config.roles.write')
  const canRead = hasPermission('config.roles.read')

  useEffect(() => {
    if (canRead) {
      fetchRoles()
      fetchPermissions()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead])

  const fetchRoles = async () => {
    try {
      setLoading(true)
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) return

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-roles`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
        }
      )

      if (response.ok) {
        const data = await response.json()
        let rolesList = data.data || []
        
        // Filtrar por busca
        if (search) {
          const searchLower = search.toLowerCase()
          rolesList = rolesList.filter((role: Role) =>
            role.nome.toLowerCase().includes(searchLower) ||
            (role.descricao && role.descricao.toLowerCase().includes(searchLower))
          )
        }
        
        setRoles(rolesList)
      } else {
        const errorData = await response.json()
        setError(errorData.error || 'Erro ao carregar roles')
      }
    } catch (err) {
      console.error('Error fetching roles:', err)
      setError('Erro ao carregar roles')
    } finally {
      setLoading(false)
    }
  }

  const fetchPermissions = async () => {
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) return

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-permissions`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
        }
      )

      if (response.ok) {
        const data = await response.json()
        setPermissions(data.data || {})
      }
    } catch (err) {
      console.error('Error fetching permissions:', err)
    }
  }

  const fetchRoleDetails = async (roleId: string) => {
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) return

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-role?id=${roleId}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
        }
      )

      if (response.ok) {
        const data = await response.json()
        return data.data
      }
    } catch (err) {
      console.error('Error fetching role details:', err)
    }
    return null
  }

  useEffect(() => {
    if (canRead) {
      fetchRoles()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const handleCreate = () => {
    setEditingRole(null)
    setModalOpen(true)
  }

  const handleEdit = async (role: Role) => {
    const roleDetails = await fetchRoleDetails(role.id)
    if (roleDetails) {
      setEditingRole(roleDetails)
    } else {
      setEditingRole(role)
    }
    setModalOpen(true)
  }

  const handleView = async (role: Role) => {
    const roleDetails = await fetchRoleDetails(role.id)
    if (roleDetails) {
      setViewingRole(roleDetails)
    } else {
      setViewingRole(role)
    }
    setViewModalOpen(true)
  }

  const handleModalSuccess = () => {
    setModalOpen(false)
    setEditingRole(null)
    fetchRoles()
  }

  const handleModalError = (errorMessage: string) => {
    setError(errorMessage)
  }

  if (!canRead) {
    return (
      <div className="rounded-md bg-red-50 p-4">
        <p className="text-sm text-red-800">Você não tem permissão para visualizar roles</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md bg-red-50 p-4">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      <div className="flex items-center justify-between">
        <RolesSearch onSearch={setSearch} />
        {canWrite && (
          <Button onClick={handleCreate}>
            <Plus className="h-4 w-4 mr-2" />
            Nova Role
          </Button>
        )}
      </div>

      <RolesTable
        roles={roles}
        loading={loading}
        onEdit={handleEdit}
        onView={handleView}
        onRefresh={fetchRoles}
      />

      {canWrite && (
        <RoleModal
          open={modalOpen}
          onOpenChange={setModalOpen}
          role={editingRole}
          permissions={permissions}
          onSuccess={handleModalSuccess}
          onError={handleModalError}
        />
      )}

      <RoleViewModal
        open={viewModalOpen}
        onOpenChange={setViewModalOpen}
        role={viewingRole}
      />
    </div>
  )
}
