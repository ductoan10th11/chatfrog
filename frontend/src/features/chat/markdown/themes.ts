import type { ThemeRegistrationRaw } from 'shiki/core'
import { THEME_DARK, THEME_LIGHT } from './themeNames'

/**
 * Code themes restricted to the ChatFrog palette: neutral grays plus the green primary.
 * (Syntax highlighting is told apart by lightness, weight and style, not by extra hues.)
 */
type Palette = {
  fg: string
  comment: string
  keyword: string
  string: string
  number: string
  fn: string
  type: string
  punct: string
}

function makeTheme(name: string, type: 'light' | 'dark', c: Palette): ThemeRegistrationRaw {
  return {
    name,
    type,
    colors: { 'editor.foreground': c.fg, 'editor.background': '#00000000' },
    settings: [
      { settings: { foreground: c.fg } },
      {
        scope: ['comment', 'punctuation.definition.comment'],
        settings: { foreground: c.comment, fontStyle: 'italic' },
      },
      {
        scope: [
          'keyword',
          'storage',
          'storage.type',
          'keyword.control',
          'keyword.operator.new',
          'keyword.operator.expression',
        ],
        settings: { foreground: c.keyword, fontStyle: 'bold' },
      },
      {
        scope: ['string', 'string.quoted', 'punctuation.definition.string'],
        settings: { foreground: c.string },
      },
      {
        scope: ['constant.numeric', 'constant.language', 'constant.character', 'constant.other'],
        settings: { foreground: c.number },
      },
      {
        scope: [
          'entity.name.function',
          'support.function',
          'meta.function-call',
          'entity.name.tag',
        ],
        settings: { foreground: c.fn },
      },
      {
        scope: [
          'entity.name.type',
          'entity.name.class',
          'support.type',
          'support.class',
          'entity.other.inherited-class',
        ],
        settings: { foreground: c.type, fontStyle: 'bold' },
      },
      {
        scope: ['variable.parameter', 'entity.other.attribute-name'],
        settings: { foreground: c.type, fontStyle: 'italic' },
      },
      {
        scope: ['punctuation', 'meta.brace', 'keyword.operator'],
        settings: { foreground: c.punct },
      },
      {
        scope: ['markup.heading', 'entity.name.section'],
        settings: { foreground: c.keyword, fontStyle: 'bold' },
      },
      { scope: ['markup.bold'], settings: { fontStyle: 'bold' } },
      { scope: ['markup.italic'], settings: { fontStyle: 'italic' } },
      { scope: ['markup.inserted', 'markup.inserted.diff'], settings: { foreground: c.keyword } },
      {
        scope: ['markup.deleted', 'markup.deleted.diff'],
        settings: { foreground: c.comment, fontStyle: 'italic' },
      },
    ],
  }
}

export const chatfrogLight = makeTheme(THEME_LIGHT, 'light', {
  fg: '#1f2421',
  comment: '#6f7872',
  keyword: '#25704a',
  string: '#3a8a5d',
  number: '#1f6a44',
  fn: '#16553a',
  type: '#46584d',
  punct: '#5b665f',
})

export const chatfrogDark = makeTheme(THEME_DARK, 'dark', {
  fg: '#e2e6e3',
  comment: '#8a938d',
  keyword: '#86cfa3',
  string: '#a9dfc0',
  number: '#7cc69a',
  fn: '#c9ecd8',
  type: '#a3b6aa',
  punct: '#9aa29d',
})
