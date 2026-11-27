// 魔导书 Grimoire v7 — SQLite 数据库管理
import { DatabaseSync } from 'node:sqlite'
import crypto from 'crypto'
import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import { createLegacyDatabase, type LegacyDatabase } from './services/sqlite.compat'

// v31 makes `ai_attachments.session_id` nullable so a LIBRARY file (no session) is
// storable without a fake session; v30 adds perceptual hashes for similarity +
// duplicate detection and the clip_embeddings table for semantic similarity; v25
// adds the remaining MCP server form columns (long_running/registry_url/tags);
// v24 adds MCP server columns (description/headers/timeout); v23 adds the
// tag_saved_searches table for the gallery panel. Previous waves: v22 gallery data
// layer, v21 tag-data repairs, v20 Cherry resource-state projection.
// Keep this bumped so existing databases receive the migrations before
// indexes. Exported so schema tests can pin to the constant instead of a
// literal that drifts when either workstream bumps the version.
// Selected from live v31 on 2026-10-12; v32 adds reusable blueprints ONLY.
// No inference/backfill from either legacy or unified execution sessions.
// v33: opt-in topic-owned message tree; no legacy message adoption/backfill.
// v34: real Agent workspace repository only; empty on upgrade, no session inference.
// v35: opt-in one-to-one Agent session read model; no copied sessions/history or backfill.
// v36: NovelAI work/version tree (work, version, branch_name, version_image). Empty on upgrade —
// no inference from prompt assets or sessions.
// v37: soft-delete (recycle bin) columns for NovelAI versions and works.
// v38: NovelAI asset library + asset_usage (which image used which asset).
// v39: embedded browser history (browser_history). Empty on upgrade — nothing to infer.
// v40: imported bookmarks (browser_bookmark). Deduplicated by URL.
export const CURRENT_SCHEMA_VERSION = 42
let nativeDb: DatabaseSync | null = null
let db: LegacyDatabase | null = null
let dbPath = ''

const SCHEMA_SQL = `

CREATE TABLE IF NOT EXISTS tag_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  is_active INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  group_id TEXT DEFAULT 'default',
  en TEXT NOT NULL,
  zh TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS subcategories (
  id TEXT PRIMARY KEY,
  group_id TEXT DEFAULT 'default',
  category_id TEXT NOT NULL,
  en TEXT NOT NULL,
  zh TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  group_id TEXT DEFAULT 'default',
  subcategory_id TEXT NOT NULL,
  en TEXT NOT NULL,
  zh TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  source TEXT DEFAULT 'builtin',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (subcategory_id) REFERENCES subcategories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tag_metadata (
  tag_id TEXT PRIMARY KEY,
  namespace TEXT NOT NULL DEFAULT '',
  normalized_key TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'builtin',
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tag_aliases (
  id TEXT PRIMARY KEY,
  tag_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',
  is_builtin INTEGER NOT NULL DEFAULT 0,
  UNIQUE(tag_id, normalized_alias),
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tag_relations (
  id TEXT PRIMARY KEY,
  source_tag_id TEXT NOT NULL,
  target_tag_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'manual',
  enabled INTEGER NOT NULL DEFAULT 1,
  UNIQUE(source_tag_id, target_tag_id, relation_type),
  FOREIGN KEY (source_tag_id) REFERENCES tags(id) ON DELETE CASCADE,
  FOREIGN KEY (target_tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS asset_tag_links (
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
  UNIQUE(asset_type, asset_key, tag_id, polarity),
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tag_suggestions (
  id TEXT PRIMARY KEY,
  asset_type TEXT NOT NULL,
  asset_key TEXT NOT NULL,
  raw_value TEXT NOT NULL,
  normalized_value TEXT NOT NULL,
  tag_id TEXT,
  namespace TEXT NOT NULL DEFAULT '',
  confidence REAL NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  resolved_at TEXT,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tag_id TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sub_favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subcategory_id TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (subcategory_id) REFERENCES subcategories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tag_usage (
  tag_id TEXT PRIMARY KEY,
  count INTEGER DEFAULT 0,
  last_used TEXT,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS history (
  id TEXT PRIMARY KEY,
  prompt TEXT NOT NULL,
  positive_count INTEGER DEFAULT 0,
  negative_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  task_id TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS image_refs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL,
  storage_mode TEXT NOT NULL DEFAULT 'external',
  asset_hash TEXT,
  mime_type TEXT,
  file_size INTEGER,
  original_name TEXT,
  available INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  image_ref_id INTEGER NOT NULL UNIQUE,
  asset_type TEXT NOT NULL DEFAULT 'image',
  source_kind TEXT NOT NULL DEFAULT 'imported-reference',
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  favorite INTEGER NOT NULL DEFAULT 0,
  rating INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'available',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (image_ref_id) REFERENCES image_refs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS image_generation_metadata (
  media_asset_id TEXT PRIMARY KEY,
  prompt TEXT NOT NULL DEFAULT '',
  negative_prompt TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  checkpoint TEXT NOT NULL DEFAULT '',
  loras_json TEXT NOT NULL DEFAULT '[]',
  seed INTEGER,
  sampler TEXT NOT NULL DEFAULT '',
  scheduler TEXT NOT NULL DEFAULT '',
  steps INTEGER,
  cfg REAL,
  width INTEGER,
  height INTEGER,
  raw_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (media_asset_id) REFERENCES media_assets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS image_derivatives (
  id TEXT PRIMARY KEY,
  image_ref_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  file_path TEXT NOT NULL,
  asset_hash TEXT,
  width INTEGER,
  height INTEGER,
  file_size INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE(image_ref_id, kind),
  FOREIGN KEY (image_ref_id) REFERENCES image_refs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS media_relations (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_key TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_key TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(source_type, source_key, relation_type, target_type, target_key)
);

CREATE TABLE IF NOT EXISTS prompt_assets (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  name TEXT NOT NULL,
  prompt TEXT NOT NULL,
  chapter TEXT DEFAULT '',
  section TEXT DEFAULT '',
  subsection TEXT DEFAULT '',
  nsfw INTEGER NOT NULL DEFAULT 0,
  variant_count INTEGER NOT NULL DEFAULT 0,
  source_fingerprint TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS prompt_asset_categories (
  id TEXT PRIMARY KEY,
  parent_id TEXT,
  name TEXT NOT NULL,
  source_scope TEXT NOT NULL DEFAULT 'asset',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_builtin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (parent_id) REFERENCES prompt_asset_categories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS prompt_asset_category_links (
  asset_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (asset_id, category_id),
  FOREIGN KEY (asset_id) REFERENCES prompt_assets(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES prompt_asset_categories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS migration_runs (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  added_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS task_jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  input_json TEXT NOT NULL,
  output_json TEXT,
  error_code TEXT,
  error_message TEXT,
  progress REAL NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 2,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  updated_at TEXT NOT NULL,
  next_attempt_at TEXT
);

CREATE TABLE IF NOT EXISTS wd14_history (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL UNIQUE,
  image_id INTEGER NOT NULL,
  image_name TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '{}',
  model_id TEXT NOT NULL DEFAULT '',
  threshold REAL NOT NULL DEFAULT 0.35,
  status TEXT NOT NULL DEFAULT 'succeeded',
  error_message TEXT,
  image_snapshot_path TEXT,
  image_snapshot_mime TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES task_jobs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS comfy_workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  analysis_json TEXT NOT NULL,
  bindings_json TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'imported',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_image_refs (
  task_id TEXT NOT NULL,
  image_id INTEGER NOT NULL,
  source_filename TEXT NOT NULL DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  PRIMARY KEY (task_id, image_id),
  FOREIGN KEY (task_id) REFERENCES task_jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (image_id) REFERENCES image_refs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS canvas_projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS canvas_vendor_projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS workspace_documents (
  workspace_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 0,
  data_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_editor_states (
  editor_key TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 0,
  data_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_sessions (
  id TEXT PRIMARY KEY,
  runtime TEXT NOT NULL,
  provider_id TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'idle',
  parent_id TEXT,
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_session_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  type TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(session_id, sequence),
  FOREIGN KEY (session_id) REFERENCES agent_sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ai_sessions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'chat',
  runtime TEXT NOT NULL DEFAULT 'openai-compatible',
  provider_id TEXT NOT NULL DEFAULT '',
  model_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'idle',
  parent_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_assistants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  system_prompt TEXT NOT NULL DEFAULT '',
  provider_id TEXT NOT NULL DEFAULT '',
  model_id TEXT NOT NULL DEFAULT '',
  avatar TEXT NOT NULL DEFAULT '',
  settings_json TEXT NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_topics (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  parent_id TEXT,
  title TEXT NOT NULL DEFAULT '',
  pinned INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES ai_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES ai_topics(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS ai_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  role TEXT NOT NULL,
  content_json TEXT NOT NULL DEFAULT '{}',
  attachments_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'completed',
  created_at TEXT NOT NULL,
  UNIQUE(session_id, sequence),
  FOREIGN KEY (session_id) REFERENCES ai_sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ai_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(session_id, sequence),
  FOREIGN KEY (session_id) REFERENCES ai_sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ai_permissions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  request_id TEXT NOT NULL UNIQUE,
  permission TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  decision TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY (session_id) REFERENCES ai_sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ai_attachments (
  id TEXT PRIMARY KEY,
  -- NULLABLE (schema v31): a file added to the LIBRARY has no session. It is still an FK, so a
  -- session-bound attachment keeps its CASCADE; a library row simply has none.
  session_id TEXT,
  message_id TEXT,
  source_type TEXT NOT NULL DEFAULT 'file',
  file_path TEXT NOT NULL,
  original_name TEXT NOT NULL DEFAULT '',
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'available',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES ai_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (message_id) REFERENCES ai_messages(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS cherry_resource_state (
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  order_key TEXT NOT NULL DEFAULT '',
  group_id TEXT,
  owner_id TEXT,
  last_activity_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  transport TEXT NOT NULL,
  endpoint TEXT NOT NULL DEFAULT '',
  command TEXT NOT NULL DEFAULT '',
  args_json TEXT NOT NULL DEFAULT '[]',
  env_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'disconnected',
  error_message TEXT,
  tools_json TEXT NOT NULL DEFAULT '[]',
  enabled_tools_json TEXT NOT NULL DEFAULT '[]',
  description TEXT NOT NULL DEFAULT '',
  headers_json TEXT NOT NULL DEFAULT '{}',
  timeout_seconds INTEGER,
  disabled_auto_approve_tools_json TEXT NOT NULL DEFAULT '[]',
  long_running INTEGER NOT NULL DEFAULT 0,
  registry_url TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

INSERT OR IGNORE INTO chat_groups (id, name, sort_order) VALUES ('default', '默认', 0);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  group_id TEXT DEFAULT '',
  provider_id TEXT NOT NULL,
  title TEXT DEFAULT '新对话',
  model TEXT NOT NULL DEFAULT '',
  system_prompt TEXT DEFAULT '',
  pinned INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  conv_id TEXT DEFAULT '',
  role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
  content TEXT NOT NULL,
  model TEXT DEFAULT '',
  token_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);


CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  access_mode TEXT DEFAULT 'api',
  protocol TEXT DEFAULT 'chat_completions',
  base_url TEXT NOT NULL DEFAULT 'https://api.openai.com/v1',
  api_key TEXT DEFAULT '',
  default_model TEXT DEFAULT 'gpt-4o',
  test_model TEXT DEFAULT 'gpt-4o-mini',
  context_size INTEGER,
  models TEXT DEFAULT '[]',
  is_active INTEGER DEFAULT 0,
  config_toml TEXT DEFAULT '',
  auth_json TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS error_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message TEXT NOT NULL,
  stack TEXT DEFAULT '',
  context TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tag_saved_searches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  query_json TEXT NOT NULL DEFAULT '{}',
  sort_json TEXT NOT NULL DEFAULT '{}',
  view_mode TEXT NOT NULL DEFAULT 'grid',
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Perceptual hashes for similarity search and duplicate detection (schema v30).
-- Computed in main over decoded pixels: dhash (64-bit as 16 hex chars) drives
-- near-duplicate grouping; a compact color histogram catches palette matches.
CREATE TABLE IF NOT EXISTS image_perceptual_hashes (
  image_ref_id INTEGER PRIMARY KEY,
  dhash TEXT NOT NULL DEFAULT '',
  color_histogram TEXT NOT NULL DEFAULT '',
  width INTEGER,
  height INTEGER,
  computed_at TEXT NOT NULL,
  FOREIGN KEY (image_ref_id) REFERENCES image_refs(id) ON DELETE CASCADE
);

-- CLIP embeddings (schema v30). BLOB of float32 little-endian, dims stored so
-- a model swap can be detected; source records which provider produced it
-- (clip sidecar now, other encoders may reuse the table).
CREATE TABLE IF NOT EXISTS image_embeddings (
  image_ref_id INTEGER PRIMARY KEY,
  model TEXT NOT NULL DEFAULT '',
  dims INTEGER NOT NULL DEFAULT 0,
  vector BLOB NOT NULL,
  source TEXT NOT NULL DEFAULT 'clip-sidecar',
  computed_at TEXT NOT NULL,
  FOREIGN KEY (image_ref_id) REFERENCES image_refs(id) ON DELETE CASCADE
);

-- Token accounting, one row per model call that reported usage.
--
-- Deliberately NOT a mirror of the source ai_usage_record, which is 40+ columns carrying a
-- kind/modality taxonomy for features Grimoire does not have (per-API-key attribution,
-- message/request correlation, source display names). What is stored is what this app can
-- actually observe: the counts the provider reports, plus the identity needed to group them.
-- Columns can be added additively when a consumer needs them; the reverse - a wide table of
-- columns nothing reads - is the speculative build this project's rules call out.
--
-- Counts are nullable on purpose. A provider that reports no usage leaves NULL, which is a
-- different fact from 0 tokens, and the source UI distinguishes the two (a fabricated 0 would
-- render as a real reading). cached_tokens is NULL when the provider has no cache details,
-- not 0, for the same reason.
CREATE TABLE IF NOT EXISTS cherry_resource_groups (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  name TEXT NOT NULL,
  order_key TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);


CREATE TABLE IF NOT EXISTS cherry_prompt_bindings (
  prompt_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (prompt_id, target_type, target_id)
);

CREATE TABLE IF NOT EXISTS ai_usage_records (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  message_id TEXT,
  runtime TEXT NOT NULL DEFAULT '',
  protocol TEXT NOT NULL DEFAULT '',
  provider_id TEXT NOT NULL DEFAULT '',
  model_id TEXT NOT NULL DEFAULT '',
  input_tokens INTEGER,
  output_tokens INTEGER,
  cached_tokens INTEGER,
  created_at TEXT NOT NULL
);

`

const INDEX_SQL = `
CREATE INDEX IF NOT EXISTS idx_sub_cat ON subcategories(category_id);
CREATE INDEX IF NOT EXISTS idx_tag_sub ON tags(subcategory_id);
CREATE INDEX IF NOT EXISTS idx_cat_group ON categories(group_id);
CREATE INDEX IF NOT EXISTS idx_sub_group ON subcategories(group_id);
CREATE INDEX IF NOT EXISTS idx_tag_group ON tags(group_id);
CREATE INDEX IF NOT EXISTS idx_tag_metadata_normalized ON tag_metadata(normalized_key);
CREATE INDEX IF NOT EXISTS idx_tag_aliases_normalized ON tag_aliases(normalized_alias);
CREATE INDEX IF NOT EXISTS idx_tag_relations_source ON tag_relations(source_tag_id, enabled);
CREATE INDEX IF NOT EXISTS idx_tag_relations_target ON tag_relations(target_tag_id, enabled);
CREATE INDEX IF NOT EXISTS idx_asset_tag_links_asset ON asset_tag_links(asset_type, asset_key, status);
CREATE INDEX IF NOT EXISTS idx_asset_tag_links_tag ON asset_tag_links(tag_id, status);
CREATE INDEX IF NOT EXISTS idx_tag_suggestions_asset ON tag_suggestions(asset_type, asset_key, status);
CREATE INDEX IF NOT EXISTS idx_tag_suggestions_status ON tag_suggestions(status, id);
CREATE INDEX IF NOT EXISTS idx_media_assets_source ON media_assets(source_kind, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_assets_rating ON media_assets(favorite, rating, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_generation_model ON image_generation_metadata(model, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_image_derivatives_ref ON image_derivatives(image_ref_id, kind);
CREATE INDEX IF NOT EXISTS idx_media_relations_source ON media_relations(source_type, source_key);
CREATE INDEX IF NOT EXISTS idx_media_relations_target ON media_relations(target_type, target_key);
CREATE INDEX IF NOT EXISTS idx_sub_fav ON sub_favorites(subcategory_id);
CREATE INDEX IF NOT EXISTS idx_fav_tag ON favorites(tag_id);
CREATE INDEX IF NOT EXISTS idx_presets_name ON presets(name);
CREATE INDEX IF NOT EXISTS idx_prompt_assets_name ON prompt_assets(name);
CREATE INDEX IF NOT EXISTS idx_prompt_assets_source ON prompt_assets(source);
CREATE INDEX IF NOT EXISTS idx_prompt_asset_categories_parent ON prompt_asset_categories(parent_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_prompt_asset_category_links_category ON prompt_asset_category_links(category_id);
CREATE INDEX IF NOT EXISTS idx_task_jobs_status ON task_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_updated ON agent_sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_session_events_session ON agent_session_events(session_id, sequence);
CREATE INDEX IF NOT EXISTS idx_ai_sessions_updated ON ai_sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_assistants_updated ON ai_assistants(updated_at DESC, sort_order);
CREATE INDEX IF NOT EXISTS idx_ai_topics_session ON ai_topics(session_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_topics_parent ON ai_topics(parent_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_messages_session ON ai_messages(session_id, sequence);
CREATE INDEX IF NOT EXISTS idx_ai_events_session ON ai_events(session_id, sequence);
CREATE INDEX IF NOT EXISTS idx_ai_permissions_session ON ai_permissions(session_id, decision);
CREATE INDEX IF NOT EXISTS idx_ai_attachments_session ON ai_attachments(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_attachments_hash ON ai_attachments(sha256);
CREATE INDEX IF NOT EXISTS idx_cherry_resource_state_type ON cherry_resource_state(entity_type, archived, pinned, order_key, last_activity_at);
CREATE INDEX IF NOT EXISTS idx_cherry_resource_state_owner ON cherry_resource_state(entity_type, owner_id, archived, order_key);
CREATE INDEX IF NOT EXISTS idx_mcp_servers_enabled ON mcp_servers(enabled, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_wd14_history_created ON wd14_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wd14_history_image ON wd14_history(image_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comfy_workflows_name ON comfy_workflows(name);
CREATE INDEX IF NOT EXISTS idx_canvas_projects_updated ON canvas_projects(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_canvas_vendor_projects_updated ON canvas_vendor_projects(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_history_time ON history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_image_refs_image ON task_image_refs(image_id);
CREATE INDEX IF NOT EXISTS idx_tag_relations_type ON tag_relations(relation_type, enabled);
CREATE INDEX IF NOT EXISTS idx_asset_tag_links_ref ON asset_tag_links(asset_ref_id, status);
CREATE INDEX IF NOT EXISTS idx_tag_saved_searches_updated ON tag_saved_searches(pinned DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_cherry_groups_type ON cherry_resource_groups(entity_type, order_key, name);
CREATE INDEX IF NOT EXISTS idx_cherry_prompt_bindings_target ON cherry_prompt_bindings(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage_records(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_session ON ai_usage_records(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_image_embeddings_model ON image_embeddings(model);
`

const REQUIRED_GRIMOIRE_TABLES = ['settings', 'categories', 'subcategories', 'tags'] as const

function assertGrimoireDatabase(connection: DatabaseSync): void {
  const rows = connection.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>
  const tables = new Set(rows.map(row => row.name))
  const missing = REQUIRED_GRIMOIRE_TABLES.filter(table => !tables.has(table))
  if (missing.length) throw new Error('导入文件不是可识别的魔导书数据库')

  assertSupportedSchemaVersion(connection)
}

function assertSupportedSchemaVersion(connection: DatabaseSync): void {
  const table = connection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_meta'").get()
  if (!table) return
  const row = connection.prepare("SELECT value FROM schema_meta WHERE key='schema_version'").get() as { value?: string } | undefined
  const version = Number(row?.value)
  if (Number.isFinite(version) && version > CURRENT_SCHEMA_VERSION) throw new Error(`数据库版本 ${version} 高于当前支持版本 ${CURRENT_SCHEMA_VERSION}`)
}

function assertIntegrity(connection: DatabaseSync, message = '数据库完整性检查失败'): void {
  const row = connection.prepare('PRAGMA integrity_check').get() as { integrity_check?: string } | undefined
  if (row?.integrity_check !== 'ok') throw new Error(message)
}

function configureConnection(connection: DatabaseSync): void {
  connection.exec('PRAGMA journal_mode=WAL;')
  connection.exec('PRAGMA foreign_keys=ON;')
  connection.exec('PRAGMA busy_timeout=5000;')
}

function migrateWD14HistoryTable(legacy: LegacyDatabase): void {
  const columns = legacy.exec('PRAGMA table_info(wd14_history)')[0]?.values || []
  const names = new Set(columns.map(row => String(row[1])))
  if (!names.has('image_snapshot_path')) legacy.run('ALTER TABLE wd14_history ADD COLUMN image_snapshot_path TEXT')
  if (!names.has('image_snapshot_mime')) legacy.run('ALTER TABLE wd14_history ADD COLUMN image_snapshot_mime TEXT')

  const foreignKeys = legacy.exec('PRAGMA foreign_key_list(wd14_history)')[0]?.values || []
  const imageForeignKey = foreignKeys.some(row => String(row[3]) === 'image_id')
  if (!imageForeignKey) return

  legacy.exec('PRAGMA foreign_keys=OFF')
  try {
    legacy.exec(`CREATE TABLE wd14_history_new (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL UNIQUE,
      image_id INTEGER NOT NULL,
      image_name TEXT NOT NULL DEFAULT '',
      tags_json TEXT NOT NULL DEFAULT '{}',
      model_id TEXT NOT NULL DEFAULT '',
      threshold REAL NOT NULL DEFAULT 0.35,
      status TEXT NOT NULL DEFAULT 'succeeded',
      error_message TEXT,
      image_snapshot_path TEXT,
      image_snapshot_mime TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES task_jobs(id) ON DELETE CASCADE
    )`)
    legacy.exec('INSERT INTO wd14_history_new (id,task_id,image_id,image_name,tags_json,model_id,threshold,status,error_message,image_snapshot_path,image_snapshot_mime,created_at) SELECT id,task_id,image_id,image_name,tags_json,model_id,threshold,status,error_message,image_snapshot_path,image_snapshot_mime,created_at FROM wd14_history')
    legacy.exec('DROP TABLE wd14_history')
    legacy.exec('ALTER TABLE wd14_history_new RENAME TO wd14_history')
  } finally {
    legacy.exec('PRAGMA foreign_keys=ON')
  }
}

function normalizeTagValue(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/[\s_]+/g, ' ')
}

function migrateTagIntelligence(legacy: LegacyDatabase): void {
  // Self-healing guard: tag_metadata rows are created 1:1 with tags (FK cascade),
  // so equal counts mean the loop has nothing to repair on this startup.
  const counts = legacy.exec('SELECT (SELECT COUNT(*) FROM tags),(SELECT COUNT(*) FROM tag_metadata)')[0]?.values?.[0]
  if (counts && Number(counts[0]) === Number(counts[1])) return
  const rows = legacy.exec('SELECT id,en,zh,source FROM tags')[0]?.values || []
  const now = new Date().toISOString()
  for (const row of rows) {
    const tagId = String(row[0])
    const en = String(row[1] || '').trim()
    const zh = String(row[2] || '').trim()
    const source = String(row[3] || 'builtin')
    const canonical = normalizeTagValue(en || zh)
    legacy.run(
      'INSERT OR IGNORE INTO tag_metadata (tag_id,namespace,normalized_key,description,color,is_active,source) VALUES (?,?,?,?,?,?,?)',
      [tagId, '', canonical, '', '', 1, source],
    )
    if (en) legacy.run(
      'INSERT OR IGNORE INTO tag_aliases (id,tag_id,alias,normalized_alias,language,source,is_builtin) VALUES (?,?,?,?,?,?,?)',
      ['alias_' + tagId + '_en', tagId, en, normalizeTagValue(en), 'en', 'migration', 1],
    )
    if (zh && normalizeTagValue(zh) !== canonical) legacy.run(
      'INSERT OR IGNORE INTO tag_aliases (id,tag_id,alias,normalized_alias,language,source,is_builtin) VALUES (?,?,?,?,?,?,?)',
      ['alias_' + tagId + '_zh', tagId, zh, normalizeTagValue(zh), 'zh', 'migration', 1],
    )
  }
  legacy.run("INSERT OR REPLACE INTO schema_meta (key,value) VALUES ('tag_intelligence_migrated_at',?)", [now])
}

function migrateMediaAssets(legacy: LegacyDatabase): void {
  // Self-healing guard: media_assets is a 1:1 projection of image_refs; equal
  // counts mean every image already has its media row.
  const counts = legacy.exec('SELECT (SELECT COUNT(*) FROM image_refs),(SELECT COUNT(*) FROM media_assets)')[0]?.values?.[0]
  if (counts && Number(counts[0]) === Number(counts[1])) return
  const rows = legacy.exec('SELECT id,original_name,storage_mode,available,created_at FROM image_refs')[0]?.values || []
  const now = new Date().toISOString()
  for (const row of rows) {
    const imageId = Number(row[0])
    const mediaId = 'media_image_' + imageId
    const sourceKind = String(row[2] || '') === 'external' ? 'external-link' : 'imported-reference'
    const status = Number(row[3]) === 0 ? 'missing' : 'available'
    legacy.run('INSERT OR IGNORE INTO media_assets (id,image_ref_id,asset_type,source_kind,title,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)', [mediaId, imageId, 'image', sourceKind, String(row[1] || '图片 ' + imageId), status, String(row[4] || now), now])
  }
}

/**
 * Makes `ai_attachments.session_id` NULLABLE, so a file added to the LIBRARY (schema v31) is not
 * forced to claim a session it does not have.
 *
 * WHY THIS IS A TABLE REBUILD AND NOT AN ALTER: SQLite cannot drop a `NOT NULL` constraint in
 * place, and the column also carries `FOREIGN KEY (session_id) REFERENCES ai_sessions(id) ON
 * DELETE CASCADE`. Both are wrong for a library row — and the CASCADE one is worse than wrong:
 * a library upload parked under a sentinel session would be DELETED the moment that session was,
 * which is data loss the user never asked for.
 *
 * This was found by running the real upload path, not by reading the schema: the first live
 * attempt failed with `FOREIGN KEY constraint failed` because the sentinel `session_id` the
 * service used does not exist in `ai_sessions`. Unit tests mock the database away, so they could
 * not have caught it.
 *
 * Existing rows keep their session (`NULL` only for rows that genuinely have none), and the FK
 * stays for the session-bound case, so nothing about conversation attachments changes.
 */
function migrateAiAttachmentsLibrary(legacy: LegacyDatabase): void {
  const marker = legacy.exec("SELECT value FROM schema_meta WHERE key='ai_attachments_library_migrated'")[0]?.values?.[0]?.[0]
  if (marker) return

  // Only rebuild when the column is still NOT NULL; a database created from the current
  // SCHEMA_SQL already has the nullable form.
  const columns = legacy.exec("PRAGMA table_info('ai_attachments')")[0]?.values || []
  const sessionColumn = columns.find(row => String(row[1]) === 'session_id')
  const isNotNull = sessionColumn ? Number(sessionColumn[3]) === 1 : false
  if (!isNotNull) {
    legacy.run("INSERT OR REPLACE INTO schema_meta (key,value) VALUES ('ai_attachments_library_migrated',?)", [new Date().toISOString()])
    return
  }

  legacy.exec('PRAGMA foreign_keys=OFF')
  try {
    legacy.exec(`CREATE TABLE IF NOT EXISTS ai_attachments_library_new (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      message_id TEXT,
      source_type TEXT NOT NULL DEFAULT 'file',
      file_path TEXT NOT NULL,
      original_name TEXT NOT NULL DEFAULT '',
      mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      size INTEGER NOT NULL DEFAULT 0,
      sha256 TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'available',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES ai_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (message_id) REFERENCES ai_messages(id) ON DELETE SET NULL
    )`)
    // Explicit column list: a positional `SELECT *` silently mis-maps every value the moment a
    // column is added, which has happened three times in this project.
    legacy.exec(`INSERT INTO ai_attachments_library_new
      (id,session_id,message_id,source_type,file_path,original_name,mime_type,size,sha256,status,metadata_json,created_at,updated_at)
      SELECT id,session_id,message_id,source_type,file_path,original_name,mime_type,size,sha256,status,metadata_json,created_at,updated_at FROM ai_attachments`)
    legacy.exec('DROP TABLE ai_attachments')
    legacy.exec('ALTER TABLE ai_attachments_library_new RENAME TO ai_attachments')
    legacy.run("INSERT OR REPLACE INTO schema_meta (key,value) VALUES ('ai_attachments_library_migrated',?)", [new Date().toISOString()])
  } finally {
    legacy.exec('PRAGMA foreign_keys=ON')
  }
}

function migrateTagDataV21(legacy: LegacyDatabase): void {
  const hasMarker = (key: string) => Boolean(legacy.exec('SELECT value FROM schema_meta WHERE key=?', [key])[0]?.values?.[0]?.[0])
  const keysDone = hasMarker('asset_key_prompt_prefix_migrated')
  const usageDone = hasMarker('tag_usage_backfilled')
  const directionDone = hasMarker('tag_relation_direction_normalized')
  if (keysDone && usageDone && directionDone) return

  const now = new Date().toISOString()
  legacy.exec('BEGIN')
  try {
    if (!keysDone) {
      // Prompt assets were written with a bare `asset:<uuid>` key while readers
      // expect the `prompt:` prefix. Drop would-be duplicates first so the
      // UNIQUE(asset_type, asset_key, tag_id, polarity) constraint cannot fail.
      legacy.run("DELETE FROM asset_tag_links WHERE asset_type='prompt' AND asset_key NOT LIKE 'prompt:%' AND EXISTS (SELECT 1 FROM asset_tag_links prefixed WHERE prefixed.asset_type='prompt' AND prefixed.asset_key='prompt:'||asset_tag_links.asset_key AND prefixed.tag_id=asset_tag_links.tag_id AND prefixed.polarity=asset_tag_links.polarity)")
      legacy.run("UPDATE asset_tag_links SET asset_key='prompt:'||asset_key WHERE asset_type='prompt' AND asset_key NOT LIKE 'prompt:%'")
      legacy.run("UPDATE tag_suggestions SET asset_key='prompt:'||asset_key WHERE asset_type='prompt' AND asset_key NOT LIKE 'prompt:%'")
      legacy.run("INSERT OR REPLACE INTO schema_meta (key,value) VALUES ('asset_key_prompt_prefix_migrated',?)", [now])
    }
    if (!usageDone) {
      legacy.run("INSERT INTO tag_usage (tag_id,count,last_used) SELECT tag_id,COUNT(*),MAX(created_at) FROM asset_tag_links WHERE status='accepted' GROUP BY tag_id ON CONFLICT(tag_id) DO UPDATE SET count=excluded.count,last_used=COALESCE(excluded.last_used,tag_usage.last_used)")
      legacy.run("INSERT OR REPLACE INTO schema_meta (key,value) VALUES ('tag_usage_backfilled',?)", [now])
    }
    if (!directionDone) {
      // Canonical direction: source is the more specific tag, target the more
      // general one. Legacy `child` rows are read as (parent -> child) and
      // reversed into canonical `parent` rows, then removed.
      legacy.run("INSERT OR IGNORE INTO tag_relations (id,source_tag_id,target_tag_id,relation_type,confidence,source,enabled) SELECT 'rel_norm_'||id,target_tag_id,source_tag_id,'parent',confidence,source,enabled FROM tag_relations WHERE relation_type='child'")
      legacy.run("DELETE FROM tag_relations WHERE relation_type='child'")
      legacy.run("INSERT OR REPLACE INTO schema_meta (key,value) VALUES ('tag_relation_direction_normalized',?)", [now])
    }
    legacy.exec('COMMIT')
  } catch (error) {
    try { legacy.exec('ROLLBACK') } catch {}
    throw error
  }
}

function migrateMediaMetadataV22(legacy: LegacyDatabase): void {
  const hasMarker = (key: string) => Boolean(legacy.exec('SELECT value FROM schema_meta WHERE key=?', [key])[0]?.values?.[0]?.[0])
  const refDone = hasMarker('asset_ref_backfilled')
  const originDone = hasMarker('generation_metadata_origin_backfilled')
  if (refDone && originDone) return

  const now = new Date().toISOString()
  legacy.exec('BEGIN')
  try {
    if (!refDone) {
      // Numeric reference projection for image links: `image:<int>` keys become
      // asset_ref_id so gallery joins never rebuild the key with `||`.
      legacy.run("UPDATE asset_tag_links SET asset_ref_id = CAST(substr(asset_key,7) AS INTEGER) WHERE asset_type='image' AND asset_key GLOB 'image:[0-9]*' AND NOT asset_key GLOB 'image:*[^0-9]*' AND asset_ref_id IS NULL AND CAST(substr(asset_key,7) AS INTEGER) > 0")
      legacy.run("INSERT OR REPLACE INTO schema_meta (key,value) VALUES ('asset_ref_backfilled',?)", [now])
    }
    if (!originDone) {
      // Every historical image_generation_metadata row was written by the
      // ComfyUI task runner; mark that provenance explicitly once.
      legacy.run("UPDATE image_generation_metadata SET origin='comfyui-grimoire' WHERE origin=''")
      legacy.run("INSERT OR REPLACE INTO schema_meta (key,value) VALUES ('generation_metadata_origin_backfilled',?)", [now])
    }
    legacy.exec('COMMIT')
  } catch (error) {
    try { legacy.exec('ROLLBACK') } catch {}
    throw error
  }
}

function migrateCherryResourceState(legacy: LegacyDatabase): void {
  const marker = legacy.exec("SELECT value FROM schema_meta WHERE key='cherry_resource_state_migrated'")[0]?.values?.[0]?.[0]
  if (marker) return

  const now = new Date().toISOString()
  legacy.exec('BEGIN')
  try {
    const sessions = legacy.exec('SELECT id,metadata_json,created_at,updated_at FROM ai_sessions ORDER BY updated_at ASC,id ASC')[0]?.values || []
    for (const [index, row] of sessions.entries()) {
      const metadata = (() => {
        try {
          const parsed = JSON.parse(String(row[1] || '{}'))
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
        } catch { return {} }
      })()
      const pinned = metadata.pinned === true ? 1 : 0
      const groupId = typeof metadata.groupId === 'string' && metadata.groupId.trim() ? metadata.groupId.trim() : null
      const lastActivity = String(row[3] || row[2] || now)
      legacy.run(
        'INSERT OR IGNORE INTO cherry_resource_state (entity_type,entity_id,archived,deleted_at,pinned,order_key,group_id,owner_id,last_activity_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        ['session', String(row[0]), 0, null, pinned, String(index).padStart(20, '0'), groupId, null, lastActivity, now, now],
      )
    }
    const assistants = legacy.exec('SELECT id,sort_order,created_at,updated_at FROM ai_assistants ORDER BY sort_order ASC,updated_at ASC,id ASC')[0]?.values || []
    for (const [index, row] of assistants.entries()) {
      legacy.run(
        'INSERT OR IGNORE INTO cherry_resource_state (entity_type,entity_id,archived,deleted_at,pinned,order_key,group_id,owner_id,last_activity_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        ['assistant', String(row[0]), 0, null, 0, String(Number(row[1] || index)).padStart(20, '0'), null, null, String(row[3] || row[2] || now), now, now],
      )
    }
    const topics = legacy.exec('SELECT id,session_id,pinned,archived,created_at,updated_at FROM ai_topics ORDER BY updated_at ASC,id ASC')[0]?.values || []
    for (const [index, row] of topics.entries()) {
      legacy.run(
        'INSERT OR IGNORE INTO cherry_resource_state (entity_type,entity_id,archived,deleted_at,pinned,order_key,group_id,owner_id,last_activity_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        ['topic', String(row[0]), Number(row[3] || 0) === 1 ? 1 : 0, null, Number(row[2] || 0) === 1 ? 1 : 0, String(index).padStart(20, '0'), null, String(row[1]), String(row[5] || row[4] || now), now, now],
      )
    }
    legacy.run("INSERT OR REPLACE INTO schema_meta (key,value) VALUES ('cherry_resource_state_migrated',?)", [now])
    legacy.exec('COMMIT')
  } catch (error) {
    try { legacy.exec('ROLLBACK') } catch {}
    throw error
  }
}

function migrateUnifiedAi(legacy: LegacyDatabase): void {
  const marker = legacy.exec("SELECT value FROM schema_meta WHERE key='ai_sessions_migrated'")[0]?.values?.[0]?.[0]
  if (marker) return

  const now = new Date().toISOString()
  const chatSessionIds = new Map<string, string>()
  const agentSessionIds = new Map<string, string>()

  legacy.exec('BEGIN')
  try {
    const conversations = legacy.exec('SELECT id,group_id,provider_id,title,model,system_prompt,pinned,created_at,updated_at FROM conversations ORDER BY created_at,id')[0]?.values || []
    for (const row of conversations) {
      const legacyId = String(row[0])
      const id = 'legacy_chat_' + legacyId
      chatSessionIds.set(legacyId, id)
      const metadata = {
        legacyType: 'conversation',
        legacyId,
        groupId: String(row[1] || ''),
        systemPrompt: String(row[5] || ''),
        pinned: Number(row[6] || 0) === 1,
      }
      legacy.run(
        'INSERT OR IGNORE INTO ai_sessions (id,kind,runtime,provider_id,model_id,title,status,parent_id,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [id, 'chat', 'openai-compatible', String(row[2] || ''), String(row[4] || ''), String(row[3] || '新对话'), 'completed', null, JSON.stringify(metadata), String(row[7] || now), String(row[8] || now)],
      )
    }

    const chatMessages = legacy.exec('SELECT id,conv_id,role,content,model,token_count,created_at FROM chat_messages ORDER BY conv_id,created_at,id')[0]?.values || []
    const chatSequences = new Map<string, number>()
    for (const row of chatMessages) {
      const legacyConversationId = String(row[1] || '')
      let sessionId = chatSessionIds.get(legacyConversationId)
      if (!sessionId) {
        sessionId = 'legacy_chat_orphans'
        if (!chatSessionIds.has('')) {
          chatSessionIds.set('', sessionId)
          legacy.run(
            'INSERT OR IGNORE INTO ai_sessions (id,kind,runtime,provider_id,model_id,title,status,parent_id,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
            [sessionId, 'chat', 'openai-compatible', '', String(row[4] || ''), '历史聊天消息', 'completed', null, JSON.stringify({ legacyType: 'orphan-chat-messages' }), String(row[6] || now), String(row[6] || now)],
          )
        }
      }
      const sequence = chatSequences.get(sessionId) || 0
      chatSequences.set(sessionId, sequence + 1)
      const content = JSON.stringify({ text: String(row[3] || ''), model: String(row[4] || ''), tokenCount: Number(row[5] || 0) })
      legacy.run(
        'INSERT OR IGNORE INTO ai_messages (id,session_id,sequence,role,content_json,attachments_json,status,created_at) VALUES (?,?,?,?,?,?,?,?)',
        ['legacy_chat_message_' + String(row[0]), sessionId, sequence, String(row[2] || 'user'), content, '[]', 'completed', String(row[6] || now)],
      )
    }

    const agentSessions = legacy.exec('SELECT id,runtime,provider_id,model,title,status,parent_id,data_json,created_at,updated_at FROM agent_sessions ORDER BY created_at,id')[0]?.values || []
    for (const row of agentSessions) {
      const legacyId = String(row[0])
      const id = 'legacy_agent_' + legacyId
      agentSessionIds.set(legacyId, id)
    }
    for (const row of agentSessions) {
      const legacyId = String(row[0])
      const id = agentSessionIds.get(legacyId)!
      const parentId = row[6] == null ? null : agentSessionIds.get(String(row[6])) || null
      legacy.run(
        'INSERT OR IGNORE INTO ai_sessions (id,kind,runtime,provider_id,model_id,title,status,parent_id,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [id, 'agent', String(row[1] || 'openai-compatible'), String(row[2] || ''), String(row[3] || ''), String(row[4] || '新 Agent 会话'), String(row[5] || 'idle'), parentId, String(row[7] || '{}'), String(row[8] || now), String(row[9] || now)],
      )
    }

    const agentEvents = legacy.exec('SELECT id,session_id,sequence,type,data_json,created_at FROM agent_session_events ORDER BY session_id,sequence')[0]?.values || []
    for (const row of agentEvents) {
      const sessionId = agentSessionIds.get(String(row[1]))
      if (!sessionId) continue
      legacy.run(
        'INSERT OR IGNORE INTO ai_events (id,session_id,sequence,event_type,payload_json,created_at) VALUES (?,?,?,?,?,?)',
        ['legacy_agent_event_' + String(row[0]), sessionId, Number(row[2] || 0), String(row[3] || 'status'), String(row[4] || '{}'), String(row[5] || now)],
      )
    }

    legacy.run("INSERT OR REPLACE INTO schema_meta (key,value) VALUES ('ai_sessions_migrated',?)", [now])
    legacy.exec('COMMIT')
  } catch (error) {
    try { legacy.exec('ROLLBACK') } catch {}
    throw error
  }
}

/** Additive/idempotent v32 slice. initDatabase's existing backup runs before this transaction. */
function migrateAgentBlueprints(legacy: LegacyDatabase): void {
  legacy.exec('BEGIN')
  try {
    legacy.exec(`CREATE TABLE IF NOT EXISTS agent_blueprints (
      id TEXT PRIMARY KEY,
      source_type TEXT CHECK (source_type IS NULL OR source_type IN ('claude-code','pi','dsh')),
      runtime TEXT NOT NULL CHECK (runtime IN ('openai-compatible','anthropic','google','codex','opencode','pi')),
      name TEXT NOT NULL CHECK (length(name)>0),
      description TEXT NOT NULL DEFAULT '',
      instructions TEXT NOT NULL DEFAULT '',
      model TEXT,
      plan_model TEXT,
      small_model TEXT,
      configuration_json TEXT NOT NULL DEFAULT '{}',
      disabled_tools_json TEXT NOT NULL DEFAULT '[]',
      mcp_ids_json TEXT NOT NULL DEFAULT '[]',
      knowledge_base_ids_json TEXT NOT NULL DEFAULT '[]',
      order_key TEXT NOT NULL,
      deleted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_blueprints_lifecycle_order ON agent_blueprints(deleted_at,order_key,id);`)
    legacy.run("INSERT OR IGNORE INTO schema_meta (key,value) VALUES ('agent_blueprints_migrated',?)", [new Date().toISOString()])
    legacy.exec('COMMIT')
  } catch (error) {
    try { legacy.exec('ROLLBACK') } catch {}
    throw error
  }
}

/** Cherry message root/role/status constraints adapted to Grimoire-owned v33 tables.
 * No INSERT SELECT: legacy session ownership is not evidence of topic ownership.
 */
function migrateTopicTrees(legacy: LegacyDatabase): void {
  legacy.exec('BEGIN')
  try {
    legacy.exec(`
      CREATE TABLE IF NOT EXISTS topic_tree_messages (
        id TEXT PRIMARY KEY,
        topic_id TEXT NOT NULL REFERENCES ai_topics(id) ON DELETE CASCADE,
        parent_id TEXT,
        role TEXT NOT NULL CHECK(role IN ('root','user','assistant','system')),
        data_json TEXT NOT NULL CHECK(json_valid(data_json)),
        status TEXT NOT NULL CHECK(status IN ('pending','success','error','paused')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(topic_id,id),
        FOREIGN KEY(topic_id,parent_id) REFERENCES topic_tree_messages(topic_id,id),
        CHECK((role='root') = (parent_id IS NULL)),
        CHECK(role!='root' OR (data_json='{"parts":[]}' AND status='success'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_topic_tree_one_root ON topic_tree_messages(topic_id) WHERE parent_id IS NULL;
      CREATE INDEX IF NOT EXISTS idx_topic_tree_parent ON topic_tree_messages(topic_id,parent_id);
      CREATE TABLE IF NOT EXISTS topic_tree_state (
        topic_id TEXT PRIMARY KEY REFERENCES ai_topics(id) ON DELETE CASCADE,
        root_id TEXT NOT NULL,
        active_node_id TEXT,
        assistant_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(topic_id,root_id) REFERENCES topic_tree_messages(topic_id,id),
        FOREIGN KEY(topic_id,active_node_id) REFERENCES topic_tree_messages(topic_id,id),
        CHECK(active_node_id IS NULL OR active_node_id!=root_id)
      );
      CREATE TRIGGER IF NOT EXISTS topic_tree_state_root_insert BEFORE INSERT ON topic_tree_state
      WHEN NOT EXISTS(SELECT 1 FROM topic_tree_messages WHERE topic_id=NEW.topic_id AND id=NEW.root_id AND role='root')
      BEGIN SELECT RAISE(ABORT,'topic tree root required'); END;
      CREATE TRIGGER IF NOT EXISTS topic_tree_state_root_immutable BEFORE UPDATE OF root_id,topic_id ON topic_tree_state
      BEGIN SELECT RAISE(ABORT,'topic tree root immutable'); END;
      CREATE TRIGGER IF NOT EXISTS topic_tree_topology_immutable BEFORE UPDATE OF topic_id,parent_id,role,id ON topic_tree_messages
      BEGIN SELECT RAISE(ABORT,'topic tree topology immutable'); END;
    `)
    legacy.run("INSERT OR IGNORE INTO schema_meta (key,value) VALUES ('topic_trees_migrated',?)", [new Date().toISOString()])
    legacy.exec('COMMIT')
  } catch (error) {
    try { legacy.exec('ROLLBACK') } catch {}
    throw error
  }
}

/** Source agentWorkspace schema adapted to main SQLite. Never adopts legacy paths. */
function migrateAgentWorkspaces(legacy: LegacyDatabase): void {
  legacy.exec(`CREATE TABLE IF NOT EXISTS agent_workspaces (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL CHECK(length(trim(name))>0),
    path TEXT NOT NULL UNIQUE CHECK(length(path)>0),
    type TEXT NOT NULL DEFAULT 'user' CHECK(type IN ('user','system')),
    order_key TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_agent_workspaces_order ON agent_workspaces(type,order_key,id);`)
}

/** Cherry agentSession.ts source read fields adapted onto existing execution identity.
 * Workspace RESTRICT intentionally replaces source CASCADE: deleting a directory
 * registration must never delete execution history. No INSERT SELECT/backfill.
 * Relation/title triggers make the existing namespace a projection of ONE authority,
 * including FK SET NULL, without replacing snapshots or any other runtime data.
 */
function migrateAgentSessionReadModel(legacy: LegacyDatabase): void {
  legacy.exec(`CREATE TABLE IF NOT EXISTS agent_session_read_model (
    id TEXT PRIMARY KEY NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
    type TEXT NOT NULL DEFAULT 'conversation' CHECK(type IN ('conversation','background')),
    agent_id TEXT REFERENCES agent_blueprints(id) ON DELETE SET NULL,
    name TEXT NOT NULL CHECK(length(name)<=255),
    is_name_manually_edited INTEGER NOT NULL DEFAULT 0 CHECK(is_name_manually_edited IN (0,1)),
    description TEXT NOT NULL DEFAULT '',
    workspace_id TEXT NOT NULL REFERENCES agent_workspaces(id) ON DELETE RESTRICT,
    order_key TEXT NOT NULL,
    last_activity_at TEXT NOT NULL,
    trace_id TEXT CHECK(trace_id IS NULL OR (length(trace_id)=32 AND trace_id NOT GLOB '*[^0-9a-f]*' AND trace_id!='00000000000000000000000000000000')),
    deleted_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_agent_session_read_model_order ON agent_session_read_model(type,deleted_at,order_key,id);
  CREATE INDEX IF NOT EXISTS idx_agent_session_read_model_activity ON agent_session_read_model(type,deleted_at,last_activity_at DESC,id);
  CREATE INDEX IF NOT EXISTS idx_agent_session_read_model_workspace ON agent_session_read_model(workspace_id);
  CREATE INDEX IF NOT EXISTS idx_agent_session_read_model_agent ON agent_session_read_model(agent_id);
  CREATE TRIGGER IF NOT EXISTS agent_session_read_model_insert AFTER INSERT ON agent_session_read_model
  BEGIN
    UPDATE agent_sessions SET title=NEW.name, data_json=json_set(data_json,
      '$.agentSession.version',1,'$.agentSession.agentId',NEW.agent_id,
      '$.agentSession.workspace',json_object('type',(SELECT type FROM agent_workspaces WHERE id=NEW.workspace_id),'workspaceId',NEW.workspace_id)) WHERE id=NEW.id;
  END;
  CREATE TRIGGER IF NOT EXISTS agent_session_read_model_relation AFTER UPDATE OF agent_id,workspace_id,name ON agent_session_read_model
  BEGIN
    UPDATE agent_sessions SET title=NEW.name, data_json=json_set(data_json,
      '$.agentSession.version',1,'$.agentSession.agentId',NEW.agent_id,
      '$.agentSession.workspace',json_object('type',(SELECT type FROM agent_workspaces WHERE id=NEW.workspace_id),'workspaceId',NEW.workspace_id)) WHERE id=NEW.id;
  END;`)
}

export function initializeDatabaseConnection(connection: DatabaseSync, requireExistingGrimoire = false): LegacyDatabase {
  if (requireExistingGrimoire) assertGrimoireDatabase(connection)
  else assertSupportedSchemaVersion(connection)
  configureConnection(connection)
  const legacy = createLegacyDatabase(connection)
  legacy.exec(SCHEMA_SQL)

  // Columns must be added before indexes that reference them are created.
  try { legacy.run("ALTER TABLE task_jobs ADD COLUMN next_attempt_at TEXT") } catch {}
  try { legacy.run("ALTER TABLE categories ADD COLUMN group_id TEXT DEFAULT 'default'") } catch {}
  try { legacy.run("ALTER TABLE subcategories ADD COLUMN group_id TEXT DEFAULT 'default'") } catch {}
  try { legacy.run("ALTER TABLE tags ADD COLUMN group_id TEXT DEFAULT 'default'") } catch {}
  try { legacy.run("ALTER TABLE chat_messages ADD COLUMN conv_id TEXT DEFAULT ''") } catch {}
  try { legacy.run("ALTER TABLE chat_messages ADD COLUMN token_count INTEGER DEFAULT 0") } catch {}
  try { legacy.run("ALTER TABLE image_refs ADD COLUMN storage_mode TEXT NOT NULL DEFAULT 'external'") } catch {}
  try { legacy.run("ALTER TABLE image_refs ADD COLUMN asset_hash TEXT") } catch {}
  try { legacy.run("ALTER TABLE image_refs ADD COLUMN mime_type TEXT") } catch {}
  try { legacy.run("ALTER TABLE image_refs ADD COLUMN file_size INTEGER") } catch {}
  try { legacy.run("ALTER TABLE image_refs ADD COLUMN original_name TEXT") } catch {}
  try { legacy.run("ALTER TABLE image_refs ADD COLUMN available INTEGER NOT NULL DEFAULT 1") } catch {}
  try { legacy.run("ALTER TABLE history ADD COLUMN task_id TEXT") } catch {}
  try { legacy.run("ALTER TABLE canvas_vendor_projects ADD COLUMN revision INTEGER NOT NULL DEFAULT 0") } catch {}
  try { legacy.run("ALTER TABLE mcp_servers ADD COLUMN enabled_tools_json TEXT NOT NULL DEFAULT '[]'") } catch {}
  try { legacy.run("ALTER TABLE mcp_servers ADD COLUMN description TEXT NOT NULL DEFAULT ''") } catch {}
  try { legacy.run("ALTER TABLE mcp_servers ADD COLUMN headers_json TEXT NOT NULL DEFAULT '{}'") } catch {}
  try { legacy.run("ALTER TABLE mcp_servers ADD COLUMN timeout_seconds INTEGER") } catch {}
  try { legacy.run("ALTER TABLE mcp_servers ADD COLUMN disabled_auto_approve_tools_json TEXT NOT NULL DEFAULT '[]'") } catch {}
  try { legacy.run("ALTER TABLE mcp_servers ADD COLUMN long_running INTEGER NOT NULL DEFAULT 0") } catch {}
  try { legacy.run("ALTER TABLE mcp_servers ADD COLUMN registry_url TEXT NOT NULL DEFAULT ''") } catch {}
  try { legacy.run("ALTER TABLE mcp_servers ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]'") } catch {}
  try { legacy.run("ALTER TABLE image_refs ADD COLUMN width INTEGER") } catch {}
  try { legacy.run("ALTER TABLE image_refs ADD COLUMN height INTEGER") } catch {}
  try { legacy.run("ALTER TABLE image_refs ADD COLUMN file_mtime INTEGER") } catch {}
  try { legacy.run("ALTER TABLE image_generation_metadata ADD COLUMN origin TEXT NOT NULL DEFAULT ''") } catch {}
  try { legacy.run("ALTER TABLE asset_tag_links ADD COLUMN asset_ref_id INTEGER") } catch {}
  // Visibility for prompt assets (source `PromptVisibilitySchema`: global | restricted). A
  // restricted prompt is visible ONLY to its bound targets, so without a column the adapter had
  // to hardcode `global` — reporting a prompt the user restricted as globally visible. Guarded
  // like every other ALTER here: the column already exists on a migrated database, and an
  // unguarded ALTER would abort the second startup.
  try { legacy.run("ALTER TABLE prompt_assets ADD COLUMN visibility TEXT NOT NULL DEFAULT 'global'") } catch {}
  migrateWD14HistoryTable(legacy)
  migrateTagIntelligence(legacy)
  migrateMediaAssets(legacy)
  migrateUnifiedAi(legacy)
  migrateCherryResourceState(legacy)
  migrateTagDataV21(legacy)
  migrateMediaMetadataV22(legacy)
  migrateAiAttachmentsLibrary(legacy)
  migrateAgentBlueprints(legacy)
  migrateTopicTrees(legacy)
  migrateAgentWorkspaces(legacy)
  migrateAgentSessionReadModel(legacy)
  migrateNovelaiPromptVersions(legacy)
  migrateNovelaiVersionTrash(legacy)
  migrateNovelaiAssets(legacy)
  migrateBrowserHistory(legacy)
  migrateBrowserBookmarks(legacy)

  legacy.exec(INDEX_SQL)
  legacy.run("CREATE INDEX IF NOT EXISTS idx_history_task ON history(task_id)")
  // v41/v42: execution identity and asset content CAS advance with the schema.
  legacy.exec('BEGIN IMMEDIATE')
  try {
    const columns = legacy.exec('PRAGMA table_info(task_jobs)')[0]?.values || []
    if (!columns.some(row => row[1] === 'execution_json')) legacy.run('ALTER TABLE task_jobs ADD COLUMN execution_json TEXT')
    const assetColumns = legacy.exec('PRAGMA table_info(novelai_asset)')[0]?.values || []
    if (!assetColumns.some(row => row[1] === 'revision')) legacy.run('ALTER TABLE novelai_asset ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1)')
    legacy.run("INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('schema_version', ?)", [String(CURRENT_SCHEMA_VERSION)])
    legacy.exec('COMMIT')
  } catch (error) {
    try { legacy.exec('ROLLBACK') } catch (rollbackError) { console.debug('[database] v41 rollback settled', rollbackError instanceof Error ? rollbackError.message : String(rollbackError)) }
    throw error
  }
  return legacy
}


// v36 — NovelAI prompt work/version tree. Shape mirrors the reference tool (work → version →
// branch → images); none of its code or data is copied. `snapshot` holds the raw prompt text and
// is authoritative; `branch_id`/`branch_number` describe which line a version belongs to.
function migrateNovelaiPromptVersions(legacy: LegacyDatabase): void {
  legacy.exec(`
    CREATE TABLE IF NOT EXISTS novelai_work (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
      origin_snapshot TEXT,
      saved INTEGER NOT NULL DEFAULT 0 CHECK(saved IN (0,1)),
      last_version_id TEXT,
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1),
      created_at TEXT NOT NULL,
      last_used_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS novelai_version (
      id TEXT PRIMARY KEY NOT NULL,
      work_id TEXT NOT NULL REFERENCES novelai_work(id) ON DELETE CASCADE,
      parent_id TEXT REFERENCES novelai_version(id) ON DELETE CASCADE,
      number INTEGER NOT NULL CHECK(number >= 1),
      branch_id TEXT NOT NULL,
      branch_number INTEGER NOT NULL CHECK(branch_number >= 1),
      snapshot TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'user' CHECK(source IN ('user','agent')),
      operation TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      UNIQUE(work_id, number)
    );
    CREATE TABLE IF NOT EXISTS novelai_branch_name (
      branch_id TEXT PRIMARY KEY NOT NULL,
      work_id TEXT NOT NULL REFERENCES novelai_work(id) ON DELETE CASCADE,
      name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 60),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS novelai_version_image (
      id TEXT PRIMARY KEY NOT NULL,
      version_id TEXT NOT NULL REFERENCES novelai_version(id) ON DELETE CASCADE,
      image_id TEXT NOT NULL,
      seed INTEGER,
      variant TEXT NOT NULL DEFAULT '',
      sort INTEGER NOT NULL DEFAULT 0,
      UNIQUE(version_id, image_id)
    );
    CREATE INDEX IF NOT EXISTS idx_novelai_version_parent ON novelai_version(parent_id);
    CREATE INDEX IF NOT EXISTS idx_novelai_version_branch ON novelai_version(work_id, branch_id, number);
    CREATE INDEX IF NOT EXISTS idx_novelai_version_image_image ON novelai_version_image(image_id);
  `)
}

// v37 — recycle bin for the NovelAI version tree. Deleting a version is a soft delete so the
// user can restore it; permanent removal is a separate, guarded operation.
function migrateNovelaiVersionTrash(legacy: LegacyDatabase): void {
  try { legacy.run('ALTER TABLE novelai_version ADD COLUMN deleted_at TEXT') } catch {}
  try { legacy.run('ALTER TABLE novelai_work ADD COLUMN deleted_at TEXT') } catch {}
  legacy.exec('CREATE INDEX IF NOT EXISTS idx_novelai_version_deleted ON novelai_version(work_id, deleted_at)')
}

// v38 — NovelAI asset library. `novelai_asset_usage` is the reverse index the reference tool does
// not have: it answers 「这块素材用在哪些图」 without scanning payloads.
function migrateNovelaiAssets(legacy: LegacyDatabase): void {
  legacy.exec(`
    CREATE TABLE IF NOT EXISTS novelai_asset (
      id TEXT PRIMARY KEY NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('character','style','scene','object','other')),
      name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
      payload TEXT NOT NULL DEFAULT '',
      examples TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS novelai_asset_usage (
      asset_id TEXT NOT NULL REFERENCES novelai_asset(id) ON DELETE CASCADE,
      image_id TEXT NOT NULL,
      via TEXT NOT NULL DEFAULT '',
      used_at TEXT NOT NULL,
      PRIMARY KEY(asset_id, image_id)
    );
    CREATE INDEX IF NOT EXISTS idx_novelai_asset_kind ON novelai_asset(kind, name);
    CREATE INDEX IF NOT EXISTS idx_novelai_asset_usage_image ON novelai_asset_usage(image_id);
  `)
}
// v39 — embedded browser history. One row per visit; the URL is the identity, timestamps order it.
// Kept in its own table so the history dialog can page and clear it without touching chat data.
function migrateBrowserHistory(legacy: LegacyDatabase): void {
  legacy.exec(`
    CREATE TABLE IF NOT EXISTS browser_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      visited_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_browser_history_visited ON browser_history(visited_at DESC);
    CREATE INDEX IF NOT EXISTS idx_browser_history_url ON browser_history(url);
  `)
}

// v40 — bookmarks imported from a browser export. One row per URL so re-importing is idempotent.
function migrateBrowserBookmarks(legacy: LegacyDatabase): void {
  legacy.exec(`
    CREATE TABLE IF NOT EXISTS browser_bookmark (
      url TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      folder TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_browser_bookmark_folder ON browser_bookmark(folder);
  `)
}

function resolveDatabasePath(): string {
  // 便携模式：exe同目录有 portable 文件则数据存本地 data/ 文件夹
  const exeDir = path.dirname(app.getPath('exe'))
  if (fs.existsSync(path.join(exeDir, 'portable'))) {
    const pDir = path.join(exeDir, 'data')
    if (!fs.existsSync(pDir)) fs.mkdirSync(pDir, { recursive: true })
    return path.join(pDir, 'grimoire.db')
  }
  return path.join(app.getPath('userData'), 'grimoire.db')
}

export function probeSchemaVersion(filePath: string): number | null {
  return readSchemaVersion(filePath)
}

function readSchemaVersion(filePath: string): number | null {
  if (!fs.existsSync(filePath)) return null
  let probe: DatabaseSync | null = null
  try {
    probe = new DatabaseSync(filePath, { readOnly: true })
    const table = probe.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_meta'").get()
    if (!table) return null
    const row = probe.prepare("SELECT value FROM schema_meta WHERE key='schema_version'").get() as { value?: string } | undefined
    const version = Number(row?.value)
    return Number.isFinite(version) ? version : null
  } catch {
    return null
  } finally {
    probe?.close()
  }
}

function backupBeforeMigration(filePath: string): void {
  if (!fs.existsSync(filePath) || readSchemaVersion(filePath) === CURRENT_SCHEMA_VERSION) return
  const backupPath = filePath + '.pre-migration-' + new Date().toISOString().replace(/[:.]/g, '-') + '.bak'
  try {
    fs.copyFileSync(filePath, backupPath)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error('数据库迁移前备份失败。数据库：' + filePath + '；备份目标：' + backupPath + '；原因：' + reason + '。请关闭其他 Grimoire 实例并确认目录可写后重试。')
  }
}

export async function initDatabase(): Promise<LegacyDatabase> {
  dbPath = resolveDatabasePath()
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  backupBeforeMigration(dbPath)

  nativeDb = new DatabaseSync(dbPath, { timeout: 5000, enableForeignKeyConstraints: true })
  db = initializeDatabaseConnection(nativeDb)
  return db
}

export function getDatabase(): LegacyDatabase {
  if (!db) throw new Error('数据库未初始化')
  return db
}

export function saveDatabase(): void {
  // Native SQLite persists each completed statement. Retained for IPC compatibility.
}

export function getDatabasePath(): string {
  return dbPath
}

export function getResourceRoot(): string {
  if (!dbPath) throw new Error('数据库未初始化')
  return path.join(path.dirname(dbPath), 'resources')
}

export function exportDatabase(exportPath: string): void {
  if (!db || !nativeDb) throw new Error('数据库未初始化')
  nativeDb.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  fs.copyFileSync(dbPath, exportPath)
}

export function importDatabase(importPath: string): void {
  if (!db || !nativeDb) throw new Error('数据库未初始化')
  if (!fs.existsSync(importPath)) throw new Error('导入文件不存在')
  if (path.resolve(importPath) === path.resolve(dbPath)) throw new Error('不能从当前正在使用的数据库导入')

  const token = crypto.randomUUID().replaceAll('-', '')
  const stagedPath = dbPath + `.import-${token}.tmp`
  const displacedPath = dbPath + `.replace-${token}.tmp`
  const importedBackupPath = dbPath + '.before-import-' + new Date().toISOString().replace(/[:.]/g, '-') + '.bak'
  let staged: DatabaseSync | null = null
  let originalMoved = false
  try {
    fs.copyFileSync(importPath, stagedPath)
    staged = new DatabaseSync(stagedPath, { timeout: 5000, enableForeignKeyConstraints: true })
    initializeDatabaseConnection(staged, true)
    assertIntegrity(staged, '导入数据库完整性检查失败')
    staged.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    staged.close()
    staged = null

    nativeDb.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    fs.copyFileSync(dbPath, importedBackupPath)
    nativeDb.close()
    nativeDb = null
    db = null

    fs.renameSync(dbPath, displacedPath)
    originalMoved = true
    fs.renameSync(stagedPath, dbPath)
    fs.rmSync(dbPath + '-wal', { force: true })
    fs.rmSync(dbPath + '-shm', { force: true })

    nativeDb = new DatabaseSync(dbPath, { timeout: 5000, enableForeignKeyConstraints: true })
    db = initializeDatabaseConnection(nativeDb, true)
    assertIntegrity(nativeDb)
    nativeDb.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    fs.rmSync(displacedPath, { force: true })
    originalMoved = false
  } catch (error) {
    try { staged?.close() } catch {}
    try { nativeDb?.close() } catch {}
    nativeDb = null
    db = null

    if (originalMoved) {
      fs.rmSync(dbPath, { force: true })
      fs.renameSync(displacedPath, dbPath)
    }

    nativeDb = new DatabaseSync(dbPath, { timeout: 5000, enableForeignKeyConstraints: true })
    db = initializeDatabaseConnection(nativeDb)
    throw error
  } finally {
    fs.rmSync(stagedPath, { force: true })
    fs.rmSync(stagedPath + '-wal', { force: true })
    fs.rmSync(stagedPath + '-shm', { force: true })
    if (!originalMoved) fs.rmSync(displacedPath, { force: true })
  }
}

export function closeDatabase(): void {
  if (!nativeDb) return
  try { nativeDb.exec('PRAGMA wal_checkpoint(TRUNCATE)') } catch {}
  nativeDb.close()
  nativeDb = null
  db = null
}

export async function importDefaultTags(tagsData: string): Promise<void> {
  const database = getDatabase()
  const categories = JSON.parse(tagsData) as Array<{
    id: string; en: string; zh: string; sort_order: number;
    subcategories: Array<{
      id: string; en: string; zh: string; sort_order: number;
      tags: Array<{
        id: string; en: string; zh: string; sort_order: number;
        source: string;
      }>;
    }>;
  }>
  
  const insertCat = database.prepare(
    `INSERT OR REPLACE INTO categories (id, group_id, en, zh, sort_order) VALUES (?,'default', ?, ?, ?)`
  )
  const insertSub = database.prepare(
    `INSERT OR REPLACE INTO subcategories (id, group_id, category_id, en, zh, sort_order) VALUES (?,'default', ?, ?, ?, ?)`
  )
  const insertTag = database.prepare(
    `INSERT OR REPLACE INTO tags (id, group_id, subcategory_id, en, zh, sort_order, source) VALUES (?,'default', ?, ?, ?, ?, ?)`
  )
  
  // 4589 条标签逐条 INSERT 各自是一个隐式事务，每条都要 fsync —— 实测首次启动有 2.86s 花在这里
  // （2026-11-27 打点：app-ready 271ms → tags-seeded 3311ms）。包进一个事务后只写一次 WAL，
  // 这是「首次运行慢」里最划算的一处修复，且不改变任何数据内容。
  database.run('BEGIN')
  try {
    for (const cat of categories) {
      insertCat.run([cat.id, cat.en, cat.zh, cat.sort_order])
      for (const sub of cat.subcategories) {
        insertSub.run([sub.id, cat.id, sub.en, sub.zh, sub.sort_order])
        for (const tag of sub.tags) {
          insertTag.run([tag.id, sub.id, tag.en, tag.zh, tag.sort_order, tag.source || 'builtin'])
        }
      }
    }
    database.run('COMMIT')
  } catch (error) {
    database.run('ROLLBACK')
    throw error
  }

  insertCat.free()
  insertSub.free()
  insertTag.free()
  saveDatabase()
}
