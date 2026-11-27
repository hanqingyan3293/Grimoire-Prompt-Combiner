import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { rolldown, RUNTIME_MODULE_ID } from 'rolldown'

const root = process.cwd()
const sourceRoot = path.join(root, 'src/vendor/cherry/source/src')
const source = path.join(sourceRoot, 'main/ai/provider/custom/comfyui/comfyuiTransport.ts')
const entry = path.join(root, 'scripts/entries/comfy-source.ts')
const outputDir = path.join(root, 'dist/main/integrations/cherry')
const output = path.join(outputDir, 'comfy-source.cjs')
const provenancePath = path.join(outputDir, 'comfy-source.provenance.json')
const digest = value => crypto.createHash('sha256').update(value).digest('hex')
const sha256File = file => digest(fs.readFileSync(file))
const relative = file => path.relative(root, file).replaceAll(path.sep, '/')
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const fingerprint = file => {
  const content = fs.readFileSync(file)
  const name = relative(file)
  if (path.isAbsolute(name) || name.startsWith('../')) throw new Error('Comfy source input outside root: ' + name)
  return { path: name, sha256: digest(content), bytes: content.byteLength }
}

const support = [
  'src/integrations/cherry/comfy-source-bridge.ts',
  'src/integrations/cherry/comfy-source-logger.ts',
  'src/integrations/cherry/comfy-source-i18n.ts',
].map(file => path.join(root, file))
const requireCompat = createRequire(path.join(root, 'src/vendor/cherry/compat/package.json'))
const zodPackageJson = fs.realpathSync(requireCompat.resolve('zod/package.json'))
const zodDirectory = path.dirname(zodPackageJson)
const zodPackage = readJson(zodPackageJson)
const requireCompatHoisted = createRequire(path.join(root, 'src/vendor/cherry/compat/node_modules/.pnpm/node_modules/package.json'))
let ipaddrPackageJson
try { ipaddrPackageJson = fs.realpathSync(requireCompat.resolve('ipaddr.js/package.json')) }
catch { ipaddrPackageJson = fs.realpathSync(requireCompatHoisted.resolve('ipaddr.js/package.json')) }
const ipaddrDirectory = path.dirname(ipaddrPackageJson)
const ipaddrPackage = readJson(ipaddrPackageJson)
const ipaddrEntry = path.resolve(ipaddrDirectory, ipaddrPackage.main)
function resolveZod(id) {
  const key = id === 'zod' ? '.' : './' + id.slice('zod/'.length)
  const exported = zodPackage.exports[key]
  // Retain the source's ESM import condition and installed compatible version.
  const target = typeof exported === 'string' ? exported : exported?.import ?? exported?.default
  if (typeof target !== 'string') throw new Error('Comfy source Zod export missing: ' + id)
  return path.resolve(zodDirectory, target)
}
const builderPackageJson = createRequire(import.meta.url).resolve('rolldown/package.json')
const builderPackage = readJson(builderPackageJson)
const executedGenerator = fileURLToPath(import.meta.url)
const contextFiles = [
  'scripts/build-comfy-source.mjs', 'scripts/entries/comfy-source.ts',
  'package.json', 'package-lock.json',
  'src/vendor/cherry/compat/package.json', 'src/vendor/cherry/compat/pnpm-lock.yaml',
  'src/vendor/cherry/source/packages/provider-registry/package.json',
  'src/vendor/cherry/source/LICENSE', 'THIRD_PARTY_NOTICES.md', 'node_modules/rolldown/package.json',
  relative(zodPackageJson), relative(path.join(zodDirectory, 'LICENSE')),
  'scripts/entries/comfy-network.ts', relative(ipaddrPackageJson), relative(path.join(ipaddrDirectory, 'LICENSE')),
].map(file => path.join(root, file))
let buildInputs = [...new Set([...contextFiles, ...support])].map(fingerprint).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
if (sha256File(path.join(root, 'scripts/build-comfy-source.mjs')) !== sha256File(executedGenerator)) throw new Error('Comfy generator copy differs from the executing build script')
if (sha256File(path.join(root, 'node_modules/rolldown/package.json')) !== sha256File(builderPackageJson)) throw new Error('Comfy builder metadata differs from the executing builder')
const dependencies = {
  zod: { version: zodPackage.version, license: zodPackage.license, packageJson: relative(zodPackageJson), packageSha256: sha256File(zodPackageJson), entry: relative(resolveZod('zod')), entrySha256: sha256File(resolveZod('zod')) },
  ipaddr: { version: ipaddrPackage.version, license: ipaddrPackage.license, packageJson: relative(ipaddrPackageJson), packageSha256: sha256File(ipaddrPackageJson), entry: relative(ipaddrEntry), entrySha256: sha256File(ipaddrEntry) },
}
const builder = { name: 'rolldown', version: builderPackage.version, nodeVersion: process.version, platform: process.platform, arch: process.arch, packageJson: 'node_modules/rolldown/package.json', packageSha256: sha256File(builderPackageJson) }

for (const file of [source, entry, ...support]) if (!fs.existsSync(file)) throw new Error('Comfy source build input missing: ' + relative(file))
const files = new Map()
const resolutionInputs = new Map()
const modules = new Map()
const externals = new Set()
function moduleId(id) {
  if (id.startsWith('node:')) return id
  const normalized = id.replaceAll('\\', '/')
  return normalized.replaceAll(root.replaceAll('\\', '/') + '/', '')
}
fs.mkdirSync(outputDir, { recursive: true })
const build = await rolldown({
  input: entry,
  platform: 'node',
  external: id => id.startsWith('node:'),
  plugins: [{
    name: 'grimoire-comfy-source-boundary',
    resolveId(id) {
      if (id === '@logger') return path.join(root, 'src/integrations/cherry/comfy-source-logger.ts')
      if (id === '@main/i18n') return path.join(root, 'src/integrations/cherry/comfy-source-i18n.ts')
      if (id === '@cherrystudio/provider-registry') return path.join(root, 'src/vendor/cherry/source/packages/provider-registry/src/index.ts')
      if (id === 'zod' || id.startsWith('zod/')) return resolveZod(id)
      if (id === 'ipaddr.js') return ipaddrEntry
      for (const prefix of ['@shared/', '@main/', '@renderer/']) {
        if (id.startsWith(prefix)) return path.join(sourceRoot, prefix.slice(1, -1), id.slice(prefix.length)) + '.ts'
      }
    },
    moduleParsed(info) {
      if (typeof info.code !== 'string') throw new Error('Comfy parsed module code unavailable: ' + moduleId(info.id))
      const record = { id: moduleId(info.id), codeSha256: digest(info.code), imports: info.importedIds.map(moduleId).sort(), dynamicImports: info.dynamicallyImportedIds.map(moduleId).sort(), isEntry: info.isEntry, inputFormat: info.inputFormat }
      for (const id of [...info.importedIds, ...info.dynamicallyImportedIds]) if (id.startsWith('node:')) externals.add(id)
      if (info.id === RUNTIME_MODULE_ID || info.id.startsWith('\0')) {
        modules.set(record.id, { ...record, kind: 'virtual' })
        return
      }
      const file = info.id.split('?')[0]
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error('Comfy resolved module is not a file or recorded virtual module: ' + record.id)
      const resolvedFile = fs.realpathSync(file)
      const captured = fingerprint(resolvedFile)
      let directory = path.dirname(resolvedFile)
      while (!relative(directory).startsWith('..') && !path.isAbsolute(relative(directory))) {
        const metadata = path.join(directory, 'package.json')
        if (fs.existsSync(metadata)) {
          const input = fingerprint(metadata)
          resolutionInputs.set(input.path, input)
          break
        }
        if (directory === root) break
        directory = path.dirname(directory)
      }
      if (!files.has(captured.path)) files.set(captured.path, { ...captured, codeSha256: record.codeSha256 })
      modules.set(record.id, { ...record, kind: 'file', path: captured.path })
    },
  }],
})
try { await build.write({ file: output, format: 'cjs' }) } finally { await build.close() }
const inputs = [...files.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
const parsedModules = [...modules.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
buildInputs = [...new Map([...resolutionInputs.values(), ...buildInputs].map(input => [input.path, input])).values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
// A mixed/stale source tree is an invalid build, not a reproducible receipt.
for (const input of [...inputs, ...buildInputs]) if (sha256File(path.join(root, input.path)) !== input.sha256) throw new Error('Comfy source input changed while bundling: ' + input.path)
const inputDigest = digest(JSON.stringify({ inputs, modules: parsedModules, externals: [...externals].sort(), buildInputs, dependencies, builder }))
const notices = [
  { source: 'src/vendor/cherry/source/LICENSE', output: path.join(outputDir, 'comfy-source.LICENSE.txt'), license: 'AGPL-3.0-only' },
  { source: relative(path.join(zodDirectory, 'LICENSE')), output: path.join(outputDir, 'comfy-source.zod.LICENSE.txt'), license: 'MIT' },
  { source: relative(path.join(ipaddrDirectory, 'LICENSE')), output: path.join(outputDir, 'comfy-source.ipaddr.LICENSE.txt'), license: 'MIT' },
].map(item => {
  const content = fs.readFileSync(path.join(root, item.source))
  fs.writeFileSync(item.output, content)
  return { source: item.source, output: relative(item.output), license: item.license, sha256: digest(content) }
})
const header = [
  '/*',
  ' * Generated by scripts/build-comfy-source.mjs. Do not edit.',
  ' * Source: src/vendor/cherry/source/src/main/ai/provider/custom/comfyui/comfyuiTransport.ts',
  ' * License: AGPL-3.0-only (Cherry Studio); see comfy-source.LICENSE.txt.',
  ' * Inlined Zod MIT notice: comfy-source.zod.LICENSE.txt.',
  ' * Inlined ipaddr.js MIT notice: comfy-source.ipaddr.LICENSE.txt.',
  ' */',
  '',
].join('\n')
fs.writeFileSync(output, header + fs.readFileSync(output, 'utf8'))
const provenance = {
  schemaVersion: 2,
  generator: 'scripts/build-comfy-source.mjs',
  source: 'src/vendor/cherry/source/src/main/ai/provider/custom/comfyui/comfyuiTransport.ts',
  sourceSha256: sha256File(source),
  buildEntry: { path: relative(entry), sha256: sha256File(entry) },
  support: support.map(file => ({ path: relative(file), sha256: sha256File(file) })),
  inputs, modules: parsedModules, externals: [...externals].sort(), buildInputs, dependencies, builder, inputDigest, notices,
  capture: 'resolved moduleParsed graph plus original-file fingerprints; inputs revalidated after bundle write',
  sourceSnapshot: { rootPackageJson: fs.existsSync(path.join(root, 'src/vendor/cherry/source/package.json')) ? 'src/vendor/cherry/source/package.json' : null, license: 'src/vendor/cherry/source/LICENSE' },
  output: relative(output),
  outputSha256: sha256File(output),
  outputBytes: fs.statSync(output).size,
  license: 'AGPL-3.0-only',
  notice: 'Cherry Studio source reused read-only; see THIRD_PARTY_NOTICES.md and the packaged CHERRY_STUDIO_LICENSE (AGPL-3.0).txt.',
}
fs.writeFileSync(provenancePath, JSON.stringify(provenance, null, 2) + '\n')
console.log(JSON.stringify({ output: provenance.output, outputBytes: provenance.outputBytes, outputSha256: provenance.outputSha256, inputDigest, resolvedInputCount: inputs.length, parsedModuleCount: parsedModules.length }))
