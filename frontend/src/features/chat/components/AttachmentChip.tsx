import { FileText } from 'lucide-react'
import type { FileRef } from '@/types/api'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Attachment shown inside a user message: image preview or a document chip. */
export function AttachmentChip({ file }: { file: FileRef }) {
  if (file.mime.startsWith('image/')) {
    return (
      <a
        href={file.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block overflow-hidden rounded-xl border"
      >
        <img
          src={file.url}
          alt={file.name}
          loading="lazy"
          className="max-h-48 w-auto object-cover"
        />
      </a>
    )
  }
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
