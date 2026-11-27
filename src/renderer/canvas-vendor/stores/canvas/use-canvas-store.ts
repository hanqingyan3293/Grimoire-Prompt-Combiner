import { create } from 'zustand'
import { nanoid } from 'nanoid'
import i18n from '@canvas/i18n'
import type { CanvasBackgroundMode } from '@canvas/lib/canvas-theme'
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from '@canvas/types/canvas'

export type CanvasProject = {
  id: string; title: string; createdAt: string; updatedAt: string; revision: number; nodes: CanvasNodeData[]; connections: CanvasConnection[]; chatSessions: CanvasAssistantSession[]; activeChatId: string | null; backgroundMode: CanvasBackgroundMode; showImageInfo: boolean; viewport: ViewportTransform
}
export type CanvasDeletedProject = { id: string; deletedAt: string }
type CanvasStore = { hydrated: boolean; hydrationError: string | null; projects: CanvasProject[]; deletedProjects: CanvasDeletedProject[]; saveError: string | null; createProject: (title?: string) => Promise<string>; importProject: (project: Partial<CanvasProject>) => Promise<string>; openProject: (id: string) => CanvasProject | null; renameProject: (id: string, title: string) => void; deleteProjects: (ids: string[]) => void; replaceProjects: (projects: CanvasProject[], deletedProjects?: CanvasDeletedProject[]) => void; updateProject: (id: string, patch: Partial<Pick<CanvasProject, 'nodes' | 'connections' | 'chatSessions' | 'activeChatId' | 'backgroundMode' | 'showImageInfo' | 'viewport'>>, expectedRevision?: number) => boolean; retrySaves: () => Promise<void>; retryHydration: () => Promise<void> }
const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 }
const pending = new Map<string, CanvasProject>()
const committedRevisions = new Map<string, number>()
const recoveryConflicts = new Map<string, string>()
export const getCommittedCanvasProjectRevision = (id: string): number | undefined => committedRevisions.get(id)
const saving = new Map<string, number>()
const SNAPSHOT_PREFIX = 'grimoire.canvas.vendor.snapshot.'
let saveTimer: ReturnType<typeof setTimeout> | null = null
let saveChain: Promise<void> = Promise.resolve()
function cacheRecoverySnapshot(project: CanvasProject, replaceStale = false, baseRevision = committedRevisions.get(project.id) ?? 0) {
  if (recoveryConflicts.has(project.id) && !replaceStale) return
  if (replaceStale) {
    try { localStorage.removeItem(`${SNAPSHOT_PREFIX}${project.id}`) }
    catch (error) { throw new Error('CANVAS_CACHE_INVALIDATION_FAILED: ' + (error instanceof Error ? error.message : String(error))) }
  }
  try { localStorage.setItem(SNAPSHOT_PREFIX + project.id, JSON.stringify({ version: 1, baseRevision, project })) }
  catch (error) { console.warn('Canvas local recovery snapshot unavailable', error instanceof Error ? error.message : String(error)) }
  if (replaceStale) recoveryConflicts.delete(project.id)
}
function flushPendingSaves() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  const values = [...pending.values()]
  pending.clear()
  if (!values.length) return saveChain
  for (const value of values) saving.set(value.id, (saving.get(value.id) || 0) + 1)
  saveChain = saveChain.then(async () => {
    for (const value of values) {
      try {
        const conflict = recoveryConflicts.get(value.id)
        if (conflict) throw new Error(conflict)
        const baseRevision = committedRevisions.get(value.id) ?? Math.max(0, value.revision - 1)
        const saved = await window.api.canvas.vendor.save(value.id, { ...value, revision: baseRevision + 1 }) as CanvasProject
        committedRevisions.set(value.id, saved.revision)
        useCanvasStore.setState(state => ({ localSaveRevisions: { ...state.localSaveRevisions, [value.id]: saved.revision }, projects: state.projects.map(project => {
          if (project !== value) { if (project.id === value.id) cacheRecoverySnapshot(project); return project }
          const committed = { ...project, revision: saved.revision }
          cacheRecoverySnapshot(committed)
          return committed
        }), saveError: [...recoveryConflicts.values()][0] || null }))
      } catch (error) {
        const latest = useCanvasStore.getState().projects.find(project => project.id === value.id)
        if (latest) pending.set(value.id, latest)
        const message = error instanceof Error ? error.message : '无限画布保存失败'
        useCanvasStore.setState({ saveError: message })
        console.error('canvas vendor save failed', error)
      } finally {
        const remaining = (saving.get(value.id) || 1) - 1
        if (remaining) saving.set(value.id, remaining); else saving.delete(value.id)
      }
    }
  })
  return saveChain
}
function queueSave(project: CanvasProject) {
  pending.set(project.id, project)
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => { saveTimer = null; void flushPendingSaves() }, 0)
}
async function loadProjects() {
  await waitForCanvasApi()
  const revisionsAtStart = new Map(committedRevisions)
  const staleReads = new Set<string>()
  const records = await window.api.canvas.vendor.list()
  const projects = await Promise.all(records.map(record => window.api.canvas.vendor.get(record.id) as Promise<CanvasProject>))
  for (let index = 0; index < projects.length; index += 1) {
    const project = projects[index], known = committedRevisions.get(project.id)
    if (known !== undefined && project.revision < known && known > (revisionsAtStart.get(project.id) ?? -1)) {
      const current = useCanvasStore.getState().openProject(project.id)
      if (!current) throw new Error('CANVAS_REFRESH_STALE: 旧读取不再对应当前画布')
      projects[index] = current; staleReads.add(project.id); continue
    }
    if (!pending.has(project.id) && !saving.has(project.id)) committedRevisions.set(project.id, project.revision)
  }
  if (typeof localStorage === 'undefined') return projects
  return projects.map(project => {
    if (staleReads.has(project.id)) return project
    try {
      const raw = localStorage.getItem(SNAPSHOT_PREFIX + project.id)
      if (!raw) { recoveryConflicts.delete(project.id); return project }
      const value = JSON.parse(raw) as CanvasProject & { version?: number; baseRevision?: number; project?: CanvasProject }
      const snapshot = value?.version === 1 ? value.project : value
      if (!snapshot || snapshot.id !== project.id || !Array.isArray(snapshot.nodes) || !Array.isArray(snapshot.connections) || !Array.isArray(snapshot.chatSessions)) return project
      const content = (item: CanvasProject) => JSON.stringify([item.title, item.nodes, item.connections, item.chatSessions, item.activeChatId, item.backgroundMode, item.showImageInfo, item.viewport])
      if (content(snapshot) === content(project)) { recoveryConflicts.delete(project.id); return project }
      if (value.version === 1 && Number.isSafeInteger(value.baseRevision) && value.baseRevision === project.revision) { recoveryConflicts.delete(project.id); return snapshot }
      const message = 'CANVAS_RECOVERY_CONFLICT: 本地恢复副本缺少有效保存基线或远端版本已变化；副本已保留，未写入远端'
      recoveryConflicts.set(project.id, message)
      useCanvasStore.setState({ saveError: message })
      return snapshot
    } catch { return project }
  })
}
async function waitForCanvasApi(timeoutMs = 10000) {
  const startedAt = Date.now()
  while (!window.api?.canvas?.vendor) {
    if (Date.now() - startedAt >= timeoutMs) throw new Error('无限画布 API 桥接未就绪')
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}
function mergeLoadedProjects(loaded: CanvasProject[]) {
  const loadedById = new Map(loaded.map(project => [project.id, project]))
  const current = useCanvasStore.getState().projects
  const preserved = current.filter(project => {
    const incoming = loadedById.get(project.id)
    const pendingProject = pending.get(project.id)
    return !incoming || Boolean(pendingProject) || project.revision > incoming.revision
  })
  const merged = [...preserved, ...loaded.filter(project => !preserved.some(item => item.id === project.id))]
  useCanvasStore.setState({ projects: merged, hydrated: true, hydrationError: null })
}
export const useCanvasStore = create<CanvasStore & { localSaveRevisions: Record<string, number> }>((set, get) => ({
  localSaveRevisions: {},
  hydrated: false, hydrationError: null, projects: [], deletedProjects: [], saveError: null,
  retrySaves: async () => { set({ saveError: [...recoveryConflicts.values()][0] || null }); await flushPendingSaves() },
  retryHydration: async () => {
    set({ hydrated: false, hydrationError: null })
    try { await loadProjects().then(mergeLoadedProjects) }
    catch (error) { set({ hydrated: true, hydrationError: error instanceof Error ? error.message : String(error) }) }
  },
  createProject: async (title = i18n.t('canvas.project.untitled')) => {
    const now = new Date().toISOString(); const id = nanoid(); const project: CanvasProject = { id, title, createdAt: now, updatedAt: now, revision: 0, nodes: [], connections: [], chatSessions: [], activeChatId: null, backgroundMode: 'lines', showImageInfo: false, viewport: initialViewport };
    await window.api.canvas.vendor.create(title, id); committedRevisions.set(id, 0); set(state => ({ projects: [project, ...state.projects], saveError: null })); return id
  },
  importProject: async source => {
    const now = new Date().toISOString(); const project: CanvasProject = { id: nanoid(), title: source.title || i18n.t('canvas.project.imported'), createdAt: source.createdAt || now, updatedAt: now, revision: 0, nodes: source.nodes || [], connections: source.connections || [], chatSessions: source.chatSessions || [], activeChatId: source.activeChatId || null, backgroundMode: source.backgroundMode || 'lines', showImageInfo: source.showImageInfo || false, viewport: source.viewport || initialViewport };
    await window.api.canvas.vendor.create(project.title, project.id); committedRevisions.set(project.id, 0); set(state => ({ projects: [project, ...state.projects], saveError: null })); queueSave(project); return project.id
  },
  openProject: id => get().projects.find(project => project.id === id) || null,
  renameProject: (id, title) => { set(state => ({ projects: state.projects.map(project => project.id === id ? { ...project, title: title.trim() || project.title, revision: project.revision + 1, updatedAt: new Date().toISOString() } : project) })); const project = get().projects.find(item => item.id === id); if (project) queueSave(project) },
  deleteProjects: ids => { set(state => ({ projects: state.projects.filter(project => !ids.includes(project.id)), deletedProjects: [...state.deletedProjects, ...ids.map(id => ({ id, deletedAt: new Date().toISOString() }))] })); for (const id of ids) void window.api.canvas.vendor.delete(id).catch(console.error) },
  replaceProjects: (projects, deletedProjects = []) => { if (!projects.length) { recoveryConflicts.clear(); set({ localSaveRevisions: {} }) }; set({ projects, deletedProjects }) },
  updateProject: (id, patch, expectedRevision) => {
    const conflict = recoveryConflicts.get(id)
    if (conflict || expectedRevision !== undefined && committedRevisions.get(id) !== expectedRevision) {
      set({ saveError: conflict || 'CANVAS_REVISION_CONFLICT: 另一处已更新画布，本地内容已保留，自动保存已停止' })
      return false
    }
    set(state => ({ projects: state.projects.map(project => project.id === id ? { ...project, ...patch, revision: project.revision + 1, updatedAt: new Date().toISOString() } : project) }))
    const project = get().projects.find(item => item.id === id)
    if (project) {
      cacheRecoverySnapshot(project)
      pending.set(project.id, project); void flushPendingSaves()
    }
    return Boolean(project)
  },
}))

/** Settling the legacy queue is insufficient: failed writes deliberately requeue their drafts. */
export async function flushCanvasSaves(): Promise<void> {
  let observed: Promise<void>
  do {
    observed = flushPendingSaves()
    await observed
    const error = useCanvasStore.getState().saveError
    if (error || pending.size) throw new Error('CANVAS_SAVE_FAILED: ' + (error || '画布仍有未保存修改'))
  } while (observed !== saveChain)
}

export async function hydrateCanvasTransferProject(id: string, minimumRevision: number, replaceUnsaved = false, isCurrent?: () => boolean): Promise<CanvasProject> {
  if (replaceUnsaved) await saveChain
  const local = useCanvasStore.getState().openProject(id)
  const project = await window.api.canvas.vendor.get(id) as CanvasProject | null
  if (!project || project.id !== id || !Number.isSafeInteger(project.revision) || project.revision < minimumRevision) throw new Error('CANVAS_REVISION_NOT_READY: 持久画布版本尚未达到移交版本')
  if (replaceUnsaved && (local !== useCanvasStore.getState().openProject(id) || isCurrent?.() === false)) throw new Error('CANVAS_LOCAL_CHANGED: 读取期间本地内容已改变，未替换当前草稿')
  if (saving.has(id) || pending.has(id) && !replaceUnsaved) throw new Error('CANVAS_SAVE_FAILED: 目标画布仍有未保存修改')
  cacheRecoverySnapshot(project, true, project.revision)
  if (replaceUnsaved) pending.delete(id)
  committedRevisions.set(id, project.revision)
  useCanvasStore.setState(state => ({ projects: [...state.projects.filter(item => item.id !== id), project], localSaveRevisions: Object.fromEntries(Object.entries(state.localSaveRevisions).filter(([key]) => key !== id)), saveError: pending.size ? state.saveError : [...recoveryConflicts.values()][0] || null }))
  return project
}
void loadProjects().then(mergeLoadedProjects).catch(error => {
  const message = error instanceof Error ? error.message : String(error)
  console.error('canvas vendor load failed', error)
  useCanvasStore.setState({ hydrated: true, hydrationError: message })
})
if (typeof window !== 'undefined') window.addEventListener('grimoire:refresh', () => { void flushPendingSaves().then(loadProjects).then(mergeLoadedProjects).catch(console.error) })
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { void flushPendingSaves() })
  window.addEventListener('beforeunload', () => { void flushPendingSaves() })
}
