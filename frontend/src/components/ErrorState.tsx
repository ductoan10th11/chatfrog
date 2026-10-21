import { TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { S } from '@/lib/strings'
import { cn } from '@/lib/utils'

type Props = {
  message?: string
  onRetry?: () => void
  className?: string
  children?: React.ReactNode
}

export function ErrorState({ message = S.app.unknownError, onRetry, className, children }: Props) {
  return (
    <div
      role="alert"
      className={cn(
        'flex h-full min-h-48 flex-col items-center justify-center gap-3 p-6 text-center',
        className,
      )}
    >
      <TriangleAlert className="size-6 text-muted-foreground" aria-hidden />
      <p className="max-w-sm text-sm text-muted-foreground">{message}</p>
      {onRetry && (
        <Button variant="outline" onClick={onRetry}>
          {S.app.retry}
        </Button>
      )}
      {children}
    </div>
  )
}
