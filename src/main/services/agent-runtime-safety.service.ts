import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

/** Safe fallbacks are private work dirs, never the executable/vendor directory. */
export function runtimeWorkingDirectory(owner: string, requested?: string): string {
  if (requested !== undefined) {
    if (!path.isAbsolute(requested) || /[\u0000-\u001f]/.test(requested)) throw new Error('RUNTIME_WORKSPACE_INVALID')
    const canonical = fs.realpathSync(requested)
    if (!fs.statSync(canonical).isDirectory()) throw new Error('RUNTIME_WORKSPACE_UNAVAILABLE')
    return canonical
  }
  const key = crypto.createHash('sha256').update(owner).digest('hex')
  const directory = path.join(app.getPath('userData'), 'agent-runtime-workspaces', key)
  fs.mkdirSync(directory, { recursive: true })
  return fs.realpathSync(directory)
}

/** Child runtimes inherit OS necessities only, never provider/OAuth tokens or runtime overrides. */
export function runtimeProcessEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const allowed = new Set(['path', 'systemroot', 'windir', 'comspec', 'pathext', 'processor_architecture', 'number_of_processors', 'temp', 'tmp', 'lang', 'lc_all', 'ssl_cert_file', 'ssl_cert_dir'])
  return Object.fromEntries(Object.entries(source).filter(([name, value]) => value !== undefined && allowed.has(name.toLowerCase())))
}

export function safeRuntimeError(error: unknown, secrets: readonly (string | undefined)[] = []): string {
  let text = error instanceof Error ? error.message : String(error)
  for (const value of secrets) if (value) text = text.split(value).join('<redacted>')
  return text.replace(/(Bearer\s+)[^\s"']+/gi, '$1<redacted>')
    .replace(/([?&](?:key|token|api_key|access_token)=)[^&\s]+/gi, '$1<redacted>')
    .slice(0, 2000)
}
