import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { S } from '@/lib/strings'
import { MarkdownRenderer } from './MarkdownRenderer'

describe('MarkdownRenderer', () => {
  it('renders GFM: tables, task lists, strikethrough', () => {
    render(
      <MarkdownRenderer>
        {'| A | B |\n| - | - |\n| 1 | 2 |\n\n- [x] xong\n- [ ] chưa\n\n~~bỏ~~'}
      </MarkdownRenderer>,
    )
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
    expect(screen.getByText('bỏ').tagName).toBe('DEL')
  })

  it('never renders raw HTML', () => {
    const { container } = render(
      <MarkdownRenderer>
        {'<script>window.__pwned = 1</script>\n\n<img src=x onerror="alert(1)">\n\n<b>bold</b>'}
      </MarkdownRenderer>,
    )
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined()
  })

  it('opens links in a new tab with noopener noreferrer and drops javascript: URLs', () => {
    render(
      <MarkdownRenderer>
        {'[an toàn](https://example.com) và [xấu](javascript:alert(1))'}
      </MarkdownRenderer>,
    )
    const good = screen.getByRole('link', { name: 'an toàn' })
    expect(good).toHaveAttribute('target', '_blank')
    expect(good).toHaveAttribute('rel', 'noopener noreferrer')
    const bad = screen.getByText('xấu').closest('a')
    expect(bad?.getAttribute('href') ?? '').not.toContain('javascript:')
  })

  it('renders fenced code with a language label and a working copy button', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<MarkdownRenderer>{'```ts\nconst a = 1\n```'}</MarkdownRenderer>)
    expect(screen.getByText('ts')).toBeInTheDocument()
    expect(screen.getByText('const a = 1')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: S.code.copy }))
    expect(writeText).toHaveBeenCalledWith('const a = 1')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: S.code.copied })).toBeInTheDocument(),
    )
  })

  it('renders inline code without the block chrome', () => {
    render(<MarkdownRenderer>{'dùng `npm test` nhé'}</MarkdownRenderer>)
    expect(screen.getByText('npm test').tagName).toBe('CODE')
    expect(screen.queryByRole('button', { name: S.code.copy })).not.toBeInTheDocument()
  })
})
