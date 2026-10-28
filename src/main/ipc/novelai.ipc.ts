import {
  createNovelaiAsset,
  deleteNovelaiAsset,
  listAssetsUsedByImage,
  listImagesUsingAsset,
  listNovelaiAssets,
  recordNovelaiAssetUsage,
  updateNovelaiAsset,
} from '../services/novelai-asset.service'
import { exportNovelaiMetadataToPng, readNovelaiMetadataFromFile } from '../services/novelai-metadata-file.service'
import { BrowserWindow, dialog, ipcMain } from 'electron'

import { IPC_CHANNELS } from '../../shared/types'
import {
  createNovelaiVersion,
  createNovelaiWork,
  getNovelaiBranchName,
  getNovelaiWork,
  listNovelaiBranchLine,
  listNovelaiBranches,
  listNovelaiDeletedVersions,
  listNovelaiWorks,
  restoreNovelaiVersion,
  softDeleteNovelaiVersion,
  setNovelaiBranchName,
} from '../services/novelai-version.service'

// NovelAI prompt workbench IPC (M6 UI). Thin on purpose: every rule (branching, empty versions,
// revisions, recycle bin) lives in the service and is tested there; these handlers only marshal.
function record(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' ? input as Record<string, unknown> : {}
}

export function registerNovelaiIPC(): void {
  ipcMain.handle(IPC_CHANNELS.NOVELAI_WORK_LIST, () => listNovelaiWorks())
  ipcMain.handle(IPC_CHANNELS.NOVELAI_WORK_CREATE, (_event, input: unknown) => {
    const value = record(input)
    const { work, root } = createNovelaiWork({ name: String(value.name ?? '未命名作品'), snapshot: String(value.snapshot ?? '') })
    return { work, root }
  })
  ipcMain.handle(IPC_CHANNELS.NOVELAI_WORK_GET, (_event, id: unknown) => getNovelaiWork(String(id ?? '')))
  ipcMain.handle(IPC_CHANNELS.NOVELAI_WORK_BUNDLE, (_event, input: unknown) => {
    const value = record(input)
    const workId = String(value.workId ?? '')
    const work = getNovelaiWork(workId)
    if (!work) return null
    const line = listNovelaiBranchLine(workId, typeof value.branchId === 'string' ? value.branchId : undefined)
    return {
      work,
      line,
      branchName: line.length ? getNovelaiBranchName(line[line.length - 1].branchId) : null,
      deleted: listNovelaiDeletedVersions(workId),
      branches: listNovelaiBranches(workId),
    }
  })
  ipcMain.handle(IPC_CHANNELS.NOVELAI_VERSION_LINE, (_event, input: unknown) => {
    const value = record(input)
    return listNovelaiBranchLine(String(value.workId ?? ''), typeof value.branchId === 'string' ? value.branchId : undefined)
  })
  ipcMain.handle(IPC_CHANNELS.NOVELAI_VERSION_CREATE, (_event, input: unknown) => {
    const value = record(input)
    return createNovelaiVersion({
      workId: String(value.workId ?? ''),
      parentVersionId: String(value.parentVersionId ?? ''),
      snapshot: String(value.snapshot ?? ''),
      source: value.source === 'agent' ? 'agent' : 'user',
      operation: typeof value.operation === 'string' ? value.operation : '',
      expectedRevision: Number(value.expectedRevision),
    })
  })
  ipcMain.handle(IPC_CHANNELS.NOVELAI_VERSION_DELETE, (_event, input: unknown) => {
    const value = record(input)
    return softDeleteNovelaiVersion({
      workId: String(value.workId ?? ''),
      versionId: String(value.versionId ?? ''),
      mode: value.mode === 'branch' ? 'branch' : 'single',
      expectedRevision: Number(value.expectedRevision),
    })
  })
  ipcMain.handle(IPC_CHANNELS.NOVELAI_VERSION_RESTORE, (_event, id: unknown) => restoreNovelaiVersion(String(id ?? '')))
  ipcMain.handle(IPC_CHANNELS.NOVELAI_BRANCH_LIST, (_event, workId: unknown) => listNovelaiBranches(String(workId ?? '')))
  ipcMain.handle(IPC_CHANNELS.NOVELAI_BRANCH_RENAME, (_event, input: unknown) => {
    const value = record(input)
    setNovelaiBranchName(String(value.workId ?? ''), String(value.branchId ?? ''), String(value.name ?? ''))
    return true
  })
  ipcMain.handle(IPC_CHANNELS.NOVELAI_ASSET_LIST, (_event, kind: unknown) => listNovelaiAssets(typeof kind === 'string' && kind ? kind as never : undefined))
  ipcMain.handle(IPC_CHANNELS.NOVELAI_ASSET_CREATE, (_event, input: unknown) => {
    const value = record(input)
    return createNovelaiAsset({ kind: String(value.kind ?? 'other') as never, name: String(value.name ?? ''), payload: typeof value.payload === 'string' ? value.payload : '', examples: Array.isArray(value.examples) ? value.examples.filter((item): item is string => typeof item === 'string') : [] })
  })
  ipcMain.handle(IPC_CHANNELS.NOVELAI_ASSET_UPDATE, (_event, input: unknown) => {
    const value = record(input)
    const patch = record(value.patch)
    return updateNovelaiAsset(String(value.id ?? ''), {
      ...(typeof patch.name === 'string' ? { name: patch.name } : {}),
      ...(typeof patch.payload === 'string' ? { payload: patch.payload } : {}),
      ...(Array.isArray(patch.examples) ? { examples: patch.examples.filter((item): item is string => typeof item === 'string') } : {}),
      ...(typeof patch.kind === 'string' ? { kind: patch.kind as never } : {}),
    })
  })
  ipcMain.handle(IPC_CHANNELS.NOVELAI_ASSET_DELETE, (_event, input: unknown) => {
    const value = record(input)
    deleteNovelaiAsset(String(value.id ?? ''), { force: value.force === true })
    return true
  })
  ipcMain.handle(IPC_CHANNELS.NOVELAI_ASSET_USE, (_event, input: unknown) => {
    const value = record(input)
    recordNovelaiAssetUsage({ assetId: String(value.assetId ?? ''), imageId: String(value.imageId ?? ''), via: typeof value.via === 'string' ? value.via : 'manual' })
    return true
  })
  ipcMain.handle(IPC_CHANNELS.NOVELAI_ASSET_IMAGES, (_event, id: unknown) => listImagesUsingAsset(String(id ?? '')))
  ipcMain.handle(IPC_CHANNELS.NOVELAI_ASSET_BY_IMAGE, (_event, id: unknown) => listAssetsUsedByImage(String(id ?? '')))
  // PNG metadata (M6.6): the dialog lives here so the renderer never receives a filesystem path
  // it could reuse for arbitrary reads. Export writes a sibling `.meta.png`, never the original.
  ipcMain.handle(IPC_CHANNELS.NOVELAI_METADATA_EXPORT, async (event, input: unknown) => {
    const params = record(input)
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const picked = await dialog.showOpenDialog(window as never, { title: '选择要写入参数的 PNG', filters: [{ name: 'PNG', extensions: ['png'] }], properties: ['openFile'] })
    if (picked.canceled || !picked.filePaths.length) return { canceled: true }
    const prompt = typeof params.prompt === 'string' ? params.prompt : ''
    if (!prompt) return { error: 'EMPTY_PROMPT' }
    const result = exportNovelaiMetadataToPng({ filePath: picked.filePaths[0], params: { ...params, prompt } as never })
    return { canceled: false, ...result }
  })
  ipcMain.handle(IPC_CHANNELS.NOVELAI_METADATA_IMPORT, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const picked = await dialog.showOpenDialog(window as never, { title: '选择带生成参数的 PNG', filters: [{ name: 'PNG', extensions: ['png'] }], properties: ['openFile'] })
    if (picked.canceled || !picked.filePaths.length) return { canceled: true }
    const decoded = readNovelaiMetadataFromFile(picked.filePaths[0])
    return { canceled: false, decoded }
  })
}
