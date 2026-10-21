import { decodeFrame, readSSE, SSEParser } from './sse'

function parseAll(chunks: string[]) {
  const p = new SSEParser()
  return [...chunks.flatMap((c) => p.feed(c)), ...p.flush()]
}

describe('SSEParser', () => {
  it('parses a simple frame', () => {
    expect(parseAll(['event: text.delta\ndata: {"index":1,"delta":"Xin"}\n\n'])).toEqual([
      { event: 'text.delta', data: '{"index":1,"delta":"Xin"}' },
    ])
  })

  it('defaults the event name to "message"', () => {
    expect(parseAll(['data: hi\n\n'])).toEqual([{ event: 'message', data: 'hi' }])
  })

  it('joins multi-line data with newlines', () => {
    expect(parseAll(['event: x\ndata: line1\ndata: line2\ndata:\ndata: line4\n\n'])).toEqual([
      { event: 'x', data: 'line1\nline2\n\nline4' },
    ])
  })

  it('ignores comments and keep-alive pings, even between frames', () => {
    const frames = parseAll([': ping\n\nevent: a\ndata: 1\n\n: ping\nevent: b\ndata: 2\n\n'])
    expect(frames.map((f) => f.event)).toEqual(['a', 'b'])
  })

  it('handles a chunk boundary in the middle of a field name', () => {
    expect(parseAll(['eve', 'nt: text.d', 'elta\nda', 'ta: {"a":', '1}\n', '\n'])).toEqual([
      { event: 'text.delta', data: '{"a":1}' },
    ])
  })

  it('handles a boundary between the two newlines that end a frame', () => {
    expect(parseAll(['event: a\ndata: 1\n', '\nevent: b\ndata: 2\n', '\n'])).toEqual([
      { event: 'a', data: '1' },
      { event: 'b', data: '2' },
    ])
  })

  it('handles CRLF, including a CR/LF pair split across chunks', () => {
    expect(parseAll(['event: a\r\ndata: 1\r', '\n\r\n'])).toEqual([{ event: 'a', data: '1' }])
    expect(parseAll(['event: b\rdata: 2\r\r'])).toEqual([{ event: 'b', data: '2' }])
  })

  it('works byte by byte', () => {
    const text =
      ': ping\n\nevent: text.delta\ndata: {"delta":"Tiếng Việt"}\n\nevent: message.done\ndata: {}\n\n'
    const frames = parseAll([...text])
    expect(frames).toEqual([
      { event: 'text.delta', data: '{"delta":"Tiếng Việt"}' },
      { event: 'message.done', data: '{}' },
    ])
  })

  it('strips only one leading space and a BOM', () => {
    expect(parseAll(['﻿data:  two spaces\n\n'])).toEqual([
      { event: 'message', data: ' two spaces' },
    ])
  })

  it('does not dispatch frames without data, and resets the event name', () => {
    expect(parseAll(['event: orphan\n\ndata: x\n\n'])).toEqual([{ event: 'message', data: 'x' }])
  })

  it('keeps id and ignores retry / unknown fields', () => {
    expect(parseAll(['id: 7\nretry: 1000\nfoo: bar\nevent: a\ndata: 1\n\n'])).toEqual([
      { event: 'a', data: '1', id: '7' },
    ])
  })

  it('flushes a final frame that lacks the terminating blank line', () => {
    expect(parseAll(['event: a\ndata: tail'])).toEqual([{ event: 'a', data: 'tail' }])
  })
})

describe('decodeFrame', () => {
  it('decodes known events and rejects unknown ones / bad JSON', () => {
    expect(decodeFrame({ event: 'queue', data: '{"position":2}' })).toEqual({
      event: 'queue',
      data: { position: 2 },
    })
    expect(decodeFrame({ event: 'nope', data: '{}' })).toBeNull()
    expect(decodeFrame({ event: 'queue', data: '{oops' })).toBeNull()
  })
})

function streamOf(parts: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      parts.forEach((p) => c.enqueue(p))
      c.close()
    },
  })
}

describe('readSSE', () => {
  it('yields typed events and survives multi-byte characters split across chunks', async () => {
    const bytes = new TextEncoder().encode(
      ': ping\n\nevent: text.delta\ndata: {"index":1,"delta":"Việt Nam ếch"}\n\nevent: message.done\ndata: {"message":{"id":"1"}}\n\n',
    )
    // Split in the middle of a multi-byte sequence.
    const cut = bytes.indexOf(0xe1) + 1
    const events = []
    for await (const ev of readSSE(streamOf([bytes.slice(0, cut), bytes.slice(cut)])))
      events.push(ev)
    expect(events).toEqual([
      { event: 'text.delta', data: { index: 1, delta: 'Việt Nam ếch' } },
      { event: 'message.done', data: { message: { id: '1' } } },
    ])
  })

  it('cancels the reader when the consumer stops early', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        c.enqueue(new TextEncoder().encode('event: queue\ndata: {"position":1}\n\n'))
      },
      cancel() {
        cancelled = true
      },
    })
    for await (const ev of readSSE(body)) {
      expect(ev.event).toBe('queue')
      break
    }
    expect(cancelled).toBe(true)
  })
})
