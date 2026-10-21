import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { S } from '@/lib/strings'
import type { ToolCallPart } from '@/types/api'
import { ToolCallCard } from './ToolCallCard'

const part: ToolCallPart = {
  type: 'tool_call',
  id: 't1',
  name: 'generate_image',
  args: { prompt: 'một chú ếch', size: '1024x1024' },
  status: 'done',
  result: {
    file: {
      id: 'f1',
      kind: 'generated',
      name: 'ech.png',
      mime: 'image/png',
      size: 10,
      width: 1024,
      height: 1024,
      url: '/api/files/f1',
    },
  },
}

describe('ToolCallCard image viewer', () => {
  it('opens the viewer from the image and closes it again', async () => {
    const user = userEvent.setup()
    render(<ToolCallCard part={part} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    await user.click(screen.getByRole('button', { name: S.viewer.open }))
    const dialog = await screen.findByRole('dialog')
    const link = within(dialog).getByRole('link', { name: S.viewer.download })
    expect(link).toHaveAttribute('href', '/api/files/f1')
    expect(link).toHaveAttribute('download', 'ech.png')
    await user.click(within(dialog).getByRole('button', { name: S.viewer.close }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('has a sibling download link that does not open the viewer', async () => {
    const user = userEvent.setup()
    render(<ToolCallCard part={part} />)
    const link = screen.getByRole('link', { name: S.viewer.download })
    expect(link).toHaveAttribute('href', '/api/files/f1')
    expect(link).toHaveAttribute('download', 'ech.png')
    expect(link.closest('button')).toBeNull()
    link.addEventListener('click', (e) => e.preventDefault())
    await user.click(link)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
