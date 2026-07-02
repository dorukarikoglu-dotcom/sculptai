/**
 * SculptAI API v1 — Production Netlify Function
 * Single function with internal routing for all /api/v1/* endpoints
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function json(statusCode, body, extra = {}) {
  return {
    statusCode,
    headers: { ...CORS, "Content-Type": "application/json", ...extra },
    body: JSON.stringify(body),
  };
}

function err(statusCode, code, message, details) {
  return json(statusCode, { error: { code, message, ...(details ? { details } : {}) } });
}

async function sha256(text) {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSign(secret, payload) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function supaRest(path, opts = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
    method: opts.method || "GET",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: opts.prefer || "return=representation",
      ...(opts.headers || {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
}

// ─── Auth Middleware ────────────────────────────────────────────────────────

async function authenticate(event) {
  const auth = event.headers["authorization"] || event.headers["Authorization"] || "";
  if (!auth.startsWith("Bearer sk_")) {
    return { error: err(401, "unauthorized", "Missing or invalid Authorization header. Use: Bearer sk_live_xxx or sk_test_xxx") };
  }
  const token = auth.replace("Bearer ", "");
  const hash = await sha256(token);

  const { data } = await supaRest(`api_keys?key_hash=eq.${hash}&is_active=eq.true&select=*`);
  if (!Array.isArray(data) || data.length === 0) {
    return { error: err(401, "unauthorized", "Invalid API key") };
  }
  const key = data[0];

  if (key.expires_at && new Date(key.expires_at) < new Date()) {
    return { error: err(401, "key_expired", "API key has expired") };
  }

  // Update last_used_at (fire-and-forget)
  supaRest(`api_keys?id=eq.${key.id}`, { method: "PATCH", body: { last_used_at: new Date().toISOString() } });

  return { key };
}

// ─── Rate Limiter ───────────────────────────────────────────────────────────

async function checkRateLimit(keyId) {
  const now = new Date();
  const windowMinute = new Date(now - 60_000).toISOString();
  const windowHour = new Date(now - 3_600_000).toISOString();
  const windowDay = new Date(now - 86_400_000).toISOString();

  // Count requests per window
  const { data } = await supaRest(
    `api_rate_limits?api_key_id=eq.${keyId}&select=requested_at&requested_at=gte.${windowDay}&order=requested_at.desc&limit=10001`
  );

  if (!Array.isArray(data)) return null;

  const perMinute = data.filter(r => r.requested_at >= windowMinute).length;
  const perHour = data.filter(r => r.requested_at >= windowHour).length;
  const perDay = data.length;

  if (perMinute >= 100) return err(429, "rate_limit_exceeded", "100 requests/minute limit exceeded", { retry_after_seconds: 60, window: "minute", limit: 100, current: perMinute });
  if (perHour >= 1000) return err(429, "rate_limit_exceeded", "1000 requests/hour limit exceeded", { retry_after_seconds: 3600, window: "hour", limit: 1000, current: perHour });
  if (perDay >= 10000) return err(429, "rate_limit_exceeded", "10000 requests/day limit exceeded", { retry_after_seconds: 86400, window: "day", limit: 10000, current: perDay });

  // Log this request (fire-and-forget)
  supaRest("api_rate_limits", { method: "POST", body: { api_key_id: keyId, requested_at: now.toISOString() }, prefer: "return=minimal" });

  return null;
}

// ─── Webhook Dispatcher ────────────────────────────────────────────────────

async function dispatchWebhooks(clinicId, eventType, payload) {
  try {
    const { data: hooks } = await supaRest(
      `webhooks?clinic_id=eq.${clinicId}&is_active=eq.true&select=*`
    );
    if (!Array.isArray(hooks) || hooks.length === 0) return;

    for (const hook of hooks) {
      if (!hook.events || !hook.events.includes(eventType)) continue;

      const timestamp = Math.floor(Date.now() / 1000).toString();
      const body = JSON.stringify({ event: eventType, data: payload, timestamp });
      const signature = hook.secret ? await hmacSign(hook.secret, `${timestamp}.${body}`) : "";

      const deliveryId = crypto.randomUUID();
      let status = "failed";
      let responseCode = null;
      let responseBody = null;

      try {
        const res = await fetch(hook.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-SculptAI-Signature": signature,
            "X-SculptAI-Timestamp": timestamp,
            "X-SculptAI-Event": eventType,
            "X-SculptAI-Delivery": deliveryId,
          },
          body,
          signal: AbortSignal.timeout(10000),
        });
        responseCode = res.status;
        responseBody = (await res.text()).slice(0, 1000);
        status = res.ok ? "success" : "failed";
      } catch (e) {
        responseBody = e.message;
      }

      // Log delivery
      supaRest("webhook_deliveries", {
        method: "POST",
        body: {
          id: deliveryId,
          webhook_id: hook.id,
          event_type: eventType,
          payload,
          response_code: responseCode,
          response_body: responseBody,
          status,
          attempt: 1,
        },
        prefer: "return=minimal",
      });
    }
  } catch (_) { /* webhook dispatch should never break main flow */ }
}

// ─── Route Handlers ─────────────────────────────────────────────────────────

// POST /patients
async function createPatient(body, clinicId) {
  if (!body.name || !body.age || !body.procedure) {
    return err(400, "validation_failed", "name, age, and procedure are required", {
      missing: [!body.name && "name", !body.age && "age", !body.procedure && "procedure"].filter(Boolean),
    });
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const answers = {
    name: body.name,
    age: String(body.age),
    gender: body.gender || "",
    procedure: body.procedure,
    phone: body.phone || "",
    ...(body.form_data || {}),
  };

  const rec = {
    id,
    doctor_id: clinicId,
    date: now,
    created_at: now,
    risk_score: 0,
    segment: "API Import",
    answers,
    outcome_procedures: [],
    no_appointment: false,
    model_source: "api_v1",
    ...(body.utm_source ? { utm_source: body.utm_source } : {}),
    ...(body.language ? { language: body.language } : {}),
  };

  const { status, data } = await supaRest("patients", { method: "POST", body: rec });
  if (status >= 400) return err(status, "insert_failed", "Failed to create patient", data);

  const patient = Array.isArray(data) ? data[0] : data;
  dispatchWebhooks(clinicId, "patient.created", patient);

  return json(201, { patient });
}

// GET /patients
async function listPatients(params, clinicId) {
  const page = Math.max(1, parseInt(params.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(params.limit) || 20));
  const offset = (page - 1) * limit;

  let query = `patients?doctor_id=eq.${clinicId}&select=id,created_at,risk_score,segment,no_appointment,had_procedure,answers,outcome_procedures&order=created_at.desc&limit=${limit}&offset=${offset}`;

  if (params.segment) query += `&segment=eq.${encodeURIComponent(params.segment)}`;
  if (params.from_date) query += `&created_at=gte.${params.from_date}`;
  if (params.to_date) query += `&created_at=lte.${params.to_date}`;
  if (params.outcome === "no_appointment") query += "&no_appointment=eq.true";
  if (params.outcome === "had_procedure") query += "&had_procedure=eq.true";

  const { data, headers } = await supaRest(query, { headers: { Prefer: "count=exact" } });
  const total = parseInt(headers.get("content-range")?.split("/")[1] || "0");

  const patients = (Array.isArray(data) ? data : []).map(p => ({
    id: p.id,
    name: p.answers?.name || "",
    age: p.answers?.age || "",
    procedure: p.answers?.procedure || "",
    risk_score: p.risk_score,
    segment: p.segment,
    no_appointment: p.no_appointment,
    had_procedure: p.had_procedure,
    created_at: p.created_at,
  }));

  return json(200, { patients, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
}

// GET /patients/:id
async function getPatient(id, clinicId) {
  const { data } = await supaRest(`patients?id=eq.${id}&doctor_id=eq.${clinicId}&select=*`);
  if (!Array.isArray(data) || data.length === 0) return err(404, "not_found", "Patient not found");
  return json(200, { patient: data[0] });
}

// PATCH /patients/:id
async function updatePatient(id, body, clinicId) {
  const allowed = {};
  if (body.phone !== undefined) allowed["answers"] = { phone: body.phone };
  if (body.notes !== undefined) allowed["notes"] = body.notes;
  if (body.no_appointment !== undefined) allowed["no_appointment"] = body.no_appointment;

  if (Object.keys(allowed).length === 0) {
    return err(400, "validation_failed", "No valid fields to update. Allowed: phone, notes, no_appointment");
  }

  // For phone, need to merge into existing answers
  if (allowed.answers) {
    const { data: existing } = await supaRest(`patients?id=eq.${id}&doctor_id=eq.${clinicId}&select=answers`);
    if (!Array.isArray(existing) || existing.length === 0) return err(404, "not_found", "Patient not found");
    allowed.answers = { ...existing[0].answers, phone: body.phone };
  }

  const { status, data } = await supaRest(`patients?id=eq.${id}&doctor_id=eq.${clinicId}`, { method: "PATCH", body: allowed });
  if (!Array.isArray(data) || data.length === 0) return err(404, "not_found", "Patient not found");

  dispatchWebhooks(clinicId, "patient.updated", data[0]);
  return json(200, { patient: data[0] });
}

// DELETE /patients/:id
async function deletePatient(id, clinicId) {
  const { data } = await supaRest(`patients?id=eq.${id}&doctor_id=eq.${clinicId}`, { method: "DELETE" });
  if (!Array.isArray(data) || data.length === 0) return err(404, "not_found", "Patient not found");
  return json(200, { deleted: true, id });
}

// GET /patients/:id/observation
async function getObservation(id, clinicId) {
  const { data } = await supaRest(`patients?id=eq.${id}&doctor_id=eq.${clinicId}&select=id,risk_score,segment,answers,model_source`);
  if (!Array.isArray(data) || data.length === 0) return err(404, "not_found", "Patient not found");

  const p = data[0];
  return json(200, {
    observation: {
      patient_id: p.id,
      risk_score: p.risk_score,
      segment: p.segment,
      model_source: p.model_source,
      ai_text: p.answers?.ai_text || null,
    },
  });
}

// POST /patients/:id/outcomes
async function createOutcome(id, body, clinicId) {
  const { data: patient } = await supaRest(`patients?id=eq.${id}&doctor_id=eq.${clinicId}&select=id,outcome_procedures`);
  if (!Array.isArray(patient) || patient.length === 0) return err(404, "not_found", "Patient not found");

  if (!body.type) return err(400, "validation_failed", "type is required");

  const outcomes = patient[0].outcome_procedures || [];
  const newOutcome = {
    type: body.type,
    result: body.result || null,
    procedure: body.procedure || null,
    satisfaction_3m: body.satisfaction_3m || null,
    notes: body.notes || null,
    created_at: new Date().toISOString(),
  };
  outcomes.push(newOutcome);

  const update = { outcome_procedures: outcomes };
  if (body.type === "procedure_done") update.had_procedure = true;
  if (body.type === "no_appointment") update.no_appointment = true;

  const { status } = await supaRest(`patients?id=eq.${id}&doctor_id=eq.${clinicId}`, { method: "PATCH", body: update });
  if (status >= 400) return err(500, "update_failed", "Failed to save outcome");

  dispatchWebhooks(clinicId, "outcome.created", { patient_id: id, outcome: newOutcome });
  return json(201, { outcome: newOutcome });
}

// GET /clinic
async function getClinic(clinicId) {
  const { data } = await supaRest(`doctors?id=eq.${clinicId}&select=id,name,clinic_name,created_at`);
  if (!Array.isArray(data) || data.length === 0) return err(404, "not_found", "Clinic not found");
  return json(200, { clinic: data[0] });
}

// GET /clinic/analytics
async function getAnalytics(clinicId) {
  const { data: patients } = await supaRest(
    `patients?doctor_id=eq.${clinicId}&select=id,risk_score,segment,no_appointment,had_procedure,created_at,outcome_procedures&order=created_at.desc&limit=5000`
  );
  const list = Array.isArray(patients) ? patients : [];

  const total = list.length;
  const segments = {};
  let noAppt = 0, hadProc = 0, totalScore = 0;

  for (const p of list) {
    segments[p.segment] = (segments[p.segment] || 0) + 1;
    if (p.no_appointment) noAppt++;
    if (p.had_procedure) hadProc++;
    totalScore += p.risk_score || 0;
  }

  const now = new Date();
  const last30 = list.filter(p => new Date(p.created_at) > new Date(now - 30 * 86_400_000)).length;
  const last7 = list.filter(p => new Date(p.created_at) > new Date(now - 7 * 86_400_000)).length;

  return json(200, {
    analytics: {
      total_patients: total,
      last_7_days: last7,
      last_30_days: last30,
      avg_risk_score: total ? Math.round(totalScore / total) : 0,
      conversion_rate: total ? Math.round((hadProc / total) * 100) : 0,
      no_appointment_rate: total ? Math.round((noAppt / total) * 100) : 0,
      segments,
    },
  });
}

// POST /webhooks
async function createWebhook(body, clinicId) {
  if (!body.url || !body.events) return err(400, "validation_failed", "url and events are required");

  const hook = {
    id: crypto.randomUUID(),
    clinic_id: clinicId,
    url: body.url,
    events: body.events,
    secret: body.secret || null,
    is_active: true,
    created_at: new Date().toISOString(),
  };

  const { status, data } = await supaRest("webhooks", { method: "POST", body: hook });
  if (status >= 400) return err(status, "insert_failed", "Failed to create webhook", data);
  return json(201, { webhook: Array.isArray(data) ? data[0] : data });
}

// GET /webhooks
async function listWebhooks(clinicId) {
  const { data } = await supaRest(`webhooks?clinic_id=eq.${clinicId}&select=id,url,events,is_active,created_at&order=created_at.desc`);
  return json(200, { webhooks: Array.isArray(data) ? data : [] });
}

// DELETE /webhooks/:id
async function deleteWebhook(id, clinicId) {
  const { data } = await supaRest(`webhooks?id=eq.${id}&clinic_id=eq.${clinicId}`, { method: "DELETE" });
  if (!Array.isArray(data) || data.length === 0) return err(404, "not_found", "Webhook not found");
  return json(200, { deleted: true, id });
}

// ─── Router ─────────────────────────────────────────────────────────────────

const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS };

  // Parse path — handle both direct and redirect paths
  const raw = event.path
    .replace(/^\/?\.netlify\/functions\/api-v1\/?/, "")
    .replace(/^\/?api\/v1\/?/, "");
  const parts = raw.split("/").filter(Boolean);
  const method = event.httpMethod;
  const params = event.queryStringParameters || {};

  // Auth
  const auth = await authenticate(event);
  if (auth.error) return auth.error;
  const clinicId = auth.key.clinic_id;

  // Rate limit
  const rateLimited = await checkRateLimit(auth.key.id);
  if (rateLimited) return rateLimited;

  // Parse body
  let body = {};
  if (event.body) {
    try { body = JSON.parse(event.body); } catch { return err(400, "invalid_json", "Request body must be valid JSON"); }
  }

  // ─── Route matching ───
  const resource = parts[0];
  const id = parts[1];
  const sub = parts[2];

  // /patients
  if (resource === "patients" && !id) {
    if (method === "POST") return createPatient(body, clinicId);
    if (method === "GET") return listPatients(params, clinicId);
    return err(405, "method_not_allowed", `${method} not allowed on /patients`);
  }

  // /patients/:id
  if (resource === "patients" && id && !sub) {
    if (method === "GET") return getPatient(id, clinicId);
    if (method === "PATCH") return updatePatient(id, body, clinicId);
    if (method === "DELETE") return deletePatient(id, clinicId);
    return err(405, "method_not_allowed", `${method} not allowed on /patients/:id`);
  }

  // /patients/:id/observation
  if (resource === "patients" && id && sub === "observation") {
    if (method === "GET") return getObservation(id, clinicId);
    return err(405, "method_not_allowed", `${method} not allowed on /patients/:id/observation`);
  }

  // /patients/:id/outcomes
  if (resource === "patients" && id && sub === "outcomes") {
    if (method === "POST") return createOutcome(id, body, clinicId);
    return err(405, "method_not_allowed", `${method} not allowed on /patients/:id/outcomes`);
  }

  // /clinic
  if (resource === "clinic" && !id) {
    if (method === "GET") return getClinic(clinicId);
    return err(405, "method_not_allowed", `${method} not allowed on /clinic`);
  }

  // /clinic/analytics
  if (resource === "clinic" && id === "analytics") {
    if (method === "GET") return getAnalytics(clinicId);
    return err(405, "method_not_allowed", `${method} not allowed on /clinic/analytics`);
  }

  // /webhooks
  if (resource === "webhooks" && !id) {
    if (method === "POST") return createWebhook(body, clinicId);
    if (method === "GET") return listWebhooks(clinicId);
    return err(405, "method_not_allowed", `${method} not allowed on /webhooks`);
  }

  // /webhooks/:id
  if (resource === "webhooks" && id) {
    if (method === "DELETE") return deleteWebhook(id, clinicId);
    return err(405, "method_not_allowed", `${method} not allowed on /webhooks/:id`);
  }

  return err(404, "not_found", `Unknown endpoint: /api/v1/${parts.join("/")}`);
};

export { handler };
