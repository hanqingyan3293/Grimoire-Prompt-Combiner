import { getDatabase } from '../database'

// Which `/settings/general` preferences actually change behaviour (M3).
//
// The read-only banner used to say "未接入" as one blanket sentence, which is as useless as a
// fake success: the user could not tell a live switch from a dead one. This registry is the
// single source for that answer, and the settings route exposes it to the UI. A key is `wired`
// only when a real consumer reads it — not when it is merely stored.
export type CherryPreferenceConsumer = {
  readonly key: string
  readonly wired: boolean
  /** The control is hidden in the source page because the preference cannot take effect here. */
  readonly hidden?: boolean
  /** Where the consumer lives, or what is missing when it is not wired. */
  readonly note: string
}

export const CHERRY_GENERAL_PREFRENCES: readonly CherryPreferenceConsumer[] = Object.freeze([
  { key: 'app.launch_on_boot', wired: true, note: 'app-preferences.service 应用系统开机项' },
  { key: 'app.power.prevent_sleep_when_busy', wired: true, note: 'app-preferences.service 申请电源锁' },
  { key: 'app.proxy.mode', wired: true, note: 'settings.ipc 应用到 defaultSession（三键联动）' },
  { key: 'app.proxy.url', wired: true, note: 'settings.ipc 应用到 defaultSession（三键联动）' },
  { key: 'app.proxy.bypass_rules', wired: true, note: 'settings.ipc 应用到 defaultSession（三键联动）' },
  { key: 'chat.context_settings.enabled', wired: true, note: 'ai/runtime/context-settings 读取并截断消息' },
  { key: 'chat.context_settings.max_messages', wired: true, note: 'ai/runtime/context-settings 读取并截断消息' },
  { key: 'chat.context_settings.truncate_threshold', wired: true, note: 'ai/runtime/context-settings 读取' },
  { key: 'chat.retry.enabled', wired: true, note: 'ai/runtime/retry-policy 读取' },
  { key: 'chat.retry.max_attempts', wired: true, note: 'ai/runtime/retry-policy 读取' },
  { key: 'chat.retry.backoff_enabled', wired: true, note: 'ai/runtime/retry-policy 读取' },
  { key: 'chat.retry.fallback_model_ids', wired: true, note: 'ai/runtime/retry-policy 读取' },
  { key: 'app.developer_mode.enabled', wired: true, note: 'system.toggle_dev_tools 与 DevTools 快捷键受它控制' },
  { key: 'agent.language', wired: true, note: 'agent 轮次装配系统提示词时注入语言指令' },
  { key: 'agent.commit_attribution.enabled', wired: false, hidden: true, note: 'Grimoire Agent 不创建 git 提交，没有可归因对象；开关已隐藏' },
  { key: 'app.fetch.allow_private_network', wired: false, hidden: true, note: 'Grimoire 没有面向用户的抓取入口，私网判定无处生效；开关已隐藏' },
  { key: 'app.user.id', wired: false, note: '源用于匿名标识，Grimoire 没有读取方；页面上没有对应控件' },
  { key: 'BootConfig.app.disable_hardware_acceleration', wired: true, note: '启动前读取并调用 app.disableHardwareAcceleration()' },
])

export function cherryPreferenceWiring(): { total: number; wired: number; items: readonly CherryPreferenceConsumer[] } {
  const wired = CHERRY_GENERAL_PREFRENCES.filter(item => item.wired).length
  return { total: CHERRY_GENERAL_PREFRENCES.length, wired, items: CHERRY_GENERAL_PREFRENCES }
}

/** Reads a compat preference as the shim stored it (`"custom"`, `true`, `null`). */
export function readCherryPreference(name: string): unknown {
  const row = getDatabase().exec('SELECT value FROM settings WHERE key=?', ['cherry_pref.' + name])[0]?.values?.[0]?.[0]
  if (typeof row !== 'string') return undefined
  try { return JSON.parse(row) } catch { return row }
}

export function isCherryDeveloperModeEnabled(): boolean {
  return readCherryPreference('app.developer_mode.enabled') === true
}

/**
 * The source stores a human-readable label ("English", "中文") under `agent.language`, or null
 * for "no constraint". The consumer is the agent system prompt: the label becomes one
 * instruction line, and `null`/empty adds nothing rather than guessing a default.
 */
export function agentLanguageInstruction(): string | null {
  const value = readCherryPreference('agent.language')
  if (typeof value !== 'string') return null
  const label = value.trim()
  if (!label) return null
  return '始终使用以下语言回复：' + label + '（Always reply in ' + label + ').'
}

export function composeAgentSystemPrompt(existing: string | undefined): string {
  const instruction = agentLanguageInstruction()
  return [existing ? existing.trim() : '', instruction || ''].filter(Boolean).join('\n\n')
}
