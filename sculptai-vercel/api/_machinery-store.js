import { createHash, timingSafeEqual } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const EVENT_TYPES = new Set(['buyer', 'inventory', 'observation', 'deal', 'email_event', 'live_listing'])
const EVIDENCE_TIERS = new Set(['A', 'B', 'C', 'D'])
const SALE_STATUSES = new Set(['active', 'sold', 'auction_closed', 'withdrawn', 'unknown'])
const PRICE_KINDS = new Set(['ask', 'sold', 'hammer'])

function text(value, max = 500) {
  if (value === undefined || value === null) return null
  const result = String(value).trim()
  return result ? result.slice(0, max) : null
}

function number(value) {
  if (value === undefined || value === null || value === '') return null
  const result = Number(value)
  return Number.isFinite(result) ? result : null
}

function integer(value, min, max) {
  const result = number(value)
  if (result === null || !Number.isInteger(result) || result < min || result > max) return null
  return result
}

function isoDate(value, fallback = null) {
  if (!value) return fallback
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString()
}

function dateOnly(value) {
  const result = isoDate(value)
  return result ? result.slice(0, 10) : null
}

function currency(value) {
  const result = text(value, 3)?.toUpperCase()
  return result && /^[A-Z]{3}$/.test(result) ? result : null
}

function tier(value, fallback = 'D') {
  const result = text(value, 1)?.toUpperCase()
  return EVIDENCE_TIERS.has(result) ? result : fallback
}

function normalizeToken(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function hash(parts) {
  return createHash('sha256').update(parts.map(normalizeToken).filter(Boolean).join('|')).digest('hex')
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function sourceKey(source, machineFingerprint) {
  const explicit = text(source.sourceKey ?? source.source_key, 160)
  if (explicit) return explicit
  return `src_${hash([
    source.sourceUrl ?? source.source_url,
    source.sourceRecordId ?? source.source_record_id ?? source.sourceId,
    source.sourceName ?? source.source_name ?? source.source,
    machineFingerprint,
  ])}`
}

export function machineFingerprint(input = {}) {
  const explicit = text(input.machineFingerprint ?? input.machine_fingerprint ?? input.fingerprint, 180)
  if (explicit && /^[a-zA-Z0-9:_-]{16,180}$/.test(explicit)) return explicit

  const make = input.make ?? input.brand
  const serial = input.serialNumber ?? input.serial_number ?? input.serial
  if (make && serial) return `serial_${hash([make, serial])}`

  const stock = input.stockNumber ?? input.stock_number ?? input.stockRef ?? input.stock_ref
  const seller = input.seller ?? input.company
  const identity = [
    make,
    input.model,
    input.modelFamily ?? input.model_family,
    input.manufactureYear ?? input.manufacture_year ?? input.year,
    input.configuration ?? input.specs,
    input.spindleConfiguration ?? input.spindle_configuration,
    input.axes,
    input.location,
    input.countryCode ?? input.country_code,
    stock,
    seller,
  ]
  const identityStrength = identity.filter(value => text(value)).length
  if (identityStrength < 3) {
    identity.push(input.sourceUrl ?? input.source_url, input.sourceId ?? input.source_id, input.sourceRecordId)
  }
  return `machine_${hash(identity)}`
}

export function normalizeHistoricalObservation(input = {}, now = new Date().toISOString()) {
  const fingerprint = machineFingerprint(input)
  const firstSeen = isoDate(input.firstSeen ?? input.first_seen ?? input.observedAt ?? input.observed_at, now)
  const lastSeen = isoDate(input.lastSeen ?? input.last_seen ?? input.observedAt ?? input.observed_at, firstSeen)
  const askingPrice = number(input.askingPrice ?? input.asking_price ?? input.askPrice ?? input.price)
  const soldPrice = number(input.soldPrice ?? input.sold_price)
  const hammerPrice = number(input.hammerPrice ?? input.hammer_price)
  const askingCurrency = currency(input.askingCurrency ?? input.asking_currency ?? input.currency)
  const saleCurrency = currency(input.saleCurrency ?? input.sale_currency ?? input.currency)
  const statusRaw = text(input.saleStatus ?? input.sale_status ?? input.status, 30)?.toLowerCase()
  const source = object(input.sourceLineage ?? input.source_lineage ?? input.source)
  const normalizedSource = typeof input.source === 'string' ? { sourceName: input.source } : source
  const sourceObservedAt = isoDate(
    normalizedSource.observedAt ?? normalizedSource.observed_at ?? input.observedAt ?? input.observed_at,
    lastSeen,
  )
  const normalizedTier = tier(input.evidenceTier ?? input.evidence_tier)
  const normalizedSourceKey = sourceKey(
    {
      ...normalizedSource,
      sourceUrl: normalizedSource.sourceUrl ?? normalizedSource.source_url ?? input.sourceUrl ?? input.source_url,
      sourceRecordId:
        normalizedSource.sourceRecordId ??
        normalizedSource.source_record_id ??
        input.sourceRecordId ??
        input.source_id ??
        input.sourceId,
    },
    fingerprint,
  )

  return {
    machine_fingerprint: fingerprint,
    make: text(input.make ?? input.brand, 120),
    model: text(input.model, 160),
    model_family: text(input.modelFamily ?? input.model_family ?? input.model, 160),
    manufacture_year: integer(input.manufactureYear ?? input.manufacture_year ?? input.year, 1900, 2100),
    serial_number: text(input.serialNumber ?? input.serial_number ?? input.serial, 160),
    stock_number: text(input.stockNumber ?? input.stock_number ?? input.stockRef ?? input.stock_ref, 160),
    category: text(input.category ?? input.segment, 160),
    configuration: text(input.configuration ?? input.specs, 3000),
    spindle_configuration: text(input.spindleConfiguration ?? input.spindle_configuration, 500),
    axes: integer(input.axes, 1, 20),
    location: text(input.location, 240),
    country_code: text(input.countryCode ?? input.country_code, 2)?.toUpperCase() ?? null,
    first_seen: firstSeen <= lastSeen ? firstSeen : lastSeen,
    last_seen: lastSeen >= firstSeen ? lastSeen : firstSeen,
    asking_price: askingPrice !== null && askingPrice >= 0 ? askingPrice : null,
    asking_currency: askingCurrency,
    sold_price: soldPrice !== null && soldPrice >= 0 ? soldPrice : null,
    hammer_price: hammerPrice !== null && hammerPrice >= 0 ? hammerPrice : null,
    sale_currency: saleCurrency,
    sold_at: dateOnly(input.soldAt ?? input.sold_at ?? input.soldDate ?? input.sold_date),
    sale_status: SALE_STATUSES.has(statusRaw) ? statusRaw : soldPrice !== null || hammerPrice !== null ? 'sold' : 'unknown',
    evidence_tier: normalizedTier,
    best_source_url: text(input.sourceUrl ?? input.source_url ?? normalizedSource.sourceUrl ?? normalizedSource.source_url, 2000),
    raw_summary: object(input.rawSummary ?? input.raw_summary ?? input.payload),
    source: {
      source_key: normalizedSourceKey,
      source_name: text(normalizedSource.sourceName ?? normalizedSource.source_name ?? normalizedSource.name ?? input.source, 160),
      source_type: text(normalizedSource.sourceType ?? normalizedSource.source_type ?? input.sourceType, 80),
      source_url: text(normalizedSource.sourceUrl ?? normalizedSource.source_url ?? input.sourceUrl ?? input.source_url, 2000),
      source_record_id: text(
        normalizedSource.sourceRecordId ??
          normalizedSource.source_record_id ??
          input.sourceRecordId ??
          input.source_id ??
          input.sourceId,
        240,
      ),
      archived_url: text(normalizedSource.archivedUrl ?? normalizedSource.archived_url ?? input.archivedUrl, 2000),
      extraction_method: text(normalizedSource.extractionMethod ?? normalizedSource.extraction_method ?? input.extractionMethod, 80),
      observed_at: sourceObservedAt,
      evidence_tier: tier(normalizedSource.evidenceTier ?? normalizedSource.evidence_tier, normalizedTier),
      raw_payload: object(normalizedSource.rawPayload ?? normalizedSource.raw_payload ?? input.payload),
    },
  }
}

export function normalizeLiveEvent(input = {}, now = new Date().toISOString(), batchKey = null, index = 0) {
  const eventType = text(input.eventType ?? input.event_type ?? input.type, 40)?.toLowerCase()
  if (!EVENT_TYPES.has(eventType)) return null
  const eventAt = isoDate(input.eventAt ?? input.event_at ?? input.ts, now)
  const fingerprintInput = input.machine ?? input
  const hasMachineIdentity = [
    fingerprintInput.machineFingerprint,
    fingerprintInput.machine_fingerprint,
    fingerprintInput.fingerprint,
    fingerprintInput.make,
    fingerprintInput.brand,
    fingerprintInput.model,
    fingerprintInput.serialNumber,
    fingerprintInput.serial,
    fingerprintInput.stockNumber,
    fingerprintInput.stockRef,
  ].some(Boolean)
  const fingerprint = hasMachineIdentity ? machineFingerprint(fingerprintInput) : null
  const explicitKey = text(input.idempotencyKey ?? input.idempotency_key, 180)
  const idempotencyKey = explicitKey || `evt_${hash([
    batchKey,
    index,
    eventType,
    input.source,
    input.sourceId ?? input.source_id,
    eventAt,
    input.status ?? input.stage ?? input.outcome,
    fingerprint,
    input.company ?? input.buyer ?? input.seller,
    input.notes,
  ])}`
  return {
    idempotency_key: idempotencyKey,
    event_type: eventType,
    event_at: eventAt,
    source: text(input.source, 160) ?? 'collector',
    source_id: text(input.sourceId ?? input.source_id, 240),
    machine_fingerprint: fingerprint,
    category: text(input.category ?? input.segment ?? input.machineSegment, 160),
    status: text(input.status ?? input.stage ?? input.outcome ?? input.emailIntent, 100),
    evidence_tier: input.evidenceTier || input.evidence_tier ? tier(input.evidenceTier ?? input.evidence_tier) : null,
    payload: object(input.payload && Object.keys(object(input.payload)).length ? input.payload : input),
  }
}

function normalizeSnapshot(input = {}, now = new Date().toISOString(), batchKey = null) {
  const value = object(input)
  return {
    snapshot_key: text(value.snapshotKey ?? value.snapshot_key, 180) || batchKey || `snapshot_${now.slice(0, 13)}`,
    generated_at: isoDate(value.generatedAt ?? value.generated_at, now),
    allocation: object(value.allocation),
    metrics: object(value.metrics),
    notes: text(value.notes, 5000),
  }
}

export function normalizeBatch(body = {}, now = new Date().toISOString()) {
  const raw = Array.isArray(body) ? { events: body } : object(body)
  const batchKey = text(raw.batchKey ?? raw.batch_key ?? raw.idempotencyKey ?? raw.idempotency_key, 180)
  const mixed = Array.isArray(raw.items) ? raw.items : []
  const observationInputs = [
    ...(Array.isArray(raw.observations) ? raw.observations : []),
    ...mixed.filter(item => ['historical_machine_observation', 'historical_observation'].includes(item?.type)),
  ]
  const eventInputs = [
    ...(Array.isArray(raw.events) ? raw.events : []),
    ...mixed.filter(item => !['historical_machine_observation', 'historical_observation'].includes(item?.type)),
  ]
  const observations = observationInputs.map(item => normalizeHistoricalObservation(item, now))
  const events = eventInputs.map((item, index) => normalizeLiveEvent(item, now, batchKey, index)).filter(Boolean)
  const total = observations.length + events.length
  if (!total && !raw.learningSnapshot && !raw.learning_snapshot) {
    throw new Error('observations_events_or_snapshot_required')
  }
  if (total > 200) throw new Error('batch_too_large')
  return {
    batchKey: batchKey || `batch_${hash([now, JSON.stringify({ observations, events })])}`,
    observations,
    events,
    learningSnapshot: normalizeSnapshot(raw.learningSnapshot ?? raw.learning_snapshot, now, batchKey),
  }
}

export function machineryClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('durable_storage_not_configured')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export function authorizeIngest(req) {
  const expected = process.env.MACHINERY_INGEST_TOKEN
  if (!expected) return { ok: false, status: 503, error: 'ingestion_auth_not_configured' }
  const authorization = String(req.headers.authorization || '')
  const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  const supplied = bearer || String(req.headers['x-machinery-ingest-token'] || '')
  const left = Buffer.from(supplied)
  const right = Buffer.from(expected)
  const ok = left.length === right.length && left.length > 0 && timingSafeEqual(left, right)
  return ok ? { ok: true } : { ok: false, status: 401, error: 'unauthorized' }
}

export async function ingestMachineryBatch(batch) {
  const client = machineryClient()
  const { data, error } = await client.rpc('machinery_ingest_batch', {
    p_batch_key: batch.batchKey,
    p_observations: batch.observations,
    p_events: batch.events,
    p_learning_snapshot: batch.learningSnapshot,
  })
  if (error) throw new Error(`machinery_ingest_failed:${error.message}`)
  return data
}

export async function readMachineryState() {
  const client = machineryClient()
  const { data, error } = await client.rpc('machinery_persisted_state', {
    p_event_limit: 100,
    p_observation_limit: 100,
  })
  if (error) throw new Error(`machinery_state_failed:${error.message}`)
  return data
}

export function storageError(error) {
  const message = String(error?.message || error || 'unknown_error')
  if (message.includes('durable_storage_not_configured')) {
    return { status: 503, error: 'durable_storage_not_configured' }
  }
  if (message.includes('Could not find the function') || message.includes('schema cache')) {
    return { status: 503, error: 'machinery_schema_not_applied' }
  }
  return { status: 500, error: 'durable_storage_unavailable' }
}

export const machineryConstants = { EVENT_TYPES, EVIDENCE_TIERS, SALE_STATUSES, PRICE_KINDS }
