import React, { useEffect, useMemo, useState } from 'react'
import MachineryDealEngineV3 from './MachineryDealEngineV3.jsx'

const BASE = {
  'Mainstream CNC turning': 35,
  '3m / 100–150t CNC press brake': 25,
  '3015 branded fiber laser': 20,
  'Stone CNC / bridge saw': 10,
  'Other high-ticket machinery': 10,
}

const EMPTY_STATE = {
  counts: { uniqueObservations: 0, sourceLineage: 0, askPricePoints: 0, liveEvents: 0, modelFamilies: 0 },
  tierBreakdown: { A: 0, B: 0, C: 0, D: 0 },
  milestones: [],
  modelFamilies: [],
  observations: [],
  events: [],
  learningSnapshot: null,
  lastPersistedAt: null,
}

function segment(event) {
  return event.segment || event.category || event.machineSegment || 'Other high-ticket machinery'
}

function outcomeReward(event) {
  const status = String(event.outcome || event.stage || event.status || event.emailIntent || '').toLowerCase()
  if (event.type === 'email_event') {
    if (event.emailIntent === 'positive') return 2
    if (['technical_question', 'commercial', 'commission'].includes(event.emailIntent)) return 1.5
    if (event.emailIntent === 'negative') return -1
    return 0.25
  }
  if (event.type === 'deal') {
    if (status.includes('closed')) return 100
    if (status.includes('negoti')) return 30
    if (status.includes('inspect')) return 20
    if (status.includes('intro')) return 10
    if (status.includes('commission')) return 8
    if (status.includes('match')) return 6
    if (status.includes('verified')) return 4
  }
  if (event.type === 'buyer') return event.status === 'VERIFIED' ? 4 : event.status === 'OUTREACH_SENT' ? 0.25 : 0
  if (event.type === 'inventory' && event.commissionWritten && Number(event.commissionPct) > 0) return 8
  return 0
}

function calculateAllocation(events) {
  const stats = Object.fromEntries(Object.keys(BASE).map(key => [key, { segment: key, n: 0, reward: 0 }]))
  for (const event of events) {
    const key = segment(event)
    if (!stats[key]) stats[key] = { segment: key, n: 0, reward: 0 }
    stats[key].n += 1
    stats[key].reward += outcomeReward(event)
  }
  const rows = Object.values(stats).map(row => {
    const prior = BASE[row.segment] ?? 10
    const evidence = Math.min(1, row.n / 20)
    const quality = Math.max(0.25, Math.min(3, 1 + (row.n ? row.reward / row.n : 0) / 12))
    return { ...row, prior, rawWeight: prior * (1 - evidence) + prior * quality * evidence }
  })
  const total = rows.reduce((sum, row) => sum + row.rawWeight, 0) || 1
  return rows.map(row => ({ ...row, weight: (100 * row.rawWeight) / total })).sort((a, b) => b.weight - a.weight)
}

function snapshotAllocation(snapshot, events) {
  const allocation = snapshot?.allocation
  if (!allocation || Array.isArray(allocation) || !Object.keys(allocation).length) return calculateAllocation(events)
  return Object.entries(allocation)
    .map(([name, value]) => ({ segment: name, weight: Number(value) || 0, prior: BASE[name] ?? 0, n: 0, reward: 0 }))
    .sort((a, b) => b.weight - a.weight)
}

function money(value, currency = 'EUR') {
  if (value === null || value === undefined) return '—'
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(value))
  } catch {
    return `${value} ${currency || ''}`.trim()
  }
}

function dateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}

function storageLabel(persisted, lastPersistedAt) {
  if (!persisted) return { label: 'OFFLINE', color: '#fca5a5', background: '#450a0a' }
  if (!lastPersistedAt) return { label: 'CONNECTED · EMPTY', color: '#fde68a', background: '#422006' }
  const age = Date.now() - new Date(lastPersistedAt).getTime()
  if (Number.isFinite(age) && age <= 2 * 60 * 60 * 1000) return { label: 'PERSISTED · FRESH', color: '#86efac', background: '#052e16' }
  return { label: 'PERSISTED · STALE', color: '#fde68a', background: '#422006' }
}

function Card({ children, style }) {
  return <div style={{ background: '#111827', border: '1px solid #263247', borderRadius: 14, padding: 16, ...style }}>{children}</div>
}

function Metric({ value, label, detail }) {
  return <Card><div style={{ fontSize: typeof value === 'string' && value.length > 16 ? 18 : 30, fontWeight: 900 }}>{value}</div><div style={{ color: '#94a3b8', fontSize: 12 }}>{label}</div>{detail ? <div style={{ color: '#64748b', fontSize: 11, marginTop: 4 }}>{detail}</div> : null}</Card>
}

function Milestone({ item }) {
  const progress = Math.min(100, (Number(item.currentValue) / Number(item.threshold)) * 100)
  const name = item.dimension === 'tier_a' ? 'Tier-A sold evidence' : 'Unique machines'
  return <div style={{ padding: '10px 0', borderTop: '1px solid #1f2937' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12 }}><b>{name} · {item.threshold}</b><span style={{ color: item.reached ? '#86efac' : '#94a3b8' }}>{item.reached ? 'REACHED' : `${item.currentValue}/${item.threshold}`}</span></div>
    <div style={{ height: 6, background: '#0b1220', borderRadius: 20, marginTop: 7, overflow: 'hidden' }}><div style={{ width: `${progress}%`, height: '100%', background: item.reached ? '#22c55e' : '#7c3aed' }} /></div>
  </div>
}

export default function MachineryDealEngineV4() {
  const [data, setData] = useState(EMPTY_STATE)
  const [status, setStatus] = useState({ loading: true, persisted: false, error: null })
  const [view, setView] = useState('learning')

  async function sync() {
    setStatus(current => ({ ...current, loading: true }))
    try {
      const response = await fetch('/api/machinery-events', { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok || !payload.persisted) throw new Error(payload.error || 'durable_storage_unavailable')
      setData({ ...EMPTY_STATE, ...payload, counts: { ...EMPTY_STATE.counts, ...payload.counts }, tierBreakdown: { ...EMPTY_STATE.tierBreakdown, ...payload.tierBreakdown } })
      setStatus({ loading: false, persisted: true, error: null })
    } catch (error) {
      setData(EMPTY_STATE)
      setStatus({ loading: false, persisted: false, error: String(error?.message || error) })
    }
  }

  useEffect(() => {
    sync()
    const id = setInterval(sync, 60_000)
    return () => clearInterval(id)
  }, [])

  const allocation = useMemo(() => snapshotAllocation(data.learningSnapshot, data.events), [data.learningSnapshot, data.events])
  const storage = storageLabel(status.persisted, data.lastPersistedAt)
  const confidence = !status.persisted ? 'unverified' : data.counts.uniqueObservations >= 1000 && data.tierBreakdown.A >= 100 ? 'high' : data.counts.uniqueObservations >= 500 && data.tierBreakdown.A >= 50 ? 'medium' : data.counts.uniqueObservations >= 100 && data.tierBreakdown.A >= 25 ? 'low-medium' : 'low'
  const verifiedValue = value => status.persisted ? value : '—'
  const button = active => ({ border: '1px solid #334155', background: active ? '#7c3aed' : 'transparent', color: '#fff', padding: '9px 12px', borderRadius: 10, fontWeight: 800, cursor: 'pointer' })

  return <div style={{ minHeight: '100vh', background: '#050811', color: '#e5e7eb', fontFamily: 'Inter,system-ui' }}><div style={{ maxWidth: 1360, margin: '0 auto', padding: 26 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
      <div><div style={{ fontSize: 12, fontWeight: 900, color: '#a78bfa', letterSpacing: 1.4 }}>MACHINERY DEAL ENGINE · V4</div><h1 style={{ margin: '6px 0' }}>Durable Market Learning</h1><div style={{ color: '#94a3b8' }}>Historical evidence + live outcomes → persisted snapshot → allocation.</div></div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}><span style={{ padding: '9px 12px', borderRadius: 10, fontSize: 12, fontWeight: 900, color: storage.color, background: storage.background }}>{storage.label}</span><button style={button(view === 'learning')} onClick={() => setView('learning')}>LEARNING</button><button style={button(view === 'execution')} onClick={() => setView('execution')}>EXECUTION</button><button style={button(false)} onClick={sync}>{status.loading ? 'SYNCING…' : 'SYNC'}</button></div>
    </div>

    {view === 'learning' ? <>
      {!status.persisted ? <div style={{ marginTop: 18, border: '1px solid #7f1d1d', background: '#250b0b', color: '#fecaca', borderRadius: 12, padding: 14 }}><b>Durable storage is not verified.</b> Counts are intentionally hidden instead of showing seeded or local fallback data. {status.error ? <span style={{ color: '#fca5a5' }}>({status.error})</span> : null}</div> : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(175px,1fr))', gap: 10, marginTop: 18 }}>
        <Metric value={verifiedValue(data.counts.uniqueObservations)} label="Unique machines" detail="fingerprint-deduplicated" />
        <Metric value={verifiedValue(data.tierBreakdown.A)} label="Tier-A evidence" detail="verified sold / hammer" />
        <Metric value={verifiedValue(data.counts.sourceLineage)} label="Source lineage" detail="distinct source records" />
        <Metric value={verifiedValue(data.counts.askPricePoints)} label="Ask-price points" detail="distinct source + price" />
        <Metric value={verifiedValue(data.counts.liveEvents)} label="Live events" detail="buyer, inventory, deal, email" />
        <Metric value={confidence} label="Learning confidence" detail="milestone-gated" />
      </div>

      <div style={{ marginTop: 10, color: '#94a3b8', fontSize: 12 }}>Last persisted: {dateTime(data.lastPersistedAt)} · latest server snapshot: {dateTime(data.learningSnapshot?.generatedAt)} · model families: {verifiedValue(data.counts.modelFamilies)}</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.3fr) minmax(300px,.7fr)', gap: 14, marginTop: 16 }}>
        <Card><h3 style={{ marginTop: 0 }}>Evidence quality</h3><div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>{Object.entries(data.tierBreakdown).map(([name, count]) => <div key={name} style={{ background: '#0b1220', borderRadius: 10, padding: 12 }}><div style={{ color: name === 'A' ? '#86efac' : name === 'B' ? '#93c5fd' : name === 'C' ? '#fde68a' : '#94a3b8', fontWeight: 900 }}>TIER {name}</div><div style={{ fontSize: 26, fontWeight: 900 }}>{verifiedValue(count)}</div></div>)}</div><p style={{ color: '#94a3b8', fontSize: 12, marginBottom: 0 }}>A = explicit transaction price; B = verified sold without final price; C = active/archived ask evidence; D = weak or incomplete evidence.</p></Card>
        <Card><h3 style={{ marginTop: 0 }}>Persisted milestones</h3>{data.milestones.length ? data.milestones.map(item => <Milestone key={`${item.dimension}-${item.threshold}`} item={item} />) : <div style={{ color: '#64748b', fontSize: 12 }}>No persisted milestone rows.</div>}</Card>
      </div>

      <Card style={{ marginTop: 16 }}><h3 style={{ marginTop: 0 }}>Server-side learning allocation</h3>{status.persisted ? allocation.map(row => <div key={row.segment} style={{ display: 'grid', gridTemplateColumns: 'minmax(220px,1.5fr) .5fr .5fr .5fr minmax(120px,1fr)', gap: 10, padding: '12px 0', borderTop: '1px solid #1f2937', alignItems: 'center' }}><b>{row.segment}</b><div>{row.prior}% prior</div><div>{row.weight.toFixed(1)}%</div><div>n={row.n}</div><div style={{ color: row.weight > row.prior ? '#86efac' : row.weight < row.prior ? '#fca5a5' : '#cbd5e1', fontWeight: 800 }}>{row.weight > row.prior ? '↑ allocate more' : row.weight < row.prior ? '↓ allocate less' : '→ hold'}</div></div>) : <div style={{ color: '#64748b', fontSize: 12 }}>No verified persisted snapshot or event history.</div>}</Card>

      <Card style={{ marginTop: 16, overflowX: 'auto' }}><h3 style={{ marginTop: 0 }}>Recent persisted machine observations</h3>{data.observations.length ? <div style={{ minWidth: 900 }}>{data.observations.slice(0, 30).map(item => <div key={item.machineFingerprint} style={{ display: 'grid', gridTemplateColumns: '1.4fr .45fr .35fr .8fr .8fr .45fr .6fr', gap: 10, padding: '11px 0', borderTop: '1px solid #1f2937', alignItems: 'center', fontSize: 12 }}><div><b>{item.make || '—'} {item.model || item.modelFamily || ''}</b><div style={{ color: '#64748b' }}>{item.location || item.category || '—'}</div></div><div>{item.manufactureYear || '—'}</div><div style={{ color: item.evidenceTier === 'A' ? '#86efac' : '#cbd5e1', fontWeight: 900 }}>{item.evidenceTier}</div><div>{money(item.askingPrice, item.askingCurrency)}</div><div>{money(item.soldPrice ?? item.hammerPrice, item.saleCurrency)}</div><div>{item.sourceCount} src</div><div>{dateTime(item.lastSeen)}</div></div>)}</div> : <div style={{ color: '#64748b', fontSize: 12 }}>No persisted observations yet.</div>}</Card>

      {data.learningSnapshot?.notes ? <Card style={{ marginTop: 16 }}><h3 style={{ marginTop: 0 }}>Latest learning snapshot</h3><div style={{ color: '#cbd5e1', whiteSpace: 'pre-wrap' }}>{data.learningSnapshot.notes}</div></Card> : null}
    </> : <MachineryDealEngineV3 />}
  </div></div>
}
