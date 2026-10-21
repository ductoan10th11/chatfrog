import { create } from 'zustand'
import type { Message } from '@/types/api'

/** One in-flight generation (SSE request) for a conversation. */
export type LiveGeneration = {
  /** Conversation id, or 'new' until the server created the conversation. */
  key: string
  conversationId: string | null
  /** Optimistic until `message.created`, then the server's copy. Null for regenerate. */
  userMessage: Message | null
  assistantMessage: Message | null
  /** Stable keys for list rendering. */
  userKey: string
  assistantKey: string
  /** Hide persisted messages from this id on (edit / regenerate replace them). */
  cutoffMessageId?: string
  /** Position in the LLM queue, if the server reported one. */
  queuePosition: number | null
  /** True from `message.created` on. */
  created: boolean
  abort: AbortController
}

type ChatState = {
  live: Record<string, LiveGeneration>
  set: (key: string, gen: LiveGeneration) => void
  patch: (key: string, patch: Partial<LiveGeneration>) => void
  rekey: (from: string, to: string, patch?: Partial<LiveGeneration>) => void
  remove: (key: string) => void
  abortAll: () => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  live: {},
  set: (key, gen) => set((s) => ({ live: { ...s.live, [key]: gen } })),
  patch: (key, patch) =>
    set((s) => (s.live[key] ? { live: { ...s.live, [key]: { ...s.live[key], ...patch } } } : s)),
  rekey: (from, to, patch) =>
    set((s) => {
      const cur = s.live[from]
      if (!cur) return s
      const { [from]: _removed, ...rest } = s.live
      return { live: { ...rest, [to]: { ...cur, ...patch, key: to } } }
    }),
  remove: (key) =>
    set((s) => {
      if (!s.live[key]) return s
      const { [key]: _removed, ...rest } = s.live
      return { live: rest }
    }),
  abortAll: () => {
    for (const g of Object.values(get().live)) g.abort.abort()
  },
}))

/** Live generation for a conversation (undefined when idle). */
export const useLiveGeneration = (conversationId: string) =>
  useChatStore((s) => s.live[conversationId])
