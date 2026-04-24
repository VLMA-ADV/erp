'use client'

import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CheckSquare } from 'lucide-react'

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

interface RoleModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  role?: Role | null
  permissions: Record<string, Permission[]>
  onSuccess: () => void
  onError: (error: string) => void
}

export default function RoleModal({
  open,
  onOpenChange,
  role,
  permissions,
  onSuccess,
  onError,
}: RoleModalProps) {
  const [formData, setFormData] = useState({ nome: '', descricao: '' })
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (role) {
      setFormData({
        nome: role.nome,
        descricao: role.descricao || '',
      })
      const permIds = role.role_permissions?.map((rp) => rp.permission_id) || []
      setSelectedPermissions(permIds)
    } else {
      setFormData({ nome: '', descricao: '' })
      setSelectedPermissions([])
    }
  }, [role, open])

  const togglePermission = (permissionId: string) => {
    setSelectedPermissions(prev =>
      prev.includes(permissionId)
        ? prev.filter(id => id !== permissionId)
        : [...prev, permissionId]
    )
  }

  const handleSubmit = async () => {
    if (!formData.nome.trim()) {
      onError('Nome é obrigatório')
      return
    }

    try {
      setLoading(true)
      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        onError('Sessão expirada. Por favor, faça login novamente.')
        return
      }

      const url = role
        ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/update-role`
        : `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/create-role`

      const body = role
        ? {
            id: role.id,
            nome: formData.nome,
            descricao: formData.descricao || null,
            permission_ids: selectedPermissions,
          }
        : {
            nome: formData.nome,
            descricao: formData.descricao || null,
            permission_ids: selectedPermissions,
          }

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      const data = await response.json()

      if (!response.ok) {
        onError(data.error || `Erro ao ${role ? 'atualizar' : 'criar'} role`)
        return
      }

      onOpenChange(false)
      onSuccess()
    } catch (err) {
      console.error('Error saving role:', err)
      onError(`Erro ao ${role ? 'atualizar' : 'criar'} role`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>{role ? 'Editar Role' : 'Nova Role'}</DialogTitle>
          <DialogDescription>
            {role ? 'Edite as informações da role e suas permissões' : 'Crie uma nova role e selecione suas permissões padrões'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4 overflow-y-auto max-h-[calc(90vh-200px)]">
          <div className="space-y-2">
            <Label htmlFor="nome">Nome *</Label>
            <Input
              id="nome"
              value={formData.nome}
              onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
              placeholder="Ex: Advogado Sênior"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="descricao">Descrição</Label>
            <Input
              id="descricao"
              value={formData.descricao}
              onChange={(e) => setFormData({ ...formData, descricao: e.target.value })}
              placeholder="Descrição da role (opcional)"
            />
          </div>
          <div className="space-y-2">
            <Label>Permissões Padrões</Label>
            <div className="border rounded-lg p-4 max-h-96 overflow-y-auto">
              {Object.entries(permissions).map(([categoria, perms]) => (
                <div key={categoria} className="mb-4">
                  <h4 className="font-medium text-sm text-gray-700 mb-2 capitalize">
                    {categoria}
                  </h4>
                  <div className="space-y-2">
                    {perms.map((perm) => (
                      <label
                        key={perm.id}
                        className="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 p-2 rounded"
                      >
                        <input
                          type="checkbox"
                          checked={selectedPermissions.includes(perm.id)}
                          onChange={() => togglePermission(perm.id)}
                          className="rounded border-gray-300"
                        />
                        <div className="flex-1">
                          <span className="text-sm font-medium text-gray-900">
                            {perm.chave}
                          </span>
                          {perm.descricao && (
                            <p className="text-xs text-gray-500">{perm.descricao}</p>
                          )}
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? 'Salvando...' : role ? 'Atualizar' : 'Criar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
