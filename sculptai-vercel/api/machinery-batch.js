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

  let batch
  try {
    batch = normalizeBatch(req.body)
  } catch (error) {
    const message = String(error?.message || error)
    return res.status(message === 'batch_too_large' ? 413 : 400).json({ ok: false, persisted: false, error: message })
  }

  try {
    const state = await ingestMachineryBatch(batch)
    return res.status(200).json({
      ok: true,
      persisted: true,
      batchKey: batch.batchKey,
      accepted: {
        observations: batch.observations.length,
        events: batch.events.length,
        learningSnapshot: true,
      },
      ...state,
    })
  } catch (error) {
    console.error('MACHINERY_BATCH_FAILED', error?.message || error)
    const failure = storageError(error)
    return res.status(failure.status).json({ ok: false, persisted: false, error: failure.error })
  }
}
