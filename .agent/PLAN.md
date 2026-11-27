# Grimoire 后续完整开发与验收执行计划

> 2026-11-06 已批准；执行者 GPT-6.1 Sol。此文件是唯一执行计划，整合本会话已批准的《Grimoire 后续完整开发与验收执行计划》，只做本地路径和执行状态适配。
> 批准证据：本会话 exit_plan_mode 结果及用户持续执行目标。计划审批不等于人工功能接受，不包含 Git commit、push 或远程发布。
> Goal：保留当前源码迁移成果、业务数据、既有功能，补齐选定 Cherry / NovelAI / MOSS / ComfyUI 能力，形成绑定同一构建的完整自动验收和逐项人工接受材料。
> Architecture：UI → 应用合同 → adapter/domain service → Grimoire SQLite；源码复用优先，NovelAI 只取行为规格是已有明确例外。
> Stack：Electron 42 / React 19 / TypeScript / Vite / Vitest / SQLite / Cherry compat / OpenCode-Pi adapters。

## 0. 执行纪律与当前顺序

- 目录 `D:/File/Data/魔导书/grimoire`，本文件中的代码路径相对仓库根；标“新增”的路径在对应任务执行时创建。
- 先加载 executing-plans；每次功能修改先 TDD；失败先 systematic-debugging；完成声明前 verification-before-completion。
- 保留用户工作树，沿用 `work/2026-10-27-m0`；写操作串行，构建也由同一个写者调度。只读审查可并行。
- `src/vendor/*/source` 只读；直接复用 → VENDOR → WRAPPER → ADAPTER → 最小修改 → 部分提取 → 书面证明后的重实现。
- 不 reset / checkout / clean，不自动提交，不 push。备份覆盖未跟踪源码、资产、配置；旧证据原样留存。
- STATE 只写当前事实；历史进程归档。DECISIONS 追加范围/接口决策，MIGRATION_MATRIX 行级证据不等于任务勾选。
- 记录目录 `.agent/records/2026-11-06-sol-execution/` 只存执行证据，不成为第二份计划。

| ID | 工作 | 状态 |
|---|---|---|
| P0 | 快照、计划落位、范围与状态纠偏 | completed |
| P1 | 真正的图片/素材删除保护 | completed（129focused及追加后完整G1-G14已过；live/人工留最终验收） |
| P2 | Comfy 重试状态与调度续跑 | completed（51新场景/119focused/完整G1-G14通过；C1身份恢复仍pending） |
| C1 | 持久 prompt 身份、阶段重试、目标取消 | completed（本轮362focused；完整14项记录/构建字节复核；真实Electron任务fixture；初始导航/最终ROOT-3X/用户服务/人工留最终验收） |
| C2 | HTTP/DNS/超时/响应上限/错误合同 | completed（最新14/14exit0、66c84a2b…stable、root2190pass/2skip；实际TLS与Electron同构建任务fixture；自主启动/用户服务/最终ROOT-3X/manual仍留最终验收） |
| C3 | 直接适配源工作流转换、发现、节点能力 | completed（直接源50tests、当前14/14gate/2ee5efdb…stable、原生Electron远端导入→实际POST→取消/PNG和1600/1280/960参数宽度验证；最终验收仍后续） |
| W1 | 草稿 CAS、dirty 保护、编辑租约 | completed（schema42、当前14/14gate/7a1cb2b2…stable、真实双sender/草稿reload/领域lease与素材CAS通过；正式transfer/N1/N2/最终验收后续） |
| W2 | flush-hydrate-ready 窗口/Canvas 移交 | completed（11/15最新14/14gate、09c42ad1…稳定、51原生场景同构建、9639vendor字节不变；最终/manual后续） |
| N1 | 块/完整文档/多角色/随机池/撤销 | in_progress（合同+生产UI已接；11/26：双端类型复绿、聚焦134tests、完整G1–G14同构建全绿、vendor 9639文件不变；剩余原生往返/逐ID/stage收据/人工接受） |
| N2 | 完整版本快照/自动 checkpoint/事务 | pending |
| N3 | 图库生命周期/共用图/导入/版本导航 | pending |
| N4 | 素材插入/次数/自动归因 | pending |
| N5 | 双语/翻译回落/人工覆盖 | pending |
| N6 | AI 整理/命名/翻译提案与外部真测 | pending |
| N7 | 元数据/MOSS/主题回归 | pending |
| C4 | Comfy 专用内嵌视图与窗口生命周期 | pending |
| C5 | 生成快照/图生图/逐张种子/结果关联 | pending |
| T1 | 工具域/预演确认/共用命令面板 | pending |
| S1 | 设置真实操作/数据依赖/Usage | pending |
| S2 | 主题品牌/旧入口兼容收口 | pending |
| R1 | runtime 合同回归/外部阻塞 | pending |
| V1 | 同构建验收编排与 final seal | pending |
| V2 | 全量自动验收/打包启动 | pending |
| V3 | 人工验收与交付材料 | pending |

依赖顺序：P0 → P1/P2（串行写）→ C1 → C2 → C3 → W1 → W2 → N1 → N2 → N3 → N4 → N5 → N6 → N7 → C4 → C5 → T1 → S1 → S2 → R1 → V1 → V2 → V3。
每任务读真实调用链→失败用例→观察 RED→最小实现→focused GREEN→diff 审查→状态/证据更新。阶段出口同时检查自动、真实功能和迁移；环境阻塞明确保留，可继续独立任务。

## 1. 已核实起点与范围

### 起点（执行时复核，不永久冻结数字）
- HEAD `be75c84`，审计时 81 个 tracked 修改、168 个 untracked 文件；这些是用户基线。
- 数据库 CURRENT_SCHEMA_VERSION=40；新增迁移从实际最新版本+1 开始，不重建 v36。
- 11/06 G1-G14 报告记录通过且绑定 `b696b39b…`；之后修改需重新验证。
- M5 latest 为 automated-failed：旧分层接受绑定 `245647e5…`，不是当前 build；人工接受仍 pending。
- stream round25 含 chat 落库/Agent/审批正反/vision；重用链路，不重造聊天引擎。
- Comfy running 时直接 retryTask 抛错已复现；P2先修，C1再区分 POST 结果不明与 GET 重试。
- assertNovelaiImageRemovable 仅有测试调用，尚未保护真实文件/记录删除；P1接生产路径。
- WorkspaceEditorHost/IPC 已有 revision CAS，缺 dirty、乱序、面板接入与移交；不另建草稿库。
- NovelAI 94项中采纳67，六个M6标题不等于全部67；MOSS120+120已有摄入，只做回归与内容处置。

### 审批后固定默认
1. Cherry 产品曝光和技术实现双台账；按原79逐项裁剪，模型/供应商保留，MCP只列表+详情。
2. 归档/通知/联网搜索/本地备份四个原待定设置页从常用nav/search隐藏，保留深链说明；已有服务保留，会话归档不随设置页裁撤。
3. A compat为默认；B源壳保留独立验证，自动切默认/新增B包目标不在本计划内。
4. 设置是工作区面板可独立窗口；昼夜+色轮，主色#a855f7。
5. 数据仅完善Grimoire现有数据库导出/导入，不扩WebDAV/S3/坚果云/完整媒体备份。
6. 依赖政策local-only-no-silent-download：只检测/路径/来源/诊断/手动准备，不引mise下载。
7. Usage完成真统计UI，增加事件可实测消息关联/时序；无定价、汇率、凭据归因数据保持null/unpriced。
8. 不接NAI生成API/点券/账号登录/中转/第三方词典，不取MOSS2.07GB全量，不内置ComfyUI。
9. 不建新runtime、第二会话库、第二Canvas存储，不以名称对齐改装Dockview。
10. Native recovery/replay/prewarm缺真实实现时明确unavailable/blocked，attach回放不冒充durable replay。
11. Comfy地址沿当前较新规则loopback HTTP/HTTPS与公网HTTPS，补DNS/目标绑定；不顺手开放局域网HTTP。
12. 外部阻塞登记版本/复现/影响/解除条件；计划批准不自动接受尚未实现能力。

## 2. P0：快照、范围台账、状态纠偏

文件：`.agent/PLAN.md`、`STATE.md`、`GATES.md`、`MIGRATION_MATRIX.md`、`DECISIONS.md`；新增`.agent/feature-scope.json`、`src/shared/cherry-product-scope.ts`、执行记录目录。
- [ ] 保存HEAD/branch/完整diff/untracked清单、源码配置资产快照；归档旧PLAN到`.agent/history/2026-11-06/PLAN-before-sol.md`。
- [ ] STATE改成当前事实摘要，旧记录转历史；旧验收绑定原样保留。
- [ ] 稳定ID：Cherry原79序号、NovelAI原A1-L6、MOSS/Comfy/Workspace/runtime命名ID。
- [ ] feature-scope条目含id/disposition/taskId/capabilityStatus/evidence/unblockCondition/manualAcceptance；disposition required/reference/excluded/external-blocked与迁移status分开。
- [ ] 从同一manifest生成/校验产品曝光表；nav/search/deep-link在S1统一消费。
- [ ] 67个采纳ID恰出现一次，18后备/9排除保留；每Cherry条目有处置；重算缺口而非永久断言57/65/144。
验证：`git --no-optional-locks status --short`、`npm run check:migration-matrix`、`node scripts/check-evidence-paths.mjs`，新增scope测试。

## 3. P1：真实图片与素材删除保护

文件：`image-asset.service.ts`、`novelai-asset.service.ts`、`media.service.ts`、`ipc/images.ipc.ts`、`NovelAIAssetPanel.tsx`；新增`src/main/services/image-deletion.integration.test.ts`。真实入口补查media IPC、library批量与清理路径。
- [x] RED：图片被两版本引用时调用真正删除入口，DB/文件均保持。
- [x] 图库/Media/Files/副本清理入口同一检查，任何文件变化前完成；单删/批量/清理/永久删除覆盖。版本purgeMany归N2。
- [x] 批量先完整预检；引用失败零部分删除。受引用素材先预览/确认，并exact usage snapshot防新引用越过确认。
- [x] 外链原图保留，共享hash/path托管图在最后引用消失前保留。
- [x] 文件清理失败结构化返回、索引可重试；Canvas末端也await真实完成才success，不吞错。证据records/2026-11-06-sol-execution/P1.md与最新gates21-02-06-412Z（非最终3连/人工）。
验证：`npx vitest run src/main/services/image-deletion.integration.test.ts src/main/services/novelai-asset.service.test.ts src/main/services/media.service.test.ts`。

## 4. P2：Comfy重试与调度

文件：`task-runner.ts`、`task-repository.ts`、`task-state.ts`；新增runner/repository测试。
- [x] RED复现running→retryTask和异常后下一项不调度；fake timers、真实仓库/受控client验证。
- [x] 仓库原子失败/退避和status/retry_count CAS；提交成功后广播，不绕failed-only状态机。
- [x] 取消/终态优先；POST结果不明及已提交查询失败不重POST。真实网络positiveAuto由C1持久身份后验证。
- [x] 唯一tracked Promise/timer与stop/drain；毒行观察后冷却、pending settlement-only重写恢复终态、不重业务；长异常真实logger边界保身份。
- [x] 1/2/4…最高30s与max retries、重开deadline、FIFO保持；119focused和完整gates23-16-04-262Z通过（非最终3连/live/人工）。
必测：暂时失败后成功、不可重试/达到上限、退避重启、取消竞态、仓库写失败、坏任务不阻塞下一项、stopAndWait清理。
验证：`npx vitest run src/main/services/task-state.test.ts src/main/services/task-runner.test.ts src/main/services/task-repository.test.ts`。

## 5. C1：持久prompt身份、阶段重试、目标化取消

文件：database/shared task types/repository/runner/comfy-client/TasksPanel；新增database.comfy-execution测试。
存储：现task_jobs新增nullable execution_json（不建任务副库）。
```ts
type ComfyExecutionState = {
  version: 1
  endpoint: string
  phase: 'prepared'|'submitting'|'waiting'|'importing'|'submit-uncertain'
  requestedPromptId: string|null
  promptId: string|null
  cancelOutcome: 'none'|'remote-confirmed'|'local-only'|'failed'
}
```
- [x] 首次冻结endpoint/input，中途配置不换正在运行的服务。
- [x] POST成功立即持久promptId；history/download失败只续读/取回，不再次生成。
- [x] POST结果不明记COMFY_SUBMIT_UNCERTAIN；有可核实ID先查队列/历史，未证实不承诺exactly-once。
- [x] 重启恢复有promptId的Comfy查询，旧无身份任务明确中断；WD14维持既有恢复政策。
- [x] 复用Cherry取消语义：pending按ID队列删除；running仅服务证明targeted interrupt时发送prompt_id（源门槛0.3.57），未知/旧版不发全局interrupt。
- [x] local-only和remote-confirmed分开呈现，不伪远端取消；导入与关系幂等，部分逐图结果、全失败不成功。
验证：C1数据库/runner/repository/client focused；重开保持ID/endpoint/退避，POST次数准确，取消不影响其他prompt，下载重试不出新图。
阶段出口：[C1-final-stage](records/2026-11-06-sol-execution/C1-final-stage.json)，本轮16files/362pass、69694ms，14项完整记录与636393b3…构建全部字节复核；真实Electron任务/IPC/UI fixture verified。初始页面本轮停about:blank，显式同target Page.navigate与selfStartupVerified=false如实记录；最终ROOT-3X/用户服务/人工移交V1/V2/V3，不计为通过。

## 6. C2：HTTP/DNS/超时/错误合同

文件：input-validation/comfy-client/settings IPC/index；新增comfy-http.transport及test。
- [ ] URL禁凭据/无关scheme；公网hostname解析全A/AAAA，任一不满足规则阻止；localhost验证loopback。
- [ ] 主进程Node HTTP/HTTPS受控lookup绑定已验证IP，保留hostname Host/SNI/证书验证，不借未控proxy越界。
- [ ] 手动redirect最多3次、同origin每次复验；image仍限配置服务/view。
- [ ] 实际stream JSON 10MiB、图片100MiB；header不替代限额；fetch/body/parse共超时，body Promise结束前不清timer。
- [ ] 错误码TIMEOUT/TRANSPORT/HTTP_status/BAD_RESPONSE/RESPONSE_TOO_LARGE/WORKFLOW_INVALID/EXECUTION_FAILED/IMAGE_IMPORT_ERROR/SUBMIT_UNCERTAIN。
- [ ] user cancel非故障；429/5xx重试需C1阶段决定；坏JSON/超限/缺节点不自动network retry。
必测公私混DNS/mapped IPv6/DNS变化/跨originredirect/慢body/无长度超大body/HTML错误/abort/TLS/timer清理。
验证：`npx vitest run src/main/services/comfy-http.transport.test.ts src/main/services/input-validation.test.ts src/main/services/comfy-client.test.ts src/main/ipc/settings.ipc.test.ts`。

## 7. C3：直接适配源转换器/工作流发现/节点

只读源：Cherry `src/main/ai/provider/custom/comfyui/uiToApiPrompt.ts`（882行）、WorkflowDiscovery、Transport。
文件：comfy-workflow.core/service/client、comfy IPC、ComfyUIPanel；新增`src/integrations/cherry/comfy-workflow-adapter.ts`与test。
- [ ] 完整读源后直接导入纯转换函数；现API prompt校验/绑定/DB保持。
- [ ] 源语料验证subgraph/promoted/Reroute/Primitive/mute/bypass/widget顺序/control_after_generate/dynamic/seed/target。
- [ ] 前置限10MiB/5000nodes/32深度，检测cycle；warnings可见，语义缺链/循环/不确定映射阻止提交，非丢坏节点凑成功。
- [ ] 远端/v2/userdata?path=workflows列目录，/userdata编码路径读回；嵌套保持、穿越阻止；失败不伪空列表。
- [ ] object_info来源的模型/节点能力；三个quick family只是已验模板，非全部服务能力。
验证：adapter/core/service/client测试，旧API JSON不回退，标准源语料一致，不宣称任意未知自定义前端扩展都支持。

## 8. W1：现CAS草稿、dirty、编辑租约

文件：WorkspaceEditorHost/editor-types/workspace IPC/shared/preload/global；新增novelai-edit-session.service/test、Host/IPC测试。
- [ ] workspace_editor_states唯一草稿持久真相，不另建novelai_draft副表。
- [ ] loading/ready/error、dirty、local seq/base revision明确，key切换隔离旧值。
- [ ] flush(reason)结果saved(revision)/conflict(remote+保留本地)/error(code/message)，取代隐因boolean。
- [ ] 迟load/broadcast/ack不回滚新状态；dirty收到新rev保留并冲突，不覆盖。
- [ ] 主进程work/asset租约30s/10s心跳，owner来自IPC sender/runtime session；destroy释放。
- [ ] domain和editor revision独立；Agent碰用户编辑报EDIT_LOCKED，旧rev报REVISION_CONFLICT。
- [ ] 移动同key，复制新editorId；保持5MiB，超限保原画面。
验证Host/IPC/lease/workspace测试。

## 9. W2：窗口/Canvas flush-hydrate-ready移交

文件：FixedWorkspace/WorkspacePopout/PanelRegistry/index、CanvasVendorPanel、NovelAIPromptPanel、SettingsWindow；新增editor-transfer类型/Canvas测试。
流程：冻结原编辑→await flush→main签transferId/editorKey/revision→隐藏目标→hydrate≥rev+ready→转owner→原卸载→目标显示。
- [ ] 双击/按钮/返回/原生close统一；不依赖异步beforeunload。
- [ ] 10s超时/crash/冲突/写盘失败撤销，原窗口内容+owner保留。
- [ ] NovelAI正文/负面/角色/unknown metadata/版本选择以work隔离，load不盖dirty。
- [ ] 旧prompt复用store；设置仅搜索/展开/选择，秘密不存草稿。
- [ ] CanvasVendorPanel iframe校验source/schema/requestId；排空现Canvas保存queue后回project/rev/视口/选择，业务文档不复制到workspace。
- [ ] 无有效adapter不宣称无损popout。
验证双窗未保存→弹出→编辑→返回→关闭重开/重启字段一致；竞态、启动失败、IME；Host/editor/Canvas/NovelAI/Settings测试。

## 10. N1：块/完整文档/多角色/池/撤销

文件prompt-blocks/novelai-organize/prompts.store/NovelAIPromptPanel；新增prompt-block-edit、novelai-document、novelai-draft.store与tests。勾选=实现已入并有用例，不等于阶段出口通过。
- [x] draft版本化：primary raw/negative/characters稳定ID与正负raw/blockMeta/pools/quality/generation/unknown/provenance（novelai-document.ts；Panel.document 迁移用例；store v2槽位）。
- [x] raw权威、树派生；label/layout不隐混raw，无编辑逐字符保真（document 用例“block names and own-line layout outside raw”；raw-input CRLF/代理对用例）。
- [x] edit验证syntax+expectedText/range，坏括号/歧义/旧索引零改（prompt-block-edit.test 27用例：INVALID_SYNTAX/STALE_TEXT/INVALID_RANGE/AMBIGUOUS_EDIT 均零写）。
- [x] NAI{}[]5%与旧1.1体系明确区分；旧store纯能力优先复用（prompt-blocks.test；5%入参独立于1.1加权）。
- [x] 多角色/负面/quality幂等；随机池解析与抽样分开，每次一个、seed复现、空未知报错（document 多角色独立正负、seeded预览用例；organize 幂等用例）。
- [x] transaction按user/agent分组，独立撤agent区域先匹配，冲突不覆盖后续用户编辑（draft.store：100组上限+实际delta、selective Agent undo 保留后续输入）。
- 阶段出口pending：原生多角色/负面/unknown/历史经popout→返回→reload→新进程、A1–A10/B1/B3–B5逐ID证据、不可变stage收据、人工接受。11/26已完成：双端tsc复绿（exit0）、聚焦134tests（exit0）、完整G1–G14同构建全绿（complete=true/failed=[]/buildStable=true/551377ms，构建`2f397ee6…`，根测试239files/2473passed/2skipped）、vendor source 9639文件对P0基线逐字节一致；回执见records/2026-11-06-sol-execution/commands/N1-*-2026-11-26*与`N1-full-gates-2026-11-26T16-15-50-144Z.json`。

## 11. N2：全版本快照/自动checkpoint/全写入口CAS

文件database/version.service/novelai IPC/preload/shared/Panel与version/lifecycle tests。
- [ ] 版本新增document_json存N1非主raw，snapshot保持主raw；旧meta用明确空默认不猜。
- [ ] 编辑事务自动checkpoint：compositionend后800ms静默或明确操作，非每键一版。
- [ ] flush草稿与业务存版分开，移交不增版，raw+document全同不生空版。
- [ ] 负面/角色/参数变化也版本化，operation说明可编辑，默认来自实际diff。
- [ ] 所有create/rename/branch/restore/purge/batch需work/rev/lease；parent/branch同work。
- [ ] 全量预检一个事务一轮rev，中途错整体回滚；purge只已回收且无后代/引用违规。
验证version/lifecycle/lease、真实--workbench。

## 12. N3：图库生命周期/共用图/导入/导航

文件database/media/gallery/image/version/asset services、images IPC、GallerySearchPanel/NovelAIPromptPanel；新增novelai-image.service/test。
- [ ] 复用image_refs/media_assets；新增collection/member、trash ledger，canonical imageRefId。
- [ ] 共用图三选一：仅当前work解除、图库回收站、取消；不影响别work，不删原文件。
- [ ] 图库/版本回收站区分；恢复原关系，purge走P1，软删版本引用仍保护。
- [ ] 图→所属作品全部版本真实UI导航，Inspector保留。
- [ ] scan/drop/clipboard现导入服务再建关联，取消/坏文件/重复/symlink边界。
- [ ] 复用favorite/rating/tags/sorts/thumb，测试cache失效不reload凑效。
验证novelai-image/media/gallery/folder-scan/thumbnail/image-deletion + --gallery。

## 13. N4：素材插入/实际次数/自动归因

文件database/asset.service/novelai IPC/AssetPanel/PromptPanel与tests。
- [ ] payload版本化block/character/random-pool，旧kind/string可读；新增revision保护内容写。
- [ ] insert需draft revision+transactionId，复用N1事务；重放幂等、撤销活动计数。
- [ ] insertionCount≠imageReferenceCount，逐列呈现。
- [ ] provenance随冻结generation交C5，成功自动连image/version/asset，不再靠手填图ID。
- [ ] 删除预览使用情况+确认，生成作品可追溯。
验证asset/AssetPanel/PromptPanel + --assets。

## 14. N5：双语/翻译回落/人工覆盖

文件tag-intelligence/tags IPC/PromptPanel；新增novelai-language shared/service/test。
- [ ] 人工→现local/builtin→配置翻译源→有证据规则→provider；缺层skipped、失败不空译成功。
- [ ] tags.zh复用；段落覆盖text hash+语言小表，不复制词典。
- [ ] 每块source/status/text/error，批次部分失败可见，人工覆盖默认保留。
- [ ] 双语不改英文raw，中文→英文须提案接受；权重/引号/池不乱；stale回包弃并提示。
验证language/tag-intelligence/Panel。

## 15. N6：AI整理/命名/译改JSON提案与真测

文件organize-provider/service/shared/novelai IPC/PromptPanel与tests。
- [ ] kind=organize/name/translate/rewrite，按kind校验返回；稳定JSON不任意exec。
- [ ] active provider/model现key只main读取；requestId/rev/digest，60s/256KiB，可取消。
- [ ] malformed/未知op/越界/重复冲突edits/stale均零写；organize护tag集合/weight，译改用明确异合同。
- [ ] before/after逐块接受/放弃，name限长preview，接受进N1。
- [ ] 外部小fixture先确认，记录model/protocol/id/时长/码无key；只试过协议才live。
验证organize-provider/service/shared/Panel。

## 16. N7：metadata/MOSS/主题回归

文件metadata/file/Panel、default-assets/local-protocol/MOSS JSON/PromptAssetsPanel。
- [ ] PNG全字段+unknown经draft/version/export/read一致，.meta.png兄弟文件原始像素/原文件保留；已存在询覆盖/新名，取消零写，非PNG明确能力状态。
- [ ] MOSS120+120/稳定IDs/96+24/重导0/dev-pack图可读；原版权NOTICE保留。
- [ ] demo103/108原条目+图保留标测试，不默认生成推荐；场景风格原文留并提示，不AI暗改、不删118凑数。
- [ ] 更新仅源拥有字段，保留用户副本/修改，目录收录与生成推荐分维度。
验证metadata/file/default-assets/protocol/prompt-browser/Panel tests。

## 17. C4：Comfy专用嵌入view

文件browser-host/cherry-data-api/index/BrowserPanel/ComfyPanel及tests。
- [ ] purpose=comfyui main策略，禁通用地址栏/history；隔离partition，导航/redirect/popup/download受endpoint约束。
- [ ] hostId含真实sender+editor，多实例不互关；scroll/move/drag/zoom/tab/max除ResizeObserver同步。
- [ ] menu/dialog覆盖隐藏view后恢复，close/crash清owned，loadURL错误与process gone可见回console+用户主动external-open。
- [ ] 真实Electron1600/1280/960、缩放、两实例、popout/遮挡，不以组件测试替代。
验证browser-host/ComfyPanel、layout、--error-paths。

## 18. C5：生成快照/图生图/每图seed/关联

文件quick-workflow/comfy IPC/repository/runner/两个Panel；新增generation-preview.service/test、comfy.ipc.test。
- [ ] preview冻结work/version/rev/workflow/model/allparams/provenance/每图seed，main存5min单用owner+digest确认。
- [ ] 改草稿/模型/workflow使旧确认失效，确认前零submit，重确认不多task。
- [ ] batch≤16，fixed/increment/random seed创建时定且重试保持；重新生成是新操作。
- [ ] imageRefId+strength0..1，经main upload+已验workflow；缺LoadImage/denoise预检失败，denoise1不冒称i2i。
- [ ] switch model能力复验，参数不兼容可见；成功事务连冻结version/work/assets，后来切页面不改归属。
- [ ] failed/cancel沿C1/2，成本unknown不伪金额。
验证preview/comfyIPC/core/runner/asset + --comfy-persist。

## 19. T1：工具域/预演确认/命令面板

文件tools/grimoire-tools、ai/agent/novelai IPC；新增tool-catalog、tool-preview.service/test、ToolCommandPanel。
- [ ] 本地完整registry，模型schema按域load：prompt/tag/image/canvas/workspace/settings/MCP/task；chat默认prompt/tag，Agent可发现；page20摘要+句柄不图本体。
- [ ] NovelAI tools读/提案/writeVersion复用领域lease/rev；agent新version仅通知不抢画面。
- [ ] 写删批量设置生成preview token绑定sender/session/params/rev，一次消费；command panel同catalog/forms/confirm/execute，不第二业务实现。
- [ ] 执行时仍permission+schema验证；实际token/bytes测量不沿用约600硬断言。
验证tools/preview/lease/runtime-turn。

## 20. S1：设置真实操作/本地数据依赖/Usage

文件scope/compat routes/source settings/entry、SettingsWindow、prompt-browser/usage/binary-tools/cherryDataApi/database；新增PromptVisibility.integration。
- [ ] nav/search/deep-link同scope，被裁不mount effects；provider/model/MCP source真操作+跨窗刷新，缺consumer明确。
- [ ] visibility UI restricted绑定→global取消无写→确认清，另窗改bind409保输入+重拉；builtin/import保护。
- [ ] 复用DBexport/import注明非媒体全备份；staging/integrity/before-import/回滚/refresh。
- [ ] dependencies只bundled/PATH/none区分unknown/absent，不给假安装动作。
- [ ] Usage读模型不重造，新nullable message-kind/request identity/timing仅真实事件填；历史不猜、请求多事件幂等，取消无first-token空值、cost无价null。
验证prompt-browser/usage/binary/IPC/database.lifecycle/Settings及compat route/source/actions/visibility/null。

## 21. S2：主题品牌/旧AI入口/布局兼容

文件tokens/theme-bridge/theme IPC/index/compat主题与About/QuickUtility/AIWindow/Registry及tests。
- [ ] 应用resolved palette首帧来源，色格式规范化/rev/迟覆盖/invalid保护，代码/Diff/charts/dialog/empty真测。
- [ ] 品牌只host/compat/resources；署名许可保留；一层改不全重排UI。
- [ ] 常用统一Cherry，旧openAI/panelTypes/keys一版本周期alias且session不变；AIWindow共享wrapper不误删。
- [ ] 不借任务换docking engine。视觉baseline差异先图+理由后用户接受，非重新录掩回归。
验证theme/QuickUtility/AgentPanel/workspace、verify:themes:all、style-contract、verify:visual。

## 22. R1：runtime合同回归与外部缺口

文件capabilities/registry/permission/reference/prewarm/ai IPC/agent IPC/stream script。
- [ ] owner/session/action/pattern、once/deny/session explicit区分且native仅once/reject。
- [ ] provider-model切换/cancel/EOF/timeout/windowclose/native ref/terminal once；UI读capability非runtime名。
- [ ] 有界attach/持久resume/native durable replay分开；v2 admission probe不是execution。
- [ ] Pi RPC默认SDK gated，prewarm/recovery无实现有真状态；blocked版本/命令/解除记录，无新恢复引擎。
验证capabilities/permission/reference/prewarm/runtime-turn、smoke:stream、opencode grant/v2；缺二进制/provider环境标live blocked。

## 23. 数据迁移公共合同

1. 当前40起顺序+1，每任务已实现迁移才写号；备份失败停，migration失败不晋version。
2. nullable/versioned JSON旧默认明示，不猜历史身份。task读取显式列而非SELECT*位置。
3. CAS批量全预检所属/rev/ref/permission后事务；new图库/usage等仅关系，原image/Canvas真相不变。
4. IPC四端同步：shared、preload自包含channels、renderer types、main handler；DTO不秘钥/owner token。
5. main访问路径不信renderer任意路径。file和DB非原子，用保护预检+阶段结果+可追踪重试，失败不默删索引。
6. 每migration测old→new/reopen/idempotence/future schema/failure rollback/oldrows保持。

## 24. 67采纳覆盖（逐ID证据，不只勾包）

| ID集合 | 数量 | 归属 |
|---|---:|---|
| A1-A9 | 9 | N1 |
| A10,B1,B3,B4,B5,L1 | 6 | W1/W2/N1 |
| E1-E8 | 8 | N2 |
| E9,F1-F10,K1,K2 | 13 | P1/N3 |
| G1-G4,G6,G7 | 6 | N4 |
| B6,B7,H1,H3,H4,H5,I5 | 7 | N5 |
| B8,I2,I3,I4 | 4 | N6 |
| J3-J6 | 4 | W1/N2/T1 |
| C1-C3,D1,D2,D6,D7 | 7 | C1-C5 |
| K3,K4,L5 | 3 | N7/S2 |
| 合计 | 67 | 每项code/auto/functional/manual或具体external blocker |
MOSS/Cherry/Workspace/runtime另命名ID，不占67。

## 25. V1：冻结同构建验收编排

文件m5-acceptance/evidence/final-aggregate/index、journeys/evidence、secrets和tests；新增m5-finalize/test。
当前测试→pack再buildB会漂移；改编排不放宽合同。
顺序：功能focused/live→先buildB再fresh packA→freeze source/config/lock/data、dist、B全目录、asar、scope/matrix→G1-G14且G6字节稳定（变化失败定位）→root3x独立meta→25顶层原ID旅程+新增required子项→prebuiltB smoke/A-B/pack verify/packaged/capture/index→secrets/final aggregate→最终报告扫描独立final-seal.json绑定report/scan/build/scope（之后不重写被扫描报告）。
- [ ] 保留10自动组但严格子项，不旧8项workbench冒覆盖全部。
- [ ] 一个runId显式本轮证据路径不混latest，index写入不误称audit-only。
- [ ] scope排除只改required集合不抹状态；真失败/旧hash仍红，预算耗尽按合同续跑，owned PID/profile清理不kill全Electron。
- [ ] 负例缺gate/root/24journeys/required子项、换asar/dist/混old截图matrix/改final都失败。
验证`node --test scripts/m5-evidence.test.mjs scripts/m5-contracts.test.mjs scripts/m5-delivery-acceptance.test.mjs scripts/m5-layered-acceptance.test.mjs scripts/m5-finalize.test.mjs scripts/check-secrets.test.mjs`。

## 26. V2：全量自动验收与打包启动

freeze后不继续改产物，执行V1更新后的：
```bash
npm run verify:full
npm run acceptance:final
node scripts/m5-finalize.mjs
```
若full已编排末两步，独立命令仅复核不重build。核对G1/2/3x3/4/5自有0-source棘轮、G6稳定、G7-14、25journeys/required子项、MOSS/PNG/Canvas/Comfy真content、全部asar-dist一致/版权runtime资源、隔离packaged启动/preload/routes/settings/PNG/clean、forcedNavigation明示不替代自启动体验、secrets final封口、old DB副本/new profile新迁移；不用真实用户库试验。

## 27. V3：人工验收与交付

交应用路径/启动说明、aggregate/seal/build-scope hash、保留范围截图操作清单、67逐ID证据、external blocker影响解除、本地DB备份非媒体全备份说明。
人工至少：主题密度窄窗品牌；draft弹出返回重启；auto version/branch/Agent冲突；共用图三选一trash/purge；asset插入→gen→反查；Comfy导入/i2i/seeds/queue-retry-cancel-offline；model/MCP/visibility。
manualAcceptance/blocked接受/fullPlanComplete只依用户明确选择且绑定当前build/scope/matrix；旧接受保持历史，不改hash接新build。

## 28. 统一质量与交接

每功能focused后至少：
```bash
npx tsc --noEmit -p tsconfig.json
npx tsc -p tsconfig.node.json --noEmit
npm run check:migration-matrix
node scripts/check-panel-layout.mjs
node scripts/check-ipc-coverage.mjs
```
compat改动另focused+check-compat-types；阶段完整gates，不每行完整build。
四维implementation pending/implemented；automated pending/pass/fail；functional pending/fixture/live/blocked；manual pending/accepted/changes-requested，不取代matrix状态。
完整交付：required全部实现/证据/67无漏；external具体且用户接受前不宣布全完成；10groups+子项同build；用户人工接受；旧tag/prompt/image/WD14/Canvas/provider/session/workspace零已知回退；无吞错假成功/假零/删用户数据/放宽测试换绿。
每续作交接：Task ID、合同、改文件、command/exit/duration/attempt、build/input hash、UI/live证据、剩余和下一前置。
记住：schema40非36；POST≠GET重试；flush≠新version；ref护真实delete；67逐ID；gate≠functional≠manual。
