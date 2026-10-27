// 魔导书 Grimoire v7 — 图库卡片（缩略图 + 选择圈 + 信息条）
// Pure presentation: the caller owns thumbnail derivation, shift semantics and
// badge actions; the card only decides layout, keyboard behavior and labels.
import React from 'react'
import { Check, ImageOff, Star } from 'lucide-react'

export interface GalleryCardProps {
  item: import('../../stores/gallery.store').GalleryItem
  /** dataURL；null = 尚未派生或读取失败，显示占位块 */
  thumbnailUrl: string | null
  selected: boolean
  /** 单击切换选择；事件原样交给调用方决定 shift 语义 */
  onToggleSelect: (event: React.MouseEvent) => void
  onOpen: () => void
  onBadgeClick?: (kind: 'favorite' | 'rating', value?: number) => void
}

const SOURCE_KIND_LABELS: Record<string, string> = {
  'imported-reference': '导入参考',
  'generated-comfy': 'ComfyUI',
  'generated-api': 'API 生成',
  'project-package': '项目包',
  'canvas-upload': '画布上传',
}

function sourceKindLabel(kind: string): string {
  return SOURCE_KIND_LABELS[kind] ?? kind
}

export const GalleryCard: React.FC<GalleryCardProps> = ({ item, thumbnailUrl, selected, onToggleSelect, onOpen, onBadgeClick }) => {
  const handleBadgeClick = (kind: 'favorite' | 'rating', value?: number) => (event: React.MouseEvent<HTMLButtonElement>) => {
    // 角标点击不参与卡片的选择/打开
    event.stopPropagation()
    onBadgeClick?.(kind, value)
  }

  const stopDoubleClick = (event: React.MouseEvent) => {
    event.stopPropagation()
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      onOpen()
    } else if (event.key === ' ') {
      event.preventDefault()
      // Space 复用 onToggleSelect：KeyboardEvent 同样带 shiftKey，调用方按同语义处理
      onToggleSelect(event as unknown as React.MouseEvent)
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={item.originalName}
      title={item.title || item.originalName}
      onClick={onToggleSelect}
      onDoubleClick={onOpen}
      onKeyDown={handleKeyDown}
      className={
        'group relative h-full w-full cursor-pointer select-none overflow-hidden rounded-lg border bg-[var(--color-bg-secondary)] transition-colors ' +
        (selected
          ? 'border-[var(--color-accent)] shadow-[0_0_0_1px_var(--color-accent)]'
          : 'border-[var(--color-border)] hover:border-[var(--color-accent-hover)]')
      }
    >
      {thumbnailUrl ? (
        <img src={thumbnailUrl} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)]">
          <ImageOff size={28} aria-hidden="true" />
        </div>
      )}

      {/* 底部信息条：文件名（截断）+ 来源 + 收藏 + 评分 */}
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-black/60 px-2 py-1.5 text-[11px] leading-4 text-white">
        <span className="min-w-0 flex-1 truncate" title={item.originalName}>
          {item.originalName}
        </span>
        <span className="shrink-0 rounded-sm bg-white/15 px-1 text-[10px] text-white/85">{sourceKindLabel(item.sourceKind)}</span>
        <button
          type="button"
          aria-label={item.favorite ? '取消收藏' : '收藏'}
          onClick={handleBadgeClick('favorite')}
          onDoubleClick={stopDoubleClick}
          className="flex shrink-0 cursor-pointer items-center"
        >
          <Star size={12} aria-hidden="true" className={item.favorite ? 'fill-[var(--color-warning)] text-[var(--color-warning)]' : 'text-white/80'} />
        </button>
        <button
          type="button"
          aria-label={`评分 ${item.rating}`}
          onClick={handleBadgeClick('rating', item.rating)}
          onDoubleClick={stopDoubleClick}
          className="shrink-0 cursor-pointer tabular-nums text-white/85 hover:text-white"
        >
          {item.rating}
        </button>
      </div>

      {/* 右上角选择圈：未选中时 hover 才显示 */}
      <span
        aria-hidden="true"
        className={
          'absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full border transition-opacity ' +
          (selected
            ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-accent-foreground)] opacity-100'
            : 'border-white/80 bg-black/35 text-transparent opacity-0 group-hover:opacity-100')
        }
      >
        <Check size={12} strokeWidth={3} />
      </span>

      {!item.available && (
        <span className="absolute left-1.5 top-1.5 rounded-sm bg-[var(--color-danger-surface)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-danger)] backdrop-blur-sm">
          文件缺失
        </span>
      )}
    </div>
  )
}