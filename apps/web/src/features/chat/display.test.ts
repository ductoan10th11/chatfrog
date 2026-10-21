import type { Message } from '@/types/api'
import { aliasKey, buildDisplayItems, regenerableId } from './display'
import type { LiveGeneration } from './store'

const msg = (
  id: string,
  role: 'user' | 'assistant',
  status: Message['status'] = 'complete',
): Message => ({
  id,
  conversation_id: 'c',
  role,
  status,
  parts: [{ type: 'text', text: id }],
  created_at: '',
})

const live = (patch: Partial<LiveGeneration>): LiveGeneration => ({
  key: 'c',
  conversationId: 'c',
  userMessage: null,
  assistantMessage: null,
  userKey: 'uk',
  assistantKey: 'ak',
  queuePosition: null,
  created: true,
  abort: new AbortController(),
  ...patch,
})

describe('buildDisplayItems', () => {
  const persisted = [
    msg('u1', 'user'),
    msg('a1', 'assistant'),
    msg('u2', 'user'),
    msg('a2', 'assistant'),
  ]

  it('returns persisted messages when idle', () => {
    expect(buildDisplayItems(persisted, undefined).map((i) => i.key)).toEqual([
      'u1',
      'a1',
      'u2',
      'a2',
    ])
  })

  it('appends the optimistic user message and streaming assistant', () => {
    const items = buildDisplayItems(
      persisted,
      live({
        userMessage: msg('tmp-u', 'user'),
        assistantMessage: msg('tmp-a', 'assistant', 'streaming'),
      }),
    )
    expect(items.map((i) => i.key)).toEqual(['u1', 'a1', 'u2', 'a2', 'uk', 'ak'])
    expect(items.at(-1)?.live).toBe(true)
    expect(items.at(-2)?.live).toBe(false)
  })

  it('keeps the live React keys once the messages are persisted (no remount)', () => {
    aliasKey('u3', 'tmp-u-key')
    aliasKey('a3', 'tmp-a-key')
    const items = buildDisplayItems(
      [...persisted, msg('u3', 'user'), msg('a3', 'assistant')],
      undefined,
    )
    expect(items.slice(-2).map((i) => i.key)).toEqual(['tmp-u-key', 'tmp-a-key'])
  })

  it('hides persisted copies of the live messages (after message.created)', () => {
    const items = buildDisplayItems(
      [...persisted, msg('u3', 'user'), msg('a3', 'assistant', 'streaming')],
      live({
        userMessage: msg('u3', 'user'),
        assistantMessage: msg('a3', 'assistant', 'streaming'),
      }),
    )
    expect(items.map((i) => i.message.id)).toEqual(['u1', 'a1', 'u2', 'a2', 'u3', 'a3'])
  })

  it('cuts at cutoffMessageId for edit', () => {
    const items = buildDisplayItems(
      persisted,
      live({
        cutoffMessageId: 'u2',
        userMessage: msg('u2', 'user'),
        userKey: 'u2',
        assistantMessage: msg('tmp-a', 'assistant', 'streaming'),
      }),
    )
    expect(items.map((i) => i.message.id)).toEqual(['u1', 'a1', 'u2', 'tmp-a'])
  })

  it('hides the replaced assistant message for regenerate', () => {
    const items = buildDisplayItems(
      persisted,
      live({ cutoffMessageId: 'a2', assistantMessage: msg('tmp-a', 'assistant', 'streaming') }),
    )
    expect(items.map((i) => i.message.id)).toEqual(['u1', 'a1', 'u2', 'tmp-a'])
  })
})

describe('regenerableId', () => {
  it('is the last assistant message when it is finished', () => {
    const items = buildDisplayItems(
      [msg('u1', 'user'), msg('a1', 'assistant', 'stopped')],
      undefined,
    )
    expect(regenerableId(items)).toBe('a1')
  })
  it('is null when the last message is a user message, streaming, or live', () => {
    expect(regenerableId(buildDisplayItems([msg('u1', 'user')], undefined))).toBeNull()
    expect(
      regenerableId(
        buildDisplayItems([msg('u1', 'user'), msg('a1', 'assistant', 'streaming')], undefined),
      ),
    ).toBeNull()
    expect(
      regenerableId(
        buildDisplayItems(
          [msg('u1', 'user')],
          live({ assistantMessage: msg('t', 'assistant', 'streaming') }),
        ),
      ),
    ).toBeNull()
  })
})
