import { dialog, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/types'
import { deleteAiAttachment, importAiAttachment, listAiAttachments, readAiAttachment } from '../services/ai-attachment.service'

export function registerAiAttachmentsIPC(): void {
  ipcMain.handle(IPC_CHANNELS.AI_ATTACHMENT_SELECT, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'AI 附件', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'pdf', 'txt', 'md', 'json', 'csv'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    })
    return result.canceled ? null : result.filePaths[0] || null
  })
  ipcMain.handle(IPC_CHANNELS.AI_ATTACHMENT_LIST, async (_event, sessionId: unknown) => listAiAttachments(String(sessionId || '')))
  ipcMain.handle(IPC_CHANNELS.AI_ATTACHMENT_IMPORT, async (_event, input: unknown) => {
    const value = input && typeof input === 'object' ? input as Record<string, unknown> : {}
    return importAiAttachment({ sessionId: String(value.sessionId || ''), filePath: String(value.filePath || ''), sourceType: typeof value.sourceType === 'string' ? value.sourceType as any : undefined, messageId: typeof value.messageId === 'string' ? value.messageId : null })
  })
  ipcMain.handle(IPC_CHANNELS.AI_ATTACHMENT_DELETE, async (_event, id: unknown) => deleteAiAttachment(String(id || '')))
  ipcMain.handle(IPC_CHANNELS.AI_ATTACHMENT_READ, async (_event, id: unknown) => readAiAttachment(String(id || '')))
}
