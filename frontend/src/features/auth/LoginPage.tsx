import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { Logo } from '@/components/Logo'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Button } from '@/components/ui/button'
import { errorMessage } from '@/lib/api'
import { S } from '@/lib/strings'
import { safeRedirect, setMockAuth } from './api'
import { ME_KEY } from './useMe'

export function LoginPage() {
  const [params] = useSearchParams()
  const redirect = safeRedirect(params.get('redirect'))
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)

  async function onLogin(e: React.MouseEvent) {
    // With the mock API there is no Google round trip: just flip the simulated session.
    if (import.meta.env.VITE_MOCK !== '1') return
    e.preventDefault()
    setBusy(true)
    try {
      await setMockAuth('active')
      await qc.invalidateQueries({ queryKey: ME_KEY })
      navigate(redirect, { replace: true })
    } catch (err) {
      toast.error(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center px-4">
      <ThemeToggle className="absolute top-3 right-3" />
      <div className="flex w-full max-w-sm flex-col items-center gap-6 text-center">
        <Logo className="size-14" />
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">{S.auth.loginTitle}</h1>
          <p className="text-sm text-muted-foreground">{S.auth.loginSubtitle}</p>
        </div>
        <Button asChild size="lg" className="h-11 w-full" disabled={busy}>
          <a
            href={`/api/auth/google/login?redirect=${encodeURIComponent(redirect)}`}
            onClick={onLogin}
          >
            <GoogleMark />
            {S.auth.loginWithGoogle}
          </a>
        </Button>
      </div>
    </main>
  )
}

function GoogleMark() {
  // Monochrome "G": keeps the palette to white/gray/green.
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden fill="currentColor">
      <path d="M12.2 10.2v3.9h5.5c-.2 1.3-1.6 3.8-5.5 3.8a6 6 0 0 1 0-12c1.9 0 3.1.8 3.8 1.5l2.6-2.5A9.6 9.6 0 0 0 12.2 2.4a9.8 9.8 0 0 0 0 19.6c5.6 0 9.4-4 9.4-9.5 0-.6-.1-1.1-.2-1.6h-9.2z" />
    </svg>
  )
}
