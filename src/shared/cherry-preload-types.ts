export type CherryHttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

export type CherryDataApiRequest = {
  id: string
  method: CherryHttpMethod
  path: string
  params?: Readonly<Record<string, unknown>>
  body?: unknown
  headers?: Readonly<Record<string, string>>
  metadata?: {
    timestamp: number
    spanContext?: unknown
  }
}

export type CherryDataApiError = {
  code: string
  message: string
  status: number
  details?: Readonly<Record<string, unknown>>
}

export type CherryDataApiResponse = {
  id: string
  status: number
  data?: unknown
  error?: CherryDataApiError
  metadata?: {
    duration?: number
    handlerDuration?: number
    cached?: boolean
    cacheTtl?: number
    timestamp: number
  }
}

// Only the effect routes emitted by the host are declared. This is not an
// open-ended claim that every source domain has a live change producer.
export type CherryDataApiDataChangeEffect = {
  readonly entityIds?: readonly string[]
  readonly routeParams?: Readonly<Record<string, string>>
} & (
  | {
    readonly endpoint: '/agents/:agentId' | '/agent-workspaces/:workspaceId' | '/topics/:topicId/tree' | '/topics/:id' | '/agent-sessions/:sessionId' | '/agent-sessions/latest'
    readonly kind?: never
    readonly dimension?: never
  }
  | ({ readonly endpoint: '/agents' | '/agent-workspaces' | '/topics/:topicId/messages' | '/topics' | '/agent-sessions' } & (
    | { readonly kind: 'projection'; readonly dimension?: never }
    | { readonly kind: 'membership'; readonly dimension?: string }
    | { readonly kind: 'order'; readonly dimension: string }
  ))
)

export type CherryCacheEntry = {
  value: unknown
  expireAt?: number
}

export type CherryCacheSyncMessage = {
  type: 'shared' | 'persist'
  key: string
  value: unknown
  expireAt?: number
}

