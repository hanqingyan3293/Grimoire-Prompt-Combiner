// Browser data clearing (M3).
//
// Wraps the Electron session APIs the source clear-dialog exposes. The session and its methods are
// injected so the scope handling can be tested without a live browser partition; what matters is that
// an unselected scope is never cleared and a failing scope is reported rather than swallowed.
export interface ClearableSession {
  clearCache(): Promise<void>
  clearStorageData(options?: { storages?: string[] }): Promise<void>
  clearAuthCache?(options?: { origin?: string }): Promise<void>
  clearHostResolverCache?(): Promise<void>
}

export type ClearScope = 'cache' | 'cookies' | 'storage' | 'auth'

export interface ClearResult { readonly cleared: ClearScope[]; readonly failed: Array<{ scope: ClearScope; message: string }> }

export async function clearBrowserData(session: ClearableSession, scopes: ClearScope[]): Promise<ClearResult> {
  const cleared: ClearScope[] = []
  const failed: Array<{ scope: ClearScope; message: string }> = []
  for (const scope of scopes) {
    try {
      if (scope === 'cache') await session.clearCache()
      // `cookies` and `storage` both go through clearStorageData; the storages list is what differs.
      else if (scope === 'cookies') await session.clearStorageData({ storages: ['cookies'] })
      else if (scope === 'storage') await session.clearStorageData({ storages: ['localstorage', 'indexdb', 'websql', 'shadercache', 'serviceworkers', 'cachestorage'] })
      else if (scope === 'auth') {
        if (!session.clearAuthCache) throw new Error('auth cache clearing is unavailable on this platform')
        await session.clearAuthCache({})
      }
      cleared.push(scope)
    } catch (error) {
      failed.push({ scope, message: error instanceof Error ? error.message : String(error) })
    }
  }
  return { cleared, failed }
}

export const BROWSER_CLEAR_SCOPES: readonly ClearScope[] = ['cache', 'cookies', 'storage', 'auth']
