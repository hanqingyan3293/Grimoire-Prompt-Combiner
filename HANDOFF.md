# 魔导书 Grimoire v7 — 开发接手文档

> 日期: 2026-06-15 | 最后提交: e61d25c

## 项目概览

- **路径**: `D:\File\Data\魔导书\grimoire`
- **技术栈**: Electron 34 + React 18 + TypeScript 5 + Vite 8 + Tailwind CSS v4 + sql.js + Zustand + OpenAI SDK
- **构建**: `npm run build` → `npm start`
- **DB路径**: `%APPDATA%/grimoire/grimoire.db`

## 当前状态

**构建通过** (305模块, 0错误), 应用正常启动

## 已完成功能

| 阶段 | 内容 | Commit |
|------|------|--------|
| Phase 1 | AI核心通信 (client.ts + ai.ipc.ts + preload) | 5d34a2c |
| Phase 2 | chat.store + chat IPC + DB表 | 12d4bf3 |
| Phase 3 | Chatbox UI克隆 (10个组件) | eae0c83 |
| Phase 4 | SimpleAIPanel重构 + 同步 | 6ba7138 |
| Phase 5 | ProviderEditor + 快捷键 + 字体大小 | 8de37f0 |

## 最近修复 (e61d25c)

1. **消息持久化** - chat.ipc.ts 表名从 `messages` 改为 `chat_messages`
2. **消息气泡** - 用户消息蓝底白字(右侧), AI灰底边框(左侧)
3. **AIWindow识图** - 顶部聊天/识图标签切换
4. **同步** - SimpleChat用getState()避免stale closure
5. **全中文** - AI相关页面UI文本中文化
6. **Token默认值** - 从8192改为128000

## 已知待处理

- 标签库子类右键功能不全
- 收藏页UI需优化
- 生图功能未测试
- tags:create 5值/6列bug (group_id参数)

## 关键文件地图

```
src/
├── main/
│   ├── index.ts              ← Electron入口
│   ├── database.ts           ← sql.js Schema + 迁移
│   ├── ai/client.ts          ← OpenAI SDK封装
│   └── ipc/
│       ├── ai.ipc.ts         ← sendMessage/vision/generateImage/fetchModels
│       ├── chat.ipc.ts       ← 对话/消息CRUD (表名已修正)
│       └── ...
├── renderer/
│   ├── components/ai/
│   │   ├── ChatLayout.tsx    ← 主布局(左对话列表+右聊天)
│   │   ├── MessageBubble.tsx ← 消息气泡(用户右/AI左)
│   │   ├── InputArea.tsx     ← 输入框+SendBar
│   │   ├── AIVisionPanel.tsx ← 识图面板(NEW)
│   │   ├── AIWindow.tsx      ← 独立窗口(聊天+识图标签)
│   │   ├── SimpleAIPanel.tsx ← 右侧简易AI(聊天+识图)
│   │   └── ...
│   └── stores/
│       ├── chat.store.ts     ← Zustand单例(AIWindow+SimpleAI共用)
│       ├── settings.store.ts ← 含快捷键getShortcut()
│       └── ...
```

## 数据库Schema

```sql
tag_groups(id, name, is_active, created_at)
categories(id, group_id, en, zh, sort_order, created_at)
subcategories(id, group_id, category_id, en, zh, sort_order, created_at)
tags(id, group_id, subcategory_id, en, zh, sort_order, source, created_at)
chat_groups(id, name, sort_order, created_at)
conversations(id, group_id, provider_id, title, model, system_prompt, pinned, created_at, updated_at)
chat_messages(id, conv_id, role, content, model, token_count, created_at)
providers(id, name, access_mode, protocol, base_url, api_key, default_model, test_model, context_size, models, config_toml, auth_json, ...)
```

## 注意事项

1. **PowerShell**: 不要用 `@'...'@` 写JSX (会吃掉 `${}`), 用Python写文件
2. **CSS变量**: `var(--color-accent)` 不是Tailwind类, 是自定义变量
3. **同步**: AIWindow和SimpleAI共用 `useChatStore`, 是同一个Zustand实例
4. **DB表名**: chat_messages (不是 messages)

## 回退

```bash
git reset --hard e050f32   # AI开发前稳定版
git reset --hard 68fba10   # 无AIWindow识图但有气泡对齐
git reset --hard e61d25c   # 最新
```