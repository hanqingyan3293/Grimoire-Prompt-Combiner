import crypto from 'crypto'
import { getDatabase, saveDatabase } from '../database'
import { analyzeComfyWorkflow, parseComfyWorkflow, type ComfyWorkflow, type ComfyWorkflowAnalysis } from './comfy-workflow.core'

export interface StoredComfyWorkflow {
  id: string
  name: string
  raw_json: string
  analysis_json: string
  bindings_json: string
  source: string
  created_at: string
  updated_at: string
}

function rowToWorkflow(row: unknown[]): StoredComfyWorkflow {
  return { id: String(row[0]), name: String(row[1]), raw_json: String(row[2]), analysis_json: String(row[3]), bindings_json: String(row[4]), source: String(row[5]), created_at: String(row[6]), updated_at: String(row[7]) }
}

function selectSql() { return 'SELECT id, name, raw_json, analysis_json, bindings_json, source, created_at, updated_at FROM comfy_workflows' }

export function listComfyWorkflows(): StoredComfyWorkflow[] {
  const result = getDatabase().exec(selectSql() + ' ORDER BY updated_at DESC')
  return (result[0]?.values || []).map(rowToWorkflow)
}

export function getComfyWorkflow(id: string): StoredComfyWorkflow | null {
  const result = getDatabase().exec(selectSql() + ' WHERE id=?', [id])
  return result[0]?.values?.[0] ? rowToWorkflow(result[0].values[0]) : null
}

export function importComfyWorkflow(name: string, input: unknown, source = 'imported'): StoredComfyWorkflow & { analysis: ComfyWorkflowAnalysis } {
  const workflow: ComfyWorkflow = parseComfyWorkflow(input)
  const analysis = analyzeComfyWorkflow(workflow)
  const id = 'comfy_' + crypto.randomUUID().replaceAll('-', '').slice(0, 20)
  const now = new Date().toISOString()
  getDatabase().run('INSERT INTO comfy_workflows (id, name, raw_json, analysis_json, bindings_json, source, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)', [id, name.trim().slice(0, 200) || '未命名工作流', JSON.stringify(workflow), JSON.stringify(analysis), JSON.stringify(analysis.bindings), source, now, now])
  saveDatabase()
  const stored = getComfyWorkflow(id)
  if (!stored) throw new Error('保存 ComfyUI 工作流失败')
  return { ...stored, analysis }
}

export function deleteComfyWorkflow(id: string): boolean {
  const result = getDatabase().run('DELETE FROM comfy_workflows WHERE id=?', [id])
  saveDatabase()
  return Number(result.changes) > 0
}
