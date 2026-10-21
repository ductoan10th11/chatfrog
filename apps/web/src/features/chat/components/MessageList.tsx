import { useEffect, useRef } from 'react'
import { StickToBottom, useStickToBottomContext } from 'use-stick-to-bottom'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowDown, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { S } from '@/lib/strings'
import type { Message } from '@/types/api'
import type { DisplayItem } from '../display'
import { AssistantMessage } from './AssistantMessage'
import { UserMessage } from './UserMessage'

type Props = {
  items: DisplayItem[]
  queuePosition: number | null
  /** Id of the assistant message that can be regenerated (none while generating). */
  regenerableId: string | null
  /** A generation is running: editing is disabled. */
  busy: boolean
  hasOlder: boolean
  loadingOlder: boolean
  onLoadOlder: () => void
  onRegenerate: (message: Message) => void
  onEdit: (message: Message, content: string, attachmentIds: string[]) => void
}

export function MessageList({
  items,
  queuePosition,
  regenerableId,
  busy,
  hasOlder,
  loadingOlder,
  onLoadOlder,
  onRegenerate,
  onEdit,
}: Props) {
  return (
    <StickToBottom
      className="relative h-full"
      // While tokens stream in (hundreds per second) a spring animation trails behind the
      // growing content; follow it instantly, keep the smooth spring for other resizes.
      resize={busy ? 'instant' : 'smooth'}
      initial="instant"
      role="region"
      aria-label={S.chat.messages}
    >
      <StickToBottom.Content
        scrollClassName="scrollbar-thin"
        className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6"
      >
        <OlderSentinel active={hasOlder} loading={loadingOlder} onVisible={onLoadOlder} />
        {items.map((item) =>
          item.message.role === 'user' ? (
            <UserMessage key={item.key} message={item.message} canEdit={!busy} onEdit={onEdit} />
          ) : (
            <AssistantMessage
              key={item.key}
              message={item.message}
              live={item.live}
              queuePosition={item.live ? queuePosition : null}
              canRegenerate={item.message.id === regenerableId}
              onRegenerate={onRegenerate}
            />
          ),
        )}
      </StickToBottom.Content>
      <ScrollToBottomButton />
    </StickToBottom>
  )
}

function OlderSentinel({
  active,
  loading,
  onVisible,
}: {
  active: boolean
  loading: boolean
  onVisible: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || !active || loading) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onVisible()
      },
      { rootMargin: '300px 0px 0px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [active, loading, onVisible])

  if (!active && !loading) return null
  return (
    <div ref={ref} className="flex justify-center py-1 text-muted-foreground" role="status">
      <Loader2 className="size-4 animate-spin" aria-label={S.conversation.loadOlder} />
    </div>
  )
}

function ScrollToBottomButton() {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext()
  return (
    <AnimatePresence>
      {!isAtBottom && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.15 }}
          className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center"
        >
          <Button
            variant="outline"
            size="icon"
            className="pointer-events-auto size-9 rounded-full bg-background shadow-md"
            aria-label={S.chat.scrollToBottom}
            title={S.chat.scrollToBottom}
            onClick={() => void scrollToBottom()}
          >
            <ArrowDown />
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
