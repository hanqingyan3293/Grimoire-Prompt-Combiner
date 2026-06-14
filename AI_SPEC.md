# 魔导书 Grimoire v7 — AI 功能完整开发规范

> Codex Preflight Execution Engine v3.1 — 全阶段确认完毕
> 日期: 2026-06-14
> 用途: 发给任意 AI，无需上下文即可接手开发

---

## 零、项目概览

- **项目路径**: D:\File\Data\魔导书\grimoire
- **技术栈**: Electron 34 + React 18 + TypeScript 5 + Vite 8 + Tailwind CSS v4 + sql.js (WASM SQLite) + Zustand
- **构建命令**: 
pm run build (先 renderer 后 main)
- **启动命令**: 
pm start 或 
px electron .
- **进程结构**: 主进程 src/main/ (Electron main + IPC handlers + sql.js DB)，渲染进程 src/renderer/ (React + Zustand stores)，预加载 src/preload/index.ts
- **共享类型**: src/shared/types.ts (IPC_CHANNELS 枚举 + TypeScript 接口)
- **Git 仓库**: 已备份，当前 commit dcfd80c

### 现有代码结构速查

`
src/
├── main/
│   ├── index.ts              ← Electron 入口，注册窗口和 IPC
│   ├── database.ts           ← sql.js 初始化/保存/迁移
│   └── ipc/
│       ├── tags.ipc.ts       ← 标签 CRUD (修复过 group_id 问题)
│       ├── tagGroups.ipc.ts  ← 标签组管理 (导出 getActiveGroupId)
│       ├── providers.ipc.ts  ← API 供应商 CRUD + 加密
│       ├── settings.ipc.ts   ← 设置读写
│       ├── favorites.ipc.ts  ← 收藏
│       ├── history.ipc.ts    ← 历史
│       ├── images.ipc.ts     ← 图片管理
│       └── presets.ipc.ts    ← 预设
├── preload/
│   └── index.ts              ← contextBridge 暴露 window.api.*
├── renderer/
│   ├── index.html            ← Vite 入口
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx   ← 左侧标签库/收藏/组管理
│   │   │   ├── MainContent.tsx ← 中间标签展示区
│   │   │   ├── RightPanel.tsx  ← 右侧预设/历史/图片/简易AI
│   │   │   ├── FavoritesPanel.tsx ← 收藏面板 (修复过)
│   │   │   └── StatusBar.tsx
│   │   ├── ai/
│   │   │   ├── AIPanel.tsx    ← AI 助手面板 (聊天+识图)
│   │   │   ├── AIWindow.tsx   ← AI 独立窗口
│   │   │   └── SimpleAIPanel.tsx ← 简易 AI 面板
│   │   ├── settings/
│   │   │   ├── SettingsPanel.tsx
│   │   │   ├── SettingsWindow.tsx
│   │   │   └── ProviderEditor.tsx ← API 供应商编辑器
│   │   ├── tags/TagCards.tsx  ← 标签卡片 (含 addTag)
│   │   └── ui/Modal.tsx
│   ├── stores/
│   │   ├── tags.store.ts
│   │   ├── prompts.store.ts
│   │   ├── providers.store.ts
│   │   ├── settings.store.ts
│   │   ├── favorites.store.ts
│   │   ├── ai.store.ts
│   │   └── chat.store.ts      ← 聊天 store (需要重写)
│   └── global.d.ts           ← window.api 类型定义
└── shared/
    └── types.ts               ← IPC_CHANNELS + Provider 等类型
`

### 现有数据表 (sql.js)

`sql
-- 已有的表
tag_groups(id, name, is_active, created_at)
categories(id, group_id, en, zh, sort_order, created_at)
subcategories(id, group_id, category_id, en, zh, sort_order, created_at)
tags(id, group_id, subcategory_id, en, zh, sort_order, source, created_at)
favorites(id, tag_id, created_at)
sub_favorites(id, subcategory_id, created_at)
providers(id, name, access_mode, protocol, base_url, api_key_encrypted,
          default_model, test_model, context_size, models_json,
          is_active, config_toml, auth_json, created_at, updated_at)
settings(key TEXT PRIMARY KEY, value TEXT)
`

---

## 一、开发阶段总览

| 阶段 | 内容 | 依赖 | 验证 |
|------|------|------|------|
| 1 | AI 核心通信 IPC (chat/vision/image/models) | 无 | 
pm run build + 手动发消息测试 |
| 2 | chat.store 重写 + 数据库迁移 | 阶段 1 | store 单元测试 |
| 3 | Chatbox UI 克隆 (AIPanel/AIWindow 重写) | 阶段 2 | 手动 UI 测试 |
| 4 | SimpleAIPanel 改造 + 同步 | 阶段 3 | 两边同时打开验证 |
| 5 | ProviderEditor 升级 + 快捷键 | 阶段 2 | 手动测试 |

---

## 二、阶段 1: AI 核心通信 IPC

### 2.1 需要新增的文件

| 文件 | 作用 |
|------|------|
| src/main/ipc/ai.ipc.ts | 聊天/识图/生图/模型列表 的 IPC handler |
| src/main/ai/client.ts | 封装 OpenAI SDK 调用逻辑 |

### 2.2 安装依赖

`ash
npm install openai gpt-tokenizer
`

### 2.3 src/main/ai/client.ts — API 调用封装

`	ypescript
// 职责: 封装 openai SDK，提供 chatStream / vision / generateImage / fetchModels
// 不直接接触 IPC，纯函数

import OpenAI from 'openai'
import type { Provider } from '../../shared/types'

// 根据 Provider 配置创建客户端
export function createClient(provider: Provider): OpenAI {
  return new OpenAI({
    baseURL: provider.base_url || 'https://api.openai.com/v1',
    apiKey: provider.api_key,
    dangerouslyAllowBrowser: false,
  })
}

// 流式聊天 — 返回 AsyncIterable
export async function* chatStream(
  client: OpenAI,
  model: string,
  messages: Array<{ role: string; content: string | any[] }>,
) {
  const stream = await client.chat.completions.create({
    model,
    messages: messages as any,
    stream: true,
  })
  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content
    if (delta) yield delta
  }
}

// 识图 — 返回标签 JSON 字符串
export async function vision(
  client: OpenAI,
  model: string,
  imageBase64: string,
  prompt?: string,
): Promise<string> {
  const response = await client.chat.completions.create({
    model,
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: data:image/png;base64, } },
        { type: 'text', text: prompt || '请识别此图片内容，以JSON数组格式返回中英文标签。格式: [{"en":"tag","zh":"标签"}]。只返回JSON，不要其他文字。' },
      ],
    }],
  })
  return response.choices[0]?.message?.content || '[]'
}

// 生图
export async function generateImage(
  client: OpenAI,
  model: string,
  prompt: string,
): Promise<string> {
  const response = await client.images.generate({
    model,
    prompt,
    n: 1,
    size: '1024x1024',
  })
  return response.data[0]?.url || ''
}

// 从上游获取模型列表
export async function fetchModels(client: OpenAI): Promise<string[]> {
  const response = await client.models.list()
  return response.data
    .map(m => m.id)
    .filter(id => !id.includes('audio') && !id.includes('tts') && !id.includes('whisper'))
    .sort()
}
`

### 2.4 src/main/ipc/ai.ipc.ts — IPC 处理器

`	ypescript
// 职责: 注册 IPC handlers，处理渲染进程的 AI 请求
// 流式消息: 主进程调 SDK stream，逐 chunk 通过 webContents.send 推回渲染进程
// 每个 chunk 带序号 { seq: number, text: string, done: boolean }
// 如果 done=true，text 为完整内容

import { ipcMain, BrowserWindow } from 'electron'
import { createClient, chatStream, vision, generateImage, fetchModels } from '../ai/client'
import { getDatabase, saveDatabase } from '../database'
import { decryptKey } from './providers.ipc'  // 需要从 providers.ipc 导出 decryptKey
import crypto from 'crypto'

const genId = () => crypto.randomUUID()

// 从 DB 读取 Provider 配置
function getProvider(providerId: string) {
  const db = getDatabase()
  const r = db.exec('SELECT * FROM providers WHERE id=?', [providerId])
  if (!r[0]?.values?.[0]) return null
  const row = r[0].values[0]
  return {
    id: row[0], name: row[1], access_mode: row[2],
    protocol: row[3], base_url: row[4], api_key: decryptKey(row[5] || ''),
    default_model: row[6], test_model: row[7],
    context_size: row[8] ? Number(row[8]) : null,
    models: JSON.parse(row[9] || '[]'),
    is_active: row[10] === 1,
    config_toml: row[11], auth_json: row[12],
  }
}

export function registerAIIPC(): void {
  // 流式聊天
  ipcMain.handle('ai:sendMessage', async (event, args: {
    providerId: string
    model: string
    messages: Array<{ role: string; content: string | any[] }>
  }) => {
    const provider = getProvider(args.providerId)
    if (!provider) return { error: '供应商不存在' }

    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return { error: '窗口已关闭' }

    const client = createClient(provider)
    let seq = 0
    let fullText = ''

    try {
      for await (const chunk of chatStream(client, args.model, args.messages)) {
        fullText += chunk
        win.webContents.send('ai:chunk', { seq: seq++, text: chunk, done: false })
      }
      win.webContents.send('ai:chunk', { seq, text: '', done: true, fullText })
      return { success: true, text: fullText }
    } catch (e: any) {
      const errMsg = e?.message || String(e)
      win.webContents.send('ai:chunk', { seq, text: '', done: true, error: errMsg })
      return { error: errMsg }
    }
  })

  // 识图
  ipcMain.handle('ai:vision', async (_e, args: {
    providerId: string; model: string; imageBase64: string; prompt?: string
  }) => {
    const provider = getProvider(args.providerId)
    if (!provider) return { error: '供应商不存在' }
    try {
      const client = createClient(provider)
      const result = await vision(client, args.model, args.imageBase64, args.prompt)
      return { success: true, text: result }
    } catch (e: any) {
      return { error: e?.message || String(e) }
    }
  })

  // 生图
  ipcMain.handle('ai:generateImage', async (_e, args: {
    providerId: string; model: string; prompt: string
  }) => {
    const provider = getProvider(args.providerId)
    if (!provider) return { error: '供应商不存在' }
    try {
      const client = createClient(provider)
      const url = await generateImage(client, args.model, args.prompt)
      return { success: true, url }
    } catch (e: any) {
      return { error: e?.message || String(e) }
    }
  })

  // 获取模型列表
  ipcMain.handle('ai:fetchModels', async (_e, args: {
    baseUrl: string; apiKey: string
  }) => {
    try {
      const client = createClient({ base_url: args.baseUrl, api_key: args.apiKey } as any)
      const models = await fetchModels(client)
      return { success: true, models }
    } catch (e: any) {
      return { error: e?.message || String(e) }
    }
  })
}
`

### 2.5 需要修改的现有文件

**src/main/ipc/providers.ipc.ts** — 导出 decryptKey:

`
确认 decryptKey 函数前有 export 关键字
如果现在是私有的，改为: export function decryptKey(...)
`

**src/main/index.ts** — 注册新的 AI IPC:

`
在现有 IPC 注册代码后添加:
import { registerAIIPC } from './ipc/ai.ipc'
registerAIIPC()
`

**src/preload/index.ts** — 暴露 AI API 给渲染进程:

`
在 api 对象中添加:
ai: {
  sendMessage: (args) => ipcRenderer.invoke('ai:sendMessage', args),
  vision: (args) => ipcRenderer.invoke('ai:vision', args),
  generateImage: (args) => ipcRenderer.invoke('ai:generateImage', args),
  fetchModels: (args) => ipcRenderer.invoke('ai:fetchModels', args),
  onChunk: (callback) => {
    const handler = (_e, data) => callback(data)
    ipcRenderer.on('ai:chunk', handler)
    return () => ipcRenderer.removeListener('ai:chunk', handler)
  },
},
`

**src/renderer/global.d.ts** — 补充类型:

`	ypescript
ai: {
  sendMessage: (args: { providerId: string; model: string; messages: Array<{ role: string; content: any }> }) => Promise<{ success?: boolean; text?: string; error?: string }>
  vision: (args: { providerId: string; model: string; imageBase64: string; prompt?: string }) => Promise<{ success?: boolean; text?: string; error?: string }>
  generateImage: (args: { providerId: string; model: string; prompt: string }) => Promise<{ success?: boolean; url?: string; error?: string }>
  fetchModels: (args: { baseUrl: string; apiKey: string }) => Promise<{ success?: boolean; models?: string[]; error?: string }>
  onChunk: (callback: (data: { seq: number; text: string; done: boolean; fullText?: string; error?: string }) => void) => () => void
}
`

### 2.6 流式传输详细说明

`
流程:
1. 渲染进程: chat.store.sendMessage() → ipcRenderer.invoke('ai:sendMessage', {...})
2. 主进程: 收到后创建 OpenAI client，调 chatStream()
3. 主进程: 每收到一个 chunk → win.webContents.send('ai:chunk', {seq, text, done:false})
4. 渲染进程: onChunk 回调逐帧更新 store 中的消息内容
5. 主进程: 流结束 → send('ai:chunk', {seq, text:'', done:true, fullText})
6. 渲染进程: 收到 done=true → 保存完整消息到数据库

错误处理:
- 主进程 catch 到错误 → send('ai:chunk', {seq, text:'', done:true, error:'...'})
- 渲染进程收到 error → 在消息气泡显示红色错误提示
- 如果窗口已关闭 → invoke 返回 {error:'窗口已关闭'}
`

### 2.7 阶段 1 验证

`ash
# 构建
npm run build
# 应输出 ✓ built 无错误

# 手动测试:
# 1. 配置一个有效的 API Provider (在设置里)
# 2. 打开 AI 窗口，发 "你好"
# 3. 应看到逐字回显的回复
`

---

## 三、阶段 2: chat.store 重写 + 数据库

### 3.1 数据库迁移

在 src/main/database.ts 的 SCHEMA_SQL 常量中**追加**（不删旧的）:

`sql
CREATE TABLE IF NOT EXISTS chat_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  group_id TEXT DEFAULT '',
  provider_id TEXT NOT NULL,
  title TEXT DEFAULT '新对话',
  model TEXT NOT NULL DEFAULT '',
  system_prompt TEXT DEFAULT '',
  pinned INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conv_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
  content TEXT NOT NULL,
  model TEXT DEFAULT '',
  token_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

-- 默认分组
INSERT OR IGNORE INTO chat_groups (id, name, sort_order) VALUES ('default', '默认', 0);
`

### 3.2 新增 IPC: src/main/ipc/chat.ipc.ts

处理对话和消息的 CRUD:

`	ypescript
// 需要注册的 IPC handlers:
// chat:listConversations  → SELECT * FROM conversations ORDER BY updated_at DESC
// chat:createConversation → INSERT INTO conversations ...
// chat:deleteConversation → DELETE FROM conversations WHERE id=?
// chat:updateConversation → UPDATE conversations SET title=?/group_id=?/system_prompt=? WHERE id=?
// chat:getMessages        → SELECT * FROM messages WHERE conv_id=? ORDER BY created_at ASC
// chat:saveMessage        → INSERT INTO messages ...
// chat:deleteMessages     → DELETE FROM messages WHERE id IN (...)
// chat:listGroups         → SELECT * FROM chat_groups ORDER BY sort_order
// chat:createGroup        → INSERT INTO chat_groups ...
// chat:deleteGroup        → DELETE FROM chat_groups WHERE id=?
// chat:renameGroup        → UPDATE chat_groups SET name=? WHERE id=?
`

### 3.3 src/renderer/stores/chat.store.ts — 完全重写

这是最核心的 store，AIWindow 和 SimpleAIPanel 都依赖它:

`	ypescript
// chat.store.ts — 单例 Zustand store

interface ChatState {
  // 数据
  conversations: Conversation[]
  activeConversationId: string | null
  messages: Message[]           // 自动过滤 = activeConversation 的消息
  groups: ChatGroup[]
  streamingMessageId: string | null  // 正在流式接收的消息 ID

  // 写操作队列 (保证 sql.js 串行写入)
  _writeQueue: Promise<void>

  // Actions
  loadConversations: () => Promise<void>
  createConversation: (providerId: string, model: string) => Promise<string>
  deleteConversation: (id: string) => Promise<void>
  setActiveConversation: (id: string) => Promise<void>
  updateConversation: (id: string, data: Partial<Conversation>) => Promise<void>

  loadMessages: (convId: string) => Promise<void>
  sendMessage: (content: string, providerId: string, model: string) => Promise<void>
  resendMessage: (messageId: string) => Promise<void>
  editAndResend: (messageId: string, newContent: string) => Promise<void>

  loadGroups: () => Promise<void>
  createGroup: (name: string) => Promise<void>
  deleteGroup: (id: string) => Promise<void>
  renameGroup: (id: string, name: string) => Promise<void>
  moveConversation: (convId: string, groupId: string) => Promise<void>
}

// 实现要点:
// 1. _writeQueue: 所有写操作通过 queueWrite(fn) 排队:
//    const queueWrite = (fn) => { set(s => { s._writeQueue = s._writeQueue.then(fn).catch(()=>{}); return s }) }
// 2. sendMessage 流程:
//    a. 保存 user 消息到 DB 和本地 state
//    b. 创建空的 assistant 消息 (streamingMessageId)
//    c. 调 window.api.ai.sendMessage(...)
//    d. 注册 onChunk 回调，逐帧更新 assistant 消息的 content
//    e. done 时保存 assistant 消息到 DB，清 streamingMessageId
// 3. loadMessages: 只在 activeConversationId 变化时触发
`

### 3.4 阶段 2 验证

`ash
npm run build  # 0 错误

# 写一个简单的 Node 测试脚本调 IPC handlers，验证 CRUD
`

---

## 四、阶段 3: Chatbox UI 克隆

### 4.1 Chatbox 布局精确尺寸

`
┌────────────────────────────────────────────────────┐
│ AI 窗口标题栏                              [─][□][×] │
├──────────┬─────────────────────────────────────────┤
│ 对话列表  │  消息区域                               │
│ (280px)  │                                         │
│          │  ┌──────────────────────────────┐       │
│ 🔍搜索   │  │ AI 头像  这是 AI 的回复       │       │
│          │  │          Markdown 渲染        │       │
│ 分组选择  │  └──────────────────────────────┘       │
│ ▸ 今天   │                                         │
│   - 对话1│  ┌──────────────────────────────┐       │
│   - 对话2│  │          用户消息   👤头像    │       │
│ ▸ 昨天   │  └──────────────────────────────┘       │
│          ├─────────────────────────────────────────┤
│ + 新对话  │  [📎] [🌐] [⚙]              ← 工具栏   │
│          │  ┌──────────────────────────────┐       │
│ ⚙ 设置   │  │ 输入框 (多行)                │       │
│          │  └──────────────────────────────┘       │
│          │  [Provider▼] [Model▼] [📊token] [压缩] [发送] │
└──────────┴─────────────────────────────────────────┘
`

### 4.2 需要新建/重写的文件

| 文件 | 内容 |
|------|------|
| src/renderer/components/ai/ChatLayout.tsx | AI 窗口整体布局 (对话列表+消息区+输入框) |
| src/renderer/components/ai/ConversationList.tsx | 左侧对话列表: 搜索框、分组下拉、对话项、新建/设置按钮 |
| src/renderer/components/ai/ConversationItem.tsx | 单个对话项: 标题、时间、右键菜单(重命名/删除/移动分组) |
| src/renderer/components/ai/MessageList.tsx | 消息区域: 气泡列表、自动滚底、流式消息实时更新 |
| src/renderer/components/ai/MessageBubble.tsx | 单个气泡: 用户/AI 左右对齐、Markdown 渲染、右键菜单(复制/编辑/重发/删除) |
| src/renderer/components/ai/InputArea.tsx | 输入区域: 工具栏+输入框+发送栏 |
| src/renderer/components/ai/ToolbarRow.tsx | 工具栏按钮: 上传文件、联网搜索(占位)、对话设置 |
| src/renderer/components/ai/SendBar.tsx | 发送栏: Provider 切换、模型选择、token 估算、压缩开关、发送按钮 |
| src/renderer/components/ai/ModelPicker.tsx | 模型选择器: 上拉菜单、固定高度(最多显示6个)、超出滚动条 |
| src/renderer/components/ai/ConvSettingsModal.tsx | 对话设置弹窗: 系统提示词、温度参数、导出 |

### 4.3 UI 实现细节

**对话列表 (ConversationList)**:
`
- 顶部: 搜索框 (小放大镜图标, 输入即过滤)
- 分组下拉: "按时间分组" / "按自定义分组" 
- 按时间分组: 今天/昨天/本周/本月/更早 (自动归类)
- 按自定义分组: 显示 chat_groups 列表, 可拖拽对话到分组
- 对话项: 显示标题(截断)、最后消息时间、右键菜单
- 底部左边: "+ 新对话" 按钮
- 底部右边: "⚙ 设置" 按钮 → 打开对话设置或 AI 设置
`

**消息气泡 (MessageBubble)**:
`
- 用户消息: 右对齐, 淡蓝/灰背景, 圆角(8px), 右侧头像
- AI 消息: 左对齐, 深色背景, 圆角(8px), 左侧 AI 图标
- Markdown 渲染: react-markdown + remark-gfm
  - 代码块: 深色背景, 等宽字体, 复制按钮(右上角)
  - 表格: 斑马纹
  - 图片: ![](url) 直接显示
- 右键菜单: 复制文本 / 编辑(仅自己的消息) / 重新生成(仅 AI 消息) / 删除
- 编辑模式: 消息变为输入框, Enter 保存重发, Escape 取消
- 流式消息: streamingMessageId === id 时, content 实时更新, 显示闪烁光标 ▍
`

**输入框 (InputArea)**:
`
- 工具栏: 横排小按钮, 左对齐, 间距 4px
  - 📎 上传文件 (接受图片, 转 base64 插入消息)
  - 🌐 联网搜索 (灰色占位, 点击提示"功能开发中", 保留 API 接口)
  - ⚙ 对话设置 (打开 ConvSettingsModal)
- 输入框: textarea, 默认 2 行高, 最高 5 行, 超出滚动
  - Enter 发送, Shift+Enter 换行
  - 粘贴图片自动转 base64
- 发送栏: 同一行
  - Provider 下拉 (显示当前供应商名, 切换后模型列表更新)
  - Model 选择器 (上拉菜单, 固定高度 max-h-48, 超出滚动条)
  - Token 计数器 (📊 1234/8192, 鼠标悬停显示详细: "系统提示词: 50, 消息: 1184")
  - 自动压缩开关 (toggle 按钮, 鼠标悬停提示 "超过75%上下文时自动裁剪早期消息")
  - 发送按钮 (➤, accent 色)
`

**模型选择器 (ModelPicker)**:
`
- 触发: 点击当前模型名
- 弹出方向: 自动识别 (空间够→向下, 不够→向上)
- 列表: 固定高度 max-h-48, overflow-y-auto (滚动条)
- 每项: 模型名, 悬停高亮, 当前选中项 accent 色
- 点击外部关闭
- 切换后立即生效 (下一次发消息用新模型)
`

### 4.4 需要修改的现有文件

**src/renderer/components/ai/AIPanel.tsx** — 完全重写为使用 ChatLayout
**src/renderer/components/ai/AIWindow.tsx** — 改为独立 BrowserWindow, 加载 ChatLayout

`
ChatLayout 结构:
<div className="flex h-full">
  <ConversationList />   ← w-[280px] border-r
  <div className="flex-1 flex flex-col">
    <MessageList />       ← flex-1 overflow-y-auto
    <InputArea />         ← border-t p-3
  </div>
</div>
`

### 4.5 阶段 3 验证

`ash
npm run build  # 确认无错误

# 手动测试清单:
# [ ] 对话列表出现, 可以新建/删除/重命名对话
# [ ] 搜索框可以过滤对话
# [ ] 分组下拉可以切换, 对话可以移动到分组
# [ ] 发消息 → 气泡出现, Markdown 渲染正常
# [ ] 流式回显逐字出现
# [ ] 右键消息 → 复制/编辑/重发/删除
# [ ] 编辑消息 → 修改 → 重发
# [ ] 模型切换 → 下拉菜单正常 → 切换后发消息用新模型
# [ ] Provider 切换 → 模型列表更新
# [ ] Token 计数器实时更新
# [ ] 压缩开关可以切换
# [ ] 输入框自适应高度 (2→5行)
# [ ] Enter 发送, Shift+Enter 换行
# [ ] 上传图片 → 显示在消息中
`

---

## 五、阶段 4: 简易 AI + 同步

### 5.1 核心原理

SimpleAIPanel 和 ChatLayout 都从 chat.store 读取:
- conversations — 对话列表
- ctiveConversationId — 当前活跃对话
- messages — 当前对话的消息

不需要额外的同步代码——Zustand 单例 store 天然同步。

### 5.2 SimpleAIPanel 改造

`	ypescript
// SimpleAIPanel.tsx 关键改动:
// 1. ChatSubPanel: 使用 chat.store 的 activeConversation 和 messages
//    顶部加一个对话选择下拉 (切换 activeConversationId)
//    消息区复用 MessageList 组件 (不要重写)
//    输入框简化版 (只有输入+发送, 没有工具栏)
// 2. VisionSubPanel: 拖拽/多选图片上传, 调 window.api.ai.vision()
//    结果展示为标签勾选列表, 提供 "添加到提示词"/"收藏"/"导入库" 按钮

// 3. 和 ChatLayout 共享:
//    - MessageList 组件 (完全一样的文件引用)
//    - MessageBubble 组件
//    - chat.store
`

### 5.3 识图反推标签流程

`
1. 用户拖拽/点击选择图片 (支持多选)
   - 拖拽区域: 虚线边框, 大图标, "拖拽图片到此处或点击选择"
   - 点击: 打开文件选择器 (accept="image/*", multiple)
2. 图片预览: 缩略图列表, 可删除单个
3. 选择模型: 下拉菜单 (排除不支持 vision 的模型)
4. 点击"开始识别"
5. 调 window.api.ai.vision({ providerId, model, imageBase64, prompt })
6. 解析返回 JSON → 标签列表 [{en, zh}]
7. 展示: 每个标签一个勾选框, 已选中高亮
8. 操作按钮:
   - [全选] [取消全选]
   - [添加到正面提示词] → usePromptsStore.addPositive()
   - [添加到负面提示词] → usePromptsStore.addNegative()
   - [⭐ 收藏] → useFavoritesStore.toggleTagFav()
   - [📥 导入标签库] → 打开弹窗选择大类子类 → window.api.tags.create()
   - [📋 复制] → 复制标签文本到剪贴板
9. 历史记录: 每次识别结果保存到本地 (localStorage 或 DB)
`

### 5.4 多模态模型识别

`
判断模型是否支持识图:
- 简单方案: 模型名包含 'vision' 或 'gpt-4o' 或 'claude-3' 或 'gemini' 等关键词
- 完整方案: 调 API 获取模型能力列表 (但较慢)
- 当前建议: 简单方案 + 用户可手动选择任意模型
  (即: 下拉菜单显示所有模型, 但标注哪些是"推荐识图模型")
`

### 5.5 阶段 4 验证

`ash
npm run build

# 手动测试:
# [ ] 打开简易 AI 聊天 tab → 对话列表和 AI 窗口一致
# [ ] 在简易 AI 新建对话 → AI 窗口立刻出现
# [ ] 在简易 AI 发消息 → AI 窗口同步显示
# [ ] 打开识图 tab → 拖一张图片 → 识别成功 → 返回标签
# [ ] 标签可勾选 → 可添加到提示词/收藏/导入库
# [ ] 历史记录可查看之前识别结果
`

---

## 六、阶段 5: 设置页 + 快捷键

### 6.1 ProviderEditor 升级

基于现有的 src/renderer/components/settings/ProviderEditor.tsx 改造:

**UI 布局调整**:
`
┌──────────────────────────────────┐
│  编辑供应商                   [×] │
├──────────────────────────────────┤
│  名称: [____________________]    │
│                                  │
│  接入模式: [官方登录 ▼] [纯API ▼]│
│  上游协议: [Chat Completions ▼]  │
│            [Responses API ▼]     │
│                                  │
│  ─────── 模型配置 ───────        │
│  默认模型: [________________]    │
│  测试模型: [________________]    │
│  上下文大小: [________] (留空默认)│
│                                  │
│  ─────── API 配置 ───────        │
│  Base URL: [________________]    │
│  API Key:  [********] [👁显示]  │
│                                  │
│  ─────── 模型列表 ───────        │
│  [从上游获取]  ← 获取可用模型    │
│  (加载中...)                     │
│  ☑ gpt-4o                       │
│  ☐ gpt-4o-mini                  │
│  ☑ gpt-4-turbo                  │
│  [全选] [取消全选]              │
│  已选模型即 AI 助手可选模型      │
│                                  │
│  ─────── 配置文件 ───────        │
│  config.toml: (可编辑)           │
│  ┌────────────────────────┐     │
│  │ [general]              │     │
│  │ default_model = "gpt-4"│     │
│  └────────────────────────┘     │
│                                  │
│  auth.json: (可编辑)             │
│  ┌────────────────────────┐     │
│  │ { "api_key": "..." }   │     │
│  └────────────────────────┘     │
│                                  │
│  [测试连接]  [保存]  [取消]      │
└──────────────────────────────────┘
`

### 6.2 快捷键系统

**新增文件**: src/renderer/stores/shortcuts.store.ts

`	ypescript
// 快捷键 store
interface Shortcut {
  actionId: string      // 唯一标识
  label: string         // 显示名
  group: 'global' | 'ai' | 'tags' | 'general'
  keys: string          // 组合键如 "Ctrl+N", "Enter", "" 表示未绑定
  handler: () => void   // 执行函数
}

// 默认快捷键:
const defaults: Shortcut[] = [
  { actionId: 'ai.send',       label: '发送消息',     group: 'ai',     keys: 'Enter' },
  { actionId: 'ai.newline',    label: '换行',         group: 'ai',     keys: 'Shift+Enter' },
  { actionId: 'ai.newConv',    label: '新建对话',     group: 'ai',     keys: 'Ctrl+N' },
  { actionId: 'ai.searchConv', label: '搜索对话',     group: 'ai',     keys: 'Ctrl+F' },
  { actionId: 'global.undo',   label: '撤销',         group: 'global', keys: 'Ctrl+Z' },
  { actionId: 'global.redo',   label: '重做',         group: 'global', keys: 'Ctrl+Y' },
  { actionId: 'global.copy',   label: '复制',         group: 'global', keys: 'Ctrl+C' },
  // ... 更多
]

// 快捷键编辑 UI:
// 列表形式: 操作名 | 分组 | 当前快捷键 | [编辑] [清除]
// 编辑模式: 点击[编辑] → 按下新组合键 → 保存
// 清除: 设为空字符串, 表示不绑定
`

### 6.3 阶段 5 验证

`ash
npm run build

# 手动测试:
# [ ] ProviderEditor 所有字段可编辑
# [ ] config.toml 和 auth.json 可编辑保存
# [ ] 从上游获取模型 → 列表出现 → 可勾选 → 保存后 AI 窗口模型列表更新
# [ ] 测试连接按钮可点击
# [ ] 快捷键列表展示 → 可编辑 → 可清除 → 生效
`

---

## 七、全局规则和注意事项

### 7.1 代码风格

- **不要用 Python 脚本写 JSX 修改** (会导致 \u 编码问题和 ? 乱码)
- **所有修改直接写 .ts/.tsx 文件**，用 [System.IO.File]::WriteAllText("D:\File\Data\魔导书\grimoire\path.tsx", @'...'@, UTF8) 写文件
- **中文直接在文件中使用**，不要用 \uXXXX 转义
- **构建验证**: 每次改完跑 
pm run build，有错立刻修
- **不要改无关文件**: 标签库 (Sidebar/MainContent/TagCards/tags.store) 已经稳定，不要碰

### 7.2 已知的坑

1. **PowerShell 不支持 &&**: 用 ; 分隔命令或逐条执行
2. **Tailwind v4**: 使用 CSS 变量如 ar(--color-accent) 而非 g-blue-500
3. **sql.js**: 所有 SQL 操作同步执行，不需要 await
4. **IPC 通道名**: 必须和 preload/index.ts + global.d.ts 保持一致
5. **类型文件**: shared/types.ts 修改后需要同时更新 enderer/global.d.ts
6. **LF/CRLF**: Windows 上 git 会自动转换换行符，不用管 warning

### 7.3 错误处理模式

`	ypescript
// IPC handler 统一模式:
try {
  // ... 业务逻辑 ...
  return { success: true, data }
} catch (e: any) {
  console.error('handlerName:', e)
  return { error: e?.message || String(e) }
}

// Store action 统一模式:
try {
  const result = await window.api.xxx(...)
  if (result.error) {
    toast(result.error, 'error')
    return
  }
  // ... 更新 state ...
} catch (e: any) {
  toast(e?.message || '操作失败', 'error')
}
`

---

## 八、完整文件清单 (需要新建/修改)

### 新建文件

`
src/main/ai/client.ts              ← OpenAI SDK 封装
src/main/ipc/ai.ipc.ts             ← AI 通信 IPC handlers
src/main/ipc/chat.ipc.ts           ← 对话/消息 CRUD IPC
src/renderer/stores/chat.store.ts  ← 聊天 store (重写)
src/renderer/stores/shortcuts.store.ts ← 快捷键 store
src/renderer/components/ai/ChatLayout.tsx
src/renderer/components/ai/ConversationList.tsx
src/renderer/components/ai/ConversationItem.tsx
src/renderer/components/ai/MessageList.tsx
src/renderer/components/ai/MessageBubble.tsx
src/renderer/components/ai/InputArea.tsx
src/renderer/components/ai/ToolbarRow.tsx
src/renderer/components/ai/SendBar.tsx
src/renderer/components/ai/ModelPicker.tsx
src/renderer/components/ai/ConvSettingsModal.tsx
`

### 修改文件

`
src/main/index.ts                  ← 注册 registerAIIPC() + registerChatIPC()
src/main/database.ts               ← SCHEMA_SQL 追加 chat_groups/conversations/messages
src/main/ipc/providers.ipc.ts      ← 导出 decryptKey
src/shared/types.ts                ← 追加 IPC_CHANNELS
src/preload/index.ts               ← 暴露 window.api.ai + window.api.chat
src/renderer/global.d.ts           ← 补充类型定义
src/renderer/components/ai/AIPanel.tsx    ← 重写为 ChatLayout
src/renderer/components/ai/AIWindow.tsx   ← 改为独立窗口
src/renderer/components/ai/SimpleAIPanel.tsx ← 复用 chat.store + MessageList
src/renderer/components/settings/ProviderEditor.tsx ← UI 升级
`

---

## 九、快速启动清单

`ash
# 1. 安装新依赖
cd "D:\File\Data\魔导书\grimoire"
npm install openai gpt-tokenizer

# 2. 每改完一个阶段
npm run build

# 3. 验证通过后提交
git add -A
git commit -m "阶段X: ..."

# 4. 启动测试
npm start
# 或双击 .bat 文件
`

---

## 十、参考资源

- Chatbox 源码: https://github.com/Bin-Huang/chatbox (UI 克隆参考)
- OpenAI Node SDK: https://github.com/openai/openai-node
- gpt-tokenizer: https://github.com/niieani/gpt-tokenizer
- react-markdown: https://github.com/remarkjs/react-markdown