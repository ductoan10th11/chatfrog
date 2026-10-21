import { Navigate, Outlet, useLocation } from 'react-router'
import { FullScreenLoader } from '@/components/FullScreenLoader'
import { ErrorState } from '@/components/ErrorState'
import { errorMessage } from '@/lib/api'
import { useMe } from './useMe'

/** Gate for signed-in, approved users only. */
export function AuthGuard() {
  const me = useMe()
  const location = useLocation()

  if (me.isPending) return <FullScreenLoader />
  if (me.isError)
    return <ErrorState message={errorMessage(me.error)} onRetry={() => me.refetch()} />
  if (!me.data) {
    const redirect = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?redirect=${redirect}`} replace />
  }
  if (me.data.status !== 'active') return <Navigate to="/pending" replace />
  return <Outlet />
}

/** Login / pending pages: send already-approved users into the app. */
export function GuestGuard() {
  const me = useMe()
  if (me.isPending) return <FullScreenLoader />
  if (me.data?.status === 'active') return <Navigate to="/" replace />
  return <Outlet />
}
