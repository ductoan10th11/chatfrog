import { CircleAlert, CircleCheck, RefreshCw } from 'lucide-react'
import { ErrorState } from '@/components/ErrorState'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { S } from '@/lib/strings'
import { cn } from '@/lib/utils'
import type { Health } from '@/types/api'
import { Badge } from './Badge'
import { formatDateTime, formatLatency } from './format'
import { useAdminHealth } from './queries'

const T = S.admin.system

export function HealthTab() {
  const health = useAdminHealth()

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          variant="outline"
          onClick={() => void health.refetch()}
          disabled={health.isFetching}
        >
          <RefreshCw className={cn(health.isFetching && 'animate-spin')} aria-hidden />
          {health.isFetching && !health.isPending ? T.refreshing : T.refresh}
        </Button>
      </div>

      {health.isPending ? (
        <div className="space-y-px overflow-hidden rounded-xl border" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 rounded-none" />
          ))}
        </div>
      ) : health.isError ? (
        <ErrorState message={T.loadError} onRetry={() => health.refetch()} />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          <ServiceRow title={T.llm} service={health.data.llm} />
          <ServiceRow title={T.image} service={health.data.image} />
          <ServiceRow title={T.mongo} service={health.data.mongo} />
        </ul>
      )}
    </div>
  )
}

function StatusBadge({ ok }: { ok: boolean }) {
  return (
    <Badge tone={ok ? 'ok' : 'danger'}>
      {ok ? (
        <CircleCheck className="size-3" aria-hidden />
      ) : (
        <CircleAlert className="size-3" aria-hidden />
      )}
      {ok ? T.ok : T.error}
    </Badge>
  )
}

function ServiceRow({
  title,
  service,
}: {
  title: string
  service: Health['llm'] | Health['mongo']
}) {
  const detailed = 'model' in service ? service : null
  return (
    <li aria-label={title} className="flex flex-col gap-1.5 px-4 py-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-medium">{title}</h3>
        <StatusBadge ok={service.ok} />
      </div>
      {detailed && (
        <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
          <Meta label={T.latency}>
            <span className="tabular-nums">{formatLatency(detailed.latency_ms)}</span>
          </Meta>
          <Meta label={T.model}>
            <span className="max-w-48 truncate" title={detailed.model}>
              {detailed.model}
            </span>
          </Meta>
          <Meta label={T.checkedAt}>{formatDateTime(detailed.checked_at)}</Meta>
          <Meta label={T.lastError}>
            <span className={detailed.last_error ? 'text-destructive' : 'text-muted-foreground'}>
              {detailed.last_error ?? T.noError}
            </span>
          </Meta>
        </dl>
      )}
    </li>
  )
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  )
}
