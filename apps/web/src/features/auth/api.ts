import { api, isApiError } from '@/lib/api'
import type { User } from '@/types/api'

/** `null` when not signed in (401). */
export async function fetchMe(): Promise<User | null> {
  try {
    return await api<User>('/api/me')
  } catch (e) {
    if (isApiError(e) && e.status === 401) return null
    throw e
  }
}

export const logout = () => api<void>('/api/auth/logout', { method: 'POST' })

/** Mock-only helper: flips the simulated auth state (see src/mocks/handlers.ts). */
export const setMockAuth = (state: 'active' | 'anon' | 'pending' | 'blocked') =>
  api<void>('/api/__mock/auth', { method: 'POST', body: { state } })

/** Only same-origin relative paths are allowed as post-login redirects. */
export function safeRedirect(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/'
  return value
}
