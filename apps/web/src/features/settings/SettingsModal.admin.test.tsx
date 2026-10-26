import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { db } from '@/mocks/db'
import { S } from '@/lib/strings'
import { installMockApi } from '@/test/mockServer'
import { renderApp } from '@/test/renderApp'

installMockApi()

const T = S.admin

describe('admin page', () => {
  it('redirects non-admins home', async () => {
    db().user.role = 'user'
    const { router } = renderApp('/admin')
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  it('lists users, filters by status and approves a pending user', async () => {
    const user = userEvent.setup()
    renderApp('/admin')
    expect(await screen.findByText('Trần Minh')).toBeInTheDocument()
    expect(screen.getAllByTestId('admin-user')).toHaveLength(4)

    // The current admin cannot block or demote themselves.
    expect(screen.queryByRole('button', { name: `${T.users.block}: Toàn Hoàng` })).toBeNull()
    expect(screen.queryByRole('button', { name: `${T.users.removeAdmin}: Toàn Hoàng` })).toBeNull()

    await user.click(screen.getByRole('button', { name: T.status.pending }))
    await waitFor(() => expect(screen.getAllByTestId('admin-user')).toHaveLength(1))

    await user.click(screen.getByRole('button', { name: `${T.users.approve}: Trần Minh` }))
    await waitFor(() =>
      expect(db().adminUsers.find((u) => u.name === 'Trần Minh')?.status).toBe('active'),
    )
    // No longer matches the "pending" filter.
    await waitFor(() => expect(screen.queryByText('Trần Minh')).toBeNull())
  })

  it('confirms before blocking a user', async () => {
    const user = userEvent.setup()
    renderApp('/admin')
    await screen.findByText('Nguyễn Lan')
    await user.click(screen.getByRole('button', { name: `${T.users.block}: Nguyễn Lan` }))
    const dialog = await screen.findByRole('alertdialog')
    expect(db().adminUsers.find((u) => u.name === 'Nguyễn Lan')?.status).toBe('active')
    await user.click(within(dialog).getByRole('button', { name: T.users.block }))
    await waitFor(() =>
      expect(db().adminUsers.find((u) => u.name === 'Nguyễn Lan')?.status).toBe('blocked'),
    )
  })

  it('searches users (debounced)', async () => {
    const user = userEvent.setup()
    renderApp('/admin')
    await screen.findByText('Trần Minh')
    await user.type(screen.getByRole('searchbox', { name: T.users.searchLabel }), 'spam@')
    await waitFor(() => expect(screen.getAllByTestId('admin-user')).toHaveLength(1))
    expect(screen.getByText('spam@example.com')).toBeInTheDocument()
  })

  it('renders stats totals, chart and table', async () => {
    const user = userEvent.setup()
    renderApp('/admin')
    await screen.findByText('Trần Minh')
    await user.click(screen.getByRole('tab', { name: T.tabs.stats }))
    expect(await screen.findByText('47')).toBeInTheDocument() // conversations
    expect(screen.getByText('256 MB')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: T.stats.chartTitle })).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: T.stats.lastDays(30) })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await user.click(screen.getByRole('button', { name: T.stats.lastDays(7) }))
    expect(screen.getByRole('button', { name: T.stats.lastDays(7) })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('renders service health and refreshes', async () => {
    const user = userEvent.setup()
    renderApp('/admin')
    await screen.findByText('Trần Minh')
    await user.click(screen.getByRole('tab', { name: T.tabs.system }))
    const llm = await screen.findByRole('region', { name: T.system.llm })
    expect(within(llm).getByText('qwen3.5-4b')).toBeInTheDocument()
    expect(within(llm).getByText('142 ms')).toBeInTheDocument()
    expect(within(llm).getByText(T.system.ok)).toBeInTheDocument()
    expect(screen.getByRole('region', { name: T.system.image })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: T.system.mongo })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: T.system.refresh }))
    expect(await screen.findByRole('button', { name: T.system.refresh })).toBeEnabled()
  })
})
