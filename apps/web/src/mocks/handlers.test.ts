import { File as NodeFile } from 'node:buffer'
import { api, ApiError, toApiError } from '@/lib/api'
import { installMockApi } from '@/test/mockServer'
import type { Conversation, FileRef, Message, Page, User } from '@/types/api'
import { pickScenario } from './scenarios'
import { activeGenerations, db } from './db'
import { generationStream } from './stream'
import { mockConfig } from './utils'

installMockApi()

/** jsdom's FormData is not understood by Node's fetch, so build the multipart body by hand. */
async function upload(name: string, content: string, type: string): Promise<FileRef> {
  const boundary = '----cfboundary'
  const body =
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\n` +
    `Content-Type: ${type}\r\n\r\n${content}\r\n--${boundary}--\r\n`
  // undici's multipart parser looks at globalThis.File, which jsdom replaces.
  const jsdomFile = globalThis.File
  globalThis.File = NodeFile as unknown as typeof File
  let res: Response
  try {
    res = await fetch('/api/files', {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body,
    })
  } finally {
    globalThis.File = jsdomFile
  }
  if (!res.ok) throw await toApiError(res)
  return (await res.json()) as FileRef
}

describe('mock API: auth & system', () => {
  it('serves healthz and an active admin user', async () => {
    expect(await api<{ ok: boolean }>('/api/healthz')).toEqual({ ok: true })
    const me = await api<User>('/api/me')
    expect(me.role).toBe('admin')
    expect(me.status).toBe('active')
  })

  it('returns 401 after logout and 403 account_pending for pending users', async () => {
    await api('/api/auth/logout', { method: 'POST' })
    await expect(api('/api/me')).rejects.toMatchObject({ status: 401, code: 'unauthenticated' })
    await api('/api/__mock/auth', { method: 'POST', body: { state: 'pending' } })
    const me = await api<User>('/api/me')
    expect(me.status).toBe('pending')
    await expect(api('/api/conversations')).rejects.toMatchObject({
      status: 403,
      code: 'account_pending',
    })
  })
})

describe('mock API: conversations', () => {
  it('lists pinned first, paginates by cursor and filters by q', async () => {
    const first = await api<Page<Conversation>>('/api/conversations', { query: { limit: 30 } })
    expect(first.items).toHaveLength(30)
    expect(first.items[0].pinned).toBe(true)
    expect(first.next_cursor).toBeTruthy()

    const second = await api<Page<Conversation>>('/api/conversations', {
      query: { limit: 30, cursor: first.next_cursor },
    })
    expect(second.items.length).toBeGreaterThan(0)
    const ids = new Set([...first.items, ...second.items].map((c) => c.id))
    expect(ids.size).toBe(first.items.length + second.items.length)

    const found = await api<Page<Conversation>>('/api/conversations', { query: { q: 'ech' } })
    expect(found.items.some((c) => c.title.includes('ếch'))).toBe(true)
  })

  it('creates, renames, pins and deletes', async () => {
    const c = await api<Conversation>('/api/conversations', { method: 'POST', body: {} })
    expect(c.title).toBe('')
    const renamed = await api<Conversation>(`/api/conversations/${c.id}`, {
      method: 'PATCH',
      body: { title: '  Tên mới ', pinned: true },
    })
    expect(renamed).toMatchObject({ title: 'Tên mới', pinned: true })
    await api(`/api/conversations/${c.id}`, { method: 'DELETE' })
    await expect(api(`/api/conversations/${c.id}`)).rejects.toMatchObject({ status: 404 })
  })

  it('paginates messages backwards in time, ascending within a page', async () => {
    const c = await api<Conversation>('/api/conversations', { method: 'POST', body: {} })
    const db = (await import('./db')).db()
    db.messages[c.id] = Array.from({ length: 5 }, (_, i) => ({
      id: `m${i}`,
      conversation_id: c.id,
      role: 'user' as const,
      status: 'complete' as const,
      parts: [{ type: 'text' as const, text: String(i) }],
      created_at: new Date(i).toISOString(),
    }))
    const p1 = await api<Page<Message>>(`/api/conversations/${c.id}/messages`, {
      query: { limit: 2 },
    })
    expect(p1.items.map((m) => m.id)).toEqual(['m3', 'm4'])
    const p2 = await api<Page<Message>>(`/api/conversations/${c.id}/messages`, {
      query: { limit: 2, cursor: p1.next_cursor },
    })
    expect(p2.items.map((m) => m.id)).toEqual(['m1', 'm2'])
    const p3 = await api<Page<Message>>(`/api/conversations/${c.id}/messages`, {
      query: { limit: 2, cursor: p2.next_cursor },
    })
    expect(p3.items.map((m) => m.id)).toEqual(['m0'])
    expect(p3.next_cursor).toBeNull()
  })
})

describe('mock API: files, settings, admin', () => {
  it('stores an upload and serves it back', async () => {
    const ref = await upload('ghi-chu.txt', 'hello', 'text/plain')
    expect(ref).toMatchObject({ kind: 'upload', name: 'ghi-chu.txt', size: 5 })
    const res = await fetch(ref.url)
    expect(await res.text()).toBe('hello')
  })

  it('rejects unsupported types and serves generated images as svg', async () => {
    await expect(upload('virus.exe', 'x', 'application/x-msdownload')).rejects.toBeInstanceOf(
      ApiError,
    )
    const res = await fetch('/api/files/a1b2c3d4e5f60718293a4b5c')
    expect(res.headers.get('content-type')).toContain('image/svg+xml')
  })

  it('round-trips settings and validates them', async () => {
    const saved = await api('/api/settings', {
      method: 'PUT',
      body: { custom_instructions: 'Trả lời ngắn gọn', theme: 'dark' },
    })
    expect(saved).toEqual({ custom_instructions: 'Trả lời ngắn gọn', theme: 'dark' })
    await expect(
      api('/api/settings', { method: 'PUT', body: { custom_instructions: '', theme: 'neon' } }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('admin: lists users, blocks others, refuses self-block', async () => {
    const users = await api<Page<{ id: string; status: string }>>('/api/admin/users', {
      query: { status: 'pending' },
    })
    expect(users.items.every((u) => u.status === 'pending')).toBe(true)
    const me = await api<User>('/api/me')
    await expect(
      api(`/api/admin/users/${me.id}`, { method: 'PATCH', body: { status: 'blocked' } }),
    ).rejects.toMatchObject({ status: 400 })
    const ok = await api<{ status: string }>(`/api/admin/users/${users.items[0].id}`, {
      method: 'PATCH',
      body: { status: 'active' },
    })
    expect(ok.status).toBe('active')
    expect((await api<{ days: unknown[] }>('/api/admin/stats')).days.length).toBeGreaterThan(0)
    expect((await api<{ mongo: { ok: boolean } }>('/api/admin/health')).mongo.ok).toBe(true)
  })
})

describe('pickScenario', () => {
  it.each([
    ['Xin chào', 'default', false],
    ['viết CODE giúp mình', 'code', false],
    ['Vẽ cho mình con mèo', 'image', false],
    ['tạo ảnh phong cảnh', 'image', false],
    ['Sửa bức ảnh vừa rồi', 'edit-image', false],
    ['cho xem một lỗi', 'error', false],
    ['chờ một chút', 'default', true],
    ['chờ rồi vẽ ảnh', 'image', true],
    ['sửa lỗi code', 'error', false],
  ])('%s -> %s (queue=%s)', (text, kind, queue) => {
    expect(pickScenario(text)).toEqual({ kind, queue })
  })
})

/** Event names of a raw SSE body, in order. */
const eventNames = (raw: string) => [...raw.matchAll(/^event: (.+)$/gm)].map((m) => m[1])

async function latestConversation(): Promise<Conversation> {
  const { items } = await api<Page<Conversation>>('/api/conversations', { query: { limit: 100 } })
  return items.reduce((a, b) => (b.updated_at > a.updated_at ? b : a))
}

async function post(path: string, body: unknown, init: RequestInit = {}) {
  return fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    ...init,
  })
}

describe('mock API: generation streams', () => {
  it('default scenario: created -> reasoning -> text -> done -> title (new conversation)', async () => {
    const res = await post('/api/conversations/new/messages', { content: 'Xin chào' })
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const names = eventNames(await res.text())
    expect(names[0]).toBe('message.created')
    expect(names).toContain('reasoning.delta')
    expect(names).toContain('reasoning.done')
    expect(names).toContain('text.delta')
    expect(names.indexOf('reasoning.done')).toBeLessThan(names.indexOf('text.delta'))
    expect(names.at(-2)).toBe('message.done')
    expect(names.at(-1)).toBe('conversation.title')
  })

  it('image scenario emits tool events with a FileRef; edit passes reference_image_ids', async () => {
    const raw = await (
      await post('/api/conversations/new/messages', { content: 'Vẽ ảnh con mèo' })
    ).text()
    const names = eventNames(raw)
    expect(names).toEqual(expect.arrayContaining(['tool.start', 'tool.running', 'tool.done']))
    expect(raw).toMatch(/"file":\{"id":"[0-9a-f]{24}","kind":"generated"/)
    expect(raw).not.toContain('reference_image_ids')

    const editRaw = await (
      await post('/api/conversations/new/messages', { content: 'Sửa lại bức ảnh này' })
    ).text()
    expect(editRaw).toContain('reference_image_ids')
  })

  it('error scenario ends with an error event and a persisted error message', async () => {
    const raw = await (
      await post('/api/conversations/new/messages', { content: 'cho xem lỗi' })
    ).text()
    const names = eventNames(raw)
    expect(names.at(-1)).toBe('error')
    expect(names).not.toContain('message.done')
    const conv = await latestConversation()
    const msgs = await api<Page<Message>>(`/api/conversations/${conv.id}/messages`)
    expect(msgs.items.at(-1)).toMatchObject({
      status: 'error',
      error: { code: 'model_unavailable' },
    })
  })

  it('queue scenario emits queue events first', async () => {
    const names = eventNames(
      await (await post('/api/conversations/new/messages', { content: 'chờ nhé' })).text(),
    )
    expect(names.slice(0, 3)).toEqual(['message.created', 'queue', 'queue'])
  })

  it('code scenario streams a fenced block and a table', async () => {
    const raw = await (
      await post('/api/conversations/new/messages', { content: 'cho ví dụ code' })
    ).text()
    const text = [...raw.matchAll(/event: text\.delta\ndata: (.+)/g)]
      .map((m) => (JSON.parse(m[1]) as { delta: string }).delta)
      .join('')
    expect(text).toContain('```ts')
    expect(text).toContain('| Tiêu chí |')
  })

  it('rejects a second generation (409), empty content (400) and unknown conversation (404)', async () => {
    const created = await api<Conversation>('/api/conversations', { method: 'POST', body: {} })
    const first = await post(`/api/conversations/${created.id}/messages`, { content: 'Xin chào' })
    const second = await post(`/api/conversations/${created.id}/messages`, { content: 'Hai' })
    expect(second.status).toBe(409)
    await first.text()
    expect(
      (await post(`/api/conversations/${created.id}/messages`, { content: '  ' })).status,
    ).toBe(400)
    expect(
      (await post('/api/conversations/ffffffffffffffffffffffff/messages', { content: 'x' })).status,
    ).toBe(404)
  })

  it('regenerate replaces the last assistant message; edit replaces everything after', async () => {
    const raw = await (await post('/api/conversations/new/messages', { content: 'Câu một' })).text()
    const created = JSON.parse(/event: message\.created\ndata: (.+)/.exec(raw)![1]) as {
      conversation: Conversation
      user_message: Message
      assistant_message: Message
    }
    const convId = created.conversation.id
    await (await post(`/api/conversations/${convId}/messages`, { content: 'Câu hai' })).text()

    const regen = await post(
      `/api/messages/${(await api<Page<Message>>(`/api/conversations/${convId}/messages`)).items.at(-1)!.id}/regenerate`,
      {},
    )
    await regen.text()
    let msgs = (await api<Page<Message>>(`/api/conversations/${convId}/messages`)).items
    expect(msgs).toHaveLength(4)

    // Regenerating a non-last message is rejected.
    expect((await post(`/api/messages/${msgs[1].id}/regenerate`, {})).status).toBe(400)

    await (
      await post(`/api/messages/${created.user_message.id}/edit`, { content: 'Câu một đã sửa' })
    ).text()
    msgs = (await api<Page<Message>>(`/api/conversations/${convId}/messages`)).items
    expect(msgs).toHaveLength(2)
    expect(msgs[0].parts).toEqual([{ type: 'text', text: 'Câu một đã sửa' }])
  })
})

describe('generationStream abort handling', () => {
  async function start(signal: AbortSignal) {
    const s = db()
    const conversation = s.conversations[0]
    const userMessage = s.messages[conversation.id][0]
    const assistantMessage: Message = {
      id: 'a'.repeat(24),
      conversation_id: conversation.id,
      role: 'assistant',
      status: 'streaming',
      parts: [],
      created_at: new Date().toISOString(),
    }
    s.messages[conversation.id].push(assistantMessage)
    const stream = generationStream({
      conversation,
      userMessage,
      assistantMessage,
      userText: 'Xin chào',
      isNewConversation: false,
      signal,
    })
    return { stream, assistantMessage }
  }

  async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, needle: string) {
    const dec = new TextDecoder()
    let seen = ''
    while (!seen.includes(needle)) {
      const { value, done } = await reader.read()
      if (done) break
      seen += dec.decode(value)
    }
  }

  it('marks the message stopped when the request signal aborts', async () => {
    mockConfig.speed = 1
    const ac = new AbortController()
    const { stream, assistantMessage } = await start(ac.signal)
    const reader = stream.getReader()
    await readUntil(reader, 'reasoning.delta')
    ac.abort()
    await vi.waitFor(() => expect(assistantMessage.status).toBe('stopped'))
    expect(assistantMessage.parts.length).toBeGreaterThan(0)
    expect(activeGenerations.size).toBe(0)
  })

  it('marks the message stopped when the consumer cancels the stream', async () => {
    mockConfig.speed = 1
    const { stream, assistantMessage } = await start(new AbortController().signal)
    const reader = stream.getReader()
    await readUntil(reader, 'reasoning.delta')
    await reader.cancel()
    await vi.waitFor(() => expect(assistantMessage.status).toBe('stopped'))
  })
})
