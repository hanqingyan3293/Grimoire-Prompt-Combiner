import { describe, expect, it, vi } from 'vitest'
import { compileGallerySyntax, type GallerySyntaxResolvers } from './gallery-query-builder'

const tagDb = [
  { id: 't_1girl', en: '1girl', zh: '单个女孩' },
  { id: 't_smile', en: 'smile', zh: '微笑' },
  { id: 't_solo', en: 'solo', zh: '单人' },
  { id: 't_lowres', en: 'lowres', zh: '低分辨率' },
  { id: 't_expr', en: 'expression', zh: '表情' },
]

function makeResolvers() {
  const searchTags = vi.fn(async (input: Parameters<GallerySyntaxResolvers['searchTags']>[0]) => {
    if (input.namespace === 'scene') return [{ tag: { id: 't_beach', en: 'beach', zh: '海滩' } }]
    const query = String(input.query ?? '').toLowerCase()
    if (input.mode === 'prefix') {
      return tagDb.filter(tag => tag.en.startsWith(query)).map(tag => ({ tag, matchedBy: 'fuzzy' }))
    }
    const hit = tagDb.find(tag => tag.en === query || tag.zh === String(input.query ?? ''))
    return hit ? [{ tag: hit, matchedBy: 'canonical' }] : []
  })
  const expandDescendants = vi.fn(async (tagIds: string[]) =>
    tagIds.includes('t_expr') ? [{ tag: { id: 't_smile' } }, { tag: { id: 't_x' } }] : [],
  )
  return { searchTags, expandDescendants } satisfies GallerySyntaxResolvers
}

describe('gallery query builder', () => {
  it('compiles text terms and tag predicates with implicit AND', async () => {
    const compiled = await compileGallerySyntax('1girl tag:smile', makeResolvers())
    expect(compiled.patch.search).toBe('1girl')
    expect(compiled.patch.tagIds).toEqual(['t_smile'])
    expect(compiled.patch.tagLogic).toBe('all')
    expect(compiled.errors).toEqual([])
    expect(compiled.chips.map(chip => chip.kind)).toEqual(['text', 'tag'])
  })

  it('maps OR between tag predicates to any-logic', async () => {
    const compiled = await compileGallerySyntax('tag:1girl OR tag:solo', makeResolvers())
    expect(compiled.patch.tagLogic).toBe('any')
    expect(compiled.patch.tagIds?.sort()).toEqual(['t_1girl', 't_solo'])
    expect(compiled.errors).toEqual([])
  })

  it('routes negated tags to excludeTagIds', async () => {
    const compiled = await compileGallerySyntax('tag:1girl -tag:lowres', makeResolvers())
    expect(compiled.patch.tagIds).toEqual(['t_1girl'])
    expect(compiled.patch.excludeTagIds).toEqual(['t_lowres'])
    expect(compiled.chips.some(chip => chip.kind === 'exclude')).toBe(true)
  })

  it('expands parent predicates to their descendant closure', async () => {
    const compiled = await compileGallerySyntax('parent:expression', makeResolvers())
    expect(compiled.patch.tagLogic).toBe('any')
    expect(compiled.patch.tagIds?.sort()).toEqual(['t_expr', 't_smile', 't_x'])
    expect(compiled.chips[0]?.label).toContain('子孙')
  })

  it('resolves namespace predicates through the namespace search', async () => {
    const compiled = await compileGallerySyntax('namespace:scene', makeResolvers())
    expect(compiled.patch.tagIds).toEqual(['t_beach'])
    expect(compiled.patch.tagLogic).toBe('any')
  })

  it('applies attribute predicates to the query patch', async () => {
    const compiled = await compileGallerySyntax('rating:4..5 sort:name order:asc limit:120 favorite:true source:generated-comfy', makeResolvers())
    expect(compiled.patch.minRating).toBe(4)
    expect(compiled.patch.sort).toBe('name')
    expect(compiled.patch.order).toBe('asc')
    expect(compiled.patch.pageSize).toBe(120)
    expect(compiled.patch.favorite).toBe(true)
    expect(compiled.patch.sourceKinds).toEqual(['generated-comfy'])
    expect(compiled.errors).toEqual([])
  })

  it('reports unsupported text OR instead of approximating', async () => {
    const compiled = await compileGallerySyntax('1girl OR solo', makeResolvers())
    expect(compiled.errors.some(message => message.includes('OR'))).toBe(true)
    expect(compiled.patch.search).toBeUndefined()
  })

  it('reports unknown tag names as errors', async () => {
    const compiled = await compileGallerySyntax('tag:notexist', makeResolvers())
    expect(compiled.errors.some(message => message.includes('未知标签：notexist'))).toBe(true)
    expect(compiled.resolvedTagIds).toEqual([])
  })

  it('resolves wildcard tags in prefix mode', async () => {
    const resolvers = makeResolvers()
    const compiled = await compileGallerySyntax('tag:1g*', resolvers)
    expect(resolvers.searchTags).toHaveBeenCalledWith(expect.objectContaining({ query: '1g', mode: 'prefix' }))
    expect(compiled.patch.tagIds).toEqual(['t_1girl'])
  })

  it('rejects mixed parent and plain tag groups honestly', async () => {
    const compiled = await compileGallerySyntax('parent:expression tag:smile', makeResolvers())
    expect(compiled.errors.some(message => message.includes('组合暂不支持'))).toBe(true)
  })

  it('returns an empty compilation for empty input', async () => {
    const compiled = await compileGallerySyntax('   ', makeResolvers())
    expect(compiled.patch).toEqual({})
    expect(compiled.chips).toEqual([])
    expect(compiled.errors).toEqual([])
  })
})