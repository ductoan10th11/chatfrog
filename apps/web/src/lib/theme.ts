import { create } from 'zustand'

export type Theme = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

/** Keep in sync with the inline script in index.html. */
export const THEME_STORAGE_KEY = 'cf-theme'

const isTheme = (v: unknown): v is Theme => v === 'light' || v === 'dark' || v === 'system'

export function readStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY)
    if (isTheme(v)) return v
  } catch {
    /* storage unavailable (private mode, blocked) */
  }
  return 'system'
}

function writeStoredTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    /* ignore */
  }
}

export function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
}

export function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === 'system') return systemPrefersDark() ? 'dark' : 'light'
  return theme
}

/** Apply the resolved theme to <html> (class + color-scheme + theme-color meta). */
export function applyTheme(resolved: ResolvedTheme) {
  const root = document.documentElement
  root.classList.toggle('dark', resolved === 'dark')
  root.style.colorScheme = resolved
  const meta = document.querySelector('meta[name="theme-color"]')
  meta?.setAttribute('content', resolved === 'dark' ? '#0f1110' : '#ffffff')
}

type ThemeState = {
  theme: Theme
  resolved: ResolvedTheme
  setTheme: (theme: Theme) => void
}

export const useThemeStore = create<ThemeState>((set) => {
  const theme = readStoredTheme()
  return {
    theme,
    resolved: resolveTheme(theme),
    setTheme: (next) => {
      writeStoredTheme(next)
      const resolved = resolveTheme(next)
      applyTheme(resolved)
      set({ theme: next, resolved })
    },
  }
})

/** Subscribe to OS theme changes while the user is on "system". Returns an unsubscribe fn. */
export function watchSystemTheme(): () => void {
  const mql = window.matchMedia('(prefers-color-scheme: dark)')
  const onChange = () => {
    const { theme } = useThemeStore.getState()
    if (theme !== 'system') return
    const resolved = resolveTheme('system')
    applyTheme(resolved)
    useThemeStore.setState({ resolved })
  }
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}

export const useTheme = () => useThemeStore((s) => s.theme)
export const useResolvedTheme = () => useThemeStore((s) => s.resolved)
