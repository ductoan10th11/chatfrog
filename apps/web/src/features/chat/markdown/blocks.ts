const FENCE = /^ {0,3}(`{3,}|~{3,})/
const LIST_ITEM = /^ {0,3}([-*+]|\d{1,9}[.)])[ \t]/

/**
 * Split markdown into top-level blocks at blank lines, so a streaming message only re-parses
 * its last block. Never splits inside a code fence, before an indented line (continuation of
 * a list item / paragraph) or between items of the same list.
 */
export function splitBlocks(markdown: string): string[] {
  const lines = markdown.split('\n')
  const blocks: string[] = []
  let start = 0
  let fence: string | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const m = FENCE.exec(line)
    if (fence) {
      if (
        m &&
        m[1][0] === fence[0] &&
        m[1].length >= fence.length &&
        !line.slice(m[0].length).trim()
      )
        fence = null
      continue
    }
    if (m) {
      fence = m[1]
      continue
    }
    if (line.trim() !== '' || i === start) continue

    let next = i + 1
    while (next < lines.length && lines[next].trim() === '') next++
    if (next >= lines.length) break
    const following = lines[next]
    if (/^[ \t]/.test(following)) continue
    if (LIST_ITEM.test(following) && LIST_ITEM.test(lines[start])) continue

    blocks.push(lines.slice(start, next).join('\n'))
    start = next
    i = next - 1
  }
  blocks.push(lines.slice(start).join('\n'))
  return blocks
}
