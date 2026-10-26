import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockConfig } from '@/mocks/utils'
import { S } from '@/lib/strings'
import { installMockApi } from '@/test/mockServer'
import { renderApp } from '@/test/renderApp'
import { useChatStore } from './store'

installMockApi()

afterEach(() => {
  useChatStore.getState().abortAll()
  useChatStore.setState({ live: {} })
})

async function sendFromWelcome(user: ReturnType<typeof userEvent.setup>, text: string) {
  const box = await screen.findByRole('textbox', { name: S.composer.label })
  await user.type(box, `${text}{Enter}`)
}

const assistantArticles = () => screen.queryAllByRole('article', { name: S.chat.assistant })

describe('chat flow (against the mock API)', () => {
  it('sends from / , navigates to /c/:id without losing the stream, and shows the answer', async () => {
    const user = userEvent.setup()
    const { router } = renderApp('/')
    expect(await screen.findByRole('heading', { name: /^Chào .+, .+ vui vẻ/ })).toBeInTheDocument()

    await sendFromWelcome(user, 'Xin chào')

    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/c\/[0-9a-f]{24}$/))
    // User message + streamed markdown answer + reasoning summary.
    expect(await screen.findByText('Xin chào', { selector: 'div' })).toBeInTheDocument()
    expect(await screen.findByText(/Về câu hỏi|Cảm ơn bạn đã hỏi/)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: new RegExp(S.chat.thoughtFor(1).replace('1', '\\d+')) }),
    ).toBeInTheDocument()
    // The conversation got a title and shows up in the sidebar.
    await waitFor(() =>
      expect(screen.getAllByRole('link', { name: 'Xin chào' }).length).toBeGreaterThan(0),
    )
    // Composer is back to "Send" (generation finished).
    expect(await screen.findByRole('button', { name: S.composer.send })).toBeInTheDocument()
  })

  it('regenerates the last assistant message', async () => {
    const user = userEvent.setup()
    renderApp('/')
    await sendFromWelcome(user, 'Giải thích giúp mình')
    await screen.findByText(/Về câu hỏi|Cảm ơn bạn đã hỏi/)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: S.chat.regenerate })).toBeInTheDocument(),
    )

    await user.click(screen.getByRole('button', { name: S.chat.regenerate }))
    await waitFor(() => expect(assistantArticles()).toHaveLength(1))
    await screen.findByText(/Về câu hỏi|Cảm ơn bạn đã hỏi/)
    // Only the last assistant message offers regenerate.
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: S.chat.regenerate })).toHaveLength(1),
    )
  })

  it('edits a user message and replaces everything after it', async () => {
    const user = userEvent.setup()
    renderApp('/')
    await sendFromWelcome(user, 'Câu hỏi đầu')
    await screen.findByText(/Về câu hỏi|Cảm ơn bạn đã hỏi/)
    await user.type(screen.getByRole('textbox', { name: S.composer.label }), 'Câu hỏi hai{Enter}')
    await waitFor(() => expect(assistantArticles()).toHaveLength(2))
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: S.chat.edit })).toHaveLength(2),
    )

    await user.click(screen.getAllByRole('button', { name: S.chat.edit })[0])
    const editor = await screen.findByRole('textbox', { name: S.chat.editLabel })
    await user.clear(editor)
    await user.type(editor, 'Câu hỏi đã sửa')
    await user.click(screen.getByRole('button', { name: S.chat.editSave }))

    expect(await screen.findByText('Câu hỏi đã sửa', { selector: 'div' })).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByText('Câu hỏi hai', { selector: 'div' })).not.toBeInTheDocument(),
    )
    await waitFor(() => expect(assistantArticles()).toHaveLength(1))
  })

  it('renders a fenced code block and a table for the "code" scenario', async () => {
    const user = userEvent.setup()
    renderApp('/')
    await sendFromWelcome(user, 'cho ví dụ code')
    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: S.code.copy }).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('ts')).toBeInTheDocument()
  })

  it('renders the image placeholder card for the "ảnh" scenario, with the generated image when done', async () => {
    const user = userEvent.setup()
    renderApp('/')
    await sendFromWelcome(user, 'vẽ ảnh con ếch')
    const img = await screen.findByRole('img', { name: S.tool.imageAlt })
    expect(img.getAttribute('src')).toMatch(/^\/api\/files\/[0-9a-f]{24}$/)
    expect(screen.getByText(S.tool.prompt)).toBeInTheDocument()
  })

  it('shows an error state for the "lỗi" scenario and offers regenerate', async () => {
    const user = userEvent.setup()
    renderApp('/')
    await sendFromWelcome(user, 'cho mình xem lỗi')
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(S.chat.errorTitle)).toBeInTheDocument()
    expect(within(alert).getByText(/Máy chủ mô hình không phản hồi/)).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: S.chat.regenerate })).toBeInTheDocument()
  })

  it('shows the queue position first for the "chờ" scenario', async () => {
    mockConfig.speed = 0.4
    const user = userEvent.setup()
    renderApp('/')
    await sendFromWelcome(user, 'chờ tới lượt nhé')
    expect(
      await screen.findByText(/Đang chờ tới lượt/, undefined, { timeout: 3000 }),
    ).toBeInTheDocument()
    await screen.findByText(/Về câu hỏi|Cảm ơn bạn đã hỏi/, undefined, { timeout: 5000 })
  })

  it('Stop aborts the stream and marks the message stopped', async () => {
    mockConfig.speed = 1
    const user = userEvent.setup()
    renderApp('/')
    await sendFromWelcome(user, 'Xin chào')
    const stop = await screen.findByRole('button', { name: S.composer.stop })
    // Wait until some reasoning arrived so there is partial content to keep.
    await screen.findByText(S.chat.thinking, { selector: 'span' }, { timeout: 3000 })
    await user.click(stop)
    expect(await screen.findByText(S.chat.stopped)).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: S.composer.send })).toBeInTheDocument()
  })

  it('refuses a second send while generating (button is Stop, Enter ignored)', async () => {
    mockConfig.speed = 1
    const user = userEvent.setup()
    renderApp('/')
    await sendFromWelcome(user, 'Xin chào')
    await screen.findByRole('button', { name: S.composer.stop })
    await user.type(screen.getByRole('textbox', { name: S.composer.label }), 'hai{Enter}')
    expect(Object.keys(useChatStore.getState().live)).toHaveLength(1)
    expect(screen.queryByRole('button', { name: S.composer.send })).not.toBeInTheDocument()
  })
})
