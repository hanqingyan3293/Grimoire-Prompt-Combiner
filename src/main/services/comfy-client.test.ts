import { mockComfyHttpFixture } from './test-support/comfy-http-fixture'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComfyUIError, ComfyUIClient, createComfyUIClient } from './comfy-client'

afterEach(() => { vi.unstubAllGlobals() })

describe('ComfyUI client', () => {
  it('accepts the local default and rejects insecure remote URLs', () => {
    expect(new ComfyUIClient().baseUrl).toBe('http://127.0.0.1:8188')
    expect(() => new ComfyUIClient('http://example.com:8188')).toThrow('HTTPS')
  })

  it('applies the Comfy address policy in the constructor and setBaseUrl', () => {
    expect(new ComfyUIClient('https://comfy.example.com').baseUrl).toBe('https://comfy.example.com')
    expect(new ComfyUIClient('http://localhost:8188').baseUrl).toBe('http://localhost:8188')
    expect(new ComfyUIClient('http://[::1]:8188').baseUrl).toBe('http://[::1]:8188')
    expect(() => new ComfyUIClient('https://10.0.0.1')).toThrow('私有')
    expect(() => new ComfyUIClient('http://192.168.1.10:8188')).toThrow('HTTPS')
    expect(() => new ComfyUIClient('https://[fe80::1]')).toThrow('私有')

    const client = new ComfyUIClient()
    client.setBaseUrl('https://comfy.example.com/')
    expect(client.baseUrl).toBe('https://comfy.example.com')
    expect(() => client.setBaseUrl('https://169.254.169.254')).toThrow('私有')
    expect(client.baseUrl).toBe('https://comfy.example.com')
  })

  it('revalidates the configured base address before downloading', async () => {
    const client = new ComfyUIClient()
    client.baseUrl = 'https://10.0.0.1'
    await expect(client.downloadImage({
      filename: 'result.png',
      subfolder: '',
      type: 'output',
      url: 'https://10.0.0.1/view?filename=result.png&subfolder=&type=output',
    })).rejects.toThrow('私有')
  })

  it('downloads images only from the configured ComfyUI view endpoint', async () => {
    const client = new ComfyUIClient()
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])
    mockComfyHttpFixture(vi.fn(async () => new Response(png, { status: 200 })))

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
    mockComfyHttpFixture(vi.fn(async () => new Response(oversized, { status: 200 })))

    await expect(client.downloadImage({ filename: 'large.png', subfolder: '', type: 'output', url: 'http://127.0.0.1:8188/view?filename=large.png&subfolder=&type=output' }))
      .rejects.toThrow('过大')
  })

  it('merges models from LoraLoader and LoraLoaderModelOnly without duplicates', async () => {
    const client = new ComfyUIClient()
    mockComfyHttpFixture(vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('http://127.0.0.1:8188/object_info')
      const payload = {
        CheckpointLoaderSimple: { input: { required: { ckpt_name: [['base.safetensors']] } } },
        UNETLoader: { input: { required: { unet_name: [['unet.safetensors']] } } },
        LoraLoaderModelOnly: { input: { required: { lora_name: [['style.safetensors', 'detail.safetensors']] } } },
        LoraLoader: { input: { required: { lora_name: [['detail.safetensors', 'face.safetensors']] } } },
      }
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    await expect(client.models()).resolves.toEqual({
      checkpoints: ['base.safetensors'], unets: ['unet.safetensors'],
      loras: ['detail.safetensors', 'face.safetensors', 'style.safetensors'],
    })
  })

  it('reads object_info for widget order conversion and rejects a non-object payload', async () => {
    const client = new ComfyUIClient()
    mockComfyHttpFixture(vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('http://127.0.0.1:8188/object_info')
      return jsonResponse({ KSampler: { input: { required: { steps: ['INT', {}] } } } })
    }))

    await expect(client.objectInfo()).resolves.toEqual({ KSampler: { input: { required: { steps: ['INT', {}] } } } })

    mockComfyHttpFixture(vi.fn(async () => jsonResponse([])))
    await expect(client.objectInfo()).rejects.toThrow('节点定义无效')
  })

  it('covers status, prompt submission, and completed history parsing', async () => {
    const client = new ComfyUIClient()
    const workflow = { '1': { class_type: 'SaveImage', inputs: { filename_prefix: 'Test' } } } as any
    mockComfyHttpFixture(vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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

  it('reads queue counts and matches an optional prompt id', async () => {
    const client = new ComfyUIClient()
    mockComfyHttpFixture(vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('http://127.0.0.1:8188/queue')
      return jsonResponse({
        queue_running: [[0, 'prompt-running', {}, {}, []]],
        queue_pending: [[1, 'prompt-pending', {}, {}, []]],
      })
    }))

    await expect(client.queue()).resolves.toEqual({ queue_pending: 1, queue_running: 1, queued: false, running: false, queue_remaining: 1 })
    await expect(client.queue('prompt-pending')).resolves.toEqual({ queue_pending: 1, queue_running: 1, queued: true, running: false, queue_remaining: 1 })
    await expect(client.queue('prompt-running')).resolves.toEqual({ queue_pending: 1, queue_running: 1, queued: false, running: true, queue_remaining: 1 })
  })

  it('reports a missing history entry as still running', async () => {
    const client = new ComfyUIClient()
    mockComfyHttpFixture(vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('http://127.0.0.1:8188/history/prompt-missing')
      return jsonResponse({})
    }))

    await expect(client.history('prompt-missing')).resolves.toEqual({ status: 'running' })
  })

  it('classifies transport failures with a stable code and retryability', async () => {
    const client = new ComfyUIClient()
    mockComfyHttpFixture(vi.fn(async () => jsonResponse({ error: 'ComfyUI is busy' }, 503)))

    const error = await client.queue().catch(value => value)
    expect(error).toMatchObject({ code: 'COMFY_HTTP_503', retryable: true, status: 503 })
  })

  it('surfaces the ComfyUI HTTP error message for queue and history requests', async () => {
    const client = new ComfyUIClient()
    mockComfyHttpFixture(vi.fn(async () => jsonResponse({ error: 'ComfyUI is busy' }, 503)))

    await expect(client.queue()).rejects.toThrow('ComfyUI is busy')
    await expect(client.history('prompt-1')).rejects.toThrow('ComfyUI is busy')
  })

  it('sends the frozen canonical prompt_id and accepts a caller abort signal', async () => {
    const client = new ComfyUIClient()
    const requestedPromptId = '11111111-1111-4111-8111-111111111111'
    const controller = new AbortController()
    const workflow = { '1': { class_type: 'SaveImage', inputs: { filename_prefix: 'Test' } } } as any
    mockComfyHttpFixture(vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('http://127.0.0.1:8188/prompt')
      expect(init?.signal).toBeDefined()
      expect(JSON.parse(String(init?.body))).toEqual({ prompt: workflow, prompt_id: requestedPromptId })
      return jsonResponse({ prompt_id: '22222222-2222-4222-8222-222222222222' })
    }))
    await expect(client.submit(workflow, { requestedPromptId, signal: controller.signal })).resolves.toEqual({ prompt_id: '22222222-2222-4222-8222-222222222222' })
  })

  it('rejects an acknowledged POST without a prompt id as a non-retryable bad response', async () => {
    const client = new ComfyUIClient()
    mockComfyHttpFixture(vi.fn(async () => jsonResponse({ number: 1 })))
    const error = await client.submit({}, { requestedPromptId: '11111111-1111-4111-8111-111111111111' }).catch(value => value)
    expect(error).toBeInstanceOf(ComfyUIError)
    expect(error).toMatchObject({ code: 'COMFY_BAD_RESPONSE', retryable: false })
  })

  it('locates a requested identity in the queue or history without equating the request with the response', async () => {
    const requested = '11111111-1111-4111-8111-111111111111'
    const client = new ComfyUIClient()
    let queue = { queue_pending: [[1, requested]], queue_running: [] as unknown[][] }
    mockComfyHttpFixture(vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/queue')) return jsonResponse(queue)
      if (url.endsWith('/history/' + requested)) return jsonResponse({ [requested]: { outputs: { '1': { images: [{ filename: 'a.png' }] } } } })
      return jsonResponse({})
    }))
    await expect(client.locate(requested)).resolves.toMatchObject({ known: true, stage: 'pending' })
    queue = { queue_pending: [], queue_running: [] }
    await expect(client.locate(requested)).resolves.toMatchObject({ known: true, stage: 'history', history: { status: 'done' } })
    await expect(client.locate('33333333-3333-4333-8333-333333333333')).resolves.toMatchObject({ known: false, stage: 'none' })
  })

  it('exposes image download failures as retryable typed errors', async () => {
    const client = new ComfyUIClient()
    mockComfyHttpFixture(vi.fn(async () => jsonResponse({ error: 'busy' }, 503)))
    const error = await client.downloadImage({ filename: 'a.png', subfolder: '', type: 'output', url: 'http://127.0.0.1:8188/view?filename=a.png' }).catch(value => value)
    expect(error).toBeInstanceOf(ComfyUIError)
    expect(error).toMatchObject({ code: 'COMFY_HTTP_503', retryable: true, status: 503 })
  })

  it.each([{}, { outputs: {} }, { status: { status_str: 'success' }, outputs: {} }])('keeps a history entry without outputs waiting rather than returning empty success', async entry => {
    mockComfyHttpFixture(vi.fn(async () => jsonResponse({ owned: entry })))
    await expect(new ComfyUIClient().history('owned')).resolves.toEqual({ status: 'running' })
  })

  it.each([null, [], { owned: 'text' }, { owned: [] }, { owned: { outputs: [] } }, { owned: { outputs: { a: { images: [{ subfolder: '' }] } } } }])('rejects malformed history without a retryable transport classification', async payload => {
    mockComfyHttpFixture(vi.fn(async () => jsonResponse(payload)))
    const error = await new ComfyUIClient().history('owned').catch(value => value)
    expect(error).toMatchObject({ code: 'COMFY_BAD_RESPONSE', retryable: false })
  })

  it('reports nonempty outputs without images as a terminal execution failure', async () => {
    mockComfyHttpFixture(vi.fn(async () => jsonResponse({ owned: { outputs: { '1': { text: ['not an image'] } } } })))
    const error = await new ComfyUIClient().history('owned').catch(value => value)
    expect(error).toMatchObject({ code: 'COMFY_EXECUTION_FAILED', retryable: false })
  })

  it('gives an execution error priority over partial image outputs', async () => {
    mockComfyHttpFixture(vi.fn(async () => jsonResponse({ owned: { status: { status_str: 'error', messages: [['execution_error', { prompt_id: 'owned' }]] }, outputs: { '1': { images: [{ filename: 'partial.png' }] } } } })))
    await expect(new ComfyUIClient().history('owned')).resolves.toMatchObject({ status: 'error' })
  })

  it('does not read an inherited property as an owned history record', async () => {
    mockComfyHttpFixture(vi.fn(async () => jsonResponse({})))
    await expect(new ComfyUIClient().history('toString')).resolves.toEqual({ status: 'running' })
  })

  it('locates a valid history identity even when the queue read failed, using the one observed history response', async () => {
    const calls: string[] = []
    mockComfyHttpFixture(vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input); calls.push(url)
      if (url.endsWith('/queue')) return jsonResponse({ error: 'queue unavailable' }, 503)
      return jsonResponse({ owned: { status: { status_str: 'success' }, outputs: { '1': { images: [{ filename: 'a.png' }] } } } })
    }))
    await expect(new ComfyUIClient().locate('owned')).resolves.toMatchObject({ known: true, stage: 'history', history: { status: 'done' } })
    expect(calls.filter(url => url.endsWith('/history/owned'))).toHaveLength(1)
  })

  it('does not prove a requested identity from an empty history object', async () => {
    mockComfyHttpFixture(vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/queue') ? jsonResponse({ queue_running: [], queue_pending: [] }) : jsonResponse({ owned: {} })))
    await expect(new ComfyUIClient().locate('owned')).resolves.toMatchObject({ known: false, stage: 'none' })
  })

  it.each([' ', 'bad' + String.fromCharCode(10) + '-id', 'x'.repeat(201)])('does not accept an invalid real response prompt id', async prompt_id => {
    mockComfyHttpFixture(vi.fn(async () => jsonResponse({ prompt_id })))
    const error = await new ComfyUIClient().submit({}).catch(value => value)
    expect(error).toMatchObject({ code: 'COMFY_BAD_RESPONSE', retryable: false })
  })

  it('downloads only the view route under the exact configured endpoint prefix', async () => {
    const client = new ComfyUIClient('http://127.0.0.1:8188/comfy')
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    mockComfyHttpFixture(vi.fn(async () => new Response(bytes)))
    await expect(client.downloadImage({ filename: 'a.png', subfolder: '', type: 'output', url: client.baseUrl + '/view?filename=a.png' })).resolves.toEqual(bytes)
    await expect(client.downloadImage({ filename: 'a.png', subfolder: '', type: 'output', url: 'http://127.0.0.1:8188/view?filename=a.png' })).rejects.toThrow('服务范围')
  })

  it('creates a fixed-endpoint client instead of reading the mutable global', () => {
    const client = createComfyUIClient('http://localhost:9000')
    expect(client.baseUrl).toBe('http://localhost:9000')
    expect(client).not.toBe(createComfyUIClient('http://localhost:9001'))
  })
})

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}
