import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { getDatabase, saveDatabase } from '../database'

interface V4Tag { en: string; zh: string }
interface V4Sub { name: string; tags: V4Tag[] }
interface V4Cat { id?: string; name: string; subcategories: V4Sub[] }

function findV4Data(): { data: { categories: V4Cat[] }; path: string } | null {
  // Strategy 0: __dirname based (most reliable)
  // __dirname = dist/main/services/ → go up 4 levels to project root
  const fromDirname = [
    path.resolve(__dirname, '..', '..', '..', '..', 'v4.3', 'data', 'tags.json'),
    path.resolve(__dirname, '..', '..', '..', '..', '..', 'v4.3', 'data', 'tags.json'),
    path.resolve(__dirname, '..', '..', '..', 'v4.3', 'data', 'tags.json'),
  ]
  for (const p of fromDirname) {
    if (fs.existsSync(p)) {
      console.log('[Migration] Found via __dirname:', p)
      return { data: JSON.parse(fs.readFileSync(p, 'utf-8')), path: p }
    }
  }

  // Strategy 1: cwd based
  const fromCwd = [
    path.resolve(process.cwd(), '..', 'v4.3', 'data', 'tags.json'),
    path.resolve(process.cwd(), '..', '..', 'v4.3', 'data', 'tags.json'),
  ]
  for (const p of fromCwd) {
    if (fs.existsSync(p)) {
      console.log('[Migration] Found via cwd:', p)
      return { data: JSON.parse(fs.readFileSync(p, 'utf-8')), path: p }
    }
  }

  // Strategy 2: env var
  if (process.env.GRIMOIRE_V4_DATA && fs.existsSync(process.env.GRIMOIRE_V4_DATA)) {
    const p = process.env.GRIMOIRE_V4_DATA
    console.log('[Migration] Found via env:', p)
    return { data: JSON.parse(fs.readFileSync(p, 'utf-8')), path: p }
  }

  return null
}

export async function runMigration(): Promise<void> {
  const db = getDatabase()

  const status = db.exec('SELECT version FROM migration_status WHERE version = 1')
  if (status[0]?.values?.length) {
    console.log('[Migration] Already at v1, skipping')
    return
  }

  const existing = db.exec('SELECT COUNT(*) FROM tags')
  if ((existing[0]?.values?.[0]?.[0] as number) > 0) {
    console.log('[Migration] Data exists, marking v1')
    db.run("INSERT OR REPLACE INTO migration_status (version, source_version) VALUES (1, 'existing')")
    saveDatabase()
    return
  }

  const v4 = findV4Data()

  if (!v4) {
    console.log('[Migration] No v4.3 data found. Set GRIMOIRE_V4_DATA env var to import.')
    insertDefaultData(db)
    db.run("INSERT OR REPLACE INTO migration_status (version, source_version) VALUES (1, 'default')")
    saveDatabase()
    return
  }

  console.log('[Migration] Importing:', v4.path)

  const insTag = db.prepare(
    "INSERT INTO tags (id, subcategory_id, en, zh, sort_order, source) VALUES (?, ?, ?, ?, ?, 'builtin')"
  )
  const insCat = db.prepare('INSERT INTO categories (id, name, sort_order) VALUES (?, ?, ?)')
  const insSub = db.prepare('INSERT INTO subcategories (id, category_id, name, sort_order) VALUES (?, ?, ?, ?)')

  let ci = 0
  for (const cat of v4.data.categories) {
    const catId = cat.id || 'cat_v4_' + ci
    insCat.run([catId, cat.name, ci])
    let si = 0
    for (const sub of cat.subcategories || []) {
      const subId = 'sub_v4_' + ci + '_' + si
      insSub.run([subId, catId, sub.name, si])
      let ti = 0
      for (const tag of sub.tags || []) {
        insTag.run(['tag_v4_' + ci + '_' + si + '_' + ti, subId, tag.en, tag.zh || '', ti])
        ti++
      }
      si++
    }
    ci++
  }
  insTag.free(); insCat.free(); insSub.free()
  console.log('[Migration] Imported ' + ci + ' categories with tags')

  // Migrate presets
  const presetDir = path.resolve(path.dirname(v4.path), '..', 'presets')
  if (fs.existsSync(presetDir)) {
    const files = fs.readdirSync(presetDir).filter(f => f.endsWith('.json'))
    for (const f of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(presetDir, f), 'utf-8'))
        const stmt = db.prepare('INSERT OR IGNORE INTO presets (id, name, data, created_at) VALUES (?, ?, ?, ?)')
        stmt.run(['preset_v4_' + f.replace('.json', ''), data.name || f, JSON.stringify(data), data.created || ''])
        stmt.free()
      } catch { /* skip corrupt presets */ }
    }
  }

  // Migrate history
  const historyDir = path.resolve(path.dirname(v4.path), '..', 'history')
  if (fs.existsSync(historyDir)) {
    const files = fs.readdirSync(historyDir).filter(f => f.endsWith('.json'))
    for (const f of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(historyDir, f), 'utf-8'))
        const stmt = db.prepare('INSERT OR IGNORE INTO history (id, prompt, data, created_at) VALUES (?, ?, ?, ?)')
        stmt.run([f.replace('.json', ''), data.prompt || '', JSON.stringify(data), data.created || ''])
        stmt.free()
      } catch { /* skip */ }
    }
  }

  db.run("INSERT OR REPLACE INTO migration_status (version, source_version) VALUES (1, 'v4.3')")
  saveDatabase()
  console.log('[Migration] Complete - v4.3 data imported')
}

function insertDefaultData(db: any): void {
  const defaults: V4Cat[] = [
    {
      name: '\u8d28\u91cf', subcategories: [{
        name: '\u57fa\u7840\u8d28\u91cf', tags: [
          { en: 'masterpiece', zh: '\u6770\u4f5c' },
          { en: 'best_quality', zh: '\u6700\u9ad8\u8d28\u91cf' },
          { en: 'high_quality', zh: '\u9ad8\u8d28\u91cf' },
          { en: 'intricate_details', zh: '\u7cbe\u7ec6\u7ec6\u8282' },
          { en: 'sharp_focus', zh: '\u6e05\u6670\u5bf9\u7126' },
        ]
      }]
    },
    {
      name: '\u98ce\u683c', subcategories: [{
        name: '\u5e38\u89c1\u98ce\u683c', tags: [
          { en: 'anime_style', zh: '\u52a8\u6f2b\u98ce\u683c' },
          { en: 'oil_painting', zh: '\u6cb9\u753b\u98ce\u683c' },
          { en: 'watercolor', zh: '\u6c34\u5f69\u98ce\u683c' },
          { en: 'digital_art', zh: '\u6570\u5b57\u827a\u672f' },
          { en: 'photorealistic', zh: '\u7167\u7247\u7ea7\u5199\u5b9e' },
        ]
      }]
    },
    {
      name: '\u8d1f\u9762\u8bcd', subcategories: [{
        name: '\u5e38\u7528\u8d1f\u9762', tags: [
          { en: 'low_quality', zh: '\u4f4e\u8d28\u91cf' },
          { en: 'blurry', zh: '\u6a21\u7cca' },
          { en: 'bad_anatomy', zh: '\u7cdf\u7cd5\u7684\u4eba\u4f53\u7ed3\u6784' },
          { en: 'extra_fingers', zh: '\u591a\u4f59\u7684\u624b\u6307' },
          { en: 'ugly', zh: '\u4e11\u964b' },
        ]
      }]
    },
  ]

  const cs = db.prepare('INSERT INTO categories (id, name, sort_order) VALUES (?, ?, ?)')
  const ss = db.prepare('INSERT INTO subcategories (id, category_id, name, sort_order) VALUES (?, ?, ?, ?)')
  const ts = db.prepare("INSERT INTO tags (id, subcategory_id, en, zh, sort_order, source) VALUES (?, ?, ?, ?, ?, 'builtin')")

  let ci = 0
  for (const cat of defaults) {
    cs.run(['cat_default_' + ci, cat.name, ci])
    let si = 0
    for (const sub of cat.subcategories) {
      ss.run(['sub_default_' + ci + '_' + si, 'cat_default_' + ci, sub.name, si])
      let ti = 0
      for (const tag of sub.tags) {
        ts.run(['tag_default_' + ci + '_' + si + '_' + ti, 'sub_default_' + ci + '_' + si, tag.en, tag.zh, ti])
        ti++
      }
      si++
    }
    ci++
  }
  cs.free(); ss.free(); ts.free()
}