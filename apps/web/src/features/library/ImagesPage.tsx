import { useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatFileSize } from './format'
import { S } from '@/lib/strings'
import type { FileRef } from '@/types/api'
import { LibraryShell, SkeletonList } from './LibraryShell'
import { useFileList } from './queries'

const T = S.library

/** `/images`: every image the user uploaded or had generated, newest first. */
export function ImagesPage() {
  const query = useFileList('image')
  const [selected, setSelected] = useState<FileRef | null>(null)

  return (
    <>
      <LibraryShell
        title={T.images}
        empty={T.imagesEmpty}
        query={query}
        skeleton={
          <SkeletonList
            count={8}
            className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 [&>*]:aspect-square [&>*]:h-auto [&>*]:rounded-xl"
          />
        }
      >
        {(files) => (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {files.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  aria-label={T.open(f.name)}
                  onClick={() => setSelected(f)}
                  className="group relative block aspect-square w-full overflow-hidden rounded-xl border bg-surface focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <img
                    src={`${f.url}/thumb`}
                    alt={f.name}
                    loading="lazy"
                    className="size-full object-cover transition-transform duration-200 group-hover:scale-105"
                  />
                </button>
              </li>
            ))}
          </ul>
        )}
      </LibraryShell>

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="gap-3 p-4 sm:max-w-3xl">
          {selected && (
            <>
              <DialogTitle className="truncate pr-8 text-sm">{selected.name}</DialogTitle>
              <DialogDescription className="text-xs">
                {selected.kind === 'generated' ? T.generated : T.uploaded} · {formatFileSize(selected.size)}
                {selected.width && selected.height ? ` · ${selected.width}×${selected.height}` : ''}
              </DialogDescription>
              <img
                src={selected.url}
                alt={selected.name}
                className="max-h-[70dvh] w-full rounded-lg object-contain"
              />
              <div className="flex justify-end">
                <Button asChild variant="outline" size="sm">
                  <a href={selected.url} download={selected.name}>
                    <Download aria-hidden /> {T.download}
                  </a>
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
