import { ChevronsUpDown, LogOut, Settings } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useSettingsModal } from '@/features/settings/modalStore'
import { S } from '@/lib/strings'
import { useLogout, useMe } from './useMe'

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
    .map((w) => w[0]?.toUpperCase())
    .join('')

export function UserMenu({ onNavigate }: { onNavigate?: () => void }) {
  const me = useMe().data
  const openSettings = useSettingsModal((s) => s.setOpen)
  const logout = useLogout()
  if (!me) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={S.nav.userMenu}
          className="flex w-full items-center gap-2 rounded-lg p-2 text-left transition-colors hover:bg-muted data-[state=open]:bg-muted"
        >
          <Avatar className="size-8">
            {me.avatar_url && (
              <AvatarImage src={me.avatar_url} alt="" referrerPolicy="no-referrer" />
            )}
            <AvatarFallback className="bg-primary text-xs font-medium text-primary-foreground">
              {initials(me.name)}
            </AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{me.name}</span>
            <span className="block truncate text-xs text-muted-foreground">{me.email}</span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-64">
        <DropdownMenuItem
          onSelect={() => {
            onNavigate?.() // close the mobile drawer
            openSettings(true)
          }}
        >
          <Settings /> {S.nav.settings}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void logout()}>
          <LogOut /> {S.auth.logout}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
