import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query'
import { toast } from 'sonner'
import { errorMessage } from '@/lib/api'
import { S } from '@/lib/strings'
import type { Conversation, Page } from '@/types/api'
import { deleteConversation, getConversation, listConversations, updateConversation } from './api'

export const conversationsKey = (q = '') => ['conversations', q] as const
export const conversationKey = (id: string) => ['conversation', id] as const

export function useConversationList(q: string) {
  return useInfiniteQuery({
    queryKey: conversationsKey(q),
    queryFn: ({ pageParam }) => listConversations({ q, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    staleTime: 30_000,
  })
}

export function useConversation(id: string | undefined) {
  return useQuery({
    queryKey: conversationKey(id ?? ''),
    queryFn: () => getConversation(id!),
    enabled: !!id,
  })
}

/** Patch a conversation inside every cached list + the detail entry. */
export function patchConversationCache(qc: QueryClient, id: string, patch: Partial<Conversation>) {
  qc.setQueriesData<InfiniteData<Page<Conversation>>>({ queryKey: ['conversations'] }, (data) =>
    data
      ? {
          ...data,
          pages: data.pages.map((p) => ({
            ...p,
            items: p.items.map((c) => (c.id === id ? { ...c, ...patch } : c)),
          })),
        }
      : data,
  )
  qc.setQueryData<Conversation>(conversationKey(id), (c) => (c ? { ...c, ...patch } : c))
}

export function useUpdateConversation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: string; title?: string; pinned?: boolean }) =>
      updateConversation(id, patch),
    onSuccess: (c) => {
      patchConversationCache(qc, c.id, c)
      // Pinning changes the order, so refetch the lists.
      void qc.invalidateQueries({ queryKey: ['conversations'] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
}

export function useDeleteConversation(onDeleted?: (id: string) => void) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteConversation(id),
    onSuccess: (_, id) => {
      qc.removeQueries({ queryKey: conversationKey(id) })
      qc.removeQueries({ queryKey: ['messages', id] })
      void qc.invalidateQueries({ queryKey: ['conversations'] })
      toast.success(S.conversation.deleted)
      onDeleted?.(id)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
}
