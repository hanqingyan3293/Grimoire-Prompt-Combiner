import { useEffect } from 'react'
import { cacheService } from '../../source/src/renderer/data/CacheService'

// Mirror the gateway's real state into the source shared cache (M3).
//
// Cherry's main process writes `feature.api_gateway.running` into a cache the renderer reads
// reactively; Grimoire's gateway lives in our main process behind `api_gateway.status`. Without
// this bridge the page would always render "stopped" even when the server is listening — the
// exact fake-state this project keeps removing.
export function CompatApiGatewayBridge() {
  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const result = await window.api?.ipcApi?.request('api_gateway.status' as never)
        const data = (result as { data?: { running?: boolean; port?: number } } | undefined)?.data
        if (!alive || !data) return
        cacheService.setShared('feature.api_gateway.running' as never, Boolean(data.running) as never)
      } catch {
        // A status probe failure must not break the settings page; the badge simply stays as-is.
      }
    }
    void tick()
    const timer = setInterval(() => { void tick() }, 2000)
    return () => { alive = false; clearInterval(timer) }
  }, [])
  return null
}
