import { cn } from '@/lib/utils'

/** Text with a light band sweeping across it (the "thinking…" look). */
export function ShimmerText({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <span data-testid="shimmer" className={cn('shimmer-text', className)}>
      {children}
    </span>
  )
}
