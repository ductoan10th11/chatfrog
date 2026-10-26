import { Download, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatDateTime } from '@/features/admin/format'
import { formatFileSize } from './format'
import { S } from '@/lib/strings'
import { LibraryShell, SkeletonList } from './LibraryShell'
import { useFileList } from './queries'

const T = S.library

/** `/documents`: documents attached to conversations, newest first. */
export function DocumentsPage() {
  const query = useFileList('document')
  return (
    <LibraryShell
      title={T.documents}
      empty={T.documentsEmpty}
      query={query}
      skeleton={<SkeletonList className="space-y-2" count={5} />}
    >
      {(files) => (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border bg-card">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-3 px-4 py-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/25">
                <FileText className="size-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{f.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatFileSize(f.size)}
                  {f.created_at ? ` · ${formatDateTime(f.created_at)}` : ''}
                  {f.truncated ? ` · ${T.truncated}` : ''}
                </p>
              </div>
              <Button asChild variant="ghost" size="icon-sm" aria-label={`${T.download}: ${f.name}`}>
                <a href={f.url} download={f.name}>
                  <Download aria-hidden />
                </a>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </LibraryShell>
  )
}
