import { Link } from 'react-router'
import { ChevronsUpDown, LogOut, Settings, ShieldCheck } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { S } from '@/lib/strings'
import { useThemeStore, useTheme, type Theme } from '@/lib/theme'
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
  const theme = useTheme()
  const setTheme = useThemeStore((s) => s.setTheme)
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
        <DropdownMenuItem asChild>
          <Link to="/settings" onClick={onNavigate}>
            <Settings /> {S.nav.settings}
          </Link>
        </DropdownMenuItem>
        {me.role === 'admin' && (
          <DropdownMenuItem asChild>
            <Link to="/admin" onClick={onNavigate}>
              <ShieldCheck /> {S.nav.admin}
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {S.nav.theme}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
          <DropdownMenuRadioItem value="light">{S.theme.light}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">{S.theme.dark}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">{S.theme.system}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void logout()}>
          <LogOut /> {S.auth.logout}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
