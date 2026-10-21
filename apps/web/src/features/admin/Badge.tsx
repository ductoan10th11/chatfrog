import { cn } from '@/lib/utils'

type Tone = 'ok' | 'neutral' | 'danger'

const TONES: Record<Tone, string> = {
  ok: 'border-primary/50 bg-primary-soft text-foreground',
  neutral: 'border-border bg-muted text-muted-foreground',
  danger: 'border-destructive/40 bg-destructive/10 text-destructive',
}

export function Badge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: Tone
  className?: string
  children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
