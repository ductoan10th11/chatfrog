import type { OrbState } from 'thinking-orbs'
import { Orb } from '@/components/Orb'
import { S } from '@/lib/strings'
import type { AssistantPhase } from '../reducer'

type Props = {
  phase: AssistantPhase
  /** Position in the LLM queue (null when not queued). */
  queuePosition: number | null
}

/**
 * One line under a streaming assistant message: orb + what is happening.
 * Orb state follows the phase: breathing (queued) -> solving (reasoning) -> composing (writing)
 * -> shaping (generating an image).
 */
export function StatusLine({ phase, queuePosition }: Props) {
  const queued = queuePosition !== null
  const state: OrbState = queued
    ? 'breathing'
    : phase === 'writing'
      ? 'composing'
      : phase === 'image'
        ? 'shaping'
        : 'solving'
  const label = queued
    ? S.chat.queued(queuePosition)
    : phase === 'writing'
      ? S.chat.writing
      : phase === 'image'
        ? S.tool.generating
        : S.chat.thinking

  return (
    <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <Orb state={state} size={20} />
      <span>{label}</span>
    </div>
  )
}
