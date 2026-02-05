'use client'

import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { useToast } from '@/components/ui/use-toast'
import LoginForm from './login-form'

export default function LoginFormWithToast() {
  const searchParams = useSearchParams()
  const { showToast } = useToast()

  useEffect(() => {
    const passwordReset = searchParams.get('passwordReset')
    if (passwordReset === 'success') {
      showToast('Senha alterada com sucesso!', 'success')
      // Remover o parâmetro da URL sem recarregar a página
      const url = new URL(window.location.href)
      url.searchParams.delete('passwordReset')
      window.history.replaceState({}, '', url.toString())
    }
  }, [searchParams, showToast])

  return <LoginForm />
}
