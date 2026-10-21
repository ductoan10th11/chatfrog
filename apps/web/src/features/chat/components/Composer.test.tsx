import { File as NodeFile } from 'node:buffer'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { S } from '@/lib/strings'
import { installMockApi } from '@/test/mockServer'
import { Composer } from './Composer'

installMockApi()

/**
 * jsdom's FormData is not understood by Node's fetch: rebuild the multipart body by hand
 * (and swap in Node's File, which undici's parser looks at) before it reaches MSW.
 */
beforeAll(() => {
  const base = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!(init?.body instanceof FormData)) return base(input, init)
    const boundary = '----cfboundary'
    let body = ''
    for (const [name, value] of init.body.entries()) {
      if (typeof value === 'string') {
        body += `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
      } else {
        body +=
          `--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${value.name}"\r\n` +
          `Content-Type: ${value.type || 'application/octet-stream'}\r\n\r\n${await value.text()}\r\n`
      }
    }
    body += `--${boundary}--\r\n`
    const jsdomFile = globalThis.File
    globalThis.File = NodeFile as unknown as typeof File
    try {
      return await base(input, {
        ...init,
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body,
      })
    } finally {
      globalThis.File = jsdomFile
    }
  }) as typeof fetch
})

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
    expect(onSend).toHaveBeenCalledWith('Xin chào', [])
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

  describe('attachments', () => {
    const fileInput = () => screen.getByTestId('composer-file-input') as HTMLInputElement
    const pick = (...files: File[]) => fireEvent.change(fileInput(), { target: { files } })
    const txt = (name = 'ghi-chu.txt', size = 12) =>
      new File([new Uint8Array(size)], name, { type: 'text/plain' })

    beforeEach(() => {
      vi.spyOn(toast, 'error').mockImplementation(() => 1)
    })
    afterEach(() => vi.restoreAllMocks())

    it('uploads a picked file, shows a chip, and passes it to onSend', async () => {
      const user = userEvent.setup()
      const { box, onSend } = setup()
      pick(txt())
      const chip = await screen.findByText('ghi-chu.txt')
      expect(chip).toBeInTheDocument()
      await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())

      await user.type(box, 'đọc giúp{Enter}')
      expect(onSend).toHaveBeenCalledTimes(1)
      const [text, attachments] = onSend.mock.calls[0]
      expect(text).toBe('đọc giúp')
      expect(attachments).toHaveLength(1)
      expect(attachments[0]).toMatchObject({ name: 'ghi-chu.txt', kind: 'upload' })
      expect(attachments[0].id).toBeTruthy()
      // chips are cleared after a successful send
      await waitFor(() => expect(screen.queryByText('ghi-chu.txt')).not.toBeInTheDocument())
    })

    it('blocks Send while uploading', async () => {
      const { server } = await import('@/test/mockServer')
      const { http, HttpResponse } = await import('msw')
      let release!: () => void
      const gate = new Promise<void>((r) => (release = r))
      server.use(
        http.post('/api/files', async () => {
          await gate
          return HttpResponse.json(
            {
              id: 'g1',
              kind: 'upload',
              name: 'cho.txt',
              mime: 'text/plain',
              size: 1,
              url: '/api/files/g1',
            },
            { status: 201 },
          )
        }),
      )
      const user = userEvent.setup()
      const { box, onSend } = setup()
      await user.type(box, 'chờ')
      pick(txt('cho.txt'))
      expect(screen.getByRole('button', { name: S.composer.send })).toBeDisabled()
      await user.type(box, '{Enter}')
      expect(onSend).not.toHaveBeenCalled()
      release()
      await waitFor(() =>
        expect(screen.getByRole('button', { name: S.composer.send })).toBeEnabled(),
      )
    })

    it('removes a chip with the X button', async () => {
      const user = userEvent.setup()
      setup()
      pick(txt())
      await screen.findByText('ghi-chu.txt')
      await user.click(
        screen.getByRole('button', { name: S.composer.removeAttachment('ghi-chu.txt') }),
      )
      await waitFor(() => expect(screen.queryByText('ghi-chu.txt')).not.toBeInTheDocument())
    })

    it('restores text and attachments when the request was rejected', async () => {
      const user = userEvent.setup()
      const { box } = setup({
        onSend: vi.fn().mockResolvedValue({ created: false, error: new Error('x') }),
      })
      pick(txt())
      await screen.findByText('ghi-chu.txt')
      await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
      await user.type(box, 'giữ lại{Enter}')
      expect(box).toHaveValue('giữ lại')
      expect(await screen.findByText('ghi-chu.txt')).toBeInTheDocument()
    })

    it('accepts pasted images', async () => {
      const { box } = setup()
      const image = new File([new Uint8Array(8)], 'image.png', { type: 'image/png' })
      fireEvent.paste(box, { clipboardData: { files: [image], getData: () => '' } })
      expect(await screen.findByAltText('image.png')).toBeInTheDocument()
    })

    it('accepts dropped files and highlights the drop zone', async () => {
      setup()
      const form = screen.getByRole('textbox').closest('form')!
      const data = { types: ['Files'], files: [txt('tha.txt')] }
      fireEvent.dragEnter(form, { dataTransfer: data })
      expect(screen.getByText(S.composer.dropHint)).toBeInTheDocument()
      fireEvent.drop(form, { dataTransfer: data })
      expect(await screen.findByText('tha.txt')).toBeInTheDocument()
      expect(screen.queryByText(S.composer.dropHint)).not.toBeInTheDocument()
    })

    it('rejects more than 5 attachments', async () => {
      setup()
      pick(...Array.from({ length: 6 }, (_, i) => txt(`f${i}.txt`)))
      expect(toast.error).toHaveBeenCalledWith(S.composer.tooManyFiles)
      await screen.findByText('f4.txt')
      expect(screen.queryByText('f5.txt')).not.toBeInTheDocument()
    })

    it('rejects oversized and unsupported files without uploading', () => {
      setup()
      const bigImage = new File([''], 'to.png', { type: 'image/png' })
      Object.defineProperty(bigImage, 'size', { value: 11 * 1024 * 1024 })
      const bigDoc = new File([''], 'to.pdf', { type: 'application/pdf' })
      Object.defineProperty(bigDoc, 'size', { value: 21 * 1024 * 1024 })
      const exe = new File(['x'], 'virus.exe', { type: 'application/octet-stream' })
      pick(bigImage, bigDoc, exe)
      expect(toast.error).toHaveBeenCalledWith(S.composer.imageTooLarge('to.png'))
      expect(toast.error).toHaveBeenCalledWith(S.composer.docTooLarge('to.pdf'))
      expect(toast.error).toHaveBeenCalledWith(S.composer.unsupportedFile('virus.exe'))
      expect(
        screen.queryByRole('list', { name: S.composer.attachments })?.children.length ?? 0,
      ).toBe(0)
    })

    it('shows a toast and an error chip when the server rejects the upload', async () => {
      const { server } = await import('@/test/mockServer')
      const { http, HttpResponse } = await import('msw')
      server.use(
        http.post('/api/files', () =>
          HttpResponse.json(
            { error: { code: 'payload_too_large', message: 'Tệp quá lớn' } },
            { status: 413 },
          ),
        ),
      )
      setup()
      pick(txt())
      expect(await screen.findByText(S.composer.uploadFailed)).toBeInTheDocument()
      expect(toast.error).toHaveBeenCalledWith('Tệp quá lớn')
    })

    it('warns when a document was truncated', async () => {
      const { server } = await import('@/test/mockServer')
      const { http, HttpResponse } = await import('msw')
      server.use(
        http.post('/api/files', () =>
          HttpResponse.json(
            {
              id: 'f1',
              kind: 'upload',
              name: 'dai.txt',
              mime: 'text/plain',
              size: 99,
              url: '/api/files/f1',
              truncated: true,
            },
            { status: 201 },
          ),
        ),
      )
      setup()
      pick(txt('dai.txt'))
      expect(await screen.findByText(S.composer.truncatedWarning)).toBeInTheDocument()
    })
  })
})
