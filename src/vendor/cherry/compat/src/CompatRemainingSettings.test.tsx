import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CompatRemainingSettings } from './CompatRemainingSettings'
import { COMPAT_ROUTE_PATHS, COMPAT_SUPPORTED_PATHS, isCompatSettingsRoute, parseCompatRoute, resolveCompatPath } from './route-registry'
import { getSettingsDiagnostic, REMAINING_SETTINGS_DETAIL_PATTERNS, REMAINING_SETTINGS_PATHS } from './settings-route-descriptors'

afterEach(cleanup)

const fixedPaths = Object.entries(REMAINING_SETTINGS_PATHS)

describe('remaining source settings URLs', () => {
  it.each(fixedPaths)('registers %s with full-slot diagnostic, not chat/provider', (id, path) => {
    const route = parseCompatRoute('#' + path + '/?ignored=1')
    expect(route).toEqual({ id, path })
    expect(isCompatSettingsRoute(route)).toBe(true)
    expect(COMPAT_SUPPORTED_PATHS).toContain(path)
    const descriptor = getSettingsDiagnostic(id)!
    render(<CompatRemainingSettings route={route} />)
    const diagnostic = screen.getByRole('alert')
    expect(diagnostic.textContent).toContain(descriptor.title)
    expect(diagnostic.textContent).toContain('BLOCKED')
    expect(diagnostic.textContent).toContain(descriptor.source)
    for (const missing of descriptor.missing) expect(diagnostic.textContent).toContain(missing)
    expect(diagnostic.textContent).toContain(descriptor.nextAction)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('covers every source settings route (including aliases and dynamic patterns)', () => {
    const root = resolve(process.cwd(), '../source/src/renderer/routes/settings')
    const sourceTargets: string[] = []
    function walk(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const url = join(dir, entry.name)
        if (entry.isDirectory()) walk(url)
        else if (entry.name.endsWith('.tsx')) {
          const text = readFileSync(url, 'utf8')
          const match = text.match(/createFileRoute\('([^']+)'\)/)
          if (match) sourceTargets.push(match[1])
        }
      }
    }
    walk(root)
    expect(sourceTargets.length).toBeGreaterThan(35)
    for (const target of sourceTargets) {
      // Existing source MCP splat maps to the compat provider diagnostic.
      const concrete = target.endsWith('/$') ? target.slice(0, -1) + 'provider-key'
        : target.replace(/\$(?:skillId|taskId|serverId)/g, 'fixture-id')
      expect(parseCompatRoute('#' + concrete).id, target).not.toBe('unknown')
    }
  })

  it.each([
    ['/settings/skills', 'settings-skills'],
    ['/settings/scheduled-tasks', 'settings-scheduled-tasks'],
    ['/settings/mcp/builtin', 'settings-mcp-builtin'],
    ['/settings/mcp/marketplaces', 'settings-mcp-marketplaces'],
    ['/settings/mcp/settings/real-id', 'settings-mcp-detail']
  ])('gives fixed/layout and specific nested paths precedence: %s', (path, id) => {
    expect(parseCompatRoute('#' + path).id).toBe(id)
  })

  it.each([
    ['settings-skill-detail', '/settings/skills/$skillId', 'skillId'],
    ['settings-scheduled-task-detail', '/settings/scheduled-tasks/$taskId', 'taskId']
  ])('preserves decoded opaque identity for %s', (id, template, param) => {
    const path = resolveCompatPath(template, { [param]: '技能 a?b#c%' })
    const route = parseCompatRoute('#' + path + '?panel=detail')
    expect(route).toMatchObject({ id, path, [param]: '技能 a?b#c%' })
    expect(COMPAT_SUPPORTED_PATHS).toContain(template)
    render(<CompatRemainingSettings route={route} />)
    expect(screen.getByRole('alert').textContent).toContain('技能 a?b#c%')
  })

  it.each(['%', '%GG', '%E0%A4%A', '%2F', '%5C', '%00', '%0A', '%20', '.', '..', 'a/b', '/'])('diagnoses malformed detail IDs without throwing: %s', value => {
    for (const family of ['skills', 'scheduled-tasks']) {
      const route = parseCompatRoute('#/settings/' + family + '/' + value)
      expect(route.id).toBe('settings-invalid')
      expect(isCompatSettingsRoute(route)).toBe(true)
      render(<CompatRemainingSettings route={route} />)
      expect(screen.getByRole('alert').textContent).toContain('INVALID')
      expect(screen.getByRole('alert').textContent).toContain('下一步')
      cleanup()
    }
  })

  it.each([undefined, null, '', ' ', '/', '\\', '.', '..', '\n', {}, 1])('rejects invalid template params: %s', value => {
    expect(() => resolveCompatPath('/settings/skills/$skillId', { skillId: value })).toThrow()
  })

  it('guards malformed existing MCP params without regressing normal MCP routing', () => {
    expect(parseCompatRoute('#/settings/mcp/settings/%')).toMatchObject({ id: 'settings-invalid' })
    expect(parseCompatRoute('#/settings/mcp/%GG')).toMatchObject({ id: 'settings-invalid' })
    expect(parseCompatRoute('#/settings/mcp/servers')).toEqual({ id: 'settings-mcp', path: '/settings/mcp' })
    expect(parseCompatRoute('#/settings/mcp/settings/a%20b')).toMatchObject({ id: 'settings-mcp-detail', serverId: 'a b' })
    expect(parseCompatRoute('#/settings/mcp/settings/a/b').id).toBe('unknown')
    expect(parseCompatRoute('#/settings/not-a-source-route').id).toBe('unknown')
  })

  it('keeps Model/Search blocked with their actual validation/context/consumer gaps', () => {
    expect(getSettingsDiagnostic('settings-model')!.missing.join(' ')).toContain('chat.default_model_id')
    expect(getSettingsDiagnostic('settings-model')!.nextAction).toContain('focus')
    expect(getSettingsDiagnostic('settings-search')!.missing.join(' ')).toContain('q 字节上限')
    expect(getSettingsDiagnostic('settings-search')!.missing.join(' ')).toContain('pending focus')
    expect(getSettingsDiagnostic('toString')).toBeUndefined()
    expect(getSettingsDiagnostic('settings-provider')).toBeUndefined()
    expect(COMPAT_ROUTE_PATHS['settings-provider']).toBe('/settings/provider')
    expect(Object.keys(REMAINING_SETTINGS_DETAIL_PATTERNS)).toHaveLength(2)
  })

  it('wires diagnostics ahead of the preserved settings subtree in the shell main slot', () => {
    const shell = readFileSync(resolve(process.cwd(), 'src/cherry-chat-shell-entry.tsx'), 'utf8')
    expect(shell).toContain('const settingsRoute = isCompatSettingsRoute(route)')
    expect(shell).toContain('main={appRoute ? appSurface : settingsRoute ? settingsSurface : main}')
    expect(shell.indexOf('<CompatRemainingSettings route={route} />')).toBeLessThan(shell.indexOf('route.id === \'settings-general\' ? ('))
  })
})
