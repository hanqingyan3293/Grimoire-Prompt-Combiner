// 魔导书 Grimoire v7 — 图库查询语法编译器
// Compiles the shared search-syntax AST (TagStudio/Hydrus-inspired clean-room
// subset) into a gallery store patch plus predicate chips. Tag names resolve
// through injected resolvers so the compiler is fully testable. Mixed
// parent/namespace/tag combinations that the flat tagFilter model cannot
// express honestly are reported as errors instead of being approximated.
import { parseSearchSyntax, type SearchSyntaxNode } from '@shared/tag-search-syntax'
import type { GalleryQueryState } from '../stores/gallery.store'

export interface GallerySyntaxResolvers {
  searchTags(input: { query?: string; limit?: number; namespace?: string; mode?: 'substring' | 'prefix'; sort?: 'score' | 'usage' | 'alpha' }): Promise<Array<{ tag: { id: string; en?: string; zh?: string }; matchedBy?: string }>>
  expandDescendants(tagIds: string[]): Promise<Array<{ tag: { id: string } }>>
}

export interface PredicateChip {
  id: string
  kind: 'text' | 'tag' | 'exclude' | 'parent' | 'namespace' | 'attr' | 'error'
  label: string
}

/** Query patch plus the store-root page size (limit: predicate). */
export type GalleryQueryPatch = Partial<GalleryQueryState> & { pageSize?: number }

export interface CompiledGallerySyntax {
  patch: GalleryQueryPatch
  chips: PredicateChip[]
  errors: string[]
  resolvedTagIds: string[]
  excludedTagIds: string[]
}

const NAMESPACE_RESULT_CAP = 500
const WILDCARD_RESULT_CAP = 50

function collectAndChildren(node: SearchSyntaxNode | null): SearchSyntaxNode[] {
  if (!node) return []
  if (node.kind === 'and') return node.children.flatMap(collectAndChildren)
  return [node]
}

async function resolveExactTag(resolvers: GallerySyntaxResolvers, name: string): Promise<string | null> {
  const results = await resolvers.searchTags({ query: name, limit: 5 })
  const needle = name.trim().toLowerCase()
  const exact = results.find(entry => String(entry.tag.en || '').toLowerCase() === needle || String(entry.tag.zh || '') === name.trim())
  if (exact) return String(exact.tag.id)
  const aliasHit = results.find(entry => entry.matchedBy === 'alias')
  return aliasHit ? String(aliasHit.tag.id) : null
}

async function resolveWildcardTags(resolvers: GallerySyntaxResolvers, value: string): Promise<string[]> {
  const hasWildcard = value.includes('*')
  if (!hasWildcard) return []
  const stripped = value.replace(/\*+/g, ' ').trim()
  if (!stripped) return []
  const edgeWildcard = value.startsWith('*') || value.endsWith('*')
  const results = await resolvers.searchTags({ query: stripped, limit: WILDCARD_RESULT_CAP, mode: edgeWildcard ? 'prefix' : 'substring' })
  return results.map(entry => String(entry.tag.id))
}

export async function compileGallerySyntax(text: string, resolvers: GallerySyntaxResolvers): Promise<CompiledGallerySyntax> {
  const parsed = parseSearchSyntax(text)
  const errors = [...parsed.errors]
  const chips: PredicateChip[] = []
  const patch: GalleryQueryPatch = {}
  const includeIds: string[] = []
  const excludeIds: string[] = []
  let includeLogic: 'all' | 'any' = 'all'
  let logicPinned = false
  let includeGroupKind: 'none' | 'tag' | 'parent' | 'namespace' = 'none'
  const textTerms: string[] = []
  let chipSeq = 0
  const nextChipId = () => 'chip_' + (++chipSeq)

  const fail = (message: string) => {
    errors.push(message)
    chips.push({ id: nextChipId(), kind: 'error', label: message })
  }

  const applyAttr = (key: string, value: string) => {
    const normalized = value.trim()
    if (!normalized) {
      fail(`谓词缺少数值：${key}`)
      return
    }
    if (key === 'source') {
      patch.sourceKinds = [normalized]
      chips.push({ id: nextChipId(), kind: 'attr', label: `来源 ${normalized}` })
      return
    }
    if (key === 'favorite') {
      if (!['true', 'false', 'yes', 'no', '1', '0'].includes(normalized.toLowerCase())) {
        fail('favorite 仅支持 true/false')
        return
      }
      patch.favorite = ['true', 'yes', '1'].includes(normalized.toLowerCase())
      chips.push({ id: nextChipId(), kind: 'attr', label: patch.favorite ? '已收藏' : '未收藏' })
      return
    }
    if (key === 'rating') {
      const match = normalized.match(/^(\d)(?:\.\.(\d))?$/)
      if (!match) {
        fail('rating 仅支持 0-5 或区间如 4..5')
        return
      }
      patch.minRating = Math.min(5, Math.max(0, Number(match[1])))
      chips.push({ id: nextChipId(), kind: 'attr', label: match[2] ? `评分 ${match[1]}-${match[2]}` : `评分 ≥${match[1]}` })
      return
    }
    if (key === 'sort') {
      if (!['updated', 'created', 'rating', 'name'].includes(normalized)) {
        fail('sort 仅支持 updated/created/rating/name')
        return
      }
      patch.sort = normalized as GalleryQueryState['sort']
      chips.push({ id: nextChipId(), kind: 'attr', label: `排序 ${normalized}` })
      return
    }
    if (key === 'order') {
      if (!['asc', 'desc'].includes(normalized.toLowerCase())) {
        fail('order 仅支持 asc/desc')
        return
      }
      patch.order = normalized.toLowerCase() as GalleryQueryState['order']
      chips.push({ id: nextChipId(), kind: 'attr', label: normalized.toLowerCase() === 'asc' ? '升序' : '降序' })
      return
    }
    if (key === 'limit') {
      const value = Number(normalized)
      if (!Number.isFinite(value) || value <= 0) {
        fail('limit 必须是正数')
        return
      }
      const clamped = Math.max(20, Math.min(1000, Math.floor(value)))
      patch.pageSize = clamped
      chips.push({ id: nextChipId(), kind: 'attr', label: `每页 ${clamped}` })
      return
    }
  }

  const addTagIds = (kind: 'tag' | 'parent' | 'namespace', ids: string[], label: string, logic: 'all' | 'any') => {
    if (!ids.length) return
    if (includeGroupKind !== 'none' && includeGroupKind !== kind) {
      fail('父标签/命名空间/普通标签的组合暂不支持，请分开查询或使用筛选轨')
      return
    }
    if (includeGroupKind === 'none') {
      includeGroupKind = kind
    } else if (includeLogic !== logic) {
      fail('同一查询内暂不支持混合 any/all 标签逻辑')
      return
    }
    includeLogic = logicPinned ? includeLogic : logic
    logicPinned = true
    for (const id of ids) if (!includeIds.includes(id)) includeIds.push(id)
    chips.push({ id: nextChipId(), kind, label })
  }

  const resolveTagNode = async (node: Extract<SearchSyntaxNode, { kind: 'tag' }>): Promise<string[] | null> => {
    const value = node.value.trim()
    if (!value) return null
    if (value.includes('*')) {
      const wildcardIds = await resolveWildcardTags(resolvers, value)
      if (!wildcardIds.length) {
        fail(`通配标签无匹配：${value}`)
        return null
      }
      return wildcardIds
    }
    const id = await resolveExactTag(resolvers, value)
    if (!id) {
      fail(`未知标签：${value}`)
      return null
    }
    return [id]
  }

  for (const node of collectAndChildren(parsed.ast)) {
    if (node.kind === 'text') {
      const value = node.value.trim()
      if (value) {
        textTerms.push(value)
        chips.push({ id: nextChipId(), kind: 'text', label: `文本“${value}”` })
      }
      continue
    }
    if (node.kind === 'attr') {
      // The parser normalizes tag/parent/namespace/name into dedicated node
      // kinds; attr nodes carry only source/favorite/rating/sort/order/limit.
      applyAttr(node.key, node.value)
      continue
    }
    if (node.kind === 'parent') {
      const parentId = await resolveExactTag(resolvers, node.value.trim())
      if (!parentId) {
        fail(`未知标签：${node.value}`)
        continue
      }
      const closure = await resolvers.expandDescendants([parentId])
      const ids = [parentId, ...closure.map(entry => String(entry.tag.id))]
      const unique = [...new Set(ids)]
      addTagIds('parent', unique, `父标签“${node.value}”（含 ${unique.length - 1} 个子孙）`, 'any')
      continue
    }
    if (node.kind === 'namespace') {
      const results = await resolvers.searchTags({ query: '', namespace: node.value.trim(), limit: NAMESPACE_RESULT_CAP, sort: 'usage' })
      if (!results.length) {
        fail(`命名空间无匹配标签：${node.value}`)
        continue
      }
      const ids = results.map(entry => String(entry.tag.id))
      const capped = results.length >= NAMESPACE_RESULT_CAP ? '（已达 500 上限）' : ''
      addTagIds('namespace', ids, `命名空间“${node.value}”（${ids.length} 个标签${capped}）`, 'any')
      continue
    }
    if (node.kind === 'tag') {
      const ids = await resolveTagNode(node)
      if (ids) addTagIds('tag', ids, `标签“${node.value}”`, 'all')
      continue
    }
    if (node.kind === 'not') {
      const child = node.child
      if (child.kind === 'tag' || child.kind === 'parent' || child.kind === 'namespace') {
        let ids: string[] | null = null
        if (child.kind === 'tag') ids = await resolveTagNode(child)
        else if (child.kind === 'parent') {
          const parentId = await resolveExactTag(resolvers, child.value.trim())
          if (!parentId) fail(`未知标签：${child.value}`)
          else {
            const closure = await resolvers.expandDescendants([parentId])
            ids = [parentId, ...closure.map(entry => String(entry.tag.id))]
          }
        } else {
          const results = await resolvers.searchTags({ query: '', namespace: child.value.trim(), limit: NAMESPACE_RESULT_CAP, sort: 'usage' })
          ids = results.map(entry => String(entry.tag.id))
          if (!ids.length) fail(`命名空间无匹配标签：${child.value}`)
        }
        if (ids?.length) {
          for (const id of ids) if (!excludeIds.includes(id)) excludeIds.push(id)
          chips.push({ id: nextChipId(), kind: 'exclude', label: `排除“${child.value}”` })
        }
      } else if (child.kind === 'text') {
        fail('暂不支持排除文本词（文件名不含反选）')
      } else if (child.kind === 'attr') {
        fail(`暂不支持排除谓词：${child.key}`)
      } else {
        fail('暂不支持嵌套排除')
      }
      continue
    }
    if (node.kind === 'or') {
      const allTags = node.children.every(child => child.kind === 'tag')
      if (!allTags) {
        fail('OR 目前仅支持标签谓词之间（如 tag:a OR tag:b），文本/谓词的 OR 暂不支持')
        continue
      }
      const ids: string[] = []
      let anyUnknown = false
      for (const child of node.children as Array<Extract<SearchSyntaxNode, { kind: 'tag' }>>) {
        const resolved = await resolveTagNode(child)
        if (resolved) ids.push(...resolved)
        else anyUnknown = true
      }
      if (ids.length && !anyUnknown) addTagIds('tag', [...new Set(ids)], `标签任一（${ids.length} 个）`, 'any')
      continue
    }
    // Nested and-nodes are flattened by collectAndChildren; nothing else remains.
  }

  if (textTerms.length) patch.search = textTerms.join(' ')
  if (includeIds.length || excludeIds.length) {
    patch.tagIds = includeIds
    if (includeIds.length) patch.tagLogic = includeLogic
    patch.excludeTagIds = excludeIds
  }

  return { patch, chips, errors, resolvedTagIds: includeIds, excludedTagIds: excludeIds }
}