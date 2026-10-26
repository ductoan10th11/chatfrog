import { useId, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Monitor, Moon, Sun } from 'lucide-react'
import { toast } from 'sonner'
import { ErrorState } from '@/components/ErrorState'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { ME_KEY, useMe } from '@/features/auth/useMe'
import { errorMessage } from '@/lib/api'
import { S } from '@/lib/strings'
import { useThemeStore, type Theme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import type { User, UserSettings } from '@/types/api'
import { saveSettings } from './api'

const MAX = S.settings.instructionsMax

const THEMES: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: S.theme.light, icon: Sun },
  { value: 'dark', label: S.theme.dark, icon: Moon },
  { value: 'system', label: S.theme.system, icon: Monitor },
]

export function SettingsPanel() {
  const me = useMe()
  if (me.isPending)
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-10 w-72" />
      </div>
    )
  if (me.isError || !me.data)
    return <ErrorState message={S.settings.loadError} onRetry={() => me.refetch()} />
  return <SettingsForm saved={me.data.settings} />
}

function SettingsForm({ saved }: { saved: UserSettings }) {
  const qc = useQueryClient()
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)
  const instructionsId = useId()
  const hintId = useId()
  // Only the fields the user touched; everything else comes from the saved settings.
  const [edits, setEdits] = useState<Partial<UserSettings>>({})
  // The theme in effect (store) wins over the saved one, which may be stale or still the default.
  const current: UserSettings = { ...saved, ...edits, theme }
  const dirty =
    current.custom_instructions !== saved.custom_instructions || current.theme !== saved.theme

  const save = useMutation({
    mutationFn: saveSettings,
    onSuccess: (next) => {
      qc.setQueryData<User | null>(ME_KEY, (u) => (u ? { ...u, settings: next } : u))
      setTheme(next.theme)
      setEdits({})
      toast.success(S.settings.saved)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  // Applied immediately; persisted on save.
  const chooseTheme = (next: Theme) => setTheme(next)

  return (
    <form
      className="space-y-8"
      onSubmit={(e) => {
        e.preventDefault()
        if (dirty && !save.isPending) save.mutate(current)
      }}
    >
      <section className="space-y-2">
        <label htmlFor={instructionsId} className="block text-sm font-medium">
          {S.settings.instructionsLabel}
        </label>
        <Textarea
          id={instructionsId}
          aria-describedby={hintId}
          className="min-h-32 resize-y"
          maxLength={MAX}
          placeholder={S.settings.instructionsPlaceholder}
          value={current.custom_instructions}
          onChange={(e) => setEdits((s) => ({ ...s, custom_instructions: e.target.value }))}
        />
        <div className="flex items-start justify-between gap-3">
          <p id={hintId} className="text-xs text-muted-foreground">
            {S.settings.instructionsHint}
          </p>
          <span
            aria-live="polite"
            className={cn(
              'shrink-0 text-xs text-muted-foreground tabular-nums',
              current.custom_instructions.length >= MAX && 'text-destructive',
            )}
          >
            {S.settings.counter(current.custom_instructions.length, MAX)}
          </span>
        </div>
      </section>

      <section className="space-y-2">
        <span id="settings-theme-label" className="block text-sm font-medium">
          {S.settings.themeLabel}
        </span>
        <Tabs value={current.theme} onValueChange={(v) => chooseTheme(v as Theme)}>
          <TabsList aria-labelledby="settings-theme-label">
            {THEMES.map(({ value, label, icon: Icon }) => (
              <TabsTrigger key={value} value={value} aria-label={label} title={label}>
                <Icon aria-hidden />
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <p className="text-xs text-muted-foreground">{S.settings.themeHint}</p>
      </section>

      <div className="flex justify-end">
        <Button type="submit" disabled={!dirty || save.isPending}>
          {save.isPending && <Loader2 className="animate-spin" aria-hidden />}
          {save.isPending ? S.settings.saving : S.app.save}
        </Button>
      </div>
    </form>
  )
}
