'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname } from 'next/navigation'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { createClient } from '@/lib/supabase/client'

const labelMap: Record<string, string> = {
  home: 'Dashboard',
  pessoas: 'Pessoas',
  colaboradores: 'Colaboradores',
  parceiros: 'Parceiros',
  prestadores: 'Prestadores',
  clientes: 'Clientes',
  configuracao: 'Configuração',
  cargos: 'Cargos',
  areas: 'Centro de custo',
  'segmentos-economicos': 'Segmentos econômicos',
  'grupos-economicos': 'Grupos econômicos',
  roles: 'Roles',
  permissoes: 'Permissões',
  servicos: 'Serviços',
  produtos: 'Produtos',
  contratos: 'Contratos',
  novo: 'Novo',
  editar: 'Editar',
}

function toLabel(part: string) {
  return labelMap[part] || part
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

export default function PageBreadcrumb() {
  const pathname = usePathname()
  const parts = useMemo(() => pathname.split('/').filter(Boolean), [pathname])
  const [resolvedLabels, setResolvedLabels] = useState<Record<string, string>>({})

  useEffect(() => {
    let active = true

    const resolveContractCaseNumbers = async () => {
      const contratosIdx = parts.indexOf('contratos')
      if (contratosIdx === -1) {
        if (active) setResolvedLabels({})
        return
      }

      const contratoId = parts[contratosIdx + 1]
      if (!contratoId || !isUuid(contratoId)) {
        if (active) setResolvedLabels({})
        return
      }

      try {
        const supabase = createClient()
        const {
          data: { session },
        } = await supabase.auth.getSession()
        if (!session) return

        const resp = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-contrato?id=${contratoId}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
        })
        const payload = await resp.json()
        if (!resp.ok) return

        const nextLabels: Record<string, string> = {}
        const contratoNumero = payload?.data?.contrato?.numero
        if (contratoNumero !== null && contratoNumero !== undefined) {
          nextLabels[contratoId] = String(contratoNumero)
        }

        const casos = payload?.data?.casos || []
        for (const caso of casos) {
          if (caso?.id && caso?.numero !== null && caso?.numero !== undefined) {
            nextLabels[String(caso.id)] = String(caso.numero)
          }
        }

        if (active) setResolvedLabels(nextLabels)
      } catch {
        if (active) setResolvedLabels({})
      }
    }

    void resolveContractCaseNumbers()

    return () => {
      active = false
    }
  }, [parts])

  if (!parts.length) return null

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {parts.map((part, idx) => {
          const href = `/${parts.slice(0, idx + 1).join('/')}`
          const last = idx === parts.length - 1
          const label = resolvedLabels[part] || toLabel(part)
          return (
            <div key={href} className="flex items-center">
              <BreadcrumbItem>
                {last ? (
                  <BreadcrumbPage>{label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink href={href}>{label}</BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {!last && <BreadcrumbSeparator />}
            </div>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
