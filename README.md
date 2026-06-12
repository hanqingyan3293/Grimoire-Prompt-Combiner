# 📖 魔导书 Grimoire — AI提示词组合器

> **由 AI 生成 | AI-Generated Project**

魔导书是一款面向 AI 绘画创作者的提示词（Prompt）组合与管理工具。提供 **Flask Web 版**（浏览器运行）、**Electron 桌面版**（原生应用）和 **v6 AI 智能版**（集成 AI 识图与聊天）。

---

## 🌟 最新：v6 — AI 识图 + 聊天

**v6 是重大升级版本**，在标签化提示词管理基础上，集成了 **OpenAI 兼容的 AI 聊天与视觉识别**：

- 🤖 **AI 聊天** — 对话式 AI 助手，支持切换模型
- 👁 **AI 识图** — 上传图片自动分析生成标签
- 🔑 **自行配置 API Key** — 兼容 OpenAI / 中转 API
- 🏗 **技术栈升级** — Electron + React 18 + TypeScript + Tailwind CSS 4 + Zustand 5 + SQLite

---

## ✨ 功能 Features

- **标签化提示词管理** — 按镜头/人物/服饰/表情/动作/场景道具等分类
- **点击组合** — 点击标签即可组合完整 Prompt，一键复制英文/中文
- **基础质量词** — 一键添加 masterpiece, best quality 等前缀
- **双主题切换** 🌓 — 暗色/亮色一键切换
- **一键清洗** 🧹 — 自动去除重复标签
- **手气不错** 🎲 — 随机组合 Prompt，激发创作灵感
- **撤销/重做** — Ctrl+Z / Ctrl+Y 操作历史
- **键盘快捷键** — Ctrl+K 搜索，Ctrl+C 复制等
- **预设管理** — 保存/加载/导入常用提示词组合
- **标签 CRUD** — 自定义大类/子类/标签，支持编辑删除
- **AI 聊天** 🤖 — v6 新增，对话式 AI 助手
- **AI 识图** 👁 — v6 新增，图片分析生成标签

---

## 🆚 版本体系

### Flask Web 版（浏览器运行）
| | v3.1 经典版 | v4 Bento Grid | v4.1~v4.3 实验版 |
|---|---|---|---|
| **定位** | 稳定实用 | 新设计 | 开发版有Bug |
| **端口** | 5805 | 5810 | 5811~5813 |

### Electron 桌面版
| | v5~v5.5 早期版 | **v6 AI 智能版** 🆕 |
|---|---|---|
| **技术栈** | Electron + TS + Vite | Electron + React 18 + Tailwind CSS 4 |
| **状态管理** | 基础 | Zustand 5 |
| **数据存储** | JSON 文件 | SQLite (sql.js WASM) |
| **AI 聊天** | ❌ | ✅ |
| **AI 识图** | ❌ | ✅ |
| **API Key** | ❌ | ✅ 自行配置 |
| **主题** | 基础 | 7 套主题 |
| **国际化** | 标签双语 | 界面+标签全面中英双语 |

---

## 📦 项目结构

```
魔导书/
├── v3.1/               # ⭐ v3.1 经典稳定版
├── v4~v4.3/            # Flask Bento Grid 系列
├── v5~v5.5/            # Electron 早期桌面版
├── v6/                 # 🆕 AI 识图+聊天 最新版
├── 文档/               # 开发文档与发布记录
├── 打包归档/           # 历史发布包
└── README.md
```

---

## 🚀 快速开始

### v6 AI 智能版（推荐 🆕）
- 下载 `win-unpacked-v6.zip` 解压即用
- 或双击 `Grimoire Setup 6.0.0.exe` 安装
- 在设置中填入 OpenAI 兼容 API Key

### v3.1 Flask 经典版
```bash
cd v3.1 && pip install flask && python launch.py
# http://127.0.0.1:5805
```

---

## 📥 下载 Downloads

前往 [Releases](https://github.com/hanqingyan3293/Grimoire-Prompt-Combiner/releases)

| Release | 内容 |
|---|---|
| **v5.0.0** (最新) 🆕 | v6 AI 识图+聊天 — 源码 + 绿色便携包 |
| **v4.0.0** | v5~v5.5 Electron 系列 — 源码 + 安装包 |
| **v3.0.0** | v4~v4.3 Flask Bento Grid 系列 |
| **v2.0.0** | v3.1 + v4 经典版 |
| **v1.0.0** | v2 初版 + 桌面客户端 |

---

## 📄 许可证 License

MIT License — 详见 [LICENSE](LICENSE) 文件