# 剩余工作清单（2026-10-10）

本文件是**执行用的待办清单**，不是进度汇报。每一项都必须写清：缺什么行为、解除条件、验证方式。
状态只用矩阵枚举。完成的项从本文件删除（历史在 `STATUS.md`）。

排序原则：先做能整片推进的，再做需要新基础设施的，最后做细节打磨。

---

## A. 可以立即做完的（无新基础设施）

| # | 项 | 缺什么 | 解除条件 | 验证 |
|---|---|---|---|---|
| A2 | ~~提示词绑定~~ **已完成 2026-10-10** | 曾记为「需决定映射到 tag 还是新建表」——实际**新建表是唯一诚实选择**：源建模的是关系（一条提示词共享给多个助手），而 Grimoire 助手只有单个 `system_prompt` 字符串，写进去等于复制文本、改提示词不影响助手、解绑无法恢复。**schema v28** `cherry_prompt_bindings` + 完整 PUT/DELETE/GET；同时发现并修复可见性**根本没存**（投影硬编码 `global`，会把受限提示词报成全局可见）→ **schema v29** 可见性列。源的 refine 也已实现（global + bindingTarget → 400）。真机验证含 `restrictedVisibility: "restricted"` 往返 |
| A5 | 快捷键**冲突检测** | 页面已可用，但冲突提示永不触发：Grimoire 不注册全局快捷键，无发射源 | 若引入全局快捷键则同时实现；否则此项不成立 |
| A3 | `/settings/general` 挂载 | **5/7 类消费者已完成并真机验证**（开机自启/代理/防休眠/重试/上下文截断）。**`app.developer_mode.enabled` 已决定不实现**（见 DECISIONS）：源的 15 处引用中 14 处在 `ai/observability/**`，第 15 处只是原样读出该值；实现它等于新建 OTel 追踪管线，属新基础设施而非接线，且无用户可见影响 | **本条已关闭**——不因该键挂载页面，保持诊断页 | — |
| A4 | 用量**成本/定价**（页面已可用，成本列恒 `N/A`） | Grimoire 无价格表、无 provider 账单口径 | 决定是否引入模型定价表 | `stats`/`timeline` 返回真实 `totalCost` 与币种 |

## A6 更正（2026-10-10）

原先记为"未接"，**核查后发现已实现**：`cherry-chat-shell-entry.tsx:365-386` 的发送路径会把每个
附件 path 经 `host.attachments.import({sessionId, filePath, sourceType})` 导入，拿到 id 后随
`host.chat.send({..., attachments})` 发送；`ComposerSurface` 通过 `setFiles` 拿到 source 的
drop/paste 结果（`ComposerSurface.tsx:296/387` 的 onPaste/onDrop），`file.get`/`createTempFile`/
`write`/`getPathForFile` 四个 preload 面都已存在。renderer 从不直接读文件，符合边界要求。

**运行时链路已真机验证**（2026-10-10）：path → `file.get` 描述符（name/size/ext/type 齐全）→
创建会话 → `ai.sessions.attachments.import` 返回真实 id → `attachments.list` 可列回 1 条。
链路真实可用。UI 手势（真实拖拽/粘贴）需显示环境，归 Functional 门（D2）。

## B. 需要设计决策的（有真实存储但语义不匹配）

| # | 项 | 缺什么 | 解除条件 |
|---|---|---|---|
| B1 | ~~回收站 `/settings/archive`~~ **已完成 2026-10-10** | 前提曾被误判为 BLOCKED（以为需要引入软删除）：实际三条归档路径**本来就在写 `deleted_at`**。`GET /archives` + `POST /:domain/:id/restore` + `DELETE /:domain/:id` 已实现，页面已挂载并真机验证（归档一个会话后页面显示该条目、空状态消失）。**未伪造的域**：源有 7 个分类，Grimoire 支撑 3 个（assistants/topics/sessions），其余如实为空 |
| B2 | 备份传输（本地/WebDAV/坚果云/S3） | 源 `LegacyBackupManager` 归档 Cherry 自己的 userData 布局与 drizzle 恢复日志，无法指向 Grimoire 的 SQLite；`webdav`/`@aws-sdk/*` 依赖缺失 | 复用源的**传输层**（`WebDav.ts`/`S3Storage.ts` 是纯第三方 API 客户端）对接 Grimoire 的 DB 文件，恢复协议换成 `exportDatabase`/`replaceDatabase` |

## C. 需要新基础设施的（大块）

| # | 项 | 缺什么 |
|---|---|---|
| C1 | ~~源行组件~~ **已核查：实质已接**（2026-10-10） | 见下方更正段落。剩余只是 `CompatSessionRow`/话题行的**视觉**为自建（各约 85 行），且它本身用源的 `ResourceList.Item`/`ItemLeadingSlot`/`RenameField` 搭成 |
| C2 | ~~归一化状态块~~ **已核查：实质已接**（2026-10-10） | 源 `MessageListActions` 只要求一个订阅（`subscribeToolProgress`，已实现）；`part-projection.ts` 覆盖 7 种 part 类型；渲染走源 `MessageListProvider`；tool progress 进度环已接。本条真正缺的是消息级导出动作，已补 4 个 |
| C3 | 6 个源窗口 | subWindow / quickAssistant / screenshot / selection×2 — 需要多窗口生命周期、全局输入钩子、截图管线。见 `WINDOW_MATRIX.md` |
| C4 | 剩余 app 路由（browser/knowledge/code/notes/translate/files/launchpad/paintings/mini-app） | 60 个源路由文件，registry 目前 16 个 id。**阻塞面已实测拆分（2026-10-10）**，见下方 C4 更正 |

## C4 更正（2026-10-10）：剩余 app 路由的阻塞面已逐页实测

原先只记「60 个源路由文件，registry 13 个 id」。**逐页 import → render → 补真实 provider/window.api 实测后**，
阻塞面比预期小得多，且**我此前的两次 blocked 判定又被推翻**（`browser`、`notes`）。

**已挂载（2026-10-10）**：`launchpad`、`browser`、`knowledge`、`notes`、`code`、`translate`、`paintings`
七条 `/app/*` 路由已注册并接进 shell。其中 `notes` 此前记「缺 CodeStyleProvider」、`code`/`translate` 记
「`.on` undefined」——**都是测试 scaffold 的缺陷**（`window.api` 只有 `preference.onChanged`），已补齐；
`browser` 记的 `startsWith` 是我没传 `initialUrl`。**三次误判都是我的工具/调用错，不是产品缺能力。**

**剩余两条真实阻塞**（2026-10-10 更新，均已在界面上如实标注，不再落到通用「路由未实现」）：

| 页面 | 真实阻塞 | 解除条件 |
|---|---|---|
| ~~`files`~~ **已完成 2026-10-10** | `GET /files/entries`（游标分页）、`/files/entries/:id`、`/files/entries/stats` 与 12 条 `file.*` IPC 路由均已桥接（上传/重命名/在文件夹中显示/移除/路径/悬空状态）。**真相来源是两个真实 store 的并集**（`ai_attachments` = internal 复制件 + `image_refs` = external 引用），**schema v31** 让 `session_id` 可空以便存「无会话的库文件」。未伪造项逐条记录在 `cherry-file-library.service.ts` | **剩余（明确未做）**：`file.write_if_unchanged`、`file.batch_trash/restore/permanent_delete`（三者一起拒绝，因无文件回收站）、`pdfjs.resource.read`（预览）；`file.select_folder` 等 picker 路由 | 
| `miniApps` / `miniApp` | **mini-app 在源架构里就是 tab-hosted**：`MiniAppsPage` 调 `useTabs().openTab('/app/mini-app/<id>')`，`MiniAppPage` 从 `useParams` 读取 appId，并依赖 tab identity/activity/metadata 生命周期。缺少 tab 生命周期不能完整挂载；此前关于 appId 来源的描述已更正。现访问 `/app/mini-app` 渲染专门的 BLOCKED 诊断页（写明依赖与解除条件） | 给 compat 提供具备真实语义的 `TabsContext`（不能是 no-op：21 个源文件用 `useTabs`） |

**launchpad 十个磁贴已逐个真实点击验证**（2026-10-10）：工作→agents、对话→chat、绘画→paintings/\<provider\>（源 catch-all）、翻译、小程序→BLOCKED 诊断、知识库、文件、编码搭档、笔记、DSH。全部落到诚实目的地。

`code` / `translate` / `knowledge` 页面**渲染正常但功能未桥接**（`/models`、`code_cli.*`、`knowledge.*`、
`translate.pdf.*` 等返回「路由未桥接」——如实显示为错误，不是假成功）。要补的是这些 DataApi/IPC 路由，
不是页面本身。

**依赖面已全量枚举**（`.agent/evidence/scan-source-deps.mjs`）：源 closure 不含自己的 `package.json`，
所以只能扫。renderer 缺 22 包 / 46 导入点、main 缺 111 包 / 516 导入点（本轮的清单）。
已装：`strict-url-sanitise`、`smol-toml`、`jsonc-parser`、`franc-min`、三个 tiptap 包（精确对齐已有
`3.26.1`）、`@cherrystudio/extension-table-plus`。**不为了绕过缺失依赖改写源文件**。
其中 `@cherrystudio/extension-table-plus` 的 `exports` map 在上游是坏的（指向不存在的 `dist/index.js`，
实际只发 `index.mjs`），已在 `vite.shared.config.ts` alias 绕过并注明。

## C1 更正（2026-10-10）

计划此条记为「当前是自建 adapter row」，核查后发现**严重低估**：
- `CompatSessionResourceList.tsx` 已导入**源** `SessionResourceList`（28 行薄包装，只依赖 `base`）+ 源 `useResourceListActions` / **`useResourceListPinnedState`** / `useResourceListRowState` / `ResourceListActionContextMenu`。
- `menu-actions.ts` 已导入**源** `sessionItemActions`。
- 计划点名的 `resourceList/` 下 `SessionItem.tsx` **不存在**（计划路径写错）；`chat/actions/sessionItemActions.tsx` 存在且已在用。
- 结论：Phase 1 第 1、2 项实质已满足。真正新增的是**话题导出菜单接线**（6 个导出回调原为 `noop` 且 `exportMenuOptions` 硬编码 false 会隐藏全部导出项）——已接 Joplin/Siyuan/语雀/Markdown，复用源自己的导出函数。

## Phase 2 核查（2026-10-10）

源组件已接（`ResourceEntityRail` / `TopicResourceList` / base hooks / `ResourceListActionContextMenu`），
且已**采用**源 `useResourceEntityRail`（乐观排序+回滚、置顶浮动、陈旧激活守卫）。
**Phase 2 仍缺**：源 `AssistantResourceList`（500 行）本身未采用——它依赖 `useAssistant`/`useGroups`/`usePins`/
`useSidebarShortcuts`/`recycleBinFeedback` 等 compat 无对应的 hook；当前用 compat 的 assistant 投影 + 源 rail。
Topic message tree 依旧 BLOCKED（界面上已如实标注）。

## Phase 2 追加（2026-10-10）：AssistantResourceList 可采用性已实证

上文写「500 行组件未采用，因为依赖 compat 无对应的 hook」——**实证推翻了它**：
在 compat 工程里 import 成功、在 jsdom 里 render 成功（零 console 错误）。
其 hook 依赖（`/assistants`、`/topics`、`/pins`、`/groups`、`/topics/reusable-placeholder`）
本轮已全部补齐，因此**下一步就是真正把它接进 shell**，替换 compat 的 assistant 投影 rail。
**两个剩余依赖也已实证可用**：`recycleBinFeedback` 导出 5 个函数
（showRecycleBinUndo / restoreRecycleBinItems / restoreRecycleBinItem / restoreRecycleBinUndoGroup / showRecycleBinBatchUndo），
`SidebarShortcutService` 导出 service 单例——**在 compat 工程里都能 import 并求值**。
它们只依赖已就位的偏好 shim、logger shim、i18n resolver、toast 与 shared errors。
**结论：采用源 `AssistantResourceList` 的所有前置条件已全部满足**。
2026-10-10 又补上最后一环：它读取数据的 **context**（`CompatResourceViewSources.tsx`，
复用源 `useRawAssistantTopicsSource` + `deriveAssistantTopicsView`），并已用测试断言
context 的值（`topics.length:rendererTopics.length === 1:1`），而不是只断言渲染成功。
**接入方式已确定并验证**：组件**通过 prop** 接收 `assistantTopicsSource`（不是 context——
先写的 context provider 方案被集成测试推翻）。集成测试已证明：用源自身的
`useRawAssistantTopicsSource` + `deriveAssistantTopicsView` 构造该 prop，源组件能渲染出真实助手名。
过程中修掉一个真实契约错误：`GET /assistants` 必须是偏移分页信封 `{items,total,page}`，
裸数组会让 `useAssistantsApi` 静默回退为空列表。
**外壳接线已完成**（2026-10-10）：compat 的 assistant 投影 rail 已被源 `AssistantResourceList` 替换，真机截图已核对；死代码（`projectAssistant`/`CompatAssistantItem`/`assistantItems`/`assistantStatus`/`useResourceEntityRail` 调用）已删除。

## 已发现的既有测试 flake（2026-10-10）

`src/vendor/cherry/compat/src/CompatProviderMcpPanel.test.tsx` 的
`loads provider and MCP status through the Host Bridge` 在整套 compat 运行时约 7 次失败 1 次，
单独运行 8/8 全过，文件本身不在改动范围内。成因：`await findByText(...)` 之后直接断言
`toHaveBeenCalledOnce()`，DOM 就绪与回调计数之间没有同步点。
**已修并验证**（2026-10-10）：断言改为 `await waitFor(() => expect(...).toHaveBeenCalledOnce())`，
让等待对象与断言对象一致。修复后**全量运行连续 8 次全绿**（此前约 7 次失败 1 次）。

## D. 打磨项（不阻塞，但影响"可审计"）

| # | 项 |
|---|---|
| D1 | Phase 5 视觉矩阵：**视口×缩放×主题轴已完成**（2×3×2），**populated 与 empty 两种 fixture 现已同时纳入门禁**（各 12 帧，基线分目录存放）。**已补 3 个状态帧**：`populated-state-{failed,running,tool}.png`（按真实行标题点击选中会话后捕获，内容已核对）。**已补**：failed / running / tool / menu-open / group-collapsed 五个状态帧（均 mutation 验证可失败）。**loading 实测不可捕获**（40 次采样全 0；原因是 `loadSessions` 在 effect 中调用且 Host 同步 resolve，加载态存在时间短于一帧）——已按事实记录，解除条件：Host 列表变为异步/分页后应当加入。**仍缺**：retry、permission 提示的独立帧；**两个运行现都带 `route-diagnostic.json`**（`/settings/data`；populated 1035 字符 / empty 919），结构化信号层已对两者生效并 mutation 验证可失败 |
| D2 | Functional 门：**已补** usage 采集、retry（真实请求计数）、cancel（abort + cancelled）、**permission 往返**（JSON 与 SSE 双传输，断言 agent 收到决定）。**recovery 无法验证——没有任何 emitter，已记为 NOT_IMPLEMENTED**。**仍缺**：真机拖拽/粘贴 |
| D3 | 矩阵 88 行逐符号核对未全做完 |
| D4 | ~~AGPL-3.0 vs 各包 MIT 的书面结论~~ **已完成 2026-10-10**：结论写在 `THIRD_PARTY_NOTICES.md`——**AGPL-3.0 为准**（树内唯一许可证文本；四个包的 MIT 字段背后没有许可证文件，且它们是源码别名内联进 AGPL 产物，不是外部依赖）。MIT 在该方向上兼容，义务是**通知**；现已随 `extraResources` **随发行版一起分发**（此前打包产物完全没有署名，是真实合规缺口） |

---

## 已在本轮完成并验证（供参考，不在待办内）

- `/settings/data` 全部 13 面板渲染；Joplin/Siyuan/语雀 导出**端到端可用**（renderer-side fetch）
- Cherry 路径助手 `resolvePath`/`isPathInside`/`hasWritePermission`（源语义，含 equality-true）
- `/settings/notifications`、`/settings/about`、`/settings/prompts`、`/settings/usage` 四条路由挂载（registry 8 → 14 个 id）
- 提示词 create/delete/update/reorder（含 `cherry_resource_state.order_key` 分片键）
- **用量采集 + 面板**：`usage` RuntimeEvent、schema v26 `ai_usage_records`、三个端点、`/settings/usage` 页面（成本列如实显示 `N/A`）
- Composer 附件链路真机验证（path → import → id → list）
- `/settings/shortcut` 挂载（11 个源快捷键条目）
- **路由审计盲区修复**：边界检测原先漏掉源错误边界的「似乎出现了一些问题…」文案，导致崩溃页被报 OK。现在同时匹配文案与结构签名，并在结果里带出错误文本
- 两个审计门禁缺陷修复（泄漏的 Electron 进程树、错误的 CDP 目标选择）
- 两个我自己的错误判据纠正（`/archives` 在 closure 内；`GeneralSettings` 不缺服务）
