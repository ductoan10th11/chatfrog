import { Navigate } from 'react-router'
import { Clock, Ban } from 'lucide-react'
import { FullScreenLoader } from '@/components/FullScreenLoader'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Button } from '@/components/ui/button'
import { S } from '@/lib/strings'
import { useLogout, useMe } from './useMe'

export function PendingPage() {
  const me = useMe()
  const logout = useLogout()

  if (me.isPending) return <FullScreenLoader />
  if (!me.data) return <Navigate to="/login" replace />
  if (me.data.status === 'active') return <Navigate to="/" replace />

  const blocked = me.data.status === 'blocked'
  const Icon = blocked ? Ban : Clock

  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center px-4">
      <ThemeToggle className="absolute top-3 right-3" />
      <div className="flex w-full max-w-sm flex-col items-center gap-5 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-primary-soft text-foreground">
          <Icon className="size-6" aria-hidden />
        </span>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {blocked ? S.auth.blockedTitle : S.auth.pendingTitle}
          </h1>
          <p className="text-sm text-muted-foreground">
            {blocked ? S.auth.blockedBody : S.auth.pendingBody}
          </p>
        </div>
        <div className="flex gap-2">
          {!blocked && (
            <Button variant="outline" onClick={() => me.refetch()} disabled={me.isFetching}>
              {S.auth.recheck}
            </Button>
          )}
          <Button variant="ghost" onClick={logout}>
            {S.auth.logout}
          </Button>
        </div>
      </div>
    </main>
  )
}
