# 04 MOSS 默认资产摄入（120 条 + 120 图）

## 1. 数量核对（用户问过「是不是不止 120 条」）

| 项 | 事实 |
|---|---|
| 仓库里的提示词 | **120 条**（96 角色 + 24 风格），只有 `demo/catalog.json` 一个数据文件 |
| 完整收藏 | **34,251 条**（33,937 角色 + 314 风格），在 **2.07GB 的 Release 压缩包**里，不在仓库 |
| 示例图 | 120 张 webp，共 8.0MB，`demo/images/001..120.webp`，已剥离 EXIF/XMP |
| 用户决定 | **只留 120 条 + 120 图**，不下载全量 |

## 2. 数据形状

顶层是对象：`entries[]`（120 条）+ `runs`、`style_candidates`、`undo_count`、`visibility_mode` 等无关字段。

每条 19 个字段：`name`、`copyright`、`copy_prompt`、`copy_tags`、`kind`、`added_at`、`rendered_at`、`facets{character,copyright,hairColor,hairLength,eyeColor,gender,outfit}`、`id`、`key`、`run_id`、`demo_image`、`image_sha256`、`generated`、`hidden`、`deleted`、`favorite`、`similarity`、`source_count`。

特点：无权重、无负面提示词、无翻译字段、全英文；角色 prompt 高度模板化（`X from Y. A … character. Appearance: …`）。

## 3. 许可

- MIT © 2026 ukr8b3g-cmyk；允许再分发与商用，义务是保留版权声明与许可文本。
- NOTICE 明确：MIT 只覆盖维护者文档、demo 前端、校验脚本与 Pages workflow；**不授予第三方角色/画作/商标/肖像/模型权利**；示例图不是清权合集。
- 做法：随资产附带 `LICENSE` 与 `NOTICE.md` 全文，来源标注清楚。

## 4. 映射到我们的默认资产格式

我们的格式（`data/default-prompt-assets/<sourceId>.json`）：顶层数组，每项 13 字段。消费方只读 `id/title/prompt/description|detail/tags/variantCount`；`title` 与 `prompt` 任一为空即跳过；`tags` 生成两层分类树。

| MOSS | 我们的 | 说明 |
|---|---|---|
| name | title | 英文 booru 名，保留原样 |
| copy_prompt | prompt | 角色为描述式；风格条目需去场景耦合 |
| copy_tags 拆数组 + facets | tags | facet 值加前缀（如 hairColor:white），否则会与角色名混平 |
| copyright | tags 之一 | 「Picture styles」24 条改用风格 8 分类 |
| added_at | createdAt | |
| demo_image | coverUrl | 改为本地资源地址（见第 6 节） |
| — | description | 合成：MOSS · 作品 · 类型 |
| — | sourceId | 新来源 `moss-character` |
| — | author / sourceUrl | ukr8b3g-cmyk / 仓库地址 |

## 5. 三个必踩的坑（已核实）

1. **来源是硬编码的 7 个**（`default-prompt-assets.service.ts` 的 `SOURCES`），文件名必须等于 `<sourceId>.json`。
2. **两个标记必须升级**：`default_prompt_assets_local_v1`（不升就直接 return 0，资产不会导入）与 `default_prompt_asset_categories_v7`（不升则新标签不进分类树）。
3. **清洗清单**：跳过 2 条带 `(MOSS caption test)` 的（demo-103/108）；24 条风格里 16 条绑定了示范场景，需要去场景化或标注；12 条风格标签只是名称重复；图片路径要重写。

## 6. 图片怎么显示

现在资产卡的 `coverUrl` 只认网络地址。要显示本地图，需要新增一条本地资源通道（自定义协议，主进程注册，渲染层用 `<img src>` 直接引用），开发模式与打包模式都要能用。

## 7. 执行步骤（约半天）

1. 生成 `data/default-prompt-assets/moss-character.json`（120 条，13 字段）。
2. 拷贝 120 张图到应用资源目录。
3. `SOURCES` 追加一项；两个标记版本 +1。
4. 注册本地图片协议，资产卡回退到本地地址。
5. 分类树重建（来源名做根，标签做子类）。
6. 验证：资产总数 1,742 → 1,862；分类树里能看到 MOSS 来源与角色/作品标签；图片能显示。
