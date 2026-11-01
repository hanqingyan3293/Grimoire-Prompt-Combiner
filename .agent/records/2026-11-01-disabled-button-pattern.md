# 「点了禁用按钮」这一模式（2026-11-01）

## 症状

测试里点了按钮，之后等一个元素出现，超时失败。日志看起来像**超时**或**功能没实现**。

## 原因

按钮在该时刻是 `disabled` 的，而 `fireEvent.click` / `element.click()` 对禁用按钮是**空操作**：
没有报错、没有事件、什么都没发生。

## 已遇到的 4 处

| 位置 | 禁用条件 | 表现 |
|---|---|---|
| G4 首个用例（刷新模型） | 缺 `base_url` 或密钥 | `provider-model-sync` 15s 不出现 |
| G4 错误态用例（刷新模型） | 同上 | `HTTP 503` 永远等不到 |
| 旅程 ComfyUI「保存并连接」 | `busy` | 保存没发生 / 错误提示不出现 |
| 旅程工作台「保存为新版本」 | `busy \|\| !dirty` | 版本没保存 |

## 正确写法

### vitest

```ts
const button = await screen.findByRole('button', { name: '刷新模型' })
await waitFor(() => expect(button).not.toBeDisabled())
fireEvent.click(button)
```

### CDP 旅程（主窗口）

```js
const clicked = await evaluate(`(() => {
  const button = Array.from(document.querySelectorAll('button')).find(el => el.textContent.includes('保存'))
  if (button && !button.disabled) { button.click(); return true }
  return false
})()`)
```

### CDP 旅程（浮窗/其他 BrowserWindow）

必须用**那个窗口自己的会话**（`evalIn`），不能用主窗口的 `evaluate`——
否则在主页面上永远找不到按钮，现象与本条完全相同。

## 检查清单（新增任何点击断言时）

1. 这个按钮在组件里有 `disabled=` 吗？有 → 先等可用。
2. 它是不是在另一个 BrowserWindow 里？是 → 用 `evalIn`。
3. 点击有没有**可观察的结果**？没有 → 断言本身无效。
4. 失败时先问「点击真的发生了吗」，再问「结果为什么没出现」。

## 相关记录

- `.agent/STATE.md` 第 168/169/170/186 轮
- 共性：**一次点击的静默失败，会在日志里伪装成完全不同的故障**。
