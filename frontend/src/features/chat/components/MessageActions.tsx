import { Check, Copy, Pencil, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCopy } from '@/lib/useCopy'
import { S } from '@/lib/strings'
import { cn } from '@/lib/utils'

type Props = {
  /** Text to copy; the copy button is hidden when empty. */
  copyText?: string
  onRegenerate?: () => void
  onEdit?: () => void
  /** Always visible (last message / touch) instead of revealing on hover. */
  persistent?: boolean
  className?: string
}

export function MessageActions({ copyText, onRegenerate, onEdit, persistent, className }: Props) {
  const { copied, copy } = useCopy()
  return (
    <div
      role="toolbar"
      aria-label={S.chat.messageActions}
      className={cn(
        'flex items-center gap-0.5 text-muted-foreground transition-opacity',
        !persistent &&
          'opacity-0 group-focus-within/msg:opacity-100 group-hover/msg:opacity-100 [@media(hover:none)]:opacity-100',
        className,
      )}
    >
      {copyText ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={copied ? S.chat.copied : S.chat.copy}
          title={S.chat.copy}
          onClick={() => void copy(copyText)}
        >
          {copied ? <Check /> : <Copy />}
        </Button>
      ) : null}
      {onEdit && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={S.chat.edit}
          title={S.chat.edit}
          onClick={onEdit}
        >
          <Pencil />
        </Button>
      )}
      {onRegenerate && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={S.chat.regenerate}
          title={S.chat.regenerate}
          onClick={onRegenerate}
        >
          <RefreshCw />
        </Button>
      )}
    </div>
  )
}
