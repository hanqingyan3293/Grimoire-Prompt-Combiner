// 魔导书 Grimoire v7 — 工具栏
import React from 'react'

interface Props {
  onUpload: () => void
  onWebSearch: () => void
  onConvSettings: () => void
}

export function ToolbarRow({ onUpload, onWebSearch, onConvSettings }: Props) {
  return (
    <div className="flex items-center gap-2 px-1 pb-2">
      <button onClick={onUpload}
        className="px-2.5 py-1.5 rounded-lg text-sm border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)]/50 hover:bg-[var(--color-accent)]/10 active:scale-95 transition-all"
        title="上传文件/图片">
        📎 上传
      </button>
      <button onClick={onWebSearch}
        className="px-2.5 py-1.5 rounded-lg text-sm border border-[var(--color-border)] text-[var(--color-text-secondary)] opacity-40 cursor-not-allowed"
        title="联网搜索（开发中，接口已预留）">
        🌐 搜索
      </button>
      <button onClick={onConvSettings}
        className="px-2.5 py-1.5 rounded-lg text-sm border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)]/50 hover:bg-[var(--color-accent)]/10 active:scale-95 transition-all"
        title="对话设置（模型/系统提示词等）">
        ⚙ 设置
      </button>
    </div>
  )
}