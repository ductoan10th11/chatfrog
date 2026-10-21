import { AnimatePresence, motion } from 'motion/react'
import { AlertCircle, FileText, Loader2, TriangleAlert, X } from 'lucide-react'
import { S } from '@/lib/strings'
import { cn } from '@/lib/utils'
import type { FileRef } from '@/types/api'
import { formatSize, isImageMime } from '../attachments'

export type PendingAttachment = {
  key: string
  name: string
  size: number
  mime: string
  status: 'uploading' | 'done' | 'error'
  /** Object URL shown while uploading (revoked by the owner). */
  previewUrl?: string
  /** Set once the upload succeeded. */
  file?: FileRef
  error?: string
}

type Props = {
  items: PendingAttachment[]
  onRemove: (key: string) => void
  reduced: boolean
}

/** Chips above the textarea: image thumbnails and document chips with spinner / error / remove. */
export function ComposerAttachments({ items, onRemove, reduced }: Props) {
  const t = reduced ? { duration: 0 } : { type: 'spring' as const, stiffness: 500, damping: 34 }
  return (
    <ul aria-label={S.composer.attachments} className="flex flex-wrap gap-2 px-2 pt-1 empty:hidden">
      <AnimatePresence initial={false}>
        {items.map((item) => (
          <motion.li
            key={item.key}
            layout={!reduced}
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={t}
            className="relative max-w-full"
          >
            <Chip item={item} />
            <button
              type="button"
              onClick={() => onRemove(item.key)}
              aria-label={S.composer.removeAttachment(item.name)}
              title={S.composer.removeAttachment(item.name)}
              className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <X className="size-3" aria-hidden />
            </button>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  )
}

function StatusOverlay({ item }: { item: PendingAttachment }) {
  if (item.status === 'uploading') {
    return (
      <span
        role="status"
        aria-label={S.composer.uploading}
        className="absolute inset-0 flex items-center justify-center bg-background/60"
      >
        <Loader2 className="size-5 animate-spin text-muted-foreground motion-reduce:animate-none" />
      </span>
    )
  }
  if (item.status === 'error') {
    return (
      <span
        role="img"
        aria-label={item.error ?? S.composer.uploadFailed}
        className="absolute inset-0 flex items-center justify-center bg-destructive/10"
      >
        <AlertCircle className="size-5 text-destructive" />
      </span>
    )
  }
  return null
}

function Chip({ item }: { item: PendingAttachment }) {
  const failed = item.status === 'error'
  if (isImageMime(item.mime)) {
    const src = item.previewUrl ?? (item.file ? `${item.file.url}/thumb` : undefined)
    return (
      <div
        title={failed ? (item.error ?? S.composer.uploadFailed) : item.name}
        className={cn(
          'relative size-14 overflow-hidden rounded-xl border bg-muted',
          failed && 'border-destructive',
        )}
      >
        {src && <img src={src} alt={item.name} className="size-full object-cover" />}
        <StatusOverlay item={item} />
      </div>
    )
  }
  const truncated = item.status === 'done' && item.file?.truncated
  return (
    <div
      title={failed ? (item.error ?? S.composer.uploadFailed) : item.name}
      className={cn(
        'relative flex h-14 max-w-60 items-center gap-2 overflow-hidden rounded-xl border bg-muted/40 py-1.5 pr-3 pl-2.5',
        failed && 'border-destructive',
      )}
    >
      <FileText className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 text-left text-xs leading-4">
        <span className="block truncate font-medium">{item.name}</span>
        {failed ? (
          <span className="block truncate text-destructive">{S.composer.uploadFailed}</span>
        ) : truncated ? (
          <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
            <TriangleAlert className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{S.composer.truncatedWarning}</span>
          </span>
        ) : (
          <span className="block text-muted-foreground">{formatSize(item.size)}</span>
        )}
      </span>
      {item.status === 'uploading' && (
        <Loader2
          role="status"
          aria-label={S.composer.uploading}
          className="size-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
        />
      )}
    </div>
  )
}
