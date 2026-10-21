import { useRef, useState } from 'react'
import { Link } from 'react-router'
import { MoreHorizontal, Pencil, Pin, PinOff, Trash2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { S } from '@/lib/strings'
import { cn } from '@/lib/utils'
import type { Conversation } from '@/types/api'
import { useDeleteConversation, useUpdateConversation } from './queries'

type Props = {
  conversation: Conversation
  active: boolean
  onNavigate?: () => void
  /** Called after this conversation is deleted. */
  onDeleted?: (id: string) => void
}

export function ConversationItem({ conversation, active, onNavigate, onDeleted }: Props) {
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const update = useUpdateConversation()
  const remove = useDeleteConversation(onDeleted)
  const title = conversation.title || S.nav.untitled

  if (editing) {
    return (
      <RenameField
        initial={conversation.title}
        onDone={(next) => {
          setEditing(false)
          if (next !== null && next !== conversation.title)
            update.mutate({ id: conversation.id, title: next })
        }}
      />
    )
  }

  return (
    <div
      className={cn(
        'group relative flex items-center rounded-lg transition-colors',
        active ? 'bg-primary-soft' : 'hover:bg-muted',
      )}
    >
      <Link
        to={`/c/${conversation.id}`}
        onClick={onNavigate}
        aria-current={active ? 'page' : undefined}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-lg py-2 pr-9 pl-3 text-sm"
      >
        {conversation.pinned && (
          <Pin className="size-3 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <span className={cn('truncate', !conversation.title && 'text-muted-foreground')}>
          {title}
        </span>
      </Link>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`${S.conversation.actions}: ${title}`}
            className={cn(
              'absolute right-1 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100 [@media(hover:none)]:opacity-100',
              active && 'opacity-100',
            )}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <Pencil /> {S.conversation.rename}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => update.mutate({ id: conversation.id, pinned: !conversation.pinned })}
          >
            {conversation.pinned ? <PinOff /> : <Pin />}
            {conversation.pinned ? S.conversation.unpin : S.conversation.pin}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirming(true)}>
            <Trash2 /> {S.conversation.delete}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{S.conversation.deleteTitle}</AlertDialogTitle>
            <AlertDialogDescription>{S.conversation.deleteBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{S.app.cancel}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => remove.mutate(conversation.id)}>
              {S.conversation.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** Inline rename. Enter / blur commits, Escape cancels. IME-safe. */
function RenameField({
  initial,
  onDone,
}: {
  initial: string
  /** `null` = cancelled / unchanged. */
  onDone: (next: string | null) => void
}) {
  const [value, setValue] = useState(initial)
  const finished = useRef(false)

  const finish = (commit: boolean) => {
    if (finished.current) return
    finished.current = true
    const next = value.trim()
    onDone(commit && next ? next : null)
  }

  return (
    <Input
      autoFocus
      value={value}
      maxLength={200}
      aria-label={S.conversation.renameInput}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return
        if (e.key === 'Enter') {
          e.preventDefault()
          finish(true)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          finish(false)
        }
      }}
      className="h-9"
    />
  )
}
