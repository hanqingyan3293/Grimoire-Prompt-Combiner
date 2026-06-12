# 📖 魔导书 Grimoire — AI提示词组合器

> **由 AI 生成 | AI-Generated Project**

魔导书是一款面向 AI 绘画创作者的提示词（Prompt）组合与管理工具。提供 **Flask Web 版**（浏览器运行）和 **Electron 桌面版**（原生应用）两种形态。

---

## 🖼 运行截图 Screenshots

### v3.1 经典稳定版（推荐 🔥）
![v3.1运行截图](https://github.com/hanqingyan3293/Grimoire-Prompt-Combiner/releases/download/v2.0.0/v3.1运行.png)

### v4 Bento Grid 设计版
![v3.1运行截图](https://github.com/hanqingyan3293/Grimoire-Prompt-Combiner/releases/download/v1.0.0/v3.1.png)

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

---

## 🆚 版本体系

### Flask Web 版（浏览器运行）

| | v3.1 经典版 | v4 Bento Grid | v4.1~v4.3 实验版 |
|---|---|---|---|
| **定位** | 稳定实用 | 新设计+功能 | 开发版，有Bug |
| **布局** | 传统双栏 | Bento Grid + 毛玻璃 | 继承 v4 |
| **主题** | 暗/亮双主题 | 3 套主题 | 7套+自定义RGB |
| **端口** | 5805 | 5810 | 5811~5813 |

### Electron 桌面版（原生应用）

| | v5 初版 | v5.1 改进版 | v5.3 稳定版 | v5.2/v5.4/v5.5 |
|---|---|---|---|---|
| **定位** | Electron初版 | 改进+安装包 | 趋于稳定 | ❌ 严重Bug |
| **技术栈** | Electron+TS+Vite | Electron+TS+Vite | Electron+TS+Vite | Electron+TS+Vite |
| **安装包** | ❌ | ✅ Setup.exe | ✅ Setup.exe | ✅（但不可用） |
| **状态** | ⚠️ 小Bug | ⚠️ 小Bug | ⚠️ 小Bug | ❌ 不可用 |

---

## 📦 项目结构 Structure

```
魔导书/
├── v3.1/               # ⭐ v3.1 经典稳定版 — 推荐
├── v4/                 # ✅ v4 Bento Grid 设计版
├── v4.1~v4.3/          # ⚠️ 实验版（有Bug）
├── v5 ~ v5.5/          # 🖥 Electron 桌面版系列
├── v2/                 # v2 经典版（保留）
├── exe-v2/             # 桌面客户端（保留）
├── README.md
└── LICENSE             # MIT
```

---

## 🚀 快速开始 Quick Start

### Flask Web 版
```bash
# v3.1（推荐，端口 5805）
cd v3.1 && pip install flask && python launch.py

# v4（Bento Grid，端口 5810）
cd v4 && pip install flask && python launch.py
```
> Python 3.8+，仅需 Flask

### Electron 桌面版
```bash
# 开发模式
cd v5.3 && npm install && npm start

# 或直接下载安装包
# Grimoire Setup 5.3.0.exe 双击安装
```
> Node.js 18+（开发模式）/ Windows 10+（安装包）

---

## 🖥 技术栈 Tech Stack

| 系列 | 版本 | 后端 | 前端 | 运行方式 |
|---|---|---|---|---|
| Flask Web | v3.1~v4.3 | Python Flask | 原生 HTML/CSS/JS | 浏览器 |
| Electron 桌面 | v5~v5.5 | Electron | TypeScript + Vite | 原生窗口 |

---

## 📥 下载 Downloads

前往 [Releases 页面](https://github.com/hanqingyan3293/Grimoire-Prompt-Combiner/releases)

| Release | 内容 |
|---|---|
| **v4.0.0** (最新) | 🖥 v5~v5.5 Electron 系列源码 + 安装包 |
| **v3.0.0** | ✅ v4~v4.3 Flask Bento Grid 系列 |
| **v2.0.0** | ⭐ v3.1 + v4 经典版 + 截图 |
| **v1.0.0** (旧版) | v2 经典版 + exe 桌面客户端 |

---

## 📄 许可证 License

MIT License — 详见 [LICENSE](LICENSE) 文件