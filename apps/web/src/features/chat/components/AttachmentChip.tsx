import { useState } from 'react'
import { FileText } from 'lucide-react'
import { ImageViewer } from '@/components/ImageViewer'
import { S } from '@/lib/strings'
import type { FileRef } from '@/types/api'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Attachment shown inside a user message: image preview or a document chip. */
export function AttachmentChip({ file }: { file: FileRef }) {
  if (file.mime.startsWith('image/')) return <ImageAttachment file={file} />
  return (
    <a
      href={file.url}
      download={file.name}
      className="flex max-w-full items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm"
    >
      <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="truncate">{file.name}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{formatSize(file.size)}</span>
    </a>
  )
}

function ImageAttachment({ file }: { file: FileRef }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`${S.viewer.open}: ${file.name}`}
        className="block cursor-zoom-in overflow-hidden rounded-xl border"
      >
        <img
          src={file.url}
          alt={file.name}
          loading="lazy"
          className="max-h-48 w-auto object-cover"
        />
      </button>
      <ImageViewer file={file} open={open} onOpenChange={setOpen} />
    </>
  )
}
