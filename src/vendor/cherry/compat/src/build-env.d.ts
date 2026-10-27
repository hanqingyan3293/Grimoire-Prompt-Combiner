import type { AppEdition } from '../../source/src/shared/types/appEdition'
import type { ReleaseNotesEntry } from '../../source/src/shared/utils/releaseNotes'

// Injected by vite.shared.config.ts in both the production build and Vitest.
declare global {
  const __APP_EDITION__: AppEdition
  const __APP_RELEASE_NOTES__: string
  const __APP_RELEASE_VERSION__: string
  const __APP_RELEASE_HISTORY__: readonly ReleaseNotesEntry[]
}
