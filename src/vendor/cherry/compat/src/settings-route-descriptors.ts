/** Source URL inventory, not capability implementations. Source remains read-only.
 * Unmounted pages remain diagnostic; partially mounted pages explicitly report
 * missing effects. Persisting a preference alone does not make its behavior work.
 */
export const REMAINING_SETTINGS_PATHS = {
  'settings-api-gateway': '/settings/api-gateway',
  'settings-browser': '/settings/browser',
  'settings-channels': '/settings/channels',
  'settings-device-connections': '/settings/device-connections',
  'settings-file-processing': '/settings/file-processing',
  'settings-local-models': '/settings/local-models',
  'settings-model': '/settings/model',
  'settings-ocr': '/settings/ocr',
  'settings-quick-assistant': '/settings/quick-assistant',
  'settings-screenshot': '/settings/screenshot',
  'settings-search': '/settings/search',
  'settings-selection-assistant': '/settings/selection-assistant',
  'settings-websearch': '/settings/websearch',
  'settings-skills': '/settings/skills',
  'settings-scheduled-tasks': '/settings/scheduled-tasks'
} as const

export const REMAINING_SETTINGS_DETAIL_PATTERNS = {
  'settings-skill-detail': '/settings/skills/$skillId',
  'settings-scheduled-task-detail': '/settings/scheduled-tasks/$taskId'
} as const

export type RemainingSettingsId = keyof typeof REMAINING_SETTINGS_PATHS | keyof typeof REMAINING_SETTINGS_DETAIL_PATTERNS
export type RemainingSettingsRoute =
  | { [K in keyof typeof REMAINING_SETTINGS_PATHS]: { id: K; path: typeof REMAINING_SETTINGS_PATHS[K] } }[keyof typeof REMAINING_SETTINGS_PATHS]
  | { id: 'settings-skill-detail'; path: string; skillId: string }
  | { id: 'settings-scheduled-task-detail'; path: string; taskId: string }

export interface SettingsDiagnosticDescriptor {
  title: string
  source: string
  missing: readonly string[]
  nextAction: string
}

const skills: SettingsDiagnosticDescriptor = {
  title: '技能设置', source: 'SkillsSettings / SkillDetails + SkillLauncherProvider',
  missing: ['skill.list_catalog / skill.reconcile / skill.install / skill.uninstall', 'skill.folder.resolve / skill.folder.open / skill.remote.check / skill.remote.apply；受权限保护的技能文件读写与启动'],
  nextAction: '接入技能目录、安装/卸载、文件与远程更新服务，验证 skillId 路由参数和 SkillLauncherProvider 后再挂载源布局及页面。'
}
const tasks: SettingsDiagnosticDescriptor = {
  title: '定时任务设置', source: 'TasksSettings',
  missing: ['ai.agent.task.create / update / pause / resume / run / delete 及源任务查询、状态订阅', '源 agentId/taskId 所有权、调度与执行记录适配；Host 定时任务域可用不等于支持源任务协议'],
  nextAction: '将源任务 CRUD、调度、执行记录与状态缓存接入 Grimoire 服务，验证 taskId 深链接及权限/取消/失败恢复后挂载。'
}

export const SETTINGS_DIAGNOSTICS: Record<RemainingSettingsId, SettingsDiagnosticDescriptor> = {
  'settings-api-gateway': {
    title: 'API 网关设置', source: 'ApiGatewaySettings / useApiGateway',
    missing: [],
    nextAction: '网关已真实运行：OpenAI 兼容接口转发到当前供应商，运行状态经 api_gateway.status 同步到页面徽章。'
  },
  'settings-browser': {
    title: '浏览器设置', source: 'BrowserSettings（只读挂载）/ BrowserClearDialog / BrowserImportDialog（动作禁用）',
    missing: ['浏览器 guest/session 生命周期与隐私/权限偏好消费者', 'browser.data.clear / browser.import.sources / browser.import.run；BrowserHistoryDialog 需要缺失的 TabsProvider'],
    nextAction: '接入浏览器会话、数据清理、导入和真实 Tab 导航服务，验证偏好作用于 guest 后开放对应动作。'
  },
  'settings-channels': {
    title: '消息渠道设置', source: 'ChannelsSettings / ChannelDetail / useChannels',
    missing: ['channel.create / channel.update / channel.delete / channel.get_logs', '渠道连接、凭据保管、运行状态与消息投递服务'],
    nextAction: '适配渠道查询、CRUD、连接生命周期、日志和凭据，再验证连接失败与重试。'
  },
  'settings-device-connections': {
    title: '设备连接设置', source: 'DeviceConnectionsSettings（未挂载）',
    missing: ['api_gateway.remote.list_claims / create_invitation / decide_pairing', 'api_gateway.lan.set_enabled；/api-gateway/paired-devices DataApi、远程配对权限、LAN 网关和真实连接状态'],
    nextAction: '接入并验证配对设备查询、网关配对/邀请/授权及 LAN 生命周期，确保所有撤销与启动动作具备失败和重试语义后挂载源页面。'
  },
  'settings-file-processing': {
    title: '文件处理设置', source: 'DocumentProcessingSettings / ProcessorPanel',
    missing: ['file_processing.list_available_processors', '处理器凭据、探测和真实文档解析；源处理偏好尚无完整消费链'],
    nextAction: '接入文件处理器枚举、配置、连接测试和解析执行，验证错误/取消及处理结果后挂载。'
  },
  'settings-local-models': {
    title: '本地模型设置', source: 'LocalModelsSection / useLocalModel',
    missing: ['local_model.list / get_acceleration_capability / get_status / download / cancel / remove', '模型文件管理、下载进度与加速能力共享缓存'],
    nextAction: '适配模型管理与能力探测；先确认下载策略和权限，验证进度、取消、失败及移除。'
  },
  'settings-model': {
    title: '模型设置', source: 'ModelSettings / validateModelSettingsSearch / useDefaultModel',
    missing: ['源 chat.default_model_id、quick/translate/painting 模型偏好的运行时消费者尚未验证（配置保存不代表执行已接入）', '翻译/主题命名完整执行合同尚未接入，源配置侧栏通过 showSettingsButton=false 不挂载'],
    nextAction: 'CompatModelSettings 已挂载源页面并复用 focus parser、模型目录及偏好持久化；下一步接入运行时消费者，再验证翻译/主题命名执行链并开放侧栏。'
  },
  'settings-ocr': {
    title: 'OCR 设置', source: 'OcrSettings / ProcessorPanel',
    missing: ['file_processing.list_available_processors', 'OCR 引擎、模型安装、凭据测试和源 OCR 偏好消费者'],
    nextAction: '适配 OCR 处理器配置与真实识别管线，验证语言、模型、错误与取消后挂载。'
  },
  'settings-quick-assistant': {
    title: '快捷助手设置', source: 'QuickAssistantSettings',
    missing: ['quick_assistant.close；快捷助手窗口生命周期', '全局快捷键注册、冲突事件与源快捷助手模型/窗口偏好消费者'],
    nextAction: '接入快捷助手多窗口及全局快捷键服务，验证关闭、冲突与模型选择实际生效。'
  },
  'settings-screenshot': {
    title: '截图设置', source: 'ScreenshotSettings',
    missing: ['截图窗口、屏幕捕获与平台权限管线', 'shortcut.onRegistrationConflict 与源截图快捷键/行为偏好消费者'],
    nextAction: '实现截图生命周期和全局快捷键，验证多屏、权限拒绝、取消及真实图像输出。'
  },
  'settings-search': {
    title: '设置搜索', source: 'SearchResultsPage / SettingsPage / SettingsSearchDomIdsProvider',
    missing: ['源 validateSearch 的 q 字节上限验证；当前 router shim 仅返回原始 search', 'SettingsPage 搜索框、共享 DOM IDs、键盘 store、pending focus 的滚动/高亮消费链'],
    nextAction: '接入源 search 验证、搜索框与作用域 context、键盘导航和目标锚点消费，验证超长/无效 q 与深链接后挂载；不显示伪造空结果。'
  },
  'settings-selection-assistant': {
    title: '划词助手设置', source: 'SelectionAssistantSettings',
    missing: ['全局 selection-hook、工具栏/动作窗口生命周期与划词偏好消费者', 'selection.get_linux_env_info / system.mac.is_process_trusted 平台能力适配'],
    nextAction: '接入全局划词和多窗口服务，验证平台权限、动作执行、禁用与资源清理。'
  },
  'settings-websearch': {
    title: '联网搜索设置', source: 'WebSearchSettings / useWebSearch',
    missing: ['源 WebSearch provider 配置、密钥保管与连接测试', 'chat.web_search.* 的搜索/抓取、过滤及压缩消费者'],
    nextAction: '适配源搜索服务和配置消费链，验证真实搜索/抓取、认证失败和过滤压缩后挂载。'
  },
  'settings-skills': skills,
  'settings-skill-detail': skills,
  'settings-scheduled-tasks': tasks,
  'settings-scheduled-task-detail': tasks
}

export function getSettingsDiagnostic(id: string): SettingsDiagnosticDescriptor | undefined {
  return Object.prototype.hasOwnProperty.call(SETTINGS_DIAGNOSTICS, id)
    ? SETTINGS_DIAGNOSTICS[id as RemainingSettingsId] : undefined
}
