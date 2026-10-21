import { S } from '@/lib/strings'
import type { ApiErrorBody } from '@/types/api'

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  /** Seconds, from `Retry-After` (429). */
  readonly retryAfter?: number

  constructor(status: number, code: string, message: string, retryAfter?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.retryAfter = retryAfter
  }
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError

/** Human-readable message for any thrown value. */
export function errorMessage(e: unknown): string {
  if (isApiError(e)) return e.message || S.errors[e.code] || S.app.unknownError
  if (e instanceof TypeError) return S.app.networkError
  return S.app.unknownError
}

/** Turn a non-2xx response into an ApiError, tolerating non-JSON bodies. */
export async function toApiError(res: Response): Promise<ApiError> {
  let code = 'internal'
  let message: string = S.app.unknownError
  try {
    const body = (await res.json()) as Partial<ApiErrorBody>
    if (body.error) {
      code = body.error.code
      message = body.error.message || S.errors[code] || message
    }
  } catch {
    message = S.errors[codeFromStatus(res.status)] ?? message
    code = codeFromStatus(res.status)
  }
  const retry = Number(res.headers.get('Retry-After'))
  return new ApiError(
    res.status,
    code,
    message,
    Number.isFinite(retry) && retry > 0 ? retry : undefined,
  )
}

function codeFromStatus(status: number): string {
  switch (status) {
    case 400:
      return 'invalid_request'
    case 401:
      return 'unauthenticated'
    case 403:
      return 'forbidden'
    case 404:
      return 'not_found'
    case 409:
      return 'conflict'
    case 413:
      return 'payload_too_large'
    case 415:
      return 'unsupported_media_type'
    case 429:
      return 'rate_limited'
    default:
      return 'internal'
  }
}

export type RequestOptions = {
  method?: string
  body?: unknown
  query?: Record<string, string | number | boolean | undefined | null>
  signal?: AbortSignal
}

export function buildUrl(path: string, query?: RequestOptions['query']): string {
  if (!query) return path
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v))
  }
  const qs = params.toString()
  return qs ? `${path}?${qs}` : path
}

/** JSON fetch wrapper: cookies included, errors normalised to ApiError. */
export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, signal } = opts
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData
  const res = await fetch(buildUrl(path, query), {
    method,
    credentials: 'include',
    signal,
    headers: body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : undefined,
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  })
  if (!res.ok) throw await toApiError(res)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}
