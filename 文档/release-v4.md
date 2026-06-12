# 🎉 魔导书 Grimoire v4.0.0 — v5 全系列 Electron 版发布

> **由 AI 生成 | AI-Generated Project**
> **重大升级：从 Python Flask 迁移到 Electron + TypeScript 技术栈！**

---

## ⚠️ 版本状态说明

| 版本 | 状态 | 说明 |
|------|------|------|
| v5 | ⚠️ 小Bug | Electron 初版，基础功能可用，部分UI细节待优化 |
| v5.1 | ⚠️ 小Bug | 初版改进，有安装包，部分功能不稳定 |
| **v5.2** | ❌ 严重Bug | **不可用** — 功能异常，多处崩溃，仅作开发参考 |
| v5.3 | ⚠️ 小Bug | 趋于稳定，有安装包，部分交互待完善 |
| **v5.4** | ❌ 严重Bug | **不可用** — 严重功能缺陷，不推荐使用 |
| **v5.5** | ❌ 严重Bug | **不可用** — 多处功能失效，仅作开发参考 |

---

## 🆚 v5 系列 vs v4 系列

| | v3.1/v4 (Flask) | v5 系列 (Electron) |
|---|---|---|
| **技术栈** | Python Flask + 原生JS | Electron + TypeScript + Vite |
| **运行方式** | 终端 `python launch.py` | 双击 exe / `npm start` |
| **安装依赖** | `pip install flask` | `npm install` |
| **桌面体验** | 浏览器标签页 | 原生应用窗口 |
| **安装包** | ❌ | ✅ Setup.exe 安装程序 |
| **开发模式** | 直接改源码 | `npm run dev` 热重载 |

---

## 📦 v5 — Electron 初版（⚠️ 小Bug）

### 技术栈
- **框架**：Electron + TypeScript + Vite
- **UI**：原生 HTML/CSS/JS（继承 v4 设计）
- **打包**：electron-builder

### 已知问题（小Bug）
- UI 细节待打磨
- 部分交互响应延迟
- 无安装包

---

## 📦 v5.1 — 初版改进（⚠️ 小Bug）

### 改进点
- 完善桌面窗口管理
- 添加安装包（Setup.exe）
- 改进启动流程

### 已知问题（小Bug）
- 部分UI组件渲染异常
- 快捷键偶尔失效

### 🖥 安装包
- `Grimoire Setup 5.1.0.exe` — Windows 安装程序

---

## 📦 v5.2 — 实验版（❌ 严重Bug，不可用）

### ❌ 严重问题
- 多处功能异常/崩溃
- 标签系统不可靠
- 不建议任何使用场景

---

## 📦 v5.3 — 趋于稳定版（⚠️ 小Bug）

### 改进点
- 修复 v5.2 大部分崩溃问题
- 标签系统趋于稳定
- 安装包可用

### 已知问题（小Bug）
- 部分交互反馈待优化
- 主题切换偶有异常

### 🖥 安装包
- `Grimoire Setup 5.3.0.exe` — Windows 安装程序

---

## 📦 v5.4 — 实验版（❌ 严重Bug，不可用）

### ❌ 严重问题
- 严重功能缺陷
- 多处崩溃
- 不推荐使用

### 🖥 安装包
- `Grimoire Setup 5.4.0.exe` — Windows 安装程序

---

## 📦 v5.5 — 实验版（❌ 严重Bug，不可用）

### ❌ 严重问题
- 多处功能失效
- 仅作开发参考

### 🖥 安装包
- `Grimoire Setup 5.5.0.exe` — Windows 安装程序

---

## 🚀 快速开始

### 开发模式（源码运行）
```bash
cd v5  # 或 v5.1 / v5.3
npm install
npm start
# 或双击 start.bat
```

### 安装包运行
- 下载对应版本的 `Grimoire Setup X.X.X.exe`
- 双击安装
- 从桌面快捷方式启动

> **环境要求**：Node.js 18+（开发模式）、Windows 10+（安装包）

---

## 📥 Assets 下载

| 文件 | 版本 | 状态 |
|------|------|------|
| `v5-source.zip` | v5 初版源码 | ⚠️ 小Bug |
| `v5.1-source.zip` | v5.1 源码 | ⚠️ 小Bug |
| `v5.2-source.zip` | v5.2 源码 | ❌ 严重Bug |
| `v5.3-source.zip` | v5.3 源码 | ⚠️ 小Bug |
| `v5.4-source.zip` | v5.4 源码 | ❌ 严重Bug |
| `v5.5-source.zip` | v5.5 源码 | ❌ 严重Bug |

### 🖥 安装包（仅可用版本）

| 文件 | 版本 | 大小 |
|------|------|------|
| `Grimoire Setup 5.1.0.exe` | v5.1 | ~100MB |
| `Grimoire Setup 5.3.0.exe` | v5.3 | ~100MB |
| `Grimoire Setup 5.4.0.exe` | v5.4（有Bug） | ~100MB |
| `Grimoire Setup 5.5.0.exe` | v5.5（有Bug） | ~100MB |

---

## 🔗 历史版本

- [v3.0.0 — v4 全系列（Flask）](https://github.com/hanqingyan3293/Grimoire-Prompt-Combiner/releases/tag/v3.0.0)
- [v2.0.0 — v3.1 + v4 经典版](https://github.com/hanqingyan3293/Grimoire-Prompt-Combiner/releases/tag/v2.0.0)
- [v1.0.0 — v2 + exe 初版](https://github.com/hanqingyan3293/Grimoire-Prompt-Combiner/releases/tag/v1.0.0)