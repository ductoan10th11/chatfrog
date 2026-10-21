import { useId, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Monitor, Moon, Sun } from 'lucide-react'
import { toast } from 'sonner'
import { ErrorState } from '@/components/ErrorState'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
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

export function SettingsPage() {
  const me = useMe()
  return (
    <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
      <h2 className="text-xl font-semibold">{S.settings.title}</h2>
      {me.isPending ? (
        <div className="mt-6 space-y-4" aria-busy="true">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-10 w-72" />
        </div>
      ) : me.isError || !me.data ? (
        <ErrorState message={S.settings.loadError} onRetry={() => me.refetch()} />
      ) : (
        <SettingsForm saved={me.data.settings} />
      )}
    </div>
  )
}

function SettingsForm({ saved }: { saved: UserSettings }) {
  const qc = useQueryClient()
  const setTheme = useThemeStore((s) => s.setTheme)
  const instructionsId = useId()
  const hintId = useId()
  // Only the fields the user touched; everything else comes from the saved settings.
  const [edits, setEdits] = useState<Partial<UserSettings>>({})
  const current: UserSettings = { ...saved, ...edits }
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

  const chooseTheme = (theme: Theme) => {
    setEdits((e) => ({ ...e, theme }))
    setTheme(theme) // apply immediately; persisted on save
  }

  return (
    <form
      className="mt-6 space-y-8"
      onSubmit={(e) => {
        e.preventDefault()
        if (dirty && !save.isPending) save.mutate(current)
      }}
    >
      <section className="space-y-2">
        <label htmlFor={instructionsId} className="text-sm font-medium">
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
        <span id="settings-theme-label" className="text-sm font-medium">
          {S.settings.themeLabel}
        </span>
        <div
          role="radiogroup"
          aria-labelledby="settings-theme-label"
          className="inline-flex w-full max-w-md rounded-lg bg-muted p-1 sm:w-auto"
        >
          {THEMES.map(({ value, label, icon: Icon }) => {
            const active = current.theme === value
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => chooseTheme(value)}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-none',
                  active ? 'bg-primary text-primary-foreground shadow-sm' : 'hover:text-foreground',
                )}
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </button>
            )
          })}
        </div>
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
