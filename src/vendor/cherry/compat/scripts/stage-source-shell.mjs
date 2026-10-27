import { createHash } from 'node:crypto'
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const compatRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const sourceRoot = path.resolve(compatRoot, '../source')
export const stagingRoot = path.resolve(compatRoot, 'src/source-shell-generated')
const treePath = 'src/renderer/routeTree.gen.ts'
// Approved reference artifact; refuse a changed topology rather than silently restaging it.
export const authenticTreeSha256 = '66318fce25d3f1b33b0401edeb4bfeff87ae0428a9fb8534146022992a2bc5d9'
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')

// No generator runs in either source tree. The authentic generated artifact is reusable:
// keep its ./routes imports and stage matching, unchanged definitions at that topology.
export function collectStage(referenceRoot) {
  const tree = readFileSync(path.join(referenceRoot, treePath))
  if (hash(tree) !== authenticTreeSha256) throw new Error('Authentic reference tree hash mismatch')
  const imports = [...tree.toString('utf8').matchAll(/from ['"](\.\/routes\/[^'"]+)['"]/g)].map((m) => m[1])
  if (!imports.length || new Set(imports).size !== imports.length) throw new Error('Invalid authentic route imports')
  const files = new Map([['routeTree.gen.ts', tree]])
  const provenance = [{ input: treePath, output: 'routeTree.gen.ts', sha256: hash(tree) }]
  for (const specifier of imports) {
    if (specifier.includes('..') || !/^\.\/routes\/[\w/$.-]+$/.test(specifier)) {
      throw new Error(`Unsafe route import: ${specifier}`)
    }
    const output = `${specifier.slice(2)}.tsx`
    const input = `src/renderer/${output}`
    const bytes = readFileSync(path.join(sourceRoot, input))
    if (!bytes.equals(readFileSync(path.join(referenceRoot, input)))) {
      throw new Error(`Vendored/reference route mismatch: ${input}; do not silently change topology`)
    }
    files.set(output, bytes)
    provenance.push({ input, output, sha256: hash(bytes) })
  }
  const license = readFileSync(path.join(sourceRoot, 'LICENSE'))
  if (!license.equals(readFileSync(path.join(referenceRoot, 'LICENSE')))) throw new Error('Source license mismatch')
  files.set('LICENSE', license)
  provenance.push({ input: 'LICENSE', output: 'LICENSE', sha256: hash(license) })
  files.set('provenance.json', Buffer.from(`${JSON.stringify({
    source: 'Cherry Studio 2.1.4',
    method: 'Unchanged authentic generated tree plus byte-identical route staging',
    license: 'AGPL-3.0 (LICENSE preserved)',
    routeCount: imports.length,
    files: provenance
  }, null, 2)}\n`))
  return files
}

export function stageSourceShell(referenceRoot, { check = false } = {}) {
  const files = collectStage(path.resolve(referenceRoot))
  // Fixed owned destination only. No caller-controlled output path; no source write API.
  for (const [relative, bytes] of files) {
    const destination = path.join(stagingRoot, relative)
    if (check) {
      if (!existsSync(destination) || !readFileSync(destination).equals(bytes)) {
        throw new Error(`Staging drift: ${relative}`)
      }
    } else {
      mkdirSync(path.dirname(destination), { recursive: true })
      writeFileSync(destination, bytes)
    }
  }
  return files.size
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const reference = args.find((arg) => arg !== '--check')
  if (!reference || args.filter((arg) => arg !== '--check').length !== 1) {
    throw new Error('Usage: node scripts/stage-source-shell.mjs <reference-cherry-root> [--check]')
  }
  console.log(`${args.includes('--check') ? 'Verified' : 'Staged'} ${stageSourceShell(reference, { check: args.includes('--check') })} owned files; source read-only`)
}
