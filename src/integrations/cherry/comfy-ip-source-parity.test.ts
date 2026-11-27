import { describe, expect, it } from 'vitest'
import { classifyComfyIpAddress } from './comfy-source-loader'

// Address corpus from the unchanged Cherry remoteUrlSafety tests; the Comfy
// adapter additionally rejects proxy fake-IP addresses and restores the
// benchmarking label absent from the already-installed 1.9.1 parser.
describe('selected Cherry IP policy source parity', () => {
  it.each([
    '127.0.0.1', '10.0.0.1', '100.64.0.1', '169.254.1.10', '172.16.0.1',
    '192.0.0.8', '192.168.1.10', '224.0.0.1', '240.0.0.1', '0.0.0.0',
    '255.255.255.255', '::', '::1', 'ff02::1', 'fc00::1', 'fd00::1',
    'fe80::1', '100::1', '64:ff9b::7f00:1', '64:ff9b::c0a8:10a',
    '64:ff9b::6440:105', '64:ff9b:1::1', '2001::1', '2001:2::1',
    '2001:db8::1', '2002:7f00:1::', '3fff::1', '5f00::1', '400::1',
    'fec0::1', '::ffff:127.0.0.1', '::ffff:192.168.1.10',
    '198.18.0.1', '198.19.255.255', '::ffff:198.18.0.1', '64:ff9b::c612:1',
  ])('rejects non-public source-corpus address %s', address => {
    expect(classifyComfyIpAddress(address).public).toBe(false)
  })
  it.each(['8.8.8.8', '93.184.216.34', '2001:4860:4860::8888', '64:ff9b::808:808', '::ffff:8.8.8.8'])('retains public source-corpus address %s', address => {
    expect(classifyComfyIpAddress(address)).toEqual({ loopback: false, public: true })
  })
  it.each(['127.0.0.1', '127.0.0.2', '::1', '::ffff:127.0.0.1'])('recognizes actual loopback address %s', address => {
    expect(classifyComfyIpAddress(address).loopback).toBe(true)
  })
  it('never grants loopback trust to a translated NAT64 private target', () => {
    expect(classifyComfyIpAddress('64:ff9b::7f00:1')).toEqual({ loopback: false, public: false })
  })
})
