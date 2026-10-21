import type { InfiniteData, QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { errorMessage, isApiError } from '@/lib/api'
import { postSSE } from '@/lib/sse'
import { S } from '@/lib/strings'
import {
  conversationKey,
  conversationsKey,
  patchConversationCache,
} from '@/features/conversations/queries'
import type { Conversation, FileRef, Message, Page, Part, SSEEvent } from '@/types/api'
import { aliasKey } from './display'
import { applyEvent, markInterrupted, markStopped } from './reducer'
import { messagesKey } from './queries'
import { useChatStore, type LiveGeneration } from './store'

export type GenerationRequest =
  | { kind: 'send'; conversationId: string; content: string; attachments?: FileRef[] }
  | { kind: 'regenerate'; conversationId: string; message: Message }
  | {
      kind: 'edit'
      conversationId: string
      message: Message
      content: string
      attachmentIds?: string[]
    }

export type GenerationDeps = {
  queryClient: QueryClient
  /** Called as soon as a brand new conversation exists (route to /c/:id). */
  onConversationCreated?: (conversation: Conversation) => void
}

export type GenerationResult = {
  /** The server accepted the request (`message.created` arrived). */
  created: boolean
  error?: unknown
}

export const NEW_CONVERSATION = 'new'

let seq = 0
const tempId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`

const nowIso = () => new Date().toISOString()

function placeholder(
  conversationId: string,
  role: Message['role'],
  id: string,
  parts: Part[],
): Message {
  return {
    id,
    conversation_id: conversationId,
    role,
    status: role === 'assistant' ? 'streaming' : 'complete',
    parts,
    created_at: nowIso(),
  }
}

function endpoint(req: GenerationRequest): { path: string; body?: unknown } {
  switch (req.kind) {
    case 'send':
      return {
        path: `/api/conversations/${req.conversationId}/messages`,
        body: {
          content: req.content,
          attachment_ids: req.attachments?.length ? req.attachments.map((f) => f.id) : undefined,
        },
      }
    case 'regenerate':
      return { path: `/api/messages/${req.message.id}/regenerate` }
    case 'edit':
      return {
        path: `/api/messages/${req.message.id}/edit`,
        body: { content: req.content, attachment_ids: req.attachmentIds },
      }
  }
}

function buildInitial(req: GenerationRequest, abort: AbortController): LiveGeneration {
  const convId = req.conversationId
  const assistant = placeholder(convId, 'assistant', tempId('tmp-a'), [])
  const base = {
    key: convId,
    conversationId: convId === NEW_CONVERSATION ? null : convId,
    assistantMessage: assistant,
    assistantKey: assistant.id,
    queuePosition: null,
    created: false,
    abort,
  }
  switch (req.kind) {
    case 'send': {
      // Same order as the server: attachments first, then the text.
      const user = placeholder(convId, 'user', tempId('tmp-u'), [
        ...(req.attachments ?? []).map((file) => ({ type: 'attachment' as const, file })),
        { type: 'text', text: req.content },
      ])
      return { ...base, userMessage: user, userKey: user.id }
    }
    case 'regenerate':
      return { ...base, userMessage: null, userKey: 'none', cutoffMessageId: req.message.id }
    case 'edit': {
      const kept = req.message.parts.filter((p) => p.type === 'attachment')
      const user: Message = {
        ...req.message,
        status: 'complete',
        parts: [...kept, { type: 'text', text: req.content }],
      }
      return {
        ...base,
        userMessage: user,
        userKey: req.message.id,
        cutoffMessageId: req.message.id,
      }
    }
  }
}

/** Commit the final messages into the TanStack cache so the live overlay can go away. */
function commitToCache(qc: QueryClient, gen: LiveGeneration) {
  if (!gen.conversationId) return
  const finals = [gen.userMessage, gen.assistantMessage].filter(
    (m): m is Message => !!m && !m.id.startsWith('tmp-'),
  )
  qc.setQueryData<InfiniteData<Page<Message>, string | null>>(
    messagesKey(gen.conversationId),
    (data) => {
      if (!data) return { pages: [{ items: finals, next_cursor: null }], pageParams: [null] }

      // pages[0] is the newest page; items inside a page are ascending.
      const pages = data.pages.map((p) => ({ ...p, items: [...p.items] }))
      if (gen.cutoffMessageId) {
        const pi = pages.findIndex((p) => p.items.some((m) => m.id === gen.cutoffMessageId))
        if (pi !== -1) {
          const ii = pages[pi].items.findIndex((m) => m.id === gen.cutoffMessageId)
          pages[pi].items = pages[pi].items.slice(0, ii)
          for (let j = 0; j < pi; j++) pages[j].items = [] // everything newer is replaced
        }
      }
      const finalIds = new Set(finals.map((m) => m.id))
      for (const p of pages) p.items = p.items.filter((m) => !finalIds.has(m.id))
      pages[0].items.push(...finals)
      return { ...data, pages }
    },
  )
}

/**
 * Start a generation. Runs outside React, so navigating from `/` to `/c/:id` (or away
 * entirely) never interrupts the stream; components just read `useChatStore`.
 */
export async function startGeneration(
  req: GenerationRequest,
  { queryClient: qc, onConversationCreated }: GenerationDeps,
): Promise<GenerationResult> {
  const store = useChatStore.getState()
  const key = req.conversationId
  if (store.live[key]) return { created: false, error: new Error('busy') } // one generation per conversation

  const abort = new AbortController()
  store.set(key, buildInitial(req, abort))

  // Rekeyed after message.created for new conversations.
  let liveKey = key
  let assistant = useChatStore.getState().live[key].assistantMessage!
  let created = false
  let rafId: number | null = null

  const flush = () => {
    rafId = null
    useChatStore.getState().patch(liveKey, { assistantMessage: assistant })
  }
  // Coalesce token deltas to at most one React update per frame.
  const scheduleFlush = () => {
    if (rafId !== null) return
    rafId =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame(flush)
        : (setTimeout(flush, 16) as unknown as number)
  }
  const flushNow = () => {
    if (rafId !== null) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId)
      else clearTimeout(rafId)
    }
    flush()
  }

  const handle = (ev: SSEEvent) => {
    switch (ev.event) {
      case 'message.created': {
        created = true
        const conv = ev.data.conversation
        const wasNew = liveKey === NEW_CONVERSATION
        assistant = ev.data.assistant_message
        const current = useChatStore.getState().live[liveKey]
        const assistantKey = current?.assistantKey ?? assistant.id
        // Keep React keys once the server ids replace the optimistic ones (no remount).
        aliasKey(assistant.id, assistantKey)
        if (req.kind !== 'regenerate' && current) aliasKey(ev.data.user_message.id, current.userKey)
        const patch: Partial<LiveGeneration> = {
          created: true,
          conversationId: conv.id,
          assistantMessage: assistant,
          assistantKey,
          ...(req.kind === 'regenerate' ? {} : { userMessage: ev.data.user_message }),
        }
        if (wasNew) {
          useChatStore.getState().rekey(liveKey, conv.id, patch)
          liveKey = conv.id
          // Seed caches so /c/:id renders immediately without a loading flash.
          qc.setQueryData(conversationKey(conv.id), conv)
          qc.setQueryData<InfiniteData<Page<Message>, string | null>>(messagesKey(conv.id), {
            pages: [{ items: [], next_cursor: null }],
            pageParams: [null],
          })
          void qc.invalidateQueries({ queryKey: ['conversations'] })
          onConversationCreated?.(conv)
        } else {
          useChatStore.getState().patch(liveKey, patch)
        }
        return
      }
      case 'queue':
        useChatStore.getState().patch(liveKey, { queuePosition: ev.data.position })
        return
      case 'conversation.title':
        patchConversationCache(qc, ev.data.conversation_id, { title: ev.data.title })
        void qc.invalidateQueries({ queryKey: ['conversations'] })
        return
      default: {
        if (ev.event !== 'error' && ev.event !== 'message.done') {
          // First model output: the queue (if any) is over.
          if (useChatStore.getState().live[liveKey]?.queuePosition != null)
            useChatStore.getState().patch(liveKey, { queuePosition: null })
        }
        assistant = applyEvent(assistant, ev)
        if (ev.event === 'message.done' || ev.event === 'error') flushNow()
        else scheduleFlush()
      }
    }
  }

  let failure: unknown
  try {
    const stream = await postSSE(endpoint(req).path, endpoint(req).body, abort.signal)
    for await (const ev of stream) handle(ev)
    // The server closed the stream without a terminal event.
    if (created && assistant.status === 'streaming') {
      assistant = markInterrupted(assistant, S.chat.streamEnded)
    }
  } catch (e) {
    if (abort.signal.aborted) {
      if (created) assistant = markStopped(assistant)
    } else {
      failure = e
      if (created) assistant = markInterrupted(assistant, errorMessage(e))
    }
  }
  flushNow()

  const gen = useChatStore.getState().live[liveKey]
  if (gen) {
    if (created) {
      commitToCache(qc, { ...gen, assistantMessage: assistant })
      // The server's copy is authoritative after a stop / error (it may hold a little more).
      if (assistant.status !== 'complete') {
        void qc.invalidateQueries({ queryKey: messagesKey(gen.conversationId!) })
      }
      void qc.invalidateQueries({ queryKey: ['conversations'] })
    } else if (gen.conversationId) {
      // Failed or aborted before the server acknowledged: resync in case it did create something.
      void qc.invalidateQueries({ queryKey: messagesKey(gen.conversationId) })
    }
    useChatStore.getState().remove(liveKey)
  }

  if (failure) {
    if (isApiError(failure) && failure.code === 'conflict') toast.error(S.chat.conflict)
    else
      toast.error(created ? errorMessage(failure) : `${S.chat.sendFailed} ${errorMessage(failure)}`)
    if (!created && req.kind === 'send') void qc.invalidateQueries({ queryKey: conversationsKey() })
  }
  return { created, error: failure }
}

export function stopGeneration(conversationId: string) {
  useChatStore.getState().live[conversationId]?.abort.abort()
}
