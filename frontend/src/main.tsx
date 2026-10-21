import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { Providers } from '@/app/providers'
import { createRouter } from '@/app/router'
import './index.css'

async function enableMocking() {
  if (import.meta.env.VITE_MOCK === '1') {
    const { startMocking } = await import('@/mocks/browser')
    await startMocking()
  }
}

void enableMocking().then(() => {
  const router = createRouter()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Providers>
        <RouterProvider router={router} />
      </Providers>
    </StrictMode>,
  )
})
