import type { Conversation } from '@/types/api'
import { groupConversations } from './group'

const NOW = new Date(2026, 9, 21, 15, 0, 0) // 21 Oct 2026, 15:00 local

function conv(id: string, updated: Date, pinned = false): Conversation {
  return {
    id,
    title: id,
    pinned,
    created_at: updated.toISOString(),
    updated_at: updated.toISOString(),
  }
}

describe('groupConversations', () => {
  it('puts pinned first and buckets the rest by day boundaries', () => {
    const items = [
      conv('pin', new Date(2026, 8, 1), true),
      conv('today', new Date(2026, 9, 21, 0, 5)),
      conv('yesterday', new Date(2026, 9, 20, 23, 59)),
      conv('three-days', new Date(2026, 9, 18, 12)),
      conv('six-days', new Date(2026, 9, 15, 0, 0, 1)),
      conv('old', new Date(2026, 9, 10)),
    ]
    const groups = groupConversations(items, NOW)
    expect(groups.map((g) => [g.key, g.items.map((c) => c.id)])).toEqual([
      ['pinned', ['pin']],
      ['today', ['today']],
      ['yesterday', ['yesterday']],
      ['week', ['three-days', 'six-days']],
      ['older', ['old']],
    ])
  })

  it('omits empty groups and keeps input order', () => {
    const groups = groupConversations(
      [conv('b', new Date(2026, 9, 21, 14)), conv('a', new Date(2026, 9, 21, 9))],
      NOW,
    )
    expect(groups).toHaveLength(1)
    expect(groups[0].items.map((c) => c.id)).toEqual(['b', 'a'])
  })
})
