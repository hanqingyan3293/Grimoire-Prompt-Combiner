// 魔导书 Grimoire v7 — 图库检查器
// Human-readable generation parameters (A1111/NAI/ComfyUI parsed records),
// tag editing with autocomplete, and per-asset actions. All data flows through
// the media/tags IPC surfaces; no filesystem access happens in the renderer.
import { useEffect, useMemo, useState } from 'react'
import { Clipboard, FolderOpen, Images, ScanSearch, Star, X } from 'lucide-react'
import { Button, IconButton } from '../ui/Button'
import { EmptyState, StatusBadge } from '../ui/Feedback'
import { TagAutocomplete } from '../tags/TagAutocomplete'
import { useTagsStore } from '../../stores/tags.store'
import type { GalleryItem } from '../../stores/gallery.store'

/** 相似图缩略图：经批量缩略图 IPC 读取，懒加载失败不阻塞面板。 */
function SimilarThumb({ imageRefId }: { imageRefId: number }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let disposed = false
    void window.api.media.thumbs({ ids: [imageRefId], kind: 'thumbnail' }).then(map => {
      if (!disposed) setUrl(map[imageRefId] ?? null)
    }).catch(() => { /* 缩略图缺失显示占位 */ })
    return () => { disposed = true }
  }, [imageRefId])
  return url
    ? <img src={url} alt="" className="aspect-square w-full rounded object-cover" />
    : <div className="grid aspect-square w-full place-items-center rounded bg-[var(--color-bg-tertiary)] text-[9px] text-[var(--color-text-secondary)]">…</div>
}

type SimilarState = { forId: number; loading: boolean; method: 'hash' | 'clip'; items: Array<{ imageRefId: number; distance: number; score: number }> }

type GenerationMetadata = {
  prompt?: string
  negative_prompt?: string
  provider?: string
  model?: string
  checkpoint?: string
  seed?: number | null
  sampler?: string
  scheduler?: string
  steps?: number | null
  cfg?: number | null
  width?: number | null
  height?: number | null
  origin?: string
}

type AssetLink = { tagId: string; source: string; confidence: number; status?: string }

const ORIGIN_LABELS: Record<string, string> = {
  webui: 'A1111/Forge',
  novelai: 'NovelAI',
  'comfyui-embedded': 'ComfyUI（内嵌）',
  'comfyui-grimoire': 'ComfyUI（本机生成）',
  'api-grimoire': 'API 生成',
}

export function InspectorPanel({ item, className, onOpenSimilar }: { item: GalleryItem | null; className?: string; onOpenSimilar?: (imageRefId: number) => void }) {
  const allTags = useTagsStore(state => state.tags)
  const [metadata, setMetadata] = useState<GenerationMetadata | null>(null)
  const [links, setLinks] = useState<AssetLink[]>([])
  const [filePaths, setFilePaths] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [similar, setSimilar] = useState<SimilarState | null>(null)
  // 相似漫游历史（Hydrus 式连续探索）：记录走过的图片 id，可后退。
  const [similarTrail, setSimilarTrail] = useState<number[]>([])
  const [autoExplore, setAutoExplore] = useState(false)

  // 查询并记录归属图片 id（forId）：渲染时只显示属于当前图的结果，
  // 避免「点了别的卡还显示上一张的相似图」，也不依赖 effect 清理的时序。
  const querySimilarFor = async (imageRefId: number) => {
    setSimilar({ forId: imageRefId, loading: true, method: 'hash', items: [] })
    try {
      const result = await window.api.media.similarity({ imageRefId, limit: 12 })
      setSimilar(current => current?.forId === imageRefId ? { forId: imageRefId, loading: false, method: result.method, items: result.items } : current)
    } catch (cause) {
      setSimilar(current => current?.forId === imageRefId ? null : current)
      setMessage(cause instanceof Error ? cause.message : '相似图查询失败')
    }
  }

  const findSimilar = () => {
    if (!item) return
    void querySimilarFor(item.imageRefId)
  }

  // 从相似图跳转：记录来路、切换目标图；开启连续探索时自动以新图为起点重查。
  const exploreSimilar = (imageRefId: number) => {
    if (item) setSimilarTrail(trail => [...trail, item.imageRefId])
    onOpenSimilar?.(imageRefId)
    if (autoExplore) void querySimilarFor(imageRefId)
    else setSimilar(null)
  }

  const backInTrail = () => {
    const previous = similarTrail.at(-1)
    if (previous === undefined) return
    setSimilarTrail(trail => trail.slice(0, -1))
    onOpenSimilar?.(previous)
    void querySimilarFor(previous)
  }

  const tagNameOf = useMemo(() => {
    const byId = new Map(allTags.map(tag => [tag.id, tag] as const))
    return (tagId: string) => {
      const tag = byId.get(tagId)
      return tag ? tag.zh || tag.en : tagId
    }
  }, [allTags])

  useEffect(() => {
    let disposed = false
    void window.api.images.list().then(images => {
      if (disposed) return
      const map: Record<number, string> = {}
      for (const image of images) map[image.id] = image.file_path
      setFilePaths(map)
    }).catch(() => {})
    return () => { disposed = true }
  }, [])

  useEffect(() => {
    let disposed = false
    setMetadata(null)
    setLinks([])
    setMessage('')
    if (!item) return () => { disposed = true }
    void window.api.media.metadata.get(item.mediaId).then(value => {
      if (!disposed) setMetadata((value || null) as GenerationMetadata | null)
    }).catch(() => {})
    void window.api.tags.assetLinks.list({ assetType: 'image', assetKey: 'image:' + item.imageRefId }).then(value => {
      if (!disposed) setLinks((value as AssetLink[]) || [])
    }).catch(() => {})
    return () => { disposed = true }
  }, [item?.mediaId, item?.imageRefId])

  const refreshLinks = async () => {
    if (!item) return
    try {
      const value = await window.api.tags.assetLinks.list({ assetType: 'image', assetKey: 'image:' + item.imageRefId }) as AssetLink[]
      setLinks(value || [])
    } catch { /* keep current links on failure */ }
  }

  const addTag = async (tagId: string) => {
    if (!item) return
    setBusy(true)
    try {
      await window.api.tags.assetLinks.assign({ assetType: 'image', assetKey: 'image:' + item.imageRefId, tagId, source: 'manual', status: 'accepted' })
      await refreshLinks()
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : '标签写入失败')
    } finally {
      setBusy(false)
    }
  }

  const removeTag = async (tagId: string) => {
    if (!item) return
    setBusy(true)
    try {
      await window.api.tags.assetLinks.remove({ assetType: 'image', assetKey: 'image:' + item.imageRefId, tagId })
      await refreshLinks()
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : '标签移除失败')
    } finally {
      setBusy(false)
    }
  }

  const parseEmbedded = async () => {
    if (!item) return
    setBusy(true)
    setMessage('')
    try {
      const result = await window.api.media.metadata.parse({ mediaId: item.mediaId, persist: true }) as GenerationMetadata | null
      setMetadata(result || null)
      setMessage(result ? '已解析并写入生成参数' : '未发现可解析的嵌入式参数')
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : '解析失败')
    } finally {
      setBusy(false)
    }
  }

  const copyPrompt = async () => {
    const prompt = String(metadata?.prompt || '').trim()
    if (!prompt) { setMessage('没有可复制的正面提示词'); return }
    try {
      await navigator.clipboard.writeText(prompt)
      setMessage('已复制正面提示词')
    } catch {
      setMessage('复制失败')
    }
  }

  const revealFile = () => {
    const filePath = item ? filePaths[item.imageRefId] : ''
    if (!filePath) { setMessage('文件路径不可用'); return }
    void window.api.system.showItemInFolder(filePath).catch((cause: unknown) => {
      setMessage(cause instanceof Error ? cause.message : '定位文件失败')
    })
  }

  const requestTagging = async () => {
    if (!item) return
    setBusy(true)
    try {
      await window.api.wd14.createTask({ imageId: item.imageRefId })
      setMessage('已提交 WD14 反推任务')
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : '反推任务提交失败')
    } finally {
      setBusy(false)
    }
  }

  if (!item) {
    return (
      <div className={className}>
        <EmptyState icon={ScanSearch} title="未选择资产" description="在网格中点击卡片查看生成参数与标签" />
      </div>
    )
  }

  const hasMetadata = Boolean(metadata && (metadata.prompt || metadata.model || metadata.checkpoint || metadata.seed))
  const presentTagIds = new Set(links.filter(link => link.status !== 'rejected').map(link => link.tagId))

  return (
    <aside className={className}>
      <div className="space-y-3 p-3 text-xs">
        <div>
          <div className="truncate text-sm font-medium text-[var(--color-text-primary)]" title={item.originalName}>{item.originalName}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-[var(--color-text-secondary)]">
            <StatusBadge tone={item.available ? 'success' : 'danger'}>{item.available ? '可用' : '文件缺失'}</StatusBadge>
            {item.favorite ? <Star size={11} className="fill-[var(--color-warning)] text-[var(--color-warning)]" aria-label="已收藏" /> : null}
            <span>评分 {item.rating}</span>
            <span>{item.width && item.height ? `${item.width}×${item.height}` : '尺寸未知'}</span>
            {metadata?.origin ? <span>{ORIGIN_LABELS[metadata.origin] || metadata.origin}</span> : null}
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" icon={Clipboard} onClick={() => void copyPrompt()}>复制提示词</Button>
          <Button size="sm" icon={FolderOpen} onClick={revealFile}>定位文件</Button>
          <Button size="sm" icon={ScanSearch} onClick={() => void requestTagging()} disabled={busy}>反推</Button>
          <Button size="sm" icon={Images} onClick={() => void findSimilar()} disabled={busy || !item.available}>相似图</Button>
        </div>

        {/* 相似图：优先 CLIP 语义（有 embedding 时），否则回落感知哈希并如实标注。
            结果带归属 id（forId）：换了目标图就不显示旧结果，无需依赖清理时序。 */}
        {similar && similar.forId === item.imageRefId ? (
          <section className="space-y-1.5 rounded border border-[var(--color-border)] p-2">
            <div className="flex items-center justify-between">
              <span className="font-medium text-[var(--color-text-primary)]">相似图（{similar.method === 'clip' ? 'CLIP 语义' : '感知哈希'}）</span>
              <button type="button" aria-label="关闭相似图结果" className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]" onClick={() => setSimilar(null)}><X size={12} /></button>
            </div>
            {/* 连续探索：来路可后退 + 自动以新图为起点重查 */}
            <div className="flex flex-wrap items-center gap-2 text-[10px]">
              <label className="inline-flex items-center gap-1"><input type="checkbox" checked={autoExplore} onChange={event => setAutoExplore(event.target.checked)} />连续探索</label>
              {similarTrail.length > 0 ? <button type="button" className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]" onClick={backInTrail}>← 返回 #{similarTrail.at(-1)}{similarTrail.length > 1 ? `（共 ${similarTrail.length} 步）` : ''}</button> : null}
            </div>
            {similar.loading ? <div className="text-[10px] text-[var(--color-text-secondary)]" role="status">正在计算…</div> : similar.items.length === 0 ? (
              <div className="text-[10px] text-[var(--color-text-secondary)]">没有在阈值内找到相似图。若尚未建索引，请先在工具栏执行「建立相似索引」。</div>
            ) : (
              <div className="grid grid-cols-4 gap-1.5">
                {similar.items.map(entry => (
                  <button key={entry.imageRefId} type="button" className="ui-list-card overflow-hidden p-1 text-left" onClick={() => exploreSimilar(entry.imageRefId)} title={`距离 ${entry.distance.toFixed(3)}${autoExplore ? '；点击以此图为起点继续' : ''}`}>
                    <SimilarThumb imageRefId={entry.imageRefId} />
                    <div className="mt-0.5 truncate text-[9px] text-[var(--color-text-secondary)]">{Math.round(entry.score * 100)}%</div>
                  </button>
                ))}
              </div>
            )}
          </section>
        ) : null}

        <section className="space-y-1.5 rounded border border-[var(--color-border)] p-2">
          <div className="flex items-center justify-between">
            <span className="font-medium text-[var(--color-text-primary)]">生成参数</span>
            <Button size="sm" variant="ghost" onClick={() => void parseEmbedded()} disabled={busy}>解析内嵌参数</Button>
          </div>
          {hasMetadata ? (
            <div className="space-y-1 text-[11px] text-[var(--color-text-secondary)]">
              {metadata?.prompt ? <div><span className="text-[var(--color-text-primary)]">正面：</span><span className="whitespace-pre-wrap break-words">{metadata.prompt}</span></div> : null}
              {metadata?.negative_prompt ? <div><span className="text-[var(--color-text-primary)]">负面：</span><span className="whitespace-pre-wrap break-words">{metadata.negative_prompt}</span></div> : null}
              {metadata?.model || metadata?.checkpoint ? <div>模型：{metadata.checkpoint || metadata.model}</div> : null}
              {metadata?.seed !== null && metadata?.seed !== undefined ? <div>种子：{metadata.seed}</div> : null}
              {metadata?.sampler ? <div>采样器：{metadata.sampler}{metadata.scheduler ? ` · ${metadata.scheduler}` : ''}</div> : null}
              {metadata?.steps !== null && metadata?.steps !== undefined ? <div>步数 {metadata.steps}{metadata.cfg !== null && metadata.cfg !== undefined ? ` · CFG ${metadata.cfg}` : ''}</div> : null}
            </div>
          ) : (
            <div className="text-[10px] text-[var(--color-text-secondary)]">无生成元数据；对 A1111/NovelAI/ComfyUI 导出的图片可尝试解析内嵌参数。</div>
          )}
        </section>

        <section className="space-y-1.5 rounded border border-[var(--color-border)] p-2">
          <span className="font-medium text-[var(--color-text-primary)]">标签（{presentTagIds.size}）</span>
          <div className="flex flex-wrap gap-1">
            {[...presentTagIds].map(tagId => (
              <span key={tagId} className="ui-prompt-chip inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px]">
                <span>{tagNameOf(tagId)}</span>
                <button type="button" aria-label={`移除${tagNameOf(tagId)}`} className="text-[var(--color-text-secondary)] hover:text-[var(--color-danger)]" onClick={() => void removeTag(tagId)}>
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
          <TagAutocomplete
            allTags={allTags}
            excludeIds={[...presentTagIds]}
            placeholder="搜索标签进行标注…"
            onSelect={entry => void addTag(entry.id)}
          />
        </section>

        {message ? <div role="status" className="text-[10px] text-[var(--color-text-secondary)]">{message}</div> : null}
      </div>
    </aside>
  )
}