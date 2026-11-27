import { describe, expect, it, vi } from 'vitest'
import { comfyAddressOrDefault, requireComfyAddress, requireHttpUrl, validateProviderRequest, validateProviderSaveInput } from './input-validation'

describe('input validation', () => {
  it('allows HTTPS and loopback HTTP only', () => {
    expect(requireHttpUrl('https://example.com/v1')).toBe('https://example.com/v1')
    expect(requireHttpUrl('http://127.0.0.1:8188/')).toBe('http://127.0.0.1:8188')
    expect(() => requireHttpUrl('http://example.com')).toThrow()
  })

  it('rejects malformed provider requests and oversized values', () => {
    expect(() => validateProviderRequest('https://example.com', '', 'model')).toThrow('API Key')
    expect(() => validateProviderSaveInput({ name: 'x', base_url: 'https://example.com', models: ['x'.repeat(301)] })).toThrow('模型列表')
    expect(() => validateProviderSaveInput({ id: '../bad', name: 'x' })).toThrow('id')
  })

  it('normalizes provider defaults without returning secrets', () => {
    const input = validateProviderSaveInput({ name: 'demo' })
    expect(input).toMatchObject({ name: 'demo', base_url: 'https://api.openai.com/v1', default_model: 'gpt-4o', models: [] })
    expect(input).not.toHaveProperty('decrypted_api_key')
  })
})

describe('ComfyUI address policy', () => {
  it('allows loopback over HTTP or HTTPS', () => {
    expect(requireComfyAddress('http://127.0.0.1:8188/')).toBe('http://127.0.0.1:8188')
    expect(requireComfyAddress('https://127.0.0.1:8188')).toBe('https://127.0.0.1:8188')
    expect(requireComfyAddress('http://localhost:8188')).toBe('http://localhost:8188')
    expect(requireComfyAddress('https://localhost')).toBe('https://localhost')
    expect(requireComfyAddress('http://[::1]:8188')).toBe('http://[::1]:8188')
    expect(requireComfyAddress('https://[::1]')).toBe('https://[::1]')
  })

  it('allows public HTTPS hosts', () => {
    expect(requireComfyAddress('https://comfy.example.com:443/')).toBe('https://comfy.example.com:443')
    expect(requireComfyAddress('https://8.8.8.8')).toBe('https://8.8.8.8')
    expect(requireComfyAddress('https://[2001:4860:4860::8888]')).toBe('https://[2001:4860:4860::8888]')
  })

  it('rejects HTTP for every non-loopback host', () => {
    for (const url of ['http://example.com', 'http://8.8.8.8', 'http://10.0.0.1', 'http://[2001:4860:4860::8888]']) {
      expect(() => requireComfyAddress(url)).toThrow('HTTPS')
    }
  })

  it('rejects private, link-local, metadata and non-loopback 127/8 IPv4 literals over HTTPS', () => {
    for (const url of [
      'https://10.0.0.1',
      'https://172.16.0.1',
      'https://172.31.255.254',
      'https://192.168.0.1',
      'https://169.254.169.254',
      'https://0.0.0.0',
      'https://100.64.0.1',
      'https://100.127.255.254',
      'https://127.0.0.2',
    ]) {
      expect(() => requireComfyAddress(url)).toThrow('私有')
    }
  })

  it('keeps IPv4 boundaries outside the rejected ranges usable over HTTPS', () => {
    for (const url of [
      'https://9.255.255.255',
      'https://11.0.0.1',
      'https://100.63.255.255',
      'https://100.128.0.0',
      'https://126.255.255.255',
      'https://128.0.0.1',
      'https://172.15.255.255',
      'https://172.32.0.1',
      'https://192.167.255.255',
      'https://192.169.0.1',
    ]) {
      expect(requireComfyAddress(url)).toBe(url)
    }
  })

  it('rejects IPv6 unique-local, link-local, site-local and private IPv4-mapped literals', () => {
    for (const url of [
      'https://[fc00::1]',
      'https://[fd12:3456:789a::1]',
      'https://[fe80::1]',
      'https://[febf:ffff::1]',
      'https://[fec0::1]',
      'https://[::ffff:10.0.0.1]',
      'https://[::ffff:169.254.169.254]',
    ]) {
      expect(() => requireComfyAddress(url)).toThrow('私有')
    }
  })

  it('rejects non-HTTP schemes and malformed values', () => {
    for (const url of ['ftp://example.com', 'file:///etc/passwd', 'ws://example.com', 'not a url']) {
      expect(() => requireComfyAddress(url)).toThrow()
    }
  })

  it.each(['https://user:synthetic@example.com', 'http://user@localhost:8188', 'https://%75ser:%70ass@example.com'])('rejects credential-bearing Comfy endpoints before any caller uses them: %s', url => {
    expect(() => requireComfyAddress(url)).toThrow(/凭据|credentials/)
  })

  it.each(['http://127.0.0.1:8188?x=1', 'https://comfy.example/#graph', 'http://localhost:8188/a b'])('keeps configured endpoints aligned with the frozen C1 endpoint grammar: %s', url => {
    expect(() => requireComfyAddress(url)).toThrow(/query|hash|空白/)
  })

  it('falls back to the loopback default for an invalid persisted Comfy address and reports it', () => {
    const onInvalid = vi.fn()
    expect(comfyAddressOrDefault('https://10.0.0.1', 'http://127.0.0.1:8188', onInvalid)).toBe('http://127.0.0.1:8188')
    expect(onInvalid).toHaveBeenCalledOnce()
    expect(comfyAddressOrDefault('https://comfy.example.com', 'http://127.0.0.1:8188', onInvalid)).toBe('https://comfy.example.com')
    expect(onInvalid).toHaveBeenCalledOnce()
  })

  it('keeps the generic HTTPS validator unchanged for provider addresses', () => {
    expect(requireHttpUrl('https://10.0.0.1')).toBe('https://10.0.0.1')
    expect(requireHttpUrl('https://192.168.1.1')).toBe('https://192.168.1.1')
  })
})
