// Visual-baseline driver for the Cherry compat window.
//
// Runs the Electron app twice against isolated user-data directories in capture
// mode: once with the seeded fixture (populated) and once against an empty database
// (empty state). Screenshots land in artifacts/visual/<run>/. The app itself seeds
// through real services and captures via webContents.capturePage (see
// src/main/visual-capture.ts); this script only prepares directories and reports.
//
// Usage:
//   node scripts/visual-baseline.mjs                 # both runs
//   node scripts/visual-baseline.mjs populated       # populated only
//   node scripts/visual-baseline.mjs empty           # empty only
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// The surface both fixtures baseline. `/settings/data` is used because it renders a
// deterministic panel list whose text length is a meaningful signal for BOTH the populated and
// the empty database.
const CAPTURE_ROUTE = process.env.GRIMOIRE_BASELINE_ROUTE || 'settings/data'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const artifactRoot = path.join(root, 'artifacts', 'visual')
const runMode = process.argv[2] || 'all'

function runCapture(tag, env) {
  return new Promise((resolve, reject) => {
    const userDataDir = path.join(artifactRoot, '.user-data', tag)
    fs.rmSync(userDataDir, { recursive: true, force: true })
    fs.mkdirSync(userDataDir, { recursive: true })
    const outDir = path.join(artifactRoot, tag)
    fs.mkdirSync(outDir, { recursive: true })

    const child = spawn(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['electron', '.', `--user-data-dir=${userDataDir}`],
      {
        cwd: root,
        env: {
          ...process.env,
          GRIMOIRE_VISUAL_CAPTURE: '1',
          GRIMOIRE_CAPTURE_DIR: outDir,
          GRIMOIRE_LOG_DIR: path.join(outDir, '.logs'),
          ...env
        },
        stdio: 'inherit',
        shell: process.platform === 'win32'
      }
    )
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error(`visual capture "${tag}" timed out`))
    }, 240_000)
    child.on('exit', code => {
      clearTimeout(timeout)
      if (code === 0) resolve(outDir)
      else reject(new Error(`visual capture "${tag}" exited with ${code}`))
    })
    child.on('error', reject)
  })
}

function listPngs(dir) {
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter(name => name.endsWith('.png')).sort() : []
}

const runs = []
if (runMode === 'all' || runMode === 'populated') {
  // `GRIMOIRE_CAPTURE_ROUTE` is what makes the app write `route-diagnostic.json`, which is the
  // only source of the STRUCTURED signals the compare gate enforces strictly. Without it a run
  // has pixel protection only — and a pixel tolerance will happily accept a page whose text
  // changed from "3 results" to "0 results" if the layout holds. Both fixtures therefore name
  // the route they baseline.
  runs.push(runCapture('populated', { GRIMOIRE_CAPTURE_ROUTE: CAPTURE_ROUTE }))
}
if (runMode === 'all' || runMode === 'empty') {
  runs.push(runCapture('empty', { GRIMOIRE_VISUAL_CAPTURE_EMPTY: '1', GRIMOIRE_CAPTURE_ROUTE: CAPTURE_ROUTE }))
}

const results = []
for (const pending of runs) {
  try {
    const dir = await pending
    results.push({ dir, files: listPngs(dir) })
  } catch (error) {
    results.push({ dir: null, files: [], error: String(error) })
  }
}

let failed = false
for (const result of results) {
  if (result.error) {
    failed = true
    console.error('FAILED:', result.error)
    continue
  }
  console.log(`captured ${result.files.length} screenshots in ${result.dir}`)
  for (const file of result.files) console.log('  -', file)
}
process.exit(failed ? 1 : 0)
