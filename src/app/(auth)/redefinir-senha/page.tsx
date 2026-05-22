import ResetPasswordForm from '@/components/auth/reset-password-form'

export const dynamic = 'force-dynamic'

export default function RedefinirSenhaPage() {
  return (
    <div className="gradient-mesh flex min-h-screen items-center justify-center bg-canvas-soft px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <span className="text-eyebrow">VLMA · ERP</span>
          <h2 className="mt-3 display-md text-ink">Redefinir senha</h2>
          <p className="mt-2 text-sm text-ink-mute">Digite sua nova senha.</p>
        </div>
        <ResetPasswordForm />
      </div>
    </div>
  )
}
