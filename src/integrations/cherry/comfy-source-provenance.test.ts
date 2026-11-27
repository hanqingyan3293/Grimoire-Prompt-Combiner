import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

const root = process.cwd()
const script = path.join(root, 'scripts/build-comfy-source.mjs')
const manifestPath = 'dist/main/integrations/cherry/comfy-source.provenance.json'
const requireCompat = createRequire(path.join(root, 'src/vendor/cherry/compat/package.json'))
const zodPackagePath = requireCompat.resolve('zod/package.json')
const zodPackage = JSON.parse(fs.readFileSync(zodPackagePath, 'utf8'))
const requireCompatHoisted = createRequire(path.join(root, 'src/vendor/cherry/compat/node_modules/.pnpm/node_modules/package.json'))
const ipaddrPackagePath = requireCompatHoisted.resolve('ipaddr.js/package.json')
const ipaddrPackage = JSON.parse(fs.readFileSync(ipaddrPackagePath, 'utf8'))
const normalize = (value: string) => value.replaceAll(path.sep, '/')
const sha = (value: Buffer | string) => crypto.createHash('sha256').update(value).digest('hex')
const temps: string[] = []
function build(cwd = root) { execFileSync(process.execPath, [script], { cwd, stdio: 'pipe' }) }
function manifest(cwd = root) { return JSON.parse(fs.readFileSync(path.join(cwd, manifestPath), 'utf8')) }
function inputs(value: ReturnType<typeof manifest>): Array<{ path: string; sha256: string; bytes: number; codeSha256: string }> {
  expect(Array.isArray(value.inputs)).toBe(true)
  return value.inputs
}
beforeAll(() => build())
afterEach(() => { for (const directory of temps.splice(0)) fs.rmSync(directory, { recursive: true, force: true }) })

describe('Comfy source bundle complete provenance (C1 R8)', () => {
  it('fingerprints the sorted resolved transitive source and dependency modules, not just the entry and three support files', () => {
    const value = manifest(); const paths = inputs(value).map(item => item.path)
    expect(paths).toEqual([...paths].sort())
    expect(paths.length).toBeGreaterThan(10)
    for (const suffix of ['/transportUtils.ts', '/uiToApiPrompt.ts', '/paintingGenerateError.ts', '/provider-registry/src/index.ts']) expect(paths.some(file => file.endsWith(suffix))).toBe(true)
    expect(paths.some(file => file.includes('/zod/'))).toBe(true)
    expect(value.inputDigest).toMatch(/^[a-f0-9]{64}$/)
  })

  it('binds generator, entry, lockfiles, builder and actual compatible Zod provenance', () => {
    const value = manifest()
    expect(Array.isArray(value.buildInputs)).toBe(true)
    const files = value.buildInputs.map((item: { path: string }) => item.path)
    for (const file of ['scripts/build-comfy-source.mjs', 'scripts/entries/comfy-source.ts', 'package.json', 'package-lock.json', 'src/vendor/cherry/compat/package.json', 'src/vendor/cherry/compat/pnpm-lock.yaml']) expect(files).toContain(file)
    expect(value.builder).toMatchObject({ name: 'rolldown', nodeVersion: process.version })
    expect(value.builder.version).toMatch(/^\d+\.\d+\.\d+/)
    expect(value.dependencies.zod).toMatchObject({ version: zodPackage.version, license: zodPackage.license, packageJson: normalize(path.relative(root, zodPackagePath)) })
    expect(value.dependencies.zod.entry.endsWith('/index.js')).toBe(true)
    expect(value.dependencies.ipaddr).toMatchObject({ version: ipaddrPackage.version, license: ipaddrPackage.license, packageJson: normalize(path.relative(root, fs.realpathSync(ipaddrPackagePath))) })
    expect(value.dependencies.ipaddr.packageSha256).toBe(sha(fs.readFileSync(ipaddrPackagePath)))
    expect(files).toContain('scripts/entries/comfy-network.ts')
  })

  it('matches every declared source file to current bytes and records the parsed module code', () => {
    for (const item of inputs(manifest())) {
      expect(path.isAbsolute(item.path)).toBe(false)
      expect(item.path.startsWith('../')).toBe(false)
      const content = fs.readFileSync(path.join(root, item.path))
      expect(item.sha256).toBe(sha(content))
      expect(item.bytes).toBe(content.byteLength)
      expect(item.codeSha256).toMatch(/^[a-f0-9]{64}$/)
    }
  })

  it('fingerprints the nearest package metadata that affects each resolved module format', () => {
    const value = manifest(); const recorded = new Set(value.buildInputs.map((item: { path: string }) => item.path))
    for (const item of inputs(value)) {
      let directory = path.dirname(path.join(root, item.path))
      while (directory.startsWith(root)) {
        const metadata = path.join(directory, 'package.json')
        if (fs.existsSync(metadata)) { expect(recorded.has(normalize(path.relative(root, metadata))), item.path).toBe(true); break }
        if (directory === root) break
        directory = path.dirname(directory)
      }
    }
  })

  it('ships the actual source and inlined Zod license texts beside the generated bundle', () => {
    const value = manifest()
    expect(Array.isArray(value.notices)).toBe(true)
    for (const source of ['src/vendor/cherry/source/LICENSE', normalize(path.relative(root, path.join(path.dirname(zodPackagePath), 'LICENSE'))), normalize(path.relative(root, path.join(path.dirname(fs.realpathSync(ipaddrPackagePath)), 'LICENSE')))]) {
      const notice = value.notices.find((item: { source: string }) => item.source === source)
      expect(notice).toBeTruthy()
      const text = fs.readFileSync(path.join(root, source))
      expect(fs.readFileSync(path.join(root, notice.output))).toEqual(text)
      expect(notice.sha256).toBe(sha(text))
    }
  })

  it('rebuilds identical code and provenance for the same complete input set', () => {
    const first = fs.readFileSync(path.join(root, manifestPath))
    const code = fs.readFileSync(path.join(root, manifest().output))
    build()
    expect(fs.readFileSync(path.join(root, manifestPath))).toEqual(first)
    expect(fs.readFileSync(path.join(root, manifest().output))).toEqual(code)
  })

  it('records a transitive fixture-only mutation while the original vendor entry and helper remain untouched', () => {
    const original = manifest(); const files = inputs(original)
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-comfy-provenance-')); temps.push(fixture)
    const copied = new Set<string>([...files.map(item => item.path), ...original.buildInputs.map((item: { path: string }) => item.path)])
    for (const file of copied) {
      const target = path.join(fixture, file); fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.copyFileSync(path.join(root, file), target)
    }
    for (const [dependency, packageName] of [['zod', 'zod'], ['ipaddr', 'ipaddr.js']] as const) {
      const packageDirectory = path.dirname(original.dependencies[dependency].packageJson)
      const link = path.join(fixture, 'src/vendor/cherry/compat/node_modules', packageName)
      fs.mkdirSync(path.dirname(link), { recursive: true })
      fs.symlinkSync(path.join(fixture, packageDirectory), link, process.platform === 'win32' ? 'junction' : 'dir')
    }
    build(fixture)
    const first = manifest(fixture)
    const helper = files.find(item => item.path.endsWith('/transportUtils.ts'))!
    const before = fs.readFileSync(path.join(root, helper.path))
    fs.appendFileSync(path.join(fixture, helper.path), '\n// fixture-only provenance mutation\n')
    build(fixture)
    const second = manifest(fixture)
    expect(second.sourceSha256).toBe(first.sourceSha256)
    expect(second.buildEntry).toEqual(first.buildEntry)
    expect(second.inputDigest).not.toBe(first.inputDigest)
    expect(second.inputs.find((item: { path: string }) => item.path === helper.path).sha256).not.toBe(helper.sha256)
    expect(fs.readFileSync(path.join(root, helper.path))).toEqual(before)
    expect(manifest().sourceSha256).toBe(original.sourceSha256)
  })
})
