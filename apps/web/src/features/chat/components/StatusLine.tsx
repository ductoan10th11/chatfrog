import { ShimmerText } from '@/components/ShimmerText'
import { S } from '@/lib/strings'
import type { AssistantPhase } from '../reducer'

type Props = {
  phase: AssistantPhase
  /** Position in the LLM queue (null when not queued). */
  queuePosition: number | null
}

/** One line under a streaming assistant message: what is happening, as shimmering text. */
export function StatusLine({ phase, queuePosition }: Props) {
  const label =
    queuePosition !== null
      ? S.chat.queued(queuePosition)
      : phase === 'writing'
        ? S.chat.writing
        : phase === 'image'
          ? S.tool.generating
          : S.chat.thinking

  return (
    <div role="status" className="text-sm">
      <ShimmerText>{label}</ShimmerText>
    </div>
  )
}
