import { useEffect, useState } from 'react'
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ME_KEY } from '@/features/auth/useMe'
import { isApiError } from '@/lib/api'
import { watchSystemTheme } from '@/lib/theme'

function createQueryClient() {
  const qc: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        // Session expired somewhere in the app: re-check /api/me so the guard redirects.
        if (isApiError(error) && error.status === 401 && query.queryKey[0] !== 'me') {
          void qc.invalidateQueries({ queryKey: ME_KEY })
        }
      },
    }),
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: (count, error) => !(isApiError(error) && error.status < 500) && count < 2,
      },
    },
  })
  return qc
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(createQueryClient)
  useEffect(() => watchSystemTheme(), [])
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
      <Toaster position="top-center" />
    </QueryClientProvider>
  )
}
