/**
 * SculptAI chat proxy — Anthropic API'ye kontrollü geçiş.
 * Endpoint halka açık hasta formundan çağrıldığı için login şartı koyulamaz;
 * koruma katmanları: same-origin kontrolü + model/token sabitleme +
 * mesaj boyutu sınırı + IP başına rate limit.
 */

// Client yalnız bu modeli kullanıyor (App.jsx guide üretimi) — başka model kabul etme
const ALLOWED_MODELS = new Set(["claude-sonnet-4-20250514"]);
const MAX_TOKENS_CAP = 1000;
const MAX_MESSAGES = 10;
const MAX_TOTAL_CHARS = 20000;

// Rate limit: lambda instance başına hafızada tutulur (soğuk start'ta sıfırlanır —
// tam garanti değil ama kötüye kullanımın maliyetini ciddi düşürür)
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const ipHits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const hits = (ipHits.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_LIMIT) { ipHits.set(ip, hits); return true; }
  hits.push(now);
  ipHits.set(ip, hits);
  if (ipHits.size > 5000) ipHits.clear(); // bellek emniyeti
  return false;
}

function sameOrigin(event) {
  const origin = event.headers.origin || event.headers.Origin;
  const host = event.headers.host || event.headers.Host;
  if (!origin || !host) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}

function corsHeaders(event) {
  return {
    "Access-Control-Allow-Origin": event.headers.origin || "",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

const handler = async (event) => {
  const headers = corsHeaders(event);

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  if (!sameOrigin(event)) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: "forbidden_origin" }) };
  }

  const ip = event.headers["x-nf-client-connection-ip"] || event.headers["client-ip"] || "unknown";
  if (rateLimited(ip)) {
    return { statusCode: 429, headers, body: JSON.stringify({ error: "rate_limited" }) };
  }

  try {
    const { model, max_tokens, messages } = JSON.parse(event.body);

    if (!ALLOWED_MODELS.has(model)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "model_not_allowed" }) };
    }
    if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "bad_messages" }) };
    }
    const totalChars = messages.reduce((n, m) => n + String(m?.content ?? "").length, 0);
    if (totalChars > MAX_TOTAL_CHARS) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "messages_too_long" }) };
    }
    const safeMaxTokens = Math.min(Number(max_tokens) || MAX_TOKENS_CAP, MAX_TOKENS_CAP);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model, max_tokens: safeMaxTokens, messages }),
    });

    const data = await response.json();

    return {
      statusCode: response.status,
      headers,
      body: JSON.stringify(data),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};

export { handler };
