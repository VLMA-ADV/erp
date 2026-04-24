'use client'

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
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

interface RoleViewModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  role: Role | null
}

export default function RoleViewModal({
  open,
  onOpenChange,
  role,
}: RoleViewModalProps) {
  if (!role) return null

  const permissionsByCategory = role.role_permissions?.reduce((acc: Record<string, any[]>, rp: any) => {
    const cat = rp.permissions?.categoria || 'outros'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(rp.permissions)
    return acc
  }, {}) || {}

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Visualizar Role: {role.nome}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4 overflow-y-auto max-h-[calc(90vh-200px)]">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Nome
            </label>
            <p className="text-sm text-gray-900">{role.nome}</p>
          </div>
          {role.descricao && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Descrição
              </label>
              <p className="text-sm text-gray-900">{role.descricao}</p>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Permissões
            </label>
            {role.role_permissions && role.role_permissions.length > 0 ? (
              <div className="border rounded-lg p-4 max-h-96 overflow-y-auto">
                {Object.entries(permissionsByCategory).map(([categoria, perms]) => (
                  <div key={categoria} className="mb-4">
                    <h4 className="font-medium text-sm text-gray-700 mb-2 capitalize">
                      {categoria}
                    </h4>
                    <div className="space-y-1">
                      {perms.map((perm: any) => (
                        <div key={perm.id} className="flex items-center space-x-2 p-2">
                          <CheckSquare className="h-4 w-4 text-green-600" />
                          <div>
                            <span className="text-sm font-medium text-gray-900">
                              {perm.chave}
                            </span>
                            {perm.descricao && (
                              <p className="text-xs text-gray-500">{perm.descricao}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">Nenhuma permissão associada</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
