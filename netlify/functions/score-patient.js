/**
 * SculptAI score-patient — server-side skorlama
 * V6B_WEIGHTS + v5 fallback ağırlıkları ve klinik kalibrasyon modeli
 * yalnızca burada yaşar; client bundle'a asla girmez.
 *
 * POST { doctor_id, answers } → { score, model_source }
 *
 * Skor akışı App.jsx'teki eski client-side akışın birebir kopyası:
 *   1. v6b (4 feature) primary
 *   2. Klinik modeli varsa blend (v6b %70 + klinik %30)
 *   3. Hata olursa v5 fallback
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "https://ndabbbnrlgtwparpivim.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/* ─── ML SİSTEMİ v6b — 4 temiz feature, 93 etiketli hasta, CV bal.acc: 0.675 ── */
const V6B_WEIGHTS = {
  intercept: 0.1562403721807126,
  coef: [
    -0.336796400293243,   // revizyon
    -0.7371948513506076,  // riskBilgisi
    -0.2951358415849597,  // oncekiAmeliyat
    -0.32471527705197634, // prosedurRiski
  ],
  mean: [0.41612903225806464, 0.5129032258064511, -0.16666666666666693, 0.3231182795698923],
  std:  [0.2878508882882087, 0.31219851916038655, 0.3070264369315946, 0.10174793326609557],
};

/* ─── ML SİSTEMİ v5 (FALLBACK) — 15 feature, 83 etiketli hasta ─────────── */
const GLOBAL_ML_WEIGHTS = {
  intercept: -0.19329336986517526,
  coef: {
    motivasyon:        0.14815593982206213,
    destek:            0.17168305727711664,
    revizyon:          0.4667370252183707,
    riskBilgisi:       0.3442857041485327,
    beklenti:          0.16487521947942305,
    doktorSayisi:      -0.18238856705244752,
    oncekiAmeliyat:    0.2868475088441981,
    prosedurRiski:     0.2862666070555644,
    yas:               0.051617311755898426,
    rhinoDışsal:       0.09630066582497172,
    oncekiKotu:        0.12569505103302903,
    bilgisizDesteksiz: 0.10539008092538354,
    yuksekRiskProc:    0.17931191185566991,
    kararSuresi:       0.18,
    bddSkor:           0.22,
  },
  mean: [0.12142857142857141, 0.17087912087912083, 0.4357142857142857, 0.6538461538461539, 0.31483516483516444, 0.16483516483516483, 0.016483516483516477, 0.3332967032967033, 0.46771978021978006, 0.06593406593406594, 0.06593406593406594, 0.13186813186813187, 0.16483516483516483, 0.1, 0.15],
  std:  [0.28256506176229307, 0.29436707424443237, 0.3907084094622097, 0.3028464566927619, 0.22888819977055075, 0.25736348194791997, 0.23264543425552567, 0.19993435705748244, 0.2573563540433698, 0.24816680858541154, 0.24816680858541146, 0.3383473476558382, 0.3710317146403107, 0.3, 0.35],
};

const PROC_RISK_MAP = {
  "Meme Asimetrisinin Giderilmesi":1.0,
  "Karın Germe":0.6,
  "Yüz Germe":0.4,
  "Burun Estetiği":0.35,
  "Jinekomasti":0.33,
  "Meme Büyütme (Silikon Protez ile)":0.29,
  "Meme Dikleştirme":0.25,
  "Meme Küçültme":0.14,
  "Üst Göz Kapağı Estetiği":0.05,
  "Alt Göz Kapağı Estetiği":0.05,
  "Liposuction":0.02,
  "Dolgu Uygulaması":0.02,
  "Botoks":0.02,
  "Uyluk veya Kol germe":0.05,
  "Lazer Epilasyon":0.02,
  "Lazer Dövme Silme":0.05,
  "Cilt Yenileme (Rejuvenasyon)":0.03,
  "Karbon Peeling":0.01,
  "Lazer Leke Tedavisi":0.03,
  "Lazer Saç Tedavisi":0.02,
  "Kaş Kaldırma":0.15,
  "Yanak Estetiği (Bişektomi)":0.12,
  "Kepçe Kulak Tedavisi":0.08,
  "Yüz Yağ Enjeksiyonu":0.10,
  "Genital Estetik":0.20,
  "Labioplasti":0.18,
  "Göz Altı Işık Dolgusu":0.03,
  "Nano Yağ Enjeksiyonu":0.05,
  "Mezoterapi":0.02,
};

function extractV6bFeatures(a) {
  const m_rev = {
    "Evet, ve olası revizyonu normal kabul ederim":0.0,
    "Evet, olası revizyonu normal karşılarım":0.0,
    "Revizyon ihtimali beni çok endişelendiriyor":0.5,
    "Revizyon beni endişelendiriyor":0.45,
    "Kusursuz sonuç bekliyorum":1.0,
  }[a.revision] ?? 0.3;

  const m_risk = {
    "Detaylı araştırdım ve biliyorum":0.0,
    "Genel olarak bilgi sahibiyim":0.4,
    "Hiçbir bilgim yok":1.0,
  }[a.riskKnowledge] ?? 0.5;

  const m_prev = {
    "Hayır":-0.3,"Evet ve memnunum":0.0,
    "Evet ama beklentimi karşılamadı":0.7,"Evet ve hiç memnun değilim":1.0,
  }[a.prevSurgery] ?? 0.0;

  const m_proc = PROC_RISK_MAP[a.procedure] ?? 0.3;

  return [m_rev, m_risk, m_prev, m_proc];
}

function computeV6bScore(a) {
  const feats = extractV6bFeatures(a);
  const W = V6B_WEIGHTS;
  let logit = W.intercept;
  feats.forEach((v, i) => {
    const z = (v - W.mean[i]) / (W.std[i] || 1);
    logit += W.coef[i] * z;
  });
  const prob = 1 / (1 + Math.exp(-logit));
  const riskScore = Math.min(100, Math.round((1 - prob) * 100));
  return { riskScore, prob };
}

function extractRawFeatures(a) {
  const m_motiv = {
    "Görünümümü iyileştirmek istiyorum":0.0,
    "Sosyal özgüvenimi artırmak istiyorum":0.2,
    "Özgüvenimi artırmak istiyorum":0.2,
    "Kendim için daha iyi hissetmek istiyorum":0.15,
    "Hayatımda büyük bir değişime ihtiyacım var":0.85,
    "Başka insanların yorumları beni kötü etkiliyor":1.0,
    "Yakınlarımın yorumları etkili oldu":1.0,
  }[a.motivation] ?? 0.0;

  const m_support = {
    "Evet, destekliyorlar":0.0,"Evet":0.0,"Kararsızlar":0.35,
    "Biliyorlar ama kararsızlar":0.5,"Kimseye söylemedim":0.85,
    "Bu işleme karşılar":1.0,"Karşılar":1.0,
  }[a.support] ?? 0.0;

  const m_rev = {
    "Evet, ve olası revizyonu normal kabul ederim":0.0,
    "Evet, olası revizyonu normal karşılarım":0.0,
    "Revizyon ihtimali beni çok endişelendiriyor":0.5,
    "Revizyon beni endişelendiriyor":0.45,
    "Kusursuz sonuç bekliyorum":1.0,
  }[a.revision] ?? 0.0;

  const m_risk = {
    "Detaylı araştırdım ve biliyorum":0.0,
    "Genel olarak bilgi sahibiyim":0.5,
    "Hiçbir bilgim yok":1.0,
  }[a.riskKnowledge] ?? 0.5;

  const m_exp = {
    "Küçük iyileştirmeler yeterli":0.0,"Küçük, doğal bir iyileştirme yeterli":0.0,
    "Doğal ve dengeli bir sonuç bekliyorum":0.2,"Dengeli ve orantılı bir sonuç bekliyorum":0.2,
    "Belirgin bir fark olmasını istiyorum":0.6,
    "Belirgin bir değişim bekliyorum, ameliyat olduğum belli olmalı":0.75,
    "Tamamen farklı bir görünüm istiyorum":1.0,"Tamamen farklı görünmek istiyorum":1.0,
  }[a.expectation] ?? 0.2;

  const m_multi = {
    "Hayır":0.0,"1-2 doktora danıştım":0.5,"1-2 doktorla görüştüm":0.5,
    "Birçok doktora danıştım":1.0,"Birçok doktorla görüştüm":1.0,
  }[a.multiDoctor] ?? 0.0;

  const m_prev = {
    "Hayır":0.0,"Evet ve memnunum":-0.3,
    "Evet ama beklentimi karşılamadı":0.7,"Evet ve hiç memnun değilim":1.0,
  }[a.prevSurgery] ?? 0.0;

  const m_decision = {
    "Yeni karar verdim — heyecanlı ve kararlı hissediyorum": 0.2,
    "Birkaç aydır düşünüyorum — hazır olduğumu hissediyorum": 0.0,
    "1 yılı aşkın süredir düşünüyorum — artık harekete geçme zamanı": 0.1,
    "Uzun süredir düşünüyorum ama hâlâ kararsız hissediyorum": 0.9,
  }[a.decisionDuration] ?? 0.1;

  const m_bdd = {
    "Pek etkilemiyor, bazen düşünüyorum": 0.0,
    "Sıkça düşünüyorum ama hayatımı yönlendirmiyor": 0.33,
    "Günde saatlerce düşünüyorum, sosyal hayatımı etkiliyor": 0.67,
    "Tamamen ele geçirdi, kaçınma davranışlarım var": 1.0,
  }[a.bddScreen] ?? 0.0;

  const m_proc = PROC_RISK_MAP[a.procedure] ?? 0.3;
  const age_n  = Math.min(1, Math.max(0, ((parseInt(a.age)||35) - 17) / 48));

  const rhinoDışsal       = (a.procedure==="Burun Estetiği" && m_motiv>=0.85) ? 1.0 : 0.0;
  const oncekiKotu        = m_prev >= 0.7 ? 1.0 : 0.0;
  const bilgisizDesteksiz = (m_risk>=1.0 && m_support>=0.5) ? 1.0 : 0.0;
  const yuksekRiskProc    = m_proc >= 0.5 ? 1.0 : 0.0;

  return [m_motiv, m_support, m_rev, m_risk, m_exp, m_multi, m_prev,
          m_proc, age_n, rhinoDışsal, oncekiKotu, bilgisizDesteksiz, yuksekRiskProc, m_decision, m_bdd];
}

function computeMLScore(a) {
  const feats = extractRawFeatures(a);
  const W = GLOBAL_ML_WEIGHTS;
  const coefs = Object.values(W.coef);

  let logit = W.intercept;
  feats.forEach((v, i) => {
    const z = (v - W.mean[i]) / (W.std[i] || 1);
    logit += coefs[i] * z;
  });

  const prob = 1 / (1 + Math.exp(-logit));
  const mlBase = Math.round((1 - prob) * 100);

  const procRisk = PROC_RISK_MAP[a.procedure] ?? 0.3;
  const blended = Math.round(mlBase * 0.70 + procRisk * 100 * 0.30);

  const prevBadBonus =
    a.prevSurgery === "Evet ve hiç memnun değilim" ? 15 :
    a.prevSurgery === "Evet ama beklentimi karşılamadı" ? 8 : 0;

  const rhinoExtBonus = (a.procedure === "Burun Estetiği" &&
    ["Yakınlarımın yorumları etkili oldu","Başka insanların yorumları beni kötü etkiliyor"].includes(a.motivation)) ? 14 : 0;

  const noKnowNoSupportBonus = (a.riskKnowledge === "Hiçbir bilgim yok" &&
    ["Kimseye söylemedim","Bu işleme karşılar","Biliyorlar ama kararsızlar"].includes(a.support)) ? 8 : 0;

  const abdoFaceBonus = (["Karın Germe","Yüz Germe"].includes(a.procedure) &&
    a.riskKnowledge === "Hiçbir bilgim yok") ? 10 : 0;

  const riskScore = Math.min(100, blended + prevBadBonus + rhinoExtBonus + noKnowNoSupportBonus + abdoFaceBonus);

  return { riskScore, prob };
}

function computeScoreWithModel(a, weights) {
  const W = weights;
  const feats = extractRawFeatures(a);
  const coefs = Object.values(W.coef || {});
  if (!coefs.length) return computeMLScore(a).riskScore;
  let logit = W.intercept || 0;
  feats.forEach((v, i) => {
    const z = (v - (W.mean?.[i] || 0)) / (W.std?.[i] || 1);
    logit += (coefs[i] || 0) * z;
  });
  const prob = 1 / (1 + Math.exp(-logit));
  return Math.min(100, Math.round((1 - prob) * 100));
}

// Klinik modeli — lambda instance ömrü boyunca bellek cache'i
const clinicModelCache = {};

async function loadClinicModel(doctorId) {
  if (clinicModelCache[doctorId] !== undefined) return clinicModelCache[doctorId];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/clinic_models?doctor_id=eq.${encodeURIComponent(doctorId)}&select=weights,threshold,version&limit=1`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    const data = await res.json();
    const model = Array.isArray(data) && data[0]?.weights ? data[0] : null;
    clinicModelCache[doctorId] = model;
    return model;
  } catch (e) {
    return null;
  }
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

/* ─── Güvenlik katmanı: same-origin + rate limit + doctor_id doğrulama ────
   Endpoint halka açık hasta formundan anonim çağrılır; login şartı yerine
   origin kontrolü ve IP başına limit uygulanır. */
const MAX_BODY_BYTES = 50000;
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const ipHits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const hits = (ipHits.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_LIMIT) { ipHits.set(ip, hits); return true; }
  hits.push(now);
  ipHits.set(ip, hits);
  if (ipHits.size > 5000) ipHits.clear();
  return false;
}

function sameOrigin(event) {
  const origin = event.headers.origin || event.headers.Origin;
  const host = event.headers.host || event.headers.Host;
  if (!origin || !host) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}

// doctor_id (UUID veya username) → kanonik doctors.id; bulunamazsa null.
// Sistem karışık: bazı doktorların id'si "dr-ahmet" (username DEĞİL, id), bazılarınınki
// UUID + username "dr-tuba". Bu yüzden HER İKİ kolonu da ararız (or=id,username) ve
// kanonik id'yi döndürürüz — insert/panel/clinic_model hep aynı id'yle çalışsın diye.
// Lambda instance ömrü boyunca cache'lenir.
const doctorIdCache = {};
async function resolveDoctorId(value) {
  if (doctorIdCache[value] !== undefined) return doctorIdCache[value];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/doctors?or=(id.eq.${encodeURIComponent(value)},username.eq.${encodeURIComponent(value)})&select=id&limit=1`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    const data = await res.json();
    const id = (Array.isArray(data) && data[0] && data[0].id) ? data[0].id : null;
    doctorIdCache[value] = id;
    return id;
  } catch {
    return value; // Supabase erişilemezse skorlamayı bloklamayalım (fail-open, gelen değeri kullan)
  }
}

const handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "method_not_allowed" });
  if (!SERVICE_KEY) return json(500, { error: "server_misconfigured" });
  if (!sameOrigin(event)) return json(403, { error: "forbidden_origin" });

  const ip = event.headers["x-nf-client-connection-ip"] || event.headers["client-ip"] || "unknown";
  if (rateLimited(ip)) return json(429, { error: "rate_limited" });
  if ((event.body || "").length > MAX_BODY_BYTES) return json(413, { error: "body_too_large" });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "bad_request" }); }
  const { doctor_id, answers } = body;
  if (!answers || typeof answers !== "object") return json(400, { error: "missing_answers" });
  let canonicalDoctorId = null;
  if (doctor_id !== undefined && doctor_id !== null) {
    if (typeof doctor_id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(doctor_id))
      return json(400, { error: "bad_doctor_id" });
    canonicalDoctorId = await resolveDoctorId(doctor_id);
    if (!canonicalDoctorId) return json(400, { error: "unknown_doctor" });
  }

  let score, modelSource = "global_v6b";
  try {
    score = computeV6bScore(answers).riskScore;

    if (canonicalDoctorId) {
      const clinicModel = await loadClinicModel(canonicalDoctorId);
      if (clinicModel && clinicModel.weights) {
        const clinicScore = Math.round(computeScoreWithModel(answers, clinicModel.weights));
        score = Math.round(score * 0.70 + clinicScore * 0.30);
        modelSource = `v6b+clinic_v${clinicModel.version || 1}`;
      }
    }
  } catch (e) {
    score = computeMLScore(answers).riskScore;
    modelSource = "global_v5_fallback";
  }

  // doctor_id kanonik id olarak da dönüyor — istemci insert'te bunu kullanarak
  // patients.doctor_id'yi panelin/RLS'in beklediği id ile tutarlı yazabilir.
  return json(200, { score, model_source: modelSource, doctor_id: canonicalDoctorId });
};

export { handler };
