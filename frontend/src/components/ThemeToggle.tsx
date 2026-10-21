import { Monitor, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { S } from '@/lib/strings'
import { useResolvedTheme, useTheme, useThemeStore, type Theme } from '@/lib/theme'

const OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: S.theme.light, icon: Sun },
  { value: 'dark', label: S.theme.dark, icon: Moon },
  { value: 'system', label: S.theme.system, icon: Monitor },
]

/** Icon button + dropdown for light / dark / system. */
export function ThemeToggle({ className }: { className?: string }) {
  const theme = useTheme()
  const resolved = useResolvedTheme()
  const setTheme = useThemeStore((s) => s.setTheme)
  const Icon = resolved === 'dark' ? Moon : Sun

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className={className} aria-label={S.theme.toggle}>
          <Icon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
          {OPTIONS.map(({ value, label, icon: I }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <I /> {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
