import { setupServer } from 'msw/node'
import { resetDb } from '@/mocks/db'
import { createSeed } from '@/mocks/fixtures'
import { handlers } from '@/mocks/handlers'
import { mockConfig } from '@/mocks/utils'

export const server = setupServer(...handlers)

const realFetch = globalThis.fetch.bind(globalThis)

/** Use in a test file: starts MSW (node), resolves relative URLs, fast & deterministic. */
export function installMockApi() {
  beforeAll(() => {
    // Node's fetch needs absolute URLs; the app uses relative `/api/...`.
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (typeof input === 'string' && input.startsWith('/')) {
        input = new URL(input, window.location.origin).toString()
      }
      return realFetch(input, init)
    }) as typeof fetch
    server.listen({ onUnhandledRequest: 'error' })
  })
  beforeEach(() => {
    mockConfig.speed = 0
    resetDb(createSeed())
  })
  afterEach(() => server.resetHandlers())
  afterAll(() => {
    server.close()
    globalThis.fetch = realFetch
  })
}
