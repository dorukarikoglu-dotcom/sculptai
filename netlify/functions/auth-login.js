/**
 * SculptAI auth-login — server-side login
 * Frontend'in doctors tablosuna doğrudan SELECT atmasını ortadan kaldırır.
 * Akış (eski client-side akışın birebir server-side karşılığı):
 *   1. Supabase Auth ile şifre doğrulama
 *   2. auth_id ile doctor kaydı; yoksa username ile eşleştirip auth_id migrate et
 *   3. Auth başarısızsa legacy password_hash karşılaştırması + Auth kullanıcısı oluşturma
 * Dönen doctor objesi MINIMAL'dir — password_hash asla dönmez.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "https://ndabbbnrlgtwparpivim.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
// Anon key public'tir (client bundle'da da var) — Auth password grant için yeterli
const ANON_KEY = process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5kYWJiYm5ybGd0d3BhcnBpdmltIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MTQ2NDAsImV4cCI6MjA4OTM5MDY0MH0.g9ZUYqFw00IE_aIVNumcGyGHi1lbrurSiPXnI5PzQJo";

const AUTH_EMAIL_DOMAIN = "sculptai.health";
// Hastaya/panele dönen güvenli kolonlar — password_hash YOK
// NOT: avg_revenue kolonu doctors tablosunda YOK — listede bırakmak PostgREST 400
// verdiriyordu (getDoctorBy null → invalid() → herkese "şifre hatalı").
const SAFE_DOCTOR_COLS = "id,auth_id,name,username,clinic_name,enabled_procedures,primary_color,photo_url";

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function sha256(text) {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function supaRest(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: opts.method || "GET",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: opts.prefer || "return=representation",
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

// Supabase Auth: şifre ile giriş (anon key yeterli)
async function authSignIn(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) return null;
  return res.json(); // { access_token, refresh_token, user, ... }
}

// Supabase Auth admin: kullanıcı oluştur (legacy migrasyon için, service_role)
async function authAdminCreateUser(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!res.ok) return null;
  return res.json(); // user objesi
}

async function getDoctorBy(col, val) {
  const { status, data } = await supaRest(
    `doctors?${col}=eq.${encodeURIComponent(val)}&select=${SAFE_DOCTOR_COLS},password_hash&limit=1`
  );
  if (status !== 200) {
    // Sessiz null yok: PostgREST hata gövdesini logla (eksik kolon vb. görünür olsun)
    console.error(`getDoctorBy(${col}) PostgREST HTTP ${status}:`,
      typeof data === "string" ? data : JSON.stringify(data));
    return null;
  }
  if (!Array.isArray(data) || !data.length) return null;
  return data[0];
}

function stripDoctor(doc) {
  if (!doc) return null;
  const { password_hash, ...safe } = doc;
  return safe;
}

const handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "method_not_allowed" });
  if (!SERVICE_KEY) return json(500, { error: "server_misconfigured" });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "bad_request" }); }
  const username = String(body.username || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!username || !password) return json(400, { error: "missing_credentials" });

  const email = `${username}@${AUTH_EMAIL_DOMAIN}`;
  const invalid = () => json(401, { error: "invalid_credentials" });

  try {
    // ── 1. Supabase Auth ile dene ──────────────────────────────────────────
    const auth = await authSignIn(email, password);
    if (auth?.user) {
      let doc = await getDoctorBy("auth_id", auth.user.id);
      if (!doc) {
        // auth_id eşleşmedi — username ile migrasyon
        doc = await getDoctorBy("username", username);
        if (doc) {
          await supaRest(`doctors?id=eq.${encodeURIComponent(doc.id)}`, {
            method: "PATCH",
            body: { auth_id: auth.user.id },
            prefer: "return=minimal",
          });
          doc.auth_id = auth.user.id;
        }
      }
      if (!doc) return invalid();
      return json(200, {
        doctor: stripDoctor(doc),
        session: { access_token: auth.access_token, refresh_token: auth.refresh_token },
      });
    }

    // ── 2. Legacy login — YALNIZCA gerçek parola kanıtıyla ─────────────────
    // Placeholder ("migrated_to_auth" / "managed_by_auth") KABUL EDİLMEZ:
    // Auth kayıtlı hesaplar yalnızca path 1 ile girer. Buraya sadece gerçek
    // legacy hash'i (veya düz metin parolayı) tutan hesaplar düşebilir; yani
    // authAdminCreateUser yalnız parolasını kanıtlayan kullanıcı için çalışır.
    const legacy = await getDoctorBy("username", username);
    if (!legacy) return invalid();
    const hashed = await sha256(password + "_sculptai_salt_2026");
    const passwordProven =
      legacy.password_hash === hashed ||
      legacy.password_hash === password;
    if (!passwordProven) return invalid();

    // Parola kanıtlandı → Auth'a taşı ve oturum aç.
    const created = await authAdminCreateUser(email, password);
    if (!created?.id) return json(500, { error: "auth_provisioning_failed" });
    const auth2 = await authSignIn(email, password);
    if (!auth2?.access_token) return json(500, { error: "auth_provisioning_failed" });
    const session = { access_token: auth2.access_token, refresh_token: auth2.refresh_token };

    // Yalnızca geçerli session üretildiyse buraya gelinir — 200+doctor'u
    // session'sız DÖNDÜRMÜYORUZ (istemci onLogin ile oturum açıyor).
    await supaRest(`doctors?id=eq.${encodeURIComponent(legacy.id)}`, {
      method: "PATCH",
      body: { auth_id: created.id, password_hash: "migrated_to_auth" },
      prefer: "return=minimal",
    });
    legacy.auth_id = created.id;

    return json(200, { doctor: stripDoctor(legacy), session });
  } catch (e) {
    console.error("auth-login error:", e.message);
    return json(500, { error: "internal_error" });
  }
};

export { handler };
