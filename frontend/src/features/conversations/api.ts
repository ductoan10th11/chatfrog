import { api } from '@/lib/api'
import type { Conversation, Message, Page } from '@/types/api'

export const listConversations = (params: { q?: string; cursor?: string | null; limit?: number }) =>
  api<Page<Conversation>>('/api/conversations', {
    query: { limit: params.limit ?? 30, cursor: params.cursor, q: params.q },
  })

export const getConversation = (id: string) => api<Conversation>(`/api/conversations/${id}`)

export const updateConversation = (id: string, patch: { title?: string; pinned?: boolean }) =>
  api<Conversation>(`/api/conversations/${id}`, { method: 'PATCH', body: patch })

export const deleteConversation = (id: string) =>
  api<void>(`/api/conversations/${id}`, { method: 'DELETE' })

export const listMessages = (id: string, cursor?: string | null) =>
  api<Page<Message>>(`/api/conversations/${id}/messages`, { query: { limit: 50, cursor } })
