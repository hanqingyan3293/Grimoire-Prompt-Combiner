# Grimoire 当前状态（单一事实源）

> 更新：2026-11-26（America/Los_Angeles）。完整目标仍 active；W2完整阶段已验证，当前执行N1。命令收据使用UTC。
> 计划：[PLAN.md](PLAN.md)；合同：[SPEC.md](SPEC.md)；门禁：[GATES.md](GATES.md)；能力：[MIGRATION_MATRIX.md](MIGRATION_MATRIX.md)；决策：[DECISIONS.md](DECISIONS.md)。

## 1. 当前执行位置

- P0、P1、P2、C1、C2、C3、W1、W2已完成各自的阶段出口；这些阶段证据不替代最终同构建验收。
- 当前任务N1：块编辑、完整草稿、多角色、随机池和事务撤销。N2之后仍pending；完整计划和用户人工接受未完成。
- N1纯合同与生产UI已接现Host v2 work slots，旧v1显式转换；[11/16复审](records/2026-11-06-sol-execution/N1-review-2026-11-16.md)保留重复文本/字段ABA/原子撤销等RED与修复。11/26修掉11/16末次编辑遗留的类型收窄缺陷（`prompt-raw-input.ts`布尔别名改typed `anchor`）：双端tsc RED（exit2，3处TS18048）→GREEN（renderer 18491ms／main 9889ms，exit0），聚焦9files/134tests exit0/7226ms，vendor source 9639文件/85193788字节对P0基线逐字节一致（missing 0、mismatched 0）。原生往返/重启、逐ID证据与不可变stage收据仍pending；11/15那轮G1–G14与下面的W2构建只是历史证据，不能顶替本构建。
- 11/26完整G1–G14对本构建全绿：complete=true、failed=[]、buildStable=true、551377ms；构建combinedSha256 `2f397ee6c2cfc00f35a31bf5f97260e81e5dce5f87cefece4375a33c31c81820`（3928文件/90385124字节）；根测试239files/2473passed/2skipped（三shard 80/80/79，G3 365.3s、G4 27.5s、G5 57.6s、G11 34.4s）。回执`commands/N1-full-gates-2026-11-26T16-15-50-144Z.json`，快照`artifacts/gates-2026-11-26T16-25-01-498Z.json`。这是N1当前源码第一轮同构建全量自动门，未计最终ROOT-3X，不等于人工接受。
- 11/26其余回执：`commands/N1-type-narrowing-red-2026-11-26T16-11-24-923Z.json`、`N1-renderer-types-green-2026-11-26T16-12-01-619Z.json`、`N1-main-types-green-2026-11-26T16-12-20-397Z.json`、`N1-focused-green-2026-11-26T16-12-32-177Z.json`、`N1-doc-gates-green-2026-11-26T16-13-15-018Z.json`、`N1-types-build-gates-green-2026-11-26T16-14-40-452Z.json`、`N1-vendor-audit-2026-11-26T16-16-16-458Z.json`；首次build-gates因dist早于源改动被BUILD-STABLE判红，原样保留为`N1-types-build-gates-attempt-2026-11-26T16-13-24-209Z.json`，rebuild后stable=true。
- 11/26界面收口（用户6条）：设置改双栏 page 语义并修掉「只滚动不变色」根因；提示词资产改紧凑卡片网格、浏览取全量修掉空类目；资产分类改9个固定货架+合并根（标记v10）；`tag-batch`并入「标签与资产」第4页签并留旧布局别名；自有源码零emoji（lucide替换+插件图标映射）；全站字体改更纱黑体UI（local()不打包）；圆角全站≤5px且G11契约同步。细节见[D-UI-01](DECISIONS.md)，截图见`records/2026-11-06-sol-execution/ui-2026-11-26/`。此段只改界面层，未动N1合同、vendor源码或数据库schema。
- 11/26界面收口后的完整G1–G14全绿：complete=true、failed=[]、buildStable=true、573882ms；构建`ad2031863d5008ccfcc1a3f84348192d9cd705dd8ae3f8dd5468cdf6643c5680`（3929文件）；根测试239files/2474passed/2skipped（657+968+849）。回执`commands/ui-overhaul-full-gates-v3-2026-11-26T17-45-38-803Z.json`，快照`artifacts/gates-2026-11-26T17-55-12-748Z.json`。前两次attempt（G11失败、随后BUILD-STABLE因dist早于源改动判红）原样保留为`ui-overhaul-full-gates-*`与`ui-style-contract-green`，不删不改。
- 11/26发版准备（**v0.7.3-alpha**）：版本号定为`0.7.3-alpha`（`1.7.2.1-alpha`四段非合法semver，见D-REL-02），UI/README/MCP clientInfo/产物名全部同步；字体按D-UI-02**不再随包分发**（删`public/fonts`、`fonts.ts`、`asarUnpack`，保留`local()`探测，本机已装仍生效，`document.fonts.check`实测true）。新增首帧白窗自动重载兜底（最多2次）。产物：`release/Grimoire.Setup.0.7.3-alpha.exe` 252.3MB、`release/Grimoire.0.7.3-alpha.exe` 252.1MB、`release/Grimoire-portable-0.7.3-alpha.zip` 366.1MB、`release/SHA256SUMS-0.7.3-alpha.txt`；打包回执`commands/release-pack-0.7.3-alpha-2026-11-27T00-34-11-189Z.json`。`win-unpacked`实机验证：标题`魔导书 Grimoire`、`file://`正文3.1M字符、状态栏`v0.7.3-alpha`、包内确认无字体文件。截图5张按新版本号重拍（`docs/screenshots/`）。**未** commit/tag/push，**未**点完NSIS安装流程。
- W2当前[完整阶段收据](records/2026-11-06-sol-execution/W2-final-stage-v2.json)绑定构建09c42ad17cbd70c98338bd6cd99496f1c2e35b666c3dba939f6d4467528f5fe6、3916个文件、schema42。
- 历史（W2构建）：11/15的[完整G1–G14](../artifacts/gates-2026-11-15T19-26-13-176Z.json)全部exit0、failed为空、buildStable=true，577630ms；根测试234files/2380passed/2skipped。该轮绑定W2构建，不作N1证据。
- 历史（W2阶段收据）：9639个vendor/source文件逐字节复核不变；51个原生场景通过（21适配器/往返/主窗reload/重启种子，8跨进程恢复/页面close/原生close，20失败/IME/只读SQLite/退出排空拒绝，2Canvas冲突后thaw及计时器排空），console errors为空。阶段人工manualAcceptance=pending；旧分层接受只绑定原构建，不自动覆盖本构建。
- 9639个vendor/source文件逐字节复核不变。阶段人工manualAcceptance=pending；旧分层接受只绑定原构建，不自动覆盖本构建。

## 2. W2复审修复范围

- [复审记录](records/2026-11-06-sol-execution/W2-review-2026-11-15.md)保留全部RED、失败原生运行和GREEN，旧11/11收据保持历史。
- Canvas缓存记录实际ACK基线，缺少或过期基线保留副本并阻写；自动保存、viewport和移交共用真实base校验。自身ACK单独通知，迟读取不能回降已确认基线。
- Canvas冲突后的thaw不再覆写远端。错误可见，可导出当前本地内容；显式确认读取远端先完成读与本地变化校验，再替换当前副本。
- Legacy提示词共享冻结持有者和权限响应代次；迟ACK和已卸载freeze不再解锁或锁死新视图。Host绑定具体adapter代次，只释放自己的freeze；旧任务不能移交新页面。
- Main frame跨文档导航使旧READY失效；初次目标页面尚未commit时允许初始化。重启恢复保留open意图/ID/bounds，等真实源Host就绪后复用正式协议；未激活工作区在选中后恢复。
- isPopoutOpen只读IPC已接四端，主窗reload保留仍存活的弹窗；恢复意图撤销后零prepare。
- 退出排空失败恢复关闭保护。已提交弹窗的页面window.close映射至保存后返回；原生BrowserWindow.close仍由main协议处理。重启验证分别覆盖两种路径。

## 3. 剩余工作与证据边界

- N1完整文档/多角色/原文安全编辑/seeded池抽样/Agent区域撤销已生产接入；11/26补齐新构建、完整G1–G14与vendor字节复核，剩余同构建原生往返/重启证据、A1–A10/B1/B3–B5逐ID证据、不可变stage收据与人工接受，不能以focused（11/26为9files/134tests）替代。
- N2完整版本document_json/自动800ms checkpoint/全写入口事务CAS待实现；数据库下一迁移从实际42+1开始。
- N3图库生命周期、N4素材插入与自动归因、N5翻译、N6外部AI真测、N7元数据/MOSS、C4专用网页、C5冻结生成、T1工具命令、S1设置/Usage、S2主题品牌、R1运行时、V1–V3最终验收均未因W2通过而宣布完成。
- 间歇about:blank及Chromium网络服务问题仍记录为S2/V2调查项；强制导航已逐报告明示，不能冒充自主启动验证。
- 最终同构建ROOT-3X、25旅程及required子项、B/pack/ASAR/启动/截图/秘密扫描/final seal尚待V1/V2。人工及external blocker接受只依用户绑定当前构建的明确选择。

## 4. 工作树与恢复点

- 分支work/2026-10-27-m0，HEAD be75c84b0c7307367a08b842d55e00f30d129774；保留原用户工作树，无commit/push/reset/checkout/clean。工作树未提交改动125个已跟踪文件（+9706/−5596）加150个新文件，均属用户基线。
- 新增证据工具[record-command.mjs](records/2026-11-06-sol-execution/record-command.mjs)：只包一条命令并写`commands/<label>-<UTC>.{json,stdout,stderr}`回执（含双流SHA256），不触碰源码、不增删数据。新增手动启动工具[launch-dist.mjs](../scripts/launch-dist.mjs)：静态服务`dist/renderer`并指向它启动Electron（未打包时`electron .`会回落localhost:5173），带首导航about:blank自动兜底；本机`ELECTRON_RUN_AS_NODE=1`会让`npm run dev`/`start`把Electron当Node跑，需先清空该变量。
- 原P0快照见[baseline](records/2026-11-06-sol-execution/baseline.json)。11/15续作快照覆盖14163路径、逐文件副本、binary diff/status；[复核收据](records/2026-11-06-sol-execution/resume-2026-11-15T15-57-56-454Z.json)含绝对备份路径和SHA256。
- 旧状态逐字归档：[11/15前累计状态](history/2026-11-15/STATE-before-W2-review-closure.md)、[11/06前账本](history/2026-11-06/STATE-before-sol.md)。历史不作当前通过证据。
- 当前SQLite schema42；W2未新增库/Canvas副本/版本迁移。Native使用自有隔离profile；restart复制种子profile，未拿真实用户库实验。

## 5. 固定范围与合同

- feature-scope稳定195项：Cherry79、NovelAI94（67required/18reference/9excluded）、其他22；capabilityStatus按原子证据评估，任务完成不能自动给67项全绿。
- A compat默认、B独立；模型/供应商/MCP列表详情保留；四个待定设置页隐藏策略归S1；设置为工作区面板可独立，昼夜/色轮/#a855f7保留。
- Source优先复用/包装/适配；NovelAI已有行为规格重写例外；vendor/source只读。UI→应用合同→adapter/service→Grimoire SQLite。
- 保留tag/prompt/image/WD14/Canvas/provider/session/workspace；数据备份只承诺现数据库，不扩云备份/完整媒体备份、NAI官方生成、外来词典、MOSS全量、内置Comfy、第二库或新runtime。
- OpenCode/Pi原生recovery/replay/prewarm缺实现保持unavailable/blocked；attach回放不冒称durable replay，Pi RPC默认、SDK gated，许可once/deny/session边界保持。
- 冷启动≤5s、4000+标签搜索≤150ms、10万资产筛选≤500ms、1000节点Canvas≥45FPS及100–200%缩放仍待最终实测。
