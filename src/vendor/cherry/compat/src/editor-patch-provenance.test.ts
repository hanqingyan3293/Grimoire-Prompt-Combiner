import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { compatRoot } from '../vite.shared.config'

type PatchedLock = { patchedDependencies: Record<string, string> }
type WorkspaceConfig = { patchedDependencies: Record<string, string> }
const patches = [
  ['@tiptap/extension-drag-handle@3.26.1', '@tiptap__extension-drag-handle@3.26.1.patch', '2f5c32153f059725f94906803079b90be2a4cf602befe45cd4f2e96652099096'],
  ['@tiptap/extension-list@3.26.1', '@tiptap__extension-list@3.26.1.patch', '584483147536f57383bef48109cf67a7798ae4c965a97009c61003a9c509898f'],
  ['@tiptap/markdown@3.26.1', '@tiptap__markdown@3.26.1.patch', '9ba2ca0537cedf2c97ebd75072889c258da2d3d96fbd0b9b09cfdc6092e6afb9']
]

function patchSection(filename: string): PatchedLock {
  const text = fs.readFileSync(path.join(compatRoot, filename), 'utf8')
  const section = text.match(/^patchedDependencies:\r?\n(?:[ \t].*\r?\n|\r?\n)*/m)?.[0]
  if (!section) throw new Error('Missing patch provenance: ' + filename)
  return parse(section)
}

const lock = patchSection('pnpm-lock.yaml')
const source = patchSection('source-pnpm-lock.yaml')
const workspace: WorkspaceConfig = parse(fs.readFileSync(path.join(compatRoot, 'pnpm-workspace.yaml'), 'utf8'))

describe('unchanged Cherry editor patch provenance', () => {
  it.each(patches)('records source patch bytes and active package hash for %s', (name, filename, hash) => {
    const file = path.join('patches', filename)
    const bytes = fs.readFileSync(path.join(compatRoot, file))
    expect(crypto.createHash('sha256').update(bytes).digest('hex')).toBe(hash)
    expect(lock.patchedDependencies[name]).toBe(hash)
    expect(lock.patchedDependencies[name]).toBe(source.patchedDependencies[name])
    expect(workspace.patchedDependencies[name].replaceAll('\\', '/')).toBe(file.replaceAll('\\', '/'))
  })
})
