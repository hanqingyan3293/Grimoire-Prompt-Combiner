// 魔导书 Grimoire v7 — Provider 连接与模型拉取（主进程，密钥不离开主进程）
import { requireHttpUrl, requireId, requireText } from './input-validation'
/** Everything the connection helpers need; the API key is already decrypted and never returned to the renderer. */
export type ProviderConnectionTarget = {
  id: string
  baseUrl: string
  apiKey: string
  protocol: 'chat_completions' | 'responses'
  model: string
}

export type ProviderFetch = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean
  status: number
  json: () => Promise<unknown>
}>

function normalizeBaseUrl(value: unknown): string {
  const raw = requireText(value, 'Base URL', 2048)
  let url: URL
  try { url = new URL(raw) } catch { throw new Error('Base URL 格式无效') }
  const isLoopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) throw new Error('Base URL 必须使用 HTTPS；本机服务才允许 HTTP')
  return requireHttpUrl(raw, 'Base URL')
}

/**
 * A login-mode provider keeps its credential in auth_json/config_toml instead of
 * an API key, so the key is optional here; when present it is sent as a bearer
 * token. The legacy `providers:fetchModels` / `providers:test` channels keep
 * requiring an explicit key.
 */
export function resolveProviderConnection(input: {
  providerId: unknown
  baseUrl: unknown
  apiKey?: unknown
  storedApiKey?: string
  protocol?: unknown
  model?: unknown
  fallbackModel?: unknown
}): ProviderConnectionTarget {
  const id = requireId(input.providerId, 'Provider')
  const baseUrl = normalizeBaseUrl(input.baseUrl)
  const suppliedKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : ''
  const storedKey = typeof input.storedApiKey === 'string' ? input.storedApiKey : ''
  const protocol = input.protocol === 'responses' ? 'responses' : 'chat_completions'
  const requestedModel = typeof input.model === 'string' && input.model.trim() ? input.model.trim() : ''
  const fallbackModel = typeof input.fallbackModel === 'string' ? input.fallbackModel.trim() : ''
  const model = requestedModel || fallbackModel
  if (model.length > 300) throw new Error('模型 超过长度限制')
  return { id, baseUrl, apiKey: suppliedKey || storedKey, protocol, model }
}

/** Upstream `/models` payload → sorted unique id list; tolerates malformed rows. */
export function normalizeModelsPayload(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return []
  const data = (payload as { data?: unknown }).data
  if (!Array.isArray(data)) return []
  const ids = data
    .map(entry => (entry && typeof entry === 'object' ? (entry as { id?: unknown }).id : undefined))
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    .map(id => id.trim())
  return [...new Set(ids)].sort()
}

function authHeaders(target: ProviderConnectionTarget): Record<string, string> {
  return target.apiKey ? { Authorization: `Bearer ${target.apiKey}` } : {}
}

export async function fetchProviderModels(
  target: ProviderConnectionTarget,
  fetchImpl: ProviderFetch = fetch as unknown as ProviderFetch,
): Promise<{ success: boolean; models?: string[]; error?: string }> {
  try {
    const res = await fetchImpl(target.baseUrl + '/models', { headers: authHeaders(target) })
    if (!res.ok) return { success: false, error: 'HTTP ' + res.status }
    return { success: true, models: normalizeModelsPayload(await res.json()) }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function testProviderConnection(
  target: ProviderConnectionTarget,
  fetchImpl: ProviderFetch = fetch as unknown as ProviderFetch,
): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    const res = await fetchImpl(target.baseUrl + (target.protocol === 'responses' ? '/responses' : '/chat/completions'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(target) },
      body: target.protocol === 'responses'
        ? JSON.stringify({ model: target.model, input: [{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] }], max_output_tokens: 1 })
        : JSON.stringify({ model: target.model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }),
    })
    if (res.ok || res.status === 400) return { success: true, message: '连接成功' }
    if (res.status === 401) return { success: false, error: 'API Key 无效' }
    return { success: false, error: '状态码 ' + res.status }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}
