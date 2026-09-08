import { create } from 'zustand'
import { nanoid } from 'nanoid'

export type AssetKind = 'text' | 'image' | 'video'
type AssetBase<T extends AssetKind> = { id: string; kind: T; title: string; coverUrl: string; tags: string[]; source?: string; note?: string; createdAt: string; updatedAt: string; metadata?: Record<string, unknown> }
export type TextAsset = AssetBase<'text'> & { data: { content: string } }
export type ImageAsset = AssetBase<'image'> & { data: { dataUrl: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } }
export type VideoAsset = AssetBase<'video'> & { data: { url: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } }
export type Asset = TextAsset | ImageAsset | VideoAsset

type AssetStore = {
  hydrated: boolean
  assets: Asset[]
  addAsset: (asset: Omit<Asset, 'id' | 'createdAt' | 'updatedAt'>) => string
  updateAsset: (id: string, patch: Partial<Omit<Asset, 'id' | 'createdAt'>>) => void
  removeAsset: (id: string) => void
  replaceAssets: (assets: Asset[]) => void
  cleanupImages: (extra?: unknown) => void
  refresh: () => Promise<void>
}

type ImageRow = { id: number; file_path: string; original_name: string | null; mime_type: string | null; file_size: number | null; available: boolean }
type PromptRow = { id: string; sourceRef: string; source: string; name: string; prompt: string; detail: string; createdAt: string; nsfw: boolean; variantCount: number }

async function mapImage(image: ImageRow): Promise<ImageAsset | null> {
  try {
    const url = await window.api.images.readData(image.id)
    return { id: `image:${image.id}`, kind: 'image', title: image.original_name || `图片 ${image.id}`, coverUrl: url, tags: [], source: 'grimoire-image-library', createdAt: '', updatedAt: '', data: { dataUrl: url, width: 0, height: 0, bytes: image.file_size || 0, mimeType: image.mime_type || 'image/*' } }
  } catch {
    return null
  }
}
function mapPrompt(row: PromptRow): TextAsset {
  return { id: `prompt:${row.sourceRef}`, kind: 'text', title: row.name, coverUrl: '', tags: [], source: row.source, note: row.detail, createdAt: row.createdAt, updatedAt: row.createdAt, data: { content: row.prompt }, metadata: { sourceRef: row.sourceRef, nsfw: row.nsfw, variantCount: row.variantCount } }
}

export const useAssetStore = create<AssetStore>((set, get) => ({
  hydrated: false,
  assets: [],
  refresh: async () => {
    const imagesPromise = window.api.images.list()
    const promptItems: PromptRow[] = []
    const pageSize = 100
    for (let offset = 0; offset < 10000; offset += pageSize) {
      const page = await window.api.promptAssets.list({ source: 'asset', limit: pageSize, offset })
      promptItems.push(...page.items as PromptRow[])
      if (!page.items.length || promptItems.length >= page.total) break
    }
    const images = await imagesPromise
    const imageAssets = (await Promise.all(images.filter(image => image.available).map(mapImage))).filter((asset): asset is ImageAsset => Boolean(asset))
    set({ assets: [...imageAssets, ...promptItems.map(mapPrompt)] })
  },
  addAsset: (asset) => {
    const now = new Date().toISOString()
    const id = nanoid()
    set(state => ({ assets: [{ ...asset, id, createdAt: now, updatedAt: now } as Asset, ...state.assets] }))
    if (asset.kind === 'text') {
      const textAsset = asset as Omit<TextAsset, 'id' | 'createdAt' | 'updatedAt'>
      void window.api.promptAssets.create({ name: textAsset.title, prompt: textAsset.data.content, detail: textAsset.note || textAsset.source || '画布资产', sourceId: id }).then(() => get().refresh()).catch(error => {
        console.error('canvas prompt asset save failed', error)
        get().removeAsset(id)
      })
    }
    return id
  },
  updateAsset: (id, patch) => set(state => ({ assets: state.assets.map(asset => asset.id === id ? ({ ...asset, ...patch, updatedAt: new Date().toISOString() } as Asset) : asset) })),
  removeAsset: (id) => {
    set(state => ({ assets: state.assets.filter(asset => asset.id !== id) }))
    if (id.startsWith('image:')) void window.api.images.delete(Number(id.slice(6))).then(() => get().refresh()).catch(console.error)
    if (id.startsWith('prompt:')) void window.api.promptAssets.delete(id.slice(7)).then(() => get().refresh()).catch(console.error)
  },
  replaceAssets: (assets) => set({ assets }),
  cleanupImages: () => undefined,
}))

async function refreshWhenApiReady(attempt = 0): Promise<void> {
  if (!window.api?.images?.list || !window.api?.promptAssets?.list) {
    if (attempt < 40) {
      await new Promise(resolve => window.setTimeout(resolve, 50))
      return refreshWhenApiReady(attempt + 1)
    }
    throw new Error('魔导书 API 尚未就绪')
  }
  await useAssetStore.getState().refresh()
}

void refreshWhenApiReady().then(() => useAssetStore.setState({ hydrated: true })).catch(error => {
  console.error('grimoire asset library load failed', error)
  useAssetStore.setState({ hydrated: true })
})
if (typeof window !== 'undefined') {
  window.addEventListener('grimoire:refresh', () => { void refreshWhenApiReady().catch(console.error) })
  window.addEventListener('grimoire:canvas-mounted', () => { void refreshWhenApiReady().catch(console.error) })
}
