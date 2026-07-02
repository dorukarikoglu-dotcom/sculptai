/**
 * SculptAI clinic-info — hasta formu için public klinik bilgisi
 * password_hash İÇERMEYEN, sabit kolon listesiyle döner.
 * doctors tablosuna anon SELECT kapatıldığında formun ihtiyacı olan
 * tek veri kaynağı budur.
 *
 * GET /api/clinic-info?doctor=<uuid-veya-username>
 * → { id, name, clinic_name, photo_url, primary_color, enabled_procedures }
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "https://ndabbbnrlgtwparpivim.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Public'e açık güvenli kolonlar — password_hash, auth_id, avg_revenue YOK
const PUBLIC_COLS = "id,name,clinic_name,photo_url,primary_color,enabled_procedures";

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300", // klinik bilgisi nadiren değişir
    },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return json(405, { error: "method_not_allowed" });
  if (!SERVICE_KEY) return json(500, { error: "server_misconfigured" });

  const doctor = String(event.queryStringParameters?.doctor || "").trim();
  if (!doctor) return json(400, { error: "missing_doctor" });

  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(doctor);
  const col = isUUID ? "id" : "username";

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/doctors?${col}=eq.${encodeURIComponent(doctor)}&select=${PUBLIC_COLS}&limit=1`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) return json(404, { error: "not_found" });
    return json(200, data[0]);
  } catch (e) {
    console.error("clinic-info error:", e.message);
    return json(500, { error: "internal_error" });
  }
};
