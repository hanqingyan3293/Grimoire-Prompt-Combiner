import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComfyUIClient } from './comfy-client'

afterEach(() => { vi.unstubAllGlobals() })

describe('ComfyUI client', () => {
  it('accepts the local default and rejects insecure remote URLs', () => {
    expect(new ComfyUIClient().baseUrl).toBe('http://127.0.0.1:8188')
    expect(() => new ComfyUIClient('http://example.com:8188')).toThrow('HTTPS')
  })

  it('downloads images only from the configured ComfyUI view endpoint', async () => {
    const client = new ComfyUIClient()
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])
    vi.stubGlobal('fetch', vi.fn(async () => new Response(png, { status: 200 })))

    await expect(client.downloadImage({ filename: 'result.png', subfolder: '', type: 'output', url: 'http://127.0.0.1:8188/view?filename=result.png&subfolder=&type=output' }))
      .resolves.toEqual(png)
    await expect(client.downloadImage({ filename: 'result.png', subfolder: '', type: 'output', url: 'http://127.0.0.2:8188/view?filename=result.png&subfolder=&type=output' }))
      .rejects.toThrow('服务范围')
    await expect(client.downloadImage({ filename: 'result.png', subfolder: '', type: 'output', url: 'http://127.0.0.1:8188/system_stats' }))
      .rejects.toThrow('服务范围')
  })

  it('enforces the image size limit while reading a response without a length header', async () => {
    const client = new ComfyUIClient()
    const oversized = new Uint8Array(100 * 1024 * 1024 + 1)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(oversized, { status: 200 })))

    await expect(client.downloadImage({ filename: 'large.png', subfolder: '', type: 'output', url: 'http://127.0.0.1:8188/view?filename=large.png&subfolder=&type=output' }))
      .rejects.toThrow('过大')
  })

  it('merges models from LoraLoader and LoraLoaderModelOnly without duplicates', async () => {
    const client = new ComfyUIClient()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const payload = url.includes('CheckpointLoaderSimple')
        ? { CheckpointLoaderSimple: { input: { required: { ckpt_name: [['base.safetensors']] } } } }
        : url.includes('UNETLoader')
          ? { UNETLoader: { input: { required: { unet_name: [['unet.safetensors']] } } } }
          : url.includes('LoraLoaderModelOnly')
            ? { LoraLoaderModelOnly: { input: { required: { lora_name: [['style.safetensors', 'detail.safetensors']] } } } }
            : { LoraLoader: { input: { required: { lora_name: [['detail.safetensors', 'face.safetensors']] } } } }
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
    }))

    await expect(client.models()).resolves.toEqual({
      checkpoints: ['base.safetensors'],
      unets: ['unet.safetensors'],
      loras: ['detail.safetensors', 'face.safetensors', 'style.safetensors'],
    })
  })

  it('covers status, prompt submission, and completed history parsing', async () => {
    const client = new ComfyUIClient()
    const workflow = { '1': { class_type: 'SaveImage', inputs: { filename_prefix: 'Test' } } } as any
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/system_stats')) return jsonResponse({ system: { comfyui_version: '0.3.40' } })
      if (url.endsWith('/prompt')) {
        expect(init?.method).toBe('POST')
        expect(JSON.parse(String(init?.body))).toEqual({ prompt: workflow })
        return jsonResponse({ prompt_id: 'prompt-test', number: 12 })
      }
      if (url.endsWith('/history/prompt-test')) {
        return jsonResponse({
          'prompt-test': {
            status: { status_str: 'success' },
            outputs: { '9': { images: [{ filename: 'Test_00001.png', subfolder: '', type: 'output' }] } },
          },
        })
      }
      return jsonResponse({}, 404)
    }))

    await expect(client.status()).resolves.toEqual({ online: true, comfyui_version: '0.3.40' })
    await expect(client.submit(workflow)).resolves.toEqual({ prompt_id: 'prompt-test', number: 12 })
    await expect(client.history('prompt-test')).resolves.toEqual({
      status: 'done',
      images: [{ filename: 'Test_00001.png', subfolder: '', type: 'output', url: 'http://127.0.0.1:8188/view?filename=Test_00001.png&subfolder=&type=output' }],
    })
  })
})

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}
