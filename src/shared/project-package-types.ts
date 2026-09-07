import type { CanvasDocument } from './canvas-types'

export interface ProjectPackageImage {
  sourceId: number
  originalName: string | null
  mimeType: string | null
  fileSize: number | null
  dataBase64?: string
  archivePath?: string
}

export interface ProjectPackage {
  kind: 'grimoire-project'
  version: 1
  created_at: string
  project: { name: string; document: CanvasDocument }
  images: ProjectPackageImage[]
  taskSummaries: Array<{ id: string; kind: string; status: string; output_json: string | null }>
  workflows: Array<{ id: string; name: string; raw_json: string; analysis_json: string; bindings_json: string }>
  promptAssets: Array<{ source_id: string; source: string; name: string; prompt: string; chapter: string; section: string; subsection: string; nsfw: number; variant_count: number; source_fingerprint: string }>
}

export interface ProjectPackageImportResult {
  projectId: string
  projectName: string
  importedImages: number
  skippedImages: number
  warnings: string[]
  importedPromptAssets: number
  importedWorkflows: number
}
