import type { HighlighterCore, ThemedToken } from 'shiki/core'
import { THEME_DARK, THEME_LIGHT } from './themeNames'

/** Lazy language loaders: each language is its own chunk, fetched on first use. */
const LANGS: Record<string, () => Promise<unknown>> = {
  bash: () => import('shiki/langs/bash.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
  dockerfile: () => import('shiki/langs/dockerfile.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  php: () => import('shiki/langs/php.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  shellscript: () => import('shiki/langs/shellscript.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
}

const ALIASES: Record<string, string> = {
  ts: 'typescript',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  sh: 'shellscript',
  shell: 'shellscript',
  zsh: 'shellscript',
  console: 'shellscript',
  py: 'python',
  python3: 'python',
  yml: 'yaml',
  md: 'markdown',
  rs: 'rust',
  rb: 'ruby',
  golang: 'go',
  'c++': 'cpp',
  'c#': 'csharp',
  cs: 'csharp',
  docker: 'dockerfile',
  patch: 'diff',
  jsonc: 'json',
  json5: 'json',
  htm: 'html',
  xml: 'html',
}

export function resolveLanguage(lang: string | undefined): string | null {
  if (!lang) return null
  const key = lang.toLowerCase()
  const id = ALIASES[key] ?? key
  return id in LANGS ? id : null
}

let highlighterPromise: Promise<HighlighterCore> | null = null
const loadedLangs = new Map<string, Promise<void>>()

function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, themes] = await Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
      import('./themes'),
    ])
    return createHighlighterCore({
      themes: [themes.chatfrogLight, themes.chatfrogDark],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    })
  })()
  return highlighterPromise
}

async function ensureLanguage(h: HighlighterCore, id: string) {
  let p = loadedLangs.get(id)
  if (!p) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- shiki accepts any grammar module
    p = h.loadLanguage(LANGS[id]() as Promise<any>)
    loadedLangs.set(id, p)
  }
  await p
}

/**
 * Tokenize `code` for `lang`. Resolves to `null` for unknown languages
 * (caller renders plain text) or when highlighting fails.
 */
export async function highlight(
  code: string,
  lang: string | undefined,
  mode: 'light' | 'dark',
): Promise<ThemedToken[][] | null> {
  const id = resolveLanguage(lang)
  if (!id) return null
  try {
    const h = await getHighlighter()
    await ensureLanguage(h, id)
    return h.codeToTokensBase(code, {
      lang: id,
      theme: mode === 'dark' ? THEME_DARK : THEME_LIGHT,
    })
  } catch {
    return null
  }
}
