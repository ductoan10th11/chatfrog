import { ApiError, toApiError, buildUrl } from '@/lib/api'
import type { SSEEvent, SSEEventName } from '@/types/api'

/** One dispatched SSE frame, before JSON decoding. */
export type RawSSEFrame = { event: string; data: string; id?: string }

/**
 * Incremental parser for `text/event-stream` (WHATWG HTML §9.2).
 * Feed it decoded text in arbitrary chunks; it returns the frames completed so far.
 * Handles LF / CRLF / CR line endings (also when split across chunks), multi-line `data:`,
 * comment lines (`: ping`), `id:` / `retry:` fields and a leading BOM.
 */
export class SSEParser {
  private buffer = ''
  private event = ''
  private data: string[] = []
  private id: string | undefined
  private started = false

  feed(chunk: string): RawSSEFrame[] {
    if (!this.started && chunk.length > 0) {
      this.started = true
      if (chunk.charCodeAt(0) === 0xfeff) chunk = chunk.slice(1)
    }
    this.buffer += chunk
    const frames: RawSSEFrame[] = []

    for (;;) {
      const m = /\r\n|\n|\r/.exec(this.buffer)
      if (!m) break
      // A trailing CR may be the first half of CRLF: wait for the next chunk.
      if (m[0] === '\r' && m.index === this.buffer.length - 1) break
      const line = this.buffer.slice(0, m.index)
      this.buffer = this.buffer.slice(m.index + m[0].length)
      const frame = this.processLine(line)
      if (frame) frames.push(frame)
    }
    return frames
  }

  /** Call when the stream ends. A trailing, unterminated frame is still dispatched (lenient). */
  flush(): RawSSEFrame[] {
    const frames: RawSSEFrame[] = []
    if (this.buffer.length > 0) {
      const frame = this.processLine(this.buffer.replace(/\r$/, ''))
      this.buffer = ''
      if (frame) frames.push(frame)
    }
    const last = this.dispatch()
    if (last) frames.push(last)
    return frames
  }

  private processLine(line: string): RawSSEFrame | null {
    if (line === '') return this.dispatch()
    if (line.startsWith(':')) return null // comment / keep-alive

    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)

    switch (field) {
      case 'event':
        this.event = value
        break
      case 'data':
        this.data.push(value)
        break
      case 'id':
        if (!value.includes('\0')) this.id = value
        break
      default: // `retry` and unknown fields are ignored
        break
    }
    return null
  }

  private dispatch(): RawSSEFrame | null {
    if (this.data.length === 0) {
      this.event = ''
      return null
    }
    const frame: RawSSEFrame = {
      event: this.event || 'message',
      data: this.data.join('\n'),
      ...(this.id !== undefined ? { id: this.id } : {}),
    }
    this.event = ''
    this.data = []
    return frame
  }
}

const EVENT_NAMES: ReadonlySet<string> = new Set<SSEEventName>([
  'message.created',
  'queue',
  'reasoning.delta',
  'reasoning.done',
  'text.delta',
  'tool.start',
  'tool.running',
  'tool.done',
  'tool.error',
  'conversation.title',
  'message.done',
  'error',
])

/** Decode a raw frame into a typed event. Unknown events and invalid JSON yield `null`. */
export function decodeFrame(frame: RawSSEFrame): SSEEvent | null {
  if (!EVENT_NAMES.has(frame.event)) return null
  try {
    // The event name and its payload shape are paired by the API contract (docs/API.md).
    return { event: frame.event, data: JSON.parse(frame.data) } as SSEEvent
  } catch {
    return null
  }
}

/** Read a byte stream and yield typed events. Stops (and cancels the reader) on early exit. */
export async function* readSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<SSEEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8')
  const parser = new SSEParser()
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      for (const frame of parser.feed(decoder.decode(value, { stream: true }))) {
        const ev = decodeFrame(frame)
        if (ev) yield ev
      }
    }
    for (const frame of [...parser.feed(decoder.decode()), ...parser.flush()]) {
      const ev = decodeFrame(frame)
      if (ev) yield ev
    }
  } finally {
    // Releases the connection when the consumer stops early (abort, break).
    await reader.cancel().catch(() => {})
  }
}

/**
 * POST (JSON) and stream the SSE response as typed events.
 * Rejects with ApiError for non-2xx responses (e.g. 409 conflict); aborts with `signal`.
 */
export async function postSSE(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<AsyncGenerator<SSEEvent>> {
  const res = await fetch(buildUrl(path), {
    method: 'POST',
    credentials: 'include',
    signal,
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw await toApiError(res)
  if (!res.body) throw new ApiError(502, 'internal', 'Máy chủ không trả về luồng dữ liệu')
  return readSSE(res.body)
}
