/** Small helpers shared by the mock API. */

export const mockConfig = {
  /** Multiplier for simulated latency. Tests set this to 0. */
  speed: 1,
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  const t = ms * mockConfig.speed
  if (t <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve()
    const timer = setTimeout(done, t)
    function done() {
      signal?.removeEventListener('abort', done)
      clearTimeout(timer)
      resolve()
    }
    signal?.addEventListener('abort', done, { once: true })
  })
}

let counter = Math.floor(Math.random() * 0xffffff)

/** 24-char hex id shaped like a Mongo ObjectID. */
export function newId(): string {
  const ts = Math.floor(Date.now() / 1000)
    .toString(16)
    .padStart(8, '0')
  const rand = Array.from({ length: 10 }, () => Math.floor(Math.random() * 16).toString(16)).join(
    '',
  )
  counter = (counter + 1) & 0xffffff
  return ts + rand + counter.toString(16).padStart(6, '0')
}

export const nowIso = () => new Date().toISOString()

export function encodeCursor(n: number): string {
  return btoa(`o:${n}`)
}

export function decodeCursor(cursor: string | null | undefined): number | null {
  if (!cursor) return null
  try {
    const m = /^o:(\d+)$/.exec(atob(cursor))
    return m ? Number(m[1]) : null
  } catch {
    return null
  }
}

/** Lowercase + strip Vietnamese diacritics, for forgiving search. */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase()
}

export function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
