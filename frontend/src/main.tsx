import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Toaster } from '@/components/ui/sonner'
import { S } from '@/lib/strings'
import { watchSystemTheme } from '@/lib/theme'
import './index.css'

watchSystemTheme()

async function enableMocking() {
  if (import.meta.env.VITE_MOCK === '1') {
    const { startMocking } = await import('@/mocks/browser')
    await startMocking()
  }
}

void enableMocking().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <div className="flex h-full items-center justify-between p-4">
        <h1 className="text-xl font-semibold">{S.app.name}</h1>
        <ThemeToggle />
      </div>
      <Toaster />
    </StrictMode>,
  )
})
