// 魔导书 Grimoire v7 — 工具栏
import React from 'react'

interface Props {
  onUpload: () => void
  onWebSearch: () => void
  onConvSettings: () => void
}

export function ToolbarRow({ onUpload, onWebSearch, onConvSettings }: Props) {
  return (
    <div className="flex items-center gap-1 px-1 pb-2">
      <button onClick={onUpload}
        className="p-1.5 rounded-lg text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-accent)]/10 transition-colors"
        title="上传文件/图片">
        📎
      </button>
      <button onClick={onWebSearch}
        className="p-1.5 rounded-lg text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-accent)]/10 transition-colors opacity-40 cursor-not-allowed"
        title="联网搜索（开发中）">
        🌐
      </button>
      <button onClick={onConvSettings}
        className="p-1.5 rounded-lg text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-accent)]/10 transition-colors"
        title="对话设置">
        ⚙
      </button>
    </div>
  )
}