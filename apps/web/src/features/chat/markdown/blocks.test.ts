import { splitBlocks } from './blocks'

describe('splitBlocks', () => {
  it('splits paragraphs and headings at blank lines', () => {
    expect(splitBlocks('# Title\n\nPara one\nstill one\n\nPara two')).toEqual([
      '# Title\n',
      'Para one\nstill one\n',
      'Para two',
    ])
  })

  it('never splits inside a code fence', () => {
    const md = 'Intro\n\n```go\nfunc a() {}\n\nfunc b() {}\n```\n\nAfter'
    expect(splitBlocks(md)).toEqual([
      'Intro\n',
      '```go\nfunc a() {}\n\nfunc b() {}\n```\n',
      'After',
    ])
  })

  it('keeps an unclosed (still streaming) fence in the last block', () => {
    expect(splitBlocks('Intro\n\n```py\nx = 1\n\ny = 2')).toEqual([
      'Intro\n',
      '```py\nx = 1\n\ny = 2',
    ])
  })

  it('keeps loose lists and indented continuations together', () => {
    const md = '1. one\n\n2. two\n\n   more about two\n\nNext para'
    expect(splitBlocks(md)).toEqual(['1. one\n\n2. two\n\n   more about two\n', 'Next para'])
  })

  it('joins back to the original text', () => {
    const md = 'a\n\n\n- x\n- y\n\n> quote\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nend\n'
    expect(splitBlocks(md).join('\n')).toBe(md)
  })
})
