export type WD14TagItem = { name: string; confidence: number }

export type WD14TagBuckets = {
  general: WD14TagItem[]
  character: WD14TagItem[]
  rating: WD14TagItem[]
  quality: WD14TagItem[]
}

export type WD14HistoryRecord = {
  id: string
  task_id: string
  image_id: number
  image_name: string
  tags: WD14TagBuckets
  model_id: string
  threshold: number
  status: "succeeded" | "failed"
  error_message: string | null
  image_snapshot_available?: boolean
  /** Managed snapshot path; only exposed for the main-process-to-renderer reveal action. */
  image_snapshot_path?: string | null
  created_at: string
}
