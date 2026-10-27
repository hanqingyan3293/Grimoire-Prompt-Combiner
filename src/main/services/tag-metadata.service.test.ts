import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let root = ''
vi.mock('electron', () => ({ app: { getPath: () => root } }))
import { closeDatabase, getDatabase, initDatabase } from '../database'
import { getTagMetadata, listTagMetadata, saveTagMetadata } from './tag-metadata.service'

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-tag-metadata-'))
  await initDatabase()
  const db = getDatabase()
  db.run('INSERT INTO categories (id,group_id,en,zh,sort_order) VALUES (?,?,?,?,?)', ['cat', 'default', 'Character', '人物', 1])
  db.run('INSERT INTO subcategories (id,group_id,category_id,en,zh,sort_order) VALUES (?,?,?,?,?,?)', ['sub', 'default', 'cat', 'Face', '脸部', 1])
  db.run('INSERT INTO tags (id,group_id,subcategory_id,en,zh,sort_order,source) VALUES (?,?,?,?,?,?,?)', ['t_girl', 'default', 'sub', '1girl', '单个女孩', 1, 'builtin'])
  db.run('INSERT INTO tags (id,group_id,subcategory_id,en,zh,sort_order,source) VALUES (?,?,?,?,?,?,?)', ['t_smile', 'default', 'sub', 'smile', '微笑', 2, 'builtin'])
  // 与迁移流程一致的一行：normalized_key 已由标签情报同步填写。
  db.run('INSERT INTO tag_metadata (tag_id,namespace,normalized_key,description,color,is_active,source) VALUES (?,?,?,?,?,?,?)', ['t_girl', '', '1girl', '', '', 1, 'builtin'])
})

afterEach(() => {
  closeDatabase()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('tag metadata service', () => {
  it('round-trips a full save and read', () => {
    const saved = saveTagMetadata(getDatabase(), {
      tagId: 't_girl',
      namespace: 'character',
      description: '一个女孩',
      color: '#A855F7',
      isActive: false,
    })
    expect(saved).toEqual({ tagId: 't_girl', namespace: 'character', description: '一个女孩', color: '#A855F7', isActive: false, source: 'builtin' })

    const read = getTagMetadata(getDatabase(), 't_girl')
    expect(read).toEqual(saved)
  })

  it('inserts a metadata row for a tag that has none yet', () => {
    const saved = saveTagMetadata(getDatabase(), { tagId: 't_smile', namespace: 'expression', description: '微笑', color: '', isActive: true })
    expect(saved).toMatchObject({ tagId: 't_smile', namespace: 'expression', description: '微笑', color: '', isActive: true, source: 'manual' })
    expect(getTagMetadata(getDatabase(), 't_smile')).toEqual(saved)
  })

  it('preserves unprovided fields, normalized_key and source on update', () => {
    saveTagMetadata(getDatabase(), { tagId: 't_girl', description: '第一版描述' })
    const updated = saveTagMetadata(getDatabase(), { tagId: 't_girl', namespace: 'pose' })
    expect(updated.namespace).toBe('pose')
    expect(updated.description).toBe('第一版描述') // 未提供的字段沿用现有行，而不是被清空
    expect(updated.source).toBe('builtin')
    const row = getDatabase().exec('SELECT normalized_key,source FROM tag_metadata WHERE tag_id=?', ['t_girl'])[0]?.values?.[0]
    expect(String(row![0])).toBe('1girl') // 本服务不改写 normalized_key
    expect(String(row![1])).toBe('builtin')

    saveTagMetadata(getDatabase(), { tagId: 't_girl', namespace: 'pose', description: '第二版描述' })
    expect(getTagMetadata(getDatabase(), 't_girl')?.namespace).toBe('pose')
    expect(getTagMetadata(getDatabase(), 't_girl')?.description).toBe('第二版描述')
  })

  it('rejects invalid colors', () => {
    expect(() => saveTagMetadata(getDatabase(), { tagId: 't_girl', color: 'purple' })).toThrow('颜色无效')
    expect(() => saveTagMetadata(getDatabase(), { tagId: 't_girl', color: '#12345' })).toThrow('颜色无效')
    expect(() => saveTagMetadata(getDatabase(), { tagId: 't_girl', color: '#12345G' })).toThrow('颜色无效')
    expect(() => saveTagMetadata(getDatabase(), { tagId: 't_girl', color: 'red' })).toThrow('颜色无效')
    expect(getTagMetadata(getDatabase(), 't_girl')?.color).toBe('')
  })

  it('accepts an empty color as “clear the color” and normalizes case', () => {
    expect(saveTagMetadata(getDatabase(), { tagId: 't_girl', color: '#abcdef' }).color).toBe('#abcdef')
    expect(saveTagMetadata(getDatabase(), { tagId: 't_girl', color: '  ' }).color).toBe('')
  })

  it('rejects tags that do not exist', () => {
    expect(() => saveTagMetadata(getDatabase(), { tagId: 'missing-tag', description: 'x' })).toThrow('标签不存在')
    expect(() => saveTagMetadata(getDatabase(), { tagId: '' })).toThrow('标签 ID 无效')
  })

  it('enforces the namespace and description length limits', () => {
    expect(() => saveTagMetadata(getDatabase(), { tagId: 't_girl', namespace: 'x'.repeat(101) })).toThrow('命名空间')
    expect(saveTagMetadata(getDatabase(), { tagId: 't_girl', namespace: 'x'.repeat(100) }).namespace).toHaveLength(100)
    expect(() => saveTagMetadata(getDatabase(), { tagId: 't_girl', description: 'x'.repeat(2001) })).toThrow('描述')
    expect(saveTagMetadata(getDatabase(), { tagId: 't_girl', description: 'x'.repeat(2000) }).description).toHaveLength(2000)
  })

  it('keeps one entry per input id in list results, using null for missing rows', () => {
    saveTagMetadata(getDatabase(), { tagId: 't_girl', namespace: 'character' })
    const db = getDatabase()
    db.run('DELETE FROM tag_metadata WHERE tag_id=?', ['t_smile'])
    const rows = listTagMetadata(db, ['t_smile', 't_girl', 'missing-tag', 't_girl', ''])
    expect(rows).toHaveLength(5)
    expect(rows[0]).toBeNull()
    expect(rows[1]?.tagId).toBe('t_girl')
    expect(rows[1]?.namespace).toBe('character')
    expect(rows[2]).toBeNull()
    expect(rows[3]?.tagId).toBe('t_girl') // 重复 id 各自返回同一记录，顺序保持
    expect(rows[4]).toBeNull()
  })

  it('returns null from get for unknown or empty ids', () => {
    expect(getTagMetadata(getDatabase(), 'missing-tag')).toBeNull()
    expect(getTagMetadata(getDatabase(), '')).toBeNull()
    expect(listTagMetadata(getDatabase(), [])).toEqual([])
  })
})
