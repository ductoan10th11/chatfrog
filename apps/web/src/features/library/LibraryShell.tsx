import { Loader2 } from 'lucide-react'
import type { UseInfiniteQueryResult } from '@tanstack/react-query'
import { ErrorState } from '@/components/ErrorState'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { S } from '@/lib/strings'
import type { FileRef, Page } from '@/types/api'

type Props = {
  title: string
  empty: string
  query: UseInfiniteQueryResult<{ pages: Page<FileRef>[] }, Error>
  skeleton: React.ReactNode
  children: (files: FileRef[]) => React.ReactNode
}

/** Page chrome shared by the image and document libraries: header, states, "load more". */
export function LibraryShell({ title, empty, query, skeleton, children }: Props) {
  const files = query.data?.pages.flatMap((p) => p.items) ?? []
  return (
    <div className="flex h-full flex-col">
      <header className="hidden h-14 shrink-0 items-center border-b px-6 md:flex">
        <h1 className="text-base font-semibold">{title}</h1>
      </header>
      <div className="min-h-0 flex-1 scrollbar-thin overflow-y-auto p-4 md:p-6">
        <div className="mx-auto w-full max-w-5xl space-y-4">
          {query.isPending ? (
            <div aria-busy="true">{skeleton}</div>
          ) : query.isError ? (
            <ErrorState message={S.library.loadError} onRetry={() => void query.refetch()} />
          ) : files.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">{empty}</p>
          ) : (
            children(files)
          )}
          {query.hasNextPage && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                disabled={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
              >
                {query.isFetchingNextPage && <Loader2 className="animate-spin" aria-hidden />}
                {query.isFetchingNextPage ? S.library.loadingMore : S.library.loadMore}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function SkeletonList({ className, count = 6 }: { className: string; count?: number }) {
  return (
    <div className={className}>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-full min-h-14 w-full" />
      ))}
    </div>
  )
}
