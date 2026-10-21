import { useEffect, useMemo, useRef } from 'react'
import { useMatch, useNavigate } from 'react-router'
import { Loader2 } from 'lucide-react'
import { ErrorState } from '@/components/ErrorState'
import { Skeleton } from '@/components/ui/skeleton'
import { errorMessage } from '@/lib/api'
import { S } from '@/lib/strings'
import { ConversationItem } from './ConversationItem'
import { groupConversations } from './group'
import { useConversationList } from './queries'

type Props = { q: string; onNavigate?: () => void }

export function ConversationList({ q, onNavigate }: Props) {
  const query = useConversationList(q)
  const match = useMatch('/c/:id')
  const activeId = match?.params.id
  const navigate = useNavigate()
  const sentinel = useRef<HTMLDivElement>(null)

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query
  useEffect(() => {
    const el = sentinel.current
    if (!el || !hasNextPage) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) void fetchNextPage()
      },
      { rootMargin: '200px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const groups = useMemo(
    () => groupConversations(query.data?.pages.flatMap((p) => p.items) ?? []),
    [query.data],
  )

  if (query.isPending) {
    return (
      <div className="space-y-2 p-2" aria-busy="true" aria-label={S.app.loading}>
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    )
  }
  if (query.isError) {
    return <ErrorState message={errorMessage(query.error)} onRetry={() => query.refetch()} />
  }
  if (groups.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-sm text-muted-foreground">
        {q ? S.nav.noResults : S.nav.empty}
      </p>
    )
  }

  return (
    <nav aria-label={S.nav.sidebar} className="space-y-4 px-2 pb-2">
      {groups.map((g) => (
        <section key={g.key} aria-label={g.label}>
          <h2 className="px-3 pb-1 text-xs font-medium text-muted-foreground">{g.label}</h2>
          <ul className="space-y-0.5">
            {g.items.map((c) => (
              <li key={c.id}>
                <ConversationItem
                  conversation={c}
                  active={c.id === activeId}
                  onNavigate={onNavigate}
                  onDeleted={(id) => {
                    if (id === activeId) navigate('/', { replace: true })
                  }}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {hasNextPage && (
        <div
          ref={sentinel}
          className="flex justify-center py-2 text-muted-foreground"
          role="status"
        >
          <Loader2 className="size-4 animate-spin" aria-label={S.nav.loadingMore} />
        </div>
      )}
    </nav>
  )
}
