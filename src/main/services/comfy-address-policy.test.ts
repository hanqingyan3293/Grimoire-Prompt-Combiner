import { describe, expect, it } from 'vitest'
import { requireComfyAddress } from './input-validation'

describe('C2 Comfy literal address policy', () => {
  it.each([
    'https://public-test-user:public-test-password@comfy.example',
    'http://public-test-user@127.0.0.1:8188',
    'https://public-test-user@[::1]:8188',
  ])('rejects embedded credentials before storage: %s', address => {
    expect(() => requireComfyAddress(address)).toThrow()
  })

  it.each([
    'https://224.0.0.1', 'https://240.1.2.3', 'https://198.18.0.1',
    'https://192.0.2.1', 'https://[2001:db8::1]', 'https://[3fff::1]',
    'https://[2001:2::1]',
    'https://[2002:0808:0808::1]', 'https://[64:ff9b::7f00:1]',
    'https://[::ffff:198.18.0.1]',
  ])('rejects reserved, multicast, translated-private and tunnel literals: %s', address => {
    expect(() => requireComfyAddress(address)).toThrow()
  })

  it.each([
    'http://127.0.0.1:8188', 'http://[::1]:8188', 'http://localhost:8188',
    'https://8.8.8.8', 'https://[2001:4860:4860::8888]',
    'https://[64:ff9b::808:808]', 'https://comfy.example/prefix',
  ])('preserves supported configured services: %s', address => {
    expect(requireComfyAddress(address)).toBe(address)
  })
})
