import { useEffect, useMemo, useRef } from 'react'
import { ImageGeneration, type ImageGenerationHandle } from 'img-fx'
import { useResolvedTheme } from '@/lib/theme'

/**
 * img-fx (libraries.dev) pixel-churn "generating" effect, recoloured to the green palette.
 * Loaded lazily: it pulls in three.js.
 *
 * The 7 slots mirror the structure of the `pixels-organic` preset (mostly close to the card
 * surface, a few accents), with greys swapped for greens.
 */
const PALETTE: Record<'light' | 'dark', string[]> = {
  light: ['#bfe3cd', '#fbfdfc', '#eaf6ef', '#3e8f60', '#d3ecdd', '#f1f8f4', '#e4f3ea'],
  dark: ['#86cfa3', '#1f3528', '#243d2e', '#2b4a37', '#142019', '#101a14', '#223a2c'],
}

/** Matches `--surface` in index.css, so the shader blends into the card. */
const CARD_BG = { light: '#f5f7f5', dark: '#181b19' } as const

type Props = {
  aspectRatio: number
  /** Set once the image exists: it dissolves in over the effect. */
  src?: string
  /** Waiting for a turn on the image server: calmer effect. */
  queued?: boolean
  /** The image is fully revealed (the caller swaps in a plain <img>). */
  onRevealed: () => void
}

export default function ImageFx({ aspectRatio, src, queued = false, onRevealed }: Props) {
  const mode = useResolvedTheme()
  const ref = useRef<ImageGenerationHandle>(null)
  const revealed = useRef(onRevealed)
  useEffect(() => {
    revealed.current = onRevealed
  })
  const images = useMemo(() => (src ? [src] : []), [src])

  useEffect(() => {
    if (!src) return
    // Let the `images` prop land before revealing; never leave the user without the image.
    const start = requestAnimationFrame(() => ref.current?.triggerReveal({ hold: 'manual' }))
    const fallback = setTimeout(() => revealed.current(), 4000)
    return () => {
      cancelAnimationFrame(start)
      clearTimeout(fallback)
    }
  }, [src])

  return (
    <ImageGeneration
      ref={ref}
      preset="pixels-organic"
      theme={mode}
      colors={PALETTE[mode]}
      cardBg={CARD_BG[mode]}
      strength={queued ? 0.55 : 1}
      images={images}
      onCycle={(e) => {
        if (e.phase === 'visible') revealed.current()
      }}
      className="w-full"
      aria-hidden
    >
      <div className="w-full rounded-xl" style={{ aspectRatio }} />
    </ImageGeneration>
  )
}
