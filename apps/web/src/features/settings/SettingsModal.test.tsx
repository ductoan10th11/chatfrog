import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { db } from '@/mocks/db'
import { S } from '@/lib/strings'
import { useThemeStore } from '@/lib/theme'
import { installMockApi } from '@/test/mockServer'
import { renderApp } from '@/test/renderApp'
import { ME_KEY } from '@/features/auth/useMe'

installMockApi()

afterEach(() => useThemeStore.getState().setTheme('system'))

describe('settings page', () => {
  it('saves custom instructions and theme, then updates the cached user', async () => {
    const user = userEvent.setup()
    const { client } = renderApp('/settings')
    const box = await screen.findByLabelText(S.settings.instructionsLabel)
    const save = screen.getByRole('button', { name: S.app.save })
    expect(save).toBeDisabled()
    expect(screen.getByText(S.settings.counter(0, 2000))).toBeInTheDocument()

    await user.type(box, 'Trả lời ngắn')
    expect(screen.getByText(S.settings.counter(12, 2000))).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: S.theme.dark }))
    expect(useThemeStore.getState().theme).toBe('dark')
    expect(save).toBeEnabled()

    await user.click(save)
    await waitFor(() =>
      expect(db().user.settings).toEqual({
        custom_instructions: 'Trả lời ngắn',
        theme: 'dark',
      }),
    )
    await waitFor(() => expect(screen.getByRole('button', { name: S.app.save })).toBeDisabled())
    expect(client.getQueryData<{ settings: { theme: string } }>(ME_KEY)?.settings.theme).toBe(
      'dark',
    )
  })
})
