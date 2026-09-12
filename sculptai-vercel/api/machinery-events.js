import { readMachineryState, storageError } from './_machinery-store.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0')
  res.setHeader('Allow', 'GET')
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' })

  try {
    const state = await readMachineryState()
    return res.status(200).json({ ok: true, persisted: true, storage: 'supabase', ...state })
  } catch (error) {
    console.error('MACHINERY_STATE_FAILED', error?.message || error)
    const failure = storageError(error)
    return res.status(failure.status).json({
      ok: false,
      persisted: false,
      storage: 'unavailable',
      error: failure.error,
      counts: {
        uniqueObservations: 0,
        sourceLineage: 0,
        askPricePoints: 0,
        liveEvents: 0,
        modelFamilies: 0,
      },
      tierBreakdown: { A: 0, B: 0, C: 0, D: 0 },
      milestones: [],
      learningSnapshot: null,
      observations: [],
      events: [],
    })
  }
}
