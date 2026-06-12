# 📖 魔导书 Grimoire — AI提示词组合器

> **由 AI 生成 | AI-Generated Project**

魔导书是一款面向 AI 绘画创作者的提示词（Prompt）组合与管理工具。提供 **轻量 Web 版**（Flask，87KB）和 **AI 桌面版**（Electron，集成识图+聊天）。

---

## 🌟 最新：v6 — AI 识图 + 聊天

**v6 是重大升级版本**，在标签化提示词管理基础上，集成了 **OpenAI 兼容的 AI 聊天与视觉识别**：

- 🤖 **AI 聊天** — 对话式 AI 助手，支持切换模型
- 👁 **AI 识图** — 上传图片自动分析生成标签
- 🔑 **自行配置 API Key** — 兼容 OpenAI / 中转 API
- 🏗 **技术栈** — Electron + React 18 + TypeScript + Tailwind CSS 4 + Zustand 5 + SQLite

---

## 🪶 v3.1 轻量 Web 版

极致轻量的 Flask Web 版，专为快速部署设计：

- 📦 **仅 87KB** — 压缩包极小，解压即用
- ⚡ **一行启动** — `pip install flask && python launch.py`
- 🌐 **浏览器运行** — http://127.0.0.1:5805
- 🔒 **完全离线** — 无需 API Key，本地标签库

---

## ✨ 功能 Features

- **标签化提示词管理** — 7 大类别，中英文对照
- **点击组合** — 点击标签即组合，一键复制
- **正/负面独立面板** — 分开管理，各自清空
- **权重滑块** — 精确调控每个标签的影响力
- **一键清洗** 🧹 — 自动去重
- **手气不错** 🎲 — 随机组合激发灵感
- **撤销/重做** — Ctrl+Z / Ctrl+Y
- **7 套主题** — 暗色/亮色/霓虹/樱花等
- **AI 聊天** 🤖 — v6 新增
- **AI 识图** 👁 — v6 新增

---

## 🆚 版本对比

| | 🪶 v3.1 轻量Web | 🖥 v6 AI桌面 |
|---|---|---|
| **大小** | 87KB | 429MB (便携包) |
| **启动** | `python launch.py` | 双击 exe |
| **依赖** | Python + Flask | 无需环境 |
| **AI 功能** | ❌ | ✅ 聊天+识图 |
| **适用** | 快速上手、服务器 | 完整桌面体验 |

---

## 📦 仓库代码结构

```
魔导书/
├── v3.1/          # ⭐ Flask 轻量 Web 版
├── v4/ ~ v4.3/    # Flask Bento Grid 系列
├── v5/            # Electron 早期版源码
├── v6/            # 🆕 Electron + React AI 版源码
├── exe-v2/        # 桌面客户端（旧版）
└── v2/            # Flask 经典版（旧版）
```

---

## 🚀 快速开始

### 🪶 v3.1 轻量 Web 版
```bash
pip install flask
cd v3.1 && python launch.py
# → http://127.0.0.1:5805
```

### 🖥 v6 AI 桌面版
- 下载 `win-unpacked-v6.zip` 解压即用
- 在设置中填入 API Key 开启 AI 功能

---

## 📥 下载 Downloads

前往 [Releases](https://github.com/hanqingyan3293/Grimoire-Prompt-Combiner/releases)

| Release | 内容 |
|---|---|
| **v3.1-web** 🪶 | v3.1 轻量 Web 版（87KB，快速部署） |
| **v5.0.0** 🆕 | v6 AI 识图+聊天 — 源码 + 便携包 |
| **v4.0.0** | v5~v5.5 Electron 系列 |
| **v3.0.0** | v4~v4.3 Bento Grid 系列 |
| **v2.0.0** | v3.1 + v4 经典版 |
| **v1.0.0** | v2 初版 + 桌面客户端 |

---

## 📄 许可证 License

MIT License — 详见 [LICENSE](LICENSE) 文件