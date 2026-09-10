# 魔导书 Grimoire v7.2

> AI 提示词组合器 — 为 AI 绘画和 AI 对话打造的桌面工具箱

English: [README.en.md](./README.en.md)

![主工作区](./docs/screenshots/01-main-workspace.jpg)

## 项目简介

魔导书 Grimoire 是一款 Windows 桌面应用，专为 AI 创作者设计。它将 **4000+ 标签库管理**、**提示词可视化组合**、**多供应商 AI 聊天**、**AI 识图反推标签** 和 **自由多面板工作区** 深度整合，让提示词工程变得直观高效。

### 核心功能

- **📚 标签库管理** — 4000+ 中英对照标签，大类/子类/标签三层树形结构，搜索、筛选、随机抽取
- **🏷️ 标签组管理** — 支持多套独立标签数据库切换，导入/导出/重命名/复制，适应不同创作场景
- **⭐ 收藏系统** — 收藏子类和标签，独立收藏页快速访问常用标签
- **✏️ 提示词组合器** — 正面/负面提示词分栏，权重滑块，撤销/重做，一键复制导出
- **🧩 自由工作区** — 创作 / AI / 识图 / 图片参考 / 标签管理工作区，支持面板切换、分割、合并、布局预设
- **🤖 AI 助手窗口** — 独立窗口 AI 聊天，多模型切换，消息持久化，对话分组管理
- **🔍 AI 识图反推** — 上传图片 → AI 识别 → 自动推荐匹配标签，支持多选/拖拽上传
- **📊 简易 AI 面板** — 主界面右侧内嵌面板，聊天/识图双模式，与 AI 窗口实时同步
- **⚙️ 供应商配置** — 多 API 供应商管理，支持 Chat Completions / Responses API 协议，模型列表获取，连接测试
- **🎨 主题外观** — 7 套内置主题，自定义强调色、背景色、边框色、字体大小和界面密度
- **⌨️ 快捷键管理** — 发送/换行/搜索/撤销/重做/复制等全局快捷键，支持自定义

### 界面预览

| 创作工作区 | AI 工作区 |
|---|---|
| ![创作工作区](./docs/screenshots/01-main-workspace.jpg) | ![AI 工作区](./docs/screenshots/02-ai-workspace.jpg) |

| 识图工作区 | 外观设置 |
|---|---|
| ![识图工作区](./docs/screenshots/03-vision-workspace.jpg) | ![外观设置](./docs/screenshots/04-settings-appearance.jpg) |

原始截图保存在 [docs/screenshots/original](./docs/screenshots/original/)，可用于视频剪辑和二次宣传素材。

### 技术栈

| 技术 | 用途 |
|------|------|
| Electron | 桌面应用框架 |
| React 19 + TypeScript | UI 渲染 |
| Vite 8 + Tailwind CSS v4 | 构建与样式 |
| sql.js (WASM SQLite) | 本地数据库 |
| Zustand | 状态管理 |
| OpenAI SDK | AI 通信 |
| electron-builder | 打包分发 |

## 快速开始

### 环境要求

- Windows 10/11 (x64)
- Node.js 18+（仅源码运行或本地打包需要）

### 安装运行

**方式一：免安装单文件版（推荐）**

    1. 下载 [最新 Release](https://github.com/hanqingyan3293/Grimoire-Prompt-Combiner/releases/latest) 中的 `Grimoire 7.2.0.exe`
2. 放到任意目录后双击运行
3. 无需安装，适合移动硬盘、U 盘或多目录备份

**方式二：ZIP 便携版**

1. 下载 `Grimoire-portable-7.2.0.zip`
2. 解压到任意目录
3. 双击解压目录中的 `Grimoire.exe`

**方式三：安装包**

1. 下载 `Grimoire Setup 7.2.0.exe`
2. 双击安装，选择安装目录
3. 桌面快捷方式启动

**方式四：源码运行**

双击项目目录中的 `启动.bat`。脚本会自动检查依赖、必要时构建，然后启动应用。

也可以手动执行：

```bash
git clone https://github.com/hanqingyan3293/grimoire.git
cd grimoire
npm install
npm run build
npm start
```

如需生成可双击的免安装单文件版，双击 `打包便携版.bat`，输出文件在 `release/` 目录。

## 项目结构

```text
grimoire/
├── src/
│   ├── main/           # Electron 主进程
│   ├── preload/        # 预加载脚本
│   ├── renderer/       # React 渲染进程
│   └── shared/         # 共享类型定义
├── data/               # 默认标签数据
├── docs/               # 截图与文档素材
├── resources/          # 应用资源
└── release/            # 打包输出
```

## 使用文档

详细操作说明请参阅 [操作文档.md](./操作文档.md)

## v7.2 发布内容

- 无限画布项目自动保存与安全恢复，支持 revision 保护和保存队列。
- 无限画布提示词库与工具侧栏提示词资产支持来源、分类、子分类折叠和拖拽归类。
- 主应用与无限画布预览窗口统一支持拖动、缩放、滚动内容和底部操作区。
- 图片预览支持 0.1–10 倍缩放、鼠标中心缩放和左键拖动。
- 主题设置、画布 iframe、工具栏小设置统一同步。
- 设置页、资产卡片、弹窗和工作区间距与边界缓冲统一优化。

## 发布文件

每个 GitHub Release 提供 Windows x64 文件：

- Grimoire Setup 7.2.0.exe：NSIS 安装版。
- Grimoire 7.2.0.exe：单文件免安装版。
- Grimoire-portable-7.2.0.zip：ZIP 便携版。
- SHA256SUMS-v7.2.0.txt：文件完整性校验。

## 许可证

本项目采用 GNU Affero General Public License v3.0 或更高版本（AGPL-3.0-or-later）。完整许可证见 LICENSE。

作者：[hanqingyan3293](https://github.com/hanqingyan3293)

项目仓库：[Grimoire-Prompt-Combiner](https://github.com/hanqingyan3293/Grimoire-Prompt-Combiner)
