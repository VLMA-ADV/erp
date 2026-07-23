import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  // Verificar autenticação e permissão admin do solicitante
  const supabaseServer = await createServerClient()
  // getUser() valida o JWT com o Auth (getSession só lê o cookie). Gate de servidor.
  const { data: { user: authUser }, error: userErr } = await supabaseServer.auth.getUser()
  if (userErr || !authUser) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  // Redefinir a senha de terceiros é restrito (sócios, Filipe incluso). Antes,
  // qualquer usuário logado conseguia resetar a senha de qualquer conta.
  const { data: podeResetar, error: capErr } = await supabaseServer.rpc(
    'tem_capacidade_sensivel',
    { p_user_id: authUser.id, p_capacidade: 'users.reset_password' },
  )
  if (capErr || podeResetar !== true) {
    return NextResponse.json(
      { error: 'Sem permissão para redefinir senhas' },
      { status: 403 },
    )
  }

  // Verificar se tem service role key configurada
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceRoleKey || !supabaseUrl) {
    return NextResponse.json(
      { error: 'SUPABASE_SERVICE_ROLE_KEY não configurada no servidor' },
      { status: 500 },
    )
  }

  const body = await req.json().catch(() => ({}))
  const { email, newPassword } = body

  if (!email) {
    return NextResponse.json({ error: 'E-mail é obrigatório' }, { status: 400 })
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Modo 1: Gerar link de reset (envia e-mail se SMTP configurado)
  if (!newPassword) {
    const { data, error } = await adminClient.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: {
        redirectTo: `${req.headers.get('origin') || supabaseUrl}/redefinir-senha`,
      },
    })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({
      message: 'Link de recuperação gerado',
      link: data.properties?.action_link,
    })
  }

  // Modo 2: Redefinir senha diretamente (sem e-mail)
  if (newPassword.length < 8) {
    return NextResponse.json(
      { error: 'A nova senha deve ter pelo menos 8 caracteres' },
      { status: 400 },
    )
  }

  // Buscar usuário pelo e-mail
  const { data: listData, error: listError } = await adminClient.auth.admin.listUsers()
  if (listError) {
    return NextResponse.json({ error: listError.message }, { status: 400 })
  }

  const user = listData.users.find((u) => u.email === email)
  if (!user) {
    return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })
  }

  const { error: updateError } = await adminClient.auth.admin.updateUserById(user.id, {
    password: newPassword,
  })

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 })
  }

  return NextResponse.json({ message: 'Senha redefinida com sucesso' })
}
