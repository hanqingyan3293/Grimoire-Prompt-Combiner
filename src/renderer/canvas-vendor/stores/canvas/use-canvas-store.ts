import { create } from 'zustand'
import { nanoid } from 'nanoid'
import i18n from '@canvas/i18n'
import type { CanvasBackgroundMode } from '@canvas/lib/canvas-theme'
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from '@canvas/types/canvas'

export type CanvasProject = {
  id: string; title: string; createdAt: string; updatedAt: string; revision: number; nodes: CanvasNodeData[]; connections: CanvasConnection[]; chatSessions: CanvasAssistantSession[]; activeChatId: string | null; backgroundMode: CanvasBackgroundMode; showImageInfo: boolean; viewport: ViewportTransform
}
export type CanvasDeletedProject = { id: string; deletedAt: string }
type CanvasStore = { hydrated: boolean; projects: CanvasProject[]; deletedProjects: CanvasDeletedProject[]; saveError: string | null; createProject: (title?: string) => Promise<string>; importProject: (project: Partial<CanvasProject>) => Promise<string>; openProject: (id: string) => CanvasProject | null; renameProject: (id: string, title: string) => void; deleteProjects: (ids: string[]) => void; replaceProjects: (projects: CanvasProject[], deletedProjects?: CanvasDeletedProject[]) => void; updateProject: (id: string, patch: Partial<Pick<CanvasProject, 'nodes' | 'connections' | 'chatSessions' | 'activeChatId' | 'backgroundMode' | 'showImageInfo' | 'viewport'>>) => void; retrySaves: () => Promise<void> }
const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 }
const pending = new Map<string, CanvasProject>()
const SNAPSHOT_PREFIX = 'grimoire.canvas.vendor.snapshot.'
let saveTimer: ReturnType<typeof setTimeout> | null = null
let saveChain: Promise<void> = Promise.resolve()
function flushPendingSaves() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  const values = [...pending.values()]
  pending.clear()
  if (!values.length) return saveChain
  saveChain = saveChain.then(async () => {
    for (const value of values) {
      try {
        const saved = await window.api.canvas.vendor.save(value.id, value) as CanvasProject
        useCanvasStore.setState(state => ({ projects: state.projects.map(project => project.id === value.id && project.revision === value.revision ? { ...project, revision: saved.revision } : project), saveError: null }))
      } catch (error) {
        const latest = useCanvasStore.getState().projects.find(project => project.id === value.id)
        if (latest) pending.set(value.id, latest)
        const message = error instanceof Error ? error.message : '无限画布保存失败'
        useCanvasStore.setState({ saveError: message })
        console.error('canvas vendor save failed', error)
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
  const records = await window.api.canvas.vendor.list()
  const projects = await Promise.all(records.map(record => window.api.canvas.vendor.get(record.id) as Promise<CanvasProject>))
  if (typeof localStorage === 'undefined') return projects
  return projects.map(project => {
    try {
      const snapshot = JSON.parse(localStorage.getItem(`${SNAPSHOT_PREFIX}${project.id}`) || 'null') as CanvasProject | null
      return snapshot && snapshot.id === project.id && snapshot.revision > project.revision ? snapshot : project
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
  useCanvasStore.setState({ projects: merged, hydrated: true })
}
export const useCanvasStore = create<CanvasStore>((set, get) => ({
  hydrated: false, projects: [], deletedProjects: [], saveError: null,
  retrySaves: async () => { set({ saveError: null }); await flushPendingSaves() },
  createProject: async (title = i18n.t('canvas.project.untitled')) => {
    const now = new Date().toISOString(); const id = nanoid(); const project: CanvasProject = { id, title, createdAt: now, updatedAt: now, revision: 0, nodes: [], connections: [], chatSessions: [], activeChatId: null, backgroundMode: 'lines', showImageInfo: false, viewport: initialViewport };
    await window.api.canvas.vendor.create(title, id); set(state => ({ projects: [project, ...state.projects], saveError: null })); return id
  },
  importProject: async source => {
    const now = new Date().toISOString(); const project: CanvasProject = { id: nanoid(), title: source.title || i18n.t('canvas.project.imported'), createdAt: source.createdAt || now, updatedAt: now, revision: 0, nodes: source.nodes || [], connections: source.connections || [], chatSessions: source.chatSessions || [], activeChatId: source.activeChatId || null, backgroundMode: source.backgroundMode || 'lines', showImageInfo: source.showImageInfo || false, viewport: source.viewport || initialViewport };
    await window.api.canvas.vendor.create(project.title, project.id); set(state => ({ projects: [project, ...state.projects], saveError: null })); queueSave(project); return project.id
  },
  openProject: id => get().projects.find(project => project.id === id) || null,
  renameProject: (id, title) => { set(state => ({ projects: state.projects.map(project => project.id === id ? { ...project, title: title.trim() || project.title, revision: project.revision + 1, updatedAt: new Date().toISOString() } : project) })); const project = get().projects.find(item => item.id === id); if (project) queueSave(project) },
  deleteProjects: ids => { set(state => ({ projects: state.projects.filter(project => !ids.includes(project.id)), deletedProjects: [...state.deletedProjects, ...ids.map(id => ({ id, deletedAt: new Date().toISOString() }))] })); for (const id of ids) void window.api.canvas.vendor.delete(id).catch(console.error) },
  replaceProjects: (projects, deletedProjects = []) => set({ projects, deletedProjects }),
  updateProject: (id, patch) => {
    set(state => ({ projects: state.projects.map(project => project.id === id ? { ...project, ...patch, revision: project.revision + 1, updatedAt: new Date().toISOString() } : project) }))
    const project = get().projects.find(item => item.id === id)
    if (project) {
      try { localStorage.setItem(`${SNAPSHOT_PREFIX}${project.id}`, JSON.stringify(project)) } catch {}
      pending.set(project.id, project); void flushPendingSaves()
    }
  },
}))
void loadProjects().then(mergeLoadedProjects).catch(error => { console.error('canvas vendor load failed', error); useCanvasStore.setState({ hydrated: true }) })
if (typeof window !== 'undefined') window.addEventListener('grimoire:refresh', () => { void flushPendingSaves().then(loadProjects).then(mergeLoadedProjects).catch(console.error) })
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { void flushPendingSaves() })
  window.addEventListener('beforeunload', () => { void flushPendingSaves() })
}
