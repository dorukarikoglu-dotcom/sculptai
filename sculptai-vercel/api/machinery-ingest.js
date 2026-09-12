import {
  authorizeIngest,
  ingestMachineryBatch,
  normalizeBatch,
  storageError,
} from './_machinery-store.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Allow', 'POST')
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' })

  const authorization = authorizeIngest(req)
  if (!authorization.ok) return res.status(authorization.status).json({ ok: false, persisted: false, error: authorization.error })

  const input = req.body || {}
  const isHistorical = ['historical_machine_observation', 'historical_observation'].includes(input.type)
  let batch
  try {
    batch = normalizeBatch({
      batchKey: input.batchKey || input.idempotencyKey,
      observations: isHistorical ? [input] : [],
      events: isHistorical ? [] : [input],
      learningSnapshot: input.learningSnapshot,
    })
  } catch (error) {
    return res.status(400).json({ ok: false, persisted: false, error: String(error?.message || error) })
  }

  try {
    const state = await ingestMachineryBatch(batch)
    return res.status(200).json({ ok: true, persisted: true, batchKey: batch.batchKey, ...state })
  } catch (error) {
    console.error('MACHINERY_INGEST_FAILED', error?.message || error)
    const failure = storageError(error)
    return res.status(failure.status).json({ ok: false, persisted: false, error: failure.error })
  }
}
