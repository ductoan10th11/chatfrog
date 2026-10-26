/** TypeScript types for docs/API.md. Keep in sync with the contract. */

export type Theme = 'light' | 'dark' | 'system'

export type UserSettings = { custom_instructions: string; theme: Theme }

export type User = {
  id: string
  email: string
  name: string
  avatar_url: string | null
  role: 'user' | 'admin'
  status: 'pending' | 'active' | 'blocked'
  settings: UserSettings
  created_at: string
  last_login_at: string
}

export type Conversation = {
  id: string
  /** Empty string while untitled. */
  title: string
  pinned: boolean
  created_at: string
  updated_at: string
}

export type FileRef = {
  id: string
  kind: 'upload' | 'generated'
  name: string
  mime: string
  /** bytes */
  size: number
  width?: number
  height?: number
  /** "/api/files/<id>" */
  url: string
  created_at?: string
  /** Documents: extracted text was cut at DOC_MAX_CHARS. */
  truncated?: boolean
}

export type ToolCallStatus = 'queued' | 'running' | 'done' | 'error'

export type ToolArgs = { prompt: string; size?: string; reference_image_ids?: string[] }

export type TextPart = { type: 'text'; text: string }
export type ReasoningPart = { type: 'reasoning'; text: string; duration_ms: number }
export type AttachmentPart = { type: 'attachment'; file: FileRef }
export type ToolCallPart = {
  type: 'tool_call'
  id: string
  name: 'generate_image'
  args: ToolArgs
  status: ToolCallStatus
  result?: { file: FileRef }
  error?: string
}
export type Part = TextPart | ReasoningPart | AttachmentPart | ToolCallPart

export type MessageStatus = 'streaming' | 'complete' | 'stopped' | 'error'

export type Message = {
  id: string
  conversation_id: string
  role: 'user' | 'assistant'
  status: MessageStatus
  parts: Part[]
  error?: { code: string; message: string }
  created_at: string
}

export type Page<T> = { items: T[]; next_cursor: string | null }

export type AdminUser = User & { message_count: number; image_count: number }

export type Stats = {
  days: {
    date: string
    messages: number
    images: number
    prompt_tokens: number
    completion_tokens: number
    avg_latency_ms: number
  }[]
  totals: {
    users: number
    active_users: number
    conversations: number
    messages: number
    images: number
    storage_bytes: number
  }
}

type ServiceHealth = {
  ok: boolean
  latency_ms: number | null
  model: string
  last_error: string | null
  checked_at: string
}

export type Health = { llm: ServiceHealth; image: ServiceHealth; mongo: { ok: boolean } }

export type ApiErrorBody = { error: { code: string; message: string } }

/* ---------------------------------------------------------------- SSE */

export type SSEEventMap = {
  'message.created': {
    conversation: Conversation
    user_message: Message
    assistant_message: Message
  }
  queue: { position: number }
  'reasoning.delta': { index: number; delta: string }
  'reasoning.done': { index: number; duration_ms: number }
  'text.delta': { index: number; delta: string }
  'tool.start': { index: number; id: string; name: 'generate_image'; args: ToolArgs }
  'tool.running': { index: number; id: string }
  'tool.done': { index: number; id: string; result: { file: FileRef } }
  'tool.error': { index: number; id: string; error: string }
  'conversation.title': { conversation_id: string; title: string }
  'message.done': { message: Message }
  error: { code: string; message: string }
}

export type SSEEventName = keyof SSEEventMap

/** Discriminated union of every typed SSE event. */
export type SSEEvent = {
  [K in SSEEventName]: { event: K; data: SSEEventMap[K] }
}[SSEEventName]
