import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Grimoire-backed replacement for the source `@renderer/hooks/useOpenReleaseNotes`.
 *
 * The source implementation is `const { openTab } = useTabs()` and calls
 * `openTab('/app/release-notes', …)`. `useTabs` reads `TabsContext`, which only the source
 * `TabsProvider` supplies — and the compat window deliberately does NOT mount it: that
 * provider owns the source tab bar (tab LRU/dormancy, drag reorder, detach/attach,
 * `AgentBrowserRuntimeHost`, conversation-navigation ownership), which is app-shell
 * infrastructure the compat window replaces with its hash route registry.
 *
 * Without this shim, mounting `AboutSettings` crashes the whole page with
 * `useTabsContext must be used within a TabsProvider`. That was verified live, not
 * inferred: the About route hung the route audit and the renderer logged exactly that
 * error from the error boundary — the page renders nothing because a helper hook three
 * levels down reaches for the tab shell.
 *
 * The compatible behaviour is the one the user observes: the source opens the release
 * notes as a TAB; the compat window navigates to the equivalent ROUTE. Replacing
 * `TabsProvider` wholesale was rejected — it is a large app-shell component whose other
 * responsibilities (browser runtime host, tab persistence) have no compat counterpart,
 * and mounting it to satisfy one navigation call would introduce more unmigrated state
 * than it removes.
 *
 * This mirrors the `navigateCompatRoute` contract the rest of the compat surface uses.
 */
export function useOpenReleaseNotes() {
  const { t } = useTranslation()

  return useCallback(() => {
    // The source route the tab would have opened.
    if (typeof window !== 'undefined') {
      window.location.hash = '#/app/release-notes'
    }
  }, [t])
}
