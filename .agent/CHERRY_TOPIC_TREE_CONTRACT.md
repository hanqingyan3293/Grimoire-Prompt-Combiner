# P1 Topic tree 契约核对

源参考：Cherry 2.1.4 shared/data/types/{topic,message}.ts、api/schemas/{topics,messages}.ts、main/data/services/{TopicService,MessageService}.ts。此为静态核对，不代表已实现。

## 源不变量

- 每条消息唯一归属 topic，parent 必须属于同一 topic。
- 每个独立 topic 有且只有一个无内容 root；root 不出现在 displayed/model history、不允许成为 active node。
- active 可以是内部节点；append 默认接 active 或 root，不隐式下钻到 leaf。
- 显式 parent=null 为首轮；explicit node 必须同 topic。setAsActive=false 保持 selection。
- edit-and-resend 是创建 sibling，保留旧节点/子树；in-place update 是独立操作。
- duplicate 是复制 root→指定节点路径到新 Topic，fresh IDs/root、重映射 parent、排除 sibling/后代、pending→error；usage/trace 不复制。
- GET branch response 是 `{items,nextCursor,activeNodeId,rootId,assistantId}`；cursor 在当前 selected path 上 exclusive，off-path 拒绝。
- assistantId 是最后使用的助手，不等于 conversation store owner；助手删除不应删除 Topic history。

## 现有存储边界

- Grimoire ai_messages 按 session 拥有；ai_topics.session_id 是 legacy 关联，不证明消息属于 Topic。
- 两个 Topic 挂同 session 不得共享投影同一消息流，现有 501 拒绝仍正确。
- ai_topics.parent_id 是 Topic lineage，不复用为 message ancestry。
- 不从标题、sequence、单 Topic 数量或 metadata 猜历史消息归属。
- prefix legacy IDs 保留；新源树 UUID identity 必须单独设计，不能替换旧 row ID。

## 后续第一片建议与待落地

新独立 Topic opt-in 初始化状态 + topic-owned message/root/topology + persisted active node；全部仍在 Grimoire SQLite 中，不引入 vendor DB。选择 dedicated topic-message relation 是为了隔离源 root/status/branch 语义和 legacy flat session runtime readers，不能复制同一内容形成两套 truth。

第一片只支持真正初始化的独立 Topic 的 append/read/select/cursor；unresolved legacy Topic 保持 typed refusal。文件 part 需要专门 reference relation，不能借用 ai_attachments.message_id 指向不同表。先不接 runtime send、legacy conversion、siblings/reserve/duplicate。

验收必须覆盖旧表/JSON/sequence 无变更、同 session 两 Topic 隔离、one root、cross-topic parent/active 拒绝、内部节点 fork、cursor exclusive、query node 不改变 persisted active、故障 rollback。

实现前按 live schema 选版本、审阅 source validation/repository reuse 路径；此文件不预定版本、不宣称功能完成。
