import { api } from '@/lib/api'
import type { AdminUser, Health, Page, Stats } from '@/types/api'

export type StatusFilter = '' | AdminUser['status']

export type UserListParams = { status: StatusFilter; q: string }

export const PAGE_SIZE = 30

export const listUsers = (params: UserListParams, cursor?: string | null) =>
  api<Page<AdminUser>>('/api/admin/users', {
    query: { status: params.status, q: params.q.trim(), limit: PAGE_SIZE, cursor },
  })

export const patchUser = (id: string, patch: Partial<Pick<AdminUser, 'status' | 'role'>>) =>
  api<AdminUser>(`/api/admin/users/${id}`, { method: 'PATCH', body: patch })

export const fetchStats = (from: string, to: string) =>
  api<Stats>('/api/admin/stats', { query: { from, to } })

export const fetchHealth = () => api<Health>('/api/admin/health')
