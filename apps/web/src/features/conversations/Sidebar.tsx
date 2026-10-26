import { useState } from 'react'
import { Link, useLocation, useNavigation } from 'react-router'
import { FileText, Image, Plus, type LucideIcon } from 'lucide-react'
import { UserMenu } from '@/features/auth/UserMenu'
import { S } from '@/lib/strings'
import { cn } from '@/lib/utils'
import { ConversationList } from './ConversationList'

function NavButton({
  to,
  icon: Icon,
  label,
  selected,
  onSelect,
}: {
  to: string
  icon: LucideIcon
  label: string
  selected: string
  onSelect: (to: string) => void
}) {
  const active = selected === to
  return (
    <Link
      to={to}
      onClick={() => onSelect(to)}
      aria-current={active ? 'page' : undefined}
      // Same colours as ConversationItem so the whole sidebar highlights alike.
      className={cn(
        'flex items-center gap-2 rounded-lg py-2 pl-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4 [&_svg]:shrink-0',
        active ? 'bg-primary/25' : 'hover:bg-primary/15',
      )}
    >
      <Icon aria-hidden /> {label}
    </Link>
  )
}

/** Sidebar content, shared by the desktop column and the mobile drawer. */
export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  // Highlight the clicked route right away: the router commits the new location (and its pending
  // state) later, after the lazy route loads, which made the nav feel laggy.
  const current = useLocation().pathname
  const pending = useNavigation().location?.pathname
  const [clicked, setClicked] = useState<{ to: string; from: string } | null>(null)
  const selected = (clicked?.from === current ? clicked.to : null) ?? pending ?? current
  const select = (to: string) => {
    setClicked({ to, from: current })
    onNavigate?.()
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-4 pt-5 pb-4">
        <span className="text-lg font-semibold tracking-tight">{S.app.name}</span>
      </div>

      <nav aria-label={S.nav.main} className="space-y-0.5 px-2 pb-5">
        <NavButton to="/" icon={Plus} label={S.nav.newChat} selected={selected} onSelect={select} />
        <NavButton
          to="/images"
          icon={Image}
          label={S.library.images}
          selected={selected}
          onSelect={select}
        />
        <NavButton
          to="/documents"
          icon={FileText}
          label={S.library.documents}
          selected={selected}
          onSelect={select}
        />
      </nav>

      <div className="min-h-0 flex-1 scrollbar-thin overflow-y-auto overscroll-contain">
        <ConversationList q="" onNavigate={onNavigate} />
      </div>

      <div className="border-t p-2">
        <UserMenu onNavigate={onNavigate} />
      </div>
    </div>
  )
}
