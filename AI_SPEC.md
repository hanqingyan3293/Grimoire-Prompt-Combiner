# 魔导书 Grimoire v7 — AI 功能开发规范文档

> Codex Preflight Execution Engine v3.1 — 全阶段确认完毕
> 日期: 2026-06-14

---

## 一、需求总览

| 模块 | 说明 |
|------|------|
| AI 核心通信 | 聊天（流式 SSE）、识图、生图、模型列表获取 |
| AI 窗口 UI | 完全克隆 Chatbox 布局/交互——左侧对话列表 + 中间消息气泡 + 底部输入区 |
| 简易 AI | 右侧标签页，聊天 + 识图两 tab，与 AI 窗口共用 store 同步 |
| 识图反推 | 拖拽/多选 → AI 识别 → 标签列表 → 勾选添加/收藏/导入标签库 |
| 输入框扩展 | 上传文件/图片、联网搜索（占位）、对话设置、token 估算、自动压缩 |
| 快捷键 | 全局自定义，区分主页面/AI，支持空快捷键 |
| 设置页 | Provider 编辑器仿 Codex++，config/auth 可编辑，模型从上游获取可勾选 |
| 多 Provider 切换 | 输入框旁切换供应商，模型列表同步更新 |

---

## 二、架构

### 2.1 数据库表

`sql
-- 对话分组
CREATE TABLE chat_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

-- 对话
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  group_id TEXT DEFAULT '',
  provider_id TEXT NOT NULL,
  title TEXT DEFAULT '\u65b0\u5bf9\u8bdd',
  model TEXT NOT NULL,
  system_prompt TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);

-- 消息
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conv_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
  content TEXT NOT NULL,
  model TEXT DEFAULT '',
  token_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (conv_id) REFERENCES conversations(id) ON DELETE CASCADE
);
`

### 2.2 组件树

`
App.tsx
├── Sidebar                  ← 标签库 + 收藏（不动）
├── MainContent              ← 标签区域（不动）
├── RightPanel
│   ├── Presets / History / Images  ← 不动
│   └── SimpleAIPanel        ← 复用 chat.store
│       ├── ChatSubPanel
│       └── VisionSubPanel    ← 识图反推标签
├── AIWindow.tsx              ← 独立窗口
│   └── AIPanel.tsx
│       ├── ConversationList  ← 搜索/分组/新建
│       ├── MessageList       ← 气泡 + Markdown
│       └── InputArea
│           ├── ToolbarRow    ← 上传/搜索/设置按钮
│           └── SendBar       ← Provider/模型/token/压缩/发送
├── SettingsWindow.tsx
│   └── ProviderEditor.tsx
└── ShortcutSettings
`

### 2.3 数据流

`
chat.store (Zustand, 单例)
├── conversations[] / activeId / messages[]
├── sendMessage()    → IPC → 流式更新
├── visionRecognize() → IPC → 标签列表
├── createConv / deleteConv / editMessage / resend
└── 写操作 → Promise 队列串行化（防 sql.js 竞态）

IPC
├── ai:sendMessage   → 主进程调 OpenAI SDK stream
├── ai:chunk         → { seq, text, done } 逐帧回传
├── ai:vision        → 图片 base64 → vision API
├── ai:generateImage → 生图 API
├── ai:fetchModels   → GET /v1/models
`

### 2.4 同步机制

AIWindow 和 SimpleAIPanel 共用 chat.store：
- 同一活跃对话 ID、同一消息列表
- 新建对话/发消息 → 两边即时反射（Zustand 订阅）
- 识图结果共享

---

## 三、功能规格

### 3.1 AI 核心通信

| 功能 | 实现 |
|------|------|
| 流式聊天 | 主进程用 OpenAI SDK stream，IPC i:chunk 逐帧推送，带序号 {seq, text, done} |
| 识图 | base64 → messages[].content 含 image_url |
| 生图 | 返回 URL，ReactMarkdown 渲染 ![生成图](url) |
| 模型列表 | GET /v1/models，兼容 OpenAI 格式 |

### 3.2 Chatbox UI 克隆

| 区域 | 必须抄的 | 细节 |
|------|---------|------|
| 对话列表 | 搜索、分组下拉、新建/删除/重命名、右键菜单 | 260px 宽 |
| 消息气泡 | 用户/AI 左右对齐、Markdown 渲染、代码高亮、复制、编辑、重发 | react-markdown + remarkGfm |
| 输入框 | Enter 发送、Shift+Enter 换行、多行自适应（默认 2 行，最高 5 行，超出滚动） | Tailwind CSS |
| 工具栏 | 上传文件/图片、联网搜索（占位按钮+API接口预留）、对话设置 | 输入框上方横排小按钮 |
| 发送栏 | Provider 切换、模型选择（上拉+固定高度+滚动条）、token 估算、自动压缩开关、发送按钮 | gpt-tokenizer 估算 |

### 3.3 简易 AI

| 功能 | 说明 |
|------|------|
| 聊天 tab | 与 AI 窗口共用对话/消息，模型选择上拉菜单 |
| 识图 tab | 拖拽/多选/文件夹上传图片，AI 识别返回标签列表 |
| 同步 | 同 store，自动同步对话列表、消息、历史 |

### 3.4 识图反推标签

`
上传图片(拖拽/多选/文件夹)
  → base64 编码
  → vision API + prompt: "请识别图片内容，返回中英文标签列表，JSON格式"
  → 解析为 [{en, zh}] 列表
  → 展示勾选框列表
  → 用户操作:
      - 添加到正面提示词
      - 添加到负面提示词
      - 收藏标签
      - 导入到标签库(选大类子类)
      - 复制标签文本
      - 全选/取消全选
  → 历史记录保存
`

### 3.5 自动压缩上下文

- 阈值：模型上下文大小 × 75%
- 超限：裁剪最早消息，保留最近 3 轮 + 系统提示词
- 开关：输入框旁 toggle 按钮

### 3.6 快捷键

| 分组 | 操作 | 默认键 |
|------|------|--------|
| AI | 发送消息 | Enter |
| AI | 换行 | Shift+Enter |
| AI | 新建对话 | Ctrl+N |
| 通用 | 撤销/重做 | Ctrl+Z/Y |
| 通用 | 搜索 | Ctrl+F |
| 通用 | 复制 | Ctrl+C |

- 支持自定义修改
- 支持设为空（不绑定）

### 3.7 Provider 编辑器

| 字段 | 说明 |
|------|------|
| 名称 | 供应商显示名 |
| 接入模式 | 官方登录 / 纯 API |
| 上游协议 | Chat Completions / Responses API |
| 默认模型 | 默认配置模型 |
| 测试模型 | 测试连接用 |
| 上下文大小 | 留空使用默认 |
| Base URL | API 地址 |
| API Key | 加密存储 |
| 模型列表 | "从上游获取"按钮 → 获取可用模型 → 用户勾选 → 保存 |
| config.toml | 可编辑预览 |
| auth.json | 可编辑预览 |

---

## 四、技术选型

| 需求 | 选型 | 理由 |
|------|------|------|
| AI SDK | openai npm 包 | 兼容 OpenAI / 兼容 API |
| Token 估算 | gpt-tokenizer | 轻量纯 JS，零依赖 |
| Markdown | eact-markdown + emark-gfm | 已在项目中使用 |
| 虚拟滚动 | eact-virtuoso (可选) | 对话超 100 条后优化 |
| 代码高亮 | eact-syntax-highlighter (可选) | 代码块着色 |

---

## 五、安全

| 项目 | 措施 |
|------|------|
| API Key | Electron safeStorage 加密 + base64 存 SQLite |
| Key 显示 | 编辑窗口打开时解密，关闭即丢弃 |
| Markdown | 不用 rehype-raw（防止 XSS） |
| IPC | preload 白名单模式 |

---

## 六、测试策略

| 层级 | AI 自测 | 你手动测 |
|------|---------|---------|
| 构建 | 
pm run build，0 错误 | — |
| Store 逻辑 | 单元测试调 store 方法 | — |
| IPC 通信 | Node 脚本直接调 IPC handler | — |
| UI 布局/交互 | — | 点按钮、看布局 |
| API 聊天/识图/生图 | — | 配 Key 实测 |

---

## 七、开发阶段

| 阶段 | 内容 | 预估 |
|------|------|------|
| 1 | AI 核心通信（chat/vision/image/models IPC） | 先通后优 |
| 2 | Chatbox UI 克隆（骨架→气泡→对话管理→输入框） | 3 子阶段 |
| 3 | 简易 AI + 同步 | 复用 store |
| 4 | 设置页 ProviderEditor + 快捷键 | 独立模块 |
| 5 | 全功能回归 + 修复 | 每次构建验证 |

## 八、参考

- Chatbox: https://github.com/Bin-Huang/chatbox
- OpenAI SDK: https://github.com/openai/openai-node