# 完整导入闭包严格类型阻塞分析

2026-10-12；P0 执行证据补充。最新检查 277 条诊断、退出 2；数字随实际修复变化，原始证据 `artifacts/cherry-compat-strict-typecheck.log`。不能以 source 路径认定全是 upstream 错误。

## 根因与所属工作包

| 类别 | 实际缺失/问题 | 下一动作/所属阶段 |
|---|---|---|
| 已有 preload 声明漂移 | selectFolder/resolvePath/isPathInside/hasWritePermission；cache | 已同步真实声明，resolvePath 保留 nullable，不伪造可靠字符串 |
| 文件 caller 契约 | openPath/save 已新增真实 main 能力；getPhysicalPath/saveImage 等仍缺 | 单项核对已有 store/service 可复用路径，其余 P6；真实 OS/dialog 手测待做 |
| 备份/Nutstore | source backup API 有归档、远程传输、恢复、通知消费者，不能只导出 SQLite 或添加 ambient types | P7 sanitized archive/assets/staging/quiesce/rollback；未实施，不报支持 |
| 生成 route tree 与 router | routeTree.gen 缺失；真实 Link/Outlet/createRouter 与当前 shim 不等价 | P2 先恢复 owned router generation/provider closure；不能给 throwing Link 虚构可用类型 |
| native command popup | source CommandMenus 的 showNativePopupMenu 是 Electron 菜单材质，不是 Agent shell 执行 | 可分步复用 source popup/helper/payload，窗口/actions 尚需 P2/P5/P8 |
| preference shim | 写失败吞错、update options/typed cache 契约不全 | P0 独立 adapter 修复；不能忽略未知 options 然后声称 parity |
| 缺 SDK/协议包 | types-only 与运行时 import 区分，remote-protocol/selection 等需版本与许可核验 | 逐源版本/依赖补齐，不 wildcard declare module any |
| 真 upstream strictness | finite maps string indexing、ReadonlyMap/Record narrowing、编辑器未上下文化 callback 等 | read-only 源不改；先验证实际源构建配置与类型预期，再 source-faithful checked adapter；不得整体关闭 strict |

## 本轮已解决的依赖问题

- 六个真实 @types 包显式安装；CodeMirror 五个 direct imports 与 source/compat 解析同一图，新增 resolution regression test。
- 19 个 Tiptap 子包由 ^3.26.1 漂移到 3.31.4，已用 compat workspace 精确 override 回到源 3.26.1；不全局 pin y-tiptap 的不同版本系列。
- 当前 peer check 仍退出 1，剩余 react-spinners 0.14.1 要求 React <=18，安装 React 19.3.0。此与 Tiptap 清除结果分开记录。
- 源锁文件记录三处 Cherry Tiptap patches（drag-handle/list/markdown），现已从获准参考源码目录取得原始 patch，哈希一致，原样应用于 compat 并记录 NOTICE；53 个 unchanged source editor regressions + 3 provenance tests 通过。真实 drag/outer-scroll 手测仍归 P2/P5，不因版本/源码测试通过宣称完整 editor UI parity。

## 门禁政策保持

完整严格检查持续失败并公开；不排除 imported source、不 noCheck、不抑制诊断、不类型虚构。P0 不会标成“全门通过”。用户已在阶段门禁选择中明确批准“分层验收推进”：P0 验收准确清单、基线与已实现契约，完整 strict gate 保持失败并按 P1–P9 归属，最终必须通过。此为用户实际选择，不是子任务建议自动升级为授权。

P1 session attachment 约束：Cherry 的 MessageSnapshot 是每条消息的作者/模型身份，不是 session config snapshot；Cherry session attachments 从用户消息 FileUIPart/现有文件关系派生。任何 `data.agentSession.snapshot` 都必须标为 Grimoire adapter extension，不能声明 source parity；文件 metadata 关系需单独设计并保持 secret/path 边界。
