// Grimoire runtime acceptance smoke (tag/gallery series).
//
// Exercises the real Electron app through CDP: the window.api chain for the
// tag/gallery features, plus optional workspace-popout checks for individual
// panels (layout documents are never modified). Prints a JSON report and exits
// non-zero when any check fails.
//
// Workflow (the dev server's own port must NOT be used; run these in order):
//   1) npm run build
//   2) npx vite preview --port 4173 --strictPort
//   3) VITE_DEV_SERVER_URL=http://localhost:4173 npx electron . --remote-debugging-port=9222 --enable-logging
//   4) node scripts/electron-runtime-smoke.mjs --panel gallery-search --shot smoke.png
//
// Notes:
// - A file:// VITE_DEV_SERVER_URL override does not work for auxiliary windows
//   (getRendererURL concatenates "/#hash"), hence the preview server.
// - Popouts are opened through window.api.workspace.openPopout and closed at
//   the end unless --keep is passed; the workspace persistence document is not
//   touched.
import fs from 'node:fs'

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const index = args.indexOf('--' + name)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}
const CDP_PORT = Number(arg('port', '9222'))
const PANEL = arg('panel', '')            // gallery-search | tag-batch | wd14 | prompt-workbench | ...
const SHOT = arg('shot', '')              // PNG output path for the panel window (optional)
const KEEP_POPOUT = args.includes('--keep')

const PANEL_MARKERS = {
  'gallery-search': [{ label: '语法查询栏', selector: '[aria-label="图库语法查询"]' }, { text: '重置筛选' }, { text: '批量标注' }],
  wd14: [{ text: '反推' }, { text: '阈值' }],
  'prompt-workbench': [{ text: '正面' }, { text: '负面' }, { text: '输出' }],
  'tag-asset-manager': [{ text: '标签' }],
}

async function findTarget(predicate, timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
      const hit = targets.find(predicate)
      if (hit) return hit
    } catch { /* electron still starting */ }
    await new Promise(resolve => setTimeout(resolve, 700))
  }
  return null
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl)
    const pending = new Map()
    let nextId = 1
    socket.addEventListener('open', () => resolve({
      send(method, params = {}) {
        const id = nextId++
        socket.send(JSON.stringify({ id, method, params }))
        return new Promise((res, rej) => pending.set(id, { res, rej }))
      },
      close() { socket.close() },
    }))
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data))
      if (message.id && pending.has(message.id)) {
        const entry = pending.get(message.id)
        pending.delete(message.id)
        if (message.error) entry.rej(new Error(message.error.message))
        else entry.res(message.result)
      }
    })
    socket.addEventListener('error', () => reject(new Error('WebSocket 连接失败')))
  })
}

const evaluate = async (client, expression) => {
  const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) {
    throw new Error('页面内异常：' + (result.exceptionDetails.exception?.description || result.exceptionDetails.text))
  }
  return result.result?.value
}

const report = { steps: [], panel: PANEL || null }
const step = async (name, fn) => {
  try {
    report.steps.push({ name, ok: true, value: await fn() })
  } catch (error) {
    report.steps.push({ name, ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

const main = await findTarget(target => target.type === 'page' && !target.url.includes('workspace-popout'))
if (!main) {
  console.log(JSON.stringify({ error: '未找到主窗口调试目标，请确认 electron 已带 --remote-debugging-port 启动' }, null, 2))
  process.exit(1)
}
const mainClient = await connect(main.webSocketDebuggerUrl)
await mainClient.send('Runtime.enable')
await mainClient.send('Page.enable')

await step('renderer-origin', async () => evaluate(mainClient, 'location.href'))
await step('api-surface', async () => evaluate(mainClient, `({ media: typeof window.api?.media?.query, thumbs: typeof window.api?.media?.thumbs, savedSearches: typeof window.api?.tags?.savedSearches?.save, showItem: typeof window.api?.system?.showItemInFolder })`))
await step('saved-search-roundtrip', async () => evaluate(mainClient, `(async () => {
  const saved = await window.api.tags.savedSearches.save({ name: '运行时验收', queryJson: '{"search":"smoke"}' })
  const listed = (await window.api.tags.savedSearches.list()).some(entry => entry.id === saved.id)
  await window.api.tags.savedSearches.delete(saved.id)
  const removed = !(await window.api.tags.savedSearches.list()).some(entry => entry.id === saved.id)
  return { listed, removed }
})()`))
await step('media-query', async () => evaluate(mainClient, `(async () => {
  const page = await window.api.media.query({ query: { sort: 'updated', order: 'desc' }, page: { limit: 5 } })
  return { total: page.total, sampleCount: page.items.length }
})()`))
await step('metadata-scan', async () => evaluate(mainClient, `window.api.media.metadata.scan({ batchSize: 4 })`))
await step('thumbs-batch', async () => evaluate(mainClient, `(async () => {
  const page = await window.api.media.query({ query: {}, page: { limit: 3 } })
  const ids = page.items.map(item => item.imageRefId)
  const thumbs = await window.api.media.thumbs({ ids, kind: 'thumbnail' })
  return { requested: ids.length, keys: Object.keys(thumbs).length }
})()`))

if (PANEL) {
  const popoutId = 'smoke:' + PANEL
  await step('popout-open', async () => evaluate(mainClient, `window.api.workspace.openPopout({ popoutId: ${JSON.stringify(popoutId)}, panelType: ${JSON.stringify(PANEL)}, title: '验收 · ' + ${JSON.stringify(PANEL)}, bounds: { width: 1280, height: 800 } })`))
  const popup = await findTarget(target => target.type === 'page' && target.url.includes('workspace-popout'), 20000)
  if (!popup) {
    report.steps.push({ name: 'popout-target', ok: false, error: '未找到 popout 窗口（面板类型需在 VALID_PANEL_TYPES 与 popout 白名单中注册）' })
  } else {
    const popClient = await connect(popup.webSocketDebuggerUrl)
    await popClient.send('Runtime.enable')
    await popClient.send('Page.enable')
    await step('popout-markers', async () => {
      const markers = PANEL_MARKERS[PANEL] || []
      const probeExpression = `((${JSON.stringify(markers)}).map(marker => ({ key: marker.selector || marker.text, ok: marker.selector ? !!document.querySelector(marker.selector) : ((document.body && document.body.textContent) || '').includes(marker.text) })))`
      const deadline = Date.now() + 12000
      let probe = []
      while (Date.now() < deadline) {
        probe = await evaluate(popClient, probeExpression)
        if (probe.every(entry => entry.ok)) break
        await new Promise(resolve => setTimeout(resolve, 600))
      }
      const missing = probe.filter(entry => !entry.ok).map(entry => entry.key)
      if (missing.length) throw new Error('标记缺失：' + missing.join(', '))
      return { matched: probe.map(entry => entry.key) }
    })
    if (PANEL === 'gallery-search') {
      // Thumbnails are derived lazily by the main process on first read; wait
      // for at least one real image before declaring/screenshotting the panel.
      await step('popout-thumbnails', async () => {
        const deadline = Date.now() + 45000
        let loaded = 0
        while (Date.now() < deadline) {
          loaded = await evaluate(popClient, `[...document.images].filter(img => img.naturalWidth > 0).length`)
          if (loaded > 0) break
          await new Promise(resolve => setTimeout(resolve, 800))
        }
        if (loaded === 0) throw new Error('45 秒内没有任何缩略图完成加载')
        return { loaded }
      })
    }
    if (SHOT) {
      const shot = await popClient.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(SHOT, Buffer.from(shot.data, 'base64'))
      report.screenshot = SHOT
    }
    popClient.close()
    if (!KEEP_POPOUT) {
      await step('popout-close', async () => evaluate(mainClient, `window.api.workspace.closePopout(${JSON.stringify(popoutId)})`))
    }
  }
}

mainClient.close()
const failed = report.steps.filter(entry => !entry.ok)
console.log(JSON.stringify(report, null, 2))
process.exit(failed.length ? 1 : 0)