import { describe, expect, it } from 'vitest'
import { analyzeFriendLocalSnapshot, planFriendPromptMigration } from './friend-migration.core'

describe('friend project migration planning', () => {
  const source = [
    { id: 1, name: '构图一', tags: 'wide shot, rim light', chapter: '构图', nsfw: false, variantCount: 1 },
    { id: 2, name: '构图一', tags: 'wide shot, rim light', chapter: '构图', nsfw: false, variantCount: 1 },
    { id: 3, name: '', tags: '', chapter: '构图' },
  ]

  it('normalizes rows, removes exact duplicates and creates stable source ids', () => {
    const first = planFriendPromptMigration(source)
    const second = planFriendPromptMigration(JSON.stringify(source))
    expect(first.total).toBe(1)
    expect(first.skipped).toBe(1)
    expect(first.additions[0].sourceId).toBe(second.additions[0].sourceId)
    expect(first.warnings).toHaveLength(2)
  })

  it('makes repeated migrations idempotent', () => {
    const first = planFriendPromptMigration(source)
    const second = planFriendPromptMigration(source, first.additions.map(entry => entry.sourceId))
    expect(second.additions).toHaveLength(0)
    expect(second.duplicates).toHaveLength(1)
  })

  it('summarizes localStorage without returning API keys', () => {
    const summary = analyzeFriendLocalSnapshot({
      grimoire_favorites: JSON.stringify({ '构图一': { addedAt: 1 } }),
      grimoire_builder_tags: JSON.stringify([{ name: 'wide shot' }]),
      llm_reverse_config: JSON.stringify({ api_key: 'secret-key', base_url: 'https://example.com/v1', model: 'vision' }),
    })
    expect(summary.favoriteNames).toEqual(['构图一'])
    expect(summary.builderTags).toHaveLength(1)
    expect(summary.providerHints[0]).toEqual({ kind: 'reverse', baseUrl: 'https://example.com/v1', model: 'vision', hadApiKey: true })
    expect(JSON.stringify(summary)).not.toContain('secret-key')
  })
})
