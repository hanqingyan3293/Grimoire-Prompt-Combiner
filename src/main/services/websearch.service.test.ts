import http from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { htmlToText } from './websearch-extract'
import { fetchUrls, searchWeb, WebSearchError } from './websearch.service'

let server: http.Server
let base = ''

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    if (url.pathname === '/search' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ results: [
        { title: 'SearXNG 结果', url: 'https://example.com/a', content: '  很长的   摘要  ' },
        { title: '第二条', url: 'https://example.com/b', content: 'second' },
      ] }))
      return
    }
    if (url.pathname === '/search' && req.method === 'POST') {
      let body = ''
      req.on('data', chunk => { body += chunk })
      req.on('end', () => {
        const parsed = JSON.parse(body || '{}')
        res.writeHead(parsed.api_key === 'tv-key' ? 200 : 401, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ results: [{ title: 'Tavily 结果', url: 'https://example.com/t', content: parsed.query }] }))
      })
      return
    }
    if (url.pathname === '/plain-html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<html><head><title>页面标题</title><style>body{color:red}</style></head><body><h1>标题</h1><p>正文&nbsp;内容</p><script>alert(1)</script></body></html>')
      return
    }
    if (url.pathname === '/binary') {
      res.writeHead(200, { 'content-type': 'application/octet-stream' })
      res.end(Buffer.from([0, 1, 2, 3]))
      return
    }
    if (url.pathname === '/html-not-json') {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html>nope</html>')
      return
    }
    res.writeHead(404)
    res.end()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address()
  base = 'http://127.0.0.1:' + (typeof address === 'object' && address ? address.port : 0)
})

afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())) })

describe('web search service (M3)', () => {
  it('reads a SearXNG JSON answer and clips the snippet', async () => {
    const results = await searchWeb({ provider: 'searxng', keywords: '猫', endpoint: base })
    expect(results).toHaveLength(2)
    expect(results[0].title).toBe('SearXNG 结果')
    expect(results[0].snippet).toBe('很长的 摘要')
  })

  it('posts a Tavily query and honours the limit', async () => {
    const results = await searchWeb({ provider: 'tavily', keywords: 'dog', endpoint: base, apiKey: 'tv-key', limit: 1 })
    expect(results).toHaveLength(1)
    expect(results[0].snippet).toBe('dog')
  })

  it('refuses an unsupported provider instead of returning an empty list', async () => {
    await expect(searchWeb({ provider: 'zhipu', keywords: 'x', endpoint: base })).rejects.toMatchObject({ code: 'PROVIDER_NOT_SUPPORTED' })
  })

  it('reports a SearXNG instance that answers HTML as an upstream error', async () => {
    const failing = http.createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html/>') })
    await new Promise<void>(resolve => failing.listen(0, '127.0.0.1', () => resolve()))
    const address = failing.address()
    const port = typeof address === 'object' && address ? address.port : 0
    await expect(searchWeb({ provider: 'searxng', keywords: 'x', endpoint: 'http://127.0.0.1:' + port })).rejects.toBeInstanceOf(WebSearchError)
    await new Promise<void>(resolve => failing.close(() => resolve()))
  })
})

describe('url fetch (M3)', () => {
  it('extracts readable text, drops scripts and styles, keeps the title', async () => {
    const [page] = await fetchUrls({ urls: [base + '/plain-html'] })
    expect(page.title).toBe('页面标题')
    expect(page.text).toContain('正文 内容')
    expect(page.text).not.toContain('alert(1)')
    expect(page.text).not.toContain('color:red')
  })

  it('refuses binary content instead of decoding it into mojibake', async () => {
    await expect(fetchUrls({ urls: [base + '/binary'] })).rejects.toMatchObject({ code: 'UPSTREAM' })
  })

  it('rejects non-http protocols before any request', async () => {
    await expect(fetchUrls({ urls: ['file:///etc/passwd'] })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })
})

describe('html extraction', () => {
  it('decodes entities and keeps paragraph breaks', () => {
    const { text } = htmlToText('<p>a &amp; b</p><p>c &#65;</p>')
    expect(text).toBe('a & b\nc A')
  })
  it('refuses a blank query and a keyless Tavily call with distinct codes', async () => {
    await expect(searchWeb({ provider: 'searxng', endpoint: 'http://x', keywords: '   ' })).rejects.toMatchObject({ code: 'EMPTY_QUERY' })
    await expect(searchWeb({ provider: 'tavily', keywords: 'gpu', apiKey: '' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })
})
