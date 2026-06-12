import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'path'
import { initDatabase, closeDatabase } from './database'
import { registerTagsIPC } from './ipc/tags.ipc'
import { registerPresetsIPC } from './ipc/presets.ipc'
import { registerHistoryIPC } from './ipc/history.ipc'
import { registerSettingsIPC } from './ipc/settings.ipc'
import { registerImagesIPC } from './ipc/images.ipc'
import { runMigration } from './services/migration.service'

let mainWindow: BrowserWindow | null = null
const isDev = !app.isPackaged

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: '魔导书 Grimoire v5',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    // Production: renderer is at dist/renderer/index.html
    // __dirname = dist/main/main/, so go up 2 levels
    mainWindow.loadFile(path.join(__dirname, '../../renderer/index.html'))
  }

  mainWindow.on('closed', () => { mainWindow = null })
}

app.whenReady().then(async () => {
  await initDatabase()
  await runMigration()

  registerTagsIPC()
  registerPresetsIPC()
  registerHistoryIPC()
  registerSettingsIPC()
  registerImagesIPC()

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
