import { THEME_STORAGE_KEY, readStoredTheme, resolveTheme, useThemeStore } from './theme'

function mockMatchMedia(dark: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: dark,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
}

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.className = ''
    mockMatchMedia(false)
  })

  it('defaults to system when nothing is stored or the value is invalid', () => {
    expect(readStoredTheme()).toBe('system')
    localStorage.setItem(THEME_STORAGE_KEY, 'purple')
    expect(readStoredTheme()).toBe('system')
  })

  it('resolves system from prefers-color-scheme', () => {
    mockMatchMedia(true)
    expect(resolveTheme('system')).toBe('dark')
    expect(resolveTheme('light')).toBe('light')
  })

  it('setTheme persists, toggles the .dark class and updates state', () => {
    useThemeStore.getState().setTheme('dark')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(document.documentElement).toHaveClass('dark')
    expect(useThemeStore.getState().resolved).toBe('dark')
    useThemeStore.getState().setTheme('light')
    expect(document.documentElement).not.toHaveClass('dark')
  })
})
