export interface NovelaiEditResource { kind: 'work' | 'asset'; id: string }
export interface NovelaiEditLease { resource: NovelaiEditResource; leaseId: string; expiresAt: number }
export type NovelaiEditLeaseResult = { ok: true; lease: NovelaiEditLease } | { ok: false; code: string; message: string }
export type NovelaiEditReleaseResult = { ok: true; released: boolean } | { ok: false; code: string; message: string }
export interface NovelaiEditProof { editorKey: string; leaseId: string }
