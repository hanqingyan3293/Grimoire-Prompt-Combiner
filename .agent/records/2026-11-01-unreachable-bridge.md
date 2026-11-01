# 桥接方法没有入口（2026-11-01 第 144 轮）

`node scripts/report-unused-bridge.mjs` 对比 `src/renderer/global.d.ts` 声明的 196 个桥接方法与渲染层实际调用。

口径：先排除 `api.<ns>.<method>` 形式，再排除任意裸 `.method`（解构/包装调用）——剩下才是**哪儿都没有调用**的。

```
no api.ns.method call AND no bare .method anywhere: 19
cache.getAllShared cache.broadcastSync cache.onSync application.relaunch
media.relocate media.batchUpdate media.batchDelete
file.selectFolder file.openPath file.getPathForFile file.getMetadata file.createTempFile file.write
dataApi.onDataChanged workspace.focusPopout agent.stream tasks.onSnapshot
wd14.switchModel comfy.deleteWorkflow
```

## 已核实的两个「能力有、入口无」

| 方法 | 主进程有实现 | 界面入口 | 结论 |
|---|---|---|---|
| `wd14.switchModel` | 是 | **无**：`WD14Panel` 只调 `diagnostics / models / history / createTask`，没有任何切换模型的控件 | 用户选不了模型 |
| `comfy.deleteWorkflow` | 是 | **无**：面板只能导入与使用工作流，没有删除入口 | 导入错了删不掉 |

`agent.stream` 与第 143 轮 G13 的结论一致（事件通道只接了一端）。

## 其余多数是「协议层」而非缺陷

- `cache.*Sync` / `dataApi.onDataChanged` / `tasks.onSnapshot`：主进程 → 渲染层的事件，消费者在 vendor 侧或暂未使用；
- `media.batchUpdate|batchDelete|relocate`：批量操作用的是单条循环（见 `batchDeleteMediaAssets`），桥接方法保留但未接按钮；
- `file.*`：`file.save` 在 29 条「无前缀调用」里（说明有调用但写法不同），其余 `selectFolder/write/createTempFile` 暂无入口。

## 怎么复核

```bash
node scripts/report-unused-bridge.mjs
```

这是**报告不是门禁**：名字扫描看不到解构调用，`file.save`、`canvas.delete` 就曾出现在「未使用」里而实际分别被调用 8 次与 7 次。
读列表、逐条核实，再决定是补入口还是删桥接。
