import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { S } from '@/lib/strings'

/** Write text to the clipboard (with a textarea fallback for insecure contexts). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch {
    return false
  }
}

/** `copied` is true for ~1.8s after a successful copy. */
export function useCopy() {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const copy = useCallback(async (text: string) => {
    const ok = await copyText(text)
    if (!ok) {
      toast.error(S.app.unknownError)
      return
    }
    setCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1800)
  }, [])

  return { copied, copy }
}
