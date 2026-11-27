import { isIP } from 'node:net'
import { classifyComfyIpAddress } from '../../integrations/cherry/comfy-source-loader'
import { requireComfyExecutionEndpoint } from '../../shared/comfy-execution'

const MAX_TEXT_LENGTH = 10000

export function requireText(value: unknown, field: string, maxLength = MAX_TEXT_LENGTH): string {
  if (typeof value !== 'string') throw new Error(field + ' 必须是文本')
  const text = value.trim()
  if (text.length > maxLength) throw new Error(field + ' 超过长度限制')
  return text
}

export function optionalText(value: unknown, field: string, maxLength = MAX_TEXT_LENGTH): string | undefined {
  if (value === undefined || value === null) return undefined
  return requireText(value, field, maxLength)
}

export function requireNonEmptyText(value: unknown, field: string, maxLength = MAX_TEXT_LENGTH): string {
  const text = requireText(value, field, maxLength)
  if (!text) throw new Error(field + ' 不能为空')
  return text
}

export function requireId(value: unknown, field = 'id'): string {
  const id = requireText(value, field, 200)
  if (!/^[A-Za-z0-9_.:-]+$/.test(id)) throw new Error(field + ' 格式无效')
  return id
}

export function requireHttpUrl(value: unknown, field = 'URL'): string {
  const raw = requireText(value, field, 2048)
  let url: URL
  try { url = new URL(raw) } catch { throw new Error(field + ' 格式无效') }
  const isLoopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) throw new Error(field + ' 必须使用 HTTPS；本机服务才允许 HTTP')
  return raw.replace(/\/+$/, '')
}

export function requireComfyAddress(value: unknown, field = 'ComfyUI 地址'): string {
  const raw = requireComfyRequestUrl(value, field).replace(/\/+$/, '')
  return requireComfyExecutionEndpoint(raw)
}

/** Resource URLs keep their query; configured endpoints use the frozen C1 grammar. */
export function requireComfyRequestUrl(value: unknown, field = 'ComfyUI 请求地址'): string {
  const raw = requireText(value, field, 2048)
  let url: URL
  try { url = new URL(raw) } catch { throw new Error(field + ' 格式无效') }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(field + ' 必须使用 HTTP 或 HTTPS')
  if (url.username || url.password) throw new Error(field + ' 不能包含凭据（用户名或密码）')
  if (/\s/.test(raw)) throw new Error(field + ' 不能包含空白')
  if (raw.includes('#')) throw new Error(field + ' 不能包含 hash 片段')
  const host = stripIpv6Brackets(url.hostname).toLowerCase()
  const isLoopback = host === '127.0.0.1' || host === 'localhost' || host === '::1'
  if (!isLoopback) {
    if (url.protocol === 'http:') throw new Error(field + ' 必须使用 HTTPS；只有本机回环地址允许 HTTP')
    if (isUnsafeComfyLiteral(host)) throw new Error(field + ' 不能指向私有、链路本地或元数据地址')
  }
  return raw
}

export function comfyAddressOrDefault(value: unknown, fallback: string, onInvalid?: (error: unknown) => void): string {
  try { return requireComfyAddress(value) } catch (error) {
    onInvalid?.(error)
    return requireComfyAddress(fallback)
  }
}

function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
}

function isUnsafeComfyLiteral(host: string): boolean {
  return isIP(host) !== 0 && !classifyComfyIpAddress(host).public
}

export function optionalBoundedNumber(value: unknown, field: string, min: number, max: number): number | null | undefined {
  if (value === undefined || value === null || value === '') return value === null ? null : undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(field + ' 超出允许范围')
  return value
}

export interface ValidatedProviderSaveInput {
  id?: string; name: string; access_mode: 'api' | 'login'; protocol: 'chat_completions' | 'responses'
  base_url: string; api_key?: string; default_model: string; test_model: string
  context_size?: number | null; models: string[]; config_toml?: string; auth_json?: string
}

export function validateProviderSaveInput(value: unknown): ValidatedProviderSaveInput {
  if (!value || typeof value !== 'object') throw new Error('供应商配置无效')
  const input = value as Record<string, unknown>
  const models = input.models === undefined ? [] : input.models
  if (!Array.isArray(models) || models.length > 500 || models.some(model => typeof model !== 'string' || model.length > 300)) throw new Error('模型列表无效')
  return {
    id: input.id === undefined ? undefined : requireId(input.id),
    name: requireText(input.name || '未命名', '名称', 200),
    access_mode: input.access_mode === 'login' ? 'login' : 'api',
    protocol: input.protocol === 'responses' ? 'responses' : 'chat_completions',
    base_url: requireHttpUrl(input.base_url || 'https://api.openai.com/v1', 'Base URL'),
    api_key: optionalText(input.api_key, 'API Key', 4096),
    default_model: requireText(input.default_model || 'gpt-4o', '默认模型', 300),
    test_model: requireText(input.test_model || 'gpt-4o-mini', '测试模型', 300),
    context_size: optionalBoundedNumber(input.context_size, '上下文大小', 1, 10_000_000),
    models: models as string[],
    config_toml: optionalText(input.config_toml, 'config.toml', 100_000),
    auth_json: optionalText(input.auth_json, 'auth.json', 100_000),
  }
}

export function validateProviderRequest(baseUrl: unknown, apiKey: unknown, model?: unknown): { baseUrl: string; apiKey: string; model: string } {
  return {
    baseUrl: requireHttpUrl(baseUrl, 'Base URL'),
    apiKey: requireNonEmptyText(apiKey, 'API Key', 4096),
    model: model === undefined ? 'gpt-4o-mini' : requireText(model, '模型', 300),
  }
}
