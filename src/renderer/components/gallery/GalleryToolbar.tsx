// 魔导书 Grimoire v7 — 图库工具栏（wave D）
// 搜索（250ms 防抖）/ 排序与方向 / SDIS 选择区 / 保存当前搜索。
// 所有变更只写 store；查询加载由面板 host 的 effect 统一触发。
import React, { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, CopyCheck, Save, ScanSearch, Search, Settings2 } from 'lucide-react'
import { Button, IconButton } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { StatusBadge } from '../ui/Feedback'
import { useGalleryStore, toBackendQuery, type GalleryQueryState } from '../../stores/gallery.store'

const SORT_OPTIONS: ReadonlyArray<{ value: GalleryQueryState['sort']; label: string }> = [
  { value: 'updated', label: '最近更新' },
  { value: 'created', label: '创建时间' },
  { value: 'rating', label: '评分' },
  { value: 'name', label: '名称' },
]

const SEARCH_DEBOUNCE_MS = 250
const SAVE_NOTICE_MS = 2000

export function GalleryToolbar({ className }: { className?: string }): React.ReactElement {
  const search = useGalleryStore(state => state.query.search)
  const sort = useGalleryStore(state => state.query.sort)
  const order = useGalleryStore(state => state.query.order)
  const selectionSize = useGalleryStore(state => state.selection.size)
  const selectionMode = useGalleryStore(state => state.selectionMode)
  const setQuery = useGalleryStore(state => state.setQuery)
  const selectAllFiltered = useGalleryStore(state => state.selectAllFiltered)
  const clearSelection = useGalleryStore(state => state.clearSelection)
  const saveCurrentSearch = useGalleryStore(state => state.saveCurrentSearch)

  const [draft, setDraft] = useState(search)
  const [saveName, setSaveName] = useState('')
  const [notice, setNotice] = useState('')
  const [previewCount, setPreviewCount] = useState<number | null>(null)
  const [indexing, setIndexing] = useState(false)
  const [indexProgress, setIndexProgress] = useState<{ done: number; total: number } | null>(null)
  const [similarityNotice, setSimilarityNotice] = useState('')
  const [duplicates, setDuplicates] = useState<{ groups: Array<{ hash: string; imageRefIds: number[] }>; total: number } | null>(null)
  const [clipDiagnostics, setClipDiagnostics] = useState<{ pythonPath: string; modelDirectory: string; pythonAvailable: boolean; runtimeAvailable: boolean; runtimeVersion: string | null; modelCount: number } | null>(null)
  const [duplicateConfirm, setDuplicateConfirm] = useState<{ hash: string; keepId: number; deleteIds: number[] } | null>(null)
  const [resolvingGroup, setResolvingGroup] = useState<string | null>(null)

  const buildIndex = async () => {
    if (indexing) return
    setIndexing(true); setSimilarityNotice('')
    setIndexProgress({ done: 0, total: 0 })
    try {
      const result = await window.api.media.indexSimilarity({ batchSize: 16 })
      const clipSuffix = result.clip ? `，CLIP 嵌入 ${result.clip.indexed} 张` : '（CLIP 未配置，当前为感知哈希索引）'
      setSimilarityNotice(`已索引 ${result.indexed} 张（跳过 ${result.skipped}，失败 ${result.failed}）${clipSuffix}`)
    } catch (cause) {
      setSimilarityNotice(cause instanceof Error ? cause.message : '索引构建失败')
    } finally {
      setIndexing(false); setIndexProgress(null)
    }
  }

  const findDuplicates = async () => {
    try {
      setDuplicates(await window.api.media.duplicates({ maxDistance: 6, limit: 50 }))
    } catch (cause) {
      setSimilarityNotice(cause instanceof Error ? cause.message : '重复检测失败')
    }
  }

  // 重复组处置：确认后删除组内除首张外的所有图片（保留 id 最小者）。
  const resolveDuplicateGroup = (group: { hash: string; imageRefIds: number[] }) => {
    setDuplicateConfirm({ hash: group.hash, keepId: group.imageRefIds[0], deleteIds: group.imageRefIds.slice(1) })
  }
  const confirmDuplicateDelete = async () => {
    if (!duplicateConfirm) return
    setResolvingGroup(duplicateConfirm.hash)
    try {
      // 按图片 id 逐张走 images.delete（主进程负责清理托管文件/派生图）。
      let removed = 0
      for (const imageRefId of duplicateConfirm.deleteIds) {
        try { await window.api.images.delete(imageRefId); removed += 1 } catch { /* 单张失败继续 */ }
      }
      setSimilarityNotice(`已删除 ${removed}/${duplicateConfirm.deleteIds.length} 张重复图片`)
      setDuplicateConfirm(null)
      // 刷新重复列表与图库。
      setDuplicates(await window.api.media.duplicates({ maxDistance: 6, limit: 50 }))
      useGalleryStore.getState().load()
    } catch (cause) {
      setSimilarityNotice(cause instanceof Error ? cause.message : '删除重复图片失败')
    } finally {
      setResolvingGroup(null)
    }
  }

  // CLIP 配置：选择目录/解释器后写 settings（与 WD14 同一模式），刷新诊断。
  const configureClip = async (kind: 'directory' | 'python') => {
    try {
      if (typeof window.api?.media?.clip?.selectModelDirectory !== 'function') { setSimilarityNotice('当前版本未暴露 CLIP 配置'); return }
      if (kind === 'directory') {
        const directory = await window.api.media.clip.selectModelDirectory()
        if (!directory) return
        await window.api.settings.set('clip_model_directory', directory)
        setSimilarityNotice('CLIP 模型目录已更新')
      } else {
        const pythonPath = await window.api.media.clip.selectPythonPath()
        if (!pythonPath) return
        await window.api.settings.set('clip_python_path', pythonPath)
        setSimilarityNotice('CLIP Python 路径已更新')
      }
      setClipDiagnostics(await window.api.media.clip.diagnostics())
    } catch (cause) {
      setSimilarityNotice(cause instanceof Error ? cause.message : 'CLIP 配置失败')
    }
  }

  useEffect(() => {
    if (typeof window.api?.media?.clip?.diagnostics !== 'function') return
    let disposed = false
    void window.api.media.clip.diagnostics().then(value => { if (!disposed) setClipDiagnostics(value) }).catch(() => { /* 诊断失败保持未设置态 */ })
    return () => { disposed = true }
  }, [])

  useEffect(() => {
    if (typeof window.api?.media?.onSimilarityProgress !== 'function') return
    return window.api.media.onSimilarityProgress(setIndexProgress)
  }, [])

  // "全部筛选结果" needs a concrete count before a batch writes anywhere: the
  // page only shows one page of the filter, so ask the backend for the real total.
  useEffect(() => {
    if (selectionMode !== 'allFiltered') { setPreviewCount(null); return }
    if (typeof window.api?.media?.batchPreview !== 'function') { setPreviewCount(null); return }
    let disposed = false
    void window.api.media.batchPreview({ query: toBackendQuery(useGalleryStore.getState().query) })
      .then(result => { if (!disposed) setPreviewCount(result.assets) })
      .catch(() => { if (!disposed) setPreviewCount(null) })
    return () => { disposed = true }
  }, [selectionMode])
  const syncedSearch = useRef(search)
  const noticeTimer = useRef<number | null>(null)

  // 外部改写 query.search（应用保存的搜索等）时同步输入框
  useEffect(() => {
    if (search !== syncedSearch.current) {
      syncedSearch.current = search
      setDraft(search)
    }
  }, [search])

  // 250ms 防抖后才写回 store，避免逐字触发查询
  useEffect(() => {
    if (draft === syncedSearch.current) return
    const timer = window.setTimeout(() => {
      syncedSearch.current = draft
      setQuery({ search: draft })
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [draft, setQuery])

  useEffect(() => () => {
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current)
  }, [])

  const flashNotice = (text: string) => {
    setNotice(text)
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(''), SAVE_NOTICE_MS)
  }

  const handleSave = async () => {
    const name = saveName.trim()
    if (!name) return
    const saved = await saveCurrentSearch(name)
    if (saved) {
      setSaveName('')
      flashNotice('已保存')
    } else {
      flashNotice('保存失败')
    }
  }

  const hasSelection = selectionSize > 0 || selectionMode === 'allFiltered'

  return (
    <div className={`flex flex-wrap items-center gap-2 text-xs ${className || ''}`}>
      <div className="relative min-w-[12rem] flex-1">
        <Search
          size={13}
          aria-hidden="true"
          className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)]"
        />
        <input
          type="text"
          value={draft}
          onChange={event => setDraft(event.target.value)}
          placeholder="搜索图库…"
          aria-label="搜索图库"
          className="ui-field w-full"
          style={{ paddingLeft: '26px' }}
        />
      </div>

      <div className="w-28 shrink-0">
        <select
          aria-label="排序方式"
          value={sort}
          onChange={event => setQuery({ sort: event.target.value as GalleryQueryState['sort'] })}
          className="ui-field w-full"
        >
          {SORT_OPTIONS.map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>
      <IconButton
        icon={order === 'desc' ? ArrowDown : ArrowUp}
        label="切换排序方向"
        title={order === 'desc' ? '当前降序' : '当前升序'}
        onClick={() => setQuery({ order: order === 'desc' ? 'asc' : 'desc' })}
      />

      <div className="flex items-center gap-2 border-l border-[var(--color-border)] pl-2">
        <span role="status" className="text-[var(--color-text-secondary)]">
          {selectionMode === 'allFiltered'
            ? (previewCount === null ? '全部筛选结果' : `全部筛选结果（${previewCount} 个资产）`)
            : `${selectionSize} 项已选`}
        </span>
        <Button size="sm" onClick={() => selectAllFiltered()}>选择全部筛选</Button>
        <Button size="sm" onClick={() => clearSelection()} disabled={!hasSelection}>清除选择</Button>
      </div>

      <div className="flex items-center gap-1.5 border-l border-[var(--color-border)] pl-2">
        <div className="w-36 shrink-0">
          <input
            type="text"
            value={saveName}
            onChange={event => setSaveName(event.target.value)}
            placeholder="保存当前搜索…"
            aria-label="保存搜索名称"
            className="ui-field w-full"
          />
        </div>
        <Button size="sm" variant="primary" icon={Save} onClick={() => void handleSave()} disabled={!saveName.trim()}>保存</Button>
        {notice ? <span className="text-[10px] text-[var(--color-text-secondary)]">{notice}</span> : null}
      </div>

      {/* 相似索引 + 重复检测（schema v30）；索引进度经推送通道显示 */}
      <div className="flex flex-wrap items-center gap-1.5 border-l border-[var(--color-border)] pl-2">
        <Button size="sm" icon={ScanSearch} onClick={() => void buildIndex()} disabled={indexing}>{indexing ? `索引中 ${indexProgress?.done ?? 0}/${indexProgress?.total ?? '…'}` : '建立相似索引'}</Button>
        <Button size="sm" icon={CopyCheck} onClick={() => void findDuplicates()} disabled={indexing}>查找重复</Button>
        {/* CLIP 配置：装好 CLIP ONNX 模型后在此指向模型目录，相似图自动从哈希升级为语义 */}
        <details className="relative">
          <summary className="flex cursor-pointer list-none items-center gap-1 rounded border border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]" title="配置 CLIP 语义相似（可选）"><Settings2 size={12} aria-hidden="true" />CLIP</summary>
          <div className="absolute right-0 z-10 mt-1 w-72 space-y-2 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-[11px] shadow-lg">
            {clipDiagnostics ? (
              <>
                <div className="flex flex-wrap gap-1.5">
                  <StatusBadge tone={clipDiagnostics.pythonAvailable ? 'success' : 'danger'}>Python {clipDiagnostics.pythonAvailable ? '可用' : '缺失'}</StatusBadge>
                  <StatusBadge tone={clipDiagnostics.modelCount > 0 ? 'success' : 'warning'}>模型 {clipDiagnostics.modelCount} 个</StatusBadge>
                </div>
                <div className="truncate text-[var(--color-text-secondary)]" title={clipDiagnostics.modelDirectory}>目录：{clipDiagnostics.modelDirectory || '（未设置）'}</div>
                <div className="truncate text-[var(--color-text-secondary)]" title={clipDiagnostics.pythonPath}>解释器：{clipDiagnostics.pythonPath}</div>
                {clipDiagnostics.modelCount === 0 ? <div className="text-[10px] text-[var(--color-text-secondary)]">未检测到 .onnx 文件；放入 CLIP 视觉编码器模型后相似图将从「感知哈希」升级为「CLIP 语义」。</div> : null}
              </>
            ) : <div className="text-[var(--color-text-secondary)]">正在读取 CLIP 环境…</div>}
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" onClick={() => void configureClip('directory')}>选择模型目录</Button>
              <Button size="sm" onClick={() => void configureClip('python')}>选择 Python</Button>
            </div>
          </div>
        </details>
        {similarityNotice ? <span className="text-[10px] text-[var(--color-text-secondary)]">{similarityNotice}</span> : null}
      </div>

      {duplicates ? (
        <div className="w-full rounded border border-[var(--color-border)] p-2 text-[11px]">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-medium text-[var(--color-text-primary)]">重复组（{duplicates.total}）</span>
            <button type="button" aria-label="关闭重复检测结果" className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]" onClick={() => setDuplicates(null)}>×</button>
          </div>
          {duplicates.groups.length === 0 ? (
            <div className="text-[var(--color-text-secondary)]">未发现重复图片。若尚未建索引，请先「建立相似索引」。</div>
          ) : duplicates.groups.slice(0, 8).map(group => (
            <div key={group.hash} className="border-t border-[var(--color-border)] py-1.5 first:border-t-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[var(--color-text-secondary)]">{group.imageRefIds.length} 张</span>
                <span className="font-mono text-[10px] text-[var(--color-text-secondary)]">{group.hash.slice(0, 8)}…</span>
                <span className="min-w-0 flex-1 truncate text-[var(--color-text-secondary)]">#{group.imageRefIds.join(', #')}</span>
                {/* 处置动作：每组保留第一张（id 最小），删除其余——这是检测到重复后的闭环 */}
                <Button size="sm" variant="danger" onClick={() => void resolveDuplicateGroup(group)} disabled={resolvingGroup === group.hash}>
                  {resolvingGroup === group.hash ? '删除中…' : '保留首张，删除其余'}
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* 删除确认：列出将删除与保留的 id，确认前不写任何数据 */}
      <Modal title="删除重复图片" open={duplicateConfirm !== null} onClose={() => setDuplicateConfirm(null)}>
        <div className="space-y-3 p-1 text-xs">
          <p>将删除 {duplicateConfirm ? duplicateConfirm.deleteIds.length : 0} 张重复图片（含托管文件与派生图，外链原文件不受影响）；保留 #{duplicateConfirm?.keepId ?? ''}。</p>
          <div className="max-h-32 overflow-auto rounded border border-[var(--color-border)] p-2 text-[var(--color-text-secondary)]">
            删除：{duplicateConfirm?.deleteIds.map(id => '#' + id).join('、')}
          </div>
          <div className="flex gap-2">
            <Button className="flex-1" onClick={() => setDuplicateConfirm(null)}>取消</Button>
            <Button className="flex-1" variant="danger" onClick={() => void confirmDuplicateDelete()} disabled={resolvingGroup !== null}>确认删除</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}