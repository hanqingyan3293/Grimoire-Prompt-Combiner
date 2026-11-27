export type ImageCleanupStage = {
  stage: 'file'|'derivatives'
  status: 'removed'|'retained'|'not-found'|'partial'|'failed'
  removedPaths?: string[]
  indeterminatePaths?: string[]
  reason?: 'external'|'shared'
  code?: string
  message?: string
}

export type ImageCleanupResult = {
  imageRefId: number
  status: 'completed'|'partial'|'failed'
  removedFile: boolean
  /** True only when the entire derivative directory is gone; child removals are in stages. */
  removedDerivatives: boolean
  stages: ImageCleanupStage[]
}

export type ImageDeleteBatchResult = {
  status: 'completed'|'partial'|'failed'
  deletedIds: number[]
  cleanup: ImageCleanupResult[]
  failures: Array<{ imageRefId: number; code: string; message: string }>
}
