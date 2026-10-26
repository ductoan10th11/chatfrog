import { render, screen } from '@testing-library/react'
import { S } from '@/lib/strings'
import type { Message } from '@/types/api'
import { AssistantMessage } from './AssistantMessage'

const base: Message = {
  id: 'a1',
  conversation_id: 'c1',
  role: 'assistant',
  status: 'complete',
  parts: [],
  created_at: '',
}

const noop = () => {}

function renderMsg(
  message: Message,
  props: Partial<React.ComponentProps<typeof AssistantMessage>> = {},
) {
  return render(
    <AssistantMessage
      message={message}
      live={false}
      queuePosition={null}
      canRegenerate={false}
      onRegenerate={noop}
      {...props}
    />,
  )
}

describe('AssistantMessage', () => {
  it('collapses finished reasoning into "Đã suy nghĩ trong Xs" and hides its text', () => {
    renderMsg({
      ...base,
      parts: [
        { type: 'reasoning', text: 'nội dung suy nghĩ bí mật', duration_ms: 2310 },
        { type: 'text', text: 'Câu trả lời' },
      ],
    })
    const toggle = screen.getByRole('button', { name: /Đã suy nghĩ trong 2s/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('nội dung suy nghĩ bí mật')).not.toBeInTheDocument()
  })

  it('shows "Đang suy nghĩ…" with shimmering text while reasoning is streaming', () => {
    renderMsg(
      {
        ...base,
        status: 'streaming',
        parts: [{ type: 'reasoning', text: 'đang nghĩ', duration_ms: 0 }],
      },
      { live: true },
    )
    expect(screen.getByRole('button', { name: new RegExp(S.chat.thinking) })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(screen.getAllByTestId('shimmer')[0]).toHaveTextContent(S.chat.thinking)
  })

  it('shows a shimmering label by phase: queued, writing, image', () => {
    const { rerender } = renderMsg(
      { ...base, status: 'streaming' },
      { live: true, queuePosition: 2 },
    )
    expect(screen.getByTestId('shimmer')).toHaveTextContent(S.chat.queued(2))

    const props = { live: true, queuePosition: null, canRegenerate: false, onRegenerate: noop }
    rerender(
      <AssistantMessage
        {...props}
        message={{ ...base, status: 'streaming', parts: [{ type: 'text', text: 'Xin' }] }}
      />,
    )
    expect(screen.getByTestId('shimmer')).toHaveTextContent(S.chat.writing)

    rerender(
      <AssistantMessage
        {...props}
        message={{
          ...base,
          status: 'streaming',
          parts: [
            {
              type: 'tool_call',
              id: 'c',
              name: 'generate_image',
              args: { prompt: 'p' },
              status: 'running',
            },
          ],
        }}
      />,
    )
    expect(screen.getAllByTestId('shimmer').at(-1)).toHaveTextContent(S.tool.generating)
  })

  it('shows the stopped notice and does not leave an interrupted tool call spinning', () => {
    renderMsg({
      ...base,
      status: 'stopped',
      parts: [
        { type: 'text', text: 'Mình sẽ tạo' },
        {
          type: 'tool_call',
          id: 'c',
          name: 'generate_image',
          args: { prompt: 'p' },
          status: 'running',
        },
      ],
    })
    expect(screen.getByText(S.chat.stopped)).toBeInTheDocument()
    expect(screen.getByText(S.tool.failed)).toBeInTheDocument()
    expect(screen.queryByText(S.tool.generating)).not.toBeInTheDocument()
  })

  it('offers regenerate only when allowed, and shows errors', () => {
    const onRegenerate = vi.fn()
    renderMsg(
      { ...base, status: 'error', error: { code: 'x', message: 'Hỏng rồi' }, parts: [] },
      { canRegenerate: true, onRegenerate },
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Hỏng rồi')
    screen.getByRole('button', { name: S.chat.regenerate }).click()
    expect(onRegenerate).toHaveBeenCalledTimes(1)
  })
})
