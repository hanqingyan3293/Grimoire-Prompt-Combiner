import fs from 'fs'
import os from 'os'
import path from 'path'
import { app, dialog, shell, type BrowserWindow, type SaveDialogOptions } from 'electron'
import { resolveUserPath } from './cherry-path.service'

/**
 * File bridge for the Cherry compat composer.
 *
 * The source composer drop/paste path needs `window.api.file.get(path)` →
 * `FileMetadata` (`{ id, name, origin_name, path, size, ext, type }`), a
 * `file.get_metadata` route returning the source `PhysicalFileMetadata` shape
 * (`{ kind, size, createdAt, modifiedAt, mime, type? }`), and a temp-file area for
 * pasted text/images. All of it must run in main because renderer code never reads
 * the filesystem directly.
 *
 * The extension→type table is a bounded reimplementation of the source
 * `@shared/utils/file` extension groups: those lists live in the renderer bundle's
 * alias space and cannot be imported across the process boundary. It only feeds the
 * icon/type label; the authoritative gate for what can be attached stays the
 * extension allow-list the compat entry passes to `supportedExts` plus the
 * attachment service's own mime/size checks.
 */

export type BridgeFileType = 'image' | 'video' | 'audio' | 'text' | 'document' | 'other'

const EXT_TYPE: Record<string, BridgeFileType> = {
  '.jpg': 'image', '.jpeg': 'image', '.png': 'image', '.gif': 'image', '.bmp': 'image', '.webp': 'image', '.svg': 'image', '.ico': 'image', '.avif': 'image',
  '.mp4': 'video', '.mov': 'video', '.avi': 'video', '.mkv': 'video', '.webm': 'video', '.flv': 'video', '.wmv': 'video',
  '.mp3': 'audio', '.wav': 'audio', '.flac': 'audio', '.aac': 'audio', '.ogg': 'audio', '.m4a': 'audio', '.wma': 'audio',
  '.txt': 'text', '.md': 'text', '.markdown': 'text', '.json': 'text', '.csv': 'text', '.log': 'text', '.xml': 'text',
  '.yaml': 'text', '.yml': 'text', '.toml': 'text', '.ini': 'text', '.env': 'text', '.sql': 'text',
  '.html': 'text', '.css': 'text', '.js': 'text', '.jsx': 'text', '.ts': 'text', '.tsx': 'text', '.vue': 'text',
  '.py': 'text', '.java': 'text', '.c': 'text', '.cpp': 'text', '.h': 'text', '.go': 'text', '.rs': 'text', '.sh': 'text',
  '.pdf': 'document', '.doc': 'document', '.docx': 'document', '.xls': 'document', '.xlsx': 'document',
  '.ppt': 'document', '.pptx': 'document', '.odt': 'document', '.ods': 'document', '.rtf': 'document'
}

export function fileTypeForExtension(extension: string): BridgeFileType {
  return EXT_TYPE[extension.toLowerCase()] || 'other'
}

const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json',
  '.csv': 'text/csv', '.html': 'text/html', '.css': 'text/css', '.xml': 'application/xml', '.zip': 'application/zip'
}

function mimeForExtension(extension: string): string {
  return MIME_BY_EXTENSION[extension.toLowerCase()] || 'application/octet-stream'
}

export type BridgeFileInfo = {
  id: string
  name: string
  origin_name: string
  path: string
  size: number
  ext: string
  type: BridgeFileType
  mime: string
}

export type BridgePhysicalMetadata = {
  kind: 'file' | 'directory'
  size: number
  createdAt: number
  modifiedAt: number
  mime?: string
  type?: BridgeFileType
}

export function getBridgeFileInfo(inputPath: string): BridgeFileInfo | null {
  const target = path.resolve(String(inputPath || ''))
  if (!target) return null
  let stat: fs.Stats
  try { stat = fs.statSync(target) } catch { return null }
  if (!stat.isFile()) return null
  const ext = path.extname(target).toLowerCase()
  const name = path.basename(target)
  return {
    id: target,
    name,
    origin_name: name,
    path: target,
    size: stat.size,
    ext: ext || '.',
    type: fileTypeForExtension(ext),
    mime: mimeForExtension(ext)
  }
}

export function getBridgePhysicalMetadata(inputPath: string): BridgePhysicalMetadata | null {
  const target = path.resolve(String(inputPath || ''))
  if (!target) return null
  let stat: fs.Stats
  try { stat = fs.statSync(target) } catch { return null }
  if (stat.isDirectory()) {
    return { kind: 'directory', size: stat.size, createdAt: stat.birthtimeMs, modifiedAt: stat.mtimeMs }
  }
  if (!stat.isFile()) return null
  const ext = path.extname(target).toLowerCase()
  return {
    kind: 'file',
    size: stat.size,
    createdAt: stat.birthtimeMs,
    modifiedAt: stat.mtimeMs,
    mime: mimeForExtension(ext),
    type: fileTypeForExtension(ext)
  }
}

// PARTIAL_EXTRACTION of source shared/utils/file/url.ts's DANGEROUS_EXTS.
// Direct import pulls Cherry's branded-path/Zod aliases into the host main build;
// keep its exact policy here, not a narrower executable-only approximation.
const DEFAULT_OPEN_UNSAFE_EXTS = new Set([
  'sh', 'bash', 'zsh', 'fish', 'csh', 'ksh',
  'exe', 'com', 'bat', 'cmd', 'msi', 'scr', 'pif', 'cpl', 'ps1', 'psm1', 'psd1',
  'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'hta', 'reg', 'msc', 'inf',
  'application', 'appref-ms', 'lnk', 'url', 'iso', 'img', 'vhd', 'vhdx',
  'app', 'command', 'terminal', 'workflow', 'scpt', 'desktop', 'appimage', 'run',
  'jar', 'jnlp', 'py', 'pyw', 'svg', 'dmg', 'pkg'
])

/**
 * Adapter for source ipc.ts File_OpenPath -> openRequestPath -> safeOpen.
 * Unlike system:showItemInFolder this opens the selected target itself, with the
 * default OS association. No picker and no cwd-relative guessing. Reuse the host
 * system shell's main-only resolve/existence checks, with source home expansion
 * and default-open safety policy. Directories are valid source targets too.
 */
export async function openBridgePath(inputPath: unknown): Promise<void> {
  if (typeof inputPath !== 'string' || !inputPath.trim() || inputPath.includes('\0')) {
    throw new Error('INVALID_PATH: 文件路径无效')
  }
  const raw = inputPath.trim()
  if (!path.isAbsolute(raw) && !/^~[/\\\\]/.test(raw)) {
    throw new Error('INVALID_PATH: 必须提供绝对路径或主目录路径')
  }
  const target = resolveUserPath(raw)
  // Source openGuard strips trailing dots/spaces before checking extensions.
  const ext = path.extname(target.replace(/[\s.]+$/, '')).replace(/^\./, '').toLowerCase()
  if (DEFAULT_OPEN_UNSAFE_EXTS.has(ext)) {
    throw new Error(`OPEN_BLOCKED_UNSAFE_TYPE: Refusing to open .${ext} with the system default app`)
  }
  if (!fs.existsSync(target)) throw new Error(`NOT_FOUND: 文件不存在：${target}`)
  const failure = await shell.openPath(target)
  if (failure) throw new Error(`shell.open(${target}) failed: ${failure}`)
}

/** Source FileStorage.save contract; only the dialog options needed by export callers. */
export type BridgeSaveOptions = Pick<SaveDialogOptions, 'title' | 'defaultPath' | 'filters'>

function saveDialogOptions(fileName: unknown, input: unknown): SaveDialogOptions {
  const validText = (value: unknown): value is string => typeof value === 'string' && !value.includes('\0')
  if (!validText(fileName) || !fileName.trim()) throw new Error('FILE_SAVE_INVALID_NAME')
  const result: SaveDialogOptions = { title: '保存文件', defaultPath: fileName }
  if (input === undefined) return result
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('FILE_SAVE_INVALID_OPTIONS')
  for (const [key, value] of Object.entries(input)) {
    if (key === 'title' || key === 'defaultPath') {
      if (!validText(value)) throw new Error('FILE_SAVE_INVALID_OPTIONS')
      result[key] = value
    } else if (key === 'filters') {
      if (!Array.isArray(value) || !value.every(filter => filter && typeof filter === 'object'
        && validText(filter.name) && Array.isArray(filter.extensions) && filter.extensions.length > 0
        && filter.extensions.every((ext: unknown) => typeof ext === 'string' && /^(?:\*|[a-zA-Z0-9_-]+)$/.test(ext)))) {
        throw new Error('FILE_SAVE_INVALID_OPTIONS')
      }
      result.filters = value.map(filter => ({ name: filter.name, extensions: [...filter.extensions] }))
    } else {
      throw new Error(`FILE_SAVE_UNSUPPORTED_OPTION: ${key}`)
    }
  }
  return result
}

/** Resolve missing leaves through their existing parent, including symlinked folders. */
function existingRealPath(target: string): string {
  try { return fs.realpathSync(target) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const parent = path.dirname(target)
    if (parent === target) throw error
    return path.join(existingRealPath(parent), path.basename(target))
  }
}

/**
 * Adapt the source managed-storage mutation guard to Grimoire's data ownership. Exported because the simpler
 * text-dialog save (DIALOG_SAVE_TEXT) writes user-chosen paths too and must apply the same invariant — it
 * did not, so an export could overwrite files inside the app's own data directory.
 */
export function assertNotManagedTarget(filePath: string): void {
  const root = path.resolve(app.getPath('userData'))
  const target = path.resolve(filePath)
  for (const [base, candidate] of [[root, target], [existingRealPath(root), existingRealPath(target)]]) {
    const relative = path.relative(base, candidate)
    if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
      throw new Error('FILE_SAVE_MANAGED_STORAGE: 不能覆盖应用管理的数据')
    }
  }
}

export async function saveBridgeFile(
  parent: BrowserWindow,
  fileName: unknown,
  content: unknown,
  options?: unknown
): Promise<string | null> {
  const dialogOptions = saveDialogOptions(fileName, options)
  if (typeof content !== 'string' && !(content instanceof Uint8Array)) throw new Error('FILE_SAVE_INVALID_CONTENT')
  // Copy bytes before awaiting user interaction; Buffer also satisfies Uint8Array.
  const data = typeof content === 'string' ? content : Buffer.from(content)
  const result = await dialog.showSaveDialog(parent, dialogOptions)
  if (result.canceled || !result.filePath) return null
  assertNotManagedTarget(result.filePath)
  await fs.promises.writeFile(result.filePath, data, { encoding: 'utf-8' })
  return result.filePath
}

const READ_TEXT_MAX_BYTES = 5 * 1024 * 1024

/** Capped text read for the composer's "open pasted text" affordance. */
export function readBridgeTextFile(inputPath: string): string {
  const target = path.resolve(String(inputPath || ''))
  const stat = fs.statSync(target)
  if (!stat.isFile()) throw new Error('FILE_BRIDGE_NOT_FILE: 目标不是文件')
  if (stat.size > READ_TEXT_MAX_BYTES) throw new Error('FILE_BRIDGE_TOO_LARGE: 文件过大，无法作为文本读取')
  return fs.readFileSync(target, 'utf8')
}

/** Dedicated temp area; `file:write` refuses any path outside it. */
export function getBridgeTempRoot(): string {
  const root = path.join(app.getPath('temp') || os.tmpdir(), 'grimoire-cherry-composer')
  fs.mkdirSync(root, { recursive: true })
  return root
}

function sanitizeTempName(name: string): string {
  const base = path.basename(String(name || 'pasted')) || 'pasted'
  return base.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 120) || 'pasted'
}

export function createBridgeTempFile(name: string): string {
  const root = getBridgeTempRoot()
  const target = path.join(root, Date.now().toString(36) + '-' + sanitizeTempName(name))
  fs.mkdirSync(root, { recursive: true })
  return target
}

export function writeBridgeTempFile(inputPath: string, data: string | Uint8Array): string {
  const root = getBridgeTempRoot()
  const target = path.resolve(String(inputPath || ''))
  const relative = path.relative(root, target)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('FILE_BRIDGE_TEMP_ONLY: 只能写入桥接临时目录')
  }
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, typeof data === 'string' ? data : Buffer.from(data))
  return target
}
