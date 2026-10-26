import type { AdminUser, Conversation, FileRef, Health, Message, Stats, User } from '@/types/api'
import { newId } from './utils'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

export type AuthState = 'active' | 'anon' | 'pending' | 'blocked'

export type DbState = {
  version: 1
  auth: AuthState
  user: User
  conversations: Conversation[]
  messages: Record<string, Message[]>
  /** Metadata of files (uploads' bytes live in memory only). */
  files: Record<string, FileRef & { prompt?: string }>
  adminUsers: AdminUser[]
}

export const SEED_IMAGE_ID = 'a1b2c3d4e5f60718293a4b5c'

const iso = (ms: number) => new Date(ms).toISOString()

export const MOCK_USER: User = {
  id: '6717aa00000000000000a001',
  email: 'toan@example.com',
  name: 'Toàn Hoàng',
  avatar_url: null,
  role: 'admin',
  status: 'active',
  settings: { custom_instructions: '', theme: 'system' },
  created_at: '2026-09-01T08:00:00.000Z',
  last_login_at: '2026-10-21T01:00:00.000Z',
}

const SAMPLE_TITLES = [
  'Công thức nấu phở bò',
  'Lên kế hoạch du lịch Đà Lạt',
  'Giải thích Docker và Podman',
  'Viết email xin nghỉ phép',
  'So sánh React và Vue',
  'Cách học tiếng Nhật hiệu quả',
  'Debug lỗi CORS trong Go',
  'Ý tưởng quà sinh nhật',
  'Tối ưu truy vấn MongoDB',
  'Tóm tắt sách Atomic Habits',
  'Viết bài thơ về mùa thu',
  'Cấu hình nginx cho SSE',
  'Bài tập chạy bộ 5km',
  'Giải thích hồi quy tuyến tính',
  'Dịch đoạn văn sang tiếng Anh',
  'Gợi ý tên cho dự án mới',
  'Cách pha cà phê muối',
  'Kế hoạch ôn thi IELTS',
  'Regex để kiểm tra email',
  'Phân biệt goroutine và thread',
]

function msg(
  conversationId: string,
  role: 'user' | 'assistant',
  at: number,
  parts: Message['parts'],
): Message {
  return {
    id: newId(),
    conversation_id: conversationId,
    role,
    status: 'complete',
    parts,
    created_at: iso(at),
  }
}

export const SAMPLE_MARKDOWN = `Dưới đây là **tóm tắt ngắn gọn** về chủ đề bạn hỏi:

1. Bước đầu tiên là xác định rõ mục tiêu.
2. Sau đó chia nhỏ công việc thành các phần dễ quản lý.
3. Cuối cùng, kiểm tra lại kết quả và điều chỉnh.

> Mẹo: bắt đầu từ việc nhỏ nhất, rồi mở rộng dần.

Bạn có muốn mình đi sâu vào phần nào không?`

export function createSeed(now: number = Date.now()): DbState {
  const conversations: Conversation[] = []
  const messages: Record<string, Message[]> = {}
  const files: DbState['files'] = {}

  const add = (title: string, ageMs: number, pinned = false): Conversation => {
    const c: Conversation = {
      id: newId(),
      title,
      pinned,
      created_at: iso(now - ageMs - 5 * MIN),
      updated_at: iso(now - ageMs),
    }
    conversations.push(c)
    messages[c.id] = []
    return c
  }

  // Pinned + hand-written conversations covering each time bucket.
  const frog = add('Ảnh chú ếch trên lá sen', 20 * MIN, true)
  files[SEED_IMAGE_ID] = {
    id: SEED_IMAGE_ID,
    kind: 'generated',
    name: 'ech-la-sen.svg',
    mime: 'image/svg+xml',
    size: 4096,
    width: 1024,
    height: 1024,
    url: `/api/files/${SEED_IMAGE_ID}`,
    prompt:
      'A cute green frog sitting on a lotus leaf in gentle rain, soft morning light, watercolor style',
  }
  for (const [name, mime, size] of [
    ['ghi-chu-hop-sprint.md', 'text/markdown', 2840],
    ['bang-gia.csv', 'text/csv', 15360],
  ] as const) {
    const id = newId()
    files[id] = { id, kind: 'upload', name, mime, size, url: `/api/files/${id}` }
  }
  messages[frog.id] = [
    msg(frog.id, 'user', now - 25 * MIN, [
      { type: 'text', text: 'Vẽ ảnh một chú ếch xanh ngồi trên lá sen dưới mưa nhẹ.' },
    ]),
    msg(frog.id, 'assistant', now - 24 * MIN, [
      {
        type: 'reasoning',
        text: 'Người dùng muốn một bức ảnh con ếch trên lá sen. Mình sẽ viết lại prompt bằng tiếng Anh, chi tiết hơn về ánh sáng và phong cách.',
        duration_ms: 2310,
      },
      { type: 'text', text: 'Mình sẽ tạo một chú ếch xanh ngồi trên lá sen dưới mưa nhẹ.' },
      {
        type: 'tool_call',
        id: 'call_seed',
        name: 'generate_image',
        args: { prompt: files[SEED_IMAGE_ID].prompt!, size: '1024x1024' },
        status: 'done',
        result: { file: files[SEED_IMAGE_ID] },
      },
      { type: 'text', text: 'Bạn muốn đổi sang phong cách khác không?' },
    ]),
  ]

  const intro = add('Giới thiệu về ChatFrog', 3 * HOUR)
  messages[intro.id] = [
    msg(intro.id, 'user', now - 3 * HOUR - MIN, [
      { type: 'text', text: 'Xin chào, bạn làm được gì?' },
    ]),
    msg(intro.id, 'assistant', now - 3 * HOUR, [
      {
        type: 'reasoning',
        text: 'Người dùng chào và hỏi khả năng. Trả lời ngắn gọn.',
        duration_ms: 1200,
      },
      { type: 'text', text: SAMPLE_MARKDOWN },
    ]),
  ]

  const yesterday = add('Giải thích điện toán lượng tử', 26 * HOUR)
  messages[yesterday.id] = [
    msg(yesterday.id, 'user', now - 26 * HOUR - MIN, [
      { type: 'text', text: 'Giải thích ngắn gọn về điện toán lượng tử.' },
    ]),
    msg(yesterday.id, 'assistant', now - 26 * HOUR, [
      { type: 'text', text: 'Điện toán lượng tử dùng **qubit** thay cho bit cổ điển.' },
    ]),
  ]

  add('Viết hàm debounce bằng TypeScript', 3 * DAY)
  add('Lên thực đơn tuần này', 5 * DAY)
  add('', 6 * DAY) // untitled
  add('Ghi chú họp sprint', 9 * DAY)

  // Filler so the sidebar needs infinite scroll (limit 30).
  for (let i = 0; i < 40; i++) {
    const title = `${SAMPLE_TITLES[i % SAMPLE_TITLES.length]}${i >= SAMPLE_TITLES.length ? ` (${Math.floor(i / SAMPLE_TITLES.length) + 1})` : ''}`
    add(title, (12 + i * 1.7) * DAY)
  }

  // Newest first (the list handler re-sorts anyway).
  conversations.sort((a, b) => b.updated_at.localeCompare(a.updated_at))

  const adminUsers: AdminUser[] = [
    { ...MOCK_USER, message_count: 128, image_count: 14 },
    {
      id: '6717aa00000000000000a002',
      email: 'lan.nguyen@example.com',
      name: 'Nguyễn Lan',
      avatar_url: null,
      role: 'user',
      status: 'active',
      settings: { custom_instructions: '', theme: 'light' },
      created_at: '2026-09-10T08:00:00.000Z',
      last_login_at: iso(now - 2 * DAY),
      message_count: 64,
      image_count: 5,
    },
    {
      id: '6717aa00000000000000a003',
      email: 'minh.tran@example.com',
      name: 'Trần Minh',
      avatar_url: null,
      role: 'user',
      status: 'pending',
      settings: { custom_instructions: '', theme: 'system' },
      created_at: iso(now - 1 * DAY),
      last_login_at: iso(now - 1 * DAY),
      message_count: 0,
      image_count: 0,
    },
    {
      id: '6717aa00000000000000a004',
      email: 'spam@example.com',
      name: 'Người dùng bị chặn',
      avatar_url: null,
      role: 'user',
      status: 'blocked',
      settings: { custom_instructions: '', theme: 'dark' },
      created_at: '2026-09-20T08:00:00.000Z',
      last_login_at: '2026-10-01T08:00:00.000Z',
      message_count: 3,
      image_count: 0,
    },
  ]

  return {
    version: 1,
    auth: 'active',
    user: { ...MOCK_USER, last_login_at: iso(now) },
    conversations,
    messages,
    files,
    adminUsers,
  }
}

export function createStats(now: number = Date.now()): Stats {
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(now - (13 - i) * DAY)
    const base = 20 + ((i * 7) % 23)
    return {
      date: d.toISOString().slice(0, 10),
      messages: base,
      images: Math.floor(base / 5),
      prompt_tokens: base * 420,
      completion_tokens: base * 610,
      avg_latency_ms: 2800 + ((i * 331) % 1400),
    }
  })
  return {
    days,
    totals: {
      users: 4,
      active_users: 2,
      conversations: 47,
      messages: days.reduce((n, d) => n + d.messages, 0),
      images: days.reduce((n, d) => n + d.images, 0),
      storage_bytes: 256 * 1024 * 1024,
    },
  }
}

export function createHealth(now: number = Date.now()): Health {
  return {
    llm: { ok: true, latency_ms: 142, model: 'qwen3.5-4b', last_error: null, checked_at: iso(now) },
    image: {
      ok: true,
      latency_ms: 310,
      model: 'flux.2-klein-4b',
      last_error: null,
      checked_at: iso(now),
    },
    mongo: { ok: true },
  }
}
