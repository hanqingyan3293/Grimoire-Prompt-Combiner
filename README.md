# 魔导书 Grimoire v0.7.3-alpha

> 面向 AI 绘画与 AI 对话的提示词工作台：标签库、提示词组合、提示词资产、自由多面板工作区。

![主工作区](./docs/screenshots/01-main-workspace.jpg)

## 这个软件解决什么问题

做 AI 绘画的人大多经历过同一个循环：翻十几页标签文档找词 → 拼一条提示词 → 生成、不满意、改一个词 → 下次想复用却只剩聊天记录里一段散落的文本。提示词不是一次性的输入，它是需要沉淀、迭代、复用的资产，但大多数工具只给了你一个输入框。

魔导书把这条链路做成一个桌面工作台，围绕三个取舍展开：

- **标签驱动，而不是自由手打**——4589 个中英对照标签按「大类 / 子类 / 标签」三层组织，支持搜索、筛选、随机抽取；点一下就进提示词，权重、正负面、去重都由工具处理，不用记语法。
- **提示词是资产，不是草稿**——内置 1862 条来自 8 个来源的提示词资产，加上你自己的历史、预设与收藏，都能分类、检索、预览、一键应用；带图资产直接显示缩略图。
- **多面板并行，而不是单窗口切换**——同一屏可以同时开标签库、提示词工作区、提示词资产、AI 助手、无限画布，面板可分割、合并、弹出为独立窗口，布局自动保存。

## 核心能力

### 标签库与标签组

- 4589 个中英对照标签，三层树形结构，按子类折叠浏览。
- 搜索同时匹配中文、英文与别名；可标记收藏、加入正向 / 负向。
- 多套独立标签组：导入、导出、重命名、复制，不同创作场景用不同词库。
- 随机抽取：从当前筛选范围里抽 N 个标签，范围与数量可设置。

### 提示词工作区

- 正面 / 负面分栏，标签以 chip 形式展示，可拖拽排序、单独调权重。
- 去重、随机抽取、清空正面 / 负面、撤销 / 重做。
- 一键复制中文或英文成品，或把结果交给下游面板。

### 提示词工作台

面向长提示词与角色提示的文档式编辑：

- 块解析：块名、布局（独立行 / 连写）与原文分离，改名字不会动到原文一个字。
- 原文保真：CRLF、代理对、重复文本的编辑原点都按字符保留。
- 多角色：每个角色有独立的正向 / 负向文本与稳定 ID。
- 随机池：多选项标记按 seed 抽样，每次取一个且可复现；空池、未知标记、不支持的写法都会明确报错并且零写入。
- 事务撤销：编辑按「用户 / Agent」分组，可以只撤销 Agent 改动的区域，重叠的用户编辑会被保留并提示冲突。

### 提示词资产

- 内置 1862 条资产，来自 8 个来源；按角色 / 风格 / 场景 / 商品电商 / 海报排版 / UI 界面 / 信息图 / 摄影写实 / 生活趣味九个货架归类，另有「其他」兜底。
- 四种视图：资产、历史、预设、收藏。
- 卡片预览、复制原文、一键应用到提示词；带图资产显示缩略图，支持拖拽到分类下重新归位。
- 分类树可自建，资产可多分类归属。

### 标签与资产

统一管理「标签之间的关系」与「标签和资产之间的标注」：

- 标签字典：搜索、查看别名、元数据、标签间关系（相关 / 推导 / 冲突 / 父级）。
- 候选标签：汇总 WD14 反推、提示词解析、AI 识图产出的待确认候选，可批量接受 / 拒绝 / 映射。
- 资产标注：把标签挂到图片、提示词资产、画布节点上，也能按标签反查资产。
- 批量工具：按筛选批量添加 / 删除 / 替换标签，先 dry-run 预览影响面，再确认写入。

### 无限画布

- 图片、提示词、任务节点自由摆放，支持连线与缩放。
- 项目自动保存与恢复，带 revision 保护与保存队列。
- 提示词库与工具侧栏可直接取用资产，拖拽到画布节点。

### AI 工作台

- 多供应商配置：兼容 Chat Completions 与 Responses API，可拉取模型列表并做连接测试。
- Agent Runtime：Pi / OpenCode 适配器，权限模式分为请求确认 / 自动 / 完全允许。
- MCP 服务管理：手动启用工具，逐个 Server 查看连接状态与工具数量。
- 会话与主题：会话持久化、分组、分支、导出 / 导入。

### 其他面板

- **WD14 反推**：本地图片批量打标，阈值与候选可调，结果进入候选池。
- **ComfyUI**：工作流、模型与生成任务管理，失败重试与状态追踪。
- **图库搜索**：语法化筛选、虚拟网格、检查器、保存搜索。
- **内嵌浏览器**、**任务队列**：查资料与跑后台任务不用切窗口。

### 工作区

- 顶栏切换「创作 / AI / 识图 / 图片参考 / 标签管理」等工作区。
- 面板可拖拽分割、合并为标签页、弹出为独立窗口；布局写入本地文档，重启后恢复。
- 右侧常驻 AI 助手与设置入口。

## 界面

| 设置中心 | 外观与主题 |
|---|---|
| ![设置](./docs/screenshots/02-settings.jpg) | ![外观](./docs/screenshots/03-settings-appearance.jpg) |

| 提示词资产 | 标签与资产（含批量工具） |
|---|---|
| ![提示词资产](./docs/screenshots/04-prompt-assets.jpg) | ![标签与资产](./docs/screenshots/05-tag-batch.jpg) |

## 典型用法

**从零写一条图生图提示词**
标签库挑主体与风格 → 提示词工作区调整权重、加负面词 → 复制成品，或直接粘进工作台做块化整理。

**把一套风格沉淀成资产**
写完一条满意的提示词后存为预设，打上标签分类；下次在提示词资产里按分类或关键词找到它，一键应用。

**用 WD14 反推再修正**
丢一张参考图进 WD14 面板 → 反推结果进「候选标签」→ 在标签与资产里批量接受 / 拒绝 / 改映射 → 用批量工具给同一批图片补上风格标签。

## 下载与安装

系统要求：**Windows 10 / 11 x64**。

| 文件 | 说明 |
|---|---|
| `Grimoire.Setup.0.7.3-alpha.exe` | NSIS 安装版：可选安装目录，创建桌面快捷方式 |
| `Grimoire.0.7.3-alpha.exe` | 单文件免安装版：放到任意目录双击运行，适合 U 盘 / 移动硬盘 |
| `Grimoire-portable-0.7.3-alpha.zip` | ZIP 便携版：解压后运行目录内的 `Grimoire.exe`，启动最快 |
| `SHA256SUMS-0.7.3-alpha.txt` | 以上文件的 SHA-256 校验和 |

下载地址：[最新 Release](https://github.com/hanqingyan3293/Grimoire-Prompt-Combiner/releases/latest)

用户数据默认存放在 `%APPDATA%\Grimoire\grimoire.db`（SQLite），换版本时保留该文件即可。想让数据跟着程序走：在 `Grimoire.exe` 同目录放一个名为 `portable` 的空文件，数据库会改存到同目录 `data\grimoire.db`。

安装包未做代码签名，Windows SmartScreen 首次运行会提示「更多信息 → 仍要运行」。

## 从源码运行

```bash
npm install
npm run build
node scripts/launch-dist.mjs          # 以构建产物启动（推荐）
```

开发模式（Vite 热更新）：

```powershell
$env:ELECTRON_RUN_AS_NODE = ''        # 必须：否则 electron 会以 Node 身份启动并报 requestSingleInstanceLock
npm run dev
```

> 为什么不直接 `npm start`：未打包时主进程会把窗口指向 `http://localhost:5173`，没有 Vite 在跑就是白窗。`scripts/launch-dist.mjs` 会把 `dist/renderer` 起成静态服务再指过去，并自动兜底首启偶发的 about:blank。

重新打包：

```bash
npm run build && npx electron-builder --win --x64     # 输出到 release/
```

## 技术栈

| 技术 | 用途 |
|------|------|
| Electron 42 | 桌面应用框架 |
| React 19 + TypeScript | 渲染层 |
| Vite 8 + Tailwind CSS v4 | 构建与样式 |
| node:sqlite（`DatabaseSync`） | 本地数据库（schema 42） |
| Zustand | 状态管理 |
| electron-builder | 打包分发 |

## 项目结构

```text
grimoire/
├── src/
│   ├── main/           # 主进程：服务、IPC、数据库
│   ├── preload/        # 预加载脚本与 window.api 桥
│   ├── renderer/       # React 渲染层：组件、面板、状态、样式
│   ├── shared/         # 主进程与渲染层共享的合同与类型
│   ├── integrations/   # 与各来源项目对接的适配层
│   └── vendor/         # 迁移进来的源（只读，见 THIRD_PARTY_NOTICES.md）
├── data/               # 默认标签与提示词资产
├── docs/screenshots/   # README 与发版截图
├── resources/          # 图标、Python worker、Agent runtime
└── release/            # 打包输出
```

## 已知问题

1. **首次启动偶发白窗**：Chromium network service 崩溃会吞掉首次导航。程序会自动重载最多两次；若仍出现，按 `Ctrl+R`。
2. **AI 功能需要自备密钥**：所有供应商都在「设置 → API 配置」里自行填写，软件不内置任何 key。
3. **安装包未签名**：SmartScreen 会拦一次，选择「更多信息 → 仍要运行」即可。

这一版是 `0.7.3-alpha`，公开接口与部分面板仍在调整；反馈请走 [Issues](https://github.com/hanqingyan3293/Grimoire-Prompt-Combiner/issues)。

## 文档与许可

- 详细操作说明：[操作文档.md](./操作文档.md)
- 发布记录：[RELEASE_NOTES.md](./RELEASE_NOTES.md)

本项目采用 **GNU Affero General Public License v3.0（AGPL-3.0-only）**，完整许可证见 [LICENSE](./LICENSE)。迁移与适配的第三方源码及其许可证见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。

作者：[hanqingyan3293](https://github.com/hanqingyan3293)
