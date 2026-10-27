import { BrowserWindow, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/types'
import type { AiAssistantRecord, AiResourceOrderAnchor, AiTopicRecord } from '../../shared/ai-types'
import {
  archiveAiAssistant,
  archiveAiTopic,
  deleteAiAssistant,
  deleteAiTopic,
  getLatestAiTopic,
  listAiAssistants,
  listAiTopics,
  pinAiAssistant,
  pinAiTopic,
  reorderAiAssistant,
  reorderAiTopic,
  restoreAiAssistant,
  restoreAiTopic,
  saveAiAssistant,
  saveAiTopic
} from '../services/cherry-assistant.service'

function broadcastResource(record: AiAssistantRecord | AiTopicRecord): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.AI_SESSION_EVENT, { kind: 'resource', record })
  }
}

export function registerCherryAssistantIPC(): void {
  ipcMain.handle(IPC_CHANNELS.AI_ASSISTANT_LIST, async (_event, input?: { includeArchived?: boolean; manualOrder?: boolean }): Promise<AiAssistantRecord[]> => listAiAssistants(Boolean(input?.includeArchived), Boolean(input?.manualOrder)))
  ipcMain.handle(IPC_CHANNELS.AI_ASSISTANT_SAVE, async (_event, input: Partial<AiAssistantRecord> & { id?: string }) => {
    const result = saveAiAssistant(input)
    broadcastResource(result)
    return result
  })
  ipcMain.handle(IPC_CHANNELS.AI_ASSISTANT_DELETE, async (_event, id: string) => deleteAiAssistant(String(id || '')))
  ipcMain.handle(IPC_CHANNELS.AI_ASSISTANT_ARCHIVE, async (_event, id: string): Promise<AiAssistantRecord> => {
    const result = archiveAiAssistant(String(id || ''))
    broadcastResource(result)
    return result
  })
  ipcMain.handle(IPC_CHANNELS.AI_ASSISTANT_RESTORE, async (_event, id: string): Promise<AiAssistantRecord> => {
    const result = restoreAiAssistant(String(id || ''))
    broadcastResource(result)
    return result
  })
  ipcMain.handle(IPC_CHANNELS.AI_ASSISTANT_PIN, async (_event, input: { id: string; pinned: boolean }): Promise<AiAssistantRecord> => {
    const result = pinAiAssistant(String(input?.id || ''), input?.pinned === true)
    broadcastResource(result)
    return result
  })
  ipcMain.handle(IPC_CHANNELS.AI_ASSISTANT_REORDER, async (_event, input: { id: string; anchor: AiResourceOrderAnchor }): Promise<AiAssistantRecord> => {
    const result = reorderAiAssistant({ id: String(input?.id || ''), anchor: input?.anchor })
    broadcastResource(result)
    return result
  })
  ipcMain.handle(IPC_CHANNELS.AI_TOPIC_LIST, async (_event, input: { sessionId: string; includeArchived?: boolean; manualOrder?: boolean }): Promise<AiTopicRecord[]> => listAiTopics(String(input?.sessionId || ''), Boolean(input?.includeArchived), Boolean(input?.manualOrder)))
  ipcMain.handle(IPC_CHANNELS.AI_TOPIC_LATEST, async (_event, input?: { sessionId?: string | null }): Promise<AiTopicRecord | null> => {
    // `undefined` = global latest; explicit `null` = source 'unlinked' pseudo-scope.
    const sessionId = input && typeof input === 'object' && 'sessionId' in input ? (input.sessionId === null ? null : String(input.sessionId)) : undefined
    return getLatestAiTopic({ sessionId })
  })
  ipcMain.handle(IPC_CHANNELS.AI_TOPIC_SAVE, async (_event, input: Partial<AiTopicRecord> & { session_id: string; id?: string }) => {
    const result = saveAiTopic(input)
    broadcastResource(result)
    return result
  })
  ipcMain.handle(IPC_CHANNELS.AI_TOPIC_DELETE, async (_event, id: string) => deleteAiTopic(String(id || '')))
  ipcMain.handle(IPC_CHANNELS.AI_TOPIC_ARCHIVE, async (_event, id: string): Promise<AiTopicRecord> => {
    const result = archiveAiTopic(String(id || ''))
    broadcastResource(result)
    return result
  })
  ipcMain.handle(IPC_CHANNELS.AI_TOPIC_RESTORE, async (_event, id: string): Promise<AiTopicRecord> => {
    const result = restoreAiTopic(String(id || ''))
    broadcastResource(result)
    return result
  })
  ipcMain.handle(IPC_CHANNELS.AI_TOPIC_PIN, async (_event, input: { id: string; pinned: boolean }): Promise<AiTopicRecord> => {
    const result = pinAiTopic(String(input?.id || ''), input?.pinned === true)
    broadcastResource(result)
    return result
  })
  ipcMain.handle(IPC_CHANNELS.AI_TOPIC_REORDER, async (_event, input: { id: string; anchor: AiResourceOrderAnchor; ownerId?: string }): Promise<AiTopicRecord> => {
    const result = reorderAiTopic({ id: String(input?.id || ''), anchor: input?.anchor, ownerId: input?.ownerId })
    broadcastResource(result)
    return result
  })
}
