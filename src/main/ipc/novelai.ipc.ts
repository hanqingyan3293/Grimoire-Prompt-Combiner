import {
  createNovelaiAsset,
  deleteNovelaiAsset,
  listAssetsUsedByImage,
  listImagesUsingAsset,
  listAssetsUsedByVersion,
  listNovelaiAssets,
  listVersionsUsingAsset,
  recordNovelaiAssetUsage,
  updateNovelaiAsset,
} from '../services/novelai-asset.service'
import { exportNovelaiMetadataToPng, readNovelaiMetadataFromFile } from '../services/novelai-metadata-file.service'
import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { requireId } from '../services/input-validation'
import { NovelaiEditSessionError, type NovelaiEditOwner } from '../services/novelai-edit-session.service'
import { getActiveProvider } from './providers.ipc'
import { createNovelaiProviderModelCall, type ActiveOrganizeProvider } from '../services/novelai-organize-provider'
import { NovelaiOrganizeError, createNovelaiProposalService } from '../services/novelai-organize.service'

import { IPC_CHANNELS } from '../../shared/types'
import {
  linkNovelaiVersionImage,
  createNovelaiVersion,
  createNovelaiWork,
  getNovelaiBranchName,
  getNovelaiWork,
  listNovelaiBranchLine,
  listNovelaiBranches,
  listNovelaiDeletedVersions,
  listNovelaiWorks,
  purgeNovelaiVersion,
  restoreNovelaiVersion,
  restoreNovelaiVersions,
  softDeleteNovelaiVersions,
  softDeleteNovelaiVersion,
  setNovelaiBranchName,
} from '../services/novelai-version.service'

// NovelAI prompt workbench IPC (M6 UI). Thin on purpose: every rule (branching, empty versions,
// revisions, recycle bin) lives in the service and is tested there; these handlers only marshal.
function record(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' ? input as Record<string, unknown> : {}
}

const proposeNovelaiOrganize = createNovelaiProposalService(createNovelaiProviderModelCall({
  getProvider: () => getActiveProvider() as Promise<ActiveOrganizeProvider | null>,
}))

function editOwner(event: IpcMainInvokeEvent, input: Record<string, unknown>): NovelaiEditOwner | undefined {
  if (input.edit === undefined) return undefined
  const proof = record(input.edit)
  if (typeof proof.leaseId !== 'string' || !proof.leaseId) throw new NovelaiEditSessionError('EDIT_LEASE_EXPIRED', '编辑租约缺失')
  return { kind: 'window', sender: event.sender, editorKey: requireId(proof.editorKey, '编辑器状态键'), leaseId: proof.leaseId }
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
  ipcMain.handle(IPC_CHANNELS.NOVELAI_VERSION_CREATE, (event, input: unknown) => {
    const value = record(input)
    return createNovelaiVersion({
      workId: String(value.workId ?? ''),
      parentVersionId: String(value.parentVersionId ?? ''),
      snapshot: String(value.snapshot ?? ''),
      source: 'user',
      operation: typeof value.operation === 'string' ? value.operation : '',
      expectedRevision: value.expectedRevision as number,
      owner: editOwner(event, value),
    })
  })
  ipcMain.handle(IPC_CHANNELS.NOVELAI_VERSION_DELETE, (event, input: unknown) => {
    const value = record(input)
    return softDeleteNovelaiVersion({
      workId: String(value.workId ?? ''),
      versionId: String(value.versionId ?? ''),
      mode: value.mode === 'branch' ? 'branch' : 'single',
      expectedRevision: value.expectedRevision as number,
      owner: editOwner(event, value),
    })
  })
  ipcMain.handle(IPC_CHANNELS.NOVELAI_VERSION_RESTORE, (event, input: unknown) => { const value = record(input); return restoreNovelaiVersion(typeof input === 'string' ? input : String(value.versionId ?? ''), editOwner(event, value)) })
  ipcMain.handle(IPC_CHANNELS.NOVELAI_VERSION_DELETE_MANY, (event, input: unknown) => {
    const value = record(input)
    return softDeleteNovelaiVersions({ workId: String(value.workId ?? ''), versionIds: Array.isArray(value.versionIds) ? value.versionIds.filter((item): item is string => typeof item === 'string') : [], expectedRevision: value.expectedRevision as number, owner: editOwner(event, value) })
  })
  ipcMain.handle(IPC_CHANNELS.NOVELAI_VERSION_PURGE_MANY, (event, input: unknown) => {
    const value = record(input)
    const ids = Array.isArray(input) ? input : value.versionIds
    const list = Array.isArray(ids) ? ids.filter((item): item is string => typeof item === 'string') : []
    for (const id of list) purgeNovelaiVersion(id, editOwner(event, value))
    return list.length
  })
  // Per-block AI proposal. Errors are returned as a code+message envelope instead of being
  // thrown across Electron IPC, so a malformed provider payload stays readable in the panel.
  ipcMain.handle(IPC_CHANNELS.NOVELAI_ORGANIZE_PROPOSE, async (_event, input: unknown) => {
    const value = record(input)
    try {
      const proposal = await proposeNovelaiOrganize({
        workId: value.workId as string,
        versionId: value.versionId as string,
        expectedRevision: value.expectedRevision as number,
        draft: value.draft as string,
      })
      return { ok: true, changes: proposal.changes, workRevision: proposal.workRevision, versionId: proposal.versionId }
    } catch (error) {
      if (error instanceof NovelaiOrganizeError) return { ok: false, code: error.code, message: error.message }
      return { ok: false, code: 'REQUEST_FAILED', message: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle(IPC_CHANNELS.NOVELAI_VERSION_RESTORE_MANY, (event, input: unknown) => { const value = record(input); const ids = Array.isArray(input) ? input : value.versionIds; return restoreNovelaiVersions(Array.isArray(ids) ? ids.filter((item): item is string => typeof item === 'string') : [], editOwner(event, value)) })
  ipcMain.handle(IPC_CHANNELS.NOVELAI_BRANCH_LIST, (_event, workId: unknown) => listNovelaiBranches(String(workId ?? '')))
  ipcMain.handle(IPC_CHANNELS.NOVELAI_BRANCH_RENAME, (event, input: unknown) => {
    const value = record(input)
    setNovelaiBranchName(String(value.workId ?? ''), String(value.branchId ?? ''), String(value.name ?? ''), editOwner(event, value))
    return true
  })
  ipcMain.handle(IPC_CHANNELS.NOVELAI_ASSET_LIST, (_event, kind: unknown) => listNovelaiAssets(typeof kind === 'string' && kind ? kind as never : undefined))
  ipcMain.handle(IPC_CHANNELS.NOVELAI_ASSET_CREATE, (_event, input: unknown) => {
    const value = record(input)
    return createNovelaiAsset({ kind: String(value.kind ?? 'other') as never, name: String(value.name ?? ''), payload: typeof value.payload === 'string' ? value.payload : '', examples: Array.isArray(value.examples) ? value.examples.filter((item): item is string => typeof item === 'string') : [] })
  })
  ipcMain.handle(IPC_CHANNELS.NOVELAI_ASSET_UPDATE, (event, input: unknown) => {
    const value = record(input)
    const patch = record(value.patch)
    return updateNovelaiAsset(String(value.id ?? ''), {
      owner: editOwner(event, value),
      ...(patch.expectedRevision === undefined ? {} : { expectedRevision: patch.expectedRevision as number }),
      ...(typeof patch.name === 'string' ? { name: patch.name } : {}),
      ...(typeof patch.payload === 'string' ? { payload: patch.payload } : {}),
      ...(Array.isArray(patch.examples) ? { examples: patch.examples.filter((item): item is string => typeof item === 'string') } : {}),
      ...(typeof patch.kind === 'string' ? { kind: patch.kind as never } : {}),
    })
  })
  ipcMain.handle(IPC_CHANNELS.NOVELAI_ASSET_DELETE, (event, input: unknown) => {
    const value = record(input)
    deleteNovelaiAsset(String(value.id ?? ''), { force: value.force === true, owner: editOwner(event, value), ...(value.expectedRevision === undefined ? {} : { expectedRevision: value.expectedRevision as number }), ...(value.expectedImageIds === undefined ? {} : { expectedImageIds: value.expectedImageIds as string[] }) })
    return true
  })
  ipcMain.handle(IPC_CHANNELS.NOVELAI_ASSET_USE, (event, input: unknown) => {
    const value = record(input)
    recordNovelaiAssetUsage({ assetId: String(value.assetId ?? ''), imageId: String(value.imageId ?? ''), via: typeof value.via === 'string' ? value.via : 'manual', owner: editOwner(event, value) })
    return true
  })
  ipcMain.handle(IPC_CHANNELS.NOVELAI_ASSET_IMAGES, (_event, id: unknown) => listImagesUsingAsset(String(id ?? '')))
  ipcMain.handle(IPC_CHANNELS.NOVELAI_ASSET_BY_IMAGE, (_event, id: unknown) => listAssetsUsedByImage(String(id ?? '')))
  ipcMain.handle(IPC_CHANNELS.NOVELAI_VERSION_LINK_IMAGE, (event, input: unknown) => {
    const value = record(input)
    linkNovelaiVersionImage({ versionId: String(value.versionId ?? ''), imageId: String(value.imageId ?? ''), seed: typeof value.seed === 'number' ? value.seed : null, variant: typeof value.variant === 'string' ? value.variant : '', owner: editOwner(event, value) })
    return true
  })
  ipcMain.handle(IPC_CHANNELS.NOVELAI_ASSET_BY_VERSION, (_event, id: unknown) => listAssetsUsedByVersion(String(id ?? '')))
  ipcMain.handle(IPC_CHANNELS.NOVELAI_ASSET_VERSIONS, (_event, id: unknown) => listVersionsUsingAsset(String(id ?? '')))
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
