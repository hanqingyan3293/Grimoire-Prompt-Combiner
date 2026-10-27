// 魔导书 Grimoire v7 — 保存的搜索列表（wave D）
// 列表顺序由后端保证（pinned 优先、updatedAt 降序），组件按原序渲染；
// 数据加载由面板 host 触发，组件内不做自动加载（避免双请求），仅提供手动刷新。
// 另提供 JSON 导出 / 导入：导出为 { version: 1, searches } 信封，导入容忍同样的信封或裸数组。
import React, { useEffect, useRef, useState } from 'react'
import { Bookmark, Download, Pin, RefreshCw, Star, Trash2, Upload } from 'lucide-react'
import { IconButton } from '../ui/Button'
import { EmptyState } from '../ui/Feedback'
import { toBackendQuery, useGalleryStore, type SavedSearch } from '../../stores/gallery.store'

const NOTICE_MS = 2000

// 解析导入文本：容忍 { version?: 1, searches: [...] } 信封或直接是数组；其余视为无效。
function parseSavedSearchesFile(text: string): Array<Record<string, unknown>> | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (Array.isArray(parsed)) return parsed as Array<Record<string, unknown>>
  if (parsed && typeof parsed === 'object') {
    const envelope = parsed as { version?: unknown; searches?: unknown }
    if ((envelope.version === undefined || envelope.version === 1) && Array.isArray(envelope.searches)) {
      return envelope.searches as Array<Record<string, unknown>>
    }
  }
  return null
}

export function SavedSearches({ className }: { className?: string }): React.ReactElement {
  const savedSearches = useGalleryStore(state => state.savedSearches)
  const applySavedSearch = useGalleryStore(state => state.applySavedSearch)
  const deleteSavedSearch = useGalleryStore(state => state.deleteSavedSearch)
  const loadSavedSearches = useGalleryStore(state => state.loadSavedSearches)

  const [notice, setNotice] = useState('')
  const noticeTimer = useRef<number | null>(null)
  // 智能文件夹 = 置顶的保存搜索作为固定视图。计数来自后端真实查询
  // （media.batchPreview），不猜测页面上已加载的条目数。
  const [counts, setCounts] = useState<Record<string, number | null>>({})

  useEffect(() => () => {
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current)
  }, [])

  // 每次列表变化后刷新置顶项的计数（未置顶项按需计入，避免 N 次查询）。
  useEffect(() => {
    const pinned = savedSearches.filter(item => item.pinned)
    if (!pinned.length) { setCounts({}); return }
    let disposed = false
    void Promise.all(pinned.map(async item => {
      try {
        const query = item.queryJson ? JSON.parse(item.queryJson) as Partial<ReturnType<typeof toBackendQuery>> : {}
        const result = await window.api.media.batchPreview({ query: query as Record<string, unknown> })
        return [item.id, result.assets] as const
      } catch {
        return [item.id, null] as const
      }
    })).then(entries => { if (!disposed) setCounts(Object.fromEntries(entries)) })
    return () => { disposed = true }
  }, [savedSearches])

  const flashNotice = (text: string) => {
    setNotice(text)
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(''), NOTICE_MS)
  }

  const togglePin = async (item: SavedSearch) => {
    try {
      await window.api.tags.savedSearches.save({ id: item.id, name: item.name, queryJson: item.queryJson, sortJson: item.sortJson, viewMode: item.viewMode, pinned: !item.pinned })
      await loadSavedSearches()
      flashNotice(item.pinned ? `已取消固定「${item.name}」` : `已固定「${item.name}」为智能文件夹`)
    } catch {
      flashNotice('更新固定状态失败')
    }
  }

  const handleExport = async () => {
    const searches = useGalleryStore.getState().savedSearches
    try {
      const ok = await window.api.dialog.save(JSON.stringify({ version: 1, searches }, null, 2), 'grimoire-saved-searches.json')
      if (!ok) {
        flashNotice('已取消导出')
        return
      }
      flashNotice(`已导出 ${searches.length} 条`)
    } catch {
      flashNotice('导出失败')
    }
  }

  const handleImport = async () => {
    let text: string | null = null
    try {
      text = await window.api.dialog.open()
    } catch {
      flashNotice('导入失败')
      return
    }
    if (text == null) return
    const items = parseSavedSearchesFile(text)
    if (!items) {
      flashNotice('导入内容不是有效的保存搜索 JSON')
      return
    }
    let imported = 0
    let skipped = 0
    for (const raw of items) {
      const item = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
      const name = typeof item.name === 'string' ? item.name.trim() : ''
      if (!name) {
        skipped += 1
        continue
      }
      const input: { name: string; queryJson?: string; sortJson?: string; viewMode?: string; pinned?: boolean } = { name }
      if (typeof item.queryJson === 'string') input.queryJson = item.queryJson
      if (typeof item.sortJson === 'string') input.sortJson = item.sortJson
      if (typeof item.viewMode === 'string') input.viewMode = item.viewMode
      if (typeof item.pinned === 'boolean') input.pinned = item.pinned
      try {
        await window.api.tags.savedSearches.save(input)
        imported += 1
      } catch {
        skipped += 1
      }
    }
    await useGalleryStore.getState().loadSavedSearches()
    flashNotice(`已导入 ${imported} 条（跳过 ${skipped} 条）`)
  }

  return (
    <div className={`flex min-h-0 flex-col ${className || ''}`}>
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-2.5 py-1.5">
        <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-text-primary)]">
          <Bookmark size={13} aria-hidden="true" />保存的搜索
        </span>
        <div className="flex items-center gap-0.5">
          <IconButton icon={Download} label="导出保存的搜索" onClick={() => void handleExport()} />
          <IconButton icon={Upload} label="导入保存的搜索" onClick={() => void handleImport()} />
          <IconButton icon={RefreshCw} label="刷新保存的搜索" onClick={() => void loadSavedSearches()} />
        </div>
      </div>
      {notice ? (
        <div role="status" className="px-2.5 pt-1.5 text-[10px] text-[var(--color-text-secondary)]">{notice}</div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {savedSearches.length === 0 ? (
          <EmptyState
            icon={Bookmark}
            title="暂无保存的搜索"
            description="在工具栏输入名称即可保存当前筛选与排序"
          />
        ) : (
          <ul className="space-y-1">
            {savedSearches.map(item => (
              <li
                key={item.id}
                className="flex items-center gap-1 rounded border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-2 py-1"
              >
                <button
                  type="button"
                  onClick={() => void applySavedSearch(item.id)}
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs text-[var(--color-text-primary)]"
                  title={item.pinned ? '智能文件夹（已固定）' : '点击应用此保存的搜索'}
                >
                  {item.pinned ? (
                    <Star size={11} aria-hidden="true" className="shrink-0 text-[var(--color-accent-text)]" />
                  ) : null}
                  <span className="truncate">{item.name}</span>
                  {item.pinned && counts[item.id] !== undefined && counts[item.id] !== null ? (
                    <span className="ui-count-badge shrink-0">{counts[item.id]}</span>
                  ) : null}
                </button>
                <IconButton
                  icon={Pin}
                  label={item.pinned ? `取消固定${item.name}` : `固定${item.name}为智能文件夹`}
                  onClick={() => void togglePin(item)}
                  className={item.pinned ? 'text-[var(--color-accent-text)]' : ''}
                />
                <IconButton icon={Trash2} label={`删除${item.name}`} onClick={() => void deleteSavedSearch(item.id)} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}