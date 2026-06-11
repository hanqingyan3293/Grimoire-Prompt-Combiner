# 📖 魔导书 Grimoire — AI提示词组合器

> **由 AI 生成 | AI-Generated Project**

魔导书是一款面向 AI 绘画创作者的提示词（Prompt）组合与管理工具。帮助用户通过分类标签快速组合高质量提示词，支持 Web 端和桌面客户端两种使用方式。

---

## 🖼 运行截图 Screenshots

### v3.1 升级版（推荐🔥）
![v3.1运行截图](https://github.com/hanqingyan3293/Grimoire-Prompt-Combiner/releases/download/v1.0.0/v3.1%E8%BF%90%E8%A1%8C.png)

### v2 经典版（浏览器运行）
![v2运行截图](https://github.com/hanqingyan3293/Grimoire-Prompt-Combiner/releases/download/v1.0.0/v2%E8%BF%90%E8%A1%8C.png)

---

## ✨ 功能 Features

- **标签化提示词管理** — 按镜头、风格、光照、色彩、构图等分类管理
- **快速组合器** — 点击标签即可组合完整 Prompt，一键复制
- **基础质量词** — 一键添加画质增强前缀词
- **随机手气** 🎲 — 随机组合 Prompt，激发创作灵感
- **双主题切换** 🌓 — 暗色/亮色一键切换（v3.1+）
- **一键清洗** 🧹 — 自动去除重复标签
- **自定义标签** — 支持添加/编辑/删除标签和分类
- **历史记录** — 自动保存使用历史
- **预设保存** — 保存常用提示词组合为预设
- **桌面版可用** — exe-v2 提供独立桌面客户端

---

## 📦 项目结构 Structure

```
魔导书/
├── v2/                 # Web版v2（经典版）- Flask + 浏览器
├── v3/                 # Web版v3（中间版）
├── v3.1/               # Web版v3.1（推荐）- 升级版
├── v4/                 # Web版v4（最新）- Bento Grid设计
├── exe-v2/             # 桌面客户端 - 单文件exe
├── README.md           # 本文件
└── LICENSE             # MIT开源协议
```

---

## 🚀 快速开始 Quick Start

### v3.1（推荐）— 浏览器运行
```bash
# 1. 解压 v3.1.zip
# 2. 安装依赖（需要Python 3.8+）
pip install flask
# 3. 运行
python launch.py
# 或双击 start.bat
# 4. 浏览器自动打开 http://127.0.0.1:5805
```

### v2（经典版）— 浏览器运行
```bash
# 同上，端口为 5801
cd v2
pip install flask
python launch.py
```

### exe-v2（桌面版）— 单文件运行
- 下载 `MoDaoShu-Grimoire.exe`
- 双击运行，无需安装Python
- 适合非技术用户

---

## 🖥 技术栈 Tech Stack

| 版本 | 后端 | 前端 | 特点 |
|---|---|---|---|
| v2 | Python + Flask | HTML + CSS + JS | 经典版 |
| v3.1 | Python + Flask | HTML + CSS + JS | 双主题+清洗+快捷操作 |
| v4 | Python + Flask | HTML + CSS + JS | Bento Grid + Glassmorphism |
| exe-v2 | PyWebView | HTML + CSS + JS | 桌面客户端，无需Python |

---

## 📥 下载 Downloads

前往 [Releases 页面](https://github.com/hanqingyan3293/Grimoire-Prompt-Combiner/releases) 下载最新版本。

| 文件 | 说明 |
|---|---|
| `v3.1.zip` | v3.1 升级版源码 |
| `v2.zip` | v2 经典版源码 |
| `MoDaoShu-Grimoire.exe` | 桌面客户端 |
| `v3.1运行.png` | v3.1 运行截图 |
| `v2运行.png` | v2 运行截图 |

---

## 📄 许可证 License

MIT License — 详见 [LICENSE](LICENSE) 文件
