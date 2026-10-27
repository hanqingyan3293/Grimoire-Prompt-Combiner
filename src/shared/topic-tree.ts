// Cherry Studio 2.1.4 (AGPL-3.0): partial extraction/adaptation of
// shared/data/types/message.ts and MessageService.getBranchMessages lines 747-765.
// Foundation only: no siblings, file references, usage or runtime contracts.
export const TOPIC_CONTENT_ROLES = ['user', 'assistant', 'system'] as const
export const TOPIC_MESSAGE_STATUSES = ['pending', 'success', 'error', 'paused'] as const
export type TopicContentRole = typeof TOPIC_CONTENT_ROLES[number]
export type TopicMessageStatus = typeof TOPIC_MESSAGE_STATUSES[number]
export interface TopicMessageData { parts?: Array<Record<string, unknown>>; [key: string]: unknown }
export interface TopicTreeMessage {
  id: string
  topicId: string
  parentId: string
  role: TopicContentRole
  data: TopicMessageData
  status: TopicMessageStatus
  siblingsGroupId: 0
  createdAt: string
  updatedAt: string
}
export interface AppendTopicMessage {
  parentId?: string | null
  role: TopicContentRole
  data: TopicMessageData
  status?: TopicMessageStatus
  setAsActive?: boolean
}
export interface TopicTreeState {
  topicId: string
  rootId: string
  activeNodeId: string | null
  assistantId: string | null
}
export interface TopicBranchQuery { nodeId?: string; cursor?: string; limit?: number }
export interface TopicBranchResponse extends Omit<TopicTreeState, 'topicId'> {
  items: Array<{ message: TopicTreeMessage }>
  nextCursor?: string
}
export class TopicTreeError extends Error {
  constructor(public readonly code: 'NOT_FOUND' | 'UNSUPPORTED' | 'INVALID_OPERATION' | 'VALIDATION' | 'INTEGRITY', message: string) {
    super(`${code}: ${message}`)
    this.name = 'TopicTreeError'
  }
}
/** Source's pure exclusive-before pagination, extracted without ORM dependencies. */
export function pageTopicPath<T extends { id: string }>(fullPath: T[], cursor: string | undefined, limit: number): { items: T[]; nextCursor?: string } {
  let startIndex = 0
  let endIndex = fullPath.length
  if (cursor) {
    const cursorIndex = fullPath.findIndex((m) => m.id === cursor)
    if (cursorIndex === -1) throw new TopicTreeError('NOT_FOUND', `Message (cursor): ${cursor}`)
    startIndex = Math.max(0, cursorIndex - limit)
    endIndex = cursorIndex
  } else {
    startIndex = Math.max(0, fullPath.length - limit)
  }
  const paginatedPath = fullPath.slice(startIndex, endIndex)
  const nextCursor = startIndex > 0 ? fullPath[startIndex].id : undefined
  return { items: paginatedPath, nextCursor }
}
