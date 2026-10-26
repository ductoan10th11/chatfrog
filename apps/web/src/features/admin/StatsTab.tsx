import { useMemo, useState } from 'react'
import { ErrorState } from '@/components/ErrorState'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { S } from '@/lib/strings'
import type { Stats } from '@/types/api'
import { formatBytes, formatLatency, formatNumber, rangeFor, shortDate } from './format'
import { useAdminStats } from './queries'

const T = S.admin.stats
const PRESETS = [7, 30, 90] as const

export function StatsTab() {
  const [days, setDays] = useState<number>(30)
  const [now] = useState(() => new Date())
  const { from, to } = useMemo(() => rangeFor(days, now), [days, now])
  const stats = useAdminStats(from, to)

  return (
    <div className="space-y-6">
      <Tabs value={String(days)} onValueChange={(v) => setDays(Number(v))}>
        <TabsList aria-label={T.range}>
          {PRESETS.map((n) => (
            <TabsTrigger key={n} value={String(n)}>
              {T.lastDays(n)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {stats.isPending ? (
        <div className="space-y-4" aria-busy="true">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
          <Skeleton className="h-56 w-full" />
        </div>
      ) : stats.isError ? (
        <ErrorState message={T.loadError} onRetry={() => stats.refetch()} />
      ) : (
        <>
          <Totals totals={stats.data.totals} />
          <DailyChart days={stats.data.days} />
          <DailyTable days={stats.data.days} />
        </>
      )}
    </div>
  )
}

function Totals({ totals }: { totals: Stats['totals'] }) {
  const cards: [string, string][] = [
    [T.users, formatNumber(totals.users)],
    [T.activeUsers, formatNumber(totals.active_users)],
    [T.conversations, formatNumber(totals.conversations)],
    [T.messages, formatNumber(totals.messages)],
    [T.images, formatNumber(totals.images)],
    [T.storage, formatBytes(totals.storage_bytes)],
  ]
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {cards.map(([label, value]) => (
        <div key={label} className="rounded-xl border border-border bg-card p-3">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function DailyChart({ days }: { days: Stats['days'] }) {
  const max = Math.max(1, ...days.map((d) => Math.max(d.messages, d.images)))
  return (
    <section aria-labelledby="admin-chart-title" className="rounded-xl border border-border p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 id="admin-chart-title" className="text-sm font-medium">
          {T.chartTitle}
        </h3>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-primary" aria-hidden />
            {T.messages}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm border border-primary bg-primary/30" aria-hidden />
            {T.images}
          </span>
        </div>
      </div>
      {days.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{T.noData}</p>
      ) : (
        <div className="flex gap-2">
          <div
            className="flex h-44 flex-col justify-between text-right text-[10px] text-muted-foreground tabular-nums"
            aria-hidden
          >
            <span>{formatNumber(max)}</span>
            <span>0</span>
          </div>
          <div className="min-w-0 flex-1">
            <div
              role="img"
              aria-label={T.chartTitle}
              className="flex h-44 items-end gap-px border-b border-l border-border"
            >
              {days.map((d) => (
                <div
                  key={d.date}
                  title={`${d.date}: ${formatNumber(d.messages)} ${T.messages.toLowerCase()}, ${formatNumber(d.images)} ${T.images.toLowerCase()}`}
                  className="group flex h-full min-w-0 flex-1 items-end justify-center gap-px px-px hover:bg-primary-soft"
                >
                  <div
                    className="w-full max-w-3 rounded-t-sm bg-primary"
                    style={{ height: `${(d.messages / max) * 100}%` }}
                  />
                  <div
                    className="w-full max-w-3 rounded-t-sm border border-b-0 border-primary bg-primary/30"
                    style={{ height: `${(d.images / max) * 100}%` }}
                  />
                </div>
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
              <span>{shortDate(days[0].date)}</span>
              <span>{shortDate(days[days.length - 1].date)}</span>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function DailyTable({ days }: { days: Stats['days'] }) {
  if (days.length === 0) return null
  const rows = [...days].reverse()
  return (
    <section aria-labelledby="admin-table-title" className="space-y-2">
      <h3 id="admin-table-title" className="text-sm font-medium">
        {T.tableTitle}
      </h3>
      <div className="max-h-96 overflow-auto rounded-xl border border-border">
        <table className="w-full text-xs tabular-nums">
          <thead className="sticky top-0 bg-surface text-muted-foreground">
            <tr className="text-right">
              <th scope="col" className="px-3 py-2 text-left font-medium">
                {T.date}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {T.messages}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {T.images}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {T.promptTokens}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {T.completionTokens}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {T.latency}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.date} className="border-t border-border text-right">
                <th scope="row" className="px-3 py-1.5 text-left font-normal whitespace-nowrap">
                  {d.date}
                </th>
                <td className="px-3 py-1.5">{formatNumber(d.messages)}</td>
                <td className="px-3 py-1.5">{formatNumber(d.images)}</td>
                <td className="px-3 py-1.5">{formatNumber(d.prompt_tokens)}</td>
                <td className="px-3 py-1.5">{formatNumber(d.completion_tokens)}</td>
                <td className="px-3 py-1.5 whitespace-nowrap">{formatLatency(d.avg_latency_ms)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
