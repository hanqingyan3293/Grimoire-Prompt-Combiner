import { useSearch } from './shims/tanstack-router'
import { FilePreviewPage } from '../../source/src/renderer/pages/filePreview/FilePreviewPage'
import { parseFilePreviewRouteSearch } from '../../source/src/renderer/utils/filePreview'

// Reuse the source route validator; invalid or absent paths render the source invalid-path
// state rather than reading a guessed file. FilePreview owns the existing main-process bridge.
export default function CompatFilePreviewPage() {
  const search = useSearch<Record<string, unknown>>()
  const { path } = parseFilePreviewRouteSearch(search)
  return <FilePreviewPage filePath={path} />
}
