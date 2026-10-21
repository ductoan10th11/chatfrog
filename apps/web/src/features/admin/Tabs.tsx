import { useRef } from 'react'
import { cn } from '@/lib/utils'
import { panelId, tabId } from './tabIds'

export type TabItem<T extends string> = { value: T; label: string }

type Props<T extends string> = {
  items: TabItem<T>[]
  value: T
  onChange: (value: T) => void
  label: string
  idPrefix: string
}

/** Minimal accessible tab list (arrow keys, Home/End). */
export function Tabs<T extends string>({ items, value, onChange, label, idPrefix }: Props<T>) {
  const listRef = useRef<HTMLDivElement>(null)

  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = items.findIndex((t) => t.value === value)
    let next: number
    if (e.key === 'ArrowRight') next = (i + 1) % items.length
    else if (e.key === 'ArrowLeft') next = (i - 1 + items.length) % items.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = items.length - 1
    else return
    e.preventDefault()
    onChange(items[next].value)
    listRef.current?.querySelectorAll<HTMLElement>('[role=tab]')[next]?.focus()
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="flex gap-1 overflow-x-auto border-b border-border"
    >
      {items.map((t) => {
        const active = t.value === value
        return (
          <button
            key={t.value}
            id={tabId(idPrefix, t.value)}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={panelId(idPrefix, t.value)}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.value)}
            className={cn(
              '-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}
