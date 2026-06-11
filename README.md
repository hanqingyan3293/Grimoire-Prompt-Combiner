# 📖 魔导书 Grimoire — AI提示词组合器

> **由 AI 生成 | AI-Generated Project**

魔导书是一款面向 AI 绘画创作者的提示词（Prompt）组合与管理工具。帮助用户通过分类标签快速组合高质量提示词，支持 Web 端浏览器运行。

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

## 🆚 版本对比

| | v3.1 经典稳定版 | v4 Bento Grid 版 |
|---|---|---|
| **定位** | 稳定实用，久经考验 | 新设计 + 更多功能 |
| **布局** | 传统双栏 | Bento Grid 三栏 + 毛玻璃 |
| **主题** | 暗色/亮色 双主题 | 3 套主题 (neon/clean/gold) |
| **标签权重** | ✅ 滑块 | ✅ 滑块 + 数值输入 |
| **手气不错** | ❌ | ✅ 随机标签组合 |
| **撤销/重做** | ❌ | ✅ Ctrl+Z / Ctrl+Y |
| **预设管理** | 基础 | ✅ 保存/加载/导入 |
| **智能推荐** | ❌ | ✅ 基于已选标签推荐 |
| **导出 PNG** | ❌ | ✅ Canvas 渲染下载 |
| **右键负面** | ❌ | ✅ 右键/Shift+点击 |
| **端口** | 5805 | 5810 |

---

## 📦 项目结构 Structure

```
魔导书/
├── v3.1/               # ⭐ v3.1 经典稳定版 — 推荐
├── v4/                 # 🆕 v4 Bento Grid 设计版
├── v2/                 # v2 经典版（保留）
├── exe-v2/             # 桌面客户端（保留）
├── README.md           # 本文件
└── LICENSE             # MIT开源协议
```

---

## 🚀 快速开始 Quick Start

### v3.1（推荐 🔥）— 端口 5805
```bash
cd v3.1
pip install flask
python launch.py
# 浏览器自动打开 http://127.0.0.1:5805
```

### v4（Bento Grid）— 端口 5810
```bash
cd v4
pip install flask
python launch.py
# 浏览器自动打开 http://127.0.0.1:5810
```

> **环境要求**：Python 3.8+，仅需 Flask 一个依赖

### exe-v2（桌面版，保留）— 单文件运行
- 下载 `MoDaoShu-Grimoire.exe`
- 双击运行，无需安装 Python

---

## 🖥 技术栈 Tech Stack

| 版本 | 后端 | 前端 | 设计 |
|---|---|---|---|
| v3.1 | Python Flask | 原生 HTML/CSS/JS | 传统双栏 + 双主题 |
| v4 | Python Flask | 原生 HTML/CSS/JS | Bento Grid + Glassmorphism + 3层CSS Token |

---

## 📥 下载 Downloads

前往 [Releases 页面](https://github.com/hanqingyan3293/Grimoire-Prompt-Combiner/releases) 下载最新版本。

| Release | 文件 | 说明 |
|---|---|---|
| **v2.0.0** (最新) | `v3.1-fresh.zip` | v3.1 经典稳定版源码 |
| | `v4-fresh.zip` | v4 Bento Grid 设计版源码 |
| | `v3.1运行.png` | 运行截图 |
| v1.0.0 (旧版) | `v2.zip` | v2 经典版源码 |
| | `MoDaoShu-Grimoire.exe` | 桌面客户端 |

---

## 📄 许可证 License

MIT License — 详见 [LICENSE](LICENSE) 文件