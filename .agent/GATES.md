# 门禁定义（GATES）

> 2026-10-27 制定。每条门禁必须**可一条命令复现**、**有明确判定**、**结果写进 STATE.md**。
> 当前值是今天的实测，不是历史引用。改门禁定义要同步改本文并在 DECISIONS.md 记一条。

## 判定总原则

1. **绿 = 0 失败**，不接受"大部分通过"。
2. **不许用 `--noCheck`、排除源码、宽泛 ambient 声明**来把门禁变绿。
3. 门禁失败时修根因；修不动就如实记 BLOCKED 并写解除条件。
4. 每次声明"通过"必须附：命令 + 退出码 + 运行时间 + 次数（防 flaky）。

---

## G1 渲染层类型

```bash
npx tsc --noEmit -p tsconfig.json
```
- 范围：`src/renderer/**`、`src/shared/**`、`src/preload/**`
- 判定：退出码 0，无 `error TS`
- **当前：0 错误**

## G2 主进程类型

```bash
npx tsc -p tsconfig.node.json --noEmit
```
- 范围：`src/main/**`、`src/shared/**`、`src/preload/**`
- 判定：退出码 0
- **当前：0 错误**

## G3 根测试

```bash
node scripts/test-root-sharded.mjs
```
- 判定：0 failed（skipped 可接受）
- **为什么分片 + 串行**：本机 vitest 3.2.7 会偶发 worker RPC 超时（`Timeout calling "onTaskUpdate"`），用例全过但进程非零退出。分两片、片内 `--no-file-parallelism`，并且**只**在命中该签名时重试该片一次；真实断言失败不重试。
- **当前：144 files / 1339 passed / 2 skipped；但 5 次运行里 1 次 2 用例失败、1 次 worker 超时**
- **稳定性判定**：连续 3 次 exit 0 才算通过。任何一次失败必须抓到用例名，写进 STATE.md D6。
- 已知可接受噪声：`INFO: Could not find files for the given pattern(s).`（Windows 字体枚举）。

## G4 compat 测试

```bash
cd src/vendor/cherry/compat && npx vitest run
```
- 判定：0 failed
- **当前：35 files / 292 tests 全绿**
- 注意：`CompatTasksSettings.test.tsx` 的 `DataApiError: TASK_READ_UNAVAILABLE` 是**预期错误路径**的 stderr，不是失败。

## G5 compat 类型（**已拆分**）

原来的 `npm run typecheck:cherry-compat` 把只读的 Cherry 源码也拉进同一个编译程序，于是 272 条错误里 270 条出在我们无权修改的文件里。设为"必须真 0"等于永久红灯；用 `noCheck`/排除源码清零等于自欺。**拆成两条：**

### G5a 自有代码：必须 0

- 范围：`src/vendor/cherry/compat/src/**`（我们写的适配层）+ `src/shared/**`
- 判定：这些文件里 **0 条 `error TS`**
- **当前：2 条**（`cherry-chat-shell-entry.tsx:1097` TS2367 死分支；`CompatModelSettings.test.tsx:31` 测试里的断言类型）
- 这是真门禁：它抓到过 D1 那个死分支。

### G5b 只读源码诊断：棘轮，不得增长

- 范围：`src/vendor/cherry/source/**` 里被 compat 程序带入的错误
- 判定：总数 ≤ 冻结基线（`compat-source-diagnostics.json` 里的数字与分类），**任何增长都算失败**
- **当前基线：270 条**（分类：TS2339 109 / TS7006 48 / TS7053 30 / TS2551 19 / TS2307 18 / TS7016 11 / 其余 35）
- 18 条 TS2307 是源码依赖未安装（`@cherrystudio/remote-protocol`、`@cherrystudio/openai`、`@anthropic-ai/claude-agent-sdk`、`@opentelemetry/*`、`selection-hook`）。补依赖可以降基线，但属于依赖决策，不能顺手做。
- 实现方式：跑一次 tsc，按文件路径分桶统计；两半都打印。**不许静默过滤**。

## G6 全量构建

```bash
npm run build
```
- 判定：exit 0（build:cherry-compat → build:renderer → build:main → copy）
- **当前：exit 0**
- 已知噪声：chunk >500kB 警告、Tailwind 插件耗时提示。

## G7 矩阵格式

```bash
npm run check:migration-matrix
```
- 判定：无 malformed row
- 当前未复跑（上次 115 data rows）

## G8 CSS 覆盖率

```bash
npm run check:cherry-css
```
- 判定：≥90%（历史 98.6%）

## G9 路由审计

```bash
node scripts/audit-cherry-routes.mjs
```
- 前置：能开 Electron 窗口
- 判定：0 content failure
- 当前未复跑；上次 51 routes / 3 failed，**且这 3 个是信号定义问题（中文标题缺失）**——修信号再判定，不许放宽

## G10 截图证据

- 判定：每条 `passed` 必须有 entry + observedRoute + action + 可见非零 bounds + PNG SHA-256 + assertion；只有 PNG 文件存在不算
- `manualAcceptance` 只有用户明确确认后才能从 `pending` 改

## G11 打包

```bash
npm run pack
```
- 判定：exit 0，unpacked `app.asar` 里能动态加载 Pi SDK ESM surface
- 当前未复跑

## G12 秘密扫描（待建）

- 目标：renderer DTO、日志、fixture、截图、manifest 里不出现 api key / token / password / Authorization
- 现状：有三个受保护 key 的读写脱敏与拒绝（见 STATE.md 第 5 节），但没有全仓扫描脚本
- 计划：M0 里加 `scripts/check-secrets.mjs`，跑在 `artifacts/` 与 `dist/` 上

---

## 一键跑（待建）

`scripts/gates.mjs`（M0 交付）按 G1→G2→G3→G4→G5→G6→G7→G8 顺序跑，输出 JSON 摘要到 `artifacts/gates-<timestamp>.json`，任一失败即非零退出。G9/G11 需要 GUI/打包，单独 `--full` 开启。

## 面板布局约定（G9 强制）

面板宽度**不跟随窗口宽度**（实测：1280 窗口下每块面板只有 280px）。因此：

1. **双栏面板必须可换行**：外层 `flex flex-wrap`，主区给 `min-w-*`，侧栏 `min-w-*` + `shrink-0`。
   只写 `flex` 会把手动列压成一条缝（实测 28px，文字一字一行）。
2. **面板内禁止视口断点**：`sm:` / `md:` / `lg:` / `xl:` 在面板里是假的——它们看的是窗口宽度。
   需要「窄了就换行」时，用 `flex-wrap` + `min-w-*`；需要「窄了就少一列」时，用 grid 的固定列数。
   例外：`components/dev/`（整窗预览）与 `components/settings/SettingsWindow.tsx`（独立设置窗口）。
3. **折叠不渲染内容**：侧栏折叠时不要只加 `opacity-0`，否则零宽列里的文字既占布局又会读给读屏器。

这三条来自四次真实事故（工作台、素材库、图库、Agent 消息区），不是风格偏好。
`scripts/check-panel-layout.mjs` 扫描 1、2 两条并作为 **G9** 卡在门禁上；命中数超过
`scripts/panel-layout-baseline.json` 即失败，且基线只允许手动下调。

**第三条规则（2026-10-28 增补）**：`grid-cols-N`（N ≥ 3）且没有宽度保护（`min-w-` / `minmax` / `auto-fit` / `auto-fill`）→ 命中。
来历：图片库三个按钮在 210px 面板下每格约 60px，「链接原文件」四字竖排。固定列数网格不知道自己有多宽，
窄面板下就是逐格挤压。修法二选一：改成 `flex flex-wrap` + 子项 `min-w-*`（宽度驱动），
或保留网格但给子项加 `[&>*]:min-w-0` 让内容可缩。

## 窄面板审计的按宽度预算

`--narrow-audit` 的预算按视口宽度分开记（`scripts/narrow-baseline.json`）：

| 键 | 含义 | 当前 |
|---|---|---|
| `offenders` | 默认窗口（面板 304~351px） | **0** |
| `offendersAt1280` | 1280 窗口（面板 280px） | 1（gallery-search） |
| `offendersAt960` | 960 窗口（面板 210px） | 18（四栏布局的结构性下限） |

规则：默认宽度永远是 0；另两档是**已登记的债**，只能往下调，不能上调。
要上调必须在 STATE.md 写明理由——这样「窄窗口下四栏不可用」既没被当成通过，也没挡住其它工作。
