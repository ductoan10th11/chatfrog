import { useRef } from 'react'
import { DownloadIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { S } from '@/lib/strings'
import type { FileRef } from '@/types/api'

const toolbarButton = 'size-10 rounded-full text-white hover:bg-white/20 hover:text-white'

/** Full-viewport lightbox: dark backdrop, fitted image, Download + Close in the top-right. */
export function ImageViewer({
  file,
  alt,
  open,
  onOpenChange,
}: {
  file: Pick<FileRef, 'url' | 'name'>
  alt?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const contentRef = useRef<HTMLDivElement>(null)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={contentRef}
        showCloseButton={false}
        aria-describedby={undefined}
        // Focus the dialog itself so no toolbar tooltip pops up on open.
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          contentRef.current?.focus()
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) onOpenChange(false)
        }}
        className="inset-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 items-center justify-center gap-0 rounded-none bg-black/90 p-0 text-white ring-0 sm:max-w-none"
        style={{
          paddingTop: 'max(1rem, env(safe-area-inset-top))',
          paddingRight: 'max(1rem, env(safe-area-inset-right))',
          paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
          paddingLeft: 'max(1rem, env(safe-area-inset-left))',
        }}
      >
        <DialogTitle className="sr-only">{alt ?? S.viewer.title}</DialogTitle>
        <img
          src={file.url}
          alt={alt ?? file.name}
          className="max-h-full max-w-full rounded-lg object-contain select-none"
        />
        <TooltipProvider delayDuration={300}>
          <div
            className="absolute flex items-center gap-1 rounded-full bg-black/50 p-1"
            style={{
              top: 'max(0.75rem, env(safe-area-inset-top))',
              right: 'max(0.75rem, env(safe-area-inset-right))',
            }}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <Button asChild variant="ghost" size="icon" className={toolbarButton}>
                  <a href={file.url} download={file.name} aria-label={S.viewer.download}>
                    <DownloadIcon className="size-5" aria-hidden />
                  </a>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{S.viewer.download}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <DialogClose asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={toolbarButton}
                    aria-label={S.viewer.close}
                  >
                    <XIcon className="size-5" aria-hidden />
                  </Button>
                </DialogClose>
              </TooltipTrigger>
              <TooltipContent>{S.viewer.close}</TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </DialogContent>
    </Dialog>
  )
}
