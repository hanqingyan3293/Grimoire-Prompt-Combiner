# 门禁定义（GATES）

> 2026-10-27 制定。每条门禁必须**可一条命令复现**、**有明确判定**、**结果写进 STATE.md**。
> 本文定义判据，旧“当前”数字是注明日期的历史基线；最新事实统一见 STATE.md。2026-11-06 起执行后续计划，修改判据需同步代码/测试与 DECISIONS，禁止以更新基线掩盖失败。

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
- **自有基线：0 条**（2026-10-27 已修死分支与测试类型；每次执行仍要求重新检查，自有错误不豁免）
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

## G9 面板布局约定

```bash
node scripts/check-panel-layout.mjs
```
- 判定：不超过 `scripts/panel-layout-baseline.json`。

## G10 路由覆盖

```bash
node scripts/check-route-coverage.mjs
```
- 判定：已挂载页面调用的 IPC/DataApi 路由全部有处理分支。

## G11 样式契约

```bash
node scripts/ui-parity.mjs --style-contract
```
- 判定：真实渲染器 computed-style 契约与覆盖棘轮通过。

## G12 静默失败棘轮

```bash
node scripts/check-silent-catches.mjs
```
- 判定：不得超过基线。

## G13 IPC 双端接线

```bash
node scripts/check-ipc-coverage.mjs
```
- 判定：缺失接线仅可在明确白名单中。

## G14 台账证据路径

```bash
node scripts/check-evidence-paths.mjs
```
- 判定：引用文件与 npm scripts 可解析。

## G15 打包（M5 mandatory）

```bash
npm run verify:pack
npm run pack
node scripts/m5-pack.mjs --require-pack
```
- 判定：asar 内**全部** `dist/**` 文件必须与当前 `dist/**` 逐文件 SHA-256 一致；`missingInAsar`、`missingInDist`、`different` 任一非空即红。许可证、Pi ESM、runtime resources 另行校验。若包已是最新，只跑 `--require-pack` 验证，不再重建导致 hash 漂移。
- 不并入轻量默认 gates；`verify:full` 必须包含此门。

## G16 秘密扫描（M5 mandatory）

```bash
npm run check:secrets
```
- 判定：真实 token/key/password/Authorization 格式不得进入 renderer DTO、日志、fixture、截图、manifest；公开 fixture 例外必须明确标记。
- 规则覆盖 `sk-proj-`、`sk-ant-`、JWT、`client_secret`、`Authorization: Bearer|Basic|Token`，并有负向测试 `scripts/check-secrets.test.mjs`。
- 扫描范围：`artifacts/**`（含最终 aggregate）与 `dist/**` 文本 + asar 内 `dist/**` 文本；明确排除 `docs/**`、`resources/**` 运行时二进制、`node_modules/**`，但 `scanText` 本身不做上下文豁免。报告必须带 `buildSha256`、`sourceShellSha256` 与 `scanManifest`（文件清单 digest + 当前 dist digest）；最后一次扫描必须包含 `final-aggregate-latest.json`。
- fixture 例外只能是精确 `路径 + kind + 值`；当前 6 条（源/打包各 3 条），不得按目录或宽泛上下文放行。

## 功能门：Packaged GUI（M5 mandatory）

```bash
npm run acceptance:packaged-gui
```
- 判定：真实 `release/win-unpacked/Grimoire.exe` + 隔离 `--user-data-dir` 启动；CDP 验证 main/compat preload、`app.get_info`、`isPackaged:true`、默认 compat 路由、PNG IHDR 正尺寸、settings 回读、无 uncaught；owned PID 退出、临时 profile 删除、原用户 profile 未触碰。
- 本环境 main 窗口 loadFile 可能停在 `about:blank`；脚本可对同一 target 执行 `Page.navigate`，但必须写 `forcedNavigation`，不得冒充应用自身加载成功。
- 输出 `artifacts/m5/packaged-gui-latest.json` 与截图目录。

## 功能门：真实路由审计（非 G9 编号）

```bash
node scripts/audit-cherry-routes.mjs
```
- 前置：能开 Electron 窗口
- 判定：0 content failure
- 当前未复跑；上次 51 routes / 3 failed，**且这 3 个是信号定义问题（中文标题缺失）**——修信号再判定，不许放宽

## 功能门：截图证据与人工验收

- 判定：每条 `passed` 必须有 entry + observedRoute + action + 可见非零 bounds + PNG SHA-256 + assertion；只有 PNG 文件存在不算
- 2026-11-04 强化：action 对普通页面必须是真实 `navigation.open_route_in_main`（不是虚构的 `CDP Input.navigation`）；PNG 必须解析 IHDR 宽高且为正整数；bounds 必须在 viewport 内；route/query 参数必须 canonical 精确绑定；证据必须绑定当前 source-shell SHA-256。
- `surfaceCaptured`（表面已捕获）≠ `featureVerified`（功能已验证）≠ `manualAcceptance`（用户接受）。当前 `featureVerified=0`、`manualAcceptance=pending` 是事实，不是失败。
- `manualAcceptance` 只有用户明确确认后才能从 `pending` 改

## 一键跑

`scripts/gates.mjs` 运行 G1–G14（G11 是真实渲染器样式契约）；`--fast` 跳过 G3/G4/G6，不等价完整验收。输出 `artifacts/gates-<timestamp>.json`。

 `npm run verify:full` 调用 `scripts/m5-acceptance.mjs --full`，串行记录精确 G1–G14（raw logs + build before/after）、三次根测试（每次独立 `meta.json`）、25 条 journeys（五批、每批 10 分钟预算、同一当前 build、禁止旧 aggregate 继承）、B build/smoke、G15 fresh pack+exact hash+packaged ESM、packaged GUI、G16 秘密扫描、A/B 比较、capture 审核和 final aggregate。任一真实失败保持 failed；批次预算耗尽记 `budgetExhausted` 并保留 attempt，后续 bounded 重跑；人工/capture 缺项记 BLOCKED，manualAcceptance 保持 pending。
- 只想从现有原始证据汇总而不重跑套件时：`npm run acceptance:final`（`scripts/m5-final-aggregate.mjs`）。它要求自动项精确 10 个，校验 gates 精确 G1–G14/raw log/build before-after、root 3 个 meta、journeys 25 条全当前 build 且无 sourceAggregate、pack 全 dist manifest、capture/index、packaged GUI、secrets build/manifest、source-shell B artifact hash 和 A/B 表。缺文件、旧 build、旧 hash 或子集一律 `automated-failed`、exit 1；`status=automated-passed-manual-pending` 只表示自动项齐，人工仍未接受。

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

## 旅程套件（不在默认门禁内）

```bash
npm run journeys            # 全部旅程 + 矩阵 + 960 窄面板审计
npm run journeys -- --quick # 跳过 960 窄面板审计
```

每条旅程都会启动真实 Electron 渲染器，整套约 6–9 分钟，因此**不并入默认门禁**：
默认门禁（G1–G11）每轮都跑，旅程套件在**批量 UI 改动之后**、或交付前跑一次。

覆盖：工作台 8 项、素材库 4 项、图库 3 项、气泡 4 项、ComfyUI 持久化 5 项、样式契约 24 项、
视觉矩阵（18 面板 × 3 宽度，含空白面板与表头裁剪检测）、960 窄面板审计（按宽度预算）。

**第五条规则（2026-10-27 增补）**：`<input>` / `<textarea>` 上同时出现 `min-w-0` 而没有 `min-w-[...]` → 命中。
例外：`type=checkbox|radio|range|color`（本来就不该拉伸）与 `src/vendor/**`。
来历：五处真实的「输入框被挤死」——ComfyUI 地址 12px、浏览器地址栏 30px、标签名 0 宽、WD14 竖排、图片库竖排。
共同根因都是 `min-w-0 flex-1` 在固定宽兄弟旁被压到零。给字段一个下限，行用 `flex-wrap` 换行即可。
