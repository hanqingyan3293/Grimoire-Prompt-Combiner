import { describe, expect, it } from 'vitest'
import { parseVisionSuggestions } from './vision-output'

describe('parseVisionSuggestions', () => {
  it('normalizes JSON tag objects and strings', () => {
    expect(parseVisionSuggestions('[{"en":"1girl","zh":"女孩"},{"tag":"solo"},"smile"]')).toEqual([
      { en: '1girl', zh: '女孩' },
      { en: 'solo', zh: '' },
      { en: 'smile', zh: '' },
    ])
  })

  it('falls back to line and comma separated output', () => {
    expect(parseVisionSuggestions('blue eyes, 蓝眼睛\nlong hair，长发')).toEqual([
      { en: 'blue eyes', zh: '蓝眼睛' },
      { en: 'long hair', zh: '长发' },
    ])
  })
})
