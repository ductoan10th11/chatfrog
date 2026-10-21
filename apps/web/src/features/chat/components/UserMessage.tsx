import { memo, useLayoutEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { S } from '@/lib/strings'
import type { Message } from '@/types/api'
import { AttachmentChip } from './AttachmentChip'
import { MessageActions } from './MessageActions'

type Props = {
  message: Message
  /** Editing is disabled while a generation is running. */
  canEdit: boolean
  onEdit: (message: Message, content: string, attachmentIds: string[]) => void
}

/** Memoized: unaffected by the frames of a streaming answer. */
export const UserMessage = memo(function UserMessage({ message, canEdit, onEdit }: Props) {
  const [editing, setEditing] = useState(false)
  const text = message.parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('\n\n')
  const attachments = message.parts.flatMap((p) => (p.type === 'attachment' ? [p.file] : []))

  if (editing) {
    return (
      <InlineEditor
        initial={text}
        onCancel={() => setEditing(false)}
        onSave={(content) => {
          setEditing(false)
          onEdit(
            message,
            content,
            attachments.map((f) => f.id),
          )
        }}
      />
    )
  }

  return (
    <article aria-label={S.chat.you} className="group/msg flex flex-col items-end gap-1">
      {attachments.length > 0 && (
        <div className="flex max-w-[85%] flex-wrap justify-end gap-2">
          {attachments.map((f) => (
            <AttachmentChip key={f.id} file={f} />
          ))}
        </div>
      )}
      {text && (
        <div className="max-w-[85%] rounded-2xl bg-surface px-4 py-2.5 text-[15px] leading-7 break-words whitespace-pre-wrap">
          {text}
        </div>
      )}
      <MessageActions copyText={text} onEdit={canEdit ? () => setEditing(true) : undefined} />
    </article>
  )
})

function InlineEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: string
  onSave: (content: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLTextAreaElement>(null)
  const trimmed = value.trim()

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`
  }, [value])

  useLayoutEffect(() => {
    const el = ref.current
    el?.focus()
    el?.setSelectionRange(el.value.length, el.value.length)
  }, [])

  const save = () => {
    if (trimmed) onSave(trimmed)
  }

  return (
    <div className="space-y-3 rounded-2xl border bg-surface p-3">
      <Textarea
        ref={ref}
        value={value}
        aria-label={S.chat.editLabel}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return // Vietnamese IME: Enter confirms the composition
          if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          } else if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            save()
          }
        }}
        className="min-h-20 resize-none bg-background text-[15px] leading-7"
      />
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{S.chat.editHint}</p>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {S.chat.editCancel}
          </Button>
          <Button size="sm" onClick={save} disabled={!trimmed}>
            {S.chat.editSave}
          </Button>
        </div>
      </div>
    </div>
  )
}
