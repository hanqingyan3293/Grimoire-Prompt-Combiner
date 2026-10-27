import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { appDefines, compatAliases, compatRoot } from '../vite.shared.config'

type CompilerConfig = {
  compilerOptions: { paths: Record<string, string[]> }
}

const tsconfig: CompilerConfig = JSON.parse(fs.readFileSync(path.join(compatRoot, 'tsconfig.json'), 'utf8'))
const aliases = compatAliases()

const checkedAliases = [
  '@shared/cherry-host-types',
  '@cherrystudio/ui/icons/providers',
  '@cherrystudio/ui/icons',
  '@renderer/components/Preview/MermaidPreview',
  '@renderer/components/ModelSelector/useModelSelectorData',
  '@renderer/hooks/useOpenReleaseNotes',
  '@data/PreferenceService',
  '@renderer/data/PreferenceService',
  '@tanstack/react-router',
  '@logger'
]

describe('compat build/typecheck contract', () => {
  it.each(checkedAliases)('checks the same module the bundle uses for %s', specifier => {
    const alias = aliases.find(entry => entry.find === specifier)
    const mappings = tsconfig.compilerOptions.paths[specifier]
    expect(alias).toBeDefined()
    expect(mappings).toHaveLength(1)
    expect(path.resolve(compatRoot, mappings[0])).toBe(alias?.replacement)
    expect(fs.existsSync(path.resolve(compatRoot, mappings[0]))).toBe(true)
  })

  it('pairs the table fork JavaScript with its real shipped declarations', () => {
    const alias = aliases.find(entry => entry.find === '@cherrystudio/extension-table-plus')
    const declaration = path.resolve(compatRoot, tsconfig.compilerOptions.paths['@cherrystudio/extension-table-plus'][0])
    expect(alias?.replacement).toMatch(/index\.mjs$/)
    expect(declaration).toBe(alias?.replacement.replace(/\.mjs$/, '.d.mts'))
    expect(fs.existsSync(declaration)).toBe(true)
  })

  it('never calls a noCheck invocation a typecheck', () => {
    const manifest: { scripts: Record<string, string> } = JSON.parse(fs.readFileSync(path.join(compatRoot, 'package.json'), 'utf8'))
    const root: { scripts: Record<string, string> } = JSON.parse(fs.readFileSync(path.resolve(compatRoot, '../../../../package.json'), 'utf8'))
    for (const command of [manifest.scripts.typecheck, root.scripts['typecheck:cherry-compat']]) {
      expect(command).toContain('--noEmit')
      expect(command).not.toMatch(/--noCheck(?:\s|$)/)
    }
  })

  it('resolves source-direct CodeMirror imports inside the compat dependency graph', () => {
    const sourceImporter = path.resolve(compatRoot, '../source/packages/ui/src/components/composites/code-editor/hooks.ts')
    const importer = createRequire(sourceImporter)
    const compatImporter = createRequire(path.join(compatRoot, 'package.json'))
    for (const name of ['@codemirror/view', '@codemirror/state', '@codemirror/lint', '@codemirror/language', '@codemirror/lang-json']) {
      expect(fs.realpathSync(importer.resolve(name))).toBe(fs.realpathSync(compatImporter.resolve(name)))
      expect(fs.realpathSync(importer.resolve(name))).toContain(path.join('compat', 'node_modules'))
    }
  })

  it('injects release globals with the source runtime shapes', () => {
    expect(JSON.parse(appDefines.__APP_EDITION__)).toBe('global')
    expect(typeof JSON.parse(appDefines.__APP_RELEASE_NOTES__)).toBe('string')
    expect(Array.isArray(JSON.parse(appDefines.__APP_RELEASE_HISTORY__))).toBe(true)
    expect(typeof JSON.parse(appDefines.__APP_RELEASE_VERSION__)).toBe('string')
  })
})
