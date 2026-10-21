import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { S } from '@/lib/strings'
import { Composer } from './Composer'

const created = { created: true }

function setup(props: Partial<React.ComponentProps<typeof Composer>> = {}) {
  const onSend = vi.fn().mockResolvedValue(created)
  const onStop = vi.fn()
  render(<Composer busy={false} onSend={onSend} onStop={onStop} {...props} />)
  return { onSend, onStop, box: screen.getByRole('textbox', { name: S.composer.label }) }
}

describe('Composer', () => {
  it('disables Send while empty and enables it with text', async () => {
    const user = userEvent.setup()
    const { box } = setup()
    const send = screen.getByRole('button', { name: S.composer.send })
    expect(send).toBeDisabled()
    await user.type(box, 'Xin chào')
    expect(send).toBeEnabled()
  })

  it('sends on Enter (trimmed) and clears the field', async () => {
    const user = userEvent.setup()
    const { box, onSend } = setup()
    await user.type(box, '  Xin chào  {Enter}')
    expect(onSend).toHaveBeenCalledWith('Xin chào')
    expect(box).toHaveValue('')
  })

  it('inserts a newline on Shift+Enter instead of sending', async () => {
    const user = userEvent.setup()
    const { box, onSend } = setup()
    await user.type(box, 'một{Shift>}{Enter}{/Shift}hai')
    expect(onSend).not.toHaveBeenCalled()
    expect(box).toHaveValue('một\nhai')
  })

  it('does not send while an IME composition is in progress', async () => {
    const user = userEvent.setup()
    const { box, onSend } = setup()
    await user.type(box, 'tieesng')
    fireEvent.keyDown(box, { key: 'Enter', isComposing: true })
    fireEvent.keyDown(box, { key: 'Enter', keyCode: 229 })
    expect(onSend).not.toHaveBeenCalled()
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onSend).toHaveBeenCalledTimes(1)
  })

  it('never sends an empty or whitespace-only message', async () => {
    const user = userEvent.setup()
    const { box, onSend } = setup()
    await user.type(box, '   {Enter}')
    expect(onSend).not.toHaveBeenCalled()
  })

  it('shows Stop while busy, calls onStop, and ignores Enter', async () => {
    const user = userEvent.setup()
    const { box, onSend, onStop } = setup({ busy: true })
    await user.type(box, 'tiếp theo{Enter}')
    expect(onSend).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: S.composer.stop }))
    expect(onStop).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: S.composer.send })).not.toBeInTheDocument()
  })

  it('restores the text when the request was rejected before creation', async () => {
    const user = userEvent.setup()
    const { box } = setup({
      onSend: vi.fn().mockResolvedValue({ created: false, error: new Error('x') }),
    })
    await user.type(box, 'giữ lại{Enter}')
    expect(box).toHaveValue('giữ lại')
  })
})
