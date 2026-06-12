import { app, BrowserWindow, ipcMain, Menu, dialog } from 'electron'
import path from 'path'
import { initDatabase, closeDatabase, getDatabase, saveDatabase } from './database'
import { registerTagsIPC } from './ipc/tags.ipc'
import { registerPresetsIPC } from './ipc/presets.ipc'
import { registerHistoryIPC } from './ipc/history.ipc'
import { registerSettingsIPC } from './ipc/settings.ipc'
import { registerImagesIPC } from './ipc/images.ipc'
import { runMigration } from './services/migration.service'

let mainWindow: BrowserWindow | null = null
const isDev = !app.isPackaged && !process.env.GRIMOIRE_PORTABLE

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: '魔导书 Grimoire v6.0',
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,
    }
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../renderer/index.html'))
  }

  mainWindow.on('closed', () => { mainWindow = null })
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin'

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: '文件(&F)',
      submenu: [
        {
          label: '新建窗口(&N)',
          accelerator: 'CmdOrCtrl+N',
          click: () => createWindow(),
        },
        { type: 'separator' },
        {
          label: '导入标签库...',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => mainWindow?.webContents.send('menu:import-tags'),
        },
        {
          label: '导出标签库...',
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => mainWindow?.webContents.send('menu:export-tags'),
        },
        { type: 'separator' },
        {
          label: '导入预设...',
          click: () => mainWindow?.webContents.send('menu:import-presets'),
        },
        {
          label: '导出预设...',
          click: () => mainWindow?.webContents.send('menu:export-presets'),
        },
        { type: 'separator' },
        ...(isMac ? [] : [
          {
            label: '退出(&X)',
            accelerator: 'Alt+F4',
            click: () => app.quit(),
          },
        ]),
      ],
    },
    {
      label: '编辑(&E)',
      submenu: [
        { label: '撤销(&U)', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: '重做(&R)', accelerator: 'CmdOrCtrl+Y', role: 'redo' },
        { type: 'separator' },
        { label: '剪切(&T)', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: '复制(&C)', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: '粘贴(&P)', accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { type: 'separator' },
        {
          label: '全选当前页(&A)',
          accelerator: 'CmdOrCtrl+A',
          click: () => mainWindow?.webContents.send('menu:select-all'),
        },
        {
          label: '清空当前页',
          click: () => mainWindow?.webContents.send('menu:clear-page'),
        },
        {
          label: '全部清空',
          click: () => mainWindow?.webContents.send('menu:clear-all'),
        },
      ],
    },
    {
      label: '视图(&V)',
      submenu: [
        {
          label: '重新加载(&R)',
          accelerator: 'CmdOrCtrl+R',
          click: () => mainWindow?.webContents.reload(),
        },
        { type: 'separator' },
        {
          label: '放大(&I)',
          accelerator: 'CmdOrCtrl+=',
          role: 'zoomIn',
        },
        {
          label: '缩小(&O)',
          accelerator: 'CmdOrCtrl+-',
          role: 'zoomOut',
        },
        {
          label: '重置缩放',
          accelerator: 'CmdOrCtrl+0',
          role: 'resetZoom',
        },
        { type: 'separator' },
        {
          label: '切换开发者工具',
          accelerator: 'F12',
          click: () => mainWindow?.webContents.toggleDevTools(),
        },
        { type: 'separator' },
        {
          label: '切换全屏',
          accelerator: 'F11',
          click: () => {
            if (mainWindow?.isFullScreen()) {
              mainWindow.setFullScreen(false)
            } else {
              mainWindow?.setFullScreen(true)
            }
          },
        },
      ],
    },
    {
      label: '窗口(&W)',
      submenu: [
        {
          label: '默认布局',
          accelerator: 'CmdOrCtrl+1',
          click: () => mainWindow?.webContents.send('menu:workspace-default'),
        },
        {
          label: '紧凑模式',
          accelerator: 'CmdOrCtrl+2',
          click: () => mainWindow?.webContents.send('menu:workspace-compact'),
        },
        {
          label: '宽画布',
          accelerator: 'CmdOrCtrl+3',
          click: () => mainWindow?.webContents.send('menu:workspace-wide'),
        },
        { type: 'separator' },
        {
          label: '显示/隐藏右侧面板',
          accelerator: 'CmdOrCtrl+B',
          click: () => mainWindow?.webContents.send('menu:toggle-right-panel'),
        },
        {
          label: '显示/隐藏左侧栏',
          accelerator: 'CmdOrCtrl+L',
          click: () => mainWindow?.webContents.send('menu:toggle-sidebar'),
        },
        { type: 'separator' },
        {
          label: '重置窗口大小',
          click: () => mainWindow?.setSize(1400, 900),
        },
      ],
    },
    {
      label: '帮助(&H)',
      submenu: [
        {
          label: '快捷键参考',
          click: () => mainWindow?.webContents.send('menu:shortcuts'),
        },
        { type: 'separator' },
        {
          label: '关于魔导书(&A)...',
          click: () => {
            dialog.showMessageBox({
              title: '关于魔导书',
              type: 'info',
              message: '魔导书 Grimoire v5.3.2',
              detail: [
                'AI绘画提示词工作站',
                '',
                '技术栈: Electron + React + TypeScript + SQLite',
                '',
                '功能: 标签管理 | 提示词组合 | AI识图反推 | 预设管理',
              ].join('\n'),
            })
          },
        },
      ],
    },
  ]

  if (isMac) {
    template.unshift({
      label: app.getName(),
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    })
  }

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}


// === Import/Export IPC handlers ===

ipcMain.handle('tags:export', async () => {
  const win = BrowserWindow.getFocusedWindow()
  if (!win) return { ok: false, error: 'No window' }
  const result = await dialog.showSaveDialog(win, {
    title: 'Export Tag Library',
    defaultPath: 'grimoire-tags.json',
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })
  if (result.canceled || !result.filePath) return { ok: false, canceled: true }
  try {
    const ddb = getDatabase()
    const cats = ddb.exec('SELECT * FROM categories ORDER BY sort_order, name')
    const subs = ddb.exec('SELECT * FROM subcategories ORDER BY sort_order, name')
    const tags = ddb.exec('SELECT * FROM tags ORDER BY sort_order, en')
    const favs = ddb.exec('SELECT tag_id FROM favorites')
    const favSet = new Set((favs[0]?.values ?? []).map((r) => r[0]))
    const data = {
      version: '6.0', exportedAt: new Date().toISOString(),
      categories: (cats[0]?.values ?? []).map((c) => ({
        id: c[0], name: c[1], sort_order: c[2], created_at: c[3],
        subcategories: (subs[0]?.values ?? []).filter((s) => s[1] === c[0]).map((s) => ({
          id: s[0], name: s[2], sort_order: s[3], created_at: s[4],
          tags: (tags[0]?.values ?? []).filter((t) => t[1] === s[0]).map((t) => ({
            id: t[0], en: t[2], zh: t[3], sort_order: t[4], source: t[5], created_at: t[6],
            is_favorite: favSet.has(t[0])
          }))
        }))
      }))
    }
    require("fs").writeFileSync(result.filePath, JSON.stringify(data, null, 2), 'utf-8')
    let count = 0
    for (const c of data.categories) for (const s of c.subcategories) count += s.tags.length
    return { ok: true, path: result.filePath, count }
  } catch (e: any) { return { ok: false, error: e.message } }
})

ipcMain.handle('tags:import', async () => {
  const win = BrowserWindow.getFocusedWindow()
  if (!win) return { ok: false, error: 'No window' }
  const result = await dialog.showOpenDialog(win, {
    title: 'Import Tag Library',
    filters: [{ name: 'JSON', extensions: ['json'] }, { name: 'All', extensions: ['*'] }]
  })
  if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true }
  try {
    const raw = require("fs").readFileSync(result.filePaths[0], 'utf-8')
    const data = JSON.parse(raw)
    if (!data.categories || !Array.isArray(data.categories)) {
      return { ok: false, error: 'Invalid tag library format' }
    }
    const ddb = getDatabase()
    let imported = 0
    for (const cat of data.categories) {
      let catId = cat.id
      const ec = ddb.exec('SELECT id FROM categories WHERE name = ?', [cat.name])
      if (ec[0]?.values?.length) catId = ec[0].values[0][0]
      else {
        if (!catId) catId = 'cat_' + Date.now() + '_' + Math.random().toString(36).slice(2,6)
        ddb.run('INSERT OR IGNORE INTO categories (id, name, sort_order) VALUES (?, ?, ?)',
          [catId, cat.name, cat.sort_order || 999])
      }
      for (const sub of (cat.subcategories || [])) {
        let subId = sub.id
        const es = ddb.exec('SELECT id FROM subcategories WHERE category_id = ? AND name = ?', [catId, sub.name])
        if (es[0]?.values?.length) subId = es[0].values[0][0]
        else {
          if (!subId) subId = 'sub_' + Date.now() + '_' + Math.random().toString(36).slice(2,6)
          ddb.run('INSERT OR IGNORE INTO subcategories (id, category_id, name, sort_order) VALUES (?, ?, ?, ?)',
            [subId, catId, sub.name, sub.sort_order || 999])
        }
        for (const tag of (sub.tags || [])) {
          const tagId = tag.id || 'tag_' + Date.now() + '_' + Math.random().toString(36).slice(2,6)
          const ex = ddb.exec('SELECT id FROM tags WHERE subcategory_id = ? AND en = ?', [subId, tag.en])
          if (!ex[0]?.values?.length) {
            ddb.run('INSERT OR IGNORE INTO tags (id, subcategory_id, en, zh, sort_order, source) VALUES (?, ?, ?, ?, ?, ?)',
              [tagId, subId, tag.en, tag.zh || '', tag.sort_order || 999, tag.source || 'imported'])
            imported++
          }
          if (tag.is_favorite) ddb.run('INSERT OR IGNORE INTO favorites (tag_id) VALUES (?)', [tagId])
        }
      }
    }
    saveDatabase()
    return { ok: true, imported, path: result.filePaths[0] }
  } catch (e: any) { return { ok: false, error: e.message } }
})


app.whenReady().then(async () => {
  await initDatabase()
  await runMigration()

  registerTagsIPC()
  registerPresetsIPC()
  registerHistoryIPC()
  registerSettingsIPC()
  registerImagesIPC()

  buildMenu()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  closeDatabase()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => { closeDatabase() })
