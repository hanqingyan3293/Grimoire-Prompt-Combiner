import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { cherryFileTypeForExtension } from './cherry-file-type-map.generated'

/**
 * Guards the GENERATED map against the source it claims to derive from.
 *
 * The Files page renders its 类型 column from the source's `getFileTypeByExt` while the backend
 * `fileType` filter uses this generated map. If they disagree, a row is listed under one type and
 * then disappears when that type is selected — a filter that reads as broken.
 *
 * These assertions re-derive the expected grouping from the vendored source files rather than
 * hard-coding extension lists, so they keep working when the source data is regenerated.
 */
const SOURCE_DIR = path.resolve(process.cwd(), 'src/vendor/cherry/source/src/shared/utils/file')
const CODE_LANGUAGES = path.resolve(process.cwd(), 'src/vendor/cherry/source/src/shared/utils/codeLanguages.ts')

function readArrayLiteral(text: string, name: string): string[] {
  const start = text.indexOf('export const ' + name)
  const open = text.indexOf('[', start)
  const close = text.indexOf(']', open)
  return [...text.slice(open, close).matchAll(/'(\.[^']+)'/g)].map(match => match[1].toLowerCase())
}

describe('generated cherry file type map', () => {
  const extensionsText = fs.readFileSync(path.join(SOURCE_DIR, 'fileExtensions.ts'), 'utf8')
  const codeLanguagesText = fs.readFileSync(CODE_LANGUAGES, 'utf8')

  it('classifies every extension in each source group as that group', () => {
    const groups: Array<[string, string]> = [
      ['imageExts', 'image'],
      ['videoExts', 'video'],
      ['audioExts', 'audio'],
      ['documentExts', 'document']
    ]
    for (const [name, expected] of groups) {
      const exts = readArrayLiteral(extensionsText, name)
      expect(exts.length, `${name} should not be empty`).toBeGreaterThan(0)
      for (const ext of exts) {
        expect(cherryFileTypeForExtension(ext), `${name} -> ${ext}`).toBe(expected)
      }
    }
  })

  it('classifies linguist code extensions as text, which is where main’s own table diverged', () => {
    // `file-bridge.service`'s table lists ~30 text extensions; the source's `textExts` is
    // `customTextExts + linguist` and runs to over 1,400. These three are real linguist
    // extensions that the bridge table does NOT know, so they are the ones that used to be
    // filtered as `other` while the page's column showed 文本.
    for (const ext of ['.rb', '.swift', '.kt']) {
      expect(codeLanguagesText.includes(`'${ext}'`), `${ext} should exist in the vendored linguist data`).toBe(true)
      expect(cherryFileTypeForExtension(ext)).toBe('text')
    }
    expect(cherryFileTypeForExtension('.py')).toBe('text')
    expect(cherryFileTypeForExtension('.md')).toBe('text')
  })

  it('reports `other` for unknown and extension-less entries, matching the source contract', () => {
    expect(cherryFileTypeForExtension('.zzzznotreal')).toBe('other')
    expect(cherryFileTypeForExtension('')).toBe('other')
    expect(cherryFileTypeForExtension(null)).toBe('other')
    expect(cherryFileTypeForExtension(undefined)).toBe('other')
    // Source `getFileTypeByExt` strips a leading dot and lowercases before lookup.
    expect(cherryFileTypeForExtension('PNG')).toBe('image')
    expect(cherryFileTypeForExtension('.PNG')).toBe('image')
    expect(cherryFileTypeForExtension('png')).toBe('image')
  })

  it('keeps the generated file in sync with the vendored source', () => {
    // Re-running the generator in check mode from the test would shell out; instead assert the
    // digest line is present so a hand-edit that drops it is caught, and rely on the
    // `check:cherry-file-type-map` npm script (wired into CI/verification) for the full compare.
    const generated = fs.readFileSync(path.resolve(process.cwd(), 'src/main/services/cherry-file-type-map.generated.ts'), 'utf8')
    expect(generated).toContain('AUTO-GENERATED')
    expect(generated).toMatch(/Source digest: [0-9a-f]{16}/)
  })
})
