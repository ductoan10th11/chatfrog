import { useState } from 'react'
import { Link } from 'react-router'
import { Plus, Search, X } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { UserMenu } from '@/features/auth/UserMenu'
import { useDebouncedValue } from '@/lib/hooks'
import { S } from '@/lib/strings'
import { ConversationList } from './ConversationList'

/** Sidebar content, shared by the desktop column and the mobile drawer. */
export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim(), 300)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-4 pt-4 pb-2">
        <Logo />
        <span className="text-base font-semibold tracking-tight">{S.app.name}</span>
      </div>

      <div className="space-y-2 px-3 pb-2">
        <Button asChild className="h-9 w-full justify-start gap-2">
          <Link to="/" onClick={onNavigate}>
            <Plus /> {S.nav.newChat}
          </Link>
        </Button>
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={S.nav.searchPlaceholder}
            aria-label={S.nav.search}
            className="h-9 bg-background pr-8 pl-8 [&::-webkit-search-cancel-button]:hidden"
          />
          {search && (
            <Button
              variant="ghost"
              size="icon-xs"
              className="absolute top-1/2 right-1.5 -translate-y-1/2"
              aria-label={S.nav.clearSearch}
              onClick={() => setSearch('')}
            >
              <X />
            </Button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 scrollbar-thin overflow-y-auto overscroll-contain">
        <ConversationList q={q} onNavigate={onNavigate} />
      </div>

      <div className="border-t p-2">
        <UserMenu onNavigate={onNavigate} />
      </div>
    </div>
  )
}
