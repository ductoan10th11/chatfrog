import { isValidElement, memo, type ComponentProps, type ReactElement, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'
import { CodeBlock } from './CodeBlock'

const REMARK_PLUGINS = [remarkGfm]

/** Concatenate the text children of a (highlighted) code element. */
function nodeText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) return nodeText(node.props.children)
  return ''
}

const components: Components = {
  // Fenced blocks arrive as <pre><code class="language-x">; inline code never goes through <pre>.
  pre({ children }) {
    const child = Array.isArray(children) ? children[0] : children
    if (isValidElement<ComponentProps<'code'>>(child)) {
      const lang = /language-([\w+#-]+)/.exec(child.props.className ?? '')?.[1]
      const code = nodeText(child.props.children).replace(/\n$/, '')
      return <CodeBlock code={code} language={lang} />
    }
    return <pre>{children}</pre>
  },
  code({ className, children, ...props }) {
    return (
      <code
        className={cn(
          'rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.875em] break-words',
          className,
        )}
        {...props}
      >
        {children}
      </code>
    )
  },
  a({ href, children }) {
    // Model output is untrusted: always open in a new tab without opener/referrer.
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-foreground underline decoration-primary underline-offset-4 hover:decoration-foreground"
      >
        {children}
      </a>
    )
  },
  // Remote images are blocked by the CSP anyway; show the alt text instead of a broken image.
  img({ alt }) {
    return alt ? <span className="text-muted-foreground italic">{alt}</span> : null
  },
  p: ({ children }) => <p className="my-3 leading-7 first:mt-0 last:mb-0">{children}</p>,
  h1: ({ children }) => <h1 className="mt-6 mb-3 text-xl font-semibold first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-6 mb-3 text-lg font-semibold first:mt-0">{children}</h2>,
  h3: ({ children }) => (
    <h3 className="mt-5 mb-2 text-base font-semibold first:mt-0">{children}</h3>
  ),
  h4: ({ children }) => <h4 className="mt-4 mb-2 font-semibold first:mt-0">{children}</h4>,
  ul: ({ children, className }) => (
    <ul
      className={cn(
        'my-3 list-disc space-y-1.5 pl-6 marker:text-muted-foreground',
        className?.includes('contains-task-list') && 'list-none pl-1',
      )}
    >
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-3 list-decimal space-y-1.5 pl-6 marker:text-muted-foreground">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="leading-7 [&>ol]:my-1 [&>p]:my-1 [&>ul]:my-1">{children}</li>
  ),
  input: ({ checked }) => (
    <input
      type="checkbox"
      checked={checked}
      readOnly
      disabled
      className="mr-2 size-4 translate-y-0.5 accent-primary"
    />
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-4 border-l-2 border-primary pl-4 text-muted-foreground italic">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-6" />,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  table: ({ children }) => (
    <div className="my-4 scrollbar-thin overflow-x-auto rounded-xl border">
      <table className="w-full border-collapse text-sm [&_tr:last-child>td]:border-b-0">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-surface">{children}</thead>,
  th: ({ children, style }) => (
    <th className="border-b px-3 py-2 text-left font-medium whitespace-nowrap" style={style}>
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td className="border-b px-3 py-2 align-top" style={style}>
      {children}
    </td>
  ),
}

/**
 * GitHub-flavoured markdown. Raw HTML is never interpreted (react-markdown escapes it;
 * no rehype-raw), and `javascript:` URLs are removed by react-markdown's default urlTransform.
 */
function MarkdownRendererImpl({
  children,
  className,
}: {
  children: string
  className?: string
}): ReactElement {
  return (
    <div className={cn('text-[15px] break-words', className)}>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  )
}

export const MarkdownRenderer = memo(MarkdownRendererImpl)
