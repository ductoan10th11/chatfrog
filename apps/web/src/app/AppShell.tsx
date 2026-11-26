import { useState } from 'react'
import { Link, Outlet, useLocation, useMatch } from 'react-router'
import { Menu, SquarePen } from 'lucide-react'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { useConversation } from '@/features/conversations/queries'
import { Sidebar } from '@/features/conversations/Sidebar'
import { SettingsModal } from '@/features/settings/SettingsModal'
import { S } from '@/lib/strings'

// /?embed=1 inside an iframe (the slide deck's live demo): chat only, no sidebar or header.
// Read once so it survives in-app navigation, which drops the query string.
const EMBED =
  typeof window !== 'undefined' &&
  window.self !== window.top &&
  new URLSearchParams(window.location.search).get('embed') === '1'

/** Sidebar + main. Below 768px the sidebar becomes a drawer. */
export function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const match = useMatch('/c/:id')
  const conversation = useConversation(match?.params.id)
  const section = useLocation().pathname.slice(1)
  const title = match
    ? conversation.data?.title || S.nav.untitled
    : section === 'images' || section === 'documents'
      ? S.library[section]
      : S.app.name

  if (EMBED)
    return (
      <main className="h-dvh min-h-0">
        <Outlet />
      </main>
    )

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className="hidden w-72 shrink-0 border-r bg-surface md:block">
        <Sidebar />
      </aside>

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent
          side="left"
          showCloseButton={false}
          className="w-[85vw] max-w-80 gap-0 bg-surface p-0"
          // Do not focus the search field on open (it would pop the keyboard up on phones).
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <SheetTitle className="sr-only">{S.nav.sidebar}</SheetTitle>
          <SheetDescription className="sr-only">{S.nav.sidebar}</SheetDescription>
          <Sidebar onNavigate={() => setDrawerOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-1 border-b px-2 md:hidden">
          <Button
            variant="ghost"
            size="icon"
            aria-label={S.nav.openMenu}
            onClick={() => setDrawerOpen(true)}
          >
            <Menu />
          </Button>
          <h1 className="min-w-0 flex-1 truncate px-1 text-sm font-medium">{title}</h1>
          <ThemeToggle />
          <Button asChild variant="ghost" size="icon" aria-label={S.nav.newChat}>
            <Link to="/">
              <SquarePen />
            </Link>
          </Button>
        </header>
        <main className="min-h-0 flex-1">
          <Outlet />
        </main>
      </div>

      <SettingsModal />
    </div>
  )
}
