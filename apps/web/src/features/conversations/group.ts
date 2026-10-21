import type { Conversation } from '@/types/api'
import { S } from '@/lib/strings'

export type ConversationGroup = { key: string; label: string; items: Conversation[] }

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

/**
 * Pinned first, then by recency: Hôm nay / Hôm qua / 7 ngày trước / Cũ hơn.
 * Input order is preserved inside each group (the server already sorts by updated_at desc).
 */
export function groupConversations(
  items: Conversation[],
  now: Date = new Date(),
): ConversationGroup[] {
  const today = startOfDay(now)
  const day = 24 * 60 * 60 * 1000
  const groups: ConversationGroup[] = [
    { key: 'pinned', label: S.nav.pinned, items: [] },
    { key: 'today', label: S.nav.today, items: [] },
    { key: 'yesterday', label: S.nav.yesterday, items: [] },
    { key: 'week', label: S.nav.last7Days, items: [] },
    { key: 'older', label: S.nav.older, items: [] },
  ]
  for (const c of items) {
    if (c.pinned) {
      groups[0].items.push(c)
      continue
    }
    const t = new Date(c.updated_at).getTime()
    if (t >= today) groups[1].items.push(c)
    else if (t >= today - day) groups[2].items.push(c)
    else if (t >= today - 7 * day) groups[3].items.push(c)
    else groups[4].items.push(c)
  }
  return groups.filter((g) => g.items.length > 0)
}
