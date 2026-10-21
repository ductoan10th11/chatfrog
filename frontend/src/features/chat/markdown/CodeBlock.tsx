import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { ThemedToken } from 'shiki/core'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCopy } from '@/lib/useCopy'
import { S } from '@/lib/strings'
import { useResolvedTheme } from '@/lib/theme'
import { highlight, resolveLanguage } from './highlight'

type Props = { code: string; language?: string }

type Highlighted = { code: string; mode: string; tokens: ThemedToken[][] }

/**
 * Highlight lazily and incrementally: while the code grows during streaming, lines that did
 * not change keep their colours, new lines render plain until the next highlight lands.
 */
function useHighlighted(code: string, language: string | undefined) {
  const mode = useResolvedTheme()
  const [result, setResult] = useState<Highlighted | null>(null)
  const latest = useRef({ code, language, mode })
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const seq = useRef(0)
  const applied = useRef(0)
  const alive = useRef(true)

  // Throttle (not debounce): while the block streams in, re-highlight at most every ~100ms.
  useEffect(() => {
    latest.current = { code, language, mode }
    if (!resolveLanguage(language) || timer.current !== undefined) return
    timer.current = setTimeout(() => {
      timer.current = undefined
      const snap = latest.current
      const id = ++seq.current
      void highlight(snap.code, snap.language, snap.mode).then((tokens) => {
        // Ignore stale / out-of-order results and results after unmount.
        if (!tokens || !alive.current || id < applied.current) return
        applied.current = id
        setResult({ code: snap.code, mode: snap.mode, tokens })
      })
    }, 100)
  }, [code, language, mode])

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      clearTimeout(timer.current)
      timer.current = undefined
    }
  }, [])

  return useMemo(() => {
    const lines = code.split('\n')
    if (!result || result.mode !== mode) return lines.map((text): ThemedToken[] | string => text)
    const oldLines = result.code.split('\n')
    return lines.map((text, i) =>
      oldLines[i] === text && result.tokens[i] ? result.tokens[i] : text,
    )
  }, [code, result, mode])
}

function CodeBlockImpl({ code, language }: Props) {
  const lines = useHighlighted(code, language)
  const { copied, copy } = useCopy()
  const label = language?.toLowerCase() || S.code.plain

  return (
    <div className="my-4 overflow-hidden rounded-xl border bg-surface first:mt-0 last:mb-0">
      <div className="flex items-center justify-between border-b px-3 py-1.5 text-xs text-muted-foreground">
        <span className="font-mono">{label}</span>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => void copy(code)}
          aria-label={copied ? S.code.copied : S.code.copy}
          className="-mr-1 text-muted-foreground"
        >
          {copied ? <Check /> : <Copy />}
          <span aria-hidden>{copied ? S.app.copied : S.app.copy}</span>
        </Button>
      </div>
      <pre
        className="scrollbar-thin overflow-x-auto p-4 font-mono text-[13px] leading-6"
        tabIndex={0}
      >
        <code>
          {lines.map((line, i) => (
            <span key={i} className="block min-h-6 whitespace-pre">
              {typeof line === 'string'
                ? line
                : line.map((tok, j) => (
                    <span key={j} style={tokenStyle(tok)}>
                      {tok.content}
                    </span>
                  ))}
            </span>
          ))}
        </code>
      </pre>
    </div>
  )
}

function tokenStyle(tok: ThemedToken): React.CSSProperties | undefined {
  const style: React.CSSProperties = {}
  if (tok.color) style.color = tok.color
  const fs = tok.fontStyle ?? 0
  if (fs & 1) style.fontStyle = 'italic'
  if (fs & 2) style.fontWeight = 600
  if (fs & 4) style.textDecoration = 'underline'
  return Object.keys(style).length ? style : undefined
}

export const CodeBlock = memo(CodeBlockImpl)
