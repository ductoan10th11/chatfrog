import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BorderBeam } from 'border-beam'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowUp, Paperclip, Square } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { errorMessage } from '@/lib/api'
import { usePrefersReducedMotion } from '@/lib/hooks'
import { S } from '@/lib/strings'
import { useResolvedTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import type { FileRef } from '@/types/api'
import {
  ACCEPT,
  deleteFile,
  isImageMime,
  MAX_ATTACHMENTS,
  uploadFile,
  validateFile,
} from '../attachments'
import type { GenerationResult } from '../generation'
import { ComposerAttachments, type PendingAttachment } from './ComposerAttachments'

const MAX_HEIGHT = 208
export const MAX_MESSAGE_CHARS = 16000

type Props = {
  /** A generation is running for this conversation: Send becomes Stop. */
  busy: boolean
  onSend: (text: string, attachments: FileRef[]) => Promise<GenerationResult>
  onStop: () => void
  /** Existing conversation id; omitted for a new chat. Uploads are tied to it. */
  conversationId?: string
  autoFocus?: boolean
  /** Changing this focuses the textarea again (e.g. conversation id). */
  focusKey?: string
  className?: string
}

let attachmentSeq = 0

const objectUrl = (file: File) =>
  typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : undefined
const revoke = (url?: string) => {
  if (url && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url)
}

export function Composer({
  busy,
  onSend,
  onStop,
  conversationId,
  autoFocus = true,
  focusKey,
  className,
}: Props) {
  const [value, setValue] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  const resolved = useResolvedTheme()
  const reduced = usePrefersReducedMotion()
  const fileInput = useRef<HTMLInputElement>(null)
  const [items, setItems] = useState<PendingAttachment[]>([])
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const controllers = useRef(new Map<string, AbortController>())
  const itemsRef = useRef(items)
  const uploading = items.some((i) => i.status === 'uploading')
  const canSend = value.trim().length > 0 && !busy && !uploading

  // Uploads are tied to a conversation: drop pending chips when it changes.
  const [prevConversation, setPrevConversation] = useState(conversationId)
  if (prevConversation !== conversationId) {
    setPrevConversation(conversationId)
    setItems([])
  }

  useEffect(() => {
    itemsRef.current = items
  }, [items])

  // On conversation change / unmount: cancel uploads and free previews.
  useEffect(() => {
    const running = controllers.current
    return () => {
      for (const c of running.values()) c.abort()
      running.clear()
      for (const i of itemsRef.current) revoke(i.previewUrl)
    }
  }, [conversationId])

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

  function startUpload(file: File) {
    const key = `att-${attachmentSeq++}`
    const previewUrl = isImageMime(file.type) ? objectUrl(file) : undefined
    const controller = new AbortController()
    controllers.current.set(key, controller)
    setItems((prev) => [
      ...prev,
      { key, name: file.name, size: file.size, mime: file.type, status: 'uploading', previewUrl },
    ])
    uploadFile(file, conversationId, controller.signal)
      .then((uploaded) => {
        controllers.current.delete(key)
        revoke(previewUrl)
        setItems((prev) =>
          prev.map((i) =>
            i.key === key ? { ...i, status: 'done', file: uploaded, previewUrl: undefined } : i,
          ),
        )
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return
        controllers.current.delete(key)
        const message = errorMessage(e)
        toast.error(message)
        setItems((prev) =>
          prev.map((i) => (i.key === key ? { ...i, status: 'error', error: message } : i)),
        )
      })
  }

  function addFiles(files: File[]) {
    let slots = MAX_ATTACHMENTS - items.filter((i) => i.status !== 'error').length
    for (const file of files) {
      const problem = validateFile(file)
      if (problem) {
        toast.error(problem)
        continue
      }
      if (slots <= 0) {
        toast.error(S.composer.tooManyFiles)
        break
      }
      slots--
      startUpload(file)
    }
    ref.current?.focus()
  }

  function removeItem(key: string) {
    const item = items.find((i) => i.key === key)
    if (!item) return
    controllers.current.get(key)?.abort()
    controllers.current.delete(key)
    revoke(item.previewUrl)
    if (item.file) void deleteFile(item.file.id)
    setItems((prev) => prev.filter((i) => i.key !== key))
  }

  async function submit() {
    const text = value.trim()
    if (!text || busy || uploading) return
    const attachments = items.flatMap((i) => (i.status === 'done' && i.file ? [i.file] : []))
    for (const i of items) revoke(i.previewUrl)
    setValue('')
    setItems([])
    const result = await onSend(text, attachments)
    // Request rejected before the server accepted it: give text and files back.
    if (!result.created) {
      setValue((cur) => cur || text)
      if (attachments.length) {
        setItems((cur) => [
          ...attachments.map<PendingAttachment>((file) => ({
            key: `att-${attachmentSeq++}`,
            name: file.name,
            size: file.size,
            mime: file.mime,
            status: 'done',
            file,
          })),
          ...cur,
        ])
      }
    }
    ref.current?.focus()
  }

  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files')

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
          onDragEnter={(e) => {
            if (!hasFiles(e)) return
            e.preventDefault()
            dragDepth.current++
            setDragging(true)
          }}
          onDragOver={(e) => {
            if (!hasFiles(e)) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
          }}
          onDragLeave={(e) => {
            if (!hasFiles(e)) return
            dragDepth.current = Math.max(0, dragDepth.current - 1)
            if (dragDepth.current === 0) setDragging(false)
          }}
          onDrop={(e) => {
            if (!hasFiles(e)) return
            e.preventDefault()
            dragDepth.current = 0
            setDragging(false)
            addFiles(Array.from(e.dataTransfer.files))
          }}
          className={cn(
            'relative flex flex-col gap-1 rounded-3xl border bg-background p-2 shadow-sm transition-colors focus-within:border-ring/60',
            dragging && 'border-primary bg-primary/5 ring-2 ring-primary/40',
          )}
        >
          <ComposerAttachments items={items} onRemove={removeItem} reduced={reduced} />
          <div className="flex items-end gap-1">
            <input
              ref={fileInput}
              type="file"
              multiple
              accept={ACCEPT}
              tabIndex={-1}
              aria-hidden
              data-testid="composer-file-input"
              className="hidden"
              onChange={(e) => {
                addFiles(Array.from(e.target.files ?? []))
                e.target.value = '' // allow picking the same file again
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-9 shrink-0 rounded-full"
              aria-label={S.composer.attach}
              title={S.composer.attach}
              onClick={() => fileInput.current?.click()}
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
              onPaste={(e) => {
                // Pasted images become attachments; mixed text+image clipboards keep pasting text.
                if (e.clipboardData.getData('text/plain')) return
                const images = Array.from(e.clipboardData.files).filter((f) => isImageMime(f.type))
                if (!images.length) return
                e.preventDefault()
                addFiles(images)
              }}
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

            <SendStopButton
              busy={busy}
              canSend={canSend}
              waiting={uploading}
              onStop={onStop}
              reduced={reduced}
            />
          </div>
          {dragging && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-3xl bg-background/80 text-sm font-medium text-primary"
            >
              {S.composer.dropHint}
            </div>
          )}
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
  waiting,
  onStop,
  reduced,
}: {
  busy: boolean
  canSend: boolean
  waiting: boolean
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
      title={busy ? S.composer.stop : waiting ? S.composer.sendWaitUpload : S.composer.send}
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
