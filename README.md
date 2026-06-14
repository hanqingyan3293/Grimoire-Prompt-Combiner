# 魔导书 Grimoire v7

> AI 提示词组合器 — 为 AI 绘画和 AI 对话打造的桌面工具箱

English: [README.en.md](./README.en.md)

## 项目简介

魔导书 Grimoire 是一款 Windows 桌面应用，专为 AI 创作者设计。它将 **4000+ 标签库管理**、**提示词可视化组合**、**多供应商 AI 聊天** 和 **AI 识图反推标签** 深度整合，让提示词工程变得直观高效。

### 核心功能

- **📚 标签库管理** — 4000+ 中英对照标签，大类/子类/标签三层树形结构，搜索、筛选、随机抽取
- **🏷️ 标签组管理** — 支持多套独立标签数据库切换，导入/导出/重命名/复制，适应不同创作场景
- **⭐ 收藏系统** — 收藏子类和标签，独立收藏页快速访问常用标签
- **✏️ 提示词组合器** — 正面/负面提示词分栏，权重滑块，撤销/重做，一键复制导出
- **🤖 AI 助手窗口** — 独立窗口 AI 聊天，多模型切换，消息持久化，对话分组管理
- **🔍 AI 识图反推** — 上传图片 → AI 识别 → 自动推荐匹配标签，支持多选/拖拽上传
- **📊 简易 AI 面板** — 主界面右侧内嵌面板，聊天/识图双模式，与 AI 窗口实时同步
- **⚙️ 供应商配置** — 多 API 供应商管理，支持 Chat Completions / Responses API 协议，模型列表获取，连接测试
- **🎨 主题外观** — 7 套内置主题（霓虹/简洁/金色/暗夜/樱花/森林/日落），自定义强调色，字体/UI 缩放
- **⌨️ 快捷键管理** — 发送/换行/搜索/撤销/重做/复制等全局快捷键，支持自定义

### 技术栈

| 技术 | 用途 |
|------|------|
| Electron 34 | 桌面应用框架 |
| React 19 + TypeScript 5 | UI 渲染 |
| Vite 8 + Tailwind CSS v4 | 构建与样式 |
| sql.js (WASM SQLite) | 本地数据库 |
| Zustand | 状态管理 |
| OpenAI SDK | AI 通信 |
| electron-builder | 打包分发 |

## 快速开始

### 环境要求

- Windows 10/11 (x64)
- Node.js 18+

### 安装运行

**方式一：安装包（推荐）**

1. 下载 [最新 Release](https://github.com/hanqingyan3293/grimoire/releases/latest) 中的 `Grimoire-Setup-7.0.0.exe`
2. 双击安装，选择安装目录
3. 桌面快捷方式启动

**方式二：便携版**

1. 下载 `Grimoire-portable-7.0.0.zip`
2. 解压到任意目录
3. 运行 `Grimoire.exe`，所有数据和配置保存在当前文件夹

**方式三：源码运行**

```bash
git clone https://github.com/hanqingyan3293/grimoire.git
cd grimoire
npm install
npm run build
npm start
```

## 项目结构

```
grimoire/
├── src/
│   ├── main/           # Electron 主进程
│   │   ├── ai/         # AI 通信客户端
│   │   ├── ipc/        # IPC 处理器 (14个模块)
│   │   ├── services/   # 服务层
│   │   └── database.ts # sql.js 数据库
│   ├── preload/        # 预加载脚本
│   ├── renderer/       # React 渲染进程
│   │   ├── components/ # UI 组件 (60+)
│   │   ├── stores/     # Zustand 状态
│   │   ├── hooks/      # 自定义 Hooks
│   │   ├── i18n/       # 国际化
│   │   └── styles/     # 样式文件
│   └── shared/         # 共享类型定义
├── data/               # 默认标签数据
├── resources/          # 应用资源
└── release/            # 打包输出 (gitignore)
```

## 使用文档

详细操作说明请参阅 [操作文档.md](./操作文档.md)

## 许可证

GPL-3.0 License — [hanqingyan3293](https://github.com/hanqingyan3293)
