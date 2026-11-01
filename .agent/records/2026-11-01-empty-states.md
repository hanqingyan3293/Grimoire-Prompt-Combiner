# 数据页在空 profile 下的空态（2026-11-01 第 155 轮）

工具：`node scripts/audit-cherry-routes.mjs --probe-route=app/<page>`（隔离临时 profile，故库为空）。
探针按文本节点遍历，**每个空态词都带最近祖先 class**，因此能区分页面级与侧栏级。

| 路由 | 页面级空态文案 | 侧栏「暂无会话」 | 行数 |
|---|---|---|---|
| `/app/files` | **「暂无文件」**(`font-normal.text-muted-foreground.text-sm`) | 有 | 0 |
| `/app/knowledge` | 无 | 有 | 0 |
| `/app/paintings` | 无 | 有 | 0 |
| `/app/translate` | 无 | 有 | 0 |
| `/app/mini-app` | 无 | **无**（该页不渲染会话栏） | 0 |
| `/app/chat` | 侧栏「暂无会话」 | 有 | 0 |

## 结论与边界

- 只有**文件库**在空库下给出文字空态；其余页面没有文字提示。
- 这不必然是缺陷：这些页面是**源页面原样挂载**，源的空态可能是图形/骨架而非文字，也可能是「数据未到时什么都不画」。
- 因此本表只记事实：**库为空时用户看到什么**。是否要补空态是产品决定，不在本表判断范围内。

## 复现

```bash
node scripts/audit-cherry-routes.mjs --probe-route=app/files
```

输出示例：
```
ROUTE-PROBE {"route":"/app/files","rows":0,"matches":[
  {"word":"暂无会话","cls":"flex.flex-col.items-center"},
  {"word":"暂无文件","cls":"font-normal.text-muted-foreground.text-sm"}]}
```
