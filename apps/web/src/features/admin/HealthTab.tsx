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
        <div className="grid gap-3 sm:grid-cols-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : health.isError ? (
        <ErrorState message={T.loadError} onRetry={() => health.refetch()} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <ServiceCard title={T.llm} service={health.data.llm} />
          <ServiceCard title={T.image} service={health.data.image} />
          <ServiceCard title={T.mongo} service={health.data.mongo} />
        </div>
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

function ServiceCard({
  title,
  service,
}: {
  title: string
  service: Health['llm'] | Health['mongo']
}) {
  const detailed = 'model' in service ? service : null
  return (
    <section
      aria-label={title}
      className="space-y-3 rounded-xl border border-border bg-card p-4 text-sm"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium">{title}</h3>
        <StatusBadge ok={service.ok} />
      </div>
      {detailed && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
          <dt className="text-muted-foreground">{T.latency}</dt>
          <dd className="text-right tabular-nums">{formatLatency(detailed.latency_ms)}</dd>
          <dt className="text-muted-foreground">{T.model}</dt>
          <dd className="truncate text-right" title={detailed.model}>
            {detailed.model}
          </dd>
          <dt className="text-muted-foreground">{T.checkedAt}</dt>
          <dd className="text-right">{formatDateTime(detailed.checked_at)}</dd>
          <dt className="text-muted-foreground">{T.lastError}</dt>
          <dd
            className={cn(
              'text-right break-words',
              detailed.last_error ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {detailed.last_error ?? T.noError}
          </dd>
        </dl>
      )}
    </section>
  )
}
