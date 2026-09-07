import { describe, expect, it } from 'vitest'
import { decodeStoredZip, encodeStoredZip, remapImportedCanvasNodes, validateProjectPackage } from './project-package.service'

describe('project package ZIP', () => {
  it('round trips UTF-8 names and binary image data', () => {
    const source = new Map<string, Buffer>([
      ['manifest.json', Buffer.from('{"kind":"grimoire-project"}')],
      ['project.json', Buffer.from('{"project":{}}')],
      ['assets/images/1.png', Buffer.from([0x89, 0x50, 0x4e, 0x47])],
    ])
    const decoded = decodeStoredZip(encodeStoredZip(source))
    expect([...decoded.keys()]).toEqual([...source.keys()])
    expect(decoded.get('assets/images/1.png')).toEqual(source.get('assets/images/1.png'))
  })

  it('rejects an invalid archive', () => {
    expect(() => decodeStoredZip(Buffer.from('not a zip'))).toThrow('ZIP')
  })

  it('rejects corrupted entry data', () => {
    const zip = encodeStoredZip(new Map([['manifest.json', Buffer.from('valid')]]))
    zip[zip.indexOf(Buffer.from('valid'))] ^= 0xff
    expect(() => decodeStoredZip(zip)).toThrow('校验')
  })

  it('rejects malformed package manifests before importing resources', () => {
    expect(() => validateProjectPackage({ kind: 'grimoire-project', version: 1, project: null })).toThrow('画布项目')
    expect(() => validateProjectPackage({
      kind: 'grimoire-project', version: 1, project: { name: 'test', document: { version: 1, viewport: { x: 0, y: 0, scale: 1 }, nodes: [], connections: [] } },
      images: {}, taskSummaries: [], workflows: [], promptAssets: [],
    })).toThrow('资源清单')
  })

  it('remaps static plugin node references and keeps task results as snapshots', () => {
    const warnings: string[] = []
    const document = remapImportedCanvasNodes({
      version: 1, viewport: { x: 0, y: 0, scale: 1 }, connections: [], nodes: [
        { id: 'wd', kind: 'wd14', title: 'WD14', content: 'done', refId: 'task-old', status: 'success', config: { imageId: 10, threshold: 0.4 }, position: { x: 0, y: 0 }, width: 320, height: 230 },
        { id: 'comfy', kind: 'comfyui', title: 'Comfy', content: 'prompt', refId: 'task-2', status: 'running', config: { workflowId: 'wf-old' }, position: { x: 400, y: 0 }, width: 340, height: 250 },
        { id: 'asset', kind: 'prompt-asset', title: 'Asset', content: 'long hair', config: { assetId: 'asset-old' }, position: { x: 800, y: 0 }, width: 340, height: 220 },
      ],
    }, new Map([[10, { id: 99, filePath: 'managed.png' }]]), new Map([['wf-old', 'wf-new']]), warnings)
    expect(document.nodes[0]).toMatchObject({ refId: undefined, config: { imageId: 99, threshold: 0.4 }, status: 'success' })
    expect(document.nodes[1]).toMatchObject({ refId: undefined, config: { workflowId: 'wf-new' }, status: 'idle' })
    expect(document.nodes[2]).toMatchObject({ content: 'long hair', config: undefined })
    expect(warnings.filter(warning => warning.includes('快照'))).toHaveLength(2)
  })

  it('removes missing plugin references and reports import warnings', () => {
    const warnings: string[] = []
    const document = remapImportedCanvasNodes({
      version: 1, viewport: { x: 0, y: 0, scale: 1 }, connections: [], nodes: [
        { id: 'wd', kind: 'wd14', title: 'WD14', content: '', config: { imageId: 10 }, position: { x: 0, y: 0 }, width: 320, height: 230 },
        { id: 'comfy', kind: 'comfyui', title: 'Comfy', content: 'prompt', config: { workflowId: 'missing' }, position: { x: 400, y: 0 }, width: 340, height: 250 },
      ],
    }, new Map(), new Map(), warnings)
    expect(document.nodes[0].config?.imageId).toBeUndefined()
    expect(document.nodes[1].config).toBeUndefined()
    expect(warnings).toEqual(expect.arrayContaining([expect.stringContaining('图片引用'), expect.stringContaining('工作流引用')]))
  })
})
