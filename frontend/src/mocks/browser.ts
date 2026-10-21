import { setupWorker } from 'msw/browser'
import { resetDb } from './db'
import { handlers } from './handlers'

export const worker = setupWorker(...handlers)

/** Start the mock service worker. Called from main.tsx when VITE_MOCK=1. */
export async function startMocking() {
  await worker.start({
    onUnhandledRequest: 'bypass',
    serviceWorker: { url: '/mockServiceWorker.js' },
    quiet: true,
  })
  // Handy in the console: `__mockReset()` wipes the persisted mock database.
  ;(window as unknown as { __mockReset: () => void }).__mockReset = () => {
    resetDb()
    location.reload()
  }
  console.info('[ChatFrog] MSW mock API enabled (VITE_MOCK=1)')
}
