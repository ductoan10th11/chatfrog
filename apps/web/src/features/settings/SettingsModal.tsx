import { Activity, BarChart3, Settings2, Users, type LucideIcon } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { HealthTab } from '@/features/admin/HealthTab'
import { StatsTab } from '@/features/admin/StatsTab'
import { UsersTab } from '@/features/admin/UsersTab'
import { useMe } from '@/features/auth/useMe'
import { S } from '@/lib/strings'
import { useSettingsModal } from './modalStore'
import { SettingsPanel } from './SettingsPanel'

const navTrigger =
  'h-9 flex-none justify-start gap-2.5 px-3 md:w-full after:hidden data-active:font-semibold focus-visible:ring-2 focus-visible:ring-ring/30'

function NavItem({ value, label, icon: Icon }: { value: string; label: string; icon: LucideIcon }) {
  return (
    <TabsTrigger value={value} className={navTrigger}>
      <Icon aria-hidden />
      {label}
    </TabsTrigger>
  )
}

const contentClass = 'min-h-0 overflow-y-auto p-5 md:p-6'

/** Account settings, plus the admin sections for admins. */
export function SettingsModal() {
  const open = useSettingsModal((s) => s.open)
  const setOpen = useSettingsModal((s) => s.setOpen)
  const isAdmin = useMe().data?.role === 'admin'

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex h-[85dvh] max-h-[44rem] flex-col gap-0 overflow-hidden bg-background p-0 sm:max-w-4xl">
        <DialogHeader className="h-14 shrink-0 justify-center border-b px-5 pr-14 text-left md:px-6">
          <DialogTitle className="text-base">{S.settings.title}</DialogTitle>
          <DialogDescription className="sr-only">{S.settings.title}</DialogDescription>
        </DialogHeader>
        <Tabs
          defaultValue="general"
          className="min-h-0 min-w-0 flex-1 flex-col! gap-0 md:flex-row!"
        >
          <TabsList
            aria-label={S.settings.title}
            className="h-auto! shrink-0 justify-start gap-1 overflow-x-auto rounded-none border-b bg-muted p-2 md:w-56 md:flex-col md:items-stretch md:overflow-x-visible md:overflow-y-auto md:border-r md:border-b-0 md:p-3 md:pr-3"
          >
            <NavItem value="general" label={S.settings.title} icon={Settings2} />
            {isAdmin && (
              <>
                <NavItem value="users" label={S.admin.tabs.users} icon={Users} />
                <NavItem value="stats" label={S.admin.tabs.stats} icon={BarChart3} />
                <NavItem value="system" label={S.admin.tabs.system} icon={Activity} />
              </>
            )}
          </TabsList>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <TabsContent value="general" className={`min-h-0 flex-1 ${contentClass}`}>
              <SettingsPanel />
            </TabsContent>
            {isAdmin && (
              <>
                <TabsContent value="users" className={`min-h-0 flex-1 ${contentClass}`}>
                  <UsersTab />
                </TabsContent>
                <TabsContent value="stats" className={`min-h-0 flex-1 ${contentClass}`}>
                  <StatsTab />
                </TabsContent>
                <TabsContent value="system" className={`min-h-0 flex-1 ${contentClass}`}>
                  <HealthTab />
                </TabsContent>
              </>
            )}
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
