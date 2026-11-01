# 桥接方法没有入口（2026-11-01 第 144–145 轮）

`node scripts/report-unused-bridge.mjs` 对比 `src/renderer/global.d.ts` 声明的 196 个桥接方法与渲染层实际调用。

口径：先排除 `api.<ns>.<method>` 形式，再排除任意裸 `.method`（解构/包装调用）——剩下才是**哪儿都没有调用**的（19 个）。

## 逐条核实结果

| 方法 | 主进程 | 界面 | 修正后的结论 |
|---|---|---|---|
| `wd14.switchModel` | POST `/switch` 给 Python worker，超时 10 分钟 | 面板**有**模型下拉（`#wd14-model`），并把 `modelId` 传给 `createTask` | **不是缺陷**：这是「预加载模型」的优化调用，界面通过每次任务传 `modelId` 已经能选模型。**未接是为了省一次 10 分钟预热**，属可选优化 |
| `comfy.deleteWorkflow` | 有实现 | 工作流以 `WorkflowCard` 列表呈现，**没有删除控件** | **成立**：导入错的工作流删不掉，只能留着 |

`agent.stream` 与第 143 轮 G13 的结论一致（事件通道只接了一端）。

> 第 144 轮我写的是「wd14.switchModel：用户选不了反推模型」——**这句是错的**。我只看到「方法没被调用」就推断了后果，
> 没去看面板本身有没有模型选择。第 145 轮核对代码后更正。

## 其余多数是「协议层」

- `cache.*Sync` / `dataApi.onDataChanged` / `tasks.onSnapshot`：主进程 → 渲染层事件；
- `media.batchUpdate|batchDelete|relocate`：批量操作目前用单条循环（`batchDeleteMediaAssets`），桥接方法保留未接按钮；
- `file.*`：`file.save` 属「无前缀调用」，其余 `selectFolder/write/createTempFile` 暂无入口。

## 怎么复核

```bash
node scripts/report-unused-bridge.mjs
```

这是**报告不是门禁**：名字扫描看不到解构调用，`file.save`、`canvas.delete` 就曾被列为未使用，实际分别调用 8 次与 7 次。
