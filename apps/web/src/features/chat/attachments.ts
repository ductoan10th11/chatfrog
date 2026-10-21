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
