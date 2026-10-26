import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { db } from '@/mocks/db'
import { S } from '@/lib/strings'
import { installMockApi } from '@/test/mockServer'
import { renderApp } from '@/test/renderApp'
import { openSettings } from '@/test/openSettings'

installMockApi()

const T = S.admin

describe('settings modal: admin sections', () => {
  it('hides the admin sections from non-admins', async () => {
    const user = userEvent.setup()
    db().user.role = 'user'
    renderApp()
    await openSettings(user)
    expect(await screen.findByLabelText(S.settings.instructionsLabel)).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: T.tabs.users })).toBeNull()
    expect(screen.queryByRole('tab', { name: T.tabs.stats })).toBeNull()
  })

  it('lists users, filters by status and approves a pending user', async () => {
    const user = userEvent.setup()
    renderApp()
    await openSettings(user)
    await user.click(await screen.findByRole('tab', { name: T.tabs.users }))
    expect(await screen.findByText('Trần Minh')).toBeInTheDocument()
    expect(screen.getAllByTestId('admin-user')).toHaveLength(4)

    // The current admin cannot block or demote themselves.
    expect(screen.queryByRole('button', { name: `${T.users.actions}: Toàn Hoàng` })).toBeNull()

    await user.click(screen.getByRole('tab', { name: T.status.pending }))
    await waitFor(() => expect(screen.getAllByTestId('admin-user')).toHaveLength(1))

    await user.click(screen.getByRole('button', { name: `${T.users.actions}: Trần Minh` }))
    await user.click(await screen.findByRole('menuitem', { name: T.users.approve }))
    await waitFor(() =>
      expect(db().adminUsers.find((u) => u.name === 'Trần Minh')?.status).toBe('active'),
    )
    // No longer matches the "pending" filter.
    await waitFor(() => expect(screen.queryByText('Trần Minh')).toBeNull())
  })

  it('confirms before blocking a user', async () => {
    const user = userEvent.setup()
    renderApp()
    await openSettings(user)
    await user.click(await screen.findByRole('tab', { name: T.tabs.users }))
    await screen.findByText('Nguyễn Lan')
    await user.click(screen.getByRole('button', { name: `${T.users.actions}: Nguyễn Lan` }))
    await user.click(await screen.findByRole('menuitem', { name: T.users.block }))
    const dialog = await screen.findByRole('alertdialog')
    expect(db().adminUsers.find((u) => u.name === 'Nguyễn Lan')?.status).toBe('active')
    await user.click(within(dialog).getByRole('button', { name: T.users.block }))
    await waitFor(() =>
      expect(db().adminUsers.find((u) => u.name === 'Nguyễn Lan')?.status).toBe('blocked'),
    )
  })

  it('searches users (debounced)', async () => {
    const user = userEvent.setup()
    renderApp()
    await openSettings(user)
    await user.click(await screen.findByRole('tab', { name: T.tabs.users }))
    await screen.findByText('Trần Minh')
    await user.type(screen.getByRole('searchbox', { name: T.users.searchLabel }), 'spam@')
    await waitFor(() => expect(screen.getAllByTestId('admin-user')).toHaveLength(1))
    expect(screen.getByText('spam@example.com')).toBeInTheDocument()
  })

  it('renders stats totals, chart and table', async () => {
    const user = userEvent.setup()
    renderApp()
    await openSettings(user)
    await user.click(await screen.findByRole('tab', { name: T.tabs.users }))
    await screen.findByText('Trần Minh')
    await user.click(screen.getByRole('tab', { name: T.tabs.stats }))
    expect(await screen.findByText('47')).toBeInTheDocument() // conversations
    expect(screen.getByText('256 MB')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: T.stats.chartTitle })).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: T.stats.lastDays(30) })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await user.click(screen.getByRole('tab', { name: T.stats.lastDays(7) }))
    expect(screen.getByRole('tab', { name: T.stats.lastDays(7) })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('renders service health and refreshes', async () => {
    const user = userEvent.setup()
    renderApp()
    await openSettings(user)
    await user.click(await screen.findByRole('tab', { name: T.tabs.users }))
    await screen.findByText('Trần Minh')
    await user.click(screen.getByRole('tab', { name: T.tabs.system }))
    const llm = await screen.findByRole('listitem', { name: T.system.llm })
    expect(within(llm).getByText('qwen3.5-4b')).toBeInTheDocument()
    expect(within(llm).getByText('142 ms')).toBeInTheDocument()
    expect(within(llm).getByText(T.system.ok)).toBeInTheDocument()
    expect(screen.getByRole('listitem', { name: T.system.image })).toBeInTheDocument()
    expect(screen.getByRole('listitem', { name: T.system.mongo })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: T.system.refresh }))
    expect(await screen.findByRole('button', { name: T.system.refresh })).toBeEnabled()
  })
})
