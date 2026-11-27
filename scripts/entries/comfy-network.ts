// Bundle-only source adapter; original Cherry URL policy is reused read-only.
// ipaddr.js is the existing locked MIT dependency; the builder records its
// original bytes, installed version and license alongside the source closure.
import * as ipaddr from 'ipaddr.js'
import { sanitizeRemoteUrl } from '../../src/vendor/cherry/source/src/main/utils/remoteUrlSafety'

const nat64 = ipaddr.IPv6.parse('64:ff9b::')
const benchmarking = ipaddr.IPv4.parse('198.18.0.0')
const benchmarkingV6 = ipaddr.IPv6.parse('2001:2::')

export function classifyComfyIpAddress(raw: string): { loopback: boolean; public: boolean } {
  const original = ipaddr.process(raw)
  const address = original.kind() === 'ipv6' && (original as ipaddr.IPv6).match(nat64, 96)
    ? new ipaddr.IPv4(original.toByteArray().slice(12)) : original
  const loopback = original.range() === 'loopback'
  // The installed 1.9.1 parser predates the IPv6 benchmarking range label.
  // Restore the source policy's explicit benchmarking rejection in this
  // adapter, without modifying or globally patching the library or source.
  if (original.kind() === 'ipv6' && (original as ipaddr.IPv6).match(benchmarkingV6, 48)) return { loopback, public: false }
  // Cherry permits proxy fake-IP handles in 198.18/15. Comfy deliberately
  // requires global unicast IPv4, including mapped and NAT64 IPv4 payloads.
  if (address.kind() === 'ipv4' && ((address as ipaddr.IPv4).match(benchmarking, 15) || address.range() !== 'unicast')) return { loopback, public: false }
  try {
    sanitizeRemoteUrl('https://' + (raw.includes(':') ? '[' + raw + ']' : raw))
    return { loopback, public: true }
  } catch {
    return { loopback, public: false }
  }
}
