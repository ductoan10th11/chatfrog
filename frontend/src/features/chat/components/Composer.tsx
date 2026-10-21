import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BorderBeam } from 'border-beam'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowUp, Paperclip, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePrefersReducedMotion } from '@/lib/hooks'
import { S } from '@/lib/strings'
import { useResolvedTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import type { GenerationResult } from '../generation'

const MAX_HEIGHT = 208
export const MAX_MESSAGE_CHARS = 16000

type Props = {
  /** A generation is running for this conversation: Send becomes Stop. */
  busy: boolean
  onSend: (text: string) => Promise<GenerationResult>
  onStop: () => void
  autoFocus?: boolean
  /** Changing this focuses the textarea again (e.g. conversation id). */
  focusKey?: string
  className?: string
}

export function Composer({ busy, onSend, onStop, autoFocus = true, focusKey, className }: Props) {
  const [value, setValue] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  const resolved = useResolvedTheme()
  const reduced = usePrefersReducedMotion()
  const canSend = value.trim().length > 0 && !busy

  // Autosize up to MAX_HEIGHT, then scroll.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`
  }, [value])

  useEffect(() => {
    if (autoFocus) ref.current?.focus()
  }, [autoFocus, focusKey])

  async function submit() {
    const text = value.trim()
    if (!text || busy) return
    setValue('')
    const result = await onSend(text)
    // Request rejected before the server accepted it: give the text back.
    if (!result.created) setValue((cur) => cur || text)
    ref.current?.focus()
  }

  return (
    <div
      className={cn(
        'mx-auto w-full max-w-3xl px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]',
        className,
      )}
    >
      <BorderBeam
        active={busy && !reduced}
        size="md"
        // The package's "forest" palette is the only all-green one; "ocean" would need a hue rotation.
        colorVariant="forest"
        theme={resolved}
        strength={1}
        saturation={0.9}
        hueRange={8}
        borderRadius={24}
        className="rounded-3xl"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
          className="flex items-end gap-1 rounded-3xl border bg-background p-2 shadow-sm transition-colors focus-within:border-ring/60"
        >
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 shrink-0 rounded-full"
            aria-label={S.composer.attach}
            title={S.composer.attach}
            disabled
          >
            <Paperclip />
          </Button>

          <textarea
            ref={ref}
            value={value}
            rows={1}
            maxLength={MAX_MESSAGE_CHARS}
            aria-label={S.composer.label}
            placeholder={S.composer.placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter inserts a newline. Never send while an IME
              // (Vietnamese Telex/VNI) composition is in progress; keyCode 229 covers Safari.
              if (e.key !== 'Enter' || e.shiftKey) return
              if (e.nativeEvent.isComposing || e.keyCode === 229) return
              e.preventDefault()
              void submit()
            }}
            className="max-h-52 min-h-9 flex-1 resize-none scrollbar-thin bg-transparent px-2 py-1.5 text-[15px] leading-6 outline-none placeholder:text-muted-foreground"
          />

          <SendStopButton busy={busy} canSend={canSend} onStop={onStop} reduced={reduced} />
        </form>
      </BorderBeam>
      <p className="mt-2 text-center text-xs text-muted-foreground">{S.composer.disclaimer}</p>
    </div>
  )
}

/**
 * Send <-> Stop. A plain motion transition for now; the libraries.dev "liquid-gooey" morph
 * is planned for the polish step.
 */
function SendStopButton({
  busy,
  canSend,
  onStop,
  reduced,
}: {
  busy: boolean
  canSend: boolean
  onStop: () => void
  reduced: boolean
}) {
  const t = reduced ? { duration: 0 } : { type: 'spring' as const, stiffness: 500, damping: 30 }
  return (
    <Button
      type={busy ? 'button' : 'submit'}
      size="icon"
      className="size-9 shrink-0 overflow-hidden rounded-full"
      aria-label={busy ? S.composer.stop : S.composer.send}
      title={busy ? S.composer.stop : S.composer.send}
      disabled={!busy && !canSend}
      onClick={busy ? onStop : undefined}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={busy ? 'stop' : 'send'}
          initial={{ scale: 0.4, opacity: 0, rotate: -45 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          exit={{ scale: 0.4, opacity: 0, rotate: 45 }}
          transition={t}
          className="flex"
        >
          {busy ? <Square className="size-3.5 fill-current" /> : <ArrowUp className="size-4.5" />}
        </motion.span>
      </AnimatePresence>
    </Button>
  )
}
