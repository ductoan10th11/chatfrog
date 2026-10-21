import { ImageIcon } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { S } from '@/lib/strings'
import type { ToolCallPart } from '@/types/api'

function aspect(size: string | undefined): number {
  const m = /^(\d+)x(\d+)$/.exec(size ?? '')
  return m ? Number(m[1]) / Number(m[2]) : 1
}

/**
 * Placeholder for `generate_image` calls: skeleton while queued/running, the image when done.
 * (The full ImageResult with effects, lightbox and download comes in a later step.)
 */
export function ToolCallCard({
  part,
  interrupted = false,
}: {
  part: ToolCallPart
  interrupted?: boolean
}) {
  // A call that never finished (stopped / failed generation) must not spin forever.
  const unfinished = part.status === 'queued' || part.status === 'running'
  const working = unfinished && !interrupted
  const refs = part.args.reference_image_ids?.length ?? 0

  return (
    <figure className="max-w-md space-y-3 rounded-2xl border bg-surface p-3">
      <figcaption className="flex items-center gap-2 text-sm text-muted-foreground">
        <ImageIcon className="size-4" aria-hidden />
        <span>
          {working
            ? part.status === 'queued'
              ? S.tool.queued
              : S.tool.generating
            : part.status === 'error' || unfinished
              ? S.tool.failed
              : S.tool.generateImage}
        </span>
        {refs > 0 && <span className="text-xs">· {S.tool.referenceImages(refs)}</span>}
      </figcaption>

      {working && (
        <Skeleton
          className="w-full rounded-xl"
          style={{ aspectRatio: aspect(part.args.size) }}
          aria-hidden
        />
      )}
      {part.status === 'done' && part.result && (
        <img
          src={part.result.file.url}
          alt={S.tool.imageAlt}
          width={part.result.file.width}
          height={part.result.file.height}
          className="w-full rounded-xl"
          style={{ aspectRatio: aspect(part.args.size) }}
        />
      )}
      {(part.status === 'error' || interrupted) && part.error && (
        <p className="text-sm text-destructive">{part.error}</p>
      )}

      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground select-none hover:text-foreground">
          {S.tool.prompt}
        </summary>
        <p className="mt-2 leading-6 break-words text-muted-foreground">{part.args.prompt}</p>
      </details>
    </figure>
  )
}
