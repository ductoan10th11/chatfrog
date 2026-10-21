import { useState } from 'react'
import { Loader2, Search } from 'lucide-react'
import { ErrorState } from '@/components/ErrorState'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useMe } from '@/features/auth/useMe'
import { errorMessage } from '@/lib/api'
import { useDebouncedValue } from '@/lib/hooks'
import { S } from '@/lib/strings'
import { cn } from '@/lib/utils'
import type { AdminUser } from '@/types/api'
import type { StatusFilter } from './api'
import { Badge } from './Badge'
import { formatDateTime, formatNumber, formatRelative, initials } from './format'
import { useAdminUsers, useUpdateAdminUser } from './queries'

const T = S.admin.users

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: '', label: T.filterAll },
  { value: 'pending', label: S.admin.status.pending },
  { value: 'active', label: S.admin.status.active },
  { value: 'blocked', label: S.admin.status.blocked },
]

const STATUS_TONE = { pending: 'neutral', active: 'ok', blocked: 'danger' } as const

export function UsersTab() {
  const me = useMe().data
  const [status, setStatus] = useState<StatusFilter>('')
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search, 300)
  const users = useAdminUsers({ status, q })
  const update = useUpdateAdminUser()
  const [toBlock, setToBlock] = useState<AdminUser | null>(null)

  const items = users.data?.pages.flatMap((p) => p.items) ?? []
  const busyId = update.isPending ? update.variables?.id : undefined

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div role="group" aria-label={T.statusLabel} className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <Button
              key={f.value}
              type="button"
              size="sm"
              variant={status === f.value ? 'default' : 'outline'}
              aria-pressed={status === f.value}
              onClick={() => setStatus(f.value)}
            >
              {f.label}
            </Button>
          ))}
        </div>
        <div className="relative sm:w-64">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            aria-label={T.searchLabel}
            placeholder={T.searchPlaceholder}
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {users.isPending ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : users.isError ? (
        <ErrorState message={T.loadError} onRetry={() => users.refetch()} />
      ) : items.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{T.empty}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((u) => (
            <UserRow
              key={u.id}
              user={u}
              isSelf={u.id === me?.id}
              busy={busyId === u.id}
              onPatch={(patch) => update.mutate({ id: u.id, ...patch })}
              onBlock={() => setToBlock(u)}
            />
          ))}
        </ul>
      )}

      {users.hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => void users.fetchNextPage()}
            disabled={users.isFetchingNextPage}
          >
            {users.isFetchingNextPage && <Loader2 className="animate-spin" aria-hidden />}
            {users.isFetchingNextPage ? T.loadingMore : T.loadMore}
          </Button>
        </div>
      )}
      {users.isFetchNextPageError && (
        <p role="alert" className="text-center text-sm text-destructive">
          {errorMessage(users.error)}
        </p>
      )}

      <AlertDialog open={!!toBlock} onOpenChange={(open) => !open && setToBlock(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{T.blockTitle(toBlock?.name ?? '')}</AlertDialogTitle>
            <AlertDialogDescription>{T.blockBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{S.app.cancel}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (toBlock) update.mutate({ id: toBlock.id, status: 'blocked' })
                setToBlock(null)
              }}
            >
              {T.block}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

type RowProps = {
  user: AdminUser
  isSelf: boolean
  busy: boolean
  onPatch: (patch: Partial<Pick<AdminUser, 'status' | 'role'>>) => void
  onBlock: () => void
}

function UserRow({ user: u, isSelf, busy, onPatch, onBlock }: RowProps) {
  const aria = (action: string) => `${action}: ${u.name}`
  return (
    <li
      data-testid="admin-user"
      aria-busy={busy}
      className={cn(
        'flex flex-col gap-3 rounded-xl border border-border bg-card p-3 lg:flex-row lg:items-center lg:gap-4',
        busy && 'opacity-70',
      )}
    >
      <div className="flex min-w-0 items-center gap-3 lg:flex-1">
        <Avatar className="size-9">
          {u.avatar_url && <AvatarImage src={u.avatar_url} alt="" referrerPolicy="no-referrer" />}
          <AvatarFallback className="bg-primary text-xs font-medium text-primary-foreground">
            {initials(u.name)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-medium">
            <span className="truncate">{u.name}</span>
            {isSelf && <span className="text-xs font-normal text-muted-foreground">({T.you})</span>}
          </p>
          <p className="truncate text-xs text-muted-foreground">{u.email}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground lg:w-72 lg:shrink-0">
        <div className="flex items-center gap-1.5">
          <Badge tone={u.role === 'admin' ? 'ok' : 'neutral'}>{S.admin.role[u.role]}</Badge>
          <Badge tone={STATUS_TONE[u.status]}>{S.admin.status[u.status]}</Badge>
        </div>
        <span title={`${T.lastLogin}: ${formatDateTime(u.last_login_at)}`}>
          {u.last_login_at ? formatRelative(u.last_login_at) : T.never}
        </span>
        <span>
          {T.messages}:{' '}
          <b className="font-medium text-foreground">{formatNumber(u.message_count)}</b>
        </span>
        <span>
          {T.images}: <b className="font-medium text-foreground">{formatNumber(u.image_count)}</b>
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5 lg:w-60 lg:shrink-0 lg:justify-end">
        {busy && <Loader2 className="size-4 animate-spin self-center" aria-hidden />}
        {u.status === 'pending' && (
          <Button
            size="sm"
            disabled={busy}
            aria-label={aria(T.approve)}
            onClick={() => onPatch({ status: 'active' })}
          >
            {T.approve}
          </Button>
        )}
        {u.status === 'blocked' && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            aria-label={aria(T.unblock)}
            onClick={() => onPatch({ status: 'active' })}
          >
            {T.unblock}
          </Button>
        )}
        {u.status === 'active' && u.role === 'user' && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            aria-label={aria(T.makeAdmin)}
            onClick={() => onPatch({ role: 'admin' })}
          >
            {T.makeAdmin}
          </Button>
        )}
        {!isSelf && u.role === 'admin' && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            aria-label={aria(T.removeAdmin)}
            onClick={() => onPatch({ role: 'user' })}
          >
            {T.removeAdmin}
          </Button>
        )}
        {!isSelf && u.status !== 'blocked' && (
          <Button
            size="sm"
            variant="destructive"
            disabled={busy}
            aria-label={aria(T.block)}
            onClick={onBlock}
          >
            {T.block}
          </Button>
        )}
      </div>
    </li>
  )
}
