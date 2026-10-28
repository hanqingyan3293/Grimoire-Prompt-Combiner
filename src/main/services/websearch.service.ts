import { htmlToText } from './websearch-extract'

// Web search + URL fetch (M3).
//
// Two providers with genuinely different shapes are enough to prove the adapter boundary: SearXNG
// (self-hosted, JSON, no key) and Tavily (hosted, key, POST). Everything else reports
// PROVIDER_NOT_SUPPORTED instead of silently returning an empty result that looks like "no matches".
export type WebSearchProviderId = 'searxng' | 'tavily'

export interface WebSearchResult { readonly title: string; readonly url: string; readonly snippet: string }

export interface WebSearchRequest {
  readonly provider: string
  readonly keywords: string
  readonly endpoint?: string
  readonly apiKey?: string
  readonly limit?: number
  readonly timeoutMs?: number
}

export class WebSearchError extends Error {
  constructor(readonly code: 'PROVIDER_NOT_SUPPORTED' | 'BAD_REQUEST' | 'UPSTREAM' | 'EMPTY_QUERY', message: string) {
    super(message)
    this.name = 'WebSearchError'
  }
}

const DEFAULT_ENDPOINTS: Record<WebSearchProviderId, string> = {
  searxng: 'http://127.0.0.1:8080',
  tavily: 'https://api.tavily.com',
}

function assertProvider(value: string): WebSearchProviderId {
  if (value === 'searxng' || value === 'tavily') return value
  throw new WebSearchError('PROVIDER_NOT_SUPPORTED', 'unsupported web search provider: ' + value)
}

function clip(text: unknown, limit: number): string {
  const value = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : ''
  return value.length > limit ? value.slice(0, limit) : value
}

export async function searchWeb(input: WebSearchRequest): Promise<WebSearchResult[]> {
  const provider = assertProvider(input.provider)
  const keywords = (input.keywords || '').trim()
  if (!keywords) throw new WebSearchError('EMPTY_QUERY', 'keywords are required')
  const endpoint = (input.endpoint || DEFAULT_ENDPOINTS[provider]).replace(/\/$/, '')
  const limit = Math.min(Math.max(Number(input.limit) || 5, 1), 20)
  const timeout = Number(input.timeoutMs) || 15000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    if (provider === 'searxng') {
      // SearXNG only returns JSON when the instance enables the format; a plain HTML answer is a
      // configuration problem and must surface as an error, not as zero results.
      const response = await fetch(endpoint + '/search?format=json&q=' + encodeURIComponent(keywords), { signal: controller.signal })
      if (!response.ok) throw new WebSearchError('UPSTREAM', 'searxng responded ' + response.status)
      const contentType = response.headers.get('content-type') || ''
      if (!contentType.includes('json')) throw new WebSearchError('UPSTREAM', 'searxng did not return JSON (enable the json format)')
      const payload = await response.json() as { results?: Array<Record<string, unknown>> }
      return (payload.results ?? []).slice(0, limit).map(item => ({
        title: clip(item.title, 200),
        url: String(item.url ?? ''),
        snippet: clip(item.content, 400),
      }))
    }
    if (!input.apiKey) throw new WebSearchError('BAD_REQUEST', 'tavily needs an api key')
    const response = await fetch(endpoint + '/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ api_key: input.apiKey, query: keywords, max_results: limit }),
      signal: controller.signal,
    })
    if (!response.ok) throw new WebSearchError('UPSTREAM', 'tavily responded ' + response.status)
    const payload = await response.json() as { results?: Array<Record<string, unknown>> }
    return (payload.results ?? []).slice(0, limit).map(item => ({
      title: clip(item.title, 200),
      url: String(item.url ?? ''),
      snippet: clip(item.content, 400),
    }))
  } catch (error) {
    if (error instanceof WebSearchError) throw error
    throw new WebSearchError('UPSTREAM', error instanceof Error ? error.message : String(error))
  } finally {
    clearTimeout(timer)
  }
}

export interface FetchedPage { readonly url: string; readonly title: string; readonly text: string; readonly truncated: boolean; readonly status: number }

export async function fetchUrls(input: { urls: string[]; maxBytes?: number; timeoutMs?: number }): Promise<FetchedPage[]> {
  const maxBytes = Math.min(Math.max(Number(input.maxBytes) || 200_000, 1024), 2_000_000)
  const timeout = Number(input.timeoutMs) || 20000
  const pages: FetchedPage[] = []
  for (const raw of input.urls.slice(0, 10)) {
    let parsed: URL
    try { parsed = new URL(raw) } catch { throw new WebSearchError('BAD_REQUEST', 'not a url: ' + raw) }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new WebSearchError('BAD_REQUEST', 'unsupported protocol: ' + parsed.protocol)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    try {
      const response = await fetch(parsed.toString(), { signal: controller.signal, redirect: 'follow' })
      const contentType = response.headers.get('content-type') || ''
      // Binary payloads are refused rather than decoded into mojibake and presented as content.
      if (!/text\/|application\/(json|xml|xhtml)/i.test(contentType)) {
        throw new WebSearchError('UPSTREAM', 'unsupported content type: ' + (contentType || 'unknown'))
      }
      const buffer = Buffer.from(await response.arrayBuffer())
      const truncated = buffer.length > maxBytes
      const body = buffer.subarray(0, maxBytes).toString('utf8')
      const extracted = htmlToText(body)
      pages.push({ url: parsed.toString(), title: extracted.title, text: extracted.text, truncated, status: response.status })
    } catch (error) {
      if (error instanceof WebSearchError) throw error
      throw new WebSearchError('UPSTREAM', error instanceof Error ? error.message : String(error))
    } finally {
      clearTimeout(timer)
    }
  }
  return pages
}
