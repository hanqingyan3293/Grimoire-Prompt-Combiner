#!/usr/bin/env node
// scripts/bench-gallery.mjs — 图库组合查询性能基准（不进入 CI）
// Builds an in-memory SQLite mirroring the Grimoire media schema (schema v22:
// asset_tag_links.asset_ref_id + idx_asset_tag_links_ref) and times the SQL
// shapes gallery-query.service.ts compiles: tagFilter any/all joins, search,
// source+rating filters and sorted pagination over 100k assets.
// Usage: node scripts/bench-gallery.mjs [--rows=100000]

import { DatabaseSync } from 'node:sqlite'

const args = process.argv.slice(2)

function readNumberArg(name, fallback) {
  const prefix = '--' + name + '='
  const hit = args.find(value => value.startsWith(prefix))
  if (!hit) return fallback
  const parsed = Math.floor(Number(hit.slice(prefix.length)))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const ROWS = Math.max(1000, readNumberArg('rows', 100000))
const TAG_COUNT = 8000
const ROOT_TAGS = 1000
const RUNS = 50
const P95_LIMIT_MS = 500

// Deterministic PRNG so consecutive runs are comparable.
function mulberry32(seed) {
  let a = seed >>> 0
  return function random() {
    a |= 0
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const random = mulberry32(20261010)
const pick = n => Math.floor(random() * n)

const db = new DatabaseSync(':memory:')
db.exec(`
CREATE TABLE image_refs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL,
  storage_mode TEXT NOT NULL DEFAULT 'external',
  original_name TEXT,
  available INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  width INTEGER,
  height INTEGER
);
CREATE TABLE media_assets (
  id TEXT PRIMARY KEY,
  image_ref_id INTEGER NOT NULL UNIQUE,
  source_kind TEXT NOT NULL DEFAULT 'imported-reference',
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  favorite INTEGER NOT NULL DEFAULT 0,
  rating INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'available',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE asset_tag_links (
  id TEXT PRIMARY KEY,
  asset_type TEXT NOT NULL,
  asset_key TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  polarity TEXT NOT NULL DEFAULT 'neutral',
  weight REAL NOT NULL DEFAULT 1,
  confidence REAL NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'accepted',
  created_at TEXT NOT NULL,
  asset_ref_id INTEGER
);
CREATE INDEX idx_asset_tag_links_asset ON asset_tag_links(asset_type, asset_key, status);
CREATE INDEX idx_asset_tag_links_tag ON asset_tag_links(tag_id, status);
CREATE INDEX idx_asset_tag_links_ref ON asset_tag_links(asset_ref_id, status);
CREATE INDEX idx_media_assets_source ON media_assets(source_kind, updated_at DESC);
CREATE INDEX idx_media_assets_rating ON media_assets(favorite, rating, updated_at DESC);
`)

const insertRef = db.prepare('INSERT INTO image_refs (id,file_path,storage_mode,original_name,available,created_at,width,height) VALUES (?,?,?,?,?,?,?,?)')
const insertAsset = db.prepare('INSERT INTO media_assets (id,image_ref_id,source_kind,title,favorite,rating,status,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
const insertLink = db.prepare('INSERT INTO asset_tag_links (id,asset_type,asset_key,tag_id,polarity,weight,confidence,source,status,created_at,asset_ref_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)')

const WORDS = ['sunset', 'portrait', 'forest', 'cat', 'dog', 'beach']
const SOURCES = ['imported-reference', 'generated-api', 'external-link', 'generated-comfy']
const BASE_MS = Date.parse('2026-01-01T00:00:00.000Z')

const seedStart = performance.now()
db.exec('BEGIN')
try {
  for (let i = 1; i <= ROWS; i++) {
    const word = WORDS[pick(WORDS.length)]
    const created = new Date(BASE_MS + pick(ROWS) * 60000).toISOString()
    const updated = new Date(BASE_MS + pick(ROWS) * 60000).toISOString()
    const hasSize = random() >= 0.15
    insertRef.run(i, `C:/library/img_${i}_${word}.png`, 'external', `img_${i}_${word}.png`, random() < 0.9 ? 1 : 0, created, hasSize ? 512 + pick(4) * 256 : null, hasSize ? 512 + pick(4) * 256 : null)
    insertAsset.run(`media_image_${i}`, i, SOURCES[pick(SOURCES.length)], `Image ${i} ${word}`, random() < 0.2 ? 1 : 0, pick(6), 'available', '{}', created, updated)

    // Random tag closure: each asset carries a leaf tag, its root ancestor and
    // one unrelated tag (3 accepted/rejected links per asset).
    const leaf = ROOT_TAGS + pick(TAG_COUNT - ROOT_TAGS)
    const root = leaf % ROOT_TAGS
    let other = pick(TAG_COUNT)
    while (other === leaf || other === root) other = pick(TAG_COUNT)
    for (const tagIndex of [leaf, root, other]) {
      const status = random() < 0.92 ? 'accepted' : 'rejected'
      insertLink.run(`link_${i}_${tagIndex}`, 'image', `image:${i}`, 't' + tagIndex, 'neutral', 1, 1, 'bench', status, created, i)
    }
  }
  db.exec('COMMIT')
} catch (error) {
  db.exec('ROLLBACK')
  throw error
}
const seedMs = performance.now() - seedStart

const counts = {
  refs: db.prepare('SELECT COUNT(*) AS n FROM image_refs').get().n,
  assets: db.prepare('SELECT COUNT(*) AS n FROM media_assets').get().n,
  links: db.prepare('SELECT COUNT(*) AS n FROM asset_tag_links').get().n,
}

// SQL mirrors gallery-query.service.ts buildGallerySql().
const SELECT_COLUMNS = 'm.id,m.image_ref_id,m.title,r.original_name,m.source_kind,m.favorite,m.rating,r.available,r.width,r.height,m.created_at,m.updated_at'
const FROM_MAIN = 'FROM media_assets m JOIN image_refs r ON r.id=m.image_ref_id'
const tagJoin = (count, logicAll) =>
  `JOIN (SELECT asset_ref_id AS ref, COUNT(DISTINCT tag_id) AS matched FROM asset_tag_links WHERE asset_type='image' AND status='accepted' AND asset_ref_id IS NOT NULL AND tag_id IN (${Array.from({ length: count }, () => '?').join(',')}) GROUP BY asset_ref_id${logicAll ? ' HAVING COUNT(DISTINCT tag_id) = ?' : ''}) k ON k.ref = r.id`

const queries = [
  { name: 'tag-any-1', sql: `SELECT ${SELECT_COLUMNS} ${FROM_MAIN} ${tagJoin(1, false)} ORDER BY m.updated_at DESC, m.id ASC LIMIT ? OFFSET ?`, params: ['t0', 200, 0] },
  { name: 'tag-any-2', sql: `SELECT ${SELECT_COLUMNS} ${FROM_MAIN} ${tagJoin(2, false)} ORDER BY m.updated_at DESC, m.id ASC LIMIT ? OFFSET ?`, params: ['t0', 't1', 200, 0] },
  { name: 'tag-all-2', sql: `SELECT ${SELECT_COLUMNS} ${FROM_MAIN} ${tagJoin(2, true)} ORDER BY m.updated_at DESC, m.id ASC LIMIT ? OFFSET ?`, params: ['t0', 't1', 2, 200, 0] },
  { name: 'search', sql: `SELECT ${SELECT_COLUMNS} ${FROM_MAIN} WHERE (lower(m.title) LIKE ? OR lower(r.original_name) LIKE ?) ORDER BY m.updated_at DESC, m.id ASC LIMIT ? OFFSET ?`, params: ['%sunset%', '%sunset%', 200, 0] },
  { name: 'source-rating', sql: `SELECT ${SELECT_COLUMNS} ${FROM_MAIN} WHERE m.source_kind IN (?) AND m.rating>=? ORDER BY m.rating DESC, m.id ASC LIMIT ? OFFSET ?`, params: ['generated-api', 4, 200, 1000] },
  { name: 'page-sort', sql: `SELECT ${SELECT_COLUMNS} ${FROM_MAIN} ORDER BY m.updated_at DESC, m.id ASC LIMIT ? OFFSET ?`, params: [200, 5000] },
]

function measure(query) {
  const start = performance.now()
  const statement = db.prepare(query.sql)
  const rows = statement.all(...query.params)
  return { elapsed: performance.now() - start, matched: rows.length }
}

// Warm-up pass (statement compile + page cache) then the measured mixed run.
const warmup = { elapsed: 0, perQuery: new Map() }
for (const query of queries) {
  const result = measure(query)
  warmup.elapsed += result.elapsed
}

const durations = []
const perQuery = new Map(queries.map(query => [query.name, []]))
for (let run = 0; run < RUNS; run++) {
  const query = queries[run % queries.length]
  const result = measure(query)
  durations.push(result.elapsed)
  perQuery.get(query.name).push(result.elapsed)
}

const sorted = [...durations].sort((a, b) => a - b)
const percentile = p => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))]
const p50 = percentile(0.5)
const p95 = percentile(0.95)
const total = durations.reduce((sum, value) => sum + value, 0)
const max = sorted[sorted.length - 1]

const planRows = db.prepare('EXPLAIN QUERY PLAN ' + queries[0].sql).all(...queries[0].params)

const fmt = value => value.toFixed(1) + 'ms'
const perQueryLine = [...perQuery.entries()]
  .map(([name, values]) => `${name} avg ${fmt(values.reduce((s, v) => s + v, 0) / values.length)}`)
  .join(' | ')

console.log('=== gallery bench (grimoire, schema v22 shapes) ===')
console.log(`rows=${ROWS} (assets), links=${counts.links} (${(counts.links / ROWS).toFixed(2)} per asset), tags=${TAG_COUNT}`)
console.log(`seeded refs=${counts.refs} assets=${counts.assets} links=${counts.links} in ${fmt(seedMs)}`)
console.log('EXPLAIN QUERY PLAN (tag any):')
for (const row of planRows.slice(0, 6)) console.log('  ' + row.detail)
console.log(`mixed runs: ${RUNS} (warmup ${fmt(warmup.elapsed)}) total=${fmt(total)} p50=${fmt(p50)} p95=${fmt(p95)} max=${fmt(max)}`)
console.log('per-query: ' + perQueryLine)
console.log(p95 > P95_LIMIT_MS ? `FAIL p95 ${fmt(p95)} > ${P95_LIMIT_MS}ms` : `PASS p95 ${fmt(p95)} <= ${P95_LIMIT_MS}ms`)
if (p95 > P95_LIMIT_MS) process.exitCode = 1