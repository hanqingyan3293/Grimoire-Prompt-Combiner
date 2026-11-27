import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateLayeredDeliveryAcceptance } from './m5-delivery-acceptance.mjs'
import { evaluateLayeredDeliveryAcceptance as canonical } from './m5-layered-acceptance.mjs'

test('legacy delivery-acceptance entry re-exports the canonical layered model', () => {
  assert.equal(evaluateLayeredDeliveryAcceptance, canonical)
})
