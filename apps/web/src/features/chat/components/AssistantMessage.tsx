import { memo } from 'react'
import { AlertCircle, CircleStop } from 'lucide-react'
import { S } from '@/lib/strings'
import type { Message } from '@/types/api'
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'
import { currentPhase, messageText } from '../reducer'
import { MessageActions } from './MessageActions'
import { ReasoningBlock } from './ReasoningBlock'
import { StatusLine } from './StatusLine'
import { ToolCallCard } from './ToolCallCard'

type Props = {
  message: Message
  /** This message is being generated right now. */
  live: boolean
  queuePosition: number | null
  /** Show the regenerate action (last assistant message, nothing running). */
  canRegenerate: boolean
  onRegenerate: (message: Message) => void
}

/** Memoized: while streaming, only the live message re-renders on each frame. */
export const AssistantMessage = memo(function AssistantMessage({
  message,
  live,
  queuePosition,
  canRegenerate,
  onRegenerate,
}: Props) {
  const phase = currentPhase(message)
  const last = message.parts.length - 1
  // While reasoning, the reasoning block carries its own orb, so the status line is redundant.
  const showStatus = live && (queuePosition !== null || phase !== 'reasoning')

  return (
    <article aria-label={S.chat.assistant} aria-busy={live} className="group/msg space-y-3">
      {message.parts.map((part, i) => {
        switch (part.type) {
          case 'reasoning':
            return (
              <ReasoningBlock
                key={i}
                part={part}
                active={live && i === last && part.duration_ms === 0}
              />
            )
          case 'text':
            return part.text ? <MarkdownRenderer key={i}>{part.text}</MarkdownRenderer> : null
          case 'tool_call':
            return <ToolCallCard key={part.id} part={part} interrupted={!live} />
          default:
            return null
        }
      })}

      {showStatus && <StatusLine phase={phase} queuePosition={queuePosition} />}

      {message.status === 'stopped' && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CircleStop className="size-4" aria-hidden /> {S.chat.stopped}
        </p>
      )}
      {message.status === 'error' && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">{S.chat.errorTitle}</p>
            <p className="opacity-90">{message.error?.message || S.chat.errorGeneric}</p>
          </div>
        </div>
      )}

      {!live && (
        <MessageActions
          copyText={messageText(message)}
          onRegenerate={canRegenerate ? () => onRegenerate(message) : undefined}
          persistent={canRegenerate}
        />
      )}
    </article>
  )
})
