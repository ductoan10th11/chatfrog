import type { FileRef, Message, SSEEvent } from '@/types/api'
import { applyEvent, currentPhase, markInterrupted, markStopped, messageText } from './reducer'

const base: Message = {
  id: 'a1',
  conversation_id: 'c1',
  role: 'assistant',
  status: 'streaming',
  parts: [],
  created_at: '2026-10-21T00:00:00.000Z',
}

const file: FileRef = {
  id: 'f1',
  kind: 'generated',
  name: 'x.png',
  mime: 'image/png',
  size: 10,
  url: '/api/files/f1',
}

const run = (events: SSEEvent[], start: Message = base) => events.reduce(applyEvent, start)

describe('applyEvent', () => {
  it('creates reasoning and text parts implicitly and appends deltas by index', () => {
    const m = run([
      { event: 'reasoning.delta', data: { index: 0, delta: 'Nghĩ ' } },
      { event: 'reasoning.delta', data: { index: 0, delta: 'xong' } },
      { event: 'reasoning.done', data: { index: 0, duration_ms: 2310 } },
      { event: 'text.delta', data: { index: 1, delta: 'Xin ' } },
      { event: 'text.delta', data: { index: 1, delta: 'chào' } },
    ])
    expect(m.parts).toEqual([
      { type: 'reasoning', text: 'Nghĩ xong', duration_ms: 2310 },
      { type: 'text', text: 'Xin chào' },
    ])
  })

  it('does not mutate its input', () => {
    const before = JSON.stringify(base)
    applyEvent(base, { event: 'text.delta', data: { index: 0, delta: 'x' } })
    expect(JSON.stringify(base)).toBe(before)
  })

  it('walks a tool call through start -> running -> done', () => {
    const start: SSEEvent = {
      event: 'tool.start',
      data: { index: 2, id: 'call_1', name: 'generate_image', args: { prompt: 'a frog' } },
    }
    let m = run([start])
    // Gaps before the index are padded so that parts[index] always exists.
    expect(m.parts).toHaveLength(3)
    expect(m.parts[2]).toMatchObject({ type: 'tool_call', id: 'call_1', status: 'queued' })

    m = applyEvent(m, { event: 'tool.running', data: { index: 2, id: 'call_1' } })
    expect(m.parts[2]).toMatchObject({ status: 'running' })

    m = applyEvent(m, { event: 'tool.done', data: { index: 2, id: 'call_1', result: { file } } })
    expect(m.parts[2]).toMatchObject({ status: 'done', result: { file } })
  })

  it('records tool errors and ignores events for unknown tool calls', () => {
    const m = run([
      {
        event: 'tool.start',
        data: { index: 0, id: 'c', name: 'generate_image', args: { prompt: 'p' } },
      },
      { event: 'tool.error', data: { index: 0, id: 'c', error: 'image server down' } },
    ])
    expect(m.parts[0]).toMatchObject({ status: 'error', error: 'image server down' })
    expect(applyEvent(m, { event: 'tool.running', data: { index: 0, id: 'nope' } })).toBe(m)
  })

  it('finds a tool call by id when the index does not match', () => {
    const m = run([
      {
        event: 'tool.start',
        data: { index: 1, id: 'c', name: 'generate_image', args: { prompt: 'p' } },
      },
      { event: 'tool.running', data: { index: 5, id: 'c' } },
    ])
    expect(m.parts[1]).toMatchObject({ status: 'running' })
  })

  it('replaces the message on message.done and on message.created', () => {
    const final: Message = { ...base, status: 'complete', parts: [{ type: 'text', text: 'ok' }] }
    expect(applyEvent(base, { event: 'message.done', data: { message: final } })).toBe(final)
    const created = applyEvent(base, {
      event: 'message.created',
      data: {
        conversation: { id: 'c1', title: '', pinned: false, created_at: '', updated_at: '' },
        user_message: { ...base, role: 'user', status: 'complete' },
        assistant_message: { ...base, id: 'server-id' },
      },
    })
    expect(created.id).toBe('server-id')
  })

  it('marks the message as errored on an error event, keeping the parts', () => {
    const m = run([
      { event: 'text.delta', data: { index: 0, delta: 'Để mình' } },
      { event: 'error', data: { code: 'model_unavailable', message: 'Hỏng' } },
    ])
    expect(m).toMatchObject({
      status: 'error',
      error: { code: 'model_unavailable', message: 'Hỏng' },
      parts: [{ type: 'text', text: 'Để mình' }],
    })
  })

  it('leaves the message untouched for queue / title events', () => {
    expect(applyEvent(base, { event: 'queue', data: { position: 2 } })).toBe(base)
    expect(
      applyEvent(base, {
        event: 'conversation.title',
        data: { conversation_id: 'c1', title: 'T' },
      }),
    ).toBe(base)
  })
})

describe('markStopped / markInterrupted', () => {
  it('keeps partial text but stops unfinished tool calls', () => {
    const m = run([
      { event: 'text.delta', data: { index: 0, delta: 'Mình sẽ' } },
      {
        event: 'tool.start',
        data: { index: 1, id: 'c', name: 'generate_image', args: { prompt: 'p' } },
      },
    ])
    const stopped = markStopped(m)
    expect(stopped.status).toBe('stopped')
    expect(stopped.parts[0]).toEqual({ type: 'text', text: 'Mình sẽ' })
    expect(stopped.parts[1]).toMatchObject({ status: 'error' })
    expect(markInterrupted(m, 'x')).toMatchObject({
      status: 'error',
      error: { code: 'stream_interrupted', message: 'x' },
    })
  })
})

describe('helpers', () => {
  it('derives the phase from the last part', () => {
    expect(currentPhase(base)).toBe('waiting')
    const reasoning = run([{ event: 'reasoning.delta', data: { index: 0, delta: 'a' } }])
    expect(currentPhase(reasoning)).toBe('reasoning')
    const done = applyEvent(reasoning, {
      event: 'reasoning.done',
      data: { index: 0, duration_ms: 900 },
    })
    expect(currentPhase(done)).toBe('waiting')
    expect(
      currentPhase(applyEvent(done, { event: 'text.delta', data: { index: 1, delta: 'b' } })),
    ).toBe('writing')
    const tool = applyEvent(done, {
      event: 'tool.start',
      data: { index: 1, id: 'c', name: 'generate_image', args: { prompt: 'p' } },
    })
    expect(currentPhase(tool)).toBe('image')
  })

  it('joins text parts for copy', () => {
    const m = run([
      { event: 'reasoning.delta', data: { index: 0, delta: 'hidden' } },
      { event: 'text.delta', data: { index: 1, delta: 'Một' } },
      { event: 'text.delta', data: { index: 2, delta: 'Hai' } },
    ])
    expect(messageText(m)).toBe('Một\n\nHai')
  })
})
