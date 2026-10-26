import { useInfiniteQuery } from '@tanstack/react-query'
import { listFiles, type LibraryType } from './api'

export function useFileList(type: LibraryType) {
  return useInfiniteQuery({
    queryKey: ['files', type],
    queryFn: ({ pageParam }) => listFiles({ type, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    staleTime: 30_000,
  })
}
