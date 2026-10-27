// Read-only Pi SDK DIRECT_REUSE surface gate.
// It imports the installed ESM package and inspects exports only: no profile,
// credentials, session, extension, tool execution, network, or provider request.
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const modulePath = pathToFileURL(path.join(root, 'dist/main/integrations/pi/piSdk.js')).href
const { inspectPiSdkSurface } = await import(modulePath)
const report = await inspectPiSdkSurface()
if (process.env.GRIMOIRE_PI_SDK_RUNTIME === '1') throw new Error('Pi SDK runtime enablement is gated until a production adapter is explicitly registered')
assert.equal(report.esmOnly, true)
console.log(JSON.stringify({ passed: report.loaded, scope: 'export surface only; no credentials/profile/session/provider access', report }, null, 2))
process.exitCode = report.loaded ? 0 : 1
