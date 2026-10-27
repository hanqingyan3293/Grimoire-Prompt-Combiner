# 归档：2026-10-27（接手日）

这些文件是 **历史记录**，不再是权威文档。保留原因：它们记录了当时的实测数字、被推翻的判断和已完成的波次，用于追溯"为什么现在是这样"。

| 文件 | 原位置 | 归档原因 |
|---|---|---|
| STATUS.md（208KB） | .agent/ | 追加式运行日志，日期非单调、数字前后矛盾（typecheck 39/0/2 三种口径），已被 `.agent/STATE.md` 取代 |
| CHERRY_UI_EXECUTION_STATUS.md | .agent/ | UI 流证据账本（截至 10-14），已被 `handoff/2026-10-27/UI.md` + STATE.md 取代 |
| CHERRY_UI_EXECUTION_PLAN.md | .agent/ | UI 流计划，已并入 `.agent/PLAN.md` |
| CHERRY_UI_ROUTE_GAPS.md | .agent/ | 路由缺口快照（10-13），其中多条已随后续改动失效 |
| CHERRY_UI_TYPECHECK_BLOCKERS.md | .agent/ | 记录 compat 类型阻塞；根/主类型现已 0 错，本文只剩历史意义 |
| REMAINING_WORK.md | .agent/ | 剩余工作清单（10-10），已并入 PLAN.md |
| WAVE_F_CONTRACTS.md | .agent/ | Wave F 已闭环（9/9），契约内容已被代码实现取代 |
| CHERRY_UI_HANDOFF.md | 仓库根 | UI 流交接（10-27 06:38），已被 `handoff/2026-10-27/UI.md` 取代 |
| GRIMOIRE_V8_UPGRADE_MASTER_SPEC.md | docs/ | 2026-09-07 的产品主规格。**与 .agent/SPEC.md 存在 10 处实质冲突**（产品定义、P0 范围、许可证 GPL vs AGPL、有无 Agent/ChatEngine 层、数据库、门禁、状态词汇、路线顺序）。现在的权威是 SPEC.md + 2026-10-03 架构升级任务书。其中仍有价值的部分（量化性能目标、版本化错误对象、扩展点清单）已摘录进 STATE.md 第 7 节。 |

## 使用规则

- 可以引用这些文件作为**历史证据**（"当时测到 X"），不得把其中的状态当成现在的事实。
- 文中的相对链接可能已失效（同批文件一起移动）。
- 需要恢复某个文件到原位置时，直接 `mv` 回去，并在 STATE.md 记录原因。
