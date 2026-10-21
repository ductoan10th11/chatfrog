import type { Message, Part, SSEEvent, ToolCallPart } from '@/types/api'

/** Fill gaps so that `parts[index]` exists (contract: indexes are contiguous). */
function ensureLength(parts: Part[], index: number): Part[] {
  if (index < parts.length) return parts
  const next = parts.slice()
  while (next.length <= index) next.push({ type: 'text', text: '' })
  return next
}

function setPart(
  message: Message,
  index: number,
  make: (current: Part | undefined) => Part,
): Message {
  const parts = ensureLength(message.parts, index).slice()
  parts[index] = make(message.parts[index])
  return { ...message, parts }
}

/** Locate a tool_call part: by index when it matches the id, otherwise by id. */
function findToolIndex(message: Message, index: number, id: string): number {
  const at = message.parts[index]
  if (at?.type === 'tool_call' && at.id === id) return index
  return message.parts.findIndex((p) => p.type === 'tool_call' && p.id === id)
}

function updateTool(
  message: Message,
  index: number,
  id: string,
  patch: (call: ToolCallPart) => ToolCallPart,
): Message {
  const i = findToolIndex(message, index, id)
  if (i === -1) return message
  const parts = message.parts.slice()
  parts[i] = patch(parts[i] as ToolCallPart)
  return { ...message, parts }
}

/**
 * Pure reducer: apply one SSE event to the assistant message being streamed.
 * Events that do not change the message (queue, conversation.title) return it untouched.
 */
export function applyEvent(message: Message, ev: SSEEvent): Message {
  switch (ev.event) {
    case 'message.created':
      return ev.data.assistant_message

    case 'reasoning.delta':
      return setPart(message, ev.data.index, (cur) =>
        cur?.type === 'reasoning'
          ? { ...cur, text: cur.text + ev.data.delta }
          : { type: 'reasoning', text: ev.data.delta, duration_ms: 0 },
      )

    case 'reasoning.done':
      return setPart(message, ev.data.index, (cur) =>
        cur?.type === 'reasoning'
          ? { ...cur, duration_ms: ev.data.duration_ms }
          : { type: 'reasoning', text: '', duration_ms: ev.data.duration_ms },
      )

    case 'text.delta':
      return setPart(message, ev.data.index, (cur) =>
        cur?.type === 'text'
          ? { ...cur, text: cur.text + ev.data.delta }
          : { type: 'text', text: ev.data.delta },
      )

    case 'tool.start':
      return setPart(message, ev.data.index, () => ({
        type: 'tool_call',
        id: ev.data.id,
        name: ev.data.name,
        args: ev.data.args,
        status: 'queued',
      }))

    case 'tool.running':
      return updateTool(message, ev.data.index, ev.data.id, (c) => ({ ...c, status: 'running' }))

    case 'tool.done':
      return updateTool(message, ev.data.index, ev.data.id, (c) => ({
        ...c,
        status: 'done',
        result: ev.data.result,
        error: undefined,
      }))

    case 'tool.error':
      return updateTool(message, ev.data.index, ev.data.id, (c) => ({
        ...c,
        status: 'error',
        error: ev.data.error,
      }))

    case 'message.done':
      return ev.data.message

    case 'error':
      return {
        ...message,
        status: 'error',
        error: { code: ev.data.code, message: ev.data.message },
      }

    case 'queue':
    case 'conversation.title':
      return message
  }
}

/** The user pressed Stop (or the connection dropped): keep what we have. */
export function markStopped(message: Message): Message {
  return { ...message, status: 'stopped', parts: closeOpenToolCalls(message.parts) }
}

export function markInterrupted(message: Message, errorMessage: string): Message {
  return {
    ...message,
    status: 'error',
    error: { code: 'stream_interrupted', message: errorMessage },
    parts: closeOpenToolCalls(message.parts),
  }
}

/** A tool call that never finished must not keep spinning forever. */
function closeOpenToolCalls(parts: Part[]): Part[] {
  return parts.map((p) =>
    p.type === 'tool_call' && (p.status === 'queued' || p.status === 'running')
      ? { ...p, status: 'error' as const, error: p.error ?? 'Đã dừng' }
      : p,
  )
}

/** Plain text of a message (text parts only), for copy. */
export function messageText(message: Message): string {
  return message.parts
    .flatMap((p) => (p.type === 'text' ? [p.text] : []))
    .join('\n\n')
    .trim()
}

/** What the assistant is doing right now, for the status line / orb state. */
export type AssistantPhase = 'waiting' | 'reasoning' | 'writing' | 'image'

export function currentPhase(message: Message): AssistantPhase {
  const last = message.parts[message.parts.length - 1]
  if (!last) return 'waiting'
  switch (last.type) {
    case 'reasoning':
      return last.duration_ms === 0 ? 'reasoning' : 'waiting'
    case 'tool_call':
      return last.status === 'queued' || last.status === 'running' ? 'image' : 'waiting'
    case 'text':
      return 'writing'
    default:
      return 'waiting'
  }
}
