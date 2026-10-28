# 全量交叉矩阵与运行模拟证据汇总

生成时间：2026-10-27（第 72 轮）

本文件汇总当前**实际跑过的**旅程与矩阵，每条都对应机器生成的 JSON / 截图，不写未跑过的结论。

## 一、旅程结果（ui-parity.mjs）

| 旅程 | 断言数 | 结果 | 证据文件 |
|---|---|---|---|
| `--workbench` | 8 | **PASS** | `artifacts/visual/ui-parity/wb-*.png` |
| `--assets` | 4 | **PASS** | `as-*.png` |
| `--gallery` | 3（含 6 个开关） | **PASS** | `gallery-01-switches.png` |
| `--tooltip` | 4 | **PASS** | `tooltip-journey.json`、`tooltip-01-hover.png` |
| `--comfy-persist` | 5 | **PASS** | `comfy-persist.json` |

### 各自证明了什么

- **workbench**：建作品 → 块视图 → 存版本 → 软删 → 恢复 → **从旧版本开分支** → 素材联动需要两侧都点到。
  分支实测 `[1,2]`，联动素材「联动素材」双向可见。
- **assets**：建素材 → 记用量 → 反向查询（返回「雨中少女」）→ 删素材。
- **gallery**：切到图库面板 → 挂载 → 6 个筛选开关可交互。
- **tooltip**：真鼠标悬停 → 气泡出现、文本匹配、非系统样式、`aria-describedby` 关联。
- **comfy-persist**：真输入 → 保存 → 读库 → **切走再切回仍显示库里的值**（端到端持久化）。

## 二、矩阵结果（--visual-matrix）

| 视口 | 面板宽度 | 挂载 | 空白面板 | 表头裁剪 |
|---|---|---|---|---|
| 1600 | 351px | 18/18 | 无 | 无 |
| 1280 | 280px | 18/18 | 无 | 无 |
| 960 | 210px | 18/18 | 无 | 无 |

## 三、窄面板审计（--narrow-audit，按宽度记账）

| 视口 | 命中 | 预算 | 说明 |
|---|---|---|---|
| 默认 | 0 | 0 | 守死 |
| 1280 | 1 | 1 | gallery-search |
| 960 | 18 | 18 | 四栏布局的结构性下限，只降不升 |

## 四、门禁（G1–G10）

```
G1 渲染层类型   G2 主进程类型   G3 根测试   G4 Cherry 适配层测试   G5 Cherry 类型棘轮
G6 全量构建     G7 迁移矩阵格式  G8 CSS 覆盖率  G9 面板约定（4 条）        G10 路由覆盖
```

最近一次全绿快照：`artifacts/gates-2026-10-28T18-38-05-252Z.json`。

## 五、已知限制（不掩盖）

1. **CDP 截图不含跨文档 iframe 与原生子视图**：无限画布（iframe）与浏览器（`WebContentsView`）的正文不在截图里。
   求证方式改为读 iframe `innerText`（画布 612 字符真实 UI 文本）与主进程标题回调。
2. **960 视口下四栏布局不可用**：面板仅 210px，18/18 命中竖排/溢出。这是布局策略问题，已登记预算，未擅自改产品行为。
3. **源码类型棘轮未清零**：G5 自有 0、源码 269/270。

## 六、复现命令

```bash
node scripts/gates.mjs                                   # 门禁
node scripts/ui-parity.mjs --workbench                   # 工作台旅程
node scripts/ui-parity.mjs --assets                      # 素材库旅程
node scripts/ui-parity.mjs --gallery                     # 图库旅程
node scripts/ui-parity.mjs --tooltip                     # 气泡真机
node scripts/ui-parity.mjs --comfy-persist               # 持久化闭环
node scripts/ui-parity.mjs --visual-matrix               # 18 面板 × 3 宽度
node scripts/ui-parity.mjs --narrow-audit --width=960    # 窄面板审计
node scripts/check-panel-layout.mjs                      # G9
node scripts/check-route-coverage.mjs                    # G10
```
