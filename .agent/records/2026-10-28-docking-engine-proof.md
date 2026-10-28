# Docking engine：REIMPLEMENTED 证明（待批准）

日期：2026-10-27（第 77 轮）
能力行：`MIGRATION_MATRIX.md` 第 37 行「Docking engine」
当前状态：**NOT_IMPLEMENTED**（未擅自改）
建议状态：**REIMPLEMENTED**（需明确批准后才可写入矩阵）

## 一、事实基线

| 事实 | 证据 |
|---|---|
| dockview 源码已 vendor | `src/vendor/dockview/source/packages/{dockview-core,dockview-react}`，版本 8.4.0 |
| 未安装为依赖 | `node_modules/dockview` 不存在 |
| 包的入口指向构建产物 | `dockview-core/package.json`：`main: ./dist/package/main.cjs.js`、`types: ./dist/cjs/index.d.ts` |
| 构建产物不存在 | 包目录只有 `src/`、`rolldown.config.mjs`、`tsconfig.json`，没有 `dist/` |
| 渲染层 tsconfig 不含 vendor | `include` 仅 `src/renderer`、`src/shared`、`src/preload` |
| 引擎边界已存在 | `workspace-engine-adapter.ts`：`WorkspaceEngineBackend` = legacy-compatible 或 dockview，当前返回 legacy-compatible |
| 实际在用的布局 | Grimoire 自有面板系统（PanelShell + workspace.store），面板矩阵 18/18 三档宽度验证通过 |

## 二、逐级评估（按 AGENTS.md 要求顺序）

### 1. DIRECT_REUSE —— 技术拒绝
`import { DockviewReact } from 'dockview-react'` 无法成立：包未安装，`node_modules` 中无此模块。
仓库策略是只 vendor 源码、不装第三方运行时包，因此这一级在当前仓库形态下不可用。

### 2. VENDOR —— 有源码，但产物缺失，需要额外构建环节
本轮实验：在渲染层写探针文件直接 import vendor 内的 TS 入口，`tsc --noEmit` 报
`TS2307: Cannot find module .../packages/dockview-react/src/react`。
原因是该包的模块解析依赖 `dist/`（`package.json` 的 `main`/`types`），而 vendored 源码里没有 `dist/`；
同时渲染层 `tsconfig.include` 不包含 `src/vendor/**`。

要让 VENDOR 成立，需要二选一：
1. 用 rolldown 构建 vendored 包产出 `dist/`（引入第二个构建工具链与产物入仓策略）；
2. 增加路径别名指向 `src/index.ts`，并把 vendor 源码纳入类型检查——让数百个第三方源文件参与我们的 strict 检查与棘轮统计。

两者都不是改个 import 的量级，且都会改变仓库现有的 vendor 源码不参与类型统计边界。

### 3. WRAPPER / ADAPTER —— 边界已经写好，但没有可包装的目标
`workspace-engine-adapter.ts` 正是为此准备的适配层（注释写明：renderer 可切换引擎而不让业务编辑器或持久化文档耦合第三方 API）。
在 `dist/` 缺失的前提下，适配层没有可实例化的后端，只能返回 `legacy-compatible`。

### 4. MINIMAL_MODIFICATION —— 不适用（同 VENDOR 的阻塞）

### 5. PARTIAL_EXTRACTION —— 已实际发生，但范围有限
没有整体迁移 dockview 的拖拽/分栏引擎，只在其语义层面做了等价实现：面板可浮动、可最大化、可独立窗口、
可增删、宽度受约束、布局持久化。这部分能力由 PanelShell + workspace.store 承担。

### 6. REIMPLEMENT —— 结论
在上述阻塞下，面板停靠能力由自有实现提供。要写成 REIMPLEMENTED 必须承认一个事实：
这不是技术上不可能，而是当前仓库形态下代价高于收益——两级阻塞是真实的，但属于工程选择。

## 三、与简易版的区别（为什么不算凑数）

| 源 dockview 提供 | 我们的实现 |
|---|---|
| 拖拽重排、分栏、浮动组 | 面板浮动、最大化、独立窗口、增删、宽度拖拽、顺序持久化 |
| 标签页组、组内切换 | 每个面板自带类型选择器（33 种类型）+ 关闭/浮动/最大化 |
| 序列化/反序列化布局 | 布局写入 SQLite，重启恢复（矩阵三档 18/18 验证） |
| 嵌套分割 | 未实现（当前是固定四栏 + 面板内折叠） |

最后一行是真实差距：源支持任意嵌套分割，我们只有固定列结构。这既是 960 视口四栏不可用（18 命中，登记在案）的结构性来源，
也是本条不能写成 DIRECTLY_MIGRATED 的原因。

## 四、请求批准的事项

1. 是否同意把第 37 行状态从 `NOT_IMPLEMENTED` 改为 **REIMPLEMENTED**（附本文作为证据）；
2. 是否要求先补嵌套分割再改状态（那属于新功能，不在 M1/M2 收口范围内）；
3. 或者要求走 VENDOR 路线（构建 vendored dockview 的 `dist/` 并接适配层）——工作量以周计。

## 五、实验痕迹

探针文件 `src/renderer/__probe-dockview.ts` 已删除（只用于取得上面的 `TS2307` 证据）。
