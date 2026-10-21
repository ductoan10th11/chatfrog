import type {
  Conversation,
  FileRef,
  Message,
  Part,
  SSEEventMap,
  SSEEventName,
  ToolCallPart,
} from '@/types/api'
import { activeGenerations, db, persist } from './db'
import { generatedImageSvg, parseSize } from './image'
import {
  ERROR_MESSAGE,
  ERROR_PARTIAL,
  codeAnswer,
  defaultAnswer,
  deriveTitle,
  imageIntro,
  imageOutro,
  imagePrompt,
  pickScenario,
  reasoningFor,
} from './scenarios'
import { SEED_IMAGE_ID } from './fixtures'
import { hashString, newId, nowIso, sleep } from './utils'

class AbortedError extends Error {}

type GenerationInput = {
  conversation: Conversation
  userMessage: Message
  assistantMessage: Message
  userText: string
  isNewConversation: boolean
  signal: AbortSignal
}

/** Split text into small chunks that look like token deltas. */
export function chunkText(text: string, wordsPerChunk = 2): string[] {
  const tokens = text.match(/\s+|\S+/g) ?? []
  const out: string[] = []
  let buf = ''
  let words = 0
  for (const tok of tokens) {
    buf += tok
    if (!/^\s+$/.test(tok)) words++
    if (words >= wordsPerChunk) {
      out.push(buf)
      buf = ''
      words = 0
    }
  }
  if (buf) out.push(buf)
  return out
}

const jitter = (min: number, max: number) => min + Math.random() * (max - min)

/**
 * Build the SSE response body. Persists progress into the in-memory db and
 * stops (status "stopped") when the client aborts.
 */
export function generationStream(input: GenerationInput): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  const ac = new AbortController()
  input.signal.addEventListener('abort', () => ac.abort(), { once: true })
  if (input.signal.aborted) ac.abort()

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string) => {
        try {
          controller.enqueue(enc.encode(chunk))
        } catch {
          // The consumer went away (cancelled reader): treat it as an abort.
          ac.abort()
        }
      }
      void run(input, ac.signal, write).finally(() => {
        try {
          controller.close()
        } catch {
          /* already closed/cancelled */
        }
      })
    },
    cancel() {
      ac.abort()
    },
  })
}

async function run(input: GenerationInput, signal: AbortSignal, write: (s: string) => void) {
  const { conversation, userMessage, assistantMessage: msg, userText } = input
  const state = db()
  activeGenerations.add(conversation.id)

  const emit = <K extends SSEEventName>(event: K, data: SSEEventMap[K]) => {
    if (signal.aborted) throw new AbortedError()
    write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }
  const wait = async (ms: number) => {
    await sleep(ms, signal)
    if (signal.aborted) throw new AbortedError()
  }
  const ping = () => write(': ping\n\n')

  const reasoning = async (text: string) => {
    const index = msg.parts.length
    const part: Part = { type: 'reasoning', text: '', duration_ms: 0 }
    msg.parts.push(part)
    const started = Date.now()
    for (const delta of chunkText(text, 3)) {
      await wait(jitter(14, 34))
      part.text += delta
      emit('reasoning.delta', { index, delta })
    }
    part.duration_ms = Date.now() - started
    emit('reasoning.done', { index, duration_ms: part.duration_ms })
  }

  const textPart = async (text: string, wordsPerChunk = 2) => {
    const index = msg.parts.length
    const part: Part = { type: 'text', text: '' }
    msg.parts.push(part)
    for (const delta of chunkText(text, wordsPerChunk)) {
      await wait(jitter(12, 32))
      part.text += delta
      emit('text.delta', { index, delta })
    }
  }

  const imageTool = async (edit: boolean) => {
    const size = ['1024x1024', '1536x1024', '1024x1536'][hashString(userText) % 3]
    const refs = edit ? [lastImageId(conversation.id)] : undefined
    const prompt = imagePrompt(userText, edit)
    const index = msg.parts.length
    const call: ToolCallPart = {
      type: 'tool_call',
      id: `call_${newId().slice(-6)}`,
      name: 'generate_image',
      args: { prompt, size, ...(refs ? { reference_image_ids: refs } : {}) },
      status: 'queued',
    }
    msg.parts.push(call)
    emit('tool.start', { index, id: call.id, name: 'generate_image', args: call.args })
    await wait(900)
    call.status = 'running'
    emit('tool.running', { index, id: call.id })
    for (let i = 0; i < 4; i++) {
      await wait(900)
      ping()
    }
    const { width, height } = parseSize(size)
    const id = newId()
    const file: FileRef = {
      id,
      kind: 'generated',
      name: `anh-${id.slice(-6)}.svg`,
      mime: 'image/svg+xml',
      size: generatedImageSvg(id, width, height).length,
      width,
      height,
      url: `/api/files/${id}`,
    }
    state.files[id] = { ...file, prompt }
    call.status = 'done'
    call.result = { file }
    emit('tool.done', { index, id: call.id, result: { file } })
  }

  const finish = (status: Message['status'], error?: Message['error']) => {
    msg.status = status
    if (error) msg.error = error
    conversation.updated_at = nowIso()
    persist()
  }

  try {
    emit('message.created', {
      conversation: clone(conversation),
      user_message: clone(userMessage),
      assistant_message: clone(msg),
    })
    const scenario = pickScenario(userText)

    if (scenario.queue) {
      ping()
      emit('queue', { position: 2 })
      await wait(1000)
      emit('queue', { position: 1 })
      await wait(1000)
    }

    await reasoning(reasoningFor(scenario.kind, userText))

    switch (scenario.kind) {
      case 'code':
        await textPart(codeAnswer(), 3)
        break
      case 'image':
      case 'edit-image': {
        const edit = scenario.kind === 'edit-image'
        await textPart(imageIntro(scenario.kind, userText))
        await imageTool(edit)
        await textPart(imageOutro)
        break
      }
      case 'error':
        await textPart(ERROR_PARTIAL)
        await wait(500)
        finish('error', ERROR_MESSAGE)
        write(`event: error\ndata: ${JSON.stringify(ERROR_MESSAGE)}\n\n`)
        return
      default:
        await textPart(defaultAnswer(userText, hashString(userText + msg.id)), 2)
    }

    finish('complete')
    emit('message.done', { message: clone(msg) })

    if (input.isNewConversation || !conversation.title) {
      await wait(450)
      conversation.title = deriveTitle(userText)
      persist()
      emit('conversation.title', { conversation_id: conversation.id, title: conversation.title })
    }
  } catch (e) {
    if (e instanceof AbortedError || signal.aborted) {
      // Client hit Stop (or went away): keep what was generated.
      finish('stopped')
    } else {
      finish('error', { code: 'internal', message: String(e) })
    }
  } finally {
    activeGenerations.delete(conversation.id)
  }
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

/** Most recent image (upload or generated) in the conversation, else the seed image. */
function lastImageId(conversationId: string): string {
  const list = db().messages[conversationId] ?? []
  for (let i = list.length - 1; i >= 0; i--) {
    const parts = list[i].parts
    for (let j = parts.length - 1; j >= 0; j--) {
      const p = parts[j]
      if (p.type === 'tool_call' && p.result?.file) return p.result.file.id
      if (p.type === 'attachment' && p.file.mime.startsWith('image/')) return p.file.id
    }
  }
  return SEED_IMAGE_ID
}
