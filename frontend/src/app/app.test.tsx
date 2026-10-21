import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { setMockAuth } from '@/features/auth/api'
import { S } from '@/lib/strings'
import { installMockApi } from '@/test/mockServer'
import { renderApp } from '@/test/renderApp'

installMockApi()

describe('auth guard', () => {
  it('redirects anonymous users to /login', async () => {
    await setMockAuth('anon')
    const { router } = renderApp('/c/abc')
    await screen.findByRole('heading', { name: S.auth.loginTitle })
    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.location.search).toContain('redirect=')
  })

  it('sends pending users to /pending', async () => {
    await setMockAuth('pending')
    const { router } = renderApp('/')
    await screen.findByRole('heading', { name: S.auth.pendingTitle })
    expect(router.state.location.pathname).toBe('/pending')
  })
})

describe('sidebar', () => {
  it('shows pinned and time-grouped conversations and filters by search', async () => {
    const user = userEvent.setup()
    renderApp('/')
    const nav = await screen.findByRole('navigation', { name: S.nav.sidebar })
    expect(within(nav).getByRole('region', { name: S.nav.pinned })).toBeInTheDocument()
    expect(within(nav).getByRole('region', { name: S.nav.today })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Ảnh chú ếch trên lá sen' })).toBeInTheDocument()

    await user.type(screen.getByRole('searchbox', { name: S.nav.search }), 'lượng tử')
    await waitFor(() =>
      expect(
        screen.queryByRole('link', { name: 'Ảnh chú ếch trên lá sen' }),
      ).not.toBeInTheDocument(),
    )
    expect(
      await screen.findByRole('link', { name: 'Giải thích điện toán lượng tử' }),
    ).toBeInTheDocument()
  })

  it('renames a conversation inline and deletes it after confirmation', async () => {
    const user = userEvent.setup()
    renderApp('/')
    await screen.findByRole('link', { name: 'Giới thiệu về ChatFrog' })

    await user.click(
      screen.getByRole('button', { name: `${S.conversation.actions}: Giới thiệu về ChatFrog` }),
    )
    await user.click(await screen.findByRole('menuitem', { name: S.conversation.rename }))
    const input = await screen.findByRole('textbox', { name: S.conversation.renameInput })
    await user.clear(input)
    await user.type(input, 'Tên mới{Enter}')
    expect(await screen.findByRole('link', { name: 'Tên mới' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: `${S.conversation.actions}: Tên mới` }))
    await user.click(await screen.findByRole('menuitem', { name: S.conversation.delete }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: S.conversation.delete }))
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Tên mới' })).not.toBeInTheDocument(),
    )
  })

  it('shows a not-found state for an unknown conversation', async () => {
    renderApp('/c/ffffffffffffffffffffffff')
    expect(await screen.findByText(S.conversation.notFound)).toBeInTheDocument()
  })
})
