import { hashString } from './utils'

/**
 * Procedurally generated SVG "artwork" so image flows work offline.
 * Deterministic per file id; green/neutral palette only.
 */
export function generatedImageSvg(id: string, width = 1024, height = 1024, label = ''): string {
  const h = hashString(id)
  const rnd = (n: number) => {
    // xorshift on top of the hash, deterministic per (id, n)
    let x = (h ^ Math.imul(n + 1, 2654435761)) >>> 0
    x ^= x << 13
    x >>>= 0
    x ^= x >>> 17
    x ^= x << 5
    x >>>= 0
    return x / 0xffffffff
  }
  const greens = ['#e7f5ec', '#cdeedb', '#a9dfc0', '#86cfa3', '#7cc69a', '#5fb383', '#3f9a64']
  const bgA = greens[Math.floor(rnd(1) * 3)]
  const bgB = greens[3 + Math.floor(rnd(2) * 3)]
  const blobs = Array.from({ length: 7 }, (_, i) => {
    const cx = rnd(10 + i) * width
    const cy = rnd(20 + i) * height
    const r = (0.1 + rnd(30 + i) * 0.28) * Math.min(width, height)
    const fill = greens[Math.floor(rnd(40 + i) * greens.length)]
    const op = (0.25 + rnd(50 + i) * 0.5).toFixed(2)
    return `<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${r.toFixed(0)}" fill="${fill}" opacity="${op}"/>`
  }).join('')
  // A simple frog-ish face on top, so the result reads as "generated art".
  const s = Math.min(width, height)
  const cx = width / 2
  const cy = height * 0.55
  const eye = s * 0.1
  const face = `
    <g>
      <ellipse cx="${cx}" cy="${cy}" rx="${s * 0.3}" ry="${s * 0.23}" fill="#5fb383"/>
      <circle cx="${cx - s * 0.14}" cy="${cy - s * 0.2}" r="${eye * 1.3}" fill="#5fb383"/>
      <circle cx="${cx + s * 0.14}" cy="${cy - s * 0.2}" r="${eye * 1.3}" fill="#5fb383"/>
      <circle cx="${cx - s * 0.14}" cy="${cy - s * 0.2}" r="${eye}" fill="#ffffff"/>
      <circle cx="${cx + s * 0.14}" cy="${cy - s * 0.2}" r="${eye}" fill="#ffffff"/>
      <circle cx="${cx - s * 0.13}" cy="${cy - s * 0.19}" r="${eye * 0.5}" fill="#0e1f15"/>
      <circle cx="${cx + s * 0.13}" cy="${cy - s * 0.19}" r="${eye * 0.5}" fill="#0e1f15"/>
      <path d="M ${cx - s * 0.17} ${cy + s * 0.02} Q ${cx} ${cy + s * 0.14} ${cx + s * 0.17} ${cy + s * 0.02}" fill="none" stroke="#0e1f15" stroke-width="${s * 0.012}" stroke-linecap="round"/>
    </g>`
  const caption = label
    ? `<text x="${width / 2}" y="${height - s * 0.05}" text-anchor="middle" font-family="sans-serif" font-size="${s * 0.028}" fill="#0e1f15" opacity="0.55">${escapeXml(label.slice(0, 60))}</text>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bgA}"/><stop offset="1" stop-color="${bgB}"/></linearGradient></defs>
  <rect width="${width}" height="${height}" fill="url(#g)"/>
  ${blobs}
  ${face}
  ${caption}
</svg>`
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

export function parseSize(size: string | undefined): { width: number; height: number } {
  const m = /^(\d+)x(\d+)$/.exec(size ?? '')
  return m ? { width: Number(m[1]), height: Number(m[2]) } : { width: 1024, height: 1024 }
}
