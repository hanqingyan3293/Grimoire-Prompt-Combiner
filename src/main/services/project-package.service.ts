import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { getDatabase } from '../database'
import { registerManagedImage } from './image-asset.service'
import { createCanvasProject, saveCanvasProject } from './canvas.service'
import { validateCanvasDocument } from '../../shared/canvas-validation'
import { isCanvasTaskNodeKind, type CanvasDocument, type CanvasProject } from '../../shared/canvas-types'
import type { ProjectPackage, ProjectPackageImage, ProjectPackageImportResult } from '../../shared/project-package-types'

const MAX_PACKAGE_BYTES = 300 * 1024 * 1024
const MAX_ZIP_ENTRIES = 2000

export async function exportProjectPackage(projectId: string, outputPath: string, format: 'json' | 'zip'): Promise<void> {
  const project = getCanvasProjectForPackage(projectId)
  const payload = await buildProjectPackage(project)
  if (format === 'json') {
    await fs.promises.writeFile(outputPath, JSON.stringify(payload, null, 2), 'utf8')
    return
  }
  const entries = new Map<string, Buffer>()
  entries.set('manifest.json', Buffer.from(JSON.stringify({ kind: payload.kind, version: payload.version, created_at: payload.created_at }, null, 2)))
  entries.set('project.json', Buffer.from(JSON.stringify({ project: payload.project, taskSummaries: payload.taskSummaries, workflows: payload.workflows, promptAssets: payload.promptAssets }, null, 2)))
  entries.set('images.json', Buffer.from(JSON.stringify(payload.images.map(image => ({ ...image, dataBase64: undefined })), null, 2)))
  for (const image of payload.images) {
    if (!image.dataBase64 || !image.archivePath) continue
    entries.set(image.archivePath, Buffer.from(image.dataBase64, 'base64'))
  }
  const zip = encodeStoredZip(entries)
  if (zip.length > MAX_PACKAGE_BYTES) throw new Error('项目包超过 300MB 限制')
  await fs.promises.writeFile(outputPath, zip)
}

export async function importProjectPackage(inputPath: string): Promise<ProjectPackageImportResult> {
  const raw = await fs.promises.readFile(inputPath)
  if (raw.length > MAX_PACKAGE_BYTES) throw new Error('项目包超过 300MB 限制')
  const payload = path.extname(inputPath).toLowerCase() === '.zip'
    ? await readZipPackage(raw)
    : parseJsonPackage(raw.toString('utf8'))
  const validatedPayload = validateProjectPackage(payload)
  const warnings = [...validatePackageReferences(validatedPayload)]
  const imageMap = new Map<number, { id: number; filePath: string }>()
  let importedImages = 0
  let skippedImages = 0
  let importedPromptAssets = 0
  let importedWorkflows = 0
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'grimoire-package-'))
  const db = getDatabase()
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const image of validatedPayload.images) {
      try {
        if (!image.dataBase64) throw new Error('图片数据缺失')
        const tempPath = path.join(tempRoot, safeArchiveName(image.archivePath || `${image.sourceId}.bin`))
        await fs.promises.writeFile(tempPath, Buffer.from(image.dataBase64, 'base64'))
        const registered = await registerManagedImage(tempPath, image.originalName || undefined)
        imageMap.set(image.sourceId, { id: registered.id, filePath: registered.file_path })
        importedImages++
      } catch (error) {
        skippedImages++
        warnings.push(`图片 ${image.sourceId} 导入失败：${error instanceof Error ? error.message : String(error)}`)
      }
    }
    const workflowMap = new Map<string, string>()
    for (const asset of validatedPayload.promptAssets) {
      const result = db.run('INSERT OR IGNORE INTO prompt_assets (id, source_id, source, name, prompt, chapter, section, subsection, nsfw, variant_count, source_fingerprint) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [
        `pkg_${crypto.createHash('sha256').update(asset.source + ':' + asset.source_id).digest('hex').slice(0, 24)}`, asset.source_id, asset.source, asset.name, asset.prompt, asset.chapter, asset.section, asset.subsection, asset.nsfw ? 1 : 0, asset.variant_count, asset.source_fingerprint,
      ])
      importedPromptAssets += Number(result.changes)
    }
    for (const workflow of validatedPayload.workflows) {
      const id = 'comfy_' + crypto.randomUUID().replaceAll('-', '').slice(0, 20)
      db.run('INSERT INTO comfy_workflows (id, name, raw_json, analysis_json, bindings_json, source, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)', [id, `${workflow.name}（导入）`.slice(0, 200), workflow.raw_json, workflow.analysis_json, workflow.bindings_json, 'project-package', new Date().toISOString(), new Date().toISOString()])
      importedWorkflows++
      workflowMap.set(workflow.id, id)
    }
    const document = remapImportedCanvasNodes(validatedPayload.project.document, imageMap, workflowMap, warnings)
    const created = createCanvasProject(`${validatedPayload.project.name}（导入）`)
    const saved = saveCanvasProject(created.id, created.name, document)
    db.exec('COMMIT')
    return { projectId: saved.id, projectName: saved.name, importedImages, skippedImages, warnings, importedPromptAssets, importedWorkflows }
  } catch (error) {
    try { db.exec('ROLLBACK') } catch {}
    throw error
  } finally {
    await fs.promises.rm(tempRoot, { recursive: true, force: true })
  }
}

function getCanvasProjectForPackage(id: string): CanvasProject {
  const result = getDatabase().exec('SELECT id, name, data_json, created_at, updated_at FROM canvas_projects WHERE id=?', [id])
  const row = result[0]?.values?.[0]
  if (!row) throw new Error('画布项目不存在')
  return { id: String(row[0]), name: String(row[1]), document: validateCanvasDocument(JSON.parse(String(row[2]))), created_at: String(row[3]), updated_at: String(row[4]) }
}

async function buildProjectPackage(project: CanvasProject): Promise<ProjectPackage> {
  const imageIds = [...new Set(project.document.nodes.flatMap(node => {
    if (node.kind === 'image' && node.refId) return [Number(node.refId)]
    if (node.kind === 'wd14' && Number.isInteger(node.config?.imageId)) return [Number(node.config?.imageId)]
    return []
  }).filter(id => Number.isInteger(id) && id > 0))]
  const images: ProjectPackageImage[] = []
  for (const id of imageIds) {
    const result = getDatabase().exec('SELECT file_path, original_name, mime_type, file_size FROM image_refs WHERE id=?', [id])
    const row = result[0]?.values?.[0]
    if (!row) continue
    const filePath = String(row[0])
    if (!fs.existsSync(filePath)) continue
    const extension = path.extname(filePath).toLowerCase() || '.bin'
    images.push({ sourceId: id, originalName: row[1] ? String(row[1]) : null, mimeType: row[2] ? String(row[2]) : null, fileSize: row[3] == null ? null : Number(row[3]), dataBase64: (await fs.promises.readFile(filePath)).toString('base64'), archivePath: `assets/images/${id}${extension}` })
  }

  const taskIds = [...new Set(project.document.nodes.filter(node => isCanvasTaskNodeKind(node.kind) && node.refId).map(node => node.refId).filter(Boolean))] as string[]
  const tasks = taskIds.length ? getDatabase().exec(`SELECT id, kind, status, output_json FROM task_jobs WHERE id IN (${taskIds.map(() => '?').join(',')})`, taskIds) : []
  const taskSummaries = (tasks[0]?.values || []).map(row => ({ id: String(row[0]), kind: String(row[1]), status: String(row[2]), output_json: row[3] == null ? null : String(row[3]) }))
  const workflowIds = taskSummaries.flatMap(task => { try { const input = JSON.parse(getTaskInput(task.id)); return typeof input.workflowId === 'string' ? [input.workflowId] : [] } catch { return [] } })
  const workflows = getDatabase().exec('SELECT id, name, raw_json, analysis_json, bindings_json FROM comfy_workflows ORDER BY updated_at DESC')
  const promptAssets = getDatabase().exec('SELECT source_id, source, name, prompt, chapter, section, subsection, nsfw, variant_count, source_fingerprint FROM prompt_assets ORDER BY updated_at DESC LIMIT 10000')
  return { kind: 'grimoire-project', version: 1, created_at: new Date().toISOString(), project: { name: project.name, document: project.document }, images, taskSummaries, workflows: (workflows[0]?.values || []).map(row => ({ id: String(row[0]), name: String(row[1]), raw_json: String(row[2]), analysis_json: String(row[3]), bindings_json: String(row[4]) })), promptAssets: (promptAssets[0]?.values || []).map(row => ({ source_id: String(row[0]), source: String(row[1]), name: String(row[2]), prompt: String(row[3]), chapter: String(row[4] || ''), section: String(row[5] || ''), subsection: String(row[6] || ''), nsfw: Number(row[7] || 0), variant_count: Number(row[8] || 0), source_fingerprint: String(row[9] || '') })) }
}

function getTaskInput(taskId: string): string {
  const result = getDatabase().exec('SELECT input_json FROM task_jobs WHERE id=?', [taskId])
  return String(result[0]?.values?.[0]?.[0] || '{}')
}

function parseJsonPackage(text: string): ProjectPackage {
  const parsed = JSON.parse(text) as ProjectPackage
  return { ...parsed, promptAssets: Array.isArray(parsed.promptAssets) ? parsed.promptAssets : [] }
}

export function validateProjectPackage(value: unknown): ProjectPackage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('项目包格式无效')
  const payload = value as Partial<ProjectPackage>
  if (payload.kind !== 'grimoire-project' || payload.version !== 1) throw new Error('项目包版本不支持')
  if (!payload.project || typeof payload.project !== 'object' || typeof payload.project.name !== 'string' || !payload.project.document) throw new Error('项目包缺少有效画布项目')
  if (!Array.isArray(payload.images) || !Array.isArray(payload.taskSummaries) || !Array.isArray(payload.workflows) || !Array.isArray(payload.promptAssets)) throw new Error('项目包资源清单无效')
  if (payload.images.length > 2000) throw new Error('项目包图片数量超过限制')
  if (payload.workflows.length > 2000) throw new Error('项目包工作流数量超过限制')
  if (payload.promptAssets.length > 10000) throw new Error('项目包提示词资产数量超过限制')
  if (payload.taskSummaries.length > 2000) throw new Error('项目包任务摘要数量超过限制')
  validateCanvasDocument(payload.project.document)
  return payload as ProjectPackage
}

async function readZipPackage(buffer: Buffer): Promise<ProjectPackage> {
  const entries = decodeStoredZip(buffer)
  const manifest = JSON.parse(requireEntry(entries, 'manifest.json').toString('utf8')) as { kind: string; version: number }
  const project = JSON.parse(requireEntry(entries, 'project.json').toString('utf8')) as Pick<ProjectPackage, 'project' | 'taskSummaries' | 'workflows' | 'promptAssets'>
  const metadata = JSON.parse(requireEntry(entries, 'images.json').toString('utf8')) as ProjectPackageImage[]
  const images = metadata.map(image => {
    if (!image.archivePath) return image
    const content = entries.get(image.archivePath)
    return { ...image, dataBase64: content?.toString('base64') }
  })
  return { ...manifest, created_at: new Date().toISOString(), ...project, promptAssets: Array.isArray(project.promptAssets) ? project.promptAssets : [], images } as ProjectPackage
}

function validatePackageReferences(payload: ProjectPackage): string[] {
  const warnings: string[] = []
  try { validateCanvasDocument(payload.project.document) } catch (error) { throw new Error(`画布文档无效：${error instanceof Error ? error.message : String(error)}`) }
  return warnings
}

export function remapImportedCanvasNodes(document: CanvasDocument, imageMap: Map<number, { id: number; filePath: string }>, workflowMap: Map<string, string>, warnings: string[]): CanvasDocument {
  return validateCanvasDocument({ ...document, nodes: document.nodes.map(node => {
    let next = node
    if (isCanvasTaskNodeKind(node.kind) && node.refId) {
      warnings.push(`任务节点 ${node.id} 已作为快照导入，不会重新绑定或执行旧任务`)
      next = { ...node, refId: undefined, status: node.status === 'running' ? 'idle' : node.status }
    }
    if (next.kind === 'image' && next.refId) {
      const imported = imageMap.get(Number(next.refId))
      if (!imported) { warnings.push(`图片节点 ${node.id} 未找到可导入资源`); return { ...next, refId: undefined, content: '', status: 'error' } }
      next = { ...next, refId: String(imported.id), content: imported.filePath }
    }
    if (next.kind === 'wd14' && next.config?.imageId) {
      const imported = imageMap.get(next.config.imageId)
      next = { ...next, config: { ...next.config, imageId: imported?.id } }
      if (!imported) warnings.push(`WD14 节点 ${node.id} 的图片引用未找到`)
    }
    if (next.kind === 'comfyui' && next.config?.workflowId) {
      const workflowId = workflowMap.get(next.config.workflowId)
      next = { ...next, config: workflowId ? { ...next.config, workflowId } : undefined }
      if (!workflowId) warnings.push(`ComfyUI 节点 ${node.id} 的工作流引用未找到`)
    }
    if (next.kind === 'prompt-asset' && next.config?.assetId) next = { ...next, config: undefined }
    return next
  }) })
}

function safeArchiveName(value: string): string {
  const normalized = value.replace(/[\\/]/g, '_')
  return normalized.includes('..') ? crypto.randomUUID() + '.bin' : path.basename(normalized)
}

function requireEntry(entries: Map<string, Buffer>, name: string): Buffer {
  const value = entries.get(name)
  if (!value) throw new Error(`项目包缺少 ${name}`)
  return value
}

export function encodeStoredZip(entries: Map<string, Buffer>): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const [name, data] of entries) {
    const nameBytes = Buffer.from(name, 'utf8')
    const crc = crc32(data)
    const local = Buffer.alloc(30 + nameBytes.length)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(0, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBytes.length, 26); nameBytes.copy(local, 30)
    locals.push(local, data)
    const central = Buffer.alloc(46 + nameBytes.length)
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8); central.writeUInt16LE(0, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(offset, 42); nameBytes.copy(central, 46)
    centrals.push(central); offset += local.length + data.length
  }
  const centralDirectory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.size, 8); end.writeUInt16LE(entries.size, 10); end.writeUInt32LE(centralDirectory.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, centralDirectory, end])
}

export function decodeStoredZip(buffer: Buffer): Map<string, Buffer> {
  if (buffer.length < 22 || buffer.length > MAX_PACKAGE_BYTES) throw new Error('ZIP 项目包大小无效')
  const entries = new Map<string, Buffer>()
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (end < 0) throw new Error('ZIP 结束目录无效')
  const count = buffer.readUInt16LE(end + 10)
  const centralOffset = buffer.readUInt32LE(end + 16)
  if (count > MAX_ZIP_ENTRIES || centralOffset >= end) throw new Error('ZIP 中央目录范围无效')
  let cursor = centralOffset
  let totalSize = 0
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end) throw new Error('ZIP 中央目录越界')
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error('ZIP 中央目录无效')
    const flags = buffer.readUInt16LE(cursor + 8); const method = buffer.readUInt16LE(cursor + 10)
    if (flags & 1 || method !== 0) throw new Error('仅支持未加密的 Store ZIP 项目包')
    const size = buffer.readUInt32LE(cursor + 24); const nameLength = buffer.readUInt16LE(cursor + 28); const extraLength = buffer.readUInt16LE(cursor + 30); const commentLength = buffer.readUInt16LE(cursor + 32); const localOffset = buffer.readUInt32LE(cursor + 42)
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8')
    if (!name || name.startsWith('/') || name.includes('..') || entries.size >= MAX_ZIP_ENTRIES) throw new Error('ZIP 项目路径无效')
    if (localOffset + 30 > centralOffset) throw new Error('ZIP 本地条目范围无效')
    const localNameLength = buffer.readUInt16LE(localOffset + 26); const localExtraLength = buffer.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const dataEnd = dataStart + size
    totalSize += size
    if (dataEnd > centralOffset || totalSize > MAX_PACKAGE_BYTES) throw new Error('ZIP 项目内容范围无效')
    const data = buffer.subarray(dataStart, dataEnd)
    if (crc32(data) !== buffer.readUInt32LE(cursor + 16)) throw new Error('ZIP 项目内容校验失败')
    entries.set(name, data)
    cursor += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
