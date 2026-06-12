# 🎉 魔导书 Grimoire v3.0.0 — v4 全系列发布

> **由 AI 生成 | AI-Generated Project**

---

## ⚠️ 版本状态说明

| 版本 | 状态 | 说明 |
|------|------|------|
| **v4** | ✅ 稳定 | Bento Grid 设计版，功能完整可用 |
| v4.1 | ⚠️ 有 Bug | 快照+历史+收藏功能已实现但存在按钮无反应等问题 |
| v4.2 | ⚠️ 有 Bug | 7主题+快捷键+全屏预览已实现但多处功能异常 |
| v4.3 | ⚠️ 有 Bug | 从 v3.1 重建版本，部分功能验证未通过 |

> **推荐使用 v4 稳定版。** v4.1~v4.3 保留作为开发参考，不建议生产使用。

---

## 📦 v4 Bento Grid 设计版（✅ 稳定）

### 核心功能
- Bento Grid 三栏布局 + Glassmorphism 毛玻璃效果
- 3 层 CSS Token 设计系统（Primitive → Semantic → Component）
- 3 套主题配色（neon / clean / gold）
- 手气不错 🎲 — 随机标签组合
- 撤销/重做 — Ctrl+Z / Ctrl+Y
- 预设保存/加载/导入
- 大类/子类/标签 CRUD 管理
- 标签权重滑块 + 数值输入
- 右键 / Shift+点击 添加负面标签
- 智能推荐 + 导出 PNG 卡片
- 搜索去抖 + Toast 通知系统
- 端口：5810

### 设计特色
- 3 层 CSS Token：Primitive 颜色值 → Semantic 语义变量 → Component 组件变量
- Glassmorphism：半透明面板 + backdrop-filter 模糊
- 响应式设计：1200px / 900px 断点

---

## 📦 v4.1 实验版（⚠️ 有 Bug）

### 新增功能（部分不可用）
- PS 风格操作历史（50步可视化栈）
- 版本快照系统（保存/恢复/删除）
- 标签收藏（星标⭐）+ 自动分类
- 中英文双提示词面板
- 权重数值输入 + 格式化输出 `(tag:1.5)`
- 全选当前页 / 清空当前页
- 端口：5811

---

## 📦 v4.2 实验版（⚠️ 有 Bug）

### 新增功能（部分不可用）
- 7 套预设主题 + RGB 取色器
- 主题持久化（localStorage）
- 自定义快捷键录制弹窗
- 全屏预览弹窗（中英文分屏）
- 标签编辑弹窗（修改中英文名）
- 端口：5812

---

## 📦 v4.3 实验版（⚠️ 有 Bug）

### 设计思路
- 基于 v3.1 稳定骨架从零扩展
- 整合 v4.x 所有新功能
- 端口：5813
- ⚠️ 17项功能验证未全部通过

---

## 🚀 快速开始

```bash
# v4（推荐）
cd v4
pip install flask
python launch.py
# 浏览器打开 http://127.0.0.1:5810

# v4.1
cd v4.1
pip install flask
python launch.py
# 浏览器打开 http://127.0.0.1:5811

# v4.2
cd v4.2
pip install flask
python launch.py
# 浏览器打开 http://127.0.0.1:5812

# v4.3
cd v4.3
pip install flask
python launch.py
# 浏览器打开 http://127.0.0.1:5813
```

> **环境要求**：Python 3.8+，仅需 Flask (`pip install flask`)

---

## 📥 Assets 下载

| 文件 | 版本 | 状态 |
|------|------|------|
| `v4-release.zip` | v4 Bento Grid 版 | ✅ 稳定 |
| `v4.1-release.zip` | v4.1 实验版 | ⚠️ 有 Bug |
| `v4.2-release.zip` | v4.2 实验版 | ⚠️ 有 Bug |
| `v4.3-release.zip` | v4.3 实验版 | ⚠️ 有 Bug |

---

## 🔗 相关链接

- 仓库地址：https://github.com/hanqingyan3293/Grimoire-Prompt-Combiner
- v2.0.0（v3.1+v4 经典版）：https://github.com/hanqingyan3293/Grimoire-Prompt-Combiner/releases/tag/v2.0.0
- v1.0.0（v2+exe 初版）：https://github.com/hanqingyan3293/Grimoire-Prompt-Combiner/releases/tag/v1.0.0