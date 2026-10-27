import { BrowserPage } from '../../source/src/renderer/pages/browser/BrowserPage'
import { normalizeBrowserEntryUrl } from '../../source/src/shared/utils/browserUrl'
import { useSearch } from './shims/tanstack-router'

export function browserEntryFromSearch(search: Record<string, unknown>): string {
  const url = search.url
  return typeof url !== 'string' || !url.trim() || url === 'about:blank'
    ? 'about:blank'
    : normalizeBrowserEntryUrl(url)
}

// The source browser route validates the URL before passing it to the page.
export default function CompatBrowserPage() {
  return <BrowserPage initialUrl={browserEntryFromSearch(useSearch<Record<string, unknown>>())} />
}
