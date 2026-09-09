import { create } from 'zustand'
import { nanoid } from 'nanoid'
import i18n from '@canvas/i18n'
import type { CanvasBackgroundMode } from '@canvas/lib/canvas-theme'
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from '@canvas/types/canvas'

export type CanvasProject = {
  id: string; title: string; createdAt: string; updatedAt: string; nodes: CanvasNodeData[]; connections: CanvasConnection[]; chatSessions: CanvasAssistantSession[]; activeChatId: string | null; backgroundMode: CanvasBackgroundMode; showImageInfo: boolean; viewport: ViewportTransform
}
export type CanvasDeletedProject = { id: string; deletedAt: string }
type CanvasStore = { hydrated: boolean; projects: CanvasProject[]; deletedProjects: CanvasDeletedProject[]; createProject: (title?: string) => string; importProject: (project: Partial<CanvasProject>) => string; openProject: (id: string) => CanvasProject | null; renameProject: (id: string, title: string) => void; deleteProjects: (ids: string[]) => void; replaceProjects: (projects: CanvasProject[], deletedProjects?: CanvasDeletedProject[]) => void; updateProject: (id: string, patch: Partial<Pick<CanvasProject, 'nodes' | 'connections' | 'chatSessions' | 'activeChatId' | 'backgroundMode' | 'showImageInfo' | 'viewport'>>) => void }
const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 }
const pending = new Map<string, CanvasProject>()
let saveTimer: ReturnType<typeof setTimeout> | null = null
let saveChain: Promise<void> = Promise.resolve()
function flushPendingSaves() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  const values = [...pending.values()]
  pending.clear()
  if (!values.length) return saveChain
  saveChain = saveChain.then(async () => {
    for (const value of values) {
      try { await window.api.canvas.vendor.save(value.id, value) }
      catch (error) { console.error('canvas vendor save failed', error) }
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
  const records = await window.api.canvas.vendor.list()
  return Promise.all(records.map(record => window.api.canvas.vendor.get(record.id) as Promise<CanvasProject>))
}
export const useCanvasStore = create<CanvasStore>((set, get) => ({
  hydrated: false, projects: [], deletedProjects: [],
  createProject: (title = i18n.t('canvas.project.untitled')) => {
    const now = new Date().toISOString(); const id = nanoid(); const project: CanvasProject = { id, title, createdAt: now, updatedAt: now, nodes: [], connections: [], chatSessions: [], activeChatId: null, backgroundMode: 'lines', showImageInfo: false, viewport: initialViewport };
    set(state => ({ projects: [project, ...state.projects] })); void window.api.canvas.vendor.create(title, id).then(() => queueSave(project)).catch(console.error); return id
  },
  importProject: source => {
    const now = new Date().toISOString(); const project: CanvasProject = { id: nanoid(), title: source.title || i18n.t('canvas.project.imported'), createdAt: source.createdAt || now, updatedAt: now, nodes: source.nodes || [], connections: source.connections || [], chatSessions: source.chatSessions || [], activeChatId: source.activeChatId || null, backgroundMode: source.backgroundMode || 'lines', showImageInfo: source.showImageInfo || false, viewport: source.viewport || initialViewport };
    set(state => ({ projects: [project, ...state.projects] })); void window.api.canvas.vendor.create(project.title, project.id).then(() => queueSave(project)).catch(console.error); return project.id
  },
  openProject: id => get().projects.find(project => project.id === id) || null,
  renameProject: (id, title) => { set(state => ({ projects: state.projects.map(project => project.id === id ? { ...project, title: title.trim() || project.title, updatedAt: new Date().toISOString() } : project) })); const project = get().projects.find(item => item.id === id); if (project) queueSave(project) },
  deleteProjects: ids => { set(state => ({ projects: state.projects.filter(project => !ids.includes(project.id)), deletedProjects: [...state.deletedProjects, ...ids.map(id => ({ id, deletedAt: new Date().toISOString() }))] })); for (const id of ids) void window.api.canvas.vendor.delete(id).catch(console.error) },
  replaceProjects: (projects, deletedProjects = []) => set({ projects, deletedProjects }),
  updateProject: (id, patch) => {
    set(state => ({ projects: state.projects.map(project => project.id === id ? { ...project, ...patch, updatedAt: new Date().toISOString() } : project) }))
    const project = get().projects.find(item => item.id === id)
    if (project) { pending.set(project.id, project); void flushPendingSaves() }
  },
}))
void loadProjects().then(projects => useCanvasStore.setState({ projects, hydrated: true })).catch(error => { console.error('canvas vendor load failed', error); useCanvasStore.setState({ hydrated: true }) })
if (typeof window !== 'undefined') window.addEventListener('grimoire:refresh', () => { void flushPendingSaves().then(() => loadProjects()).then(projects => useCanvasStore.setState({ projects })).catch(console.error) })
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { void flushPendingSaves() })
  window.addEventListener('beforeunload', () => { void flushPendingSaves() })
}
