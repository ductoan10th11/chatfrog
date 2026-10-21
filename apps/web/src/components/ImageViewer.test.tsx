import { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { S } from '@/lib/strings'
import { ImageViewer } from './ImageViewer'

const file = { url: '/api/files/f1', name: 'frog.png' }

function Harness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>mở</button>
      <ImageViewer file={file} open={open} onOpenChange={setOpen} />
    </>
  )
}

describe('ImageViewer', () => {
  it('opens on click and shows the image with a download link', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    expect(screen.queryByRole('dialog')).toBeNull()
    await user.click(screen.getByText('mở'))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'frog.png' })).toHaveAttribute('src', file.url)
    const link = screen.getByRole('link', { name: S.viewer.download })
    expect(link).toHaveAttribute('href', file.url)
    expect(link).toHaveAttribute('download', file.name)
  })

  it('closes with the Close button', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByText('mở'))
    await user.click(await screen.findByRole('button', { name: S.viewer.close }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('closes with Escape', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByText('mở'))
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})
