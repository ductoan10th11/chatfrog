import { api } from '@/lib/api'
import type { FileRef, Page } from '@/types/api'

export type LibraryType = 'image' | 'document'

export const listFiles = (params: { type: LibraryType; cursor?: string | null; limit?: number }) =>
  api<Page<FileRef>>('/api/files', {
    query: { type: params.type, limit: params.limit ?? 30, cursor: params.cursor },
  })
