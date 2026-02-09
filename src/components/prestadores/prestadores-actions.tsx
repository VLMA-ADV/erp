'use client'

import Link from 'next/link'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/tooltip'
import { Edit, Power } from 'lucide-react'
import type { PrestadorListItem } from './prestadores-list'

export default function PrestadoresActions({
  prestador,
  onRefresh,
}: {
  prestador: PrestadorListItem
  onRefresh: () => void
}) {
  const [loading, setLoading] = useState(false)

  const handleToggle = async () => {
    if (
      !confirm(
        `Tem certeza que deseja ${prestador.ativo ? 'desativar' : 'ativar'} este prestador?`
      )
    ) {
      return
    }

    setLoading(true)
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/toggle-prestador-status`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ id: prestador.id }),
        }
      )

      const data = await response.json()
      if (!response.ok) {
        alert(data.error || 'Erro ao alterar status do prestador')
        return
      }

      onRefresh()
    } catch (e) {
      console.error(e)
      alert('Erro ao alterar status do prestador')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <Tooltip content="Editar">
        <Link href={`/pessoas/prestadores/${prestador.id}/editar`}>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <Edit className="h-4 w-4" />
          </Button>
        </Link>
      </Tooltip>
      <Tooltip content={prestador.ativo ? 'Desativar' : 'Ativar'}>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={handleToggle}
          disabled={loading}
        >
          <Power
            className={`h-4 w-4 ${prestador.ativo ? 'text-red-600' : 'text-green-600'}`}
          />
        </Button>
      </Tooltip>
    </div>
  )
}

