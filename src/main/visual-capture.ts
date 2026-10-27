import fs from 'fs'
import path from 'path'
import { BrowserWindow } from 'electron'
import { getDatabase } from './database'
import { appendAiMessage, createAiSession, pinAiSession, updateAiSession, updateAiSessionResource } from './services/ai-session.service'
import { pinAiTopic, saveAiAssistant, saveAiTopic } from './services/cherry-assistant.service'
import { toAiMessagePartsContent } from '../shared/ai-message-parts'

/**
 * Visual-regression capture for the Cherry compat window.
 *
 * Runs only when `GRIMOIRE_VISUAL_CAPTURE=1` is set, seeds a deterministic fixture
 * through the REAL services (no mocked renderer state), then captures the window at
 * the plan's viewport/scale/theme matrix with `webContents.capturePage`. Emulating
 * the Windows display scale uses `setZoomFactor` — the practical single-machine
 * approach; the docs record it as zoom emulation rather than true DPI switching.
 *
 * Painted states covered: populated rail + message blocks (text/markdown/code/
 * reasoning/tool success/tool error/data-error), long list (40 sessions), pinned +
 * archived rows, light and dark. An empty-DB run covers the empty state. Loading and
 * error states are deliberately not captured: forcing them would mean breaking a
 * live service or racing startup IPC, which the migration rules forbid.
 */

type Viewport = { width: number; height: number }

const VIEWPORTS: Viewport[] = [
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 }
]
const SCALES = [1, 1.25, 1.5]
const THEMES: Array<'light' | 'dark'> = ['light', 'dark']
const PAINT_SETTLE_MS = 900
const POST_LOAD_SETTLE_MS = 2600

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function artifactRoot(): string {
  const configured = process.env.GRIMOIRE_CAPTURE_DIR
  return configured && configured.trim() ? path.resolve(configured) : path.resolve(process.cwd(), 'artifacts', 'visual')
}

/**
 * Deterministic fixture for the populated runs. Sessions span every time bucket the
 * rail groups by, one row is pinned, one archived, one running; the active session
 * carries one message per rendered block type.
 */
export function seedVisualFixture(): { activeSessionId: string; stateSessionIds: Record<string, string>; stateSessionTitles: Record<string, string> } {
  const now = Date.now()
  const iso = (offsetMs: number) => new Date(now - offsetMs).toISOString()
  const day = 86_400_000

  const active = createAiSession({ kind: 'chat', runtime: 'openai-compatible', modelId: 'fixture-model', title: '长列表与消息块基线' })
  updateAiSessionResource({ id: active.id, groupId: null })

  const bucketTitles: Array<[string, number]> = [
    ['今日讨论 · Markdown 与代码块', 30 * 60_000],
    ['今日讨论 · 工具与错误', 2 * 60 * 60_000],
    ['昨天 · 会话恢复', day + 3 * 60 * 60_000],
    ['本周 · 主题分支', 3 * day],
    ['更早 · 归档测试', 12 * day]
  ]
  const created: string[] = [active.id]
  const stampSessionActivity = (sessionId: string, stamp: string) => {
    // Activity stamps drive both the time bucket and the default activity order.
    getDatabase().run("UPDATE cherry_resource_state SET last_activity_at=? WHERE entity_type='session' AND entity_id=?", [stamp, sessionId])
    getDatabase().run('UPDATE ai_sessions SET updated_at=? WHERE id=?', [stamp, sessionId])
  }
  bucketTitles.forEach(([title, offset]) => {
    const session = createAiSession({ kind: 'chat', runtime: 'openai-compatible', modelId: 'fixture-model', title })
    stampSessionActivity(session.id, iso(offset))
    created.push(session.id)
  })

  // Long-list pressure: 35 additional rows in the older bucket.
  for (let index = 0; index < 35; index += 1) {
    const session = createAiSession({ kind: 'chat', runtime: 'openai-compatible', modelId: 'fixture-model', title: '历史会话 ' + String(index + 1).padStart(2, '0') })
    stampSessionActivity(session.id, iso((14 + index) * day))
    created.push(session.id)
  }

  pinAiSession(created[2], true)
  updateAiSessionResource({ id: created[4], archived: true })

  // Message blocks on the active session, in the order the renderer groups them.
  appendAiMessage({ sessionId: active.id, role: 'user', content: toAiMessagePartsContent({ parts: [{ type: 'text', text: '给我一个 TypeScript 示例，并搜索最新文档。' }] }, 'user') })
  appendAiMessage({
    sessionId: active.id,
    role: 'assistant',
    status: 'completed',
    content: toAiMessagePartsContent({
      parts: [
        { type: 'reasoning', text: '用户想要一个示例并附带文档检索，我先给出代码块，再调用搜索工具。' },
        { type: 'text', text: '下面是一个带类型的示例：\n\n```ts\nexport function sum(xs: number[]): number {\n  return xs.reduce((a, b) => a + b, 0)\n}\n```\n\n接下来检索文档。' },
        { type: 'tool-call', id: 'fixture-call-1', name: 'search_docs', input: { query: 'TypeScript reduce' }, status: 'completed' },
        { type: 'tool-result', id: 'fixture-call-1', name: 'search_docs', output: { hits: 3 } },
        { type: 'tool-call', id: 'fixture-call-2', name: 'bash', input: { command: 'tsc --noEmit' }, status: 'failed' },
        { type: 'tool-result', id: 'fixture-call-2', name: 'bash', error: 'tsc: 命令未找到' },
        { type: 'error', text: '工具调用失败：tsc 未安装在当前环境。' }
      ]
    }, 'assistant')
  })

  // ── Non-happy-path states ──────────────────────────────────────────────────
  // The plan's visual gate requires loading/error/retry baselines, not just populated
  // ones. These are seeded through the SAME services the app uses — never by writing a
  // fake status the runtime could not produce — so the capture shows what a real failed
  // or in-flight session looks like.
  //
  // A session the runtime marked failed, carrying a failed assistant message so the
  // rail row AND the message-level error block both render.
  const failed = createAiSession({ kind: 'chat', runtime: 'openai-compatible', modelId: 'fixture-model', title: '基线 · 失败的会话' })
  updateAiSession({ id: failed.id, status: 'failed' })
  stampSessionActivity(failed.id, iso(45 * 60_000))
  appendAiMessage({ sessionId: failed.id, role: 'user', content: toAiMessagePartsContent({ parts: [{ type: 'text', text: '请总结这份文档。' }] }, 'user') })
  appendAiMessage({
    sessionId: failed.id,
    role: 'assistant',
    status: 'failed',
    content: toAiMessagePartsContent({
      parts: [{ type: 'error', text: '请求失败：上游返回 429（速率限制）。可重试。' }]
    }, 'assistant')
  })

  // A session the runtime is still working on, so the rail renders its running state.
  // No message is appended: an in-flight turn has no persisted assistant message yet,
  // which is exactly the state the loading affordance exists for.
  const running = createAiSession({ kind: 'chat', runtime: 'openai-compatible', modelId: 'fixture-model', title: '基线 · 运行中的会话' })
  updateAiSession({ id: running.id, status: 'running' })
  stampSessionActivity(running.id, iso(5 * 60_000))
  appendAiMessage({ sessionId: running.id, role: 'user', content: toAiMessagePartsContent({ parts: [{ type: 'text', text: '正在处理的请求…' }] }, 'user') })

  const assistant = saveAiAssistant({ name: '写作助手', description: '长文与结构' })
  saveAiAssistant({ name: '代码助手', description: '实现与审查' })
  const topicA = saveAiTopic({ session_id: active.id, title: '基线主题 · 消息块' })
  pinAiTopic(topicA.id, true)
  saveAiTopic({ session_id: active.id, title: '基线主题 · 归档' })
  void assistant

  // Two providers so the source Provider Settings route (`/settings/provider`) has
  // rows to list: one configured+active, one bare. Seeded through the providers table
  // shape the Grimoire IPC owns; no key material is written (api_key stays empty).
  const db = getDatabase()
  const providerStamp = new Date().toISOString()
  db.run(
    'INSERT OR IGNORE INTO providers (id,name,access_mode,protocol,base_url,api_key,default_model,test_model,context_size,models,config_toml,auth_json,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    ['pvd_fixture_openai', 'Fixture OpenAI', 'api', 'chat_completions', 'https://api.example.invalid/v1', '', 'gpt-4o', 'gpt-4o', 128000, JSON.stringify(['gpt-4o', 'gpt-4o-mini']), '', '', 1, providerStamp, providerStamp]
  )
  db.run(
    'INSERT OR IGNORE INTO providers (id,name,access_mode,protocol,base_url,api_key,default_model,test_model,context_size,models,config_toml,auth_json,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    ['pvd_fixture_bare', 'Fixture 未配置', 'api', 'chat_completions', '', '', '', '', null, '[]', '', '', 0, providerStamp, providerStamp]
  )

  // One MCP server so the source MCP settings route has a card to render. Stored
  // through the same mcp_servers shape the MCP service owns; no connection is opened.
  db.run(
    'INSERT OR IGNORE INTO mcp_servers (id,name,transport,endpoint,command,args_json,env_json,enabled,status,error_message,tools_json,enabled_tools_json,description,headers_json,timeout_seconds,disabled_auto_approve_tools_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    ['mcp_fixture_docs', 'Fixture 文档服务', 'http', 'https://mcp.example.invalid/sse', '', '[]', '{}', 1, 'disconnected', null, '[]', '[]', '文档检索与摘要的只读服务（夹具）', '{}', 60, '[]', providerStamp, providerStamp]
  )

  // The state sessions are returned by NAME so the capture can navigate to each one and
  // record its own frame. Previously only the active id came back, so the failed/running/tool
  // surfaces existed in the database but were never deliberately captured — they appeared in a
  // frame only if the rail happened to render them.
  return {
    activeSessionId: active.id,
    // Titles accompany the ids so the capture can find each row by the text it actually renders
    // rather than by a guess derived from the frame name.
    stateSessionTitles: {
      failed: '失败的会话',
      running: '运行中的会话',
      tool: '长列表与消息块基线'
    },
    stateSessionIds: {
      failed: failed.id,
      running: running.id,
      // The tool/permission blocks live in the ACTIVE session (the one titled
      // 「长列表与消息块基线」), so it is named explicitly rather than duplicated.
      tool: active.id
    }
  }
}

/**
 * Drives the theme through the source's own mechanism: writes the `ui.theme_mode`
 * preference (as a Cherry-pref key through the same settings store every other
 * preference uses) and then lets the real `ThemeProvider` effects apply
 * `body`/`documentElement` classes on the next render.
 *
 * Direct class writes were reverted by ThemeProvider's own effects on the next
 * React commit, so this writes the preference and waits for the provider's effect
 * to settle instead of fighting it. The setting is persisted under
 * `cherry_pref.ui.theme_mode`, which the compat preference shim reads into
 * `ui.theme_mode` — the same path the real settings UI takes.
 */
async function setTheme(window: BrowserWindow, theme: 'light' | 'dark'): Promise<void> {
  await window.webContents.executeJavaScript(
    `(() => {
      const apply = () => {
        const body = document.body
        const root = document.documentElement
        if (!body || !root) return false
        body.classList.remove('light', 'dark')
        root.classList.remove('light', 'dark')
        body.classList.add(${JSON.stringify(theme)})
        root.classList.add(${JSON.stringify(theme)})
        return true
      }
      // Re-assert on the next two frames so a ThemeProvider effect that commits
      // immediately after this call still converges to the requested theme.
      apply()
      requestAnimationFrame(() => { apply(); requestAnimationFrame(apply) })
      return true
    })()`
  )
  // Value driving the render is the source preference; set it so any re-render from
  // an unrelated state change (rail refresh, etc.) converges on the same theme.
  await setThemePreference(theme)
  await sleep(500)
}

/**
 * Persists `ui.theme_mode` the way the preference shim expects: a Cherry-only
 * preference stored as JSON under `cherry_pref.` in the settings table.
 */
async function setThemePreference(theme: 'light' | 'dark'): Promise<void> {
  const db = getDatabase()
  db.run(
    "INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=?",
    ['cherry_pref.ui.theme_mode', JSON.stringify(theme), JSON.stringify(theme)]
  )
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('data:refresh')
  }
  await sleep(200)
}

/**
 * Route diagnostic for a `GRIMOIRE_CAPTURE_ROUTE` run.
 *
 * Screenshots prove layout; they cannot prove that a deep link was PARSED (a route
 * that silently dropped its query renders exactly like one whose consumer never ran).
 * This reads the live renderer state back — hash, decoded search record, popup/dialog
 * presence, and the visible heading text — so a deep-link capture can distinguish
 * "import ran" from "query dropped on the floor". Written next to the screenshots.
 */
async function collectRouteDiagnostic(window: BrowserWindow): Promise<Record<string, unknown>> {
  const probe = `(() => {
    const raw = String(window.location.hash || '').replace(/^#/, '')
    const queryIndex = raw.indexOf('?')
    const search = {}
    new URLSearchParams(queryIndex === -1 ? '' : raw.slice(queryIndex + 1)).forEach((value, key) => { search[key] = value })
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'))
    return {
      hash: window.location.hash,
      pathname: queryIndex === -1 ? raw : raw.slice(0, queryIndex),
      searchKeys: Object.keys(search),
      searchPreview: Object.fromEntries(Object.entries(search).map(([key, value]) => [key, String(value).slice(0, 160)])),
      dialogCount: dialogs.length,
      dialogStyles: dialogs.map((node) => {
        const own = getComputedStyle(node)
        const overlay = node.parentElement
        const overlayStyle = overlay ? getComputedStyle(overlay) : null
        const rect = node.getBoundingClientRect()
        return {
          state: node.getAttribute('data-state'),
          opacity: own.opacity,
          visibility: own.visibility,
          display: own.display,
          transform: own.transform,
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
          parentState: overlay ? overlay.getAttribute('data-state') : null,
          parentOpacity: overlayStyle ? overlayStyle.opacity : null,
          parentVisibility: overlayStyle ? overlayStyle.visibility : null,
          parentDisplay: overlayStyle ? overlayStyle.display : null,
          parentAnimation: overlayStyle ? overlayStyle.animationName : null
        }
      }),
      dialogText: dialogs.map((node) => (node.textContent || '').slice(0, 240)),
      // ── Fatal-error detection ────────────────────────────────────────────────
      // A crashed renderer replaces the whole window with the source
      // WindowFatalFallback: a full-viewport flex container holding one Alert plus the
      // 打开调试面板/重新加载 buttons. The route still resolves, the console may stay
      // quiet, no dialog opens, and the capture reports a clean run while the window is
      // unusable — that happened for real (an unbridged ipcApi.on event), and only a
      // screenshot revealed it.
      //
      // Detection keys on that fallback's own structure rather than on "any alert box":
      // a legitimate BLOCKED diagnostics page also uses role="alert" to announce itself,
      // and treating that as a crash makes the check fire on correct behaviour.
      fatalFallback: (() => {
        const root = document.querySelector('.h-screen.w-screen, [class*="h-screen"][class*="w-screen"]')
        if (!root) return null
        const text = (root.textContent || '')
        // Both action labels are required: any single phrase could appear in ordinary
        // content, but the pair only occurs in the fatal fallback.
        const isFallback = text.includes('打开调试面板') && text.includes('重新加载')
        if (!isFallback) return null
        return text.replace(/\\s+/g, ' ').trim().slice(0, 240)
      })(),
      // Character count of the rendered text in the main content column, so a collapsed
      // or near-empty page is distinguishable from a populated one without a screenshot.
      contentTextLength: (() => {
        const main = document.querySelector('main') || document.querySelector('[data-cherry-root]')
        return main ? (main.innerText || '').replace(/\\s+/g, ' ').trim().length : 0
      })(),
      bodyPreview: (document.body ? document.body.innerText : '').replace(/\\s+/g, ' ').slice(0, 400)
    }
  })()`
  try {
    return (await window.webContents.executeJavaScript(probe)) as Record<string, unknown>
  } catch (error) {
    return { probeFailed: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * `capturePage` throws `UnknownVizError` while the compositor has not presented a
 * frame for the window (common when it was just resized or is occluded). Retrying
 * after a frame tick settles it; three attempts is the observed bound.
 */
async function captureWithRetry(window: BrowserWindow): Promise<Buffer> {
  let lastError: unknown = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return (await window.webContents.capturePage()).toPNG()
    } catch (error) {
      lastError = error
      await sleep(400 + attempt * 400)
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

/** Captures the window across the viewport × scale × theme matrix into the artifact root. */
export async function runVisualCapture(window: BrowserWindow, options: { empty: boolean; stateSessionIds?: Record<string, string>; stateSessionTitles?: Record<string, string> }): Promise<string[]> {
  const root = artifactRoot()
  fs.mkdirSync(root, { recursive: true })
  const written: string[] = []
  // The compositor only presents frames for a visible, unoccluded window.
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
  // Optional route navigation (e.g. `/settings/provider`) so a run can baseline a
  // specific surface. Assigns a full `#/path` string; the first attempt passed the
  // value through `location.hash` where a leading slash-less form resolved relative
  // to the file URL and produced `/C:/…/settings/provider`, so the leading `#/` is
  // normalized here and the hash registry's own parser handles the rest.
  const targetRoute = process.env.GRIMOIRE_CAPTURE_ROUTE
  if (targetRoute) {
    const normalized = targetRoute.startsWith('#') ? targetRoute : '#/' + targetRoute.replace(/^\/+/, '')
    await window.webContents.executeJavaScript(
      `(window.location.hash = ${JSON.stringify(normalized)}, true)`
    )
    await sleep(2200)
    const diagnostic = await collectRouteDiagnostic(window)
    // A dialog present at navigate time but absent from the frames is a fidelity bug,
    // not a capture artifact — sample it across the settle window so the diagnostic
    // distinguishes "never opened" from "opened then dismissed itself".
    const dialogTimeline: number[] = []
    for (let sample = 0; sample < 6; sample += 1) {
      const openDialogs = (await window.webContents.executeJavaScript(
        'document.querySelectorAll(\'[role="dialog"]\').length'
      )) as number
      dialogTimeline.push(Number(openDialogs))
      await sleep(1000)
    }
    const diagnosticFile = path.join(root, 'route-diagnostic.json')
    fs.writeFileSync(
      diagnosticFile,
      JSON.stringify({ requested: targetRoute, normalized, dialogTimeline, ...diagnostic }, null, 2)
    )
    // Prove the dialog actually PAINTS, not just mounts: `capturePage` reads the
    // presented frame, so this is the only check that separates "in the DOM" from
    // "on screen". Diagnostic only — it is not part of the viewport/scale matrix.
    if (diagnostic.dialogCount) {
      const probeFile = path.join(root, 'route-diagnostic-dialog.png')
      fs.writeFileSync(probeFile, await captureWithRetry(window))
    }
    // A fatal fallback is a FAILED capture, not a successful one with a note attached.
    // Logging it as a warning would repeat the exact failure this check exists to end:
    // an unusable window reported as a clean run because nothing threw where the log
    // listens.
    const fatalFallback = typeof diagnostic.fatalFallback === 'string' ? diagnostic.fatalFallback : ''
    const contentLength = Number(diagnostic.contentTextLength || 0)
    if (fatalFallback || contentLength === 0) {
      const screenshot = path.join(root, 'route-error.png')
      try {
        fs.writeFileSync(screenshot, await captureWithRetry(window))
      } catch {}
      const detail = fatalFallback
        ? '渲染了致命错误回退界面：' + fatalFallback
        : '页面正文为空（contentTextLength=0）——未渲染任何内容'
      throw new Error('路由 ' + targetRoute + ' 未正确渲染：' + detail + '（截图：' + screenshot + '）')
    }
  }
  await sleep(POST_LOAD_SETTLE_MS)

  // Matrix-phase dialog observation. The route diagnostic above samples only the
  // pre-matrix window; if a dialog is still mounted there but absent from the frames,
  // the transition happens inside this loop (setSize / setZoomFactor / setTheme) and
  // the count per frame is what localizes it.
  const matrixDialogCounts: Array<{ frame: string; dialogs: number }> = []

  for (const viewport of VIEWPORTS) {
    window.setSize(viewport.width, viewport.height)
    for (const scale of SCALES) {
      window.webContents.setZoomFactor(scale)
      for (const theme of THEMES) {
        await setTheme(window, theme)
        await sleep(PAINT_SETTLE_MS)
        if (targetRoute) {
          const count = (await window.webContents.executeJavaScript(
            'document.querySelectorAll(\'[role="dialog"]\').length'
          )) as number
          matrixDialogCounts.push({ frame: `${viewport.width}x${viewport.height} x${scale} ${theme}`, dialogs: Number(count) })
        }
        const png = await captureWithRetry(window)
        const tag = options.empty ? 'empty' : 'populated'
        const name = [tag, `${viewport.width}x${viewport.height}`, `x${scale}`, theme].join('-') + '.png'
        const file = path.join(root, name)
        fs.writeFileSync(file, png)
        written.push(file)
      }
    }
  }

  if (targetRoute && matrixDialogCounts.length) {
    fs.writeFileSync(
      path.join(root, 'route-diagnostic-matrix.json'),
      JSON.stringify(matrixDialogCounts, null, 2)
    )
  }

  // ── State frames ────────────────────────────────────────────────────────────
  //
  // One frame per seeded surface, at the default viewport/scale/theme. The plan requires
  // loading/error/retry/grouping/tool/permission coverage, and the viewport×scale×theme matrix
  // alone does not provide it: every one of those frames shows whichever session happened to
  // be active, so a state could regress and still appear in twelve passing frames.
  //
  // The session is selected by CLICKING its row — the same path a user takes — rather than by
  // poking renderer state. A test-only selection hook would bypass the very code (the rail's
  // activation, the snapshot load) whose behaviour these frames exist to protect.
  if (!options.empty && options.stateSessionIds) {
    // Navigate to the CHAT route first. The matrix may have run on a settings route (the
    // baseline script captures `/settings/data`), where the session rail is not on screen at
    // all — the first attempt clicked nothing and wrote zero state frames while every matrix
    // frame still succeeded, so the failure was silent.
    await window.webContents.executeJavaScript("(window.location.hash = '#/app/chat', true)")
    await sleep(2600)
    window.setSize(VIEWPORTS[0].width, VIEWPORTS[0].height)
    window.webContents.setZoomFactor(1)
    await setTheme(window, 'light')
    await sleep(PAINT_SETTLE_MS)
    // Titles are matched against the ACTUAL rendered row text, passed in from the fixture's own
    // session titles. The first attempt derived a search string from the frame NAME
    // (`failed` -> 失败) and looked for a `data-item-id` the row does not carry — so the lookup
    // always failed and the frame silently showed whichever session was already active. The
    // `failed` frame contained the RUNNING session, which is the "captured a frame, proved
    // nothing" failure this phase exists to prevent.
    for (const [stateName, sessionId] of Object.entries(options.stateSessionIds)) {
      const title = options.stateSessionTitles?.[stateName] || ''
      const clicked = (await window.webContents.executeJavaScript(`(() => {
        const rows = Array.from(document.querySelectorAll('[data-testid="compat-session-row"]'))
        const row = rows.find(el => (el.textContent || '').includes(${JSON.stringify(title)}))
        if (!row) return false
        // The rail's selection runs through the list's own click handler, so a bubbling
        // MouseEvent is what a real click produces.
        row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
        return true
      })()`)) as boolean
      if (!clicked) continue
      // The snapshot load is async; the frame is taken after it settles so the message area
      // reflects the selected session rather than the previous one.
      await sleep(1800)
      const png = await captureWithRetry(window)
      const file = path.join(root, ['populated', `state-${stateName}`].join('-') + '.png')
      fs.writeFileSync(file, png)
      written.push(file)
    }

    // ── Context menu (open) ───────────────────────────────────────────────────
    //
    // A menu is a STATE, not a page: it exists only while a right-click holds it open, so no
    // matrix frame can contain it — those navigate and settle, which dismisses any menu. The
    // plan lists 菜单 as required coverage, and without this frame the source context menu
    // could stop rendering entirely while all twelve matrix frames still passed.
    //
    // Right-click, not a synthetic `click`: the rail opens the menu on `contextmenu`, and the
    // menu's own portalled DOM is what the frame must contain.
    const menuRow = options.stateSessionTitles?.tool || ''
    const opened = (await window.webContents.executeJavaScript(`(() => {
      const rows = Array.from(document.querySelectorAll('[data-testid="compat-session-row"]'))
      const row = rows.find(el => (el.textContent || '').includes(${JSON.stringify(menuRow)}))
      if (!row) return false
      const box = row.getBoundingClientRect()
      row.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, button: 2,
        clientX: box.left + 12, clientY: box.top + 8
      }))
      return true
    })()`)) as boolean
    if (opened) {
      await sleep(900)
      // Confirm the menu actually opened before writing the frame: a screenshot of a closed
      // menu is exactly the "captured a frame, proved nothing" failure this phase guards against.
      const menuOpen = (await window.webContents.executeJavaScript(
        "document.querySelectorAll('[role=\"menu\"],[role=\"menuitem\"],[data-radix-menu-content]').length"
      )) as number
      if (Number(menuOpen) > 0) {
        const png = await captureWithRetry(window)
        const file = path.join(root, 'populated-state-menu-open.png')
        fs.writeFileSync(file, png)
        written.push(file)
      }
      // Dismiss so the phase leaves the window as it found it.
      await window.webContents.executeJavaScript(
        "document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))"
      )
      await sleep(400)
    }

    // ── Group collapsed ───────────────────────────────────────────────────────
    //
    // The rail groups sessions by time and collapses a group when its HEADER is clicked
    // (今天 / 昨天 / 更早). Those affordances are why a rail stays usable with 40+ sessions, and
    // the collapsed state shows neither the toggle nor the hidden count — so a regression that
    // removed collapsing would leave every other frame passing.
    //
    // Verified by ROW COUNT, not by text length. The first version matched the first control
    // whose label mentioned 收起/显示更多 and compared `innerText.length` — but 显示更多 EXPANDS
    // a group, so the click did the opposite of the intent, and the label swap alone changed the
    // text length enough to satisfy the guard. The resulting frame differed from the expanded one
    // by 1 byte: a duplicate wearing a different filename, which is the exact failure this phase
    // exists to prevent.
    const collapse = (await window.webContents.executeJavaScript(`(() => {
      const headers = Array.from(document.querySelectorAll('button,[role="button"]'))
        .filter(el => ['今天', '昨天', '更早'].includes((el.textContent || '').trim()))
      if (!headers.length) return null
      const before = document.querySelectorAll('[data-testid="compat-session-row"]').length
      headers[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      return before
    })()`)) as number | null
    if (collapse !== null) {
      await sleep(800)
      const after = (await window.webContents.executeJavaScript(
        "document.querySelectorAll('[data-testid=\"compat-session-row\"]').length"
      )) as number
      // Rows must actually disappear. Equal counts mean the click missed or the header is inert,
      // and writing the frame anyway would capture an expanded list labelled "collapsed".
      if (after < collapse) {
        const png = await captureWithRetry(window)
        const file = path.join(root, 'populated-state-group-collapsed.png')
        fs.writeFileSync(file, png)
        written.push(file)
      }
      // Restore the expanded state so later phases start from the same place.
      await window.webContents.executeJavaScript(`(() => {
        const headers = Array.from(document.querySelectorAll('button,[role="button"]'))
          .filter(el => ['今天', '昨天', '更早'].includes((el.textContent || '').trim()))
        if (headers[0]) headers[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
        return true
      })()`)
      await sleep(500)
    }
  }

  window.webContents.setZoomFactor(1)
  return written
}

/**
 * Recovers the seeded state sessions by TITLE.
 *
 * The fixture is only seeded into an empty database, so a re-capture against an existing
 * user-data-dir must find the sessions rather than create them again. Returning them by the
 * same keys `seedVisualFixture` uses keeps the capture's state-frame list identical either way.
 *
 * A missing session yields no entry, and the capture then skips that frame rather than writing
 * a screenshot of whatever happened to be on screen.
 */
export function findVisualStateSessionIds(): Record<string, string> {
  const { listAiSessions } = require('./services/ai-session.service') as typeof import('./services/ai-session.service')
  const sessions = listAiSessions({ includeArchived: true, limit: 500 })
  const byTitle = (needle: string): string | undefined => sessions.find(session => session.title.includes(needle))?.id
  const ids: Record<string, string> = {}
  const failed = byTitle('失败的会话')
  const running = byTitle('运行中的会话')
  const active = byTitle('长列表与消息块基线')
  if (failed) ids.failed = failed
  if (running) ids.running = running
  if (active) ids.tool = active
  return ids
}
