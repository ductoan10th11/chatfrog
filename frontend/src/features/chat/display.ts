import type { Message } from '@/types/api'
import type { LiveGeneration } from './store'

export type DisplayItem = {
  /** Stable React key (survives the optimistic -> real id swap and live -> persisted). */
  key: string
  message: Message
  /** This is the message currently being generated. */
  live: boolean
}

/**
 * Merge persisted messages with the in-flight generation:
 *  - messages from `cutoffMessageId` on are hidden (edit / regenerate replace them),
 *  - persisted copies of the live messages are dropped (ids match after `message.created`),
 *  - the optimistic user message and the streaming assistant message are appended.
 */
export function buildDisplayItems(
  persisted: Message[],
  live: LiveGeneration | undefined,
): DisplayItem[] {
  let base = persisted
  if (live?.cutoffMessageId) {
    const cut = base.findIndex((m) => m.id === live.cutoffMessageId)
    if (cut !== -1) base = base.slice(0, cut)
  }
  if (live) {
    const liveIds = new Set([live.userMessage?.id, live.assistantMessage?.id].filter(Boolean))
    base = base.filter((m) => !liveIds.has(m.id))
  }
  const items: DisplayItem[] = base.map((message) => ({ key: message.id, message, live: false }))
  if (live?.userMessage) {
    items.push({ key: live.userKey, message: live.userMessage, live: false })
  }
  if (live?.assistantMessage) {
    items.push({ key: live.assistantKey, message: live.assistantMessage, live: true })
  }
  return items
}

/** The last assistant message that is not currently being generated (regenerate target). */
export function regenerableId(items: DisplayItem[]): string | null {
  const last = items[items.length - 1]
  if (!last || last.live || last.message.role !== 'assistant') return null
  if (last.message.status === 'streaming') return null
  return last.message.id
}
