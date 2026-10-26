import { http, HttpResponse, type StrictRequest, type DefaultBodyType } from 'msw'
import type {
  AdminUser,
  Conversation,
  FileRef,
  Message,
  Page,
  Part,
  User,
  UserSettings,
} from '@/types/api'
import { activeGenerations, blobs, db, findMessage, persist } from './db'
import { createHealth, createStats, type AuthState } from './fixtures'
import { generatedImageSvg } from './image'
import { generationStream } from './stream'
import { fold, decodeCursor, encodeCursor, newId, nowIso, sleep } from './utils'

/* ------------------------------------------------------------ helpers */

function err(status: number, code: string, message: string, headers?: HeadersInit) {
  return HttpResponse.json({ error: { code, message } }, { status, headers })
}

const notFound = (what = 'dữ liệu') => err(404, 'not_found', `Không tìm thấy ${what}`)
const invalid = (message: string) => err(400, 'invalid_request', message)

/** Returns an error response when the caller may not use this endpoint. */
function guard(opts: { admin?: boolean } = {}) {
  const { auth, user } = db()
  if (auth === 'anon') return err(401, 'unauthenticated', 'Bạn cần đăng nhập')
  if (auth === 'pending' || user.status === 'pending')
    return err(403, 'account_pending', 'Tài khoản đang chờ duyệt')
  if (auth === 'blocked' || user.status === 'blocked')
    return err(403, 'account_blocked', 'Tài khoản đã bị chặn')
  if (opts.admin && user.role !== 'admin') return err(403, 'forbidden', 'Bạn không có quyền')
  return null
}

const latency = (ms = 120) => sleep(ms + Math.random() * 80)

async function readJson<T>(request: StrictRequest<DefaultBodyType>): Promise<T | null> {
  try {
    return (await request.json()) as T
  } catch {
    return null
  }
}

function paginate<T>(items: T[], limit: number, cursor: string | null) {
  const offset = decodeCursor(cursor) ?? 0
  const slice = items.slice(offset, offset + limit)
  const next = offset + limit < items.length ? encodeCursor(offset + limit) : null
  return { items: slice, next_cursor: next } satisfies Page<T>
}

function intParam(url: URL, name: string, fallback: number, max = 100) {
  const n = Number(url.searchParams.get(name))
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback
}

function sse(stream: ReadableStream<Uint8Array>) {
  return new HttpResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

function conversationText(c: Conversation): string {
  const msgs = db().messages[c.id] ?? []
  const body = msgs
    .flatMap((m) => m.parts)
    .map((p) => (p.type === 'text' ? p.text : ''))
    .join(' ')
  return fold(`${c.title} ${body}`)
}

function sortedConversations(): Conversation[] {
  return [...db().conversations].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return b.updated_at.localeCompare(a.updated_at)
  })
}

function buildUserParts(content: string, attachmentIds: string[] | undefined): Part[] | Response {
  const parts: Part[] = []
  for (const id of attachmentIds ?? []) {
    const file = db().files[id]
    if (!file) return invalid(`Tệp đính kèm không tồn tại: ${id}`)
    const { prompt: _prompt, ...ref } = file
    parts.push({ type: 'attachment', file: ref })
  }
  parts.push({ type: 'text', text: content })
  return parts
}

function newAssistant(conversationId: string): Message {
  return {
    id: newId(),
    conversation_id: conversationId,
    role: 'assistant',
    status: 'streaming',
    parts: [],
    created_at: nowIso(),
  }
}

type SendBody = { content?: string; attachment_ids?: string[] }

function validateSend(body: SendBody | null): { content: string; ids: string[] } | Response {
  if (!body || typeof body.content !== 'string') return invalid('Thiếu nội dung tin nhắn')
  const content = body.content.trim()
  if (!content) return invalid('Tin nhắn không được để trống')
  if (content.length > 16000) return invalid('Tin nhắn quá dài (tối đa 16000 ký tự)')
  const ids = body.attachment_ids ?? []
  if (!Array.isArray(ids) || ids.length > 5) return invalid('Tối đa 5 tệp đính kèm')
  return { content, ids }
}

const MAX_IMAGE = 10 * 1024 * 1024
const MAX_DOC = 20 * 1024 * 1024
const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp']
const DOC_EXT =
  /\.(pdf|docx|txt|md|csv|json|ts|tsx|js|jsx|py|go|rs|java|c|cpp|h|sh|yaml|yml|html|css|sql)$/i

/** Duck-typed so it also works across realms (jsdom vs Node in tests). */
function isFileLike(v: unknown): v is File {
  return typeof v === 'object' && v !== null && 'name' in v && 'size' in v && 'arrayBuffer' in v
}

async function imageSize(file: File): Promise<{ width?: number; height?: number }> {
  try {
    if (typeof createImageBitmap !== 'function') return {}
    const bmp = await createImageBitmap(file)
    const out = { width: bmp.width, height: bmp.height }
    bmp.close()
    return out
  } catch {
    return {}
  }
}

/* ------------------------------------------------------------ handlers */

export const handlers = [
  /* system */
  http.get('/api/healthz', () => HttpResponse.json({ ok: true })),

  /* mock-only: switch the simulated auth state (login / logout / pending / blocked) */
  http.post('/api/__mock/auth', async ({ request }) => {
    const body = await readJson<{ state?: AuthState }>(request)
    const next = body?.state
    if (next !== 'active' && next !== 'anon' && next !== 'pending' && next !== 'blocked')
      return invalid('state không hợp lệ')
    const s = db()
    s.auth = next
    s.user.status = next === 'pending' ? 'pending' : next === 'blocked' ? 'blocked' : 'active'
    persist()
    return new HttpResponse(null, { status: 204 })
  }),

  /* auth */
  http.get('/api/me', async () => {
    await latency(60)
    const s = db()
    if (s.auth === 'anon') return err(401, 'unauthenticated', 'Bạn cần đăng nhập')
    return HttpResponse.json<User>(s.user)
  }),
  http.post('/api/auth/logout', () => {
    const s = db()
    s.auth = 'anon'
    persist()
    return new HttpResponse(null, { status: 204 })
  }),

  /* conversations */
  http.get('/api/conversations', async ({ request }) => {
    const denied = guard()
    if (denied) return denied
    await latency()
    const url = new URL(request.url)
    const q = fold(url.searchParams.get('q')?.trim() ?? '')
    let list = sortedConversations()
    if (q) list = list.filter((c) => conversationText(c).includes(q))
    return HttpResponse.json(
      paginate(list, intParam(url, 'limit', 30), url.searchParams.get('cursor')),
    )
  }),

  http.post('/api/conversations', async ({ request }) => {
    const denied = guard()
    if (denied) return denied
    await latency()
    const body = await readJson<{ title?: string }>(request)
    const now = nowIso()
    const c: Conversation = {
      id: newId(),
      title: (body?.title ?? '').trim().slice(0, 200),
      pinned: false,
      created_at: now,
      updated_at: now,
    }
    const s = db()
    s.conversations.push(c)
    s.messages[c.id] = []
    persist()
    return HttpResponse.json(c, { status: 201 })
  }),

  http.get('/api/conversations/:id', async ({ params }) => {
    const denied = guard()
    if (denied) return denied
    await latency(60)
    const c = db().conversations.find((x) => x.id === params.id)
    return c ? HttpResponse.json(c) : notFound('hội thoại')
  }),

  http.patch('/api/conversations/:id', async ({ params, request }) => {
    const denied = guard()
    if (denied) return denied
    await latency(80)
    const c = db().conversations.find((x) => x.id === params.id)
    if (!c) return notFound('hội thoại')
    const body = await readJson<{ title?: string; pinned?: boolean }>(request)
    if (!body) return invalid('Body không hợp lệ')
    if (body.title !== undefined) {
      if (typeof body.title !== 'string') return invalid('title phải là chuỗi')
      c.title = body.title.trim().slice(0, 200)
    }
    if (body.pinned !== undefined) {
      if (typeof body.pinned !== 'boolean') return invalid('pinned phải là boolean')
      c.pinned = body.pinned
    }
    persist()
    return HttpResponse.json(c)
  }),

  http.delete('/api/conversations/:id', async ({ params }) => {
    const denied = guard()
    if (denied) return denied
    await latency(80)
    const s = db()
    const id = params.id as string
    if (!s.conversations.some((x) => x.id === id)) return notFound('hội thoại')
    s.conversations = s.conversations.filter((x) => x.id !== id)
    delete s.messages[id]
    persist()
    return new HttpResponse(null, { status: 204 })
  }),

  http.get('/api/conversations/:id/messages', async ({ params, request }) => {
    const denied = guard()
    if (denied) return denied
    await latency()
    const s = db()
    const id = params.id as string
    if (!s.conversations.some((x) => x.id === id)) return notFound('hội thoại')
    const all = s.messages[id] ?? []
    const url = new URL(request.url)
    const limit = intParam(url, 'limit', 50, 200)
    // Cursor walks into the past: the first page is the newest `limit` messages.
    const end = decodeCursor(url.searchParams.get('cursor')) ?? all.length
    const start = Math.max(0, end - limit)
    return HttpResponse.json<Page<Message>>({
      items: all.slice(start, end),
      next_cursor: start > 0 ? encodeCursor(start) : null,
    })
  }),

  /* generation (SSE) */
  http.post('/api/conversations/:id/messages', async ({ params, request }) => {
    const denied = guard()
    if (denied) return denied
    const s = db()
    const isNew = params.id === 'new'
    let conversation = s.conversations.find((x) => x.id === params.id)
    if (!isNew && !conversation) return notFound('hội thoại')
    if (conversation && activeGenerations.has(conversation.id))
      return err(409, 'conflict', 'Hội thoại đang tạo câu trả lời')

    const valid = validateSend(await readJson<SendBody>(request))
    if (valid instanceof Response) return valid
    const parts = buildUserParts(valid.content, valid.ids)
    if (parts instanceof Response) return parts

    if (!conversation) {
      const now = nowIso()
      conversation = { id: newId(), title: '', pinned: false, created_at: now, updated_at: now }
      s.conversations.push(conversation)
      s.messages[conversation.id] = []
    }
    const userMessage: Message = {
      id: newId(),
      conversation_id: conversation.id,
      role: 'user',
      status: 'complete',
      parts,
      created_at: nowIso(),
    }
    const assistantMessage = newAssistant(conversation.id)
    s.messages[conversation.id].push(userMessage, assistantMessage)
    conversation.updated_at = nowIso()
    activeGenerations.add(conversation.id)
    persist()

    return sse(
      generationStream({
        conversation,
        userMessage,
        assistantMessage,
        userText: valid.content,
        isNewConversation: isNew,
        signal: request.signal,
      }),
    )
  }),

  http.post('/api/messages/:id/regenerate', async ({ params, request }) => {
    const denied = guard()
    if (denied) return denied
    const found = findMessage(params.id as string)
    if (!found) return notFound('tin nhắn')
    const { message, list, index } = found
    const s = db()
    const conversation = s.conversations.find((c) => c.id === message.conversation_id)
    if (!conversation) return notFound('hội thoại')
    if (activeGenerations.has(conversation.id))
      return err(409, 'conflict', 'Hội thoại đang tạo câu trả lời')
    if (message.role !== 'assistant' || index !== list.length - 1 || index === 0)
      return invalid('Chỉ tạo lại được tin nhắn assistant cuối cùng')
    const userMessage = list[index - 1]
    const userText = userMessage.parts.map((p) => (p.type === 'text' ? p.text : '')).join('\n')

    list.pop()
    const assistantMessage = newAssistant(conversation.id)
    list.push(assistantMessage)
    activeGenerations.add(conversation.id)
    persist()

    return sse(
      generationStream({
        conversation,
        userMessage,
        assistantMessage,
        userText,
        isNewConversation: false,
        signal: request.signal,
      }),
    )
  }),

  http.post('/api/messages/:id/edit', async ({ params, request }) => {
    const denied = guard()
    if (denied) return denied
    const found = findMessage(params.id as string)
    if (!found) return notFound('tin nhắn')
    const { message, list, index } = found
    if (message.role !== 'user') return invalid('Chỉ sửa được tin nhắn của người dùng')
    const s = db()
    const conversation = s.conversations.find((c) => c.id === message.conversation_id)
    if (!conversation) return notFound('hội thoại')
    if (activeGenerations.has(conversation.id))
      return err(409, 'conflict', 'Hội thoại đang tạo câu trả lời')

    const body = await readJson<SendBody>(request)
    const valid = validateSend(body)
    if (valid instanceof Response) return valid
    // attachment_ids omitted -> keep the existing attachments.
    const keepExisting = body?.attachment_ids === undefined
    const parts = keepExisting
      ? [
          ...message.parts.filter((p) => p.type === 'attachment'),
          { type: 'text', text: valid.content } as Part,
        ]
      : buildUserParts(valid.content, valid.ids)
    if (parts instanceof Response) return parts

    message.parts = parts
    list.splice(index + 1) // everything after the edited message is replaced
    const assistantMessage = newAssistant(conversation.id)
    list.push(assistantMessage)
    conversation.updated_at = nowIso()
    activeGenerations.add(conversation.id)
    persist()

    return sse(
      generationStream({
        conversation,
        userMessage: message,
        assistantMessage,
        userText: valid.content,
        isNewConversation: false,
        signal: request.signal,
      }),
    )
  }),

  /* files */
  http.post('/api/files', async ({ request }) => {
    const denied = guard()
    if (denied) return denied
    await latency(200)
    let form: FormData
    try {
      form = await request.formData()
    } catch {
      return invalid('Cần multipart/form-data')
    }
    const file = form.get('file')
    if (!isFileLike(file)) return invalid('Thiếu trường file')
    const isImage = IMAGE_MIMES.includes(file.type)
    const isDoc = DOC_EXT.test(file.name)
    if (!isImage && !isDoc)
      return err(415, 'unsupported_media_type', 'Định dạng tệp không được hỗ trợ')
    if (file.size > (isImage ? MAX_IMAGE : MAX_DOC))
      return err(413, 'payload_too_large', 'Tệp quá lớn')

    const id = newId()
    const ref: FileRef = {
      id,
      kind: 'upload',
      name: file.name,
      mime: file.type || 'application/octet-stream',
      size: file.size,
      url: `/api/files/${id}`,
      ...(isImage ? await imageSize(file) : {}),
    }
    blobs.set(id, file)
    db().files[id] = ref
    persist()
    return HttpResponse.json(ref, { status: 201 })
  }),

  http.get('/api/files', async ({ request }) => {
    const denied = guard()
    if (denied) return denied
    await latency()
    const url = new URL(request.url)
    const type = url.searchParams.get('type')
    const list = Object.values(db().files)
      .filter((f) => (type === 'image' ? f.mime.startsWith('image/') : !f.mime.startsWith('image/')))
      .map(({ prompt: _prompt, ...ref }) => ref)
      .reverse()
    return HttpResponse.json(paginate(list, intParam(url, 'limit', 30), url.searchParams.get('cursor')))
  }),

  http.get('/api/files/:id/thumb', ({ params }) => serveFile(params.id as string)),
  http.get('/api/files/:id', ({ params }) => serveFile(params.id as string)),

  http.delete('/api/files/:id', async ({ params }) => {
    const denied = guard()
    if (denied) return denied
    const s = db()
    const id = params.id as string
    if (!s.files[id]) return notFound('tệp')
    const used = Object.values(s.messages).some((list) =>
      list.some((m) =>
        m.parts.some(
          (p) =>
            (p.type === 'attachment' && p.file.id === id) ||
            (p.type === 'tool_call' && p.result?.file.id === id),
        ),
      ),
    )
    if (used) return err(409, 'conflict', 'Tệp đã được dùng trong một tin nhắn')
    delete s.files[id]
    blobs.delete(id)
    persist()
    return new HttpResponse(null, { status: 204 })
  }),

  /* settings */
  http.get('/api/settings', () => {
    const denied = guard()
    if (denied) return denied
    return HttpResponse.json<UserSettings>(db().user.settings)
  }),
  http.put('/api/settings', async ({ request }) => {
    const denied = guard()
    if (denied) return denied
    const body = await readJson<Partial<UserSettings>>(request)
    if (
      !body ||
      typeof body.custom_instructions !== 'string' ||
      !['light', 'dark', 'system'].includes(body.theme as string)
    )
      return invalid('Cài đặt không hợp lệ')
    if (body.custom_instructions.length > 2000)
      return invalid('Custom instructions tối đa 2000 ký tự')
    const s = db()
    s.user.settings = { custom_instructions: body.custom_instructions, theme: body.theme! }
    persist()
    return HttpResponse.json<UserSettings>(s.user.settings)
  }),

  /* admin */
  http.get('/api/admin/users', async ({ request }) => {
    const denied = guard({ admin: true })
    if (denied) return denied
    await latency()
    const url = new URL(request.url)
    const status = url.searchParams.get('status')
    const q = fold(url.searchParams.get('q') ?? '')
    const list = db().adminUsers.filter(
      (u) => (!status || u.status === status) && (!q || fold(`${u.name} ${u.email}`).includes(q)),
    )
    return HttpResponse.json(
      paginate(list, intParam(url, 'limit', 50), url.searchParams.get('cursor')),
    )
  }),
  http.patch('/api/admin/users/:id', async ({ params, request }) => {
    const denied = guard({ admin: true })
    if (denied) return denied
    const s = db()
    const target = s.adminUsers.find((u) => u.id === params.id)
    if (!target) return notFound('người dùng')
    const body = await readJson<{ status?: AdminUser['status']; role?: AdminUser['role'] }>(request)
    if (!body) return invalid('Body không hợp lệ')
    if (target.id === s.user.id && (body.status === 'blocked' || body.role === 'user'))
      return invalid('Không thể tự chặn hoặc hạ quyền chính mình')
    if (body.status !== undefined) {
      if (body.status !== 'active' && body.status !== 'blocked')
        return invalid('status không hợp lệ')
      target.status = body.status
    }
    if (body.role !== undefined) {
      if (body.role !== 'user' && body.role !== 'admin') return invalid('role không hợp lệ')
      target.role = body.role
    }
    persist()
    return HttpResponse.json(target)
  }),
  http.get('/api/admin/stats', () => {
    const denied = guard({ admin: true })
    return denied ?? HttpResponse.json(createStats())
  }),
  http.get('/api/admin/health', () => {
    const denied = guard({ admin: true })
    return denied ?? HttpResponse.json(createHealth())
  }),
]

function serveFile(id: string) {
  const denied = guard()
  if (denied) return denied
  const meta = db().files[id]
  if (!meta) return notFound('tệp')
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, max-age=3600',
  }
  const blob = blobs.get(id)
  if (blob) {
    return new HttpResponse(blob, {
      headers: {
        ...headers,
        'Content-Type': meta.mime,
        'Content-Disposition': `${meta.mime.startsWith('image/') ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
      },
    })
  }
  if (meta.kind === 'generated') {
    return new HttpResponse(generatedImageSvg(id, meta.width, meta.height), {
      headers: { ...headers, 'Content-Type': 'image/svg+xml' },
    })
  }
  if (meta.mime.startsWith('text/')) {
    return new HttpResponse(`Nội dung mẫu của ${meta.name}`, {
      headers: { ...headers, 'Content-Type': `${meta.mime}; charset=utf-8` },
    })
  }
  // Upload whose bytes were lost on page reload.
  return notFound('tệp')
}
