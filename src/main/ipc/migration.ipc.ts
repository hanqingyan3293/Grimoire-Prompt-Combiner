import { dialog, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/types'
import { importFriendPromptMigration, previewFriendPromptMigration } from '../services/friend-migration.service'
import crypto from 'crypto'

interface PendingMigration {
  filePath: string
  fingerprint: string
  createdAt: number
}

const pending = new Map<string, PendingMigration>()
const PENDING_TTL_MS = 10 * 60 * 1000

function prunePending(): void {
  const now = Date.now()
  for (const [token, item] of pending) {
    if (now - item.createdAt > PENDING_TTL_MS) pending.delete(token)
  }
}

export function registerMigrationIPC(): void {
  ipcMain.handle(IPC_CHANNELS.MIGRATION_SELECT_FRIEND_PROMPTS, async () => {
    prunePending()
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: '朋友项目提示词索引', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePaths.length) return null
    const filePath = result.filePaths[0]
    const plan = previewFriendPromptMigration(filePath)
    const token = 'migration_token_' + crypto.randomUUID().replaceAll('-', '')
    pending.set(token, { filePath, fingerprint: plan.sourceFingerprint, createdAt: Date.now() })
    return { token, fingerprint: plan.sourceFingerprint, total: plan.total, additions: plan.additions.length, duplicates: plan.duplicates.length, skipped: plan.skipped, warnings: plan.warnings, sample: plan.additions.slice(0, 20).map(entry => ({ name: entry.name, chapter: entry.chapter })) }
  })

  ipcMain.handle(IPC_CHANNELS.MIGRATION_IMPORT_FRIEND_PROMPTS, async (_event, token: unknown, fingerprint: unknown) => {
    prunePending()
    if (typeof token !== 'string' || typeof fingerprint !== 'string') throw new Error('迁移确认信息无效')
    const selection = pending.get(token)
    if (!selection) throw new Error('迁移选择已过期，请重新选择文件')
    if (selection.fingerprint !== fingerprint) throw new Error('迁移文件指纹不匹配，请重新扫描')
    pending.delete(token)
    return importFriendPromptMigration(selection.filePath, selection.fingerprint)
  })
}
