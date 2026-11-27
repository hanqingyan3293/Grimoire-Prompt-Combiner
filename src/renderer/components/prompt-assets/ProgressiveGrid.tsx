// 渐进披露的卡片网格：先渲染 60 张，其余按需展开。
//
// 为什么需要它：为了让「空类目」消失，资产面板改成浏览时全量加载（1862 条），
// 分类默认展开 → 一次渲染 75,930 个 DOM 节点，滚动与切换明显发涩（2026-11-27 实测）。
// 正确修法不是退回分页（那会让类目计数失真），而是**数据照旧全量、渲染分批**。

import { useState } from 'react'

export const PROGRESSIVE_LIMIT = 60

export function ProgressiveGrid({
  items,
  renderCard,
  limit = PROGRESSIVE_LIMIT,
  gridClassName = 'grid min-w-0 gap-2 [grid-template-columns:repeat(auto-fill,minmax(148px,1fr))]',
}: {
  items: readonly unknown[]
  renderCard: (item: never) => React.ReactNode
  limit?: number
  gridClassName?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const overflowing = items.length > limit
  const visible = expanded || !overflowing ? items : items.slice(0, limit)

  return (
    <>
      <div className={gridClassName}>
        {visible.map((item) => renderCard(item as never))}
      </div>
      {overflowing && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="ui-button ui-button-ghost mt-2 w-full text-xs"
        >
          显示全部 {items.length} 项（已显示前 {limit} 项）
        </button>
      )}
    </>
  )
}
