import { api } from '@/lib/api'
import { S } from '@/lib/strings'
import type { FileRef } from '@/types/api'

export const MAX_ATTACHMENTS = 5
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_DOC_BYTES = 20 * 1024 * 1024

const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp']
const DOC_EXTENSIONS = [
  'pdf',
  'docx',
  'txt',
  'md',
  'csv',
  'json',
  'ts',
  'tsx',
  'js',
  'jsx',
  'py',
  'go',
  'rs',
  'java',
  'c',
  'cpp',
  'h',
  'sh',
  'yaml',
  'yml',
  'html',
  'css',
  'sql',
]

/** Value for `<input type="file" accept>`. */
export const ACCEPT = [...IMAGE_MIMES, ...DOC_EXTENSIONS.map((e) => `.${e}`)].join(',')

export const isImageMime = (mime: string) => IMAGE_MIMES.includes(mime)

function extension(name: string): string {
  const i = name.lastIndexOf('.')
  return i === -1 ? '' : name.slice(i + 1).toLowerCase()
}

/** Client-side check; returns a Vietnamese error message or null when the file is acceptable. */
export function validateFile(file: Pick<File, 'name' | 'size' | 'type'>): string | null {
  if (isImageMime(file.type)) {
    return file.size > MAX_IMAGE_BYTES ? S.composer.imageTooLarge(file.name) : null
  }
  if (DOC_EXTENSIONS.includes(extension(file.name))) {
    return file.size > MAX_DOC_BYTES ? S.composer.docTooLarge(file.name) : null
  }
  return S.composer.unsupportedFile(file.name)
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const SHRINK_ABOVE_BYTES = 400 * 1024
const MAX_SIDE = 2048

/**
 * Photos are often several MB; the server only needs them at screen / vision resolution, so
 * downscale to 2048px and re-encode as WebP before uploading. Falls back to the original file
 * whenever that is not possible or not smaller (no canvas, decode error, tiny image…).
 */
export async function shrinkImage(file: File): Promise<File> {
  if (!isImageMime(file.type) || file.size < SHRINK_ABOVE_BYTES) return file
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', 0.85),
    )
    if (!blob || blob.type !== 'image/webp' || blob.size > file.size * 0.8) return file
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.webp', { type: 'image/webp' })
  } catch {
    return file
  }
}

/** `POST /api/files`; omit `conversationId` for a conversation that does not exist yet. */
export function uploadFile(
  file: File,
  conversationId?: string,
  signal?: AbortSignal,
): Promise<FileRef> {
  const body = new FormData()
  body.append('file', file)
  if (conversationId) body.append('conversation_id', conversationId)
  return api<FileRef>('/api/files', { method: 'POST', body, signal })
}

/** `DELETE /api/files/:id`. Best effort: errors (e.g. 409 already used) are ignored. */
export async function deleteFile(id: string): Promise<void> {
  try {
    await api<void>(`/api/files/${id}`, { method: 'DELETE' })
  } catch {
    /* ignore */
  }
}
