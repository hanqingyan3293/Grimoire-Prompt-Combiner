import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import config, { sourceShellAliases } from '../vite.source-shell.config'
import { compatAliases, compatRoot, sourceRoot } from '../vite.shared.config'
import { authenticTreeSha256, collectStage, stageSourceShell, stagingRoot } from '../scripts/stage-source-shell.mjs'

const read = (file: string) => readFileSync(file, 'utf8')
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const manifest = JSON.parse(read(path.join(stagingRoot, 'provenance.json')))
const temporaryRoots: string[] = []
afterEach(() => temporaryRoots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

// Portable fixture: the committed, hash-pinned authentic generated artifact plus the
// source definitions, not a fake one-route tree. Real-reference --check is a separate gate.
function referenceFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'grimoire-source-shell-'))
  temporaryRoots.push(root)
  for (const file of manifest.files) {
    const destination = path.join(root, file.input)
    mkdirSync(path.dirname(destination), { recursive: true })
    writeFileSync(destination, readFileSync(path.join(stagingRoot, file.output)))
  }
  return root
}

function snapshot(files: string[]) {
  return files.map((file) => ({ file, hash: sha256(readFileSync(file)), mtime: statSync(file).mtimeMs }))
}

describe('bounded source-shell compilation seam', () => {
  it('checks the isolated source entry despite inherited default-compat exclusions', () => {
    const tsconfig = JSON.parse(read(path.join(compatRoot, 'tsconfig.source-shell.json')))
    expect(tsconfig.exclude).toEqual([])
    expect(tsconfig.include).toContain('src/source-shell-entry.tsx')
    expect(tsconfig.include).toContain('src/source-shell-generated/routeTree.gen.ts')
  })

  it('preserves and applies authentic source-locked AI SDK patches, not unpatched equivalents', () => {
    const lock = read(path.join(compatRoot, 'pnpm-lock.yaml'))
    const sourceLock = read(path.join(compatRoot, 'source-pnpm-lock.yaml'))
    const workspace = read(path.join(compatRoot, 'pnpm-workspace.yaml'))
    for (const [packageName, version, patch, hash] of [
      ['@ai-sdk/react', '3.0.187', '@ai-sdk__react@3.0.187.patch', '8182f09c37c2d080e4794d30401712c0605e986e985380ea76699758f2ed7230'],
      ['ai', '6.0.185', 'ai@6.0.185.patch', '61fc175c652267f39ec01df738fc61d1639faa19b980441005f7e9cd645d1711']
    ]) {
      expect(sha256(readFileSync(path.join(compatRoot, 'patches', patch)))).toBe(hash)
      expect(sourceLock).toContain(hash)
      expect(lock).toContain(hash)
      expect(workspace).toContain(`'${packageName}@${version}': patches/${patch}`)
      const installed = path.join(compatRoot, 'node_modules', packageName)
      expect(JSON.parse(read(path.join(installed, 'package.json'))).version).toBe(version)
      for (const extension of ['js', 'mjs']) {
        expect(read(path.join(installed, `dist/index.${extension}`))).toContain('PATCHED(cherry): structural-sharing snapshot')
      }
      expect(read(path.join(installed, 'LICENSE'))).toContain('Apache License, Version 2.0')
    }
  })
  it('preserves the entire authentic generated topology and all source route bytes/licenses', () => {
    const tree = readFileSync(path.join(stagingRoot, 'routeTree.gen.ts'))
    expect(sha256(tree)).toBe(authenticTreeSha256)
    expect(manifest.routeCount).toBe(60)
    expect(manifest.files).toHaveLength(62)
    const imports = [...tree.toString().matchAll(/from '(\.\/routes\/[^']+)'/g)].map((m) => `${m[1].slice(2)}.tsx`)
    expect(imports).toHaveLength(60)
    expect(new Set(imports).size).toBe(60)
    expect(imports).toEqual(expect.arrayContaining([
      'routes/__root.tsx', 'routes/app.tsx', 'routes/settings.tsx',
      'routes/app/agents.tsx', 'routes/app/chat.tsx', 'routes/app/mini-app/$appId.tsx',
      'routes/settings/mcp/settings.$serverId.tsx', 'routes/settings/scheduled-tasks.$taskId.tsx'
    ]))
    for (const file of manifest.files) {
      const bytes = readFileSync(path.join(stagingRoot, file.output))
      expect(sha256(bytes), file.output).toBe(file.sha256)
      if (file.input !== 'src/renderer/routeTree.gen.ts') {
        expect(bytes.equals(readFileSync(path.join(sourceRoot, file.input))), file.input).toBe(true)
      }
    }
  })

  it('stages only owned output; check mode writes neither source, reference nor output', () => {
    const reference = referenceFixture()
    const protectedFiles = [
      ...manifest.files.filter((f: { input: string }) => f.input !== 'src/renderer/routeTree.gen.ts')
        .map((f: { input: string }) => path.join(sourceRoot, f.input)),
      ...manifest.files.map((f: { input: string }) => path.join(reference, f.input)),
      ...['vite.config.ts', 'vite.shared.config.ts', 'tsconfig.json', 'package.json', 'pnpm-lock.yaml',
        'src/main.tsx', 'src/cherry-chat-shell-entry.tsx', 'src/shims/tanstack-router.ts',
        'src/shims/use-open-release-notes.ts'].map((f) => path.join(compatRoot, f)),
      ...['windows/main/MainApp.tsx', 'windows/prepareWindow.ts', 'components/layout/AppShell.tsx',
        'components/layout/TabsProvider.tsx', 'components/layout/TabRouter.tsx'].map((f) => path.join(sourceRoot, 'src/renderer', f))
    ]
    const before = snapshot(protectedFiles)
    expect(stageSourceShell(reference)).toBe(63)
    expect(snapshot(protectedFiles)).toEqual(before)
    const outputs = snapshot([...collectStage(reference).keys()].map((f) => path.join(stagingRoot, f)))
    expect(stageSourceShell(reference, { check: true })).toBe(63)
    expect(snapshot(protectedFiles)).toEqual(before)
    expect(snapshot(outputs.map((f) => f.file))).toEqual(outputs)
  })

  it('refuses altered generated topology or non-identical route definitions before writing', () => {
    const reference = referenceFixture()
    const route = path.join(reference, 'src/renderer/routes/app/launchpad.tsx')
    writeFileSync(route, `${read(route)}\n// altered\n`)
    const before = snapshot(manifest.files.map((f: { output: string }) => path.join(stagingRoot, f.output)))
    expect(() => stageSourceShell(reference)).toThrow('Vendored/reference route mismatch')
    const tree = path.join(reference, 'src/renderer/routeTree.gen.ts')
    writeFileSync(tree, read(tree).replace("id: '/app'", "id: '/fake'"))
    expect(() => stageSourceShell(reference)).toThrow('Authentic reference tree hash mismatch')
    expect(snapshot(before.map((f) => f.file))).toEqual(before)
  })

  it('uses the real installed router/release hook and exact owned tree alias without changing compat', () => {
    const oldAliases = compatAliases()
    const aliases = sourceShellAliases()
    expect(aliases.some((a) => a.find === '@tanstack/react-router')).toBe(false)
    expect(aliases.some((a) => a.find === '@renderer/hooks/useOpenReleaseNotes')).toBe(false)
    expect(oldAliases.some((a) => a.find === '@tanstack/react-router')).toBe(true)
    expect(oldAliases.some((a) => a.find === '@renderer/hooks/useOpenReleaseNotes')).toBe(true)
    const treeAlias = aliases.find((a) => a.find instanceof RegExp && a.find.test('@renderer/routeTree.gen'))!
    expect((treeAlias.find as RegExp).test('@renderer/routeTree.gen/other')).toBe(false)
    expect(treeAlias.replacement).toBe(path.join(stagingRoot, 'routeTree.gen.ts'))
    const require = createRequire(path.join(compatRoot, 'package.json'))
    expect(require.resolve('@tanstack/react-router')).not.toContain('shims')
    expect(require('@tanstack/react-router').createRouter).toBeTypeOf('function')
    const ts = JSON.parse(read(path.join(compatRoot, 'tsconfig.source-shell.json')))
    expect(ts.compilerOptions.paths['@tanstack/react-router']).toBeUndefined()
    expect(ts.compilerOptions.paths['@renderer/hooks/useOpenReleaseNotes']).toBeUndefined()
    expect(ts.compilerOptions.paths['@renderer/routeTree.gen']).toEqual(['src/source-shell-generated/routeTree.gen.ts'])
    expect(ts.compilerOptions.noCheck).toBeUndefined()
    expect(config.build?.outDir).toBe(path.join(compatRoot, 'dist-source-shell'))
  })

  it('bootstraps authentic MainApp with prepareWindow, not a hash registry or replacement shell', () => {
    const entry = read(path.join(compatRoot, 'src/source-shell-entry.tsx'))
    expect(entry).toContain("import MainApp from '@renderer/windows/main/MainApp'")
    expect(entry).toContain("await prepareWindow({ preference: 'all' })")
    expect(entry).toContain('render(<MainApp />)')
    expect(entry).not.toContain('route-registry')
    const main = read(path.join(sourceRoot, 'src/renderer/windows/main/MainApp.tsx'))
    expect(main).toContain('<TabsProvider initialDefaultTab={initialDefaultTab}>')
    expect(main).toContain('<AppShell />')
    expect(read(path.join(sourceRoot, 'src/renderer/components/layout/TabRouter.tsx'))).toContain('createMemoryHistory({ initialEntries: [url] })')
    expect(sourceShellAliases().filter((a) => a.replacement.includes('telemetry'))).toHaveLength(1)
    expect(read(path.join(compatRoot, 'src/source-shell-telemetry.ts'))).toContain('export function initSentry(): void {}')
  })
})
