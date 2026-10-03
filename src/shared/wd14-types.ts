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
  created_at: string
}
