#!/usr/bin/env node
// Claim audit: every entry below is something this project REPORTED as done. The check is deliberately dumb —
// does the marker string still exist in the named file — because the failure it guards against is also dumb:
// a `String.replace` that silently matched nothing, followed by a green test run that was luck. That happened
// on 2026-11-01 with the CompatProviderMcpPanel race (reported fixed, file untouched).
//
// This is NOT a gate: claims get renamed and files move, and a stale entry here would be noise. Run it when
// you want to know whether the record still matches the tree:
//
//   node scripts/audit-claims.mjs
import fs from 'node:fs'

const claims = [
  ['G11 regenerates style assertions', 'scripts/ui-parity.mjs', 'build-style-contract.mjs'],
  ['G11 imports execFileSync (ESM, not require)', 'scripts/ui-parity.mjs', 'import { execFileSync }'],
  ['variant assertions implemented', 'scripts/ui-parity.mjs', 'variantItems'],
  ['variant exemptions documented', 'scripts/style-contract-exempt.json', 'ui-spin-icon'],
  ['G12 silent-catch ratchet wired', 'scripts/gates.mjs', "'G12'"],
  ['G13 IPC wiring wired', 'scripts/gates.mjs', "'G13'"],
  ['IPC allowance documented', 'scripts/ipc-coverage-baseline.json', 'CHERRY_AGENT_STREAM_EVENT'],
  ['chat journey fails loudly', 'scripts/audit-cherry-routes.mjs', 'CHAT-JOURNEY'],
  ['route probe implemented', 'scripts/audit-cherry-routes.mjs', 'ROUTE-PROBE'],
  ['gallery relocate entry point', 'src/renderer/components/gallery/InspectorPanel.tsx', 'relocateFile'],
  ['dialog:openImage channel', 'src/shared/types.ts', 'DIALOG_OPEN_IMAGE'],
  ['comfy workflow delete entry', 'src/renderer/components/comfy/ComfyUIPanel.tsx', 'onDelete'],
  ['managed-target guard shared', 'src/main/index.ts', 'assertNotManagedTarget'],
  ['G4 waits for providers before clicking', 'src/vendor/cherry/compat/src/CompatProviderMcpPanel.test.tsx', 'providers.list).toHaveBeenCalled()'],
  ['empty-state table recorded', '.agent/records/2026-11-01-empty-states.md', 'mini-app'],
  ['one-command workflow documented', '.agent/records/2026-10-31-overview.md', 'verify:full'],
  ['style coverage ratchet exists', 'scripts/style-contract-baseline.json', 'minCovered'],
  ['silent-catch baseline exists', 'scripts/silent-catch-baseline.json', 'max'],
]

const missing = []
for (const [name, file, marker] of claims) {
  let ok = false
  try { ok = fs.readFileSync(file, 'utf8').includes(marker) } catch { ok = false }
  if (!ok) missing.push({ name, file, marker })
}
console.log('claims checked: ' + claims.length + ', missing: ' + missing.length)
for (const item of missing) console.log('  MISSING ' + item.name + ' :: ' + item.file + ' (looked for ' + JSON.stringify(item.marker) + ')')
if (missing.length) process.exitCode = 1
