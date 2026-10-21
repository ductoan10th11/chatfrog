import { ThinkingOrb, type OrbSize, type OrbState } from 'thinking-orbs'
import { cn } from '@/lib/utils'

type Props = {
  state: OrbState
  size?: OrbSize
  /** Rendered CSS size in px (the canvas is scaled from the 64px design). */
  displaySize?: number
  className?: string
}

/**
 * Monochrome thinking orb (libraries.dev). It follows the `.dark` class by itself and renders
 * a still frame under `prefers-reduced-motion`. Decorative: the adjacent text carries the meaning.
 */
export function Orb({ state, size = 20, displaySize, className }: Props) {
  return (
    <ThinkingOrb
      state={state}
      size={size}
      theme="auto"
      aria-hidden
      className={cn('shrink-0', className)}
      style={displaySize ? { width: displaySize, height: displaySize } : undefined}
    />
  )
}
