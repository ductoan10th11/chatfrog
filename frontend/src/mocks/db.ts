import type { FileRef, Message } from '@/types/api'
import { createSeed, type DbState } from './fixtures'

const STORAGE_KEY = 'cf-mock-db-v1'

let state: DbState | null = null
/** Uploaded bytes, memory only (a reload drops them; metadata survives). */
export const blobs = new Map<string, Blob>()
/** Conversations with a generation currently running (409 on a second one). */
export const activeGenerations = new Set<string>()

function load(): DbState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DbState
    if (parsed.version !== 1) return null
    // A message left "streaming" by a reload can never finish: mark it stopped.
    for (const list of Object.values(parsed.messages)) {
      for (const m of list) if (m.status === 'streaming') m.status = 'stopped'
    }
    return parsed
  } catch {
    return null
  }
}

export function db(): DbState {
  if (!state) state = load() ?? createSeed()
  return state
}

export function persist() {
  if (!state) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* quota or blocked storage: keep going in memory */
  }
}

/** Reset to a fresh seed (tests, and `window.__mockReset()` in the browser). */
export function resetDb(seed: DbState = createSeed()) {
  state = seed
  blobs.clear()
  activeGenerations.clear()
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

export function findMessage(
  id: string,
): { message: Message; list: Message[]; index: number } | null {
  const s = db()
  for (const list of Object.values(s.messages)) {
    const index = list.findIndex((m) => m.id === id)
    if (index >= 0) return { message: list[index], list, index }
  }
  return null
}

export function allFiles(): Record<string, FileRef & { prompt?: string }> {
  return db().files
}
