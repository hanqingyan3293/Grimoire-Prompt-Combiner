# Wave F 契约（2026-10-10）

9 项功能并行实现的**共享契约**。所有 agent 必须遵守：不改契约、不改本文件、不改 database.ts（已由主会话完成 v30）。

## Schema v30（已完成，勿动 database.ts）

- `image_perceptual_hashes(image_ref_id PK, dhash TEXT, color_histogram TEXT, width, height, computed_at)` — dhash 为 64 位 16 进制字符串；color_histogram 为 JSON 数组字符串（如 64 桶）。
- `image_embeddings(image_ref_id PK, model TEXT, dims INTEGER, vector BLOB, source TEXT, computed_at)` — vector 为 Float32 小端 BLOB。

## 通道（已完成，勿动 types.ts / preload/index.ts）

| 通道 | 值 | 用途 |
|---|---|---|
| MEDIA_SIMILARITY | `media:similarity` | 以某图为查询，返回相似图列表 |
| MEDIA_SIMILARITY_INDEX | `media:similarity:index` | 触发索引构建（分批） |
| MEDIA_SIMILARITY_PROGRESS | `media:similarity:progress` | 索引进度推送 |
| MEDIA_DUPLICATES | `media:duplicates` | 重复组列表 |
| MEDIA_FOLDER_SCAN | `media:folderScan` | 扫描目录（预览，不导入） |
| MEDIA_FOLDER_IMPORT | `media:folderImport` | 按扫描结果导入 |
| TAG_METADATA_GET | `tags:metadata:get` | 单标签元数据 |
| TAG_METADATA_SAVE | `tags:metadata:save` | 保存标签元数据 |
| TAG_METADATA_LIST | `tags:metadata:list` | 批量列出元数据 |

preload API 形状（已定，实现必须匹配）：
```ts
media.similarity(input: { imageRefId: number; limit?: number; method?: 'auto' | 'hash' | 'clip'; maxDistance?: number })
  → { method: 'hash' | 'clip'; items: Array<{ imageRefId: number; distance: number; score: number }> }
media.indexSimilarity(input?: { batchSize?: number })
  → { indexed: number; skipped: number; failed: number }
media.onSimilarityProgress(cb: (v: { done: number; total: number }) => void): () => void
media.duplicates(input?: { maxDistance?: number; limit?: number; page?: number })
  → { groups: Array<{ hash: string; imageRefIds: number[] }>; total: number }
media.folderScan(input: { directory: string; recursive?: boolean })
  → { directory: string; entries: Array<{ filePath: string; fileName: string; size: number; alreadyImported: boolean }>; total: number }
media.folderImport(input: { filePaths: string[]; mode?: 'managed' | 'external' })
  → { imported: number; skipped: number; failed: number; imageIds: number[] }
tags.metadata.get(tagId: string) → { tagId, namespace, description, color, isActive, source } | null
tags.metadata.save(input: { tagId: string; namespace?: string; description?: string; color?: string; isActive?: boolean }) → record
tags.metadata.list(tagIds: string[]) → record[]
```

## 分工（互不冲突的文件边界）

- **F1 感知哈希+相似图服务**：`src/main/services/perceptual-hash.core.ts`、`perceptual-hash.core.test.ts`
- **F2 重复检测服务**：`src/main/services/duplicate.service.ts`、`duplicate.service.test.ts`
- **F3 文件夹扫描服务**：`src/main/services/folder-scan.service.ts`、`folder-scan.service.test.ts`
- **F4 标签元数据服务+IPC**：`src/main/services/tag-metadata.service.ts`、`tag-metadata.service.test.ts`
- **F5 CLIP sidecar**：`python/clip_worker.py`、`src/main/services/clip-worker.ts`、`clip-worker.test.ts`
- **主会话**：IPC 注册（media.ipc.ts / tag-intelligence.ipc.ts 追加）、preload、UI 面板（gallery 相似图页签、重复检测视图、标签元数据编辑器、智能文件夹）

## 禁止

- 不改 `src/main/database.ts`（v30 已就位）
- 不改 `src/shared/types.ts` / `src/preload/index.ts`（通道已就位）
- 不改 `src/renderer/canvas-vendor/**`（并行会话领土）
- 不改 `src/main/services/task-runner.ts`（多模型 union 由主会话后续处理）
- 引用项目 licenses: BDTM=MIT, SDIS=MIT, TagStudio=GPL-3.0(语义参考), Hydrus=WTFPL, TagMaster=UNLICENSED(零代码), Allusion=GPL(仅 UX)

## 追加：CLIP 配置通道（2026-10-10 审计补齐）

| 通道 | 值 | preload |
|---|---|---|
| MEDIA_CLIP_DIAGNOSTICS | `media:clip:diagnostics` | `media.clip.diagnostics()` |
| MEDIA_CLIP_SELECT_MODEL_DIRECTORY | `media:clip:selectModelDirectory` | `media.clip.selectModelDirectory()` |
| MEDIA_CLIP_SELECT_PYTHON_PATH | `media:clip:selectPythonPath` | `media.clip.selectPythonPath()` |

UI 写入 `settings.clip_model_directory` / `settings.clip_python_path`（与 WD14 同一持久化模式：main/index.ts 启动时读取）。
