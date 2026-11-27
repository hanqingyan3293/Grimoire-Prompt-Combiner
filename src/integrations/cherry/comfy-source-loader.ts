import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const requireFromHere = createRequire(typeof __filename === 'string' ? __filename : path.join(process.cwd(), 'package.json'))
let cachedSource: unknown

/** One loader for the audited, bundle-only Cherry source boundary. */
export function loadComfySourceBundle<T>(): T {
  if (!cachedSource) {
    const here = typeof __dirname === 'string' ? __dirname : process.cwd()
    const candidates = [path.join(here, 'comfy-source.cjs'), path.join(process.cwd(), 'dist/main/integrations/cherry/comfy-source.cjs')]
    const found = candidates.find(candidate => fs.existsSync(candidate))
    if (!found) throw new Error('Comfy source bundle missing; run npm run build:comfy-source')
    cachedSource = requireFromHere(found)
  }
  return cachedSource as T
}

export interface ComfyIpClassification { loopback: boolean; public: boolean }

export function classifyComfyIpAddress(address: string): ComfyIpClassification {
  const source = loadComfySourceBundle<{ classifyComfyIpAddress(address: string): ComfyIpClassification }>()
  if (typeof source.classifyComfyIpAddress !== 'function') throw new Error('Comfy network source bundle is stale; run npm run build:comfy-source')
  return source.classifyComfyIpAddress(address)
}
