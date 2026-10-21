import { useInfiniteQuery } from '@tanstack/react-query'
import { listMessages } from '@/features/conversations/api'
import type { Message } from '@/types/api'

export const messagesKey = (conversationId: string) => ['messages', conversationId] as const

/** Pages go back in time: pages[0] is the newest page, each page ascending. */
export function useMessages(conversationId: string) {
  return useInfiniteQuery({
    queryKey: messagesKey(conversationId),
    queryFn: ({ pageParam }) => listMessages(conversationId, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    staleTime: 30_000,
  })
}

/** Flatten pages into one ascending list. */
export function flattenMessages(pages: { items: Message[] }[] | undefined): Message[] {
  if (!pages) return []
  return [...pages].reverse().flatMap((p) => p.items)
}
