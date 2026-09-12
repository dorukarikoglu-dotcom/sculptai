# Machinery Deal Engine V4 persistence

The V4 store uses Supabase Postgres as its durable system of record. Browser code never receives the service-role key or ingestion token.

## Required production environment

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `MACHINERY_INGEST_TOKEN`

Apply `supabase/migrations/20260912170000_machinery_v4_persistence.sql` before enabling ingestion. The migration enables RLS, grants table/RPC access only to `service_role`, and creates:

- `historical_machine_observation`
- `machinery_source_lineage`
- `machinery_ask_price_history`
- `machinery_live_event`
- `machinery_learning_snapshot`
- `machinery_milestone`
- `machinery_ingestion_batch`

## Batch ingestion

`POST /api/machinery-batch` accepts up to 200 combined historical observations and live events. Send the secret only in the `Authorization` header.

```bash
curl -X POST https://sculptai-brown.vercel.app/api/machinery-batch \
  -H "Authorization: Bearer $MACHINERY_INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  --data @batch.json
```

```json
{
  "batchKey": "hourly-2026-09-12T18",
  "observations": [
    {
      "type": "historical_machine_observation",
      "make": "Haas",
      "model": "VF-4",
      "modelFamily": "VF-4",
      "manufactureYear": 2013,
      "configuration": "40 taper vertical machining center",
      "location": "United States",
      "askingPrice": 15000,
      "soldPrice": 13100,
      "saleCurrency": "USD",
      "soldDate": "2025-04-20",
      "saleStatus": "sold",
      "evidenceTier": "A",
      "sourceUrl": "https://example.com/completed-lot/123",
      "sourceLineage": {
        "sourceName": "Completed auction archive",
        "sourceType": "auction_archive",
        "sourceRecordId": "lot-123",
        "observedAt": "2026-09-12T18:00:00Z"
      }
    }
  ],
  "events": [
    {
      "idempotencyKey": "gmail-message-id-or-stable-event-id",
      "type": "buyer",
      "eventAt": "2026-09-12T18:00:00Z",
      "source": "gmail",
      "sourceId": "message-id",
      "category": "Mainstream CNC turning",
      "status": "VERIFIED",
      "payload": { "company": "Example GmbH", "usedAccepted": "yes" }
    }
  ],
  "learningSnapshot": {
    "snapshotKey": "learning-2026-09-12T18",
    "generatedAt": "2026-09-12T18:00:00Z",
    "allocation": { "Mainstream CNC turning": 40, "3015 branded fiber laser": 25 },
    "metrics": { "run": "hourly" },
    "notes": "Short evidence-backed summary of what changed in this run."
  }
}
```

Use a stable `batchKey` for retries. Machine identity is deduplicated by `machineFingerprint` when supplied, then by make + serial, then by normalized machine attributes. Each source gets its own lineage row. Re-observing an unchanged asking price updates its `last_seen`/`seen_count`; a changed price creates a new price-history point.

Tier meanings:

- A: explicit sold or hammer transaction price
- B: independently verified sold status without final price
- C: active or archived asking-price evidence
- D: weak, incomplete, or unverified evidence

## Persisted state

`GET /api/machinery-events` returns real persisted counts, the A/B/C/D breakdown, milestone counters, latest server-side learning snapshot, recent observations, and recent live events. It returns `503` instead of a seeded fallback when durable storage is not configured or the migration has not been applied.
