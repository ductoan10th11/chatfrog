import { formatBytes, formatLatency, rangeFor, shortDate } from './format'

describe('admin format helpers', () => {
  it('formats storage in MB or GB', () => {
    expect(formatBytes(256 * 1024 * 1024)).toMatch(/^256 MB$/)
    expect(formatBytes(3 * 1024 ** 3)).toMatch(/^3 GB$/)
  })

  it('formats latency', () => {
    expect(formatLatency(null)).toBe('—')
    expect(formatLatency(142)).toBe('142 ms')
    expect(formatLatency(2500)).toContain('s')
  })

  it('builds an inclusive date range', () => {
    expect(rangeFor(7, new Date(2026, 9, 21))).toEqual({ from: '2026-10-15', to: '2026-10-21' })
    expect(rangeFor(30, new Date(2026, 9, 21)).from).toBe('2026-09-22')
  })

  it('shortens dates', () => {
    expect(shortDate('2026-10-21')).toBe('21/10')
  })
})
