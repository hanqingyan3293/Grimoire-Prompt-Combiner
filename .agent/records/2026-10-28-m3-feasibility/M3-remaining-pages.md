# M3 剩余四个设置页：可行性判定

> 日期：2026-10-28 · 依据代码，不依据印象。每个页面回答三个问题：**源页面做什么**、**需要什么真服务**、**我们现在有什么**，最后给结论。
> 结论只有三种：`可接入`（有真服务，能解禁）/ `需要先做服务`（本轮不做，保持只读）/ `不适用于本构建`（隐藏或说明）。

## 总表

| 页面 | 源页面调用的能力 | 需要的真服务 | 现状 | 结论 |
|---|---|---|---|---|
| 联网搜索 `/settings/websearch` | `web_search.search_keywords`、`web_search.fetch_urls` | 供应商适配（Tavily / Exa / SearXNG / Bocha 等）+ URL 正文提取 | 无搜索执行、无提取 | **需要先做服务** |
| 浏览器 `/settings/browser` | `browser.data.clear`、history 数据源、导入 | Electron guest/WebContentsView 会话、Cookie/缓存清理、书签导入解析 | 无浏览器宿主 | **需要先做服务** |
| 截图 `/settings/screenshot` | `app.relaunch`、`feature.screenshot.*`、`shortcut.screenshot.capture` | `desktopCapturer` 截屏 + OCR 模型 + 全局快捷键注册 | 无截屏、无 OCR | **需要先做服务** |
| 划词助手 `/settings/selection-assistant` | `selection.get_linux_env_info`、`system.mac.*`、`feature.selection.*` 10 个偏好 | 原生全局划词钩子、工具栏/动作浮窗、全局快捷键 | 无钩子、无浮窗 | **不适用于本构建**（见下） |

## 逐页

### 1. 联网搜索

- 源页面做的事：选择搜索供应商、填 API key/端点、测试连通；能力由主进程 `WebSearchService` 提供，页面只发 `web_search.search_keywords`（关键词→结果）与 `web_search.fetch_urls`（URL→正文）。
- 我们能做的：与 API 网关同一条路——在 `src/main/services` 写 provider 适配器，用假上游做测试；凭据沿用偏好存储，不新建第二套。
- 缺的部分：正文提取（HTML→纯文本）需要自研或 vendor；供应商覆盖度决定「能用」还是「只有两个能用」。
- 结论：**需要先做服务**。若要解禁，最小可用范围是 SearXNG（自建、免 key）+ Tavily（最常用），并在页面里注明只支持这两家的原因。

### 2. 浏览器

- 源页面做的事：浏览器的隐私/权限偏好、历史记录弹窗、导入书签、清理数据（`browser.data.clear`）。
- 需要的真服务：Electron `WebContentsView` 宿主（或 `BrowserView`）、独立的 `session.fromPartition`、历史记录持久化、书签文件解析（Chrome/Edge/Firefox 三种格式）。
- 我们现在有什么：没有任何浏览器宿主，也没有浏览器面板。
- 结论：**需要先做服务**，且工作量大于网关与搜索之和。当前只读挂载是诚实的。

### 3. 截图

- 源页面做的事：截图开关、自动 OCR、全局快捷键绑定；`app.relaunch` 用于让快捷键生效。
- 需要的真服务：`desktopCapturer` 取屏 → 选区窗口 → 图片入库；OCR 需要一个可用的识别模型（本项目目前只有 WD14 标注，不是 OCR）。
- 结论：**需要先做服务**。若做，建议先做「截屏 + 落库 + 复制」，`auto_ocr` 在 OCR 服务到位前保持隐藏（与通用设置里处理死开关的方式一致）。

### 4. 划词助手

- 源页面做的事：10 个 `feature.selection.*` 偏好（触发方式、动作列表、浮窗透明度/固定/紧凑/跟随工具栏/记忆尺寸、过滤模式与过滤列表）、macOS 辅助功能授权、Linux 环境探测。
- 需要的真服务：系统级全局选区钩子（Windows 需低层鼠标钩子 + 剪贴板回退）、始终置顶的无边框浮窗、动作执行管线。
- 结论：**不适用于本构建**。理由不是「难」，而是它与「本地 SQLite + 主进程代理」的架构没有交集：浮窗与本项目的面板体系是两套界面。保持只读并写明缺失项，比造一个只有偏好的空壳诚实。

## 为什么这次不直接解禁

解禁一个没有服务的设置页，会得到一个**点了有反馈、实际什么也没发生**的界面——这正是本次迁移一路在清除的「假成功」。
对比：通用设置与 API 网关之所以能解禁，是因为它们背后分别有 15 个真实消费者和一台真实监听的服务。

## 若要做，建议顺序

1. **联网搜索**：SearXNG + Tavily 两个适配器 + 正文提取，可复用网关的假上游测试套路。
2. **截图**：`desktopCapturer` + 入库 + 设置页解禁，`auto_ocr` 先隐藏。
3. **浏览器**：最后做，涉及宿主生命周期与安全面。
4. **划词助手**：不在路线图内，直到有独立的浮窗体系。
