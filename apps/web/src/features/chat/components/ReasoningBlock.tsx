import { useEffect, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Orb } from '@/components/Orb'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { S } from '@/lib/strings'
import { cn } from '@/lib/utils'
import type { ReasoningPart } from '@/types/api'

type Props = { part: ReasoningPart; active: boolean }

/**
 * Collapsible reasoning ("thinking"). Open while streaming so progress is visible,
 * then collapses on its own once done, unless the user toggled it.
 */
export function ReasoningBlock({ part, active }: Props) {
  const [override, setOverride] = useState<boolean | null>(null)
  const open = override ?? active
  const body = useRef<HTMLDivElement>(null)

  // Keep the newest reasoning text in view while it streams.
  useEffect(() => {
    if (active && body.current) body.current.scrollTop = body.current.scrollHeight
  }, [active, part.text])

  if (!active && !part.text.trim() && part.duration_ms === 0) return null

  const seconds = Math.max(1, Math.round(part.duration_ms / 1000))
  const label = active
    ? S.chat.thinking
    : part.duration_ms > 0
      ? S.chat.thoughtFor(seconds)
      : S.chat.thoughtBrief

  return (
    <Collapsible open={open} onOpenChange={setOverride}>
      <CollapsibleTrigger
        className="group flex items-center gap-2 rounded-md py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        aria-label={`${label}. ${S.chat.toggleReasoning}`}
      >
        {active && <Orb state="solving" size={20} />}
        <span aria-live={active ? 'polite' : undefined}>{label}</span>
        <ChevronRight
          className={cn('size-4 transition-transform', open && 'rotate-90')}
          aria-hidden
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div
          ref={body}
          className="mt-1 max-h-64 animate-in scrollbar-thin overflow-y-auto border-l-2 border-border pl-4 text-sm leading-6 whitespace-pre-wrap text-muted-foreground fade-in-0 slide-in-from-top-1"
        >
          {part.text}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
