import { lazy, memo, Suspense, useState } from 'react'
import { DownloadIcon, ImageIcon } from 'lucide-react'
import { ImageViewer } from '@/components/ImageViewer'
import { Skeleton } from '@/components/ui/skeleton'
import { usePrefersReducedMotion } from '@/lib/hooks'
import { S } from '@/lib/strings'
import type { ToolCallPart } from '@/types/api'

const ImageFx = lazy(() => import('./ImageFx'))

/** Icon-only affordance (no background): a tight dark halo keeps it visible on light and dark images. */
const DOWNLOAD_ICON_SHADOW =
  'drop-shadow(0 0 1.5px rgb(0 0 0 / 0.9)) drop-shadow(0 1px 4px rgb(0 0 0 / 0.6))'

function aspect(size: string | undefined): number {
  const m = /^(\d+)x(\d+)$/.exec(size ?? '')
  return m ? Number(m[1]) / Number(m[2]) : 1
}

/**
 * `generate_image` result. While the image is being made the card runs the img-fx pixel
 * effect (green palette); when it is ready the image dissolves in over the effect, then a
 * plain <img> takes over. Images loaded from history (or with reduced motion) show directly.
 */
function ToolCallCardImpl({
  part,
  interrupted = false,
}: {
  part: ToolCallPart
  interrupted?: boolean
}) {
  // A call that never finished (stopped / failed generation) must not spin forever.
  const unfinished = part.status === 'queued' || part.status === 'running'
  const working = unfinished && !interrupted
  const reducedMotion = usePrefersReducedMotion()
  // Only images generated while this card was on screen get the reveal animation.
  const [sawWorking, setSawWorking] = useState(working)
  if (working && !sawWorking) setSawWorking(true)
  const [revealed, setRevealed] = useState(false)
  const [viewerOpen, setViewerOpen] = useState(false)

  const refs = part.args.reference_image_ids?.length ?? 0
  const ratio = aspect(part.args.size)
  const file = part.status === 'done' ? part.result?.file : undefined
  const animate = !reducedMotion && sawWorking && (working || (!!file && !revealed))
  const placeholder = (
    <Skeleton className="w-full rounded-xl" style={{ aspectRatio: ratio }} aria-hidden />
  )

  return (
    <figure className="max-w-md space-y-3 rounded-2xl border bg-surface p-3">
      <figcaption className="flex items-center gap-2 text-sm text-muted-foreground">
        <ImageIcon className="size-4" aria-hidden />
        <span aria-live="polite">
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

      {animate ? (
        <Suspense fallback={placeholder}>
          <ImageFx
            aspectRatio={ratio}
            src={file?.url}
            queued={part.status === 'queued'}
            onRevealed={() => setRevealed(true)}
          />
        </Suspense>
      ) : working ? (
        placeholder
      ) : (
        file && (
          <div className="group relative">
            <button
              type="button"
              onClick={() => setViewerOpen(true)}
              aria-label={S.viewer.open}
              className="block w-full cursor-zoom-in rounded-xl"
            >
              <img
                src={file.url}
                alt={S.tool.imageAlt}
                width={file.width}
                height={file.height}
                className="w-full rounded-xl"
                style={{ aspectRatio: ratio }}
              />
            </button>
            <a
              href={file.url}
              download={file.name}
              aria-label={S.viewer.download}
              title={S.viewer.download}
              className="absolute top-1 right-1 p-2 text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
              style={{ filter: DOWNLOAD_ICON_SHADOW }}
            >
              <DownloadIcon className="size-5" aria-hidden />
            </a>
          </div>
        )
      )}
      {(part.status === 'error' || interrupted) && part.error && (
        <p className="text-sm text-destructive">{part.error}</p>
      )}

      {file && (
        <ImageViewer
          file={file}
          alt={S.tool.imageAlt}
          open={viewerOpen}
          onOpenChange={setViewerOpen}
        />
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

export const ToolCallCard = memo(ToolCallCardImpl)
