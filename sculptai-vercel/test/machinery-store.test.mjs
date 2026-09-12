import assert from 'node:assert/strict'
import test from 'node:test'
import {
  machineFingerprint,
  normalizeBatch,
  normalizeHistoricalObservation,
  normalizeLiveEvent,
} from '../api/_machinery-store.js'

const NOW = '2026-09-12T18:00:00.000Z'

test('serial-number identity deduplicates source variations', () => {
  const first = machineFingerprint({ make: 'Haas', model: 'VF-4', serialNumber: ' 123-ABC ' })
  const second = machineFingerprint({ brand: 'HAAS', model: 'VF4', serial: '123 abc', source: 'another marketplace' })
  assert.equal(first, second)
})

test('syndicated listings share a machine fingerprint but keep source lineage', () => {
  const base = {
    make: 'Trumpf', model: 'TruLaser 3030', modelFamily: 'TruLaser 3030', manufactureYear: 2019,
    configuration: '5 kW', location: 'Germany', stockNumber: 'TL-3030-19', seller: 'Dealer GmbH',
    askingPrice: 25000, currency: 'EUR', evidenceTier: 'C', observedAt: NOW,
  }
  const first = normalizeHistoricalObservation({ ...base, sourceUrl: 'https://market-a.test/lot-1', sourceId: 'a-1' }, NOW)
  const second = normalizeHistoricalObservation({ ...base, sourceUrl: 'https://market-b.test/item-9', sourceId: 'b-9' }, NOW)
  assert.equal(first.machine_fingerprint, second.machine_fingerprint)
  assert.notEqual(first.source.source_key, second.source.source_key)
})

test('normalization keeps sold and hammer evidence separate from asking price', () => {
  const item = normalizeHistoricalObservation({
    make: 'Haas', model: 'VF-4', year: 2013, serial: 'VF4-2013-1', askingPrice: 15000,
    soldPrice: 13100, hammerPrice: 12500, currency: 'usd', soldDate: '2025-04-20', evidenceTier: 'a',
  }, NOW)
  assert.equal(item.asking_price, 15000)
  assert.equal(item.sold_price, 13100)
  assert.equal(item.hammer_price, 12500)
  assert.equal(item.sale_currency, 'USD')
  assert.equal(item.evidence_tier, 'A')
  assert.equal(item.sale_status, 'sold')
})

test('live event idempotency is stable for the same batch and timestamp', () => {
  const event = { type: 'buyer', source: 'gmail', sourceId: 'message-1', ts: NOW, status: 'VERIFIED' }
  const first = normalizeLiveEvent(event, NOW, 'hourly-18', 0)
  const second = normalizeLiveEvent(event, NOW, 'hourly-18', 0)
  assert.equal(first.idempotency_key, second.idempotency_key)
})

test('batch accepts historical observations, live events, and a snapshot', () => {
  const batch = normalizeBatch({
    batchKey: 'hourly-18',
    observations: [{ make: 'Haas', model: 'ST-20', year: 2025, serial: 'ST20-1', evidenceTier: 'A' }],
    events: [{ type: 'deal', source: 'gmail', sourceId: 'deal-1', ts: NOW, status: 'NEGOTIATION' }],
    learningSnapshot: { allocation: { turning: 60 }, notes: 'test snapshot' },
  }, NOW)
  assert.equal(batch.batchKey, 'hourly-18')
  assert.equal(batch.observations.length, 1)
  assert.equal(batch.events.length, 1)
  assert.equal(batch.learningSnapshot.notes, 'test snapshot')
})
