import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query'
import { toast } from 'sonner'
import { errorMessage } from '@/lib/api'
import { S } from '@/lib/strings'
import type { AdminUser, Page } from '@/types/api'
import { fetchHealth, fetchStats, listUsers, patchUser, type UserListParams } from './api'

export const adminKeys = {
  users: (p: UserListParams) => ['admin', 'users', p] as const,
  usersAll: ['admin', 'users'] as const,
  stats: (from: string, to: string) => ['admin', 'stats', from, to] as const,
  health: ['admin', 'health'] as const,
}

export function useAdminUsers(params: UserListParams) {
  return useInfiniteQuery({
    queryKey: adminKeys.users(params),
    queryFn: ({ pageParam }) => listUsers(params, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })
}

export function useUpdateAdminUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: string } & Partial<Pick<AdminUser, 'status' | 'role'>>) =>
      patchUser(id, patch),
    onSuccess: (user) => {
      // Replace the row in every cached list; the status filter may no longer match it,
      // so also refetch in the background.
      qc.setQueriesData<InfiniteData<Page<AdminUser>, string | null>>(
        { queryKey: adminKeys.usersAll },
        (data) =>
          data && {
            ...data,
            pages: data.pages.map((p) => ({
              ...p,
              items: p.items.map((u) => (u.id === user.id ? { ...u, ...user } : u)),
            })),
          },
      )
      void qc.invalidateQueries({ queryKey: adminKeys.usersAll })
      toast.success(S.admin.users.updated)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
}

export const useAdminStats = (from: string, to: string) =>
  useQuery({ queryKey: adminKeys.stats(from, to), queryFn: () => fetchStats(from, to) })

export const useAdminHealth = () => useQuery({ queryKey: adminKeys.health, queryFn: fetchHealth })
