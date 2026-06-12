# 🎉 魔导书 Grimoire v5.0.0 — v6 重大升级：AI 识图 + 聊天

> **由 AI 生成 | AI-Generated Project**
> **重大升级：集成 OpenAI 兼容 AI 聊天与视觉识别，从 Flask/原生JS 全面升级到 Electron + React + TypeScript**

---

## ✨ v6 全新功能

### 🤖 AI 聊天
- 兼容 OpenAI API 的对话式 AI 助手
- 支持切换模型、自定义 System Prompt
- 实时流式对话

### 👁 AI 识图（视觉识别）
- 拖拽/点击上传图片，AI 自动分析内容
- 生成标签可一键添加到提示词或保存到标签库
- 支持 PNG/JPEG 格式

### 🔑 自行配置 API Key
- 支持用户自行填写 OpenAI 兼容 API Key
- 可自定义 API Base URL（兼容中转 API）
- API Key 本地加密存储

---

## 🏗 技术架构升级

| | v4 系列 (Flask) | v5 系列 (Electron+TS) | **v6 (Electron+React)** |
|---|---|---|---|
| **前端** | 原生 HTML/CSS/JS | TypeScript + Vite | **React 18 + Tailwind CSS 4** |
| **状态管理** | 全局变量 | 基础状态 | **Zustand 5** |
| **数据存储** | JSON 文件 | JSON 文件 | **SQLite (sql.js WASM)** |
| **AI 能力** | ❌ | ❌ | **✅ 聊天 + 识图** |
| **主题** | 2-7 套 CSS | 基础主题 | **7 套主题 (Neon/Clean/Gold/Midnight/Sakura/Forest/Sunset)** |
| **国际化** | 标签双语 | 标签双语 | **界面 + 标签全面中英双语** |

---

## 📦 v6 核心功能一览

| 功能 | 状态 |
|------|------|
| 三级标签分类管理（类别→子类→标签） | ✅ |
| 搜索、收藏、频率统计 | ✅ |
| 拖拽添加、权重调节 | ✅ |
| 正向/负向双提示词面板 | ✅ |
| 撤销/重做（50步历史栈） | ✅ |
| 一键清洗去重 | ✅ |
| 随机打乱 | ✅ |
| **AI 聊天** | ✅ 🆕 |
| **AI 识图** | ✅ 🆕 |
| **API Key 自行配置** | ✅ 🆕 |
| 预设保存/加载/导入导出 | ✅ |
| 历史记录自动保存 | ✅ |
| 7 套主题切换 | ✅ |
| 中英双语界面 | ✅ |
| 数据导入导出（JSON） | ✅ |

---

## 🚀 快速开始

### 安装包运行（推荐）
1. 下载 `win-unpacked-v6.zip`（绿色便携版）
2. 解压到任意目录
3. 双击 `Grimoire.exe` 启动
4. 在设置中填入 API Key 即可使用 AI 功能

### 开发模式
```bash
cd v6
npm install
npm start
```
> Node.js 18+、npm

---

## ⚠️ 已知限制

- AI 识图依赖 API 对 vision 模型的支持
- 图片元数据解析仅支持 PNG/JPEG 的 SD 参数
- WD14 本地标签器功能预留但未实现

---

## 🖼 运行截图

![API Key 设置](https://github.com/hanqingyan3293/Grimoire-Prompt-Combiner/releases/download/v5.0.0/v6-APIkey设置图示.png)
![运行截图1](https://github.com/hanqingyan3293/Grimoire-Prompt-Combiner/releases/download/v5.0.0/v6运行图示1.png)
![运行截图2](https://github.com/hanqingyan3293/Grimoire-Prompt-Combiner/releases/download/v5.0.0/v6运行图示2.png)
![运行截图3](https://github.com/hanqingyan3293/Grimoire-Prompt-Combiner/releases/download/v5.0.0/v6运行图示3.png)

---

## 📥 Assets 下载

| 文件 | 大小 | 说明 |
|------|------|------|
| `v6-source.zip` | ~1.4MB | v6 源码（不含 node_modules） |
| `win-unpacked-v6.zip` | ~429MB | 🟢 绿色便携版，解压即用 |
| `v6-APIkey设置图示.png` | 截图 | API Key 配置界面 |
| `v6运行图示1~3.png` | 截图 | 运行界面展示 |

---

## 🔗 历史版本

- [v4.0.0 — v5 Electron 系列](https://github.com/hanqingyan3293/Grimoire-Prompt-Combiner/releases/tag/v4.0.0)
- [v3.0.0 — v4 Flask Bento Grid 系列](https://github.com/hanqingyan3293/Grimoire-Prompt-Combiner/releases/tag/v3.0.0)
- [v2.0.0 — v3.1 + v4 经典版](https://github.com/hanqingyan3293/Grimoire-Prompt-Combiner/releases/tag/v2.0.0)
- [v1.0.0 — v2 + exe 初版](https://github.com/hanqingyan3293/Grimoire-Prompt-Combiner/releases/tag/v1.0.0)