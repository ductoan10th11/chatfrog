import { Loader2 } from 'lucide-react'
import { S } from '@/lib/strings'

export function FullScreenLoader() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex h-dvh items-center justify-center gap-2 text-sm text-muted-foreground"
    >
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {S.app.loading}
    </div>
  )
}
