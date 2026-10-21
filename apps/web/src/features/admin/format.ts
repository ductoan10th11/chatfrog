const LOCALE = 'vi-VN'

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 86_400_000],
  ['month', 30 * 86_400_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
]

const rtf = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' })

/** "2 ngày trước", "hôm qua", "vừa xong". */
export function formatRelative(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const diff = t - now
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) return rtf.format(Math.round(diff / ms), unit)
  }
  return rtf.format(0, 'second')
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(LOCALE)
}

export const formatNumber = (n: number) => n.toLocaleString(LOCALE)

/** Storage size in MB (< 1 GB) or GB. */
export function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  if (mb < 1024) return `${mb.toLocaleString(LOCALE, { maximumFractionDigits: 1 })} MB`
  return `${(mb / 1024).toLocaleString(LOCALE, { maximumFractionDigits: 2 })} GB`
}

export function formatLatency(ms: number | null | undefined): string {
  if (ms == null) return '—'
  if (ms >= 1000) return `${(ms / 1000).toLocaleString(LOCALE, { maximumFractionDigits: 1 })} s`
  return `${Math.round(ms)} ms`
}

const pad = (n: number) => String(n).padStart(2, '0')
export const toDateParam = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** Inclusive range ending today: `days` days back. */
export function rangeFor(days: number, now: Date): { from: string; to: string } {
  const start = new Date(now)
  start.setDate(start.getDate() - (days - 1))
  return { from: toDateParam(start), to: toDateParam(now) }
}

/** "2026-10-21" -> "21/10". */
export const shortDate = (date: string) => {
  const [, m, d] = date.split('-')
  return d && m ? `${d}/${m}` : date
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
    .map((w) => w[0]?.toUpperCase())
    .join('')
