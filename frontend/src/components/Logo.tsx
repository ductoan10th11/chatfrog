import { cn } from '@/lib/utils'

/** Small ChatFrog mark (same artwork as the favicon). */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={cn('size-7', className)}>
      <rect width="64" height="64" rx="16" fill="var(--primary)" />
      <circle cx="22" cy="26" r="9" fill="#fff" />
      <circle cx="42" cy="26" r="9" fill="#fff" />
      <circle cx="23" cy="27" r="4" fill="var(--primary-foreground)" />
      <circle cx="41" cy="27" r="4" fill="var(--primary-foreground)" />
      <path
        d="M16 42c5 7 27 7 32 0"
        fill="none"
        stroke="var(--primary-foreground)"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  )
}
