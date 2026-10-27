import { describe, expect, it, vi } from 'vitest'
import { saveMarkdownExport } from './markdown-save'

describe('Markdown save Host adapter', () => {
  it('passes content first and the suggested filename second', async () => {
    const save = vi.fn<(content: string, defaultName: string) => Promise<boolean>>().mockResolvedValue(true)
    await expect(saveMarkdownExport('主题', '# 实际对话\n', { save })).resolves.toBe(true)
    expect(save).toHaveBeenCalledExactlyOnceWith('# 实际对话\n', '主题.md')
  })

  it('preserves cancellation without claiming a saved file', async () => {
    const save = vi.fn<(content: string, defaultName: string) => Promise<boolean>>().mockResolvedValue(false)
    await expect(saveMarkdownExport('message-1', '内容', { save })).resolves.toBe(false)
  })

  it('propagates save failure to the caller', async () => {
    const save = vi.fn<(content: string, defaultName: string) => Promise<boolean>>().mockRejectedValue(new Error('disk full'))
    await expect(saveMarkdownExport('主题', '内容', { save })).rejects.toThrow('disk full')
  })
})
