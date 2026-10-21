import { cn } from './utils'

describe('cn', () => {
  it('merges conflicting tailwind classes', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4')
  })
  it('skips falsy values', () => {
    expect(cn('a', null, undefined, 'c')).toBe('a c')
  })
})
