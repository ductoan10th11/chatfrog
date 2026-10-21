import { useState } from 'react'
import { Navigate } from 'react-router'
import { FullScreenLoader } from '@/components/FullScreenLoader'
import { useMe } from '@/features/auth/useMe'
import { S } from '@/lib/strings'
import { HealthTab } from './HealthTab'
import { Tabs, type TabItem } from './Tabs'
import { panelId, tabId } from './tabIds'
import { StatsTab } from './StatsTab'
import { UsersTab } from './UsersTab'

type TabKey = 'users' | 'stats' | 'system'

const TABS: TabItem<TabKey>[] = [
  { value: 'users', label: S.admin.tabs.users },
  { value: 'stats', label: S.admin.tabs.stats },
  { value: 'system', label: S.admin.tabs.system },
]

const ID = 'admin'

/** Admin-only page: non-admins are redirected home. */
export function AdminPage() {
  const me = useMe()
  const [tab, setTab] = useState<TabKey>('users')

  if (me.isPending) return <FullScreenLoader />
  if (me.data?.role !== 'admin') return <Navigate to="/" replace />

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-4 sm:p-6">
      <h2 className="text-xl font-semibold">{S.admin.title}</h2>
      <Tabs items={TABS} value={tab} onChange={setTab} label={S.admin.title} idPrefix={ID} />
      <div role="tabpanel" id={panelId(ID, tab)} aria-labelledby={tabId(ID, tab)} tabIndex={0}>
        {tab === 'users' && <UsersTab />}
        {tab === 'stats' && <StatsTab />}
        {tab === 'system' && <HealthTab />}
      </div>
    </div>
  )
}
