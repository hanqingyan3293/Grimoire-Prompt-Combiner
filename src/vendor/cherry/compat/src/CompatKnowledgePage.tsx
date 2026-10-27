import { useCallback } from 'react'
import KnowledgePage from '../../source/src/renderer/pages/knowledge/KnowledgePage'
import { parseKnowledgeRouteSearch } from '../../source/src/renderer/pages/knowledge/routeSearch'
import { useNavigate, useSearch } from './shims/tanstack-router'

// Preserve the source route's base selection and replace-history semantics.
export default function CompatKnowledgePage() {
  const { baseId } = parseKnowledgeRouteSearch(useSearch<Record<string, unknown>>())
  const navigate = useNavigate()
  const onBaseIdChange = useCallback((nextBaseId?: string) => {
    void navigate({
      to: '/app/knowledge',
      search: nextBaseId ? { baseId: nextBaseId } : {},
      replace: true
    })
  }, [navigate])

  return <KnowledgePage baseId={baseId} onBaseIdChange={onBaseIdChange} />
}
