import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'

const importSchema = z.object({
  rows: z.array(z.object({
    nome: z.string().trim().min(1),
    cnpj: z.string().trim().min(1),
  })).min(1),
})

function hasWritePermission(permissionKeys: string[]) {
  return permissionKeys.some((permissionKey) =>
    permissionKey === 'crm.clientes.write' ||
    permissionKey === 'crm.clientes.*' ||
    permissionKey === 'crm.*' ||
    permissionKey === '*',
  )
}

export async function POST(req: NextRequest) {
  const supabaseServer = await createServerClient()
  const {
    data: { session },
  } = await supabaseServer.auth.getSession()

  if (!session) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  const payload = await req.json().catch(() => null)
  const parsed = importSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Payload inválido', details: parsed.error.flatten() }, { status: 400 })
  }

  const { data: permissionsData, error: permissionsError } = await supabaseServer.rpc('get_user_permissions', {
    p_user_id: session.user.id,
  })

  if (permissionsError) {
    return NextResponse.json({ error: permissionsError.message }, { status: 500 })
  }

  const permissionKeys = Array.isArray(permissionsData)
    ? permissionsData
        .map((entry) => (typeof entry?.permission_key === 'string' ? entry.permission_key : ''))
        .filter(Boolean)
    : []

  if (!hasWritePermission(permissionKeys)) {
    return NextResponse.json({ error: 'Você não tem permissão para importar clientes' }, { status: 403 })
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceRoleKey || !supabaseUrl) {
    return NextResponse.json({ error: 'Supabase não configurado no servidor' }, { status: 500 })
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data, error } = await adminClient.rpc('import_clientes_csv_lote', {
    p_user_id: session.user.id,
    p_items: parsed.data.rows,
  })

  if (error) {
    return NextResponse.json({ error: error.message, details: error.message }, { status: 500 })
  }

  return NextResponse.json({ data })
}
