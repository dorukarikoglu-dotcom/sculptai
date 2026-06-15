import React, { useState, useEffect, useRef } from "react";
import { createClient } from "@supabase/supabase-js";

/* ─── SUPABASE ───────────────────────────────────────────────────────────── */
const sb = createClient(
  "https://ndabbbnrlgtwparpivim.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5kYWJiYm5ybGd0d3BhcnBpdmltIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MTQ2NDAsImV4cCI6MjA4OTM5MDY0MH0.g9ZUYqFw00IE_aIVNumcGyGHi1lbrurSiPXnI5PzQJo"
);

/* ─── ŞİFRELEME — AES-GCM ────────────────────────────────────────────────── */
async function getKey(doctorId){
  // PBKDF2 ile güçlü key derivation — doctorId + sabit salt
  const salt=new TextEncoder().encode("sculptai_enc_2026_"+doctorId);
  const baseKey=await crypto.subtle.importKey("raw",new TextEncoder().encode(doctorId),{name:"PBKDF2"},false,["deriveKey"]);
  return crypto.subtle.deriveKey({name:"PBKDF2",salt,iterations:100000,hash:"SHA-256"},baseKey,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
}
// Legacy fallback — eski şifreli verileri okumak için
async function getLegacyKey(doctorId){
  const raw=new TextEncoder().encode(doctorId.padEnd(16,"0").slice(0,16));
  return crypto.subtle.importKey("raw",raw,{name:"AES-GCM"},false,["encrypt","decrypt"]);
}

/* ─── ŞİFRE HASHING — SHA-256 ───────────────────────────────────────────── */
async function hashPassword(password){
  const data=new TextEncoder().encode(password+"_sculptai_salt_2026");
  const buf=await crypto.subtle.digest("SHA-256",data);
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,"0")).join("");
}
async function encryptName(name,doctorId){
  if(!name||!doctorId) return name||"";
  try{
    const key=await getKey(doctorId);
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const enc=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,new TextEncoder().encode(name));
    const buf=new Uint8Array([...iv,...new Uint8Array(enc)]);
    return btoa(String.fromCharCode(...buf));
  }catch{return name;}
}
async function decryptName(cipher,doctorId){
  if(!cipher||!doctorId) return cipher||"";
  try{
    const buf=Uint8Array.from(atob(cipher),c=>c.charCodeAt(0));
    const iv=buf.slice(0,12);
    const data=buf.slice(12);
    // Yeni PBKDF2 key ile dene
    try{
      const key=await getKey(doctorId);
      const dec=await crypto.subtle.decrypt({name:"AES-GCM",iv},key,data);
      return new TextDecoder().decode(dec);
    }catch{
      // Yeni key başarısız — legacy key ile dene (eski veriler)
      const legKey=await getLegacyKey(doctorId);
      const dec=await crypto.subtle.decrypt({name:"AES-GCM",iv},legKey,data);
      return new TextDecoder().decode(dec);
    }
  }catch{return cipher;}
}

/* ─── API RATE LIMITER ───────────────────────────────────────────────────── */
const apiRateLimit={calls:[],maxPerMinute:10};
function canCallAPI(){
  const now=Date.now();
  apiRateLimit.calls=apiRateLimit.calls.filter(t=>now-t<60000);
  if(apiRateLimit.calls.length>=apiRateLimit.maxPerMinute) return false;
  apiRateLimit.calls.push(now);
  return true;
}

/* ─── FONTS & STYLES ─────────────────────────────────────────────────────── */
const FL = document.createElement("link");
FL.rel = "stylesheet";
FL.href = "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,300;0,400;0,500;1,300;1,400;1,500&family=Nunito:wght@300;400;500;600&display=swap";
document.head.appendChild(FL);
const SE = document.createElement("style");
SE.textContent = `*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Nunito',sans-serif;background:#f8fafd;color:#1e3a5f;font-size:13px;line-height:1.5}input,button,select{font-family:'Nunito',sans-serif}button{cursor:pointer}::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:#d4e1ef;border-radius:2px}@keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}@keyframes spin{to{transform:rotate(360deg)}}@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.35}}.f1{animation:fadeUp 0.35s ease 0.05s both}.f2{animation:fadeUp 0.35s ease 0.12s both}.f3{animation:fadeUp 0.35s ease 0.19s both}.f4{animation:fadeUp 0.35s ease 0.26s both}.f5{animation:fadeUp 0.35s ease 0.33s both}`;
document.head.appendChild(SE);



/* ─── ML AĞIRLIKLARI (pipeline'dan üretildi, outcome verisi arttıkça güncellenir) ── */

/* ─── THRESHOLD MODES ───────────────────────────────────────────────────── */

/* ─── ML SİSTEMİ v6b — 4 temiz feature, 93 etiketli hasta, CV bal.acc: 0.675 ── */
/* Features: revizyon, riskBilgisi, oncekiAmeliyat, prosedurRiski               */
/* Ampirik yön doğrulanmış, bootstrap %90+ stabil, confounding yok              */
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
const V6B_THRESHOLD = 48; // Optimal F1 threshold for no-conv class

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
  // Lazer tedaviler — cerrahi olmayan, düşük risk
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

const ALL_PROCEDURES = {
  "Meme Estetiği":["Meme Küçültme","Meme Büyütme (Silikon Protez ile)","Meme Dikleştirme","Meme Asimetrisinin Giderilmesi","Meme Onarımı (Kanser sonrası)","Doğumsal Meme Anomalisinin Düzeltilmesi"],
  "Yüz Estetiği":["Burun Estetiği","Yüz Germe","Kaş Kaldırma","Üst Göz Kapağı Estetiği","Alt Göz Kapağı Estetiği","Yanak Estetiği (Bişektomi)","Kepçe Kulak Tedavisi","Yüz Yağ Enjeksiyonu"],
  "Vücut Şekillendirme":["Karın Germe","Liposuction","Uyluk veya Kol germe","Popo estetiği"],
  "Erkek Estetiği":["Jinekomasti"],
  "Genital Estetik":["Genital Estetik","Labioplasti"],
  "Medikal Estetik":["Botoks Uygulaması","Dolgu Uygulaması","Göz Altı Işık Dolgusu","Nano Yağ Enjeksiyonu","Mezoterapi"],
  "Lazer Tedavi":["Lazer Epilasyon","Lazer Dövme Silme","Cilt Yenileme (Rejuvenasyon)","Karbon Peeling","Lazer Leke Tedavisi","Lazer Saç Tedavisi"],
};
const ALL_PROCEDURE_LIST = Object.values(ALL_PROCEDURES).flat();

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

  // Karar süresi + his — yeni sinyal
  const m_decision = {
    "Yeni karar verdim — heyecanlı ve kararlı hissediyorum": 0.2,
    "Birkaç aydır düşünüyorum — hazır olduğumu hissediyorum": 0.0,
    "1 yılı aşkın süredir düşünüyorum — artık harekete geçme zamanı": 0.1,
    "Uzun süredir düşünüyorum ama hâlâ kararsız hissediyorum": 0.9,
  }[a.decisionDuration] ?? 0.1;

  // BDD tarama skoru (0-1)
  const m_bdd = {
    "Pek etkilemiyor, bazen düşünüyorum": 0.0,
    "Sıkça düşünüyorum ama hayatımı yönlendirmiyor": 0.33,
    "Günde saatlerce düşünüyorum, sosyal hayatımı etkiliyor": 0.67,
    "Tamamen ele geçirdi, kaçınma davranışlarım var": 1.0,
  }[a.bddScreen] ?? 0.0;

  const m_proc = PROC_RISK_MAP[a.procedure] ?? 0.3;
  const age_n  = Math.min(1, Math.max(0, ((parseInt(a.age)||35) - 17) / 48));

  // Kombinasyon featureları
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

  // Kombinasyon bonusları — ML'in göremediği pattern'ler
  const procRisk = PROC_RISK_MAP[a.procedure] ?? 0.3;

  // %30 prosedür + %70 ML
  const blended = Math.round(mlBase * 0.70 + procRisk * 100 * 0.30);

  // Güçlü sinyaller — veriden kanıtlanmış
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



/* ─── ELÇİ ML MODELİ ────────────────────────────────────────────────────── */

/* ─── KLİNİK BAZLI MODEL ────────────────────────────────────────────────── */
/* ─── KLİNİK MODEL CACHE — localStorage + versiyon bazlı invalidation ─── */
const clinicModelCache = {};
const CLINIC_MODEL_LS_KEY = (id) => `sculptai_clinic_model_${id}`;

async function loadClinicModel(doctorId) {
  // 1. Bellek cache'i kontrol et
  if(clinicModelCache[doctorId] !== undefined) return clinicModelCache[doctorId];

  // 2. localStorage'dan yükle
  try {
    const cached = localStorage.getItem(CLINIC_MODEL_LS_KEY(doctorId));
    if(cached) {
      const parsed = JSON.parse(cached);
      // Supabase'deki version ile karşılaştır
      const { data: remote } = await sb.from("clinic_models")
        .select("version, updated_at")
        .eq("doctor_id", doctorId)
        .maybeSingle();

      if(remote && parsed.version >= remote.version) {
        // Cache güncel — kullan
        clinicModelCache[doctorId] = parsed;
        return parsed;
      }
    }
  } catch(e) {}

  // 3. Supabase'den tam model çek
  try {
    const { data } = await sb.from("clinic_models")
      .select("weights, threshold, version, train_date, val_accuracy, val_f1, label_count, n_train, n_neg, threshold_src, updated_at")
      .eq("doctor_id", doctorId)
      .maybeSingle();

    if(data && data.weights) {
      clinicModelCache[doctorId] = data;
      // localStorage'a kaydet
      try { localStorage.setItem(CLINIC_MODEL_LS_KEY(doctorId), JSON.stringify(data)); } catch(e) {}
      return data;
    }
  } catch(e) {}

  clinicModelCache[doctorId] = null;
  return null;
}

function invalidateClinicModel(doctorId) {
  delete clinicModelCache[doctorId];
  try { localStorage.removeItem(CLINIC_MODEL_LS_KEY(doctorId)); } catch(e) {}
}



function computeScoreWithModel(a, weights) {
  // Klinik modeli varsa onun ağırlıklarıyla hesapla
  const W = weights;
  const feats = extractRawFeatures(a);
  const coefs = Object.values(W.coef || {});
  if(!coefs.length) return computeMLScore(a).riskScore;
  let logit = W.intercept || 0;
  feats.forEach((v, i) => {
    const z = (v - (W.mean?.[i] || 0)) / (W.std?.[i] || 1);
    logit += (coefs[i] || 0) * z;
  });
  const prob = 1 / (1 + Math.exp(-logit));
  return Math.min(100, Math.round((1 - prob) * 100));
}


function classify(score,a,threshold=V6B_THRESHOLD,bands=null){
  // bands={p33,p67} → persentil bantları (kliniğe göre), yoksa sabit threshold kullanır
  const redLine=bands?bands.p67:threshold;
  const amberLine=bands?bands.p33:Math.round(threshold*0.65);
  // Marka elçisi — yeni sorular + düşük risk
  // ML tabanlı elçi skoru

  // Risk sinyalleri
  const bddRisk=a.bddScreen==="Günde saatlerce düşünüyorum, sosyal hayatımı etkiliyor"||a.bddScreen==="Tamamen ele geçirdi, kaçınma davranışlarım var"||a.bodyFocus==="Neredeyse her gün, bazen işimi gücümü etkiliyor"||a.avoidance==="Günlük hayatımı önemli ölçüde kısıtlıyor";
  const highExp=a.expectation?.includes("Tamamen farklı");
  const extMotiv=["Yakınlarımın yorumları etkili oldu","Başka insanların yorumları beni kötü etkiliyor"].some(x=>a.motivation===x);
  const manyDocs=a.multiDoctor==="Birçok doktorla görüştüm";
  const noSupport=["Kimseye söylemedim","Karşılar"].some(x=>a.support===x);
  const unrealistic=a.revision==="Kusursuz sonuç bekliyorum";
  const rhinoRedFlag=a.procedure==="Burun Estetiği"&&a.rhinoVision==="Aklımda belirli bir referans var — bir ünlü veya fotoğraf";
  const breastSymRedFlag=["Meme Küçültme","Meme Dikleştirme","Meme Büyütme (Silikon Protez ile)","Meme Asimetrisinin Giderilmesi"].includes(a.procedure)&&a.breastSymmetry==="Çok küçük bir fark var ama bu küçük fark bile beni rahatsız ediyor";

  // Açık uçlu cevap — red flag keyword taraması
  const storyLower=(a.openStory||"").toLowerCase();
  const redKeywords=["mükemmel","kusursuz","herkes fark","herkes görsün","tamamen değiş","özgüvenim tamamen","hayatım değiş","bambaşka biri","tanınamaz","artık ben olam"];
  const storyRedFlag=redKeywords.some(kw=>storyLower.includes(kw));

  const riskFactors=[bddRisk,highExp&&extMotiv,manyDocs,unrealistic,rhinoRedFlag,breastSymRedFlag,storyRedFlag].filter(Boolean).length;

  // ── Dinamik "neden" açıklaması — v6b ampirik-doğrulanmış 4 feature ────────
  // riskBilgisi, revizyon, oncekiAmeliyat, prosedurRiski → ampirik yönü kanıtlı
  // Diğer sinyaller (bddRisk, rhinoRedFlag vb.) klinik değer taşır ama skora girmez
  const noRiskKnow = a.riskKnowledge==="Hiçbir bilgim yok";
  const someRiskKnow = a.riskKnowledge==="Genel olarak bilgi sahibiyim";
  const prevBad = a.prevSurgery==="Evet ve hiç memnun değilim"||a.prevSurgery==="Evet ama beklentimi karşılamadı";
  const procRiskVal = PROC_RISK_MAP[a.procedure] ?? 0.3;
  const highProcRisk = procRiskVal >= 0.35;

  function buildReason(){
    const reasons=[];

    // ── Çekirdek 4 feature — ampirik yönü doğrulanmış, skora giren ──
    if(noRiskKnow)
      reasons.push({txt:"İşlemin riskleri ve iyileşme süreci hakkında hiç bilgisi yok — bilinçli karar vermesi güçleşiyor.",weight:10});
    else if(someRiskKnow && score>=40)
      reasons.push({txt:"Risk ve iyileşme bilgisi genel düzeyde — detayları konsültasyonda somutlaştırın.",weight:4});

    if(unrealistic)
      reasons.push({txt:"\"Kusursuz sonuç\" beklentisi — hiçbir cerrahi bu beklentiyi karşılayamaz. Gerçekçi çerçeve kurulmalı.",weight:9});

    if(a.prevSurgery==="Evet ve hiç memnun değilim")
      reasons.push({txt:"Önceki ameliyattan hiç memnun değil — beklenti çıtası çok yüksek gelecek. Önceki deneyimi dinleyin.",weight:9});
    else if(a.prevSurgery==="Evet ama beklentimi karşılamadı")
      reasons.push({txt:"Önceki ameliyat beklentisini karşılamadı — bu sefer neyin farklı olacağını somutlaştırın.",weight:8});

    if(highProcRisk)
      reasons.push({txt:`${a.procedure} karmaşık bir prosedür — iyileşme süreci ve sınırlamalar detaylı anlatılmalı.`,weight:7});

    // ── Ek klinik sinyaller — skora girmez ama doktora değerli ──
    if(bddRisk)
      reasons.push({txt:"Görünüm odağı günlük hayatı etkiliyor — BDD ön değerlendirmesi düşünülebilir.",weight:10});

    if(extMotiv && a.procedure==="Burun Estetiği")
      reasons.push({txt:"Burun estetiğinde dışsal motivasyon — sonuç memnuniyeti başkalarının tepkisine bağımlı kalabilir.",weight:6});
    else if(extMotiv)
      reasons.push({txt:"Motivasyon dışsal kaynaklı — kendi iç motivasyonunu netleştirmek önemli.",weight:5});

    if(rhinoRedFlag)
      reasons.push({txt:"Aklındaki ünlü referansı — kendi yüz yapısına uygunluk konuşulmalı.",weight:5});

    if(breastSymRedFlag)
      reasons.push({txt:"Küçük asimetri bile çok rahatsız ediyor — simetri sınırları açıklanmalı.",weight:5});

    if(storyRedFlag){
      const kw=redKeywords.find(k=>storyLower.includes(k));
      reasons.push({txt:`Açık anlatısında "${kw}" — beklenti düzeyine dikkat.`,weight:4});
    }

    if(score>=threshold && reasons.length===0)
      reasons.push({txt:`Risk profili ${score}/100 — kombinasyon randevusuzluk ile ilişkili.`,weight:3});

    reasons.sort((a,b)=>b.weight-a.weight);
    return reasons.slice(0,2).map(r=>r.txt).join(" · ");
  }

  // v6b çekirdek risk faktör sayısı (skora giren 4 feature'dan)
  const coreRiskFactors=[noRiskKnow, unrealistic, prevBad, highProcRisk].filter(Boolean).length;

  // Kırmızı — üst üçte bir veya ağır klinik sinyal
  if(score>=redLine||coreRiskFactors>=3||bddRisk){
    const reason=buildReason();
    return{cat:"red",label:"Öncelikli Değerlendirme",icon:"🔴",color:"#dc2626",bg:"#fef2f2",border:"#fecaca",textColor:"#991b1b",obs:"Genişletilmiş konsültasyon önerilir",obsBody:reason};
  }

  // Amber — orta üçte bir
  if(score>=amberLine||coreRiskFactors>=2||(bddRisk)||(extMotiv&&highExp)){
    const amberReasons=[];
    if(noRiskKnow||someRiskKnow) amberReasons.push("risk bilgisi eksik");
    if(unrealistic) amberReasons.push("kusursuz beklenti");
    if(prevBad) amberReasons.push("geçmiş kötü deneyim");
    if(highProcRisk) amberReasons.push("karmaşık prosedür");
    if(extMotiv) amberReasons.push("dışsal motivasyon");
    const amberStr=amberReasons.length>0?`${amberReasons.join(", ")} sinyali var. Konsültasyonda bu konuları açın.`:"Bazı sinyaller dikkat gerektiriyor — beklenti ve süreci konuşun.";
    return{cat:"amber",label:"Dikkatli Değerlendir",icon:"🟡",color:"#d97706",bg:"#fffbeb",border:"#fde68a",textColor:"#92400e",obs:"Bazı sinyaller dikkat gerektiriyor",obsBody:amberStr};
  }

  // Yeşil
  return{cat:"green",label:"Randevuya Hazır",icon:"🟢",color:"#059669",bg:"#ecfdf5",border:"#a7f3d0",textColor:"#047857",obs:"Profil uygun görünüyor",obsBody:"Gerçekçi beklenti ve süreç farkındalığı saptandı. Standart konsültasyon yeterli."};
}


/* ── Form soruları ──────────────────────────────────────────────────────────── */
/* core:true → v6b skorlama için gerekli, short modda gösterilir              */
/* core:false/undefined → sadece full modda gösterilir                         */
const QUESTIONS=[
  {id:"name",section:"Kişisel Bilgiler",label:"İsminiz ve Soyisminiz",type:"text",placeholder:"Ad Soyad",core:true},
  {id:"age",section:"Kişisel Bilgiler",label:"Kaç yaşındasınız?",type:"number",placeholder:"örn. 34",core:true},
  {id:"source",section:"Kişisel Bilgiler",label:"Bize nasıl ulaştınız?",type:"radio",options:["Instagram","Google / arama","Hasta tavsiyesi","Doktor / klinik tavsiyesi","Diğer sosyal medya (TikTok/YouTube)","Diğer"],core:true},
  {id:"gender",section:"Kişisel Bilgiler",label:"Cinsiyetiniz nedir?",type:"radio",options:["Kadın","Erkek","Belirtmek istemiyorum"]},
  {id:"procedure",section:"İşlem Bilgisi",label:"Hangi işlemi yaptırmak istiyorsunuz?",type:"radio",options:["Meme Küçültme","Meme Büyütme (Silikon Protez ile)","Meme Dikleştirme","Meme Asimetrisinin Giderilmesi","Meme Onarımı (Kanser sonrası)","Doğumsal Meme Anomalisinin Düzeltilmesi","Jinekomasti","Burun Estetiği","Yüz Germe","Kaş Kaldırma","Üst Göz Kapağı Estetiği","Alt Göz Kapağı Estetiği","Yanak Estetiği (Bişektomi)","Kepçe Kulak Tedavisi","Yüz Yağ Enjeksiyonu","Botoks Uygulaması","Dolgu Uygulaması","Göz Altı Işık Dolgusu","Nano Yağ Enjeksiyonu","Mezoterapi","Karın Germe","Liposuction","Uyluk veya Kol germe","Popo estetiği","Genital Estetik","Labioplasti","Lazer Epilasyon","Lazer Dövme Silme","Cilt Yenileme (Rejuvenasyon)","Karbon Peeling","Lazer Leke Tedavisi","Lazer Saç Tedavisi"],core:true},

  /* ── Cross-sell sinyalleri ── */
  {id:"otherAreas",section:"İşlem Bilgisi",label:"Bunun dışında vücudunuzda rahatsız olduğunuz başka bir bölge var mı?",type:"radio",options:["Hayır, sadece bu bölge","Evet, 1-2 bölge daha var ama önceliğim bu","Evet, birkaç bölge var, hepsini konuşmak isterim","Henüz bilmiyorum, doktorun önerilerine açığım"]},

  /* ── Prosedüre özel sorular ── */
  {id:"rhinoVision",section:"İşlem Bilgisi",label:"Ameliyat sonucunu hayal ettiğinizde aklınızda ne var?",type:"radio",showIf:(a)=>a.procedure==="Burun Estetiği",options:["Doktorum benim yüz yapıma en uygun olanı belirlesin","Burnumda beni rahatsız eden belirli bir şeyi düzeltmek istiyorum","Aklımda net bir görünüm var, buna ulaşmak istiyorum","Aklımda belirli bir referans var — bir ünlü veya fotoğraf"]},

  {id:"breastSymmetry",section:"İşlem Bilgisi",label:"Şu an iki memeniz arasındaki farkı nasıl tarif edersiniz?",type:"radio",showIf:(a)=>["Meme Küçültme","Meme Dikleştirme","Meme Büyütme (Silikon Protez ile)","Meme Asimetrisinin Giderilmesi"].includes(a.procedure),options:["Fark var ama beni pek rahatsız etmiyor, ameliyatla düzelsin istiyorum","Belirgin bir fark var ve bu beni çok rahatsız ediyor","Çok küçük bir fark var ama bu küçük fark bile beni rahatsız ediyor","Fark olduğunu düşünmüyorum, sadece küçültmek/büyütmek istiyorum"]},
  {id:"motivation",section:"Motivasyon & Beklenti",label:"Bu kararı almanızda en belirleyici olan nedir?",type:"radio",options:["Kendim için daha iyi hissetmek istiyorum","Özgüvenimi artırmak istiyorum","Yakınlarımın yorumları etkili oldu","Hayatımın daha iyi gideceğini düşünüyorum"]},
  {id:"expectation",section:"Motivasyon & Beklenti",label:"İşlem sonucunda nasıl bir değişim bekliyorsunuz?",type:"radio",options:["Küçük, doğal bir iyileştirme yeterli","Dengeli ve orantılı bir sonuç bekliyorum","Belirgin bir fark olmasını istiyorum","Tamamen farklı bir görünüm istiyorum"]},
  {id:"bddScreen",section:"Motivasyon & Beklenti",label:"Görünümünüzle ilgili düşünceleriniz günlük yaşamınızı nasıl etkiliyor?",type:"radio",options:["Pek etkilemiyor, bazen düşünüyorum","Sıkça düşünüyorum ama hayatımı yönlendirmiyor","Günde saatlerce düşünüyorum, sosyal hayatımı etkiliyor","Tamamen ele geçirdi, kaçınma davranışlarım var"]},

  /* ── Karar Kalitesi ── */
  {id:"prevSurgery",section:"Klinik Geçmiş",label:"Daha önce estetik bir işlem yaptırdınız mı?",type:"radio",options:["Hayır","Evet ve memnunum","Evet ama beklentimi karşılamadı","Evet ve hiç memnun değilim"],core:true},
  {id:"multiDoctor",section:"Klinik Geçmiş",label:"Bu konuyu daha önce başka doktorlarla görüştünüz mü?",type:"radio",options:["Hayır","1-2 doktorla görüştüm","Birçok doktorla görüştüm"]},

  /* ── Süreç Farkındalığı ── */
  {id:"decisionDuration",section:"Süreç Farkındalığı",label:"Bu işlemi yaptırmayı ne zamandır düşünüyorsunuz ve şu an nasıl hissediyorsunuz?",type:"radio",options:[
    "Yeni karar verdim — heyecanlı ve kararlı hissediyorum",
    "Birkaç aydır düşünüyorum — hazır olduğumu hissediyorum",
    "1 yılı aşkın süredir düşünüyorum — artık harekete geçme zamanı",
    "Uzun süredir düşünüyorum ama hâlâ kararsız hissediyorum",
  ]},
  {id:"riskKnowledge",section:"Klinik Geçmiş",label:"Bu işlemin riskleri ve iyileşme süreci hakkında bilginiz ne düzeyde?",type:"radio",options:["Hiçbir bilgim yok","Genel olarak bilgi sahibiyim","Detaylı araştırdım ve biliyorum"],core:true},
  {id:"support",section:"Süreç Farkındalığı",label:"Yakın çevreniz bu kararınızı biliyor mu ve destekliyor mu?",type:"radio",options:["Evet, destekliyorlar","Biliyorlar ama kararsızlar","Karşılar","Kimseye söylemedim"]},
  {id:"revision",section:"Klinik Geçmiş",label:"Revizyon ihtimali olabileceğini biliyor musunuz?",type:"radio",options:["Evet, olası revizyonu normal karşılarım","Revizyon beni endişelendiriyor","Kusursuz sonuç bekliyorum"],core:true},


  /* ── Açık Uçlu ── */
  {id:"phone",section:"İletişim",label:"Telefon numaranız (randevu için)",type:"text",placeholder:"05XX XXX XX XX",optional:true},
  {id:"openStory",section:"Size Bir Sorum Var",label:"Bu işlemden sonra hayatınızda ne değişmesini istiyorsunuz? Kendi cümlelerinizle anlatır mısınız.",type:"text",placeholder:"İstediğiniz kadar az veya çok yazabilirsiniz...",optional:true},
];
const SECTIONS=[...new Set(QUESTIONS.map(q=>q.section))];


function exportCSV(records){
  const H=["Tarih","İsim","Yaş","Cinsiyet","İşlem","Kaynak","Motivasyon","Beklenti","Önceki İşlem","Çok Doktor","Risk Bilgisi","Sabır","Destek","Revizyon","Uyum","Fiyat","Paylaşım","Çapraz Satış","Sosyal Etki","Tavsiye","Sosyal Medya","Risk Skoru","Segment"];
  const R=records.map(p=>[p.date,p.answers?.name||"",p.answers?.age||"",p.answers?.gender||"",p.answers?.procedure||"",p.answers?.source||"",p.answers?.motivation||"",p.answers?.expectation||"",p.answers?.prevSurgery||"",p.answers?.multiDoctor||"",p.answers?.riskKnowledge||"",p.answers?.patience||"",p.answers?.support||"",p.answers?.revision||"",p.answers?.compliance||"",p.answers?.price||"",p.answers?.sharing||"",p.answers?.crossSell||"",p.answers?.socialInfluence||"",p.answers?.recommends||"",p.answers?.socialMedia||"",p.risk_score,p.segment]);
  const csv=[H,...R].map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"}));
  a.download=`SculptAI_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}

/* ─── SIDEBAR ────────────────────────────────────────────────────────────── */
function Sidebar({tab,setTab,onLogout,doctor}){
  const items=[
    {id:"patients",  label:"Hastalar",
     icon:(on)=><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={on?"#f8fafd":"rgba(255,255,255,0.35)"} strokeWidth="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>},
    {id:"analytics", label:"Analitik",
     icon:(on)=><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={on?"#f8fafd":"rgba(255,255,255,0.35)"} strokeWidth="1.5"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>},
    {id:"value",     label:"Kazanç",
     icon:(on)=><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={on?"#f8fafd":"rgba(255,255,255,0.35)"} strokeWidth="1.5"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>},
    {id:"settings",  label:"Ayarlar",
     icon:(on)=><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={on?"#f8fafd":"rgba(255,255,255,0.35)"} strokeWidth="1.5"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>},
  ];
  const initials=(doctor?.name||"DR").split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase();
  return(
    <aside style={{width:56,background:"#1e3a5f",display:"flex",flexDirection:"column",alignItems:"center",padding:"14px 0",gap:2,flexShrink:0,borderRight:"1px solid rgba(255,255,255,0.05)"}}>
      <div onClick={()=>setTab("patients")} title="SculptAI — Ana Sayfa"
        style={{width:32,height:32,background:"#1d4ed8",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",marginBottom:16,cursor:"pointer",flexShrink:0}}
        onMouseEnter={e=>e.currentTarget.style.background="#5c1f2a"}
        onMouseLeave={e=>e.currentTarget.style.background="#1d4ed8"}>
        <div style={{width:10,height:10,background:"#f8fafd",borderRadius:"50%",opacity:0.9}}/>
      </div>
      {items.map(({id,icon,label})=>{
        const active=tab===id;
        return(
          <div key={id} onClick={()=>setTab(id)} title={label}
            style={{width:40,height:40,borderRadius:9,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",position:"relative",
              background:active?"rgba(245,240,232,0.1)":"transparent",transition:"background 0.15s"}}
            onMouseEnter={e=>{if(!active)e.currentTarget.style.background="rgba(245,240,232,0.05)";}}
            onMouseLeave={e=>{if(!active)e.currentTarget.style.background="transparent";}}>
            {active&&<div style={{position:"absolute",left:0,top:"50%",transform:"translateY(-50%)",width:3,height:20,background:"#2d5a8e",borderRadius:"0 2px 2px 0"}}/>}
            {icon(active)}
          </div>
        );
      })}
      <div style={{flex:1}}/>
      {onLogout&&(
        <div onClick={onLogout} title="Çıkış Yap"
          style={{width:40,height:40,borderRadius:9,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",marginBottom:4,transition:"background 0.15s"}}
          onMouseEnter={e=>e.currentTarget.style.background="rgba(220,38,38,0.12)"}
          onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
        </div>
      )}
      <div title={doctor?.name||""} style={{width:32,height:32,borderRadius:"50%",background:"#2d5a8e",border:"1px solid rgba(255,255,255,0.1)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:500,color:"rgba(245,240,232,0.6)",marginBottom:4}}>
        {initials}
      </div>
    </aside>
  );
}


/* ─── DEMO HASTALARI — v6b uyumlu, satış paneli demo ─────────────────────── */
const DEMO_PATIENTS = [
  // 🔴 Kırmızı — dikkatli yaklaş (skor ≥60)
  {id:"demo-1",doctor_id:"demo",created_at:new Date(Date.now()-1*86400000).toISOString(),risk_score:72,
   answers:{name:"Elif Yılmaz",age:"28",gender:"Kadın",procedure:"Burun Estetiği",source:"Instagram",revision:"Kusursuz sonuç bekliyorum",riskKnowledge:"Hiçbir bilgim yok",prevSurgery:"Hayır"},
   outcome_procedures:[],no_appointment:false,model_source:"global_v6b"},
  {id:"demo-2",doctor_id:"demo",created_at:new Date(Date.now()-3*86400000).toISOString(),risk_score:65,
   answers:{name:"Mehmet Kara",age:"45",gender:"Erkek",procedure:"Karın Germe",source:"Google / arama",revision:"Kusursuz sonuç bekliyorum",riskKnowledge:"Hiçbir bilgim yok",prevSurgery:"Evet ama beklentimi karşılamadı"},
   outcome_procedures:[],no_appointment:true,model_source:"global_v6b"},

  // 🟡 Sarı — orta (skor 50-59)
  {id:"demo-3",doctor_id:"demo",created_at:new Date(Date.now()-2*86400000).toISOString(),risk_score:55,
   answers:{name:"Zeynep Aksoy",age:"31",gender:"Kadın",procedure:"Meme Büyütme (Silikon Protez ile)",source:"Hasta tavsiyesi",revision:"Revizyon beni endişelendiriyor",riskKnowledge:"Genel olarak bilgi sahibiyim",prevSurgery:"Hayır"},
   outcome_procedures:[],no_appointment:false,model_source:"global_v6b"},
  {id:"demo-4",doctor_id:"demo",created_at:new Date(Date.now()-5*86400000).toISOString(),risk_score:52,
   answers:{name:"Ayşe Demir",age:"34",gender:"Kadın",procedure:"Yüz Germe",source:"Doktor / klinik tavsiyesi",revision:"Revizyon beni endişelendiriyor",riskKnowledge:"Hiçbir bilgim yok",prevSurgery:"Hayır"},
   outcome_procedures:[],no_appointment:false,model_source:"global_v6b"},
  {id:"demo-5",doctor_id:"demo",created_at:new Date(Date.now()-4*86400000).toISOString(),risk_score:50,
   answers:{name:"Hakan Çelik",age:"38",gender:"Erkek",procedure:"Jinekomasti",source:"Google / arama",revision:"Evet, olası revizyonu normal karşılarım",riskKnowledge:"Hiçbir bilgim yok",prevSurgery:"Hayır"},
   outcome_procedures:["Jinekomasti"],no_appointment:false,had_procedure:true,model_source:"global_v6b"},

  // 🟢 Yeşil — yüksek potansiyel (skor <50)
  {id:"demo-6",doctor_id:"demo",created_at:new Date(Date.now()-6*86400000).toISOString(),risk_score:38,
   answers:{name:"Selin Öztürk",age:"41",gender:"Kadın",procedure:"Meme Dikleştirme",source:"Hasta tavsiyesi",revision:"Evet, olası revizyonu normal karşılarım",riskKnowledge:"Genel olarak bilgi sahibiyim",prevSurgery:"Evet ve memnunum"},
   outcome_procedures:["Meme Dikleştirme"],no_appointment:false,had_procedure:true,model_source:"global_v6b"},
  {id:"demo-7",doctor_id:"demo",created_at:new Date(Date.now()-7*86400000).toISOString(),risk_score:28,
   answers:{name:"Deniz Aydın",age:"36",gender:"Kadın",procedure:"Burun Estetiği",source:"Instagram",revision:"Evet, olası revizyonu normal karşılarım",riskKnowledge:"Detaylı araştırdım ve biliyorum",prevSurgery:"Hayır"},
   outcome_procedures:["Burun Estetiği"],no_appointment:false,had_procedure:true,model_source:"global_v6b"},
  {id:"demo-8",doctor_id:"demo",created_at:new Date(Date.now()-8*86400000).toISOString(),risk_score:22,
   answers:{name:"Burcu Şahin",age:"29",gender:"Kadın",procedure:"Meme Küçültme",source:"Hasta tavsiyesi",revision:"Evet, olası revizyonu normal karşılarım",riskKnowledge:"Detaylı araştırdım ve biliyorum",prevSurgery:"Hayır"},
   outcome_procedures:["Meme Küçültme"],no_appointment:false,had_procedure:true,model_source:"global_v6b"},
  {id:"demo-9",doctor_id:"demo",created_at:new Date(Date.now()-10*86400000).toISOString(),risk_score:18,
   answers:{name:"Ali Tekin",age:"52",gender:"Erkek",procedure:"Üst Göz Kapağı Estetiği",source:"Doktor / klinik tavsiyesi",revision:"Evet, olası revizyonu normal karşılarım",riskKnowledge:"Genel olarak bilgi sahibiyim",prevSurgery:"Hayır"},
   outcome_procedures:[],no_appointment:false,model_source:"global_v6b"},
  {id:"demo-10",doctor_id:"demo",created_at:new Date(Date.now()-4*86400000).toISOString(),risk_score:15,
   answers:{name:"Canan Korkmaz",age:"33",gender:"Kadın",procedure:"Botoks Uygulaması",source:"Instagram",revision:"Evet, olası revizyonu normal karşılarım",riskKnowledge:"Detaylı araştırdım ve biliyorum",prevSurgery:"Evet ve memnunum"},
   outcome_procedures:["Botoks"],no_appointment:false,had_procedure:true,model_source:"global_v6b"},
];

const DEMO_DOCTOR = {id:"demo",name:"Demo Kullanıcı",clinic_name:"Demo Klinik"};

/* ─── PATIENT CARD ───────────────────────────────────────────────────────── */
function PatientCard({patient,onDelete,isMobile,scoreBands}){
  const [open,setOpen]=useState(false);
  const [rendered,setRendered]=useState(false);
  const [cardError,setCardError]=useState(false);
  const [confirm,setConfirm]=useState(false);
  const [showOutcome,setShowOutcome]=useState(false);
  const [outcomeProcedures,setOutcomeProcedures]=useState(patient.outcome_procedures||[]);
  const [noAppointment,setNoAppointment]=useState(patient.no_appointment||false);
  const [hadProcedure,setHadProcedure]=useState(patient.had_procedure??null);
  const [procedureDate,setProcedureDate]=useState(patient.procedure_date||"");
  const [showProcedure,setShowProcedure]=useState(false);
  const [consultNote,setConsultNote]=useState(patient.consult_note||"");
  const [showConsultNote,setShowConsultNote]=useState(false);
  const a=patient.answers||{};
  const score=patient.risk_score||0;
  const cls=classify(score,a,scoreBands?.p67||V6B_THRESHOLD,scoreBands||null);

  const ALL_PROCS=["Burun Estetiği","Meme Küçültme","Meme Büyütme","Meme Dikleştirme","Karın Germe","Liposuction","Üst Göz Kapağı","Alt Göz Kapağı","Botoks","Dolgu","Kol Germe","Yüz Germe","Uyluk Germe","Popo Estetiği","Jinekomasti"];

  async function saveOutcome(){
    for(let attempt=0;attempt<3;attempt++){
      try{
        const {error}=await sb.from("patients").update({outcome_procedures:outcomeProcedures,no_appointment:false}).eq("id",patient.id);
        if(error) throw error;
        setNoAppointment(false);
        setShowOutcome(false);
        triggerRetrain(patient.doctor_id);
        return;
      }catch(e){
        if(attempt===2) alert("Kayıt güncellenemedi. İnternet bağlantınızı kontrol edip tekrar deneyin.");
        else await new Promise(r=>setTimeout(r,1000*(attempt+1)));
      }
    }
  }

  async function triggerRetrain(doctorId){
    try {
      const now = new Date();
      const ninetyDaysAgo = new Date(now.getTime() - 90*24*60*60*1000).toISOString();

      const [{ count: totalLabeled }, { count: negCount }, { count: recent }] = await Promise.all([
        // Toplam etiketli hasta
        sb.from("patients")
          .select("id", { count: "exact", head: true })
          .eq("doctor_id", doctorId)
          .or("no_appointment.eq.true,outcome_procedures.neq.[]"),
        // Toplam negatif
        sb.from("patients")
          .select("id", { count: "exact", head: true })
          .eq("doctor_id", doctorId)
          .eq("no_appointment", true),
        // Son 90 günde gelen toplam hasta
        sb.from("patients")
          .select("id", { count: "exact", head: true })
          .eq("doctor_id", doctorId)
          .gte("created_at", ninetyDaysAgo),
      ]);

      // Minimum negatif şartı
      if(!negCount || negCount < 15) return;

      // Klinik hızına göre dinamik eşik
      const monthlyRate = Math.round((recent || 0) / 3); // aylık hasta sayısı
      const retrainEvery =
        monthlyRate > 100 ? 60 :   // hızlı klinik — her 60 outcome
        monthlyRate > 30  ? 40 :   // orta klinik — her 40 outcome
                            25;    // yavaş klinik — her 25 outcome

      if(totalLabeled && totalLabeled % retrainEvery === 0){
        await sb.functions.invoke("auto-train", { body: { doctor_id: doctorId } });
        invalidateClinicModel(doctorId);
        console.log(`✓ Auto-train: ${totalLabeled} etiketli, ${negCount} negatif, eşik:${retrainEvery} (aylık~${monthlyRate})`);
      }
    } catch(e) { /* sessiz hata */ }
  }

  async function saveProcedure(){
    try{
      const {error}=await sb.from("patients").update({
        had_procedure: hadProcedure,
        procedure_date: procedureDate||null,
      }).eq("id",patient.id);
      if(error) throw error;
      setShowProcedure(false);
    }catch{alert("Kayıt güncellenemedi. Tekrar deneyin.");}
  }

  async function markNoAppointment(){
    for(let attempt=0;attempt<3;attempt++){
      try{
        const {error}=await sb.from("patients").update({no_appointment:true,outcome_procedures:[]}).eq("id",patient.id);
        if(error) throw error;
        setNoAppointment(true);
        setOutcomeProcedures([]);
        triggerRetrain(patient.doctor_id);
        return;
      }catch(e){
        if(attempt===2) alert("Kayıt güncellenemedi. Tekrar deneyin.");
        else await new Promise(r=>setTimeout(r,1000*(attempt+1)));
      }
    }
  }



  const formProc=a.procedure||"";
  const crossSellDetected=outcomeProcedures.length>0&&!outcomeProcedures.every(p=>p===formProc);

  function handleToggle(){
    if(!rendered){
      // Mobilde önce state'i set et, render'ı bir sonraki frame'e bırak
      requestAnimationFrame(()=>{
        setRendered(true);
        setOpen(true);
      });
    } else {
      setOpen(o=>!o);
    }
  }
  // ── Next Best Action — v6b feature'larına dayalı ──
  const nba=[];
  const noRiskKnow_c=a.riskKnowledge==="Hiçbir bilgim yok";
  const someRiskKnow_c=a.riskKnowledge==="Genel olarak bilgi sahibiyim";
  const unrealistic_c=a.revision==="Kusursuz sonuç bekliyorum";
  const revWorried_c=a.revision==="Revizyon beni endişelendiriyor";
  const prevBad_c=a.prevSurgery==="Evet ve hiç memnun değilim"||a.prevSurgery==="Evet ama beklentimi karşılamadı";
  const procRiskVal_c=PROC_RISK_MAP[a.procedure]??0.3;
  const highProcRisk_c=procRiskVal_c>=0.35;
  if(noRiskKnow_c) nba.push({icon:"📋",txt:"Bilgilendir — işlem hakkında bilgisi yok, süreç ve iyileşmeyi anlat"});
  else if(someRiskKnow_c&&score>=35) nba.push({icon:"📋",txt:"Bilgi eksiklerini tamamla — genel bilgisi var ama detaylar eksik"});
  if(unrealistic_c) nba.push({icon:"🎯",txt:"Beklenti yönet — kusursuz sonuç beklentisi var, doktoru erken devreye al"});
  else if(revWorried_c) nba.push({icon:"🤝",txt:"Güven ver — revizyon endişesi var, sürecin güvenliğini vurgula"});
  if(prevBad_c) nba.push({icon:"🏥",txt:"Güven inşa et — geçmişte kötü deneyim yaşamış, klinik farkını göster"});
  if(highProcRisk_c) nba.push({icon:"⭐",txt:"Uzmanlık vurgula — karmaşık prosedür, doktorun deneyimini ön plana çıkar"});
  if(nba.length===0) nba.push({icon:"✓",txt:"Standart takip — belirgin engel yok"});

  const approachLabel=cls.cat==="red"?"Dikkatli yaklaş":cls.cat==="amber"?"Orta":"Yüksek potansiyel";
  const approachColor=cls.cat==="red"?"#dc2626":cls.cat==="amber"?"#d97706":"#059669";
  const approachBg=cls.cat==="red"?"#fef2f2":cls.cat==="amber"?"#fffbeb":"#ecfdf5";
  const approachBorder=cls.cat==="red"?"#fecaca":cls.cat==="amber"?"#fde68a":"#a7f3d0";
  const pipelineStatus=noAppointment?"lost":outcomeProcedures.length>0?(hadProcedure===true?"converted":"appointment"):"new";
  const sourceLabel=a.source||"";
  const dateStr=patient.created_at?new Date(patient.created_at).toLocaleDateString("tr-TR",{day:"numeric",month:"short"}):"";

  return(
    <div onClick={handleToggle} style={{background:"#f8fafd",borderRadius:10,border:`1px solid ${open?"#1e3a5f":"#d4e1ef"}`,marginBottom:8,overflow:"hidden",cursor:"pointer",transition:"border-color 0.15s",WebkitTapHighlightColor:"transparent"}}>
      <div style={{display:"flex",alignItems:"center",gap:8,padding:"10px 12px",minWidth:0,overflow:"hidden"}}>
        {/* Approach accent */}
        <div style={{width:3,height:40,borderRadius:2,background:approachColor,flexShrink:0}}/>
        {/* Name + procedure + source */}
        <div style={{flex:1,minWidth:0,overflow:"hidden"}}>
          <div style={{fontFamily:"'Playfair Display',serif",fontSize:16,fontWeight:400,color:"#1e3a5f",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.name||"İsimsiz"}</div>
          <div style={{fontSize:12,color:"#7b9ab5",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.procedure}{sourceLabel?` · ${sourceLabel}`:""}</div>
          {/* Pipeline mini */}
          <div style={{display:"flex",gap:3,marginTop:3}}>
            {[{k:"new",l:"Y",done:true},{k:"appt",l:"R",done:pipelineStatus==="appointment"||pipelineStatus==="converted"},{k:"conv",l:"D",done:pipelineStatus==="converted"}].map(s=>(
              <div key={s.k} style={{width:15,height:15,borderRadius:3,fontSize:8,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",
                background:pipelineStatus==="lost"&&s.k!=="new"?"#fee2e2":s.done?"#059669":"#e2e8f0",
                color:pipelineStatus==="lost"&&s.k!=="new"?"#dc2626":s.done?"white":"#94a3b8"
              }}>{s.k==="new"&&pipelineStatus==="lost"?"✕":s.l}</div>
            ))}
          </div>
        </div>
        {/* Date + chevron */}
        <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4,flexShrink:0}}>
          <div style={{fontSize:11,color:"#7b9ab5",whiteSpace:"nowrap"}}>{dateStr}</div>
          <div style={{fontSize:14,color:"#7b9ab5",transform:open?"rotate(90deg)":"none",transition:"transform 0.2s"}}>›</div>
        </div>
      </div>
      {cardError&&<div style={{padding:12,fontSize:12,color:"#dc2626"}}>Detay yüklenemedi</div>}
      {rendered&&!cardError&&open&&(
        <div style={{borderTop:"1px solid #d4e1ef",animation:"fadeUp 0.18s ease"}}>
          {/* NBA — Next Best Action */}
          <div style={{padding:"12px 16px",background:"#f8fafd"}}>
            <div style={{fontSize:10,letterSpacing:"0.14em",textTransform:"uppercase",color:"#1e3a5f",marginBottom:8,fontWeight:600}}>Önerilen Aksiyon</div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {nba.map((n,i)=>(
                <div key={i} style={{display:"flex",gap:8,alignItems:"flex-start"}}>
                  <div style={{fontSize:14,flexShrink:0,marginTop:1}}>{n.icon}</div>
                  <div style={{fontSize:13,color:"#1e3a5f",lineHeight:1.55}}>{n.txt}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Pipeline — tek tıkla */}
          <div onClick={e=>e.stopPropagation()} style={{padding:"10px 16px",borderTop:"1px solid #d4e1ef",background:"#eef3f9"}}>
            <div style={{fontSize:10,letterSpacing:"0.14em",textTransform:"uppercase",color:"#7b9ab5",marginBottom:8,fontWeight:500}}>Pipeline</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              <button onClick={()=>{if(outcomeProcedures.length===0){setOutcomeProcedures([a.procedure||"İşlem"]);saveOutcome();}else setShowOutcome(v=>!v);}}
                style={{padding:"7px 14px",borderRadius:7,fontSize:12,fontWeight:500,border:`1.5px solid ${outcomeProcedures.length>0?"#059669":"#d4e1ef"}`,background:outcomeProcedures.length>0?"#059669":"white",color:outcomeProcedures.length>0?"white":"#7b9ab5",cursor:"pointer"}}>
                {outcomeProcedures.length>0?"✓ Randevu":"Randevu al"}
              </button>
              {outcomeProcedures.length>0&&(
                <button onClick={()=>{if(hadProcedure!==true){setHadProcedure(true);saveProcedure();}else setShowProcedure(v=>!v);}}
                  style={{padding:"7px 14px",borderRadius:7,fontSize:12,fontWeight:500,border:`1.5px solid ${hadProcedure===true?"#059669":"#d4e1ef"}`,background:hadProcedure===true?"#059669":"white",color:hadProcedure===true?"white":"#7b9ab5",cursor:"pointer"}}>
                  {hadProcedure===true?"✓ Dönüştü":"Dönüştür"}
                </button>
              )}
              {!noAppointment&&(
                <button onClick={async()=>{if(window.confirm("Kayıp olarak işaretlensin mi?"))await markNoAppointment();}}
                  style={{padding:"7px 14px",borderRadius:7,fontSize:12,fontWeight:500,border:"1.5px solid #fecaca",background:"white",color:"#dc2626",cursor:"pointer"}}>Kayıp</button>
              )}
              {noAppointment&&(
                <button onClick={async()=>{try{await sb.from("patients").update({no_appointment:false}).eq("id",patient.id);setNoAppointment(false);}catch{alert("Geri alma başarısız.");}}}
                  style={{padding:"7px 14px",borderRadius:7,fontSize:12,fontWeight:500,border:"1.5px solid #fecaca",background:"#fef2f2",color:"#dc2626",cursor:"pointer"}}>✕ Kayıp — Geri Al</button>
              )}
            </div>
          </div>


          {/* Detay butonları */}
          <div onClick={e=>e.stopPropagation()} style={{borderTop:"1px solid #d4e1ef",padding:"10px 16px",display:"flex",gap:7,background:"#f8fafd",flexWrap:"wrap"}}>
            {!confirm?<button onClick={e=>{e.stopPropagation();setConfirm(true);}} style={{padding:"8px 10px",borderRadius:7,fontSize:12,border:"1px solid #d4e1ef",background:"transparent",color:"#7b9ab5",cursor:"pointer"}}>Sil</button>
            :<button onClick={e=>{e.stopPropagation();onDelete(patient.id);}} style={{padding:"8px 10px",borderRadius:7,fontSize:12,border:"none",background:"#ef4444",color:"white",fontWeight:500,cursor:"pointer"}}>Emin misin?</button>}
          </div>
            {/* SEKRETER MODALI */}
            {showOutcome&&(
              <div onClick={e=>e.stopPropagation()} style={{borderTop:"1px solid #d4e1ef",padding:"16px",background:"#eef3f9"}}>
                <div style={{fontSize:11,letterSpacing:"0.12em",textTransform:"uppercase",color:"#7b9ab5",marginBottom:8}}>Randevu Sonucu — Hangi prosedürler planlandı?</div>
                <div style={{fontSize:13,color:"#7b9ab5",marginBottom:10}}>Form prosedürü: <strong style={{color:"#1e3a5f"}}>{formProc}</strong></div>
                <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:12}}>
                  {ALL_PROCS.map(p=>{
                    const sel=outcomeProcedures.includes(p);
                    return(
                      <button key={p} onClick={()=>setOutcomeProcedures(prev=>sel?prev.filter(x=>x!==p):[...prev,p])}
                        style={{padding:"5px 11px",borderRadius:20,fontSize:12,border:`1px solid ${sel?"#1e3a5f":"#d4e1ef"}`,background:sel?"#1e3a5f":"transparent",color:sel?"#f8fafd":"#7b9ab5",cursor:"pointer"}}>
                        {p}{p===formProc?" ✓":""}
                      </button>
                    );
                  })}
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={saveOutcome} style={{padding:"9px 20px",background:"#1e3a5f",border:"none",borderRadius:7,color:"#f8fafd",fontSize:13,fontWeight:500,cursor:"pointer"}}>Kaydet</button>
                  <button onClick={()=>setShowOutcome(false)} style={{padding:"9px 14px",background:"transparent",border:"1px solid #d4e1ef",borderRadius:7,color:"#7b9ab5",fontSize:13,cursor:"pointer"}}>İptal</button>
                </div>
              </div>
            )}

            {/* AMELİYAT OLDU MU? */}
            {showProcedure&&(
              <div onClick={e=>e.stopPropagation()} style={{borderTop:"1px solid #d4e1ef",padding:"16px",background:"#f0fdf4"}}>
                <div style={{fontSize:11,letterSpacing:"0.12em",textTransform:"uppercase",color:"#059669",marginBottom:12,fontWeight:500}}>Ameliyat Sonucu</div>
                <div style={{marginBottom:10}}>
                  <div style={{fontSize:12,color:"#7b9ab5",marginBottom:6}}>Ameliyat gerçekleşti mi?</div>
                  <div style={{display:"flex",gap:6}}>
                    {[["true","✓ Evet, ameliyat oldu"],["false","✗ Vazgeçti"]].map(([v,l])=>(
                      <button key={v} onClick={()=>setHadProcedure(v==="true")}
                        style={{padding:"7px 14px",borderRadius:20,fontSize:12,border:`1px solid ${String(hadProcedure)===v?"#059669":"#d4e1ef"}`,background:String(hadProcedure)===v?"#059669":"transparent",color:String(hadProcedure)===v?"white":"#7b9ab5",cursor:"pointer"}}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
                {hadProcedure===true&&(
                  <div style={{marginBottom:10}}>
                    <div style={{fontSize:12,color:"#7b9ab5",marginBottom:6}}>Ameliyat tarihi (isteğe bağlı)</div>
                    <input type="date" value={procedureDate} onChange={e=>setProcedureDate(e.target.value)}
                      style={{padding:"6px 10px",borderRadius:7,border:"1px solid #d4e1ef",fontSize:12,color:"#1e3a5f"}}/>
                  </div>
                )}
                <div style={{display:"flex",gap:8}}>
                  <button onClick={saveProcedure} style={{padding:"8px 18px",background:"#059669",border:"none",borderRadius:7,color:"white",fontSize:13,fontWeight:500,cursor:"pointer"}}>Kaydet</button>
                  <button onClick={()=>setShowProcedure(false)} style={{padding:"8px 14px",background:"transparent",border:"1px solid #d4e1ef",borderRadius:7,color:"#7b9ab5",fontSize:13,cursor:"pointer"}}>İptal</button>
                </div>
              </div>
            )}

        </div>
      )}
    </div>
  );
}

/* ─── CONSULTATION MODE ──────────────────────────────────────────────────── */
function ValueScreen({patients,doctor}){
  const total=patients.length;
  const labeled=patients.filter(p=>p.no_appointment===true||p.outcome_procedures?.length>0||p.had_procedure===true);
  const converted=patients.filter(p=>p.outcome_procedures?.length>0||p.had_procedure===true);
  const donusum=labeled.length>0?Math.round(converted.length/labeled.length*100):0;
  const noOutcome=total-labeled.length;
  const OUTCOME_THRESHOLD=25;

  // Segment dağılımı
  const scoreBands={p33:50,p67:60};
  const segCounts={red:0,amber:0,green:0};
  patients.forEach(p=>{const c=classify(p.risk_score||0,p.answers||{},scoreBands.p67,scoreBands);segCounts[c.cat]=(segCounts[c.cat]||0)+1;});

  // Kanal dağılımı
  const srcMap={};
  patients.forEach(p=>{const s=p.answers?.source||"Diğer";srcMap[s]=(srcMap[s]||0)+1;});
  const sources=Object.entries(srcMap).sort((a,b)=>b[1]-a[1]);

  // Prosedür dağılımı
  const procMap={};
  patients.forEach(p=>{const pr=p.answers?.procedure||"Diğer";procMap[pr]=(procMap[pr]||0)+1;});
  const procs=Object.entries(procMap).sort((a,b)=>b[1]-a[1]).slice(0,6);

  const C={border:"#d4e1ef",muted:"#7b9ab5",navy:"#1e3a5f"};
  const card={background:"#f8fafd",border:"1px solid #d4e1ef",borderRadius:12,padding:16};

  return(
    <div style={{flex:1,overflowY:"auto",padding:"24px 32px"}}>
      <div style={{marginBottom:24}}>
        <div style={{fontFamily:"'Playfair Display',serif",fontSize:34,fontWeight:300,color:C.navy,letterSpacing:"-0.01em",marginBottom:4}}>Klinik Özeti</div>
        <div style={{fontSize:13,color:C.muted}}>{total} lead · {labeled.length} sonuç girildi</div>
      </div>

      {/* DÖNÜŞÜM — ana metrik */}
      <div style={{...card,marginBottom:16,position:"relative",overflow:"hidden"}}>
        <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:"linear-gradient(90deg,#1e3a5f,#2d5a8e)"}}/>
        <div style={{display:"flex",alignItems:"center",gap:20}}>
          <div>
            <div style={{fontFamily:"'Playfair Display',serif",fontSize:48,fontWeight:300,color:C.navy,lineHeight:1}}>{labeled.length>0?`%${donusum}`:"—"}</div>
            <div style={{fontSize:12,color:C.muted,marginTop:4}}>Dönüşüm Oranı</div>
          </div>
          <div style={{fontSize:13,color:C.muted,lineHeight:1.6,flex:1}}>
            {labeled.length>0?`${converted.length} dönüşüm / ${labeled.length} sonuç girilmiş`:"Outcome girilince hesaplanır"}
          </div>
        </div>
      </div>

      {/* SEGMENT + KANAL */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
        <div style={card}>
          <div style={{fontSize:13,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase",color:"#2d5a8e",marginBottom:12}}>Segment Dağılımı</div>
          {[
            {label:"🟢 Yüksek potansiyel",count:segCounts.green,color:"#10b981"},
            {label:"🟡 Orta",count:segCounts.amber,color:"#f59e0b"},
            {label:"🔴 Dikkatli yaklaş",count:segCounts.red,color:"#ef4444"},
          ].map(s=>(
            <div key={s.label} style={{display:"flex",alignItems:"center",gap:8,marginBottom:7}}>
              <div style={{fontSize:13,color:"#2d5a8e",width:140,flexShrink:0}}>{s.label}</div>
              <div style={{flex:1,height:7,background:"#d4e1ef",borderRadius:4,overflow:"hidden"}}>
                <div style={{height:"100%",borderRadius:4,background:s.color,width:`${total?Math.round(s.count/total*100):0}%`}}/>
              </div>
              <div style={{fontSize:13,fontWeight:600,color:s.color,minWidth:22,textAlign:"right"}}>{s.count}</div>
              <div style={{fontSize:12,color:C.muted,minWidth:28,textAlign:"right"}}>{total?Math.round(s.count/total*100):0}%</div>
            </div>
          ))}
        </div>
        <div style={card}>
          <div style={{fontSize:13,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase",color:"#2d5a8e",marginBottom:12}}>Kanal Dağılımı</div>
          {sources.map(([src,cnt])=>(
            <div key={src} style={{display:"flex",alignItems:"center",gap:8,marginBottom:7}}>
              <div style={{flex:1,fontSize:13,color:"#2d5a8e",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{src}</div>
              <div style={{width:60,height:5,background:"#d4e1ef",borderRadius:3,overflow:"hidden",flexShrink:0}}>
                <div style={{height:"100%",borderRadius:3,background:C.navy,width:`${Math.round(cnt/(sources[0]?.[1]||1)*100)}%`}}/>
              </div>
              <div style={{fontSize:13,fontWeight:600,color:C.navy,minWidth:20,textAlign:"right"}}>{cnt}</div>
              <div style={{fontSize:12,color:C.muted,minWidth:28,textAlign:"right"}}>{Math.round(cnt/total*100)}%</div>
            </div>
          ))}
        </div>
      </div>

      {/* PROSEDÜRLER */}
      <div style={{...card,marginBottom:12}}>
        <div style={{fontSize:13,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase",color:"#2d5a8e",marginBottom:12}}>Prosedür Dağılımı</div>
        {procs.map(([name,count])=>(
          <div key={name} style={{display:"flex",alignItems:"center",gap:8,paddingBottom:7,borderBottom:"1px solid #eef3f9",marginBottom:7}}>
            <div style={{flex:1,fontSize:13,color:"#2d5a8e",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{name}</div>
            <div style={{width:70,height:5,background:"#d4e1ef",borderRadius:3,overflow:"hidden",flexShrink:0}}>
              <div style={{height:"100%",borderRadius:3,background:"linear-gradient(90deg,#1e3a5f,#2d5a8e)",width:`${Math.round(count/(procs[0]?.[1]||1)*100)}%`}}/>
            </div>
            <div style={{fontSize:13,fontWeight:600,color:C.navy,minWidth:20,textAlign:"right"}}>{count}</div>
            <div style={{fontSize:12,color:C.muted,minWidth:28,textAlign:"right"}}>{Math.round(count/total*100)}%</div>
          </div>
        ))}
      </div>

      {/* SEGMENT DOĞRULAMA — kilitli/açık */}
      <div style={{...card,marginBottom:12,background:labeled.length>=OUTCOME_THRESHOLD?"#f8fafd":"#fffbeb",border:labeled.length>=OUTCOME_THRESHOLD?"1px solid #d4e1ef":"1px solid #fde68a"}}>
        {labeled.length<OUTCOME_THRESHOLD?(
          <div style={{textAlign:"center",padding:"12px 0"}}>
            <div style={{fontSize:20,marginBottom:8}}>🔒</div>
            <div style={{fontSize:14,fontWeight:600,color:"#92400e",marginBottom:6}}>Segment Doğrulama</div>
            <div style={{fontSize:13,color:"#b45309",lineHeight:1.6,marginBottom:12}}>Sonuç işaretle ({labeled.length}/{OUTCOME_THRESHOLD}) — doğrulama için {OUTCOME_THRESHOLD-labeled.length} tane daha</div>
            <div style={{display:"inline-flex",background:"white",border:"1px solid #fde68a",borderRadius:8,padding:"8px 16px",gap:8,alignItems:"center"}}>
              <div style={{fontFamily:"'Playfair Display',serif",fontSize:28,color:"#d97706"}}>{labeled.length}</div>
              <div style={{fontSize:12,color:"#92400e",textAlign:"left"}}>/ {OUTCOME_THRESHOLD}<br/>sonuç girildi</div>
            </div>
          </div>
        ):(()=>{
          const segData={red:{total:0,conv:0},amber:{total:0,conv:0},green:{total:0,conv:0}};
          labeled.forEach(p=>{
            const c=classify(p.risk_score||0,p.answers||{},scoreBands.p67,scoreBands);
            const seg=segData[c.cat]||segData.green;
            seg.total++;
            if(!p.no_appointment) seg.conv++;
          });
          return(<>
            <div style={{fontSize:13,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase",color:"#2d5a8e",marginBottom:12}}>Segment Doğrulama <span style={{fontSize:11,color:C.muted,fontWeight:400}}>({labeled.length} sonuç)</span></div>
            <div style={{border:"1px solid #d4e1ef",borderRadius:8,overflow:"hidden"}}>
              <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr",background:"#eef3f9",padding:"8px 12px",fontSize:10,letterSpacing:"0.1em",textTransform:"uppercase",color:C.muted,fontWeight:600}}>
                <div>Segment</div><div style={{textAlign:"center"}}>Toplam</div><div style={{textAlign:"center"}}>Dönüştü</div><div style={{textAlign:"center"}}>Dönüşüm</div>
              </div>
              {[["green","🟢 Yüksek pot.","#059669"],["amber","🟡 Orta","#d97706"],["red","🔴 Dikkatli","#dc2626"]].map(([seg,label,color])=>{
                const d=segData[seg];
                if(d.total===0) return null;
                const rate=Math.round(d.conv/d.total*100);
                return(
                  <div key={seg} style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr",padding:"9px 12px",borderTop:"1px solid #eef3f9",fontSize:13}}>
                    <div style={{color,fontWeight:500}}>{label}</div>
                    <div style={{textAlign:"center",color:C.navy}}>{d.total}</div>
                    <div style={{textAlign:"center",color:"#059669"}}>{d.conv}</div>
                    <div style={{textAlign:"center",fontWeight:600,color:rate>=70?"#059669":rate>=50?"#d97706":"#dc2626"}}>%{rate}</div>
                  </div>
                );
              })}
            </div>
          </>);
        })()}
      </div>
    </div>
  );
}

/* ─── API KEYS & WEBHOOKS PANEL ──────────────────────────────────────────── */
function ApiKeysPanel({doctorId,cardS,C}){
  const [apiTab,setApiTab]=useState("keys"); // keys | webhooks
  const [keys,setKeys]=useState([]);
  const [hooks,setHooks]=useState([]);
  const [loading,setLoading]=useState(true);
  const [showCreate,setShowCreate]=useState(false);
  const [newKeyName,setNewKeyName]=useState("");
  const [newKeyEnv,setNewKeyEnv]=useState("live");
  const [createdKey,setCreatedKey]=useState(null);
  const [copied,setCopied]=useState(false);
  const [hookUrl,setHookUrl]=useState("");
  const [hookEvents,setHookEvents]=useState(["patient.created"]);
  const [hookSecret,setHookSecret]=useState("");
  const [showHookForm,setShowHookForm]=useState(false);

  async function loadKeys(){
    const {data}=await sb.from("api_keys").select("id,name,key_prefix,scopes,is_active,created_at,last_used_at,expires_at").eq("clinic_id",doctorId).order("created_at",{ascending:false});
    setKeys(data||[]);
  }
  async function loadHooks(){
    const {data}=await sb.from("webhooks").select("*").eq("clinic_id",doctorId).order("created_at",{ascending:false});
    setHooks(data||[]);
  }
  useState(()=>{Promise.all([loadKeys(),loadHooks()]).finally(()=>setLoading(false));},[]);

  async function createKey(){
    const raw=new Uint8Array(32);crypto.getRandomValues(raw);
    const chars="0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    let token="";for(const b of raw) token+=chars[b%62];
    const fullKey=`sk_${newKeyEnv}_${token}`;
    const prefix=fullKey.slice(0,12)+"...";
    const enc=new TextEncoder().encode(fullKey);
    const hashBuf=await crypto.subtle.digest("SHA-256",enc);
    const keyHash=Array.from(new Uint8Array(hashBuf)).map(b=>b.toString(16).padStart(2,"0")).join("");
    const {error}=await sb.from("api_keys").insert({
      id:crypto.randomUUID(),clinic_id:doctorId,name:newKeyName||"Unnamed Key",
      key_hash:keyHash,key_prefix:prefix,scopes:["all"],is_active:true,
      created_at:new Date().toISOString(),
    });
    if(!error){setCreatedKey(fullKey);setNewKeyName("");loadKeys();}
  }

  async function revokeKey(id){
    await sb.from("api_keys").update({is_active:false}).eq("id",id);
    loadKeys();
  }

  async function createHook(){
    if(!hookUrl) return;
    const {error}=await sb.from("webhooks").insert({
      id:crypto.randomUUID(),clinic_id:doctorId,url:hookUrl,events:hookEvents,
      secret:hookSecret||null,is_active:true,created_at:new Date().toISOString(),
    });
    if(!error){setHookUrl("");setHookSecret("");setShowHookForm(false);loadHooks();}
  }

  async function deleteHook(id){
    await sb.from("webhooks").delete().eq("id",id);
    loadHooks();
  }

  async function testHook(hook){
    try{
      await fetch(hook.url,{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({event:"test",data:{message:"SculptAI webhook test"},timestamp:Math.floor(Date.now()/1000).toString()})});
      alert("Test webhook gönderildi!");
    }catch(e){alert("Gönderim başarısız: "+e.message);}
  }

  const allEvents=["patient.created","patient.updated","outcome.created"];

  return(
    <div style={cardS}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <div style={{fontSize:11,letterSpacing:"0.14em",textTransform:"uppercase",color:C.muted,fontWeight:500}}>API & Webhooks</div>
        <a href="/api-docs.html" target="_blank" style={{fontSize:11,color:"#1d4ed8",textDecoration:"underline"}}>Dokümantasyon</a>
      </div>
      <div style={{display:"flex",gap:6,marginBottom:16}}>
        {[["keys","API Keys"],["webhooks","Webhooks"]].map(([v,l])=>(
          <button key={v} onClick={()=>setApiTab(v)} style={{padding:"5px 14px",borderRadius:7,border:`1px solid ${apiTab===v?"#1e3a5f":"#d4e1ef"}`,background:apiTab===v?"#1e3a5f":"transparent",color:apiTab===v?"#f8fafd":"#7b9ab5",fontSize:12,cursor:"pointer"}}>{l}</button>
        ))}
      </div>

      {apiTab==="keys"&&<>
        {createdKey&&(
          <div style={{background:"#f0fdf4",border:"1px solid #a7f3d0",borderRadius:8,padding:14,marginBottom:14}}>
            <div style={{fontSize:11,color:"#059669",fontWeight:600,marginBottom:6,textTransform:"uppercase",letterSpacing:"0.1em"}}>Key oluşturuldu — bu tek gösterim!</div>
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              <code style={{flex:1,fontSize:11,background:"#ecfdf5",padding:"6px 10px",borderRadius:5,wordBreak:"break-all",color:"#065f46",border:"1px solid #a7f3d0"}}>{createdKey}</code>
              <button onClick={()=>{navigator.clipboard?.writeText(createdKey);setCopied(true);setTimeout(()=>setCopied(false),2000);}} style={{padding:"6px 12px",border:"none",borderRadius:6,background:"#059669",color:"white",fontSize:11,cursor:"pointer",whiteSpace:"nowrap"}}>{copied?"✓ Kopyalandı":"Kopyala"}</button>
            </div>
            <button onClick={()=>setCreatedKey(null)} style={{marginTop:8,fontSize:11,color:"#7b9ab5",border:"none",background:"transparent",cursor:"pointer"}}>Kapat</button>
          </div>
        )}
        {!showCreate?
          <button onClick={()=>setShowCreate(true)} style={{padding:"8px 16px",border:"1px dashed #d4e1ef",borderRadius:8,background:"transparent",color:"#1e3a5f",fontSize:12,cursor:"pointer",width:"100%",marginBottom:14}}>+ Yeni API Key Oluştur</button>
        :(
          <div style={{background:"#f8fafd",border:"1px solid #d4e1ef",borderRadius:8,padding:14,marginBottom:14}}>
            <div style={{display:"flex",gap:8,marginBottom:10}}>
              <input value={newKeyName} onChange={e=>setNewKeyName(e.target.value)} placeholder="Key adı (örn. CRM Entegrasyonu)" style={{flex:1,padding:"8px 10px",border:"1px solid #d4e1ef",borderRadius:6,fontSize:12,outline:"none"}}/>
              <select value={newKeyEnv} onChange={e=>setNewKeyEnv(e.target.value)} style={{padding:"8px 10px",border:"1px solid #d4e1ef",borderRadius:6,fontSize:12,background:"white"}}>
                <option value="live">Live</option><option value="test">Test</option>
              </select>
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={createKey} style={{padding:"7px 16px",background:"#1e3a5f",border:"none",borderRadius:6,color:"white",fontSize:12,cursor:"pointer"}}>Oluştur</button>
              <button onClick={()=>setShowCreate(false)} style={{padding:"7px 16px",border:"1px solid #d4e1ef",borderRadius:6,background:"transparent",color:"#7b9ab5",fontSize:12,cursor:"pointer"}}>İptal</button>
            </div>
          </div>
        )}
        {loading?<div style={{fontSize:12,color:C.muted}}>Yükleniyor...</div>:
          keys.length===0?<div style={{fontSize:12,color:C.muted}}>Henüz API key oluşturulmamış.</div>:
          keys.map(k=>(
            <div key={k.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid #eef3f9"}}>
              <div>
                <div style={{fontSize:13,fontWeight:500,color:"#1e3a5f"}}>{k.name}</div>
                <div style={{fontSize:11,color:C.muted}}><code>{k.key_prefix}</code> · {k.is_active?<span style={{color:"#059669"}}>Aktif</span>:<span style={{color:"#dc2626"}}>İptal</span>} · {k.last_used_at?`Son: ${new Date(k.last_used_at).toLocaleDateString("tr")}`:"Hiç kullanılmadı"}</div>
              </div>
              {k.is_active&&<button onClick={()=>revokeKey(k.id)} style={{padding:"4px 10px",border:"1px solid #fecaca",borderRadius:5,background:"transparent",color:"#dc2626",fontSize:11,cursor:"pointer"}}>İptal Et</button>}
            </div>
          ))
        }
      </>}

      {apiTab==="webhooks"&&<>
        {!showHookForm?
          <button onClick={()=>setShowHookForm(true)} style={{padding:"8px 16px",border:"1px dashed #d4e1ef",borderRadius:8,background:"transparent",color:"#1e3a5f",fontSize:12,cursor:"pointer",width:"100%",marginBottom:14}}>+ Yeni Webhook Ekle</button>
        :(
          <div style={{background:"#f8fafd",border:"1px solid #d4e1ef",borderRadius:8,padding:14,marginBottom:14}}>
            <input value={hookUrl} onChange={e=>setHookUrl(e.target.value)} placeholder="https://example.com/webhook" style={{width:"100%",padding:"8px 10px",border:"1px solid #d4e1ef",borderRadius:6,fontSize:12,outline:"none",marginBottom:8}}/>
            <div style={{fontSize:11,color:C.muted,marginBottom:6}}>Events:</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>
              {allEvents.map(ev=>(
                <label key={ev} style={{display:"flex",alignItems:"center",gap:4,fontSize:11,cursor:"pointer"}}>
                  <input type="checkbox" checked={hookEvents.includes(ev)} onChange={e=>{
                    if(e.target.checked) setHookEvents(p=>[...p,ev]);
                    else setHookEvents(p=>p.filter(x=>x!==ev));
                  }}/>{ev}
                </label>
              ))}
            </div>
            <input value={hookSecret} onChange={e=>setHookSecret(e.target.value)} placeholder="HMAC secret (opsiyonel)" style={{width:"100%",padding:"8px 10px",border:"1px solid #d4e1ef",borderRadius:6,fontSize:12,outline:"none",marginBottom:10}}/>
            <div style={{display:"flex",gap:8}}>
              <button onClick={createHook} style={{padding:"7px 16px",background:"#1e3a5f",border:"none",borderRadius:6,color:"white",fontSize:12,cursor:"pointer"}}>Kaydet</button>
              <button onClick={()=>setShowHookForm(false)} style={{padding:"7px 16px",border:"1px solid #d4e1ef",borderRadius:6,background:"transparent",color:"#7b9ab5",fontSize:12,cursor:"pointer"}}>İptal</button>
            </div>
          </div>
        )}
        {hooks.length===0?<div style={{fontSize:12,color:C.muted}}>Henüz webhook eklenmemiş.</div>:
          hooks.map(h=>(
            <div key={h.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid #eef3f9"}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:12,color:"#1e3a5f",fontFamily:"monospace",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{h.url}</div>
                <div style={{fontSize:10,color:C.muted}}>{(h.events||[]).join(", ")}</div>
              </div>
              <div style={{display:"flex",gap:6,flexShrink:0}}>
                <button onClick={()=>testHook(h)} style={{padding:"4px 8px",border:"1px solid #d4e1ef",borderRadius:5,background:"transparent",color:"#1d4ed8",fontSize:10,cursor:"pointer"}}>Test</button>
                <button onClick={()=>deleteHook(h.id)} style={{padding:"4px 8px",border:"1px solid #fecaca",borderRadius:5,background:"transparent",color:"#dc2626",fontSize:10,cursor:"pointer"}}>Sil</button>
              </div>
            </div>
          ))
        }
      </>}
    </div>
  );
}

/* ─── SETTINGS SCREEN ────────────────────────────────────────────────────── */
function SettingsScreen({doctor,onLogout,newU,setNewU,newP,setNewP,newP2,setNewP2,pwErr,setPwErr,saveNewCreds,confirmClear,setConfirmClear,clearAll,clinicName,setClinicName,clinicSaved,saveClinicName,avgRevenue,setAvgRevenue}){
  const C={border:"#d4e1ef",muted:"#7b9ab5"};
  const cardS={background:"#eef3f9",border:"1px solid #d4e1ef",borderRadius:10,padding:"18px 20px",marginBottom:12};
  const [enabledProcs,setEnabledProcs]=useState(doctor.enabled_procedures||ALL_PROCEDURE_LIST);
  const [procsSaved,setProcsSaved]=useState(false);
  const [revSaved,setRevSaved]=useState(false);

  async function saveProcs(){
    try{
      await sb.from("doctors").update({enabled_procedures:enabledProcs}).eq("id",doctor.id);
      doctor.enabled_procedures=enabledProcs;
      setProcsSaved(true);setTimeout(()=>setProcsSaved(false),2500);
    }catch{alert("Prosedür listesi kaydedilemedi.");}
  }
  function toggleProc(proc){
    setEnabledProcs(prev=>prev.includes(proc)?prev.filter(p=>p!==proc):[...prev,proc]);
  }
  function toggleCategory(cat){
    const procs=ALL_PROCEDURES[cat];
    const allEnabled=procs.every(p=>enabledProcs.includes(p));
    if(allEnabled) setEnabledProcs(prev=>prev.filter(p=>!procs.includes(p)));
    else setEnabledProcs(prev=>[...new Set([...prev,...procs])]);
  }
  return(
    <div style={{flex:1,overflowY:"auto",padding:"24px 32px",maxWidth:520}}>
      <div style={{fontFamily:"'Playfair Display',serif",fontSize:34,fontWeight:300,color:"#1e3a5f",marginBottom:24,letterSpacing:"-0.01em"}}>Ayarlar</div>

      {/* PROSEDÜR SEÇİMİ */}
      <div style={cardS}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <div>
            <div style={{fontSize:11,letterSpacing:"0.14em",textTransform:"uppercase",color:C.muted,fontWeight:500}}>Sunulan Prosedürler</div>
            <div style={{fontSize:12,color:C.muted,marginTop:2}}>Hasta formunda sadece seçili prosedürler gösterilir</div>
          </div>
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            {procsSaved&&<span style={{fontSize:11,color:"#059669"}}>✓ Kaydedildi</span>}
            <button onClick={saveProcs} style={{padding:"6px 14px",borderRadius:7,border:"none",background:"#1e3a5f",color:"#f8fafd",fontSize:12,cursor:"pointer",fontFamily:"'Nunito',sans-serif"}}>Kaydet</button>
          </div>
        </div>
        {Object.entries(ALL_PROCEDURES).map(([cat,procs])=>{
          const allOn=procs.every(p=>enabledProcs.includes(p));
          const someOn=procs.some(p=>enabledProcs.includes(p));
          return(
            <div key={cat} style={{marginBottom:10}}>
              <div onClick={()=>toggleCategory(cat)} style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",padding:"6px 0",borderBottom:"1px solid #d4e1ef"}}>
                <div style={{width:16,height:16,borderRadius:3,border:`1.5px solid ${allOn?"#059669":someOn?"#d97706":"#d4e1ef"}`,background:allOn?"#059669":someOn?"#d97706":"transparent",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:"white"}}>{allOn?"✓":someOn?"–":""}</div>
                <div style={{fontSize:12,fontWeight:600,color:"#1e3a5f"}}>{cat}</div>
                <div style={{fontSize:11,color:C.muted}}>({procs.filter(p=>enabledProcs.includes(p)).length}/{procs.length})</div>
              </div>
              <div style={{display:"flex",flexWrap:"wrap",gap:6,padding:"8px 0 4px 24px"}}>
                {procs.map(proc=>(
                  <button key={proc} onClick={()=>toggleProc(proc)}
                    style={{padding:"4px 10px",borderRadius:16,fontSize:11,border:`1px solid ${enabledProcs.includes(proc)?"#059669":"#d4e1ef"}`,background:enabledProcs.includes(proc)?"#ecfdf5":"white",color:enabledProcs.includes(proc)?"#059669":"#7b9ab5",cursor:"pointer"}}>
                    {proc}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        <div style={{fontSize:11,color:C.muted,marginTop:6}}>{enabledProcs.length} prosedür seçili — hasta formunda bu prosedürler gösterilecek</div>
      </div>

      <div style={{fontFamily:"'Playfair Display',serif",fontSize:34,fontWeight:300,color:"#1e3a5f",marginBottom:24,letterSpacing:"-0.01em"}}></div>
      <div style={cardS}>
        <div style={{fontSize:11,letterSpacing:"0.14em",textTransform:"uppercase",color:C.muted,marginBottom:12,fontWeight:500}}>Klinik Bilgileri</div>
        {[["Doktor",doctor.name],["Kullanıcı Adı",doctor.username]].map(([lbl,val])=>(
          <div key={lbl} style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid #d4e1ef"}}>
            <div style={{fontSize:13,color:C.muted}}>{lbl}</div>
            <div style={{fontSize:13,color:"#1e3a5f",fontWeight:500}}>{val}</div>
          </div>
        ))}
        {/* Düzenlenebilir klinik adı */}
        <div style={{padding:"10px 0",borderBottom:"1px solid #d4e1ef"}}>
          <div style={{fontSize:11,letterSpacing:"0.12em",textTransform:"uppercase",color:C.muted,marginBottom:6}}>Klinik Adı</div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <input
              value={clinicName}
              onChange={e=>setClinicName(e.target.value)}
              onKeyDown={e=>e.key==="Enter"&&saveClinicName()}
              placeholder="Klinik adı girin..."
              style={{flex:1,padding:"8px 10px",background:"#f8fafd",border:"1px solid #d4e1ef",borderRadius:7,fontSize:13,color:"#1e3a5f",outline:"none"}}
            />
            <button onClick={saveClinicName} style={{padding:"8px 14px",background:"#1e3a5f",border:"none",borderRadius:7,color:"#f8fafd",fontSize:13,fontWeight:500,cursor:"pointer",whiteSpace:"nowrap"}}>
              {clinicSaved?"✓ Kaydedildi":"Kaydet"}
            </button>
          </div>
        </div>
        {/* Ortalama İşlem Geliri */}
        <div style={{padding:"10px 0",borderBottom:"1px solid #d4e1ef"}}>
          <div style={{fontSize:11,letterSpacing:"0.12em",textTransform:"uppercase",color:C.muted,marginBottom:6}}>Ortalama İşlem Geliri (₺)</div>
          <div style={{fontSize:10,color:C.muted,marginBottom:6}}>Kayıp analizi hesaplamalarında kullanılır</div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <input
              type="number" value={avgRevenue}
              onChange={e=>setAvgRevenue(parseInt(e.target.value)||0)}
              placeholder="40000"
              style={{flex:1,padding:"8px 10px",background:"#f8fafd",border:"1px solid #d4e1ef",borderRadius:7,fontSize:13,color:"#1e3a5f",outline:"none"}}
            />
            <span style={{fontSize:12,color:C.muted,flexShrink:0}}>₺</span>
            <button onClick={async()=>{
              try{await sb.from("doctors").update({avg_revenue:avgRevenue}).eq("id",doctor.id);doctor.avg_revenue=avgRevenue;setRevSaved(true);setTimeout(()=>setRevSaved(false),2500);}catch{}
            }} style={{padding:"8px 14px",background:"#1e3a5f",border:"none",borderRadius:7,color:"#f8fafd",fontSize:13,fontWeight:500,cursor:"pointer",whiteSpace:"nowrap"}}>
              {revSaved?"✓ Kaydedildi":"Kaydet"}
            </button>
          </div>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",padding:"8px 0"}}>
          <div style={{fontSize:13,color:C.muted}}>Form Linki</div>
          <button onClick={()=>navigator.clipboard?.writeText(`${window.location.origin}/form/${doctor.id}`)} style={{fontSize:12,color:"#1d4ed8",border:"none",background:"transparent",cursor:"pointer",textDecoration:"underline"}}>Kopyala</button>
        </div>
      </div>
      <div style={cardS}>
        <div style={{fontSize:11,letterSpacing:"0.14em",textTransform:"uppercase",color:C.muted,marginBottom:12,fontWeight:500}}>Şifre Değiştir</div>
        {[["Yeni Kullanıcı Adı",newU,setNewU,"text"],["Yeni Şifre",newP,setNewP,"password"],["Şifre Tekrar",newP2,setNewP2,"password"]].map(([lbl,val,set,type])=>(
          <div key={lbl} style={{marginBottom:10}}>
            <div style={{fontSize:11,letterSpacing:"0.12em",textTransform:"uppercase",color:C.muted,marginBottom:5}}>{lbl}</div>
            <input type={type} value={val} onChange={e=>set(e.target.value)} style={{width:"100%",padding:"10px 12px",background:"#f8fafd",border:"1px solid #d4e1ef",borderRadius:7,fontSize:13,color:"#1e3a5f",outline:"none"}}/>
          </div>
        ))}
        {pwErr&&<div style={{fontSize:13,color:"#dc2626",marginBottom:8}}>{pwErr}</div>}
        <button onClick={saveNewCreds} style={{padding:"9px 20px",background:"#1e3a5f",border:"none",borderRadius:7,color:"#f8fafd",fontSize:13,fontWeight:500,cursor:"pointer",letterSpacing:"0.05em"}}>Kaydet</button>
      </div>
      {/* ── API & WEBHOOKS ── */}
      <ApiKeysPanel doctorId={doctor.id} cardS={cardS} C={C}/>

      <div style={{...cardS,border:"1px solid #fecaca"}}>
        <div style={{fontSize:11,letterSpacing:"0.14em",textTransform:"uppercase",color:"#dc2626",marginBottom:12,fontWeight:500}}>Tehlikeli Alan</div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
          <div style={{fontSize:13,color:C.muted}}>Tüm hasta verilerini sil</div>
          {!confirmClear
            ?<button onClick={()=>setConfirmClear(true)} style={{padding:"7px 14px",border:"1px solid #fecaca",borderRadius:7,fontSize:13,color:"#dc2626",background:"transparent",cursor:"pointer"}}>Verileri Temizle</button>
            :<div style={{display:"flex",gap:8}}>
              <button onClick={clearAll} style={{padding:"7px 14px",background:"#dc2626",border:"none",borderRadius:7,fontSize:13,color:"white",cursor:"pointer",fontWeight:500}}>Evet, sil</button>
              <button onClick={()=>setConfirmClear(false)} style={{padding:"7px 14px",border:"1px solid #d4e1ef",borderRadius:7,fontSize:13,color:C.muted,background:"transparent",cursor:"pointer"}}>İptal</button>
            </div>
          }
        </div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div style={{fontSize:13,color:C.muted}}>Oturumu kapat</div>
          <button onClick={onLogout} style={{padding:"7px 14px",border:"1px solid #d4e1ef",borderRadius:7,fontSize:13,color:C.muted,background:"transparent",cursor:"pointer"}}>Çıkış Yap</button>
        </div>
      </div>
    </div>
  );
}

/* ─── DOCTOR PANEL ───────────────────────────────────────────────────────── */
/* ─── SEKRETER GÖRÜNÜMÜ ──────────────────────────────────────────────────── */
function Analytics({patients,avgRevenue=40000}){
  const total=patients.length;
  if(total===0) return(
    <div style={{textAlign:"center",padding:"60px 20px",color:"#7b9ab5"}}>
      <div style={{fontSize:40,marginBottom:14}}>📊</div>
      <div style={{fontSize:16,color:"#2d5a8e",marginBottom:8}}>Henüz veri yok</div>
      <div style={{fontSize:13}}>İlk hasta formu doldurulunca istatistikler burada görünecek</div>
    </div>
  );

  // Segment — classify() ile tutarlı, scoreBands ile
  const scoreBands={p33:50,p67:60};
  const segCounts={red:0,amber:0,green:0};
  patients.forEach(p=>{
    const c=classify(p.risk_score||0,p.answers||{},scoreBands.p67,scoreBands);
    segCounts[c.cat]=(segCounts[c.cat]||0)+1;
  });
  const red=segCounts.red, amber=segCounts.amber, green=segCounts.green;
  const highPotRate=total?Math.round(green/total*100):0;

  // Outcome metrikleri
  const labeled=patients.filter(p=>p.no_appointment===true||p.outcome_procedures?.length>0||p.had_procedure===true);
  const withOutcome=patients.filter(p=>p.outcome_procedures?.length>0||p.had_procedure===true);
  const lostCount=patients.filter(p=>p.no_appointment).length;
  const noOutcome=total-labeled.length;
  const OUTCOME_THRESHOLD=25;

  // Prosedür
  const procMap={};
  patients.forEach(p=>{const pr=p.answers?.procedure||"Diğer";procMap[pr]=(procMap[pr]||0)+1;});
  const procs=Object.entries(procMap).sort((a,b)=>b[1]-a[1]).slice(0,6);

  // Kaynak
  const srcMap={};
  patients.forEach(p=>{
    const s=p.answers?.source||"Diğer";
    srcMap[s]=(srcMap[s]||0)+1;
  });
  const sources=Object.entries(srcMap).sort((a,b)=>b[1]-a[1]);

  // Son 7 gün
  const now=Date.now(), dayMs=86400000;
  const bins=Array(7).fill(0);
  patients.forEach(p=>{const d=now-(new Date(p.created_at||now).getTime());const idx=Math.floor(d/dayMs);if(idx>=0&&idx<7) bins[6-idx]++;});
  const maxBin=Math.max(...bins,1);
  const hasWeeklyData=bins.some(v=>v>0);
  const days=["Pzt","Sal","Çar","Per","Cum","Cmt","Paz"];
  const today=new Date().getDay();
  const dayLabels=Array(7).fill(0).map((_,i)=>days[(today-6+i+7)%7]);

  const C={card:"#f8fafd",border:"#f1f3f5",muted:"#7b9ab5",navy:"#1e3a5f"};
  const card=(extra={})=>({background:C.card,border:`1.5px solid ${C.border}`,borderRadius:12,padding:16,...extra});

  return(
    <div style={{padding:"20px 28px 24px",overflowY:"auto",flex:1}}>

      {/* OUTCOME CTA — eşik altındayken merkez mesaj */}
      {labeled.length<OUTCOME_THRESHOLD&&(
        <div style={{...card(),marginBottom:18,textAlign:"center",background:"#fffbeb",border:"1.5px solid #fde68a"}}>
          <div style={{fontSize:28,marginBottom:8}}>📋</div>
          <div style={{fontFamily:"'Playfair Display',serif",fontSize:20,color:"#92400e",marginBottom:8}}>Dönüşüm analitiğini açmak için outcome işaretleyin</div>
          <div style={{fontSize:14,color:"#b45309",lineHeight:1.6,marginBottom:12}}>Her hastanın randevu durumunu (dönüştü / kayıp) işaretledikçe sistem kalibre oluyor. Doğruluk tablosu {OUTCOME_THRESHOLD} sonuç girildiğinde açılacak.</div>
          <div style={{display:"inline-flex",alignItems:"center",gap:12,background:"white",border:"1px solid #fde68a",borderRadius:10,padding:"12px 20px"}}>
            <div style={{fontFamily:"'Playfair Display',serif",fontSize:36,color:labeled.length>=OUTCOME_THRESHOLD*0.6?"#059669":"#d97706",lineHeight:1}}>{labeled.length}</div>
            <div style={{textAlign:"left"}}>
              <div style={{fontSize:13,fontWeight:600,color:"#92400e"}}>/ {OUTCOME_THRESHOLD} sonuç girildi</div>
              <div style={{fontSize:12,color:"#b45309"}}>{noOutcome} hasta outcome bekliyor</div>
            </div>
          </div>
        </div>
      )}

      {/* KPI ROW */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:10,marginBottom:18}}>
        {[
          {val:total,lbl:"Toplam Lead",color:"#1e3a5f",grad:"linear-gradient(90deg,#1e3a5f,#2d5a8e)"},
          {val:highPotRate+"%",lbl:"Yüksek Potansiyel",color:"#10b981",grad:"linear-gradient(90deg,#10b981,#2d5a8e)"},
          {val:red,lbl:"Dikkatli Yaklaş",color:"#ef4444",grad:"linear-gradient(90deg,#ef4444,#f97316)"},
          {val:labeled.length>0?Math.round(withOutcome.length/labeled.length*100)+"%":"—",lbl:"Dönüşüm Oranı",color:"#1d4ed8",grad:"linear-gradient(90deg,#1d4ed8,#2563eb)"},
        ].map(k=>(
          <div key={k.lbl} style={{...card(),position:"relative",overflow:"hidden"}}>
            <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:k.grad}}/>
            <div style={{fontFamily:"'Playfair Display',serif",fontSize:30,lineHeight:1,marginBottom:3,color:k.color}}>{k.val}</div>
            <div style={{fontSize:12,color:C.muted}}>{k.lbl}</div>
          </div>
        ))}
      </div>

      {/* SEGMENT + TREND / SOURCES */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>

        {/* Segment dist — dönüşüm potansiyeli dili */}
        <div style={card()}>
          <div style={{fontSize:13,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase",color:"#2d5a8e",marginBottom:12}}>Dönüşüm Potansiyeli</div>
          {[
            {label:"🟢 Yüksek potansiyel",count:green,color:"#10b981"},
            {label:"🟡 Orta",count:amber,color:"#f59e0b"},
            {label:"🔴 Dikkatli yaklaş",count:red,color:"#ef4444"},
          ].map(s=>(
            <div key={s.label} style={{display:"flex",alignItems:"center",gap:8,marginBottom:7}}>
              <div style={{fontSize:13,color:"#2d5a8e",width:140,flexShrink:0}}>{s.label}</div>
              <div style={{flex:1,height:7,background:"#d4e1ef",borderRadius:4,overflow:"hidden"}}>
                <div style={{height:"100%",borderRadius:4,background:s.color,width:`${total?Math.round(s.count/total*100):0}%`,transition:"width 0.8s ease"}}/>
              </div>
              <div style={{fontSize:13,fontWeight:600,color:s.color,minWidth:22,textAlign:"right"}}>{s.count}</div>
              <div style={{fontSize:12,color:C.muted,minWidth:28,textAlign:"right"}}>{total?Math.round(s.count/total*100):0}%</div>
            </div>
          ))}
          <div style={{display:"flex",height:8,borderRadius:4,overflow:"hidden",marginTop:8}}>
            {[{c:"#10b981",n:green},{c:"#f59e0b",n:amber},{c:"#ef4444",n:red}].map((s,i)=>(
              <div key={i} style={{flex:s.n,background:s.c,minWidth:s.n?2:0}}/>
            ))}
          </div>
        </div>

        {/* Kanal dağılımı */}
        <div style={card()}>
          <div style={{fontSize:13,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase",color:"#2d5a8e",marginBottom:12}}>Kanal Dağılımı</div>
          {sources.map(([src,cnt])=>(
            <div key={src} style={{display:"flex",alignItems:"center",gap:8,marginBottom:7}}>
              <div style={{flex:1,fontSize:13,color:"#2d5a8e",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{src}</div>
              <div style={{width:60,height:5,background:"#d4e1ef",borderRadius:3,overflow:"hidden",flexShrink:0}}>
                <div style={{height:"100%",borderRadius:3,background:"#1e3a5f",width:`${Math.round(cnt/sources[0][1]*100)}%`}}/>
              </div>
              <div style={{fontSize:13,fontWeight:600,color:C.navy,minWidth:20,textAlign:"right"}}>{cnt}</div>
              <div style={{fontSize:12,color:C.muted,minWidth:28,textAlign:"right"}}>{Math.round(cnt/total*100)}%</div>
            </div>
          ))}
        </div>
      </div>

      {/* PROSEDÜRLER + TREND */}
      <div style={{display:"grid",gridTemplateColumns:hasWeeklyData?"1fr 1fr":"1fr",gap:12,marginBottom:12}}>
        <div style={card()}>
          <div style={{fontSize:13,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase",color:"#2d5a8e",marginBottom:12}}>En Sık Prosedürler</div>
          {procs.map(([name,count])=>(
            <div key={name} style={{display:"flex",alignItems:"center",gap:8,paddingBottom:7,borderBottom:"1px solid #eef3f9",marginBottom:7}}>
              <div style={{flex:1,fontSize:13,color:"#2d5a8e",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{name}</div>
              <div style={{width:70,height:5,background:"#d4e1ef",borderRadius:3,overflow:"hidden",flexShrink:0}}>
                <div style={{height:"100%",borderRadius:3,background:"linear-gradient(90deg,#1e3a5f,#2d5a8e)",width:`${Math.round(count/procs[0][1]*100)}%`}}/>
              </div>
              <div style={{fontSize:13,fontWeight:600,color:C.navy,minWidth:20,textAlign:"right"}}>{count}</div>
              <div style={{fontSize:12,color:C.muted,minWidth:28,textAlign:"right"}}>{Math.round(count/total*100)}%</div>
            </div>
          ))}
        </div>
        {/* Son 7 gün — sadece veri varsa */}
        {hasWeeklyData&&(
          <div style={card()}>
            <div style={{fontSize:13,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase",color:"#2d5a8e",marginBottom:12}}>Son 7 Gün</div>
            <div style={{display:"flex",alignItems:"flex-end",gap:6,height:70,marginBottom:6}}>
              {bins.map((v,i)=>(
                <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
                  <div style={{fontSize:11,color:C.muted,fontWeight:500}}>{v||""}</div>
                  <div style={{width:"100%",borderRadius:4,background:v>0?"#1e3a5f":"#d4e1ef",height:`${Math.max(4,Math.round(v/maxBin*52))}px`,transition:"height 0.4s ease"}}/>
                </div>
              ))}
            </div>
            <div style={{display:"flex",gap:6}}>
              {dayLabels.map((d,i)=><div key={i} style={{flex:1,textAlign:"center",fontSize:11,color:C.muted}}>{d}</div>)}
            </div>
          </div>
        )}
      </div>

      {/* VERİMLİLİK REHBERLİĞİ */}
      {red>0&&green>0&&(
        <div style={{...card(),marginBottom:14,background:"#eff6ff",border:"1.5px solid #bfdbfe"}}>
          <div style={{fontSize:13,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase",color:"#1d4ed8",marginBottom:8}}>Zaman Yönetimi</div>
          <div style={{fontSize:13,color:"#1e40af",lineHeight:1.7}}>
            Lead'lerinizin %{highPotRate}'i yüksek potansiyelli — ekibinizin zamanını bu gruba yönlendirmek dönüşümü artırabilir. Kırmızı segmentteki {red} lead için standart takip yerine hazırlıklı yaklaşım (bilgilendirme, beklenti yönetimi) önerilir.
          </div>
        </div>
      )}

      {/* DOĞRULAMA TABLOSU — sadece yeterli outcome varsa */}
      {labeled.length>=OUTCOME_THRESHOLD&&(()=>{
        const segData={red:{total:0,noShow:0,came:0},amber:{total:0,noShow:0,came:0},green:{total:0,noShow:0,came:0}};
        labeled.forEach(p=>{
          const c=classify(p.risk_score||0,p.answers||{},scoreBands.p67,scoreBands);
          const seg=segData[c.cat]||segData.green;
          seg.total++;
          if(p.no_appointment) seg.noShow++;
          else seg.came++;
        });

        const segColors={red:"#dc2626",amber:"#d97706",green:"#059669"};
        const segLabels={red:"🔴 Dikkatli yaklaş",amber:"🟡 Orta",green:"🟢 Yüksek potansiyel"};

        return(
          <div style={card()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
              <div style={{fontSize:13,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase",color:"#2d5a8e"}}>Segment Doğrulama</div>
              <div style={{fontSize:12,color:C.muted}}>{labeled.length} sonuç girildi</div>
            </div>
            <div style={{border:"1px solid #d4e1ef",borderRadius:8,overflow:"hidden",overflowX:"auto"}}>
              <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr 1fr",background:"#eef3f9",minWidth:400,padding:"8px 12px",fontSize:10,letterSpacing:"0.1em",textTransform:"uppercase",color:C.muted,fontWeight:600}}>
                <div>Segment</div><div style={{textAlign:"center"}}>Toplam</div><div style={{textAlign:"center"}}>Dönüştü</div><div style={{textAlign:"center"}}>Kayıp</div><div style={{textAlign:"center"}}>Dönüşüm</div>
              </div>
              {["green","amber","red"].map(seg=>{
                const d=segData[seg];
                if(d.total===0) return null;
                const rate=d.total>0?Math.round(d.came/d.total*100):0;
                return(
                  <div key={seg} style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr 1fr",padding:"9px 12px",minWidth:400,borderTop:"1px solid #eef3f9",fontSize:13}}>
                    <div style={{color:segColors[seg],fontWeight:500}}>{segLabels[seg]}</div>
                    <div style={{textAlign:"center",color:C.navy}}>{d.total}</div>
                    <div style={{textAlign:"center",color:"#059669"}}>{d.came}</div>
                    <div style={{textAlign:"center",color:"#dc2626"}}>{d.noShow}</div>
                    <div style={{textAlign:"center",fontWeight:600,color:rate>=70?"#059669":rate>=50?"#d97706":"#dc2626"}}>%{rate}</div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

    </div>
  );
}

function DoctorPanel({doctor,onLogout,demoPatients}){
  const isDemo = !!demoPatients;
  const [patients,setPatients]=useState(demoPatients||[]);
  const [loading,setLoading]=useState(!isDemo);
  const [filter,setFilter]=useState("all");
  const [search,setSearch]=useState("");
  const [tab,setTab]=useState("patients"); // patients | analytics | value | settings
  const [isMobile,setIsMobile]=useState(window.innerWidth<768);
  const [mobileMenuOpen,setMobileMenuOpen]=useState(false);
  useEffect(()=>{
    const fn=()=>setIsMobile(window.innerWidth<768);
    window.addEventListener("resize",fn);
    return()=>window.removeEventListener("resize",fn);
  },[]);
  const [showPw,setShowPw]=useState(false);
  const [newU,setNewU]=useState("");const [newP,setNewP]=useState("");const [newP2,setNewP2]=useState("");const [pwErr,setPwErr]=useState("");
  const [confirmClear,setConfirmClear]=useState(false);
  const [clinicName,setClinicName]=useState(doctor.clinic_name||"");
  const [clinicSaved,setClinicSaved]=useState(false);
  const [avgRevenue,setAvgRevenue]=useState(doctor.avg_revenue||40000);
  const [sessionWarning,setSessionWarning]=useState(false);

  // Session timeout uyarısı — son 15 dakikada banner göster
  useEffect(()=>{
    if(isDemo) return;
    const checkSession=()=>{
      const loginTime=sessionStorage.getItem("sculpt_login_time");
      if(!loginTime) return;
      const elapsed=Date.now()-parseInt(loginTime);
      const maxMs=8*60*60*1000; // 8 saat
      const remaining=maxMs-elapsed;
      if(remaining<=0){
        onLogout(); // süre doldu
      } else if(remaining<=15*60*1000){
        setSessionWarning(true); // son 15 dk
      }
    };
    checkSession();
    const timer=setInterval(checkSession,60000); // her dk kontrol
    return()=>clearInterval(timer);
  },[]);

  useEffect(()=>{if(!isDemo) loadPatients();},[]);

  async function loadPatients(){
    if(isDemo){setLoading(false);return;}
    setLoading(true);
    try{
      const {data}=await sb.from("patients").select("*").eq("doctor_id",doctor.id).order("created_at",{ascending:false});
      if(data){
        const decrypted=await Promise.all(data.map(async p=>{
          try{
            if(p.answers?.name){
              const realName=await decryptName(p.answers.name,doctor.id);
              const realGender=p.answers.gender?await decryptName(p.answers.gender,doctor.id):(p.answers.gender||"");
              const realStory=p.answers.openStory?await decryptName(p.answers.openStory,doctor.id):(p.answers.openStory||"");
              return{...p,answers:{...p.answers,name:realName,gender:realGender,openStory:realStory}};
            }
            return p;
          }catch{return p;}
        }));
        setPatients(decrypted);
      }else{setPatients([]);}
    }catch{setPatients([]);}
    setLoading(false);
  }

  async function deletePatient(id){
    if(isDemo){setPatients(p=>p.filter(x=>x.id!==id));return;}
    try{await sb.from("patients").delete().eq("id",id);}catch{alert("Hasta silinemedi.");}
    setPatients(p=>p.filter(x=>x.id!==id));
  }

  async function clearAll(){
    if(isDemo){setPatients([]);setConfirmClear(false);return;}
    try{await sb.from("patients").delete().eq("doctor_id",doctor.id);}catch{alert("Veriler silinemedi.");}
    setPatients([]);setConfirmClear(false);
  }

  async function saveNewCreds(){
    if(isDemo){alert("Demo modunda kullanılamaz.");return;}
    if(!newU.trim()||!newP.trim()){setPwErr("Tüm alanları doldurun.");return;}
    if(newP!==newP2){setPwErr("Şifreler eşleşmiyor.");return;}
    if(newP.length<6){setPwErr("Şifre en az 6 karakter olmalı.");return;}
    // Supabase Auth şifre güncelle
    try{
      const {error:authErr}=await sb.auth.updateUser({
        email:`${newU.trim().toLowerCase()}@sculptai.health`,
        password:newP
      });
      if(authErr) console.warn("Auth update warning:",authErr.message);
    }catch(e){}
    // Doctor tablosunu da güncelle
    await sb.from("doctors").update({username:newU.trim().toLowerCase(),password_hash:"managed_by_auth"}).eq("id",doctor.id);
    setShowPw(false);setNewU("");setNewP("");setNewP2("");setPwErr("");
  }

  async function saveClinicName(){
    if(isDemo){alert("Demo modunda kullanılamaz.");return;}
    if(!clinicName.trim())return;
    await sb.from("doctors").update({clinic_name:clinicName.trim()}).eq("id",doctor.id);
    try{const saved=JSON.parse(sessionStorage.getItem("sculpt_doctor")||"{}");sessionStorage.setItem("sculpt_doctor",JSON.stringify({...saved,clinic_name:clinicName.trim()}));}catch{}
    setClinicSaved(true);setTimeout(()=>setClinicSaved(false),2500);
  }

  const today=new Date().toLocaleDateString("tr-TR",{weekday:"long",day:"numeric",month:"long",year:"numeric"});

  // Anlamlı KPI hesapları
  const total=patients.length;
  // Conversion-based bantlar — Hacettepe verisinden doğrulanmış doğal kırılma noktaları
  // Skor <50 → %84 conversion (yeşil), 50-59 → %44-57 (sarı), ≥60 → %33-40 (kırmızı)
  const scoreBands={p33:50, p67:60};
  const kritik=patients.filter(p=>{const c=classify(p.risk_score||0,p.answers||{},scoreBands.p67,scoreBands);return c.cat==="red";}).length;
  const randevuAlan=patients.filter(p=>p.outcome_procedures?.length>0).length;
  const donusum=total?Math.round(randevuAlan/total*100):0;
  const crossSell=patients.filter(p=>p.outcome_procedures?.length>0&&p.outcome_procedures.some(x=>x!==(p.answers?.procedure||""))).length;

  const displayed=(filter==="all"?patients:patients.filter(p=>{
    const cls=classify(p.risk_score||0,p.answers||{},scoreBands.p67,scoreBands);
    return cls.cat===filter;
  })).filter(p=>{
    if(!search.trim()) return true;
    const q=search.toLowerCase();
    const a=p.answers||{};
    return (a.name||"").toLowerCase().includes(q)||(a.procedure||"").toLowerCase().includes(q);
  });
  const clinical=displayed;

  return(
    <div style={{display:"flex",flexDirection:isMobile?"column":"row",height:"100vh",overflow:"hidden",fontFamily:"'Nunito',sans-serif"}}>

      {/* KONSÜLTASYOn MODU — overlay */}

      {/* SESSION TIMEOUT UYARISI */}
      {sessionWarning&&(
        <div style={{position:"fixed",top:0,left:0,right:0,zIndex:9998,background:"#dc2626",padding:"10px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",animation:"fadeUp 0.3s ease"}}>
          <div style={{display:"flex",alignItems:"center",gap:10,color:"white"}}>
            <span style={{fontSize:18}}>⏰</span>
            <span style={{fontSize:13,fontFamily:"'Nunito',sans-serif"}}>Oturumunuz 15 dakika içinde sona erecek. Kaydetmediğiniz değişiklikler kaybolabilir.</span>
          </div>
          <div style={{display:"flex",gap:8}}>
            <button onClick={()=>{sessionStorage.setItem("sculpt_login_time",String(Date.now()));setSessionWarning(false);}}
              style={{padding:"5px 14px",borderRadius:6,border:"1px solid rgba(255,255,255,0.5)",background:"transparent",color:"white",fontSize:12,cursor:"pointer",fontFamily:"'Nunito',sans-serif"}}>Süreyi Uzat</button>
            <button onClick={()=>setSessionWarning(false)}
              style={{padding:"5px 14px",borderRadius:6,border:"none",background:"rgba(255,255,255,0.2)",color:"white",fontSize:12,cursor:"pointer",fontFamily:"'Nunito',sans-serif"}}>Kapat</button>
          </div>
        </div>
      )}

      {/* DESKTOP: Sol sidebar / MOBİL: Alt nav */}
      {!isMobile&&<Sidebar tab={tab} setTab={setTab} doctor={doctor} onLogout={onLogout}/>}

      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:"#f8fafd"}}>
        <div style={{padding:isMobile?"12px 16px":"14px 28px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0,background:"#f8fafd",borderBottom:"1px solid #d4e1ef"}} className="f1">
          {/* Logo + Karşılama */}
          <div style={{display:"flex",alignItems:"center",gap:isMobile?10:16}}>
            <div style={{display:"flex",alignItems:"center",gap:8,paddingRight:isMobile?10:16,borderRight:"1px solid #d4e1ef"}}>
              {/* SculptAI Wordmark — Option D */}
              <div style={{display:"flex",flexDirection:"column",alignItems:"flex-start",gap:2}}>
                <span style={{fontFamily:"'Playfair Display',serif",fontSize:17,fontWeight:400,color:"#1e3a5f",lineHeight:1,letterSpacing:"-0.02em"}}>SculptAI</span>
                <div style={{width:"100%",height:1,background:"linear-gradient(90deg,#1d4ed8,transparent)"}}/>
                <span style={{fontSize:8,letterSpacing:"0.22em",color:"#7b9ab5",textTransform:"uppercase"}}>Dönüşüm Zekası</span>
              </div>
            </div>
            <div>
              <div style={{fontFamily:"'Playfair Display',serif",fontSize:isMobile?17:22,color:"#1e3a5f",fontWeight:300,letterSpacing:"-0.01em"}}>Günaydın, <em>Dr. {doctor.name.split(" ").slice(-1)[0]}</em></div>
              {!isMobile&&<div style={{fontSize:12,color:"#7b9ab5",marginTop:1,letterSpacing:"0.03em"}}>{today}</div>}
            </div>
          </div>
          {/* Sağ butonlar */}
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <button onClick={()=>setTab("settings")} style={{padding:"6px 13px",borderRadius:7,fontSize:13,border:"1px solid #d4e1ef",background:"transparent",color:"#7b9ab5",letterSpacing:"0.03em"}}>Ayarlar</button>
            <div style={{width:32,height:32,borderRadius:"50%",background:"#1e3a5f",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:500,color:"#f8fafd",letterSpacing:"0.04em"}}>{doctor.name.split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase()}</div>
          </div>
        </div>

        {/* TAB NAV — Desktop */}
        {!isMobile&&<div style={{display:"flex",gap:0,padding:"0 28px",background:"#f8fafd",borderBottom:"1px solid #d4e1ef",flexShrink:0}}>
          {[["patients","Hastalar"],["analytics","Analitik"]].map(([v,l])=>(
            <button key={v} onClick={()=>setTab(v)} style={{padding:"11px 18px",fontSize:13,fontWeight:500,letterSpacing:"0.06em",border:"none",background:"transparent",color:tab===v?"#1e3a5f":"#7b9ab5",borderBottom:tab===v?"1px solid #1e3a5f":"1px solid transparent",cursor:"pointer",transition:"all 0.15s",textTransform:"uppercase"}}>{l}</button>
          ))}
        </div>}

        {tab==="analytics"&&<Analytics patients={patients} avgRevenue={avgRevenue}/>}
        {tab==="value"&&<ValueScreen patients={patients} doctor={doctor}/>}
        {tab==="settings"&&<SettingsScreen doctor={doctor} onLogout={onLogout} showPw={showPw} setShowPw={setShowPw} newU={newU} setNewU={setNewU} newP={newP} setNewP={setNewP} newP2={newP2} setNewP2={setNewP2} pwErr={pwErr} setPwErr={setPwErr} saveNewCreds={saveNewCreds} confirmClear={confirmClear} setConfirmClear={setConfirmClear} clearAll={clearAll} clinicName={clinicName} setClinicName={setClinicName} clinicSaved={clinicSaved} saveClinicName={saveClinicName} avgRevenue={avgRevenue} setAvgRevenue={setAvgRevenue}/>}
        {tab==="patients"&&<div style={{flex:1,overflowY:"auto",padding:isMobile?"12px 12px 24px":"20px 28px 24px"}}>
          {showPw&&(
            <div style={{background:"#f8fafd",border:"1px solid #d4e1ef",borderRadius:12,padding:"16px 20px",marginBottom:18,animation:"fadeUp 0.25s ease"}}>
              <div style={{fontSize:13,fontWeight:600,letterSpacing:"0.1em",textTransform:"uppercase",color:"#2d5a8e",marginBottom:12}}>Giriş Bilgilerini Değiştir</div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {[["Yeni kullanıcı adı",newU,setNewU,"text"],["Yeni şifre",newP,setNewP,"password"],["Şifre tekrar",newP2,setNewP2,"password"]].map(([ph,val,set,type])=>(
                  <input key={ph} type={type} placeholder={ph} value={val} onChange={e=>set(e.target.value)} style={{flex:1,minWidth:130,padding:"9px 12px",background:"#eef3f9",border:"1px solid #d4e1ef",borderRadius:9,color:"#1e3a5f",fontSize:14,outline:"none"}}/>
                ))}
                <button onClick={saveNewCreds} style={{padding:"9px 18px",background:"#1e3a5f",border:"none",borderRadius:9,color:"#f8fafd",fontSize:14,fontWeight:600}}>Kaydet</button>
              </div>
              {pwErr&&<div style={{fontSize:13,color:"#ef4444",marginTop:8}}>{pwErr}</div>}
            </div>
          )}

          {/* KPI */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:isMobile?8:12,marginBottom:isMobile?16:24}} className="f2">
            {[
              {val:total,label:"Toplam Lead",note:"Tüm kayıtlar",color:"#1e3a5f",accent:"#1d4ed8"},
              {val:randevuAlan>0?`%${donusum}`:"—",label:"Dönüşüm",note:randevuAlan>0?`${randevuAlan}/${total} randevu`:"Henüz outcome yok",color:donusum>=60?"#059669":donusum>=40?"#d97706":"#7b9ab5",accent:donusum>=60?"#059669":donusum>=40?"#d97706":"#7b9ab5"},
              {val:kritik,label:"Kritik Profil",note:kritik>0?`%${Math.round(kritik/total*100||0)} oranında`:"Belirgin risk yok",color:kritik>0?"#dc2626":"#059669",accent:kritik>0?"#dc2626":"#059669"},
            ].map(k=>(
              <div key={k.label} style={{background:"#f8fafd",border:"1px solid #d4e1ef",borderRadius:10,padding:isMobile?"12px 10px":"18px 20px",position:"relative",overflow:"hidden"}}>
                <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:k.accent}}/>
                <div style={{fontFamily:"'Playfair Display',serif",fontSize:isMobile?28:36,fontVariantNumeric:"lining-nums",lineHeight:1,marginBottom:3,color:k.color}}>{k.val}</div>
                <div style={{fontSize:isMobile?9:11,color:"#1e3a5f",fontWeight:500}}>{k.label}</div>
                <div style={{fontSize:isMobile?9:10,color:"#7b9ab5",marginTop:1}}>{k.note}</div>
              </div>
            ))}
          </div>

          {/* LIST HEADER */}
          <div style={{marginBottom:12}} className="f3">
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
              <div style={{fontSize:13,fontWeight:600,letterSpacing:"0.1em",textTransform:"uppercase",color:"#2d5a8e",flexShrink:0}}>Hasta Listesi</div>
              <div style={{position:"relative",flex:1,maxWidth:220}}>
                <input type="text" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Hasta veya işlem ara..."
                  style={{width:"100%",padding:"6px 12px 6px 30px",borderRadius:20,border:"1.5px solid #d4e1ef",background:"#f8fafd",fontSize:12,color:"#1e3a5f",outline:"none",fontFamily:"'Nunito',sans-serif"}}/>
                <span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",fontSize:13,color:"#7b9ab5",pointerEvents:"none"}}>⌕</span>
                {search&&<button onClick={()=>setSearch("")} style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",fontSize:13,color:"#7b9ab5",cursor:"pointer",padding:0,lineHeight:1}}>✕</button>}
              </div>
              <button onClick={loadPatients} style={{padding:"4px 10px",borderRadius:20,fontSize:11,border:"1px solid #d4e1ef",background:"#f8fafd",color:"#7b9ab5",flexShrink:0,cursor:"pointer"}}>↻</button>
              {!isMobile&&<button onClick={()=>exportCSV(patients)} style={{padding:"4px 10px",borderRadius:20,fontSize:11,border:"1px solid #d4e1ef",background:"#eef3f9",color:"#2563eb",flexShrink:0,cursor:"pointer"}}>📊 CSV</button>}
            </div>
            <div style={{display:"flex",gap:5,alignItems:"center",overflowX:"auto",WebkitOverflowScrolling:"touch",paddingBottom:2}}>
              {[["all","Tümü"],["red","🔴 Dikkat"],["amber","🟡 Orta"],["green","🟢 Uygun"]].map(([v,l])=>(
                <button key={v} onClick={()=>setFilter(v)} style={{padding:"4px 11px",borderRadius:20,fontSize:12,fontWeight:500,border:`1.5px solid ${filter===v?"#1e3a5f":"#d4e1ef"}`,background:filter===v?"#1e3a5f":"#f8fafd",color:filter===v?"#f8fafd":"#7b9ab5",transition:"all 0.15s",whiteSpace:"nowrap",flexShrink:0}}>{l}</button>
              ))}
              {isMobile&&<button onClick={()=>exportCSV(patients)} style={{padding:"4px 10px",borderRadius:20,fontSize:11,border:"1px solid #d4e1ef",background:"#eef3f9",color:"#2563eb",flexShrink:0,whiteSpace:"nowrap",cursor:"pointer"}}>CSV</button>}
            </div>
          </div>

          {loading&&<div style={{textAlign:"center",padding:"40px",color:"#7b9ab5"}}>Yükleniyor...</div>}

          {!loading&&clinical.length===0&&(
            <div style={{textAlign:"center",padding:"60px 20px",color:"#7b9ab5"}}>
              <div style={{fontSize:40,marginBottom:14}}>📋</div>
              <div style={{fontSize:16,color:"#2d5a8e",marginBottom:8}}>Henüz kayıt yok</div>
              <div style={{fontSize:13}}>Hastalar <strong>{window.location.origin}/form/{doctor.id}</strong> linkinden formu doldurunca burada görünecek</div>
            </div>
          )}

          {search.trim()&&(
            <div style={{fontSize:12,color:"#7b9ab5",marginBottom:8}}>"{search}" için {displayed.length} sonuç</div>
          )}
          <div className="f4">{clinical.map(p=><PatientCard key={p.id} patient={p} onDelete={deletePatient} isMobile={isMobile} scoreBands={scoreBands}/>)}</div>


          {patients.length>0&&(
            <div style={{marginTop:20,textAlign:"center"}}>
              {!confirmClear
                ?<button onClick={()=>setConfirmClear(true)} style={{padding:"6px 16px",background:"transparent",border:"1px solid rgba(239,68,68,0.2)",borderRadius:8,color:"rgba(239,68,68,0.5)",fontSize:11}}>Tüm kayıtları sil</button>
                :<div style={{display:"flex",gap:9,justifyContent:"center",alignItems:"center"}}>
                  <span style={{fontSize:13,color:"#ef4444"}}>Emin misiniz?</span>
                  <button onClick={clearAll} style={{padding:"6px 14px",background:"#ef4444",border:"none",borderRadius:8,color:"#f8fafd",fontSize:13,fontWeight:600}}>Evet</button>
                  <button onClick={()=>setConfirmClear(false)} style={{padding:"6px 14px",background:"#f8fafd",border:"1px solid #d4e1ef",borderRadius:8,color:"#7b9ab5",fontSize:12}}>İptal</button>
                </div>
              }
            </div>
          )}
        </div>}

        {/* MOBİL — Alt Navigasyon */}
        {isMobile&&(
          <div style={{display:"flex",borderTop:"1px solid #d4e1ef",background:"#f8fafd",flexShrink:0}}>
            {[
              {id:"patients",label:"Hastalar",icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>},
              {id:"analytics",label:"Analitik",icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>},
              {id:"settings",label:"Ayarlar",icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>},
            ].map(({id,label,icon})=>(
              <button key={id} onClick={()=>setTab(id)} style={{flex:1,padding:"10px 0 8px",border:"none",background:"transparent",display:"flex",flexDirection:"column",alignItems:"center",gap:3,cursor:"pointer",color:tab===id?"#1d4ed8":"#7b9ab5"}}>
                {icon}
                <span style={{fontSize:11,letterSpacing:"0.06em",textTransform:"uppercase",fontWeight:tab===id?500:400}}>{label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


/* ─── AKILLI CROSS-SELL ──────────────────────────────────────────────────── */
function getCrossSellSuggestion(a){
  const proc = a.procedure||"";
  const otherAreas = a.otherAreas||"";
  const otherConsidered = a.otherConsidered||"";
  const hasOtherInterest = !["Hayır, sadece bu bölge","Hayır"].includes(otherAreas) || otherConsidered.includes("Evet");

  // Prosedüre özel akıllı öneriler
  const map = {
    "Burun Estetiği": [
      {proc:"Çene dolgusu veya çene ucu estetiği", prob:65, reason:"Profil dengesi için tamamlayıcı"},
      {proc:"Botoks (alın veya kaş bölgesi)", prob:40, reason:"Yüz üst bölgesi uyumu"},
    ],
    "Meme Küçültme": [
      {proc:"Liposuction (bel veya karın)", prob:70, reason:"Vücut orantısı için sık tercih"},
      {proc:"Karın germe", prob:45, reason:"Özellikle doğum sonrası hastalarda"},
    ],
    "Meme Büyütme (Silikon Protez ile)": [
      {proc:"Meme dikleştirme (mastopexi)", prob:55, reason:"Şekil ve doluluk birlikte"},
      {proc:"Liposuction", prob:35, reason:"Vücut dengesi"},
    ],
    "Meme Dikleştirme": [
      {proc:"Meme büyütme (implant)", prob:60, reason:"Dikleştirme sonrası doluluk"},
      {proc:"Karın germe", prob:40, reason:"Anne estetiği paketi"},
    ],
    "Yüz Germe": [
      {proc:"Üst göz kapağı estetiği", prob:75, reason:"Yüz yenileme bütünlüğü için"},
      {proc:"Boyun germe veya dolgu", prob:50, reason:"Yüz-boyun orantısı"},
    ],
    "Karın Germe": [
      {proc:"Liposuction (bel veya kalça)", prob:65, reason:"Karın estetiği ile sıkça kombine"},
      {proc:"Meme dikleştirme", prob:45, reason:"Anne estetiği paketi"},
    ],
    "Üst Göz Kapağı Estetiği": [
      {proc:"Alt göz kapağı estetiği", prob:70, reason:"Göz yenileme bütünlüğü"},
      {proc:"Kaş kaldırma veya botoks", prob:50, reason:"Üst yüz uyumu"},
    ],
    "Alt Göz Kapağı Estetiği": [
      {proc:"Üst göz kapağı estetiği", prob:75, reason:"Göz yenileme bütünlüğü"},
      {proc:"Dolgu (göz altı)", prob:55, reason:"Hacim ve şekil birlikte"},
    ],
    "Liposuction": [
      {proc:"Karın germe", prob:50, reason:"Cilt gevşekliği varsa tamamlayıcı"},
      {proc:"Vaser liposuction (detay şekillendirme)", prob:45, reason:"Daha ince sonuç için"},
    ],
    "Jinekomasti": [
      {proc:"Liposuction (karın veya bel)", prob:55, reason:"Vücut orantısı için sık tercih"},
    ],
    // Lazer tedavi cross-sell
    "Lazer Epilasyon": [
      {proc:"Cilt yenileme (rejuvenasyon)", prob:50, reason:"Lazer sonrası cilt bakımı bütünlüğü"},
      {proc:"Karbon peeling", prob:45, reason:"Gözenek temizliği ve cilt tonu"},
    ],
    "Lazer Dövme Silme": [
      {proc:"Lazer leke tedavisi", prob:40, reason:"Dövme sonrası iz ve leke düzeltme"},
      {proc:"Cilt yenileme (rejuvenasyon)", prob:35, reason:"Dövme bölgesinde cilt kalitesi"},
    ],
    "Cilt Yenileme (Rejuvenasyon)": [
      {proc:"Karbon peeling", prob:60, reason:"Bakım rutini olarak birlikte etkili"},
      {proc:"Lazer leke tedavisi", prob:50, reason:"Ton eşitliği için tamamlayıcı"},
      {proc:"Botoks", prob:40, reason:"Kırışıklık azaltma bütünlüğü"},
    ],
    "Karbon Peeling": [
      {proc:"Cilt yenileme (rejuvenasyon)", prob:55, reason:"Derin cilt bakımı için tamamlayıcı"},
      {proc:"Lazer leke tedavisi", prob:40, reason:"Ton eşitsizliği varsa"},
    ],
    "Lazer Leke Tedavisi": [
      {proc:"Cilt yenileme (rejuvenasyon)", prob:55, reason:"Genel cilt kalitesi iyileştirme"},
      {proc:"Karbon peeling", prob:45, reason:"Bakım rutinine ekleme"},
    ],
  };

  const suggestions = map[proc] || [];

  // Ek bölge ilgisi varsa ihtimali artır
  if(hasOtherInterest && suggestions.length > 0){
    return suggestions.map(s => ({...s, prob: Math.min(95, s.prob + 15)}));
  }
  return suggestions;
}

/* ─── PATIENT FORM ───────────────────────────────────────────────────────── */
/* ─── KİŞİLİK PROFİLİ ───────────────────────────────────────────────────── */
function detectProfile(answers){
  const knowledge=answers.riskKnowledge||"";
  const motivation=answers.motivation||"";
  const sharing=answers.sharing||"";
  const recommends=answers.recommends||"";
  const patience=answers.patience||"";

  const isAnalyst=knowledge.includes("Detaylı")&&(motivation.includes("iyileştirmek")||motivation.includes("özgüven"));
  const isSocial=false; // soru kaldırıldı
  const isPragmatic=false; // soru kaldırıldı
  const isTrustSeeker=knowledge.includes("Hiçbir")||knowledge.includes("Genel");

  if(isAnalyst) return "analyst";
  if(isPragmatic) return "pragmatic";
  return "trustseeker";
}

const PROFILE_CONTENT={
  analyst:{
    welcome:"Araştırmanız bize de gösteriyor. Aşağıdaki bilgiler klinik verilerle desteklenmiştir — konsültasyonda detayları doktorunuzla birlikte değerlendirebilirsiniz.",
    recoveryIntro:"İyileşme süreci, kullanılan teknik ve yapısal faktörlere göre değişkenlik gösterir. Aşağıda aşama aşama ne bekleyebileceğinizi bulabilirsiniz.",
    riskIntro:"Her cerrahi girişimde görülme sıklığı istatistiksel olarak düşük olan riskler mevcuttur. Bunları bilmek, süreçte daha bilinçli kararlar almanızı sağlar.",
    ambassadorMsg:"Veriye dayalı bir karar aldınız. Çevrenizde benzer titizlikle araştırma yapan biri varsa, SculptAI değerlendirme formunu önererek doğru kanaldan başlamalarına yardımcı olabilirsiniz.",
    ambassadorCTA:"Araştırmacı birine önerin",
  },
  trustseeker:{
    welcome:"Bu kararı vermek cesaret ister. Sorularınız, endişeleriniz, hatta bilmediğinizi düşündüğünüz şeyler — konsültasyonun tam da bunlar için olduğunu bilmenizi isteriz.",
    recoveryIntro:"İyileşme süreci adım adım ilerler. Her aşamada ne hissedeceğinizi ve ne yapmanız gerektiğini önceden bilmek süreci çok kolaylaştırır.",
    riskIntro:"Her ameliyatta bazı beklenmedik durumlar yaşanabilir — ama bunların büyük çoğunluğu geçicidir ve tedavi edilebilir. Doktorunuz her adımda yanınızda olacak.",
    ambassadorMsg:"Çevrenizdeki biri bu kararı vermeye çalışıyorsa, deneyiminizi paylaşmak ona büyük destek olabilir. Referans kodunuzla gelen her kişi için size özel bir teşekkür hazırladık.",
    ambassadorCTA:"Desteğe ihtiyacı olana önerin",
  },
  social:{
    welcome:"Çevrenizde estetik kararlarda başvurulan biri olduğunuzu görüyoruz. Bu deneyimi yaşarken yakın çevrenizi de doğru yönlendirme fırsatınız olacak.",
    recoveryIntro:"Süreçte nasıl görüneceğinizi ve ne zaman sosyal hayata döneceğinizi merak ediyorsanız — aşağıdaki takvim tam size göre.",
    riskIntro:"Süreç hakkında çevrenizle konuşurken doğru bilgiye sahip olmak önemli. İşte bilmeniz ve paylaşabilmeniz gerekenler.",
    ambassadorMsg:"Marka Elçisi programımıza hoş geldiniz. Kodunuzu paylaştığınızda getirdiğiniz her hasta için VIP konsültasyon önceliği, özel kontrol muayenesi ve klinik avantajları kazanırsınız.",
    ambassadorCTA:"Özel avantajları görün",
  },
  pragmatic:{
    welcome:"Süreç net ve öngörülebilir. İşte bilmeniz gereken her şey — kısa ve öz.",
    recoveryIntro:"Takvim: ne zaman ne olur, ne zaman işe dönersiniz.",
    riskIntro:"Dikkat etmeniz gereken 3 durum:",
    ambassadorMsg:"Referans kodunuzu paylaşırsanız getirdiğiniz kişi başına avantaj kazanırsınız.",
    ambassadorCTA:"Hızlıca paylaşın",
  },
};

const EN_PROFILE_CONTENT={
  analyst:{
    welcome:"Your research shows. The information below is supported by clinical data — you can discuss the details with your doctor during your consultation.",
    recoveryIntro:"The recovery process varies depending on the technique used and structural factors. Below you'll find what to expect at each stage.",
    riskIntro:"Every surgical procedure carries statistically low-frequency risks. Knowing them helps you make more informed decisions throughout the process.",
    ambassadorMsg:"You made a data-driven decision. If someone in your circle researches with similar thoroughness, recommending the SculptAI assessment form can help them start through the right channel.",
    ambassadorCTA:"Recommend to a researcher",
  },
  trustseeker:{
    welcome:"Making this decision takes courage. Your questions, concerns, even things you think you don't know — we want you to know that's exactly what the consultation is for.",
    recoveryIntro:"The recovery process progresses step by step. Knowing what you'll feel and what to do at each stage makes the process much easier.",
    riskIntro:"Some unexpected situations can occur with any surgery — but the vast majority are temporary and treatable. Your doctor will be with you every step of the way.",
    ambassadorMsg:"If someone in your life is trying to make this decision, sharing your experience can be a great support. We've prepared a special thank-you for each person who comes with your referral code.",
    ambassadorCTA:"Recommend to someone who needs support",
  },
  social:{
    welcome:"We see that you're someone people in your circle turn to for aesthetic decisions. As you go through this experience, you'll have the opportunity to guide those close to you.",
    recoveryIntro:"If you're wondering how you'll look during the process and when you'll return to social life — the timeline below is made for you.",
    riskIntro:"Having accurate information when talking about the process with your circle is important. Here's what you need to know and can share.",
    ambassadorMsg:"Welcome to our Brand Ambassador program. When you share your code, you earn VIP consultation priority, special follow-up appointments, and clinic benefits for each patient you bring.",
    ambassadorCTA:"See exclusive benefits",
  },
  pragmatic:{
    welcome:"The process is clear and predictable. Here's everything you need to know — short and sweet.",
    recoveryIntro:"Timeline: when what happens, when you return to work.",
    riskIntro:"3 situations to watch for:",
    ambassadorMsg:"Share your referral code and earn benefits for each person you refer.",
    ambassadorCTA:"Share quickly",
  },
};

const PROCEDURE_RECOVERY={
  "Burun Estetiği":{
    analyst:{
      recovery:"Ameliyat 1,5-2 saat sürer. Postoperatif dönemde termoplastik atel ve nazal tampon uygulanır; tamponlar 24-48 saat içinde, atel 7-14. günde çıkarılır. İlk 48 saatte supine pozisyondan kaçınılmalı, soğuk kompres ödemi minimize eder. 3. günden itibaren ekimoz geriler. Dorsal ödem 6-12 ay içinde tamamen çözülür; nihai sonuç için bu süreyi hesaba katmak gerekir.",
      risks:"Erken dönem: nazal sızıntı (ilk 24-48 saat normaldir), bulantı, tampon hissi (geçici). Geç dönem: %5-10 revizyon ihtimali (yapısal sınırlamalar nedeniyle), nadir solunum değişiklikleri. Enfeksiyon oranı antibiyotik profilaksisi ile belirgin şekilde düşüktür.",
    },
    trustseeker:{
      recovery:"Ameliyattan uyandığınızda burnunuzda atel ve tampon olacak — bu çok normal. Tamponlar genellikle 1-2. günde alınır, rahatlamış hissedersiniz. İlk 3 gün en zor dönem ama ağrı kesicilerle geçer. 3. günden itibaren şişlik hızla azalmaya başlar, 1-2. haftada atel çıkar ve burunun genel şeklini görmeye başlarsınız. Son halini görmek için sabırlı olun — 6 aya kadar sürebilir ama her hafta biraz daha iyi görünecek.",
      risks:"Bilmeniz gereken birkaç şey var ama hepsi yönetilebilir: İlk günlerde burundan hafif sızıntı olabilir — bu normal. Hapşırma hissi tampona bağlı, alınınca geçer. Nadiren ek dokunuş gerekebilir ama bu kötü bir sonuç değil, doktorunuzla konuşabileceğiniz bir durum.",
    },
    social:{
      recovery:"Sosyal hayata ne zaman dönersiniz: Alçı çıkınca (1-2. hafta) hafif makyajla dışarı çıkabilirsiniz. Morluklar büyük çoğunlukla 2. haftada geçer. 1. ayda %80 çevreniz fark etmez. Final sonuç 6. ayda — ve o an paylaşmak için doğru zaman.",
      risks:"İlk 2 haftada güneş gözlüğü takmamanız gerekiyor — bu önemli. 8 haftaya kadar vücut teması sporlarından kaçının. Bunlar dışında günlük hayatınıza neredeyse hemen dönebilirsiniz.",
    },
    pragmatic:{
      recovery:"Gün 1-2: atel + tampon, evde dinlenme. Gün 3-7: morluklar azalır, hafif aktivite. Hafta 2: atel çıkar, işe dönüş. Ay 1-3: sosyal hayat normal. Ay 6: final sonuç.",
      risks:"3 kritik kural: 8 hafta gözlük yok, 8 hafta güneş yok, 2 hafta spor yok. Gerisini doktorunuz yönetir.",
    },
  },
  "Karın Germe":{
    analyst:{
      recovery:"Abdominoplasti 2-5 saat sürer; genel anestezi uygulanır. Postoperatif dönemde dren sistemi 1-3 gün kalır, eriyemeyen dikişler 1-3. haftada alınır. V pozisyonu ödemi azaltır, emboli profilaksisi için bacak hareketleri kritiktir. 2-3 gece hastane yatışı sonrası 1 hafta ev istirahati önerilir. 6 hafta boyunca ağır fiziksel aktivite kısıtlanır; kesi izi 6. aydan sonra solmaya başlar, 2 yıla kadar gelişir.",
      risks:"En kritik risk: tromboemboli (pulmoner emboli). Profilaksi için antikoagülan ve varis çorabı uygulanır. Seroma oluşumu (%5-10) drenajla yönetilir. Kesi hattında gecikmiş iyileşme sigara kullanımıyla koreledir. Kalıcı hipoestezi nadir görülür.",
    },
    trustseeker:{
      recovery:"Ameliyat sonrası ilk gün en zorlu dönem ama yalnız değilsiniz — ağrı kesiciler ve gerekirse uyku ilaçları kullanılıyor. İlk kalkışta baş dönmesi normal, yavaşça kalkın. 3. günden itibaren hareketler kolaylaşır. 2. haftadan itibaren sosyal hayata dönebilirsiniz. Dikişler 1-3 haftada alınır. 6 hafta sonra neredeyse her şeyi yapabilirsiniz.",
      risks:"En önemli şey: bacaklarınızı hareket ettirmek. Bu kan pıhtısı oluşumunu önler — ekibiniz size bunu hatırlatacak ama siz de bilseniz iyi. Bunun dışında şişlik, hafif ağrı ve kesi hattında kaşıntı ilk aylarda normal — zamanla geçer.",
    },
    social:{
      recovery:"Ne zaman ne yapabilirsiniz: 2. haftada sosyal hayata dönüş, 4. haftada tam duş, 6. haftada spor. Kesi izi bikini çizgisi içinde kalacak şekilde planlanıyor. 6. aydan sonra iz belirgin şekilde solur.",
      risks:"İlk 6 hafta sauna ve solaryum yok — cildinizi korumak için. Sigara iyileşmeyi yavaşlatıyor, bu dönemde bırakmak çok önemli.",
    },
    pragmatic:{
      recovery:"Hastane: 2-3 gece. Ev istirahati: 1 hafta. Sosyal hayat: 2. haftada. Spor: 6. haftada. Dikişler: 1-3 haftada alınır.",
      risks:"Emboli için bacak hareketi şart. 6 hafta ağır iş yok, sauna yok, güneş yok.",
    },
  },
  "Liposuction":{
    analyst:{
      recovery:"Liposuction lokal/genel anestezi ile uygulanır; kompresyon giysi postoperatif kontür için kritiktir. İlk 48 saatte belirgin ödem beklenir; 3-6 ay içinde final kontur oluşur. Teknik seçimi (tumescent, VASER vb.) doktor tarafından kişiselleştirilir. Eğer cilt elastikiyeti yetersizse ek rezeksiyon gerekebilir.",
      risks:"Kontur düzensizliği, seroma, cilt duyusunda geçici değişiklik. Nadir: yağ embolisi (çok geniş alan + tek seans kombinasyonunda risk artar). Cilt kalitesi sonucu doğrudan etkiler.",
    },
    trustseeker:{
      recovery:"İlk 2-3 gün ödemli geçer, normal. Kompresyon giysiyi giymek önemli — şekillenmesine yardımcı oluyor. 2. haftadan itibaren günlük hayat normale döner. Son şeklini görmek için 3-6 ay bekleyin ama her ay biraz daha iyi görünecek.",
      risks:"Bölgede geçici uyuşukluk olabilir, zamanla geçer. Ciltte hafif düzensizlik nadiren olabilir. Bunlar doktorunuzla konuşabileceğiniz, yönetilebilir durumlar.",
    },
    social:{
      recovery:"2. haftada sosyal hayat, 4. haftada havuz. 3. ayda kontur netleşmeye başlar. 6. ayda paylaşmak için doğru zaman.",
      risks:"Kompresyon giysiyi aksatmayın — bu sonucu doğrudan etkiler. 6 hafta güneş ve sauna yok.",
    },
    pragmatic:{
      recovery:"İlk hafta: dinlenme. 2. hafta: iş. 3-6 ay: final kontur. Kompresyon giysi şart.",
      risks:"3 kural: Kompresyon giysi her gün, 6 hafta güneş yok, aşırı tuz yok (ödem yapar).",
    },
  },
};

const EN_PROCS_STATIC={"Meme Küçültme":"Breast Reduction","Meme Büyütme (Silikon Protez ile)":"Breast Augmentation (Silicone Implant)","Meme Dikleştirme":"Breast Lift","Meme Asimetrisinin Giderilmesi":"Breast Asymmetry Correction","Meme Onarımı (Kanser sonrası)":"Breast Reconstruction (Post-cancer)","Doğumsal Meme Anomalisinin Düzeltilmesi":"Congenital Breast Anomaly Correction","Jinekomasti":"Gynecomastia","Burun Estetiği":"Rhinoplasty","Yüz Germe":"Facelift","Kaş Kaldırma":"Brow Lift","Üst Göz Kapağı Estetiği":"Upper Eyelid Surgery","Alt Göz Kapağı Estetiği":"Lower Eyelid Surgery","Yanak Estetiği (Bişektomi)":"Buccal Fat Removal","Kepçe Kulak Tedavisi":"Otoplasty","Yüz Yağ Enjeksiyonu":"Facial Fat Transfer","Botoks Uygulaması":"Botox","Dolgu Uygulaması":"Dermal Filler","Göz Altı Işık Dolgusu":"Under-Eye Light Filler","Nano Yağ Enjeksiyonu":"Nano Fat Injection","Mezoterapi":"Mesotherapy","Karın Germe":"Tummy Tuck","Liposuction":"Liposuction","Uyluk veya Kol germe":"Thigh or Arm Lift","Popo estetiği":"Buttock Aesthetics","Genital Estetik":"Genital Aesthetics","Labioplasti":"Labiaplasty","Lazer Epilasyon":"Laser Hair Removal","Lazer Dövme Silme":"Laser Tattoo Removal","Cilt Yenileme (Rejuvenasyon)":"Skin Rejuvenation","Karbon Peeling":"Carbon Peeling","Lazer Leke Tedavisi":"Laser Spot Treatment","Lazer Saç Tedavisi":"Laser Hair Treatment","Kol Germe":"Arm Lift","Kuşak Germe":"Belt Lipectomy","İple Askı Uygulaması":"Thread Lift"};

const EN_PROCEDURE_RECOVERY={
  "Burun Estetiği":{
    analyst:{
      recovery:"The procedure takes 1.5–2 hours. Postoperatively, a thermoplastic splint and nasal packing are applied; packing is removed within 24–48 hours, and the splint on day 7–14. Supine positioning should be avoided in the first 48 hours; cold compresses minimize edema. Ecchymosis regresses from day 3 onward. Dorsal edema fully resolves within 6–12 months; this timeframe should be considered for the final result.",
      risks:"Early period: nasal discharge (normal in the first 24–48 hours), nausea, packing sensation (temporary). Late period: 5–10% revision likelihood (due to structural limitations), rare respiratory changes. Infection rates are significantly reduced with antibiotic prophylaxis.",
    },
    trustseeker:{
      recovery:"When you wake up from surgery, you'll have a splint and packing on your nose — this is completely normal. The packing is usually removed on day 1–2, and you'll feel relieved. The first 3 days are the toughest, but pain medication helps. From day 3 on, swelling starts to decrease noticeably. The splint comes off at week 1–2, and you'll begin to see the general shape. Be patient for the final result — it can take up to 6 months, but each week it will look a little better.",
      risks:"There are a few things to know, but all are manageable: Slight drainage from the nose in the first days is normal. The sneezing sensation is from the packing and goes away once it's removed. Rarely, a touch-up may be needed, but that's not a bad outcome — it's something you can discuss with your doctor.",
    },
    social:{
      recovery:"When will you return to social life: Once the cast comes off (week 1–2), you can go out with light makeup. Bruising mostly fades by week 2. By month 1, 80% of people around you won't notice. The final result comes at month 6 — and that's the right time to share.",
      risks:"You won't be able to wear sunglasses for the first 2 weeks — this is important. Avoid contact sports for up to 8 weeks. Other than that, you can return to daily life almost immediately.",
    },
    pragmatic:{
      recovery:"Day 1–2: splint + packing, rest at home. Day 3–7: bruising fades, light activity. Week 2: splint removed, return to work. Month 1–3: social life normal. Month 6: final result.",
      risks:"3 critical rules: no glasses for 8 weeks, no sun for 8 weeks, no sports for 2 weeks. Your doctor handles the rest.",
    },
  },
  "Karın Germe":{
    analyst:{
      recovery:"Abdominoplasty takes 2–5 hours under general anesthesia. Postoperatively, a drain system remains for 1–3 days; non-absorbable sutures are removed at week 1–3. V-positioning reduces edema; leg movements are critical for embolism prophylaxis. After 2–3 nights of hospital stay, 1 week of home rest is recommended. Heavy physical activity is restricted for 6 weeks; the incision scar begins to fade after month 6 and continues to improve for up to 2 years.",
      risks:"The most critical risk: thromboembolism (pulmonary embolism). Prophylaxis includes anticoagulants and compression stockings. Seroma formation (5–10%) is managed with drainage. Delayed healing at the incision line correlates with smoking. Permanent hypoesthesia is rare.",
    },
    trustseeker:{
      recovery:"The first day after surgery is the toughest, but you're not alone — pain medication and sleep aids are available if needed. Feeling dizzy when first standing up is normal; get up slowly. From day 3, movement gets easier. You can return to social life from week 2. Sutures are removed at week 1–3. After 6 weeks, you can do almost everything.",
      risks:"The most important thing: keep your legs moving. This prevents blood clot formation — your team will remind you, but it's good to know yourself. Beyond that, swelling, mild pain, and itching at the incision line are normal in the first months and resolve over time.",
    },
    social:{
      recovery:"When can you do what: Social life returns at week 2, full showers at week 4, sports at week 6. The incision is planned to stay within the bikini line. After month 6, the scar fades significantly.",
      risks:"No sauna or tanning for the first 6 weeks — to protect your skin. Smoking slows healing, so quitting during this period is very important.",
    },
    pragmatic:{
      recovery:"Hospital: 2–3 nights. Home rest: 1 week. Social life: week 2. Sports: week 6. Sutures: removed at week 1–3.",
      risks:"Leg movement is essential for embolism prevention. No heavy work, sauna, or sun for 6 weeks.",
    },
  },
  "Liposuction":{
    analyst:{
      recovery:"Liposuction is performed under local or general anesthesia; a compression garment is critical for postoperative contouring. Significant edema is expected in the first 48 hours; the final contour develops over 3–6 months. The technique (tumescent, VASER, etc.) is personalized by the surgeon. If skin elasticity is insufficient, additional resection may be required.",
      risks:"Contour irregularity, seroma, temporary changes in skin sensation. Rare: fat embolism (risk increases with very large area + single session combinations). Skin quality directly affects the outcome.",
    },
    trustseeker:{
      recovery:"The first 2–3 days will be swollen — that's normal. Wearing the compression garment is important — it helps with shaping. From week 2, daily life returns to normal. Wait 3–6 months to see the final shape, but each month it will look a little better.",
      risks:"There may be temporary numbness in the area, which resolves over time. Slight skin irregularity can rarely occur. These are manageable situations you can discuss with your doctor.",
    },
    social:{
      recovery:"Social life at week 2, pool at week 4. Contour starts to become defined at month 3. Month 6 is the right time to share.",
      risks:"Don't skip the compression garment — it directly affects the result. No sun or sauna for 6 weeks.",
    },
    pragmatic:{
      recovery:"First week: rest. Week 2: work. Month 3–6: final contour. Compression garment is a must.",
      risks:"3 rules: Compression garment every day, no sun for 6 weeks, no excess salt (causes swelling).",
    },
  },
};

// Diğer prosedürler için default profil içeriği
function getPersonalizedContent(proc,profile,section,lang){
  if(lang==="en"){
    const enData=EN_PROCEDURE_RECOVERY[proc]?.[profile];
    if(enData&&enData[section]) return enData[section];
    const enFallbacks={
      analyst:{
        recovery:`Post-${EN_PROCS_STATIC[proc]||proc} recovery varies depending on the technique used and individual factors. Early swelling and bruising are expected; your doctor will share a personalized timeline during consultation.`,
        risks:`Complications related to ${EN_PROCS_STATIC[proc]||proc} will be comprehensively addressed during your pre-operative evaluation. Your personal risk profile will be assessed based on your health status.`,
      },
      trustseeker:{
        recovery:`After your ${EN_PROCS_STATIC[proc]||proc} procedure, you'll know what to expect at every step. The first few days may be the toughest, but with pain management and our team's support, you'll get through comfortably. Swelling decreases over time, and you'll feel better each day.`,
        risks:`Most situations that may occur after ${EN_PROCS_STATIC[proc]||proc} are temporary and manageable. Don't hesitate to call your doctor if you notice anything — our team is with you every step of the way.`,
      },
      social:{
        recovery:`Your timeline for returning to social life after ${EN_PROCS_STATIC[proc]||proc} will be clarified during consultation. When people around you stop noticing is a sign that your recovery is largely complete.`,
        risks:`Having accurate information about ${EN_PROCS_STATIC[proc]||proc} when talking with your circle is important. Your doctor will share reliable information you can pass along.`,
      },
      pragmatic:{
        recovery:`${EN_PROCS_STATIC[proc]||proc}: Timeline will be shared clearly during consultation. Key restrictions and return-to-work timeline will be summarized by your doctor.`,
        risks:`Key points will be covered in consultation. Follow post-op instructions and you'll be fine.`,
      },
    };
    return enFallbacks[profile]?.[section]||"";
  }
  const procData=PROCEDURE_RECOVERY[proc]?.[profile];
  if(procData&&procData[section]) return procData[section];
  const fallbacks={
    analyst:{
      recovery:`${proc} sonrası iyileşme süreci, kullanılan teknik ve bireysel faktörlere bağlı değişkenlik gösterir. Erken dönem ödem ve ekimoz beklenen bulgulardır; doktorunuz size özel takvimi konsültasyonda paylaşacaktır.`,
      risks:`${proc} ameliyatında komplikasyonlar ameliyat öncesi değerlendirmede kapsamlı biçimde ele alınacaktır. Kişisel risk profili sağlık durumunuza göre değerlendirilebilir.`,
    },
    trustseeker:{
      recovery:`${proc} ameliyatından sonra her adımda ne olacağını bilerek sürece gireceksiniz. İlk günler en zorlu dönem olabilir ama ağrı yönetimi ve ekibimizin desteğiyle rahat geçirilir. Şişlik zamanla azalır, kendinizi her geçen gün daha iyi hissedersiniz.`,
      risks:`${proc} sonrasında yaşanabilecek durumların büyük çoğunluğu geçici ve yönetilebilir. Bir şey fark ettiğinizde doktorunuzu aramaktan çekinmeyin — ekibimiz her adımda yanınızda.`,
    },
    social:{
      recovery:`${proc} sonrası sosyal hayata dönüş takvimi konsültasyonda netleşecek. Çevrenizin fark etmemeye başladığı an iyileşmenin büyük ölçüde tamamlandığının işaretidir.`,
      risks:`${proc} hakkında çevrenizle konuşurken doğru bilgiye sahip olmak önemli. Doktorunuz süreçle ilgili paylaşabileceğiniz güvenilir bilgileri sizinle paylaşacak.`,
    },
    pragmatic:{
      recovery:`${proc}: Konsültasyonda takvim net olarak paylaşılacak. Kritik kısıtlamalar ve işe dönüş süresi doktorunuz tarafından özetlenecek.`,
      risks:`Dikkat edilmesi gereken kritik noktalar konsültasyonda paylaşılacak. Gerisini doktorunuz yönetir.`,
    },
  };
  return fallbacks[profile]?.[section]||"";
}


const PROCEDURE_INFO = {
  "default":{category:"Estetik Cerrahi",desc:"Uzman ekibimiz size özel bir plan hazırlayacak.",stats:[{val:"Değişken",lbl:"Süre"},{val:"Değişken",lbl:"İyileşme"},{val:"6-12 ay",lbl:"Sonuç"}],process:"İşlem sonrası süreç prosedürünüze göre değişir. Doktorunuz konsültasyonda detayları sizinle paylaşacak.",timeline:[{time:"Ameliyat günü",emoji:"🏥",color:"#7c3aed",title:"Ameliyat & Uyanış",desc:"Ekibimiz sizi süreç boyunca bilgilendirecek."},{time:"İlk hafta",emoji:"🌤",color:"#0891b2",title:"İyileşme başlar",desc:"Dinlenme ve doktor önerilerine uyum bu dönemde kritik."},{time:"6-12 ay",emoji:"✨",color:"#10b981",title:"Nihai sonuç",desc:"Son şekil zamanla ortaya çıkar."}],prep:["Kullandığınız tüm ilaçları doktorunuza bildirin","Sorularınızı konsültasyon için not edin"],normal:["İlk günlerde hafif şişlik ve ağrı olabilir","3. günden itibaren şişlik azalmaya başlar"],followup:"Kontrol randevularınız"},

  "Burun Estetiği":{category:"Estetik Cerrahi",desc:"Burunun boyutu ve şekli düzeltilerek hem görünüm hem de solunum sorunları giderilebilir.",stats:[{val:"1,5–2 saat",lbl:"Süre"},{val:"1–2 hafta",lbl:"İyileşme"},{val:"6–12 ay",lbl:"Sonuç"}],process:"Ameliyat sonrası burnunuzda termoplastik atel ve tampon bulunacak. Tamponlar 1–2. günde alınır. İlk 48 saatte soğuk uygulama şişliği azaltır. 3. günden itibaren şişlikler azalmaya başlar. 1–2 hafta sonra termoplastik atel alınır.",timeline:[{time:"Ameliyat günü",emoji:"🏥",color:"#7c3aed",title:"Ameliyat & Uyanış",desc:"1,5–2 saatlik işlem. Burnunuzda termoplastik atel ve tampon olacak."},{time:"1–2. gün",emoji:"❄️",color:"#6d28d9",title:"Dinlenme & Soğuk Uygulama",desc:"2 saatte bir 15 dk. soğuk uygulama şişliği azaltır. Tamponlar bu dönemde alınır."},{time:"3–7. gün",emoji:"🌤",color:"#0891b2",title:"Morluklar Geçmeye Başlar",desc:"Şişlik ve morluklar hızla azalır. Günlük aktivitelere yavaşça dönülebilir."},{time:"1–2. hafta",emoji:"🩹",color:"#059669",title:"Alçı Alınır",desc:"Atel alınır, ince bant ~1 hafta daha uygulanır. Burunun genel şekli görünür."},{time:"6–12. ay",emoji:"✨",color:"#10b981",title:"Nihai Sonuç",desc:"Burun son şeklini alır. Ameliyat öncesi/sonrası karşılaştırmaları yapılır."}],prep:["Ameliyat sonrası ilk 2 haftada vücut teması olan sporlardan kaçının ve gözlük kullanmayın","8 hafta boyunca sauna, solaryum ve güneş banyosundan kaçının","2. haftadan itibaren yüzme ve bireysel sporlar yapılabilir","Sorularınızı konsültasyon için not alın"],normal:["İlk günlerde hafif bulantı ve baş dönmesi olabilir","Burun deliğinden sızıntı ilk 24–48 saatte normaldir","Sabahları burun daha şiş olabilir, gün içinde azalır","Burun ucunda aylarca sürebilen hafif uyuşukluk olabilir"],followup:"1., 3., 6. ve 12. aylarda kontrol"},

  "Karın Germe":{category:"Vücut Şekillendirme",desc:"Orta ve alt karın bölgesindeki yağ ve sarkık derinin alınarak karın kaslarının gerilerek sağlamlaştırıldığı bir cerrahi girişimdir.",stats:[{val:"2–5 saat",lbl:"Süre"},{val:"2–3 gece",lbl:"Hastane"},{val:"6 hafta",lbl:"İyileşme"}],process:"Ameliyat sonrası V pozisyonunda yatmanız sağlanacak. Karın korsesi uygulanacak. İlk iki gün en zor dönem. 3. günden itibaren şişlik azalır. Drenler 1–3 günde alınır. Cilt altı eriyen dikişler atılır, dikiş alma işlemi yapılmaz. 2. haftadan itibaren sosyal hayata dönüş.",timeline:[{time:"Ameliyat günü",emoji:"🏥",color:"#7c3aed",title:"İşlem",desc:"2–5 saat. Dren takılır, karın korsesi uygulanır."},{time:"1–2. gün",emoji:"💊",color:"#6d28d9",title:"En Yoğun Dönem",desc:"Ağrı kesici desteği. V pozisyonunda dinlenme. Bacak egzersizleri önemli."},{time:"3–7. gün",emoji:"🌤",color:"#0891b2",title:"Şişlik Azalır",desc:"Drenler alınır. Hareketler kolaylaşır. Sıvı gıdadan normale geçiş."},{time:"2–6. hafta",emoji:"🚶",color:"#059669",title:"Sosyal Hayata Dönüş",desc:"2. haftadan itibaren sosyal aktiviteler. 6 hafta ağır iş yasak."},{time:"6+ ay",emoji:"✨",color:"#10b981",title:"Nihai Sonuç",desc:"Kesi izi 6. aydan itibaren solmaya başlar. 2 yıla kadar iyileşir."}],prep:["Sigara içiyorsanız ameliyattan 2 hafta önce bırakın","E vitamini kullanıyorsanız bu dönemde ara verin","4 hafta boyunca havuz ve denize girmeyin","6 hafta sauna, solaryum ve güneş banyosundan kaçının"],normal:["İlk 2 gün vücut su toplar, hareketler zorlaşabilir","İlk kalkmada baş dönmesi olabilir — yavaş kalkın","Dikiş hattı ilk 3–4 ay kırmızı ve kaşıntılı olabilir","Göbek altı bölgesinde geçici uyuşukluk olabilir"],followup:"1., 3., 6. ve 12. aylarda kontrol"},

  "Üst Göz Kapağı Estetiği":{category:"Yüz Estetiği",desc:"Sarkık ve gevşek üst göz kapağı cildinin düzeltilerek daha genç ve dinç bir görünüm elde edilmesi.",stats:[{val:"Lokal Anestezi",lbl:"Anestezi"},{val:"3–4. gün",lbl:"Bantlar Alınır"},{val:"6 hafta",lbl:"İyileşme"}],process:"İşlem lokal anestezi ile yapılır, açlık gerektirmez. İşlem sonrası göz kapağında bantlar olacak. Soğuk uygulama ilk gün saat başı 20 dk, 2. gün 2 saatte bir 20 dk yapılmalı. 3. günden şişlik azalır. 4. günde bantlar alınır.",timeline:[{time:"İşlem günü",emoji:"🏥",color:"#7c3aed",title:"İşlem & Uyanış",desc:"Lokal anestezi. Göz kapağında bantlar olacak. Eve aynı gün çıkılır."},{time:"1–2. gün",emoji:"❄️",color:"#6d28d9",title:"Soğuk Uygulama",desc:"Saat başı 20 dakika soğuk uygulama. Baş yüksek tutularak dinlenin."},{time:"3–4. gün",emoji:"🩹",color:"#0891b2",title:"Bantlar Alınır",desc:"Şişlik azalmaya başlar. 4. günde bantlar alınır. Göz çevresi yıkanabilir."},{time:"2–4. hafta",emoji:"🌤",color:"#059669",title:"Normalleşme",desc:"Morluklar geçer. Gözler açılmaya başlar. Hafif makyaj yapılabilir."},{time:"6+ hafta",emoji:"✨",color:"#10b981",title:"Nihai Görünüm",desc:"6 haftadan sonra son sonuç ortaya çıkar."}],prep:["Lokal anestezi ile yapıldığı için aç kalmanıza gerek yoktur","İşlem sonrası 4 saat yatmayın ve yorucu aktivitelerden kaçının","Güneş gözlüğü kullanın","6 hafta boyunca sauna ve solaryumdan kaçının"],normal:["Göz çevresinde şişlik ve morluk ilk 2–3 gün artabilir","Sabahları gözler daha şişik olabilir, gün içinde azalır","İlk haftalarda rüzgar ve güneşe maruz kalınca gözde gerginlik hissedilebilir","Göz köşesinde hafif çekilme ilk hafta daha belirgin olabilir"],followup:"İşlem sonrası 15. günde kontrol"},

  "Alt Göz Kapağı Estetiği":{category:"Yüz Estetiği",desc:"Alt göz kapağındaki yağ birikimi ve sarkıklığın düzeltilerek daha dinç ve genç bir görünüm elde edilmesi.",stats:[{val:"Genel Anestezi",lbl:"Anestezi"},{val:"3–4. gün",lbl:"Bantlar Alınır"},{val:"6 hafta",lbl:"İyileşme"}],process:"Alt göz kapağı ameliyatı üst ile benzer süreç izler. İşlem sonrası soğuk uygulama ve dinlenme kritik. 3. günden itibaren şişlik azalır.",timeline:[{time:"İşlem günü",emoji:"🏥",color:"#7c3aed",title:"İşlem",desc:"Genel anestezi altında yapılır. Genelde 1 veya 2 gece yatış olur."},{time:"1–3. gün",emoji:"❄️",color:"#6d28d9",title:"Soğuk Uygulama",desc:"Düzenli soğuk uygulama şişliği kontrol altında tutar."},{time:"4–7. gün",emoji:"🩹",color:"#0891b2",title:"Bantlar Alınır",desc:"Şişlik belirgin şekilde azalır. Günlük aktivitelere dönüş başlar."},{time:"6 hafta",emoji:"✨",color:"#10b981",title:"Nihai Görünüm",desc:"Son sonuç ortaya çıkar."}],prep:["6 hafta sauna ve solaryumdan kaçının","Güneş gözlüğü kullanın"],normal:["Şişlik ve morluk ilk 2–3 gün artabilir","Sabahları gözler daha şişik olabilir","İlk haftalarda göz çevresinde gerginlik hissedilebilir"],followup:"İşlem sonrası 15. günde kontrol"},

  "Botoks Uygulaması":{category:"Medikal Estetik",desc:"Mimik kaslarını geçici olarak gevşeterek kırışıklıkları azaltan, cerrahi gerektirmeyen hızlı bir uygulama.",stats:[{val:"10–15 dk",lbl:"Süre"},{val:"3–7 gün",lbl:"Etki Başlar"},{val:"3–4 ay",lbl:"Etki Süresi"}],process:"Uygulama sonrası hemen eve gidebilirsiniz. 4 saat mimiklerinizi kullanmayın ve yatmayın. Yüzünüzü yıkayabilir, makyaj yapabilirsiniz.",timeline:[{time:"Uygulama günü",emoji:"💉",color:"#7c3aed",title:"Uygulama",desc:"10–15 dakika. Ağrısız. Eve aynı gün çıkılır."},{time:"3–7. gün",emoji:"🌱",color:"#0891b2",title:"Etki Başlar",desc:"Kırışıklıklar azalmaya başlar. Mimik kasları yavaşça gevşer."},{time:"2–4 hafta",emoji:"✨",color:"#059669",title:"Tam Etki",desc:"Botoxun tam etkisi 2–4. haftada görülür."},{time:"3–4 ay",emoji:"🔄",color:"#d97706",title:"Tekrar Zamanı",desc:"Etki yavaşça azalır. Tekrarlanan uygulamalarla etki 12 aya kadar uzayabilir."}],prep:["Uygulamadan sonra 4 saat mimiklerinizi kullanmayın","Uygulamadan sonra 4 saat yatmayın","2 gün enjeksiyon bölgelerine masaj yapmayın","2 gün yoğun spor programlarına ara verin"],normal:["1–2 gün kızarıklık, morluk veya hafif şişlik olabilir","Uygulama sonrası ilk hafta hafif baş ağrısı hissedilebilir","Etki kişiye göre 3–7 gün içinde başlar"],followup:"Gerekirse 15 gün sonra kontrol"},

  "Dolgu Uygulaması":{category:"Medikal Estetik",desc:"Yüzün çeşitli bölgelerine hacim kazandırmak ve olukları doldurmak için uygulanan hyalüronik asit bazlı işlem.",stats:[{val:"15–30 dk",lbl:"Süre"},{val:"1–2 gün",lbl:"İyileşme"},{val:"6–18 ay",lbl:"Etki Süresi"}],process:"Uygulama sonrası soğuk uygulama şişliği azaltır. İlk 2 gün ödem bölgesi normalden şişik görünebilir. 4–5. günden itibaren hafif masaj yapılabilir.",timeline:[{time:"Uygulama günü",emoji:"💉",color:"#7c3aed",title:"Uygulama",desc:"Lokal anestezi kremi ile ağrısız. Eve aynı gün çıkılır."},{time:"1–3. gün",emoji:"❄️",color:"#0891b2",title:"Ödem Dönemi",desc:"Normalden biraz fazla şişlik beklenir, özellikle dudakta."},{time:"1–2 hafta",emoji:"✨",color:"#059669",title:"Nihai Görünüm",desc:"Ödem geçer, kalıcı sonuç ortaya çıkar."}],prep:["İşlem öncesi 10 gün kan sulandırıcılardan kaçının","Aşırı sıcak ve buhardan kaçının","Uygulamadan sonra masaj yapmayın"],normal:["İlk 2 gün ödem ve morluk olabilir","Dudak dolgusunda şişlik daha belirgin olabilir","Uygulama bölgesinde geçici gerginlik hissedilebilir"],followup:"Gerekirse 2 hafta sonra kontrol"},

  "Liposuction":{category:"Vücut Şekillendirme",desc:"Diyet ve egzersizle gidemeyen bölgesel yağ birikimlerinin vakumla alınarak vücudun şekillendirilmesi.",stats:[{val:"Değişken",lbl:"Süre"},{val:"2–3 gün",lbl:"Hastane"},{val:"3–6 ay",lbl:"Sonuç"}],process:"Ameliyat sonrası kompresyon giysi uygulanacak. İlk 48 saatte ödem yoğun. 3. günden haraketler kolaylaşır. Konturlar 3–6 ay içinde netleşir.",timeline:[{time:"Ameliyat günü",emoji:"🏥",color:"#7c3aed",title:"İşlem",desc:"Kompresyon giysi uygulanır. Drenler takılabilir."},{time:"1–3. gün",emoji:"💊",color:"#6d28d9",title:"Yoğun Ödem",desc:"Vücut su toplar. Kompresyon giysiyi sürekli takın."},{time:"1–2. hafta",emoji:"🌤",color:"#0891b2",title:"İyileşme",desc:"Hareketler normalleşir. Sosyal hayata dönüş başlar."},{time:"3–6. ay",emoji:"✨",color:"#10b981",title:"Nihai Kontur",desc:"Vücut yeni şeklini alır. Son sonuç ortaya çıkar."}],prep:["Kompresyon giysi ameliyat sonrası sürekli kullanılacak","4 hafta havuz ve denizden kaçının","6 hafta sauna ve solaryumdan kaçının"],normal:["İlk 2–3 gün belirgin ödem ve morluk olabilir","Cilt yüzeyinde geçici düzensizlikler olabilir","Uyuşukluk veya hassasiyet hissi zamanla geçer"],followup:"1., 3. ve 6. aylarda kontrol"},

  "Meme Dikleştirme":{category:"Meme Estetiği",desc:"Sarkıklık gösteren memelerin yukarı taşınarak yeniden şekillendirilmesi, gerekirse protez eklenmesi.",stats:[{val:"2–4 saat",lbl:"Süre"},{val:"1–2 gece",lbl:"Hastane"},{val:"6 hafta",lbl:"İyileşme"}],process:"Ameliyat sonrası destek sütyeni kullanılacak. İlk birkaç gün kol hareketleri kısıtlanır. 3. günden şişlik azalır. Cilt altı eriyen dikişler atılır, dikiş alma işlemi yapılmaz.",timeline:[{time:"Ameliyat günü",emoji:"🏥",color:"#7c3aed",title:"İşlem",desc:"Genel anestezi. Destek sütyeni uygulanır."},{time:"1–3. gün",emoji:"💊",color:"#6d28d9",title:"Dinlenme",desc:"Kolları kullanmak kısıtlı. Ağrı kesici desteği."},{time:"2–4. hafta",emoji:"🌤",color:"#0891b2",title:"Normalleşme",desc:"Şişlik azalır, kol hareketleri normalleşir. Hafif aktivitelere dönüş."},{time:"6 hafta+",emoji:"✨",color:"#10b981",title:"Nihai Görünüm",desc:"Şişlik tamamen geçer, son şekil ortaya çıkar."}],prep:["Destek sütyeni ameliyat sonrası sürekli takın","4 hafta havuzdan kaçının","6 hafta ağır kol egzersizlerinden kaçının"],normal:["Meme başı duyusunda geçici değişiklik olabilir","İlk günlerde meme bölgesinde sertlik ve şişlik normaldir","Kesi izleri ilk 3–4 ay daha belirgin olabilir"],followup:"1., 3. ve 6. aylarda kontrol"},

  "Meme Küçültme":{category:"Meme Estetiği",desc:"Büyük ve sarkık memelerin küçültülerek yeniden şekillendirilmesi, sırt ağrısı ve postür sorunlarını gidermesi.",stats:[{val:"2–4 saat",lbl:"Süre"},{val:"1–2 gece",lbl:"Hastane"},{val:"6 hafta",lbl:"İyileşme"}],process:"Ameliyat sonrası destek sütyeni kullanılacak. İlk birkaç gün kol hareketleri kısıtlanır. Cilt altı eriyen dikişler atılır, dikiş alma işlemi yapılmaz. 2. haftadan itibaren sosyal hayata dönüş.",timeline:[{time:"Ameliyat günü",emoji:"🏥",color:"#7c3aed",title:"İşlem",desc:"Genel anestezi. Destek sütyeni uygulanır."},{time:"1–2. hafta",emoji:"🌤",color:"#6d28d9",title:"İyileşme",desc:"Şişlik azalır. Kol hareketleri normalleşir."},{time:"6 hafta",emoji:"✨",color:"#10b981",title:"Nihai Görünüm",desc:"Yeni meme şekli oturur. İzler solmaya başlar."}],prep:["Destek sütyeni sürekli takın","6 hafta ağır spor ve kol egzersizlerinden kaçının"],normal:["Meme başı duyusunda geçici değişiklik olabilir","Kesi izleri ilk aylarda belirgin olabilir","Hafif şişlik ve sertlik normaldir"],followup:"1., 3. ve 6. aylarda kontrol"},

  "Meme Büyütme (Silikon Protez ile)":{category:"Meme Estetiği",desc:"Silikon protez ile meme hacmini artırarak istenen dolgunluk ve şekle ulaşılması.",stats:[{val:"1–2 saat",lbl:"Süre"},{val:"1 gece",lbl:"Hastane"},{val:"3–6 ay",lbl:"Sonuç"}],process:"Ameliyat sonrası destek sütyeni kritik. İlk hafta kol hareketleri kısıtlı. 3. günden şişlik azalır. Cilt altı eriyen dikişler atılır, dikiş alma işlemi yapılmaz. Protezler 3–6 ay içinde yerleşir.",timeline:[{time:"Ameliyat günü",emoji:"🏥",color:"#7c3aed",title:"İşlem",desc:"Genel anestezi. Destek sütyeni takılır."},{time:"1–7. gün",emoji:"💊",color:"#6d28d9",title:"Dinlenme",desc:"Kollar yukarı kaldırmak yasak. Ağrı kesici desteği."},{time:"3–6. ay",emoji:"✨",color:"#10b981",title:"Protez Yerleşir",desc:"Protez doku ile bütünleşir, final şekil ortaya çıkar."}],prep:["Destek sütyeni sürekli takın","İlk hafta kolları yukarı kaldırmayın"],normal:["İlk hafta sertlik ve gerginlik hissi normal","Protez bölgesinde geçici uyuşukluk olabilir","Şişlik 3–4 haftada belirgin azalır"],followup:"1., 3. ve 6. aylarda kontrol"},

  "Kol Germe":{category:"Vücut Şekillendirme",desc:"Kol arka ve iç kısmındaki sarkıklık ile yağ fazlalığının alınarak kolun yeniden şekillendirilmesi.",stats:[{val:"Genel Anestezi",lbl:"Anestezi"},{val:"10–14 gün",lbl:"Dikişler"},{val:"6 hafta",lbl:"İyileşme"}],process:"Ameliyat sonrası drenler 24–48 saat içinde alınır. 2–3 hafta günlük aktiviteler kısıtlanır. Dikişler 10–14. günde alınır. 2. haftadan itibaren sosyal hayata dönüş.",timeline:[{time:"Ameliyat günü",emoji:"🏥",color:"#7c3aed",title:"İşlem",desc:"Koltukaltından kesi ile deri ve yağ dokusu çıkarılır. Dren takılır."},{time:"1–3. gün",emoji:"💊",color:"#6d28d9",title:"Dinlenme",desc:"Drenler alınır. Kol hareketleri kısıtlı."},{time:"1–2. hafta",emoji:"🩹",color:"#0891b2",title:"Dikişler Alınır",desc:"10–14. günde dikişler alınır. Şişlik azalır."},{time:"6 hafta",emoji:"✨",color:"#10b981",title:"İyileşme",desc:"Ağır kol egzersizlerine dönüş mümkün."}],prep:["4 hafta havuz ve denizden kaçının","6 hafta ağır kol işlerinden kaçının","Sigara içiyorsanız ameliyat döneminde bırakın"],normal:["İlk 2 gün ödem belirgin olabilir","Kesi izi ilk 3–4 ay kırmızı ve kaşıntılı olabilir","Kolda geçici uyuşukluk hissedilebilir"],followup:"1., 3. ve 6. aylarda kontrol"},

  "Uyluk veya Kol germe":{category:"Vücut Şekillendirme",desc:"Uyluk veya kol bölgesindeki sarkıklık ve yağ fazlalığının ameliyatla düzeltilmesi.",stats:[{val:"Genel Anestezi",lbl:"Anestezi"},{val:"1–2 gece",lbl:"Hastane"},{val:"6 hafta",lbl:"İyileşme"}],process:"Ameliyat sonrası drenler 48–72 saat içinde alınır. 2–3 hafta günlük aktiviteler kısıtlanır. Dikişler 12–14. günde alınır.",timeline:[{time:"Ameliyat günü",emoji:"🏥",color:"#7c3aed",title:"İşlem",desc:"Genel anestezi. Dren takılır."},{time:"1–3. gün",emoji:"💊",color:"#6d28d9",title:"Dinlenme",desc:"Drenler alınır. V pozisyonunda dinlenme."},{time:"1–2. hafta",emoji:"🩹",color:"#0891b2",title:"Dikişler Alınır",desc:"12–14. günde dikişler alınır."},{time:"6 hafta",emoji:"✨",color:"#10b981",title:"İyileşme",desc:"Ağır aktivitelere dönüş mümkün."}],prep:["3–4 gün önceden yumuşak gıdalar alın","4 hafta havuz ve denizden kaçının","6 hafta sauna ve solaryumdan kaçının"],normal:["İlk 2 gün ödem belirgin","Dikiş hattı ilk aylarda kırmızı olabilir","Bölgede geçici uyuşukluk hissedilebilir"],followup:"1., 3. ve 6. aylarda kontrol"},

  "Kuşak Germe":{category:"Vücut Şekillendirme",desc:"Karın, bel, kalça ve kuyruk sokumu bölgelerinin tamamında sarkıklık ve yağ fazlalığının düzeltildiği kapsamlı bir ameliyat.",stats:[{val:"2–6 saat",lbl:"Süre"},{val:"1–5 gece",lbl:"Hastane"},{val:"6 hafta",lbl:"İyileşme"}],process:"Ameliyat sonrası karın korsesi uygulanacak. Çepeçevre kesi hattı var. İlk günler emboli riski nedeniyle bacak hareketleri önemli. 3. günden şişlik azalır.",timeline:[{time:"Ameliyat günü",emoji:"🏥",color:"#7c3aed",title:"İşlem",desc:"2–6 saat. Kapsamlı kesi. Korse uygulanır."},{time:"1–3. gün",emoji:"💊",color:"#6d28d9",title:"Yoğun Bakım",desc:"Bacak hareketleri çok önemli. V pozisyonunda dinlenme."},{time:"3–7. gün",emoji:"🌤",color:"#0891b2",title:"Şişlik Azalır",desc:"Drenler alınır. Hareketler kolaylaşır."},{time:"6 hafta",emoji:"✨",color:"#10b981",title:"İyileşme",desc:"Ağır sporlar ve aktivitelere dönüş mümkün."}],prep:["Sigara içiyorsanız 2 hafta önceden bırakın","E vitamini kullanıyorsanız ara verin","4 hafta havuz ve denizden kaçının","6 hafta ağır spor ve aktivitelerden kaçının"],normal:["İlk 2 gün yoğun ödem normaldir","İlk kalkışta baş dönmesi olabilir — yavaş kalkın","Kesi hattı ilk aylarda belirgin ve kaşıntılı olabilir","Bölgede geçici uyuşukluk hissedilebilir"],followup:"1., 3., 6. ve 12. aylarda kontrol"},

  "İple Askı Uygulaması":{category:"Yüz Gençleştirme",desc:"Yaşla sarkmış yüz dokularının özel iplerle normal anatomik konumlarına getirilmesi.",stats:[{val:"Sedasyon",lbl:"Anestezi"},{val:"Gündüz",lbl:"Hastane"},{val:"Değişken",lbl:"Sonuç Süresi"}],process:"İşlem sonrası hafif şişlik ve çekinti olabilir. Çoğu geçici. Masaj ile düzelir. Kalıcı değil, yıllar içinde tekrar gerekebilir.",timeline:[{time:"İşlem günü",emoji:"🏥",color:"#7c3aed",title:"İşlem",desc:"Sedasyon veya lokal anestezi. Eve aynı gün çıkılır."},{time:"1–2. hafta",emoji:"🌤",color:"#0891b2",title:"İlk Sonuç",desc:"Şişlik azalır. İplerin etkisi görülmeye başlar."},{time:"1–3 ay",emoji:"✨",color:"#10b981",title:"Nihai Görünüm",desc:"Son sonuç oturur. Doğal ve dinç görünüm."}],prep:["İşlem sonrası ilk gün sert yiyeceklerden kaçının","Aşırı mimik hareketlerinden kaçının","Masaj önerilerine uyun"],normal:["İşlem sonrası hafif çukurlar veya çentikler olabilir, geçer","Şakak bölgesinde hafif yanma hissi normaldir","İlk haftada yüzde hafif asimetri olabilir, düzelir"],followup:"1. ay ve 3. ay kontrolü"},

  "Yüz Germe":{category:"Yüz Gençleştirme",desc:"Yüz ve boyundaki sarkıklığın cerrahi olarak düzeltilmesi.",stats:[{val:"3–5 saat",lbl:"Süre"},{val:"1–2 gece",lbl:"Hastane"},{val:"2–4 hafta",lbl:"İyileşme"}],process:"Ameliyat sonrası bandajlar uygulanır. İlk hafta istirahat. 2. haftadan itibaren sosyal aktiviteler. Saç dipleri geçici olarak duyarsız olabilir.",timeline:[{time:"Ameliyat günü",emoji:"🏥",color:"#7c3aed",title:"İşlem",desc:"Genel veya sedasyon anestezi. Bandajlar uygulanır."},{time:"1–7. gün",emoji:"💊",color:"#6d28d9",title:"Dinlenme",desc:"Baş yüksek tutulur. Şişlik ve morluk en yoğun dönem."},{time:"2–4. hafta",emoji:"🌤",color:"#0891b2",title:"Normalleşme",desc:"Şişlik ve morluklar geçer. Sosyal hayata dönüş."},{time:"3–6. ay",emoji:"✨",color:"#10b981",title:"Nihai Görünüm",desc:"Son sonuç oturur. Kesi izleri saç dibi ve kulak arkasında gizlenir."}],prep:["Sigara içiyorsanız bırakın","6 hafta sauna ve solaryumdan kaçının"],normal:["Yüzde şişlik ve morluk ilk hafta belirgin","Saç diplerinde geçici uyuşukluk olabilir","Kulak çevresinde gerginlik hissi zamanla geçer"],followup:"1. ve 3. aylarda kontrol"},

  "Popo estetiği":{category:"Vücut Şekillendirme",desc:"Popo bölgesine yağ enjeksiyonu veya protez ile şekil ve hacim kazandırılması.",stats:[{val:"1–3 saat",lbl:"Süre"},{val:"1–2 gece",lbl:"Hastane"},{val:"3–6 ay",lbl:"Sonuç"}],process:"Ameliyat sonrası 2–4 hafta sırt üstü yatmaktan ve uzun süre oturmaktan kaçınılır. Kompresyon giysi önemli.",timeline:[{time:"Ameliyat günü",emoji:"🏥",color:"#7c3aed",title:"İşlem",desc:"Genel anestezi. Kompresyon giysi uygulanır."},{time:"2–4. hafta",emoji:"💊",color:"#6d28d9",title:"Oturma Kısıtlı",desc:"Uzun süre oturmaktan ve sırt üstü yatmaktan kaçının."},{time:"3–6. ay",emoji:"✨",color:"#10b981",title:"Nihai Şekil",desc:"Yağ tutulumu stabil hale gelir, final şekil oturur."}],prep:["Kompresyon giysiyi sürekli takın","2–4 hafta oturma aktivitelerini kısıtlayın"],normal:["İlk haftalarda oturma rahatsızlığı olabilir","Yağ enjeksiyonunun bir kısmı emilir, bu normal","Bölgede geçici sertlik ve hassasiyet olabilir"],followup:"1., 3. ve 6. aylarda kontrol"},

  "Jinekomasti":{category:"Erkek Estetiği",desc:"Erkeklerde meme bezi büyümesinin cerrahi veya liposuction ile düzeltilmesi.",stats:[{val:"1–2 saat",lbl:"Süre"},{val:"1 gece",lbl:"Hastane"},{val:"6 hafta",lbl:"İyileşme"}],process:"Ameliyat sonrası kompresyon giysi uygulanır. İlk hafta kol hareketleri kısıtlı. 3. günden şişlik azalır.",timeline:[{time:"Ameliyat günü",emoji:"🏥",color:"#7c3aed",title:"İşlem",desc:"Genel veya sedasyon anestezi. Kompresyon giysi takılır."},{time:"1–7. gün",emoji:"💊",color:"#6d28d9",title:"Dinlenme",desc:"Kompresyon giysi sürekli. Kol hareketleri kısıtlı."},{time:"6 hafta",emoji:"✨",color:"#10b981",title:"İyileşme",desc:"Nihai sonuç oturur. Ağır spora dönüş mümkün."}],prep:["Kompresyon giysiyi sürekli takın","6 hafta ağır koldan egzersizden kaçının"],normal:["İlk hafta şişlik ve hassasiyet normaldir","Meme başı çevresinde geçici uyuşukluk olabilir","Kesi izi meme başı çevresinde gizli kalır"],followup:"1., 3. ve 6. aylarda kontrol"},

  "Meme Asimetrisinin Giderilmesi":{category:"Meme Estetiği",desc:"Memeler arasındaki boyut, şekil veya pozisyon farkının cerrahi olarak düzeltilmesi. Tek veya çift taraflı müdahale planlanabilir.",stats:[{val:"2–4 saat",lbl:"Süre"},{val:"1–2 gece",lbl:"Hastane"},{val:"6–12 ay",lbl:"Sonuç"}],process:"Ameliyat planı asimetrinin tipine göre kişiselleştirilir — tek taraflı küçültme, büyütme, dikleştirme veya kombinasyon olabilir. Destek sütyeni uygulanır. Cilt altı eriyen dikişler kullanılır.",timeline:[{time:"Ameliyat günü",emoji:"🏥",color:"#7c3aed",title:"İşlem",desc:"Genel anestezi. Asimetrinin tipine göre tek veya çift taraflı müdahale."},{time:"1–3. gün",emoji:"💊",color:"#6d28d9",title:"Dinlenme",desc:"Destek sütyeni sürekli. Kol hareketleri kısıtlı."},{time:"2–4. hafta",emoji:"🌤",color:"#0891b2",title:"Normalleşme",desc:"Şişlik azalır. Hafif aktivitelere dönüş. Memeler arasındaki fark azalmaya başlar."},{time:"3–6. ay",emoji:"🩹",color:"#059669",title:"Şekil Oturur",desc:"Şişlik tamamen geçer, dokular yerleşir."},{time:"6–12. ay",emoji:"✨",color:"#10b981",title:"Nihai Sonuç",desc:"Son simetri ortaya çıkar. Kesi izleri solmaya başlar."}],prep:["Destek sütyeni sürekli takın","4 hafta havuzdan kaçının","6 hafta ağır kol egzersizlerinden kaçının","Meme boyutları arasındaki farkı fotoğraflarla belgeleyin"],normal:["İlk haftalarda iki meme arasında şişlik farkı olabilir — bu geçicidir","Meme başı duyusunda geçici değişiklik olabilir","Kesi izleri ilk 3–4 ay belirgin olabilir","Tam simetri anatomik olarak garanti edilemez — belirgin iyileşme hedeflenir"],followup:"1., 3., 6. ve 12. aylarda kontrol"},

  "Meme Onarımı (Kanser sonrası)":{category:"Rekonstrüktif Cerrahi",desc:"Meme kanseri ameliyatı sonrası kaybedilen meme dokusunun cerrahi olarak yeniden oluşturulması. Protez veya kendi dokularınız kullanılabilir.",stats:[{val:"2–6 saat",lbl:"Süre"},{val:"2–5 gece",lbl:"Hastane"},{val:"6–12 ay",lbl:"Sonuç"}],process:"Rekonstrüksiyon yöntemi onkolojik tedavi sürecinize göre planlanır. Ekspander, silikon protez veya flep (kendi doku transferi) seçenekleri değerlendirilir. Süreç birden fazla aşama gerektirebilir.",timeline:[{time:"Ameliyat günü",emoji:"🏥",color:"#7c3aed",title:"İşlem",desc:"Genel anestezi. Yönteme göre 2–6 saat sürebilir."},{time:"1–5. gün",emoji:"💊",color:"#6d28d9",title:"Hastane Takibi",desc:"Drenler takılabilir. Ağrı yönetimi ve erken mobilizasyon."},{time:"2–6. hafta",emoji:"🌤",color:"#0891b2",title:"İyileşme",desc:"Drenler alınır. Günlük aktivitelere kademeli dönüş."},{time:"3–6. ay",emoji:"🩹",color:"#059669",title:"Şekillendirme",desc:"Gerekirse ikinci aşama (meme başı rekonstrüksiyonu, simetri düzeltmesi)."},{time:"6–12. ay",emoji:"✨",color:"#10b981",title:"Nihai Görünüm",desc:"Tüm aşamalar tamamlandığında son sonuç ortaya çıkar."}],prep:["Onkolojik tedavi ekibinizle koordinasyon sağlanacak","Destek sütyeni sürekli takın","Radyoterapi planınız varsa cerrahınıza bildirin","6 hafta ağır kol egzersizlerinden kaçının"],normal:["Rekonstrüksiyon bölgesinde uzun süreli uyuşukluk olabilir","Protez kullanıldıysa yerleşme süreci 3–6 ay sürer","Flep kullanıldıysa verici bölgede de iyileşme süreci olur","Süreç birden fazla ameliyat gerektirebilir — bu normaldir"],followup:"Onkoloji ve plastik cerrahi ekibi ile koordineli takip"},

  "Doğumsal Meme Anomalisinin Düzeltilmesi":{category:"Rekonstrüktif Cerrahi",desc:"Doğumsal meme gelişim bozukluklarının (tübüler meme, Poland sendromu, asimetri vb.) cerrahi olarak düzeltilmesi.",stats:[{val:"2–4 saat",lbl:"Süre"},{val:"1–2 gece",lbl:"Hastane"},{val:"6–12 ay",lbl:"Sonuç"}],process:"Ameliyat planı anomalinin tipine göre kişiselleştirilir. Protez, yağ enjeksiyonu, doku genişletici veya bunların kombinasyonu kullanılabilir. Birden fazla aşama gerekebilir.",timeline:[{time:"Ameliyat günü",emoji:"🏥",color:"#7c3aed",title:"İşlem",desc:"Genel anestezi. Anomali tipine göre kişiselleştirilmiş plan."},{time:"1–3. gün",emoji:"💊",color:"#6d28d9",title:"Dinlenme",desc:"Destek sütyeni uygulanır. Kol hareketleri kısıtlı."},{time:"2–6. hafta",emoji:"🌤",color:"#0891b2",title:"İyileşme",desc:"Şişlik azalır. Günlük aktivitelere kademeli dönüş."},{time:"6–12. ay",emoji:"✨",color:"#10b981",title:"Nihai Sonuç",desc:"Tüm aşamalar tamamlandığında son görünüm ortaya çıkar."}],prep:["Destek sütyeni sürekli takın","4 hafta havuzdan kaçının","6 hafta ağır kol egzersizlerinden kaçının"],normal:["Şişlik ve hassasiyet ilk haftalarda belirgin olabilir","Meme başı duyusunda geçici değişiklik olabilir","Birden fazla ameliyat aşaması gerekebilir","Kesi izleri ilk aylarda belirgin, zamanla solar"],followup:"1., 3., 6. ve 12. aylarda kontrol"},

  "Lazer Epilasyon":{category:"Lazer Tedavi",desc:"Lazer ışını kıl kökündeki melanin tarafından emilir ve ısıya dönüşerek kökü etkisiz hale getirir. Aktif büyüme evresindeki kıllar hedeflendiği için birden fazla seans gerekir. Sonuçlar cilt tipi, kıl yapısı ve hormon durumuna göre kişiden kişiye değişir.",stats:[{val:"15–60 dk",lbl:"Seans Süresi"},{val:"Ort. 6 seans",lbl:"Önerilen Seans"},{val:"4–8 hafta",lbl:"Seans Aralığı"}],process:"Lazer ışını melanin pigmentini hedefler — kıl ne kadar koyu ve ten ne kadar açıksa etki o kadar güçlüdür. Soğutma sistemli cihazlar ağrıyı azaltır. Her seans sonrası kıl yoğunluğu kademeli olarak azalır. Seans aralıkları ve enerji ayarı bölgeye göre uzman hekim tarafından belirlenir.",timeline:[{time:"1. seans",emoji:"✨",color:"#7c3aed",title:"Başlangıç",desc:"İlk uygulama. Hafif batma hissi olabilir. Kızarıklık birkaç saat sürer."},{time:"1–3. hafta",emoji:"🌱",color:"#0891b2",title:"İlk Dökülme",desc:"İşlem gören tüyler dökülmeye başlar. Çekme veya koparma yapmayın."},{time:"2–4. seans",emoji:"📉",color:"#059669",title:"Azalma Görünür",desc:"Tüy yoğunluğu belirgin şekilde azalır. Bazı bölgelerde seyrelme net."},{time:"6–10. seans",emoji:"🎯",color:"#10b981",title:"Hedef Sonuç",desc:"Kalıcı tüy azaltımı sağlanır. Yılda 1–2 idame seansı yeterli olabilir."}],prep:["4–6 hafta önce ağda, cımbız veya epilatör gibi kıl kökünü çeken uygulamalardan kaçının","Bronzlaşmaktan kaçının — ten rengi ne kadar açıksa lazer o kadar etkili","Seanstan 3 gün önce tıraş önerilir — kıl boyu 1mm kadar olmalı","Kimyasal peeling veya tüy sarartıcı uygulamalardan kaçının","Seans günü bölgeye krem, deodorant veya parfüm sürmeyin"],normal:["Hafif kızarıklık, şişlik ve geçici hassasiyet saatler–günler içinde düzelir","İlk 24–48 saat güneşten kaçının, sıcak su ve saunadan uzak durun","En az 4 hafta boyunca ağda, cımbız veya epilatör kullanmayın — tıraş güvenlidir","Parfümsüz, hipoalerjenik nemlendiriciler ve aloe vera ile cildi yatıştırın","Hormonal değişiklikler (hamilelik, ilaç) yeni kıllanma oluşturabilir — idame seansları gerekebilir","Şiddetli ağrı, kabarma veya 7 günden uzun süren reaksiyon varsa hekiminize başvurun"],followup:"Her seans öncesi kontrol"},

  "Lazer Dövme Silme":{category:"Lazer Tedavi",desc:"FDA onaylı lazer teknolojisi ile deri altındaki renk pigmentlerine nüfuz edilerek parçalanması ve bağışıklık sistemi tarafından emilmesinin sağlanması. Dövmenin rengi, büyüklüğü ve derinliği sonucu etkiler.",stats:[{val:"15–45 dk",lbl:"Seans Süresi"},{val:"6–12 seans",lbl:"Önerilen Seans"},{val:"6–8 hafta",lbl:"Seans Aralığı"}],process:"Lazer ışınları derinin üst tabakasına zarar vermeden deri altındaki pigmentlere nüfuz eder ve parçalar. Siyah ve lacivert en kolay silinen renklerdir. Beyaz, sarı, kırmızı, yeşil ve pembe zor silinir. Çizgisel dövmeler, içi dolu figürlere göre daha hızlı yanıt verir. İşlem öncesi bronzlaşmaktan kaçınmak lazerin etkinliğini artırır.",timeline:[{time:"1. seans",emoji:"✨",color:"#7c3aed",title:"Başlangıç",desc:"İlk uygulama. Batma hissi olabilir. Bölgede beyazlaşma ve hafif şişlik normal."},{time:"2–4. hafta",emoji:"🩹",color:"#0891b2",title:"İyileşme",desc:"Kabuklanma olabilir — koparmayın. Bölge kendi kendine iyileşir."},{time:"3–6. seans",emoji:"📉",color:"#059669",title:"Solma Başlar",desc:"Dövme belirgin şekilde solmaya başlar. Her seans daha fazla pigment parçalar."},{time:"6–12. seans",emoji:"🎯",color:"#10b981",title:"Hedef Sonuç",desc:"Dövmenin büyük bölümü silinir. Tam silme renk ve derinliğe bağlıdır."}],prep:["Seanstan 2–4 hafta önce bronzlaşma ve solaryumdan kaçının — ten ne kadar açıksa etki o kadar güçlü","İşlem bölgesine seanstan önce krem veya losyon sürmeyin","Kan sulandırıcı kullanıyorsanız mutlaka bildirin","Beklentilerinizi doktorunuzla netleştirin — özellikle açık renkli dövmelerde tam silme mümkün olmayabilir"],normal:["Seans sonrası beyazlaşma (frosting) görülür — bu normaldir ve 15–30 dakikada geçer","Hafif kabuklanma ve kaşıntı 1–2 hafta sürebilir — kabukları koparmayın","Siyah ve lacivert renkler en kolay, beyaz/sarı/kırmızı/yeşil en zor silinen renklerdir","Çizgisel dövmeler içi dolu figürlerden daha hızlı yanıt verir","Profesyonel dövmeler amatörlere göre daha fazla seans gerektirebilir","Alerjik reaksiyon çok nadir görülür ama oluşursa hekiminize başvurun"],followup:"Her seans öncesi kontrol — ilerleme değerlendirmesi"},

  "Cilt Yenileme (Rejuvenasyon)":{category:"Lazer Tedavi",desc:"Fraksiyonel CO2 lazer ile ciltte mikroskobik kanallar oluşturularak doğal iyileşme mekanizması ve kolajen üretimi tetiklenir. Cilt gençleştirme (anti-aging), akne izi, çatlak ve leke tedavisinde etkilidir.",stats:[{val:"30–60 dk",lbl:"Seans Süresi"},{val:"3–6 seans",lbl:"Önerilen Seans"},{val:"4–6 hafta",lbl:"Seans Aralığı"}],process:"Fraksiyonel CO2 lazer ciltte mikroskobik kanallar şeklinde kontrollü hasar oluşturarak cildin doğal iyileşme mekanizmasını tetikler. Bu süreç yeni kolajen üretimini uyarır ve cilt yenilenmesini sağlar. Kısa iyileşme süresi, yüksek hasta memnuniyeti ve uzun vadeli sonuçları ile öne çıkar. Kişiye özel protokollerle uygulanır.",timeline:[{time:"Seans günü",emoji:"✨",color:"#7c3aed",title:"Uygulama",desc:"Topikal anestezi ile ağrısız. Seans sonrası kızarıklık ve hafif yanma hissi normal."},{time:"3–7. gün",emoji:"🩹",color:"#0891b2",title:"İyileşme",desc:"Cilt soyulabilir, kızarıklık azalır. Nemlendirici ve güneş koruma kritik."},{time:"2–4. hafta",emoji:"🌱",color:"#059669",title:"Yenilenme Başlar",desc:"Yeni kolajen üretimi başlar. Cilt dokusu belirgin iyileşir."},{time:"3–6. ay",emoji:"🎯",color:"#10b981",title:"Nihai Sonuç",desc:"Kolajen yenilenmesi tamamlanır. Cilt tonu ve dokusu belirgin iyileşir."}],prep:["Seanstan 1 hafta önce retinol ve AHA/BHA kullanımını durdurun","Güneşten korunun — işlem öncesi ve sonrası SPF 50 kullanın","Seans günü makyajsız gelin","Aktif herpes veya cilt enfeksiyonunda seans ertelenir"],normal:["Seans sonrası 1–3 gün kızarıklık ve hafif şişlik","Cilt soyulması (peeling) 3–7 gün sürebilir","Güneşe karşı hassasiyet artabilir — koruma şart","Sonuç kademeli gelir, sabır gerektirir"],followup:"Her seans öncesi cilt değerlendirmesi"},

  "Karbon Peeling":{category:"Lazer Tedavi",desc:"Yüze karbon losyonu sürülüp lazer ile aktive edilerek gözeneklerin temizlenmesi, cilt tonunun eşitlenmesi ve yağlanmanın kontrol altına alınması.",stats:[{val:"20–30 dk",lbl:"Seans Süresi"},{val:"4–6 seans",lbl:"Önerilen Seans"},{val:"2–4 hafta",lbl:"Seans Aralığı"}],process:"Yüze karbon losyonu sürülür, lazer ışığı karbon parçacıklarını patlatarak gözeneklerdeki kiri ve ölü deriyi temizler. İşlem sonrası cilt hemen daha parlak görünür.",timeline:[{time:"Seans günü",emoji:"✨",color:"#7c3aed",title:"Uygulama",desc:"20–30 dk. Ağrısız. Hafif gıdıklanma hissi. Anestezi gerektirmez."},{time:"Hemen sonra",emoji:"🌟",color:"#0891b2",title:"Anlık Parlama",desc:"Cilt hemen daha parlak ve pürüzsüz görünür. Hafif kızarıklık olabilir."},{time:"1–2. hafta",emoji:"🌱",color:"#059669",title:"İyileşme",desc:"Gözenekler küçülmeye başlar. Yağlanma azalır."},{time:"4–6. seans",emoji:"🎯",color:"#10b981",title:"Kümülatif Etki",desc:"Her seansta cilt kalitesi artar. Düzenli bakım ile kalıcı sonuç."}],prep:["Seans günü makyajsız gelin","Aktif akne veya cilt enfeksiyonunda seans ertelenir","İşlem sonrası 24 saat makyaj yapmayın","Güneş koruma kullanın"],normal:["İşlem sırasında hafif ısı hissi ve gıdıklanma","Seans sonrası hafif kızarıklık (birkaç saat)","Sonuç kümülatiftir — tek seansta dramatik değişim beklenmemeli","Yağlı ciltlerde sonuçlar daha belirgindir"],followup:"Her seans öncesi cilt kontrolü"},

  "Lazer Leke Tedavisi":{category:"Lazer Tedavi",desc:"Cildin rengini veren melanin pigmentlerinin belirli bölgelerde aşırı yoğunlaşmasıyla oluşan lekelerin lazer ile hedeflenerek açılması. Güneş lekeleri, hormonal lekeler, yaşlanma belirtileri ve akne izleri tedavi edilebilir.",stats:[{val:"15–30 dk",lbl:"Seans Süresi"},{val:"1–4 seans",lbl:"Önerilen Seans"},{val:"4–6 hafta",lbl:"Seans Aralığı"}],process:"Lazer ışınları cildin üst tabakasına kontrollü şekilde uygulanarak lekeli bölgelerdeki melanin yoğunluğunu azaltır. Tedavi önce uzman hekim tarafından yapılan cilt analizi ile başlar — lekelerin türü ve derinliği belirlendikten sonra kişiye özel plan hazırlanır. Lazer, kimyasal peeling veya medikal cilt bakımı tek başına ya da kombine kullanılabilir.",timeline:[{time:"Seans günü",emoji:"✨",color:"#7c3aed",title:"Uygulama",desc:"15–30 dk. Hafif batma hissi. İşlem sonrası leke bölgesinde koyulaşma normal."},{time:"3–7. gün",emoji:"🩹",color:"#0891b2",title:"Kabuklanma",desc:"Leke bölgesinde kabuklanma olur — koparmayın, kendi kendine dökülür."},{time:"2–4. hafta",emoji:"🌱",color:"#059669",title:"Açılma Başlar",desc:"Kabuk döküldükten sonra altından daha açık cilt çıkar."},{time:"1–3. ay",emoji:"🎯",color:"#10b981",title:"Nihai Sonuç",desc:"Leke belirgin şekilde açılır veya tamamen kaybolur. Güneş koruması kalıcı sonuç için şart."}],prep:["Güneş kremini kış aylarında bile yıl boyunca kullanın — SPF 30+ şart","Bronzlaşma ve solaryumdan kaçının","Seanstan 1 hafta önce retinol ve beyazlatıcı kremler bırakılmalı","Hamilelik döneminde veya hormon ilaçları kullanırken ekstra önlem alın","Cilt tipinizi, leke geçmişinizi ve hormon durumunuzu doktorunuzla paylaşın"],normal:["İşlem sonrası leke bölgesi geçici olarak koyulaşabilir — bu beklenen bir reaksiyon","Hafif kızarıklık kısa sürede geçer","Östrojen hormonu lekelenmelerde önemli rol oynar — kadınlarda erkeklere göre daha sık görülür","Hamilelik, doğum kontrol hapları ve hormon ilaçları leke oluşumunu tetikleyebilir","Güneş koruması olmadan lekeler tekrar oluşabilir — tedavi sonrası SPF kullanımı kalıcı olmalı","Düzenli seanslar ve doğru bakım ile kalıcı sonuçlar mümkündür"],followup:"Her seans öncesi leke değerlendirmesi — SPF kullanımı kontrolü"},

  "Kaş Kaldırma":{category:"Yüz Estetiği",desc:"Düşük kaş pozisyonunun cerrahi veya endoskopik yöntemlerle kaldırılarak daha genç ve dinamik bir üst yüz görünümü sağlanması.",stats:[{val:"1–2 saat",lbl:"Süre"},{val:"Günübirlik",lbl:"Hastane"},{val:"2–4 hafta",lbl:"İyileşme"}],process:"Endoskopik veya açık teknikle kaş pozisyonu yukarı taşınır. Saç çizgisi içinden yapılan kesilerle iz minimumda tutulur.",timeline:[{time:"İşlem günü",emoji:"🏥",color:"#7c3aed",title:"İşlem",desc:"Sedasyon veya genel anestezi. 1–2 saat."},{time:"1–7. gün",emoji:"💊",color:"#6d28d9",title:"Dinlenme",desc:"Şişlik ve morluk normal. Soğuk kompres yardımcı."},{time:"2–4. hafta",emoji:"🌤",color:"#0891b2",title:"İyileşme",desc:"Şişlik büyük ölçüde geçer. Sosyal hayata dönüş."},{time:"3–6. ay",emoji:"✨",color:"#10b981",title:"Nihai Sonuç",desc:"Kaş pozisyonu oturur, sonuç netleşir."}],prep:["Kan sulandırıcılar 1 hafta önce kesilmeli","Sigara 2 hafta önce bırakılmalı"],normal:["İlk hafta şişlik ve morluk beklenir","Geçici uyuşukluk alın bölgesinde olabilir","Kesi izleri saç çizgisi içinde gizlenir"],followup:"1., 3. ve 6. aylarda kontrol"},

  "Yanak Estetiği (Bişektomi)":{category:"Yüz Estetiği",desc:"Yanak iç kısmındaki yağ dokusunun (buccal fat pad) alınarak yüze daha belirgin bir kontür kazandırılması.",stats:[{val:"30–60 dk",lbl:"Süre"},{val:"Günübirlik",lbl:"Hastane"},{val:"2–3 hafta",lbl:"İyileşme"}],process:"Ağız içinden yapılan küçük bir kesiyle yanak yağ yastıkçığı çıkarılır. Dışarıdan görünür iz kalmaz.",timeline:[{time:"İşlem günü",emoji:"🏥",color:"#7c3aed",title:"İşlem",desc:"Lokal anestezi yeterli. 30–60 dk."},{time:"1–3. gün",emoji:"💊",color:"#6d28d9",title:"Dinlenme",desc:"Şişlik ve hassasiyet normal. Yumuşak gıdalar tercih edin."},{time:"2–3. hafta",emoji:"🌤",color:"#0891b2",title:"İyileşme",desc:"Şişlik azalır, yüz kontürü belirginleşmeye başlar."},{time:"3–6. ay",emoji:"✨",color:"#10b981",title:"Nihai Sonuç",desc:"Yüz incelmesi ve kontür netleşir."}],prep:["İşlem öncesi ağız hijyeni önemli","Kan sulandırıcılar 1 hafta önce kesilmeli"],normal:["İlk hafta yanak içinde şişlik ve hassasiyet","Yumuşak gıdalarla beslenme önerilir","Sonuç kademeli gelir — 3 ay sabır gerekir"],followup:"1. ve 3. aylarda kontrol"},

  "Kepçe Kulak Tedavisi":{category:"Yüz Estetiği",desc:"Kepçe kulak deformitesinin cerrahi olarak düzeltilerek kulakların başa daha yakın pozisyona getirilmesi.",stats:[{val:"1–1.5 saat",lbl:"Süre"},{val:"Günübirlik",lbl:"Hastane"},{val:"2–3 hafta",lbl:"İyileşme"}],process:"Kulak arkasından yapılan kesiyle kıkırdak şekillendirilir ve kulak başa yaklaştırılır. Cilt altı dikişler kullanılır.",timeline:[{time:"İşlem günü",emoji:"🏥",color:"#7c3aed",title:"İşlem",desc:"Lokal veya genel anestezi. 1–1.5 saat."},{time:"1–7. gün",emoji:"💊",color:"#6d28d9",title:"Dinlenme",desc:"Bandaj takılır. Ağrı hafif, ağrı kesici yeterli."},{time:"2–3. hafta",emoji:"🌤",color:"#0891b2",title:"İyileşme",desc:"Bandaj çıkar. Gece bandı 4–6 hafta önerilir."},{time:"2–3. ay",emoji:"✨",color:"#10b981",title:"Nihai Sonuç",desc:"Kulak pozisyonu oturur, iz solar."}],prep:["Saçları yıkayarak gelin","İşlem sonrası gece bandı hazır olsun"],normal:["İlk hafta hafif ağrı ve şişlik","Kulak arkası iz zamanla solar","6 hafta gece bandı takılması önerilir"],followup:"1. hafta, 1. ve 3. aylarda kontrol"},

  "Yüz Yağ Enjeksiyonu":{category:"Yüz Estetiği",desc:"Vücudun başka bir bölgesinden alınan yağ dokusunun işlenerek yüze enjekte edilmesi. Hacim kaybı, çöküntü ve kırışıklıklarda doğal dolgunluk sağlar.",stats:[{val:"1–2 saat",lbl:"Süre"},{val:"Günübirlik",lbl:"Hastane"},{val:"2–4 hafta",lbl:"İyileşme"}],process:"Karın veya bel bölgesinden liposuction ile yağ alınır, santrifüjle işlenir ve yüze ince kanüllerle enjekte edilir. Kendi dokununuz olduğu için alerjik reaksiyon riski yoktur.",timeline:[{time:"İşlem günü",emoji:"🏥",color:"#7c3aed",title:"İşlem",desc:"Sedasyon veya genel anestezi. 1–2 saat."},{time:"1–7. gün",emoji:"💊",color:"#6d28d9",title:"Dinlenme",desc:"Yüzde şişlik ve morluk normal. Soğuk kompres yardımcı."},{time:"2–4. hafta",emoji:"🌤",color:"#0891b2",title:"İyileşme",desc:"Şişlik azalır. Yağın bir kısmı emilir — bu beklenir."},{time:"3–6. ay",emoji:"✨",color:"#10b981",title:"Nihai Sonuç",desc:"Kalan yağ kalıcıdır. Doğal dolgunluk oturur."}],prep:["Kan sulandırıcılar 1 hafta önce kesilmeli","Sigara 2 hafta önce bırakılmalı"],normal:["İlk hafta belirgin şişlik ve morluk","Enjekte edilen yağın %30–50'si emilir — bu normal","Sonuç 3 ayda netleşir"],followup:"1., 3. ve 6. aylarda kontrol"},

  "Genital Estetik":{category:"Genital Estetik",desc:"Genital bölgedeki estetik ve fonksiyonel sorunların cerrahi olarak düzeltilmesi. Doğum sonrası veya yaşlanmaya bağlı değişiklikleri kapsar.",stats:[{val:"1–2 saat",lbl:"Süre"},{val:"Günübirlik",lbl:"Hastane"},{val:"3–4 hafta",lbl:"İyileşme"}],process:"İşlem türüne göre lokal veya genel anestezi uygulanır. Eriyen dikişler kullanılır.",timeline:[{time:"İşlem günü",emoji:"🏥",color:"#7c3aed",title:"İşlem",desc:"Lokal veya genel anestezi."},{time:"1–7. gün",emoji:"💊",color:"#6d28d9",title:"Dinlenme",desc:"Hassasiyet ve hafif şişlik normal."},{time:"3–4. hafta",emoji:"🌤",color:"#0891b2",title:"İyileşme",desc:"Dikişler erir. Günlük aktivitelere dönüş."},{time:"2–3. ay",emoji:"✨",color:"#10b981",title:"Nihai Sonuç",desc:"Tam iyileşme ve sonuç."}],prep:["Bölge hijyeni önemli","İşlem öncesi tıraş önerilir"],normal:["İlk hafta hassasiyet ve şişlik","Eriyen dikişler 2–3 haftada absorbe olur","4–6 hafta cinsel ilişkiden kaçınılmalı"],followup:"1. hafta ve 1. ayda kontrol"},

  "Labioplasti":{category:"Genital Estetik",desc:"Labium minörlerin (iç dudakların) estetik veya fonksiyonel nedenlerle küçültülmesi veya şekillendirilmesi.",stats:[{val:"45–90 dk",lbl:"Süre"},{val:"Günübirlik",lbl:"Hastane"},{val:"3–4 hafta",lbl:"İyileşme"}],process:"Lokal veya genel anestezi ile fazla doku çıkarılır, eriyen dikişlerle kapatılır. Dışarıdan görünür iz kalmaz.",timeline:[{time:"İşlem günü",emoji:"🏥",color:"#7c3aed",title:"İşlem",desc:"Lokal veya genel anestezi. 45–90 dk."},{time:"1–7. gün",emoji:"💊",color:"#6d28d9",title:"Dinlenme",desc:"Şişlik ve hassasiyet normal. Rahat iç çamaşırı tercih edin."},{time:"3–4. hafta",emoji:"🌤",color:"#0891b2",title:"İyileşme",desc:"Dikişler erir. Günlük aktivitelere dönüş."},{time:"2–3. ay",emoji:"✨",color:"#10b981",title:"Nihai Sonuç",desc:"Tam iyileşme. Estetik ve fonksiyonel sonuç oturur."}],prep:["Bölge hijyeni önemli","Kan sulandırıcılar 1 hafta önce kesilmeli"],normal:["İlk hafta şişlik, hassasiyet ve hafif kanama olabilir","Eriyen dikişler 2–3 haftada absorbe olur","4–6 hafta cinsel ilişki ve ağır egzersizden kaçınılmalı"],followup:"1. hafta ve 1. ayda kontrol"},

  "Göz Altı Işık Dolgusu":{category:"Medikal Estetik",desc:"Hyalüronik asit bazlı dolgu ile göz altı çöküklüğü, morluk görünümü ve hacim kaybının giderilmesi.",stats:[{val:"15–30 dk",lbl:"Süre"},{val:"Anında",lbl:"Sonuç"},{val:"12–18 ay",lbl:"Etki Süresi"}],process:"İnce kanülle göz altı bölgesine dolgu enjekte edilir. Anında sonuç görülür. Lokal anestezik krem yeterlidir.",timeline:[{time:"İşlem günü",emoji:"✨",color:"#7c3aed",title:"Uygulama",desc:"15–30 dk. Hafif batma hissi. Hemen sonuç görülür."},{time:"1–3. gün",emoji:"💊",color:"#0891b2",title:"Hafif Şişlik",desc:"Göz altında hafif şişlik olabilir. Soğuk kompres yardımcı."},{time:"1–2. hafta",emoji:"🌤",color:"#059669",title:"Oturma",desc:"Dolgu yerleşir, doğal görünüm oturur."},{time:"12–18. ay",emoji:"🔄",color:"#d97706",title:"İdame",desc:"Etki azalmaya başlar. Tekrar seans planlanabilir."}],prep:["Kan sulandırıcılar ve aspirin 1 hafta önce kesilmeli","İşlem günü makyajsız gelin"],normal:["İşlem sonrası hafif şişlik ve morluk olabilir (1–3 gün)","Dolgu 1–2 haftada tamamen oturur","Sonuç 12–18 ay sürer, kişiye göre değişir"],followup:"2 hafta sonra kontrol"},

  "Nano Yağ Enjeksiyonu":{category:"Medikal Estetik",desc:"Vücuttan alınan yağın nano boyutta işlenerek yüz, göz altı ve ince cilt bölgelerine enjeksiyonu. Klasik yağ enjeksiyonundan daha ince ve hassas uygulama.",stats:[{val:"1–1.5 saat",lbl:"Süre"},{val:"Günübirlik",lbl:"Hastane"},{val:"2–3 hafta",lbl:"İyileşme"}],process:"Micro-liposuction ile alınan yağ özel filtrelerle nano boyuta küçültülür. Çok ince kanüllerle hassas bölgelere enjekte edilir. Kendi dokununuz olduğu için alerjik reaksiyon riski yoktur.",timeline:[{time:"İşlem günü",emoji:"🏥",color:"#7c3aed",title:"İşlem",desc:"Lokal veya sedasyon anestezi."},{time:"1–7. gün",emoji:"💊",color:"#6d28d9",title:"Dinlenme",desc:"Hafif şişlik ve morluk. Soğuk kompres."},{time:"2–3. hafta",emoji:"🌤",color:"#0891b2",title:"İyileşme",desc:"Şişlik geçer, sonuç belirginleşir."},{time:"3–6. ay",emoji:"✨",color:"#10b981",title:"Nihai Sonuç",desc:"Kalan yağ kalıcıdır."}],prep:["Kan sulandırıcılar 1 hafta önce kesilmeli","Sigara iyileşmeyi yavaşlatır"],normal:["Yağ alınan ve enjekte edilen bölgede şişlik normal","Enjekte edilen yağın bir kısmı emilir","Sonuç 3 ayda netleşir"],followup:"1. ve 3. aylarda kontrol"},

  "Mezoterapi":{category:"Medikal Estetik",desc:"Vitamin, mineral, aminoasit ve hyalüronik asit karışımının cilt altına mikro enjeksiyonlarla verilmesi. Cilt yenileme, nemlendirme ve saç dökülmesi tedavisinde kullanılır.",stats:[{val:"15–30 dk",lbl:"Seans Süresi"},{val:"4–6 seans",lbl:"Önerilen Seans"},{val:"2–4 hafta",lbl:"Seans Aralığı"}],process:"Özel mezoterapi iğneleri veya mezogun ile aktif madde karışımı cilt altına verilir. İşlem hızlı ve pratiktir.",timeline:[{time:"Seans günü",emoji:"✨",color:"#7c3aed",title:"Uygulama",desc:"15–30 dk. Hafif batma hissi. Anestezi genellikle gerekmez."},{time:"1–2. gün",emoji:"💊",color:"#0891b2",title:"Hafif Kızarıklık",desc:"İğne izleri ve hafif kızarıklık normal. Birkaç saatte geçer."},{time:"3–4. seans",emoji:"🌱",color:"#059669",title:"Etki Başlar",desc:"Cilt kalitesi ve nemi belirgin artar."},{time:"6+. seans",emoji:"🎯",color:"#10b981",title:"Kümülatif Sonuç",desc:"Düzenli seanslarla kalıcı cilt kalitesi iyileşmesi."}],prep:["Seans günü makyajsız gelin","Aktif cilt enfeksiyonunda seans ertelenir"],normal:["İğne izlerinde kısa süreli kızarıklık","Nadir morluk olabilir","Sonuç kümülatiftir — düzenli seanslar gerekir"],followup:"Her seans öncesi cilt değerlendirmesi"},

  "Lazer Saç Tedavisi":{category:"Lazer Tedavi",desc:"Lazer destekli saç tedavisi, saç dökülmesini azaltarak saç köklerini uyarır ve daha sağlıklı saç büyümesini destekler. PRP ve mezoterapi ile kombine edilebilir.",stats:[{val:"20–40 dk",lbl:"Seans Süresi"},{val:"6–12 seans",lbl:"Önerilen Seans"},{val:"2–4 hafta",lbl:"Seans Aralığı"}],process:"Düşük yoğunluklu lazer ışığı saç köklerine uygulanarak hücresel aktivite ve kan dolaşımı artırılır. Tek başına veya PRP/mezoterapi ile kombine uygulanabilir.",timeline:[{time:"1. seans",emoji:"✨",color:"#7c3aed",title:"Başlangıç",desc:"Ağrısız uygulama. Herhangi bir iyileşme süresi yok."},{time:"2–4. seans",emoji:"🌱",color:"#0891b2",title:"Dökülme Azalır",desc:"Saç dökülmesinde yavaşlama başlar."},{time:"6–8. seans",emoji:"📈",color:"#059669",title:"Yeni Büyüme",desc:"İnce yeni saçlar görülmeye başlar."},{time:"12+. seans",emoji:"🎯",color:"#10b981",title:"Güçlenme",desc:"Saç kalınlığı ve yoğunluğu artar. İdame seansları önerilir."}],prep:["Saç derisinin temiz olması önemli","Aktif saç derisi enfeksiyonunda seans ertelenir","Kullandığınız ilaçları doktorunuza bildirin"],normal:["İşlem ağrısız — herhangi bir yan etki beklenmez","Sonuçlar kademeli gelir, sabır gerektirir","Genetik saç dökülmesinde sonuçlar kişiye göre değişir","PRP/mezoterapi kombine edildiğinde daha iyi sonuç alınabilir"],followup:"Her 3 seansta bir değerlendirme"},
};

function PatientForm({doctorId}){
  const [currentQ,setCurrentQ]=useState(0);
  const [answers,setAnswers]=useState({});
  const [submitted,setSubmitted]=useState(false);
  const [kvkkConsent,setKvkkConsent]=useState(false);
  const [submitting,setSubmitting]=useState(false);
  const [lang,setLang]=useState("tr"); // tr | en

  // İngilizce çeviriler

  // Stat label çevirileri
  const STAT_EN={"Süre":"Duration","İyileşme":"Recovery","Sonuç":"Result","Hastane":"Hospital","Anestezi":"Anesthesia","Bantlar Alınır":"Bandages Removed","Etki Başlar":"Effect Begins","Etki Süresi":"Effect Duration","Seans Süresi":"Session Duration","Önerilen Seans":"Recommended Sessions","Seans Aralığı":"Session Interval","Ort. 6 seans":"Avg. 6 sessions"};
  const CAT_EN={"Estetik Cerrahi":"Aesthetic Surgery","Yüz Estetiği":"Facial Aesthetics","Vücut Şekillendirme":"Body Contouring","Meme Estetiği":"Breast Aesthetics","Erkek Estetiği":"Male Aesthetics","Medikal Estetik":"Medical Aesthetics","Lazer Tedavi":"Laser Treatment","Rekonstrüktif Cerrahi":"Reconstructive Surgery","Genital Estetik":"Genital Aesthetics"};
  const EN={
    ui:{next:"Continue →",submit:"Submit Form →",submitting:"Submitting...",back:"← Back",question:"Q",
      welcome:"Welcome",welcomeDesc:"This short form helps us understand your expectations so we can plan the best and safest approach for you.",
      kvkk:"I consent to the processing of my personal and health data solely for the purpose of planning my consultation. My data is stored encrypted and is not shared with third parties.",
      submitError:"Form could not be saved. Please check your internet connection and try again.",
      thankYou:"Thank you,",thankYouSub:"we're glad you're here.",
      infoShared:"Your information has been shared with your doctor",
      consultPrep:"A personalized consultation will be prepared for you.",
      prepTitle:"How to Prepare",normalTitle:"What to Expect",timelineTitle:"Your Journey",processTitle:"About the Procedure",
      followupTitle:"Follow-up",statsTitle:"Key Facts",
      guideTitle:"Your Personal Guide",guideLoading:"Preparing your personal guide...",
      referralTitle:"Referral Program",referralDesc:"Recommend us to a friend",referralCode:"Your referral code",
      },
    sections:{
      "Kişisel Bilgiler":"Personal Info",
      "İşlem Bilgisi":"Procedure Info",
      "Motivasyon & Beklenti":"Motivation & Expectations",
      "Kendinizi Tanıyın":"About Yourself",
      "Karar Süreci":"Decision Process",
      "Geçmiş Deneyimler":"Past Experiences",
      "Klinik Geçmiş":"Clinical History",
      "Süreç Farkındalığı":"Process Awareness",
      "Hasta Profili":"Patient Profile",
      "İletişim":"Contact",
      "Size Bir Sorum Var":"One More Question",
    },
    q:{
      name:{label:"What is your name?"},
      age:{label:"How old are you?"},
      gender:{label:"What is your gender?",options:{"Kadın":"Female","Erkek":"Male","Belirtmek istemiyorum":"Prefer not to say"}},
      procedure:{label:"Which procedure are you interested in?"},
      otherAreas:{label:"Are there other areas of your body you're concerned about?",options:{
        "Hayır, sadece bu bölge":"No, only this area",
        "Evet, 1-2 bölge daha var ama önceliğim bu":"Yes, 1-2 more areas but this is my priority",
        "Evet, birkaç bölge var, hepsini konuşmak isterim":"Yes, several areas, I'd like to discuss all of them",
        "Henüz bilmiyorum, doktorun önerilerine açığım":"I'm not sure yet, open to doctor's suggestions"}},
      rhinoVision:{label:"When you imagine the result, what do you see?",options:{
        "Doktorum benim yüz yapıma en uygun olanı belirlesin":"I want my doctor to determine what suits my face best",
        "Burnumda beni rahatsız eden belirli bir şeyi düzeltmek istiyorum":"I want to fix a specific thing about my nose",
        "Aklımda net bir görünüm var, buna ulaşmak istiyorum":"I have a clear vision, I want to achieve it",
        "Aklımda belirli bir referans var — bir ünlü veya fotoğraf":"I have a specific reference — a celebrity or photo"}},
      breastSymmetry:{label:"How would you describe the difference between your breasts?",options:{
        "Fark var ama beni pek rahatsız etmiyor, ameliyatla düzelsin istiyorum":"There's a difference but it doesn't bother me much",
        "Belirgin bir fark var ve bu beni çok rahatsız ediyor":"There's a noticeable difference and it bothers me a lot",
        "Çok küçük bir fark var ama bu küçük fark bile beni rahatsız ediyor":"Even a very small difference bothers me",
        "Fark olduğunu düşünmüyorum, sadece küçültmek/büyütmek istiyorum":"I don't see a difference, just want to resize"}},
      bddScreen:{label:"How do thoughts about your appearance affect your daily life?",options:{
        "Pek etkilemiyor, bazen düşünüyorum":"Not much, I think about it sometimes",
        "Sıkça düşünüyorum ama hayatımı yönlendirmiyor":"I think about it often but it doesn't control my life",
        "Günde saatlerce düşünüyorum, sosyal hayatımı etkiliyor":"I think about it for hours daily, it affects my social life",
        "Tamamen ele geçirdi, kaçınma davranışlarım var":"It has completely taken over, I have avoidance behaviors"}},
      source:{label:"How did you hear about us?",options:{
        "Instagram":"Instagram","Google / arama":"Google / search","Hasta tavsiyesi":"Patient referral","Doktor / klinik tavsiyesi":"Doctor / clinic referral","Diğer sosyal medya (TikTok/YouTube)":"Other social media (TikTok/YouTube)","Diğer":"Other"}},
      motivation:{label:"What is your primary motivation for this procedure?",options:{
        "Kendim için daha iyi hissetmek istiyorum":"I want to feel better about myself",
        "Özgüvenimi artırmak istiyorum":"I want to boost my self-confidence",
        "Yakınlarımın yorumları etkili oldu":"My family/friends' opinions influenced me",
        "Hayatımın daha iyi gideceğini düşünüyorum":"I think my life will improve"}},
      expectation:{label:"What result do you expect from the procedure?",options:{
        "Küçük, doğal bir iyileştirme yeterli":"A small, natural improvement is enough",
        "Dengeli ve orantılı bir sonuç bekliyorum":"I expect a balanced and proportional result",
        "Belirgin bir fark olmasını istiyorum":"I want a noticeable difference",
        "Tamamen farklı bir görünüm istiyorum":"I want a completely different look"}},
      decisionDuration:{label:"How long have you been thinking about this procedure?",options:{
        "Yeni karar verdim — heyecanlı ve kararlı hissediyorum":"I just decided — I feel excited and determined",
        "Birkaç aydır düşünüyorum — hazır olduğumu hissediyorum":"Been thinking for a few months — I feel ready",
        "1 yılı aşkın süredir düşünüyorum — artık harekete geçme zamanı":"Over a year — it's time to take action",
        "Uzun süredir düşünüyorum ama hâlâ kararsız hissediyorum":"Been thinking for a long time but still feel undecided"}},
      prevSurgery:{label:"Have you had aesthetic surgery before?",options:{
        "Hayır":"No, this is my first time",
        "Evet ve memnunum":"Yes, and I was satisfied",
        "Evet ama beklentimi karşılamadı":"Yes, but it didn't meet my expectations",
        "Evet ve hiç memnun değilim":"Yes, and I'm not satisfied at all"}},
      multiDoctor:{label:"How many doctors have you consulted?",options:{
        "Hayır":"This is my first consultation",
        "1-2 doktorla görüştüm":"I've consulted 1-2 doctors",
        "Birçok doktorla görüştüm":"I've consulted many doctors"}},
      riskKnowledge:{label:"How informed are you about the risks?",options:{
        "Hiçbir bilgim yok":"I have no knowledge",
        "Genel olarak bilgi sahibiyim":"I have general knowledge",
        "Detaylı araştırdım ve biliyorum":"I've researched in detail and I know the risks"}},
      support:{label:"Who knows about your decision?",options:{
        "Evet, destekliyorlar":"Yes, they support me",
        "Biliyorlar ama kararsızlar":"They know but are unsure",
        "Karşılar":"They're against it",
        "Kimseye söylemedim":"I haven't told anyone"}},
      revision:{label:"How do you feel about the possibility of revision?",options:{
        "Evet, olası revizyonu normal karşılarım":"I accept it as normal — every surgery has risks",
        "Revizyon beni endişelendiriyor":"It worries me but I still want to proceed",
        "Kusursuz sonuç bekliyorum":"I expect a perfect result"}},
      sharing:{label:"Would you share a positive experience with others?",options:{
        "Evet, açıkça paylaşırım":"Yes, I'd share openly",
        "Sadece çok yakınlarımla":"Only with close friends/family",
        "Hayır, paylaşmam":"No, I wouldn't share"}},
      phone:{label:"Your phone number (for appointment)"},
      openStory:{label:"Is there anything else you'd like to share? (Optional)"},
    },
    // Prosedür isimleri
    procs:{
      "Meme Küçültme":"Breast Reduction","Meme Büyütme (Silikon Protez ile)":"Breast Augmentation (Silicone Implant)","Meme Dikleştirme":"Breast Lift","Meme Asimetrisinin Giderilmesi":"Breast Asymmetry Correction","Meme Onarımı (Kanser sonrası)":"Breast Reconstruction (Post-cancer)","Doğumsal Meme Anomalisinin Düzeltilmesi":"Congenital Breast Anomaly Correction",
      "Jinekomasti":"Gynecomastia","Burun Estetiği":"Rhinoplasty","Yüz Germe":"Facelift","Kaş Kaldırma":"Brow Lift","Üst Göz Kapağı Estetiği":"Upper Eyelid Surgery","Alt Göz Kapağı Estetiği":"Lower Eyelid Surgery","Yanak Estetiği (Bişektomi)":"Buccal Fat Removal","Kepçe Kulak Tedavisi":"Otoplasty","Yüz Yağ Enjeksiyonu":"Facial Fat Transfer",
      "Botoks Uygulaması":"Botox","Dolgu Uygulaması":"Dermal Filler","Göz Altı Işık Dolgusu":"Under-Eye Light Filler","Nano Yağ Enjeksiyonu":"Nano Fat Injection","Mezoterapi":"Mesotherapy",
      "Karın Germe":"Tummy Tuck","Liposuction":"Liposuction","Uyluk veya Kol germe":"Thigh or Arm Lift","Popo estetiği":"Buttock Aesthetics",
      "Genital Estetik":"Genital Aesthetics","Labioplasti":"Labiaplasty",
      "Lazer Epilasyon":"Laser Hair Removal","Lazer Dövme Silme":"Laser Tattoo Removal","Cilt Yenileme (Rejuvenasyon)":"Skin Rejuvenation","Karbon Peeling":"Carbon Peeling","Lazer Leke Tedavisi":"Laser Spot Treatment","Lazer Saç Tedavisi":"Laser Hair Treatment",
    },
    procInfo:{
      "default":{
        desc:"Our expert team will prepare a personalized plan for you.",
        stats:[{val:"Variable",lbl:"Duration"},{val:"Variable",lbl:"Recovery"},{val:"6–12 months",lbl:"Result"}],
        timeline:[
          {time:"Surgery day",title:"Surgery & Recovery",desc:"Our team will keep you informed throughout the process."},
          {time:"First week",title:"Healing begins",desc:"Rest and following your doctor's instructions are critical during this period."},
          {time:"6–12 months",title:"Final result",desc:"The final shape emerges gradually over time."}
        ],
        prep:["Inform your doctor about all medications you are taking","Write down your questions for the consultation"],
        normal:["Mild swelling and discomfort may occur in the first few days","Swelling begins to subside from day 3 onward"],
        followup:"Follow-up appointments"
      },
      "Burun Estetiği":{
        desc:"Correcting the size and shape of the nose to improve both appearance and breathing issues.",
        stats:[{val:"1.5–2 hours",lbl:"Duration"},{val:"1–2 weeks",lbl:"Recovery"},{val:"6–12 months",lbl:"Result"}],
        timeline:[
          {time:"Surgery day",title:"Surgery & Recovery",desc:"1.5–2 hour procedure. A thermoplastic splint and packing will be placed on your nose."},
          {time:"Day 1–2",title:"Rest & Cold Compress",desc:"Apply cold compresses for 15 min every 2 hours to reduce swelling. Packing is removed during this period."},
          {time:"Day 3–7",title:"Bruising Fades",desc:"Swelling and bruising diminish rapidly. Daily activities can be gradually resumed."},
          {time:"Week 1–2",title:"Splint Removed",desc:"The splint is removed and thin tape is applied for about one more week. The general shape of your nose becomes visible."},
          {time:"Month 6–12",title:"Final Result",desc:"Your nose takes its final shape. Before-and-after comparisons can be made."}
        ],
        prep:["Avoid contact sports and wearing glasses for the first 2 weeks after surgery","Avoid sauna, tanning beds, and sun exposure for 8 weeks","Swimming and individual sports may be resumed from week 2 onward","Write down your questions for the consultation"],
        normal:["Mild nausea and dizziness may occur in the first few days","Slight drainage from the nose is normal in the first 24–48 hours","Your nose may appear more swollen in the morning and decrease throughout the day","Mild numbness at the tip of the nose may persist for several months"],
        followup:"Follow-up at 1, 3, 6, and 12 months"
      },
      "Karın Germe":{
        desc:"A surgical procedure that removes excess fat and sagging skin from the mid and lower abdomen while tightening the abdominal muscles.",
        stats:[{val:"2–5 hours",lbl:"Duration"},{val:"2–3 nights",lbl:"Hospital"},{val:"6 weeks",lbl:"Recovery"}],
        timeline:[
          {time:"Surgery day",title:"Procedure",desc:"2–5 hours. Drains are placed and an abdominal binder is applied."},
          {time:"Day 1–2",title:"Most Intensive Period",desc:"Pain medication support. Rest in a V-position. Leg exercises are important."},
          {time:"Day 3–7",title:"Swelling Decreases",desc:"Drains are removed. Mobility improves. Transition from liquids to normal diet."},
          {time:"Week 2–6",title:"Return to Social Life",desc:"Social activities from week 2. No heavy lifting for 6 weeks."},
          {time:"6+ months",title:"Final Result",desc:"The incision scar begins to fade from month 6 and continues to improve for up to 2 years."}
        ],
        prep:["If you smoke, stop at least 2 weeks before surgery","If you take vitamin E, discontinue during this period","Avoid pools and the sea for 4 weeks","Avoid sauna, tanning beds, and sun exposure for 6 weeks"],
        normal:["The body retains fluid in the first 2 days, making movement difficult","You may feel dizzy when first standing — get up slowly","The incision line may be red and itchy for the first 3–4 months","Temporary numbness below the navel area is possible"],
        followup:"Follow-up at 1, 3, 6, and 12 months"
      },
      "Üst Göz Kapağı Estetiği":{
        desc:"Correcting sagging and loose upper eyelid skin for a more youthful and refreshed appearance.",
        stats:[{val:"Local Anesthesia",lbl:"Anesthesia"},{val:"Day 3–4",lbl:"Bandages Removed"},{val:"6 weeks",lbl:"Recovery"}],
        timeline:[
          {time:"Procedure day",title:"Procedure & Recovery",desc:"Local anesthesia. Bandages will be placed on the eyelids. You go home the same day."},
          {time:"Day 1–2",title:"Cold Compress",desc:"Apply cold compresses for 20 minutes every hour. Rest with your head elevated."},
          {time:"Day 3–4",title:"Bandages Removed",desc:"Swelling begins to subside. Bandages are removed on day 4. You can wash around the eyes."},
          {time:"Week 2–4",title:"Normalization",desc:"Bruising fades. Eyes begin to look more open. Light makeup is possible."},
          {time:"6+ weeks",title:"Final Appearance",desc:"The final result becomes visible after 6 weeks."}
        ],
        prep:["Since local anesthesia is used, fasting is not required","Avoid lying down and strenuous activities for 4 hours after the procedure","Wear sunglasses","Avoid sauna and tanning beds for 6 weeks"],
        normal:["Swelling and bruising around the eyes may increase in the first 2–3 days","Eyes may be more swollen in the morning and improve during the day","You may feel tightness around the eyes when exposed to wind or sun in the first weeks","A slight pulling sensation at the corner of the eye may be more noticeable in the first week"],
        followup:"Follow-up 15 days after the procedure"
      },
      "Alt Göz Kapağı Estetiği":{
        desc:"Correcting fat deposits and sagging of the lower eyelid for a more rested and youthful appearance.",
        stats:[{val:"General Anesthesia",lbl:"Anesthesia"},{val:"Day 3–4",lbl:"Bandages Removed"},{val:"6 weeks",lbl:"Recovery"}],
        timeline:[
          {time:"Procedure day",title:"Procedure",desc:"Performed under general anesthesia. Typically requires 1–2 nights' stay."},
          {time:"Day 1–3",title:"Cold Compress",desc:"Regular cold compresses help keep swelling under control."},
          {time:"Day 4–7",title:"Bandages Removed",desc:"Swelling noticeably decreases. Return to daily activities begins."},
          {time:"6 weeks",title:"Final Appearance",desc:"The final result becomes visible."}
        ],
        prep:["Avoid sauna and tanning beds for 6 weeks","Wear sunglasses"],
        normal:["Swelling and bruising may increase in the first 2–3 days","Eyes may be more swollen in the morning","You may feel tightness around the eyes in the first few weeks"],
        followup:"Follow-up 15 days after the procedure"
      },
      "Botoks Uygulaması":{
        desc:"A quick, non-surgical treatment that temporarily relaxes facial muscles to reduce wrinkles.",
        stats:[{val:"10–15 min",lbl:"Duration"},{val:"3–7 days",lbl:"Effect Begins"},{val:"3–4 months",lbl:"Effect Duration"}],
        timeline:[
          {time:"Treatment day",title:"Application",desc:"10–15 minutes. Painless. You go home the same day."},
          {time:"Day 3–7",title:"Effect Begins",desc:"Wrinkles start to diminish. Facial muscles gradually relax."},
          {time:"Week 2–4",title:"Full Effect",desc:"The full effect of Botox is seen at 2–4 weeks."},
          {time:"Month 3–4",title:"Time for Retreatment",desc:"The effect gradually fades. With repeated treatments, the effect can last up to 12 months."}
        ],
        prep:["Do not use your facial muscles for 4 hours after the treatment","Do not lie down for 4 hours after the treatment","Do not massage the injection sites for 2 days","Take a break from intense exercise for 2 days"],
        normal:["Redness, bruising, or mild swelling may occur for 1–2 days","A mild headache may be felt in the first week after treatment","The effect begins within 3–7 days depending on the individual"],
        followup:"Touch-up at 15 days if needed"
      },
      "Dolgu Uygulaması":{
        desc:"A hyaluronic acid-based treatment that adds volume and fills grooves in various areas of the face.",
        stats:[{val:"15–30 min",lbl:"Duration"},{val:"1–2 days",lbl:"Recovery"},{val:"6–18 months",lbl:"Effect Duration"}],
        timeline:[
          {time:"Treatment day",title:"Application",desc:"Painless with topical anesthetic cream. You go home the same day."},
          {time:"Day 1–3",title:"Swelling Period",desc:"Slightly more swelling than normal is expected, especially in the lips."},
          {time:"Week 1–2",title:"Final Appearance",desc:"Swelling resolves and the lasting result appears."}
        ],
        prep:["Avoid blood thinners for 10 days before the procedure","Avoid excessive heat and steam","Do not massage the area after the application"],
        normal:["Swelling and bruising may occur in the first 2 days","Swelling may be more noticeable with lip filler","Temporary tightness in the treated area may be felt"],
        followup:"Follow-up at 2 weeks if needed"
      },
      "Liposuction":{
        desc:"Body contouring by vacuum removal of localized fat deposits that are resistant to diet and exercise.",
        stats:[{val:"Variable",lbl:"Duration"},{val:"2–3 days",lbl:"Hospital"},{val:"3–6 months",lbl:"Result"}],
        timeline:[
          {time:"Surgery day",title:"Procedure",desc:"Compression garment is applied. Drains may be placed."},
          {time:"Day 1–3",title:"Intense Swelling",desc:"The body retains fluid. Wear the compression garment continuously."},
          {time:"Week 1–2",title:"Recovery",desc:"Mobility returns to normal. Return to social life begins."},
          {time:"Month 3–6",title:"Final Contour",desc:"The body takes its new shape. The final result appears."}
        ],
        prep:["The compression garment must be worn continuously after surgery","Avoid pools and the sea for 4 weeks","Avoid sauna and tanning beds for 6 weeks"],
        normal:["Significant swelling and bruising may occur in the first 2–3 days","Temporary irregularities on the skin surface are possible","Numbness or sensitivity will resolve over time"],
        followup:"Follow-up at 1, 3, and 6 months"
      },
      "Meme Dikleştirme":{
        desc:"Lifting and reshaping sagging breasts, with the option to add implants if needed.",
        stats:[{val:"2–4 hours",lbl:"Duration"},{val:"1–2 nights",lbl:"Hospital"},{val:"6 weeks",lbl:"Recovery"}],
        timeline:[
          {time:"Surgery day",title:"Procedure",desc:"General anesthesia. A support bra is applied."},
          {time:"Day 1–3",title:"Rest",desc:"Arm movement is restricted. Pain medication support."},
          {time:"Week 2–4",title:"Normalization",desc:"Swelling decreases, arm movement returns to normal. Light activities resume."},
          {time:"6+ weeks",title:"Final Appearance",desc:"Swelling fully resolves and the final shape appears."}
        ],
        prep:["Wear the support bra continuously after surgery","Avoid pools for 4 weeks","Avoid heavy arm exercises for 6 weeks"],
        normal:["Temporary changes in nipple sensation may occur","Firmness and swelling in the breast area are normal in the first days","Incision scars may be more visible in the first 3–4 months"],
        followup:"Follow-up at 1, 3, and 6 months"
      },
      "Meme Küçültme":{
        desc:"Reducing and reshaping large, sagging breasts to relieve back pain and improve posture.",
        stats:[{val:"2–4 hours",lbl:"Duration"},{val:"1–2 nights",lbl:"Hospital"},{val:"6 weeks",lbl:"Recovery"}],
        timeline:[
          {time:"Surgery day",title:"Procedure",desc:"General anesthesia. A support bra is applied."},
          {time:"Week 1–2",title:"Recovery",desc:"Swelling decreases. Arm movement returns to normal."},
          {time:"6 weeks",title:"Final Appearance",desc:"The new breast shape settles. Scars begin to fade."}
        ],
        prep:["Wear the support bra continuously","Avoid heavy sports and arm exercises for 6 weeks"],
        normal:["Temporary changes in nipple sensation may occur","Incision scars may be visible in the first months","Mild swelling and firmness are normal"],
        followup:"Follow-up at 1, 3, and 6 months"
      },
      "Meme Büyütme (Silikon Protez ile)":{
        desc:"Increasing breast volume with silicone implants to achieve the desired fullness and shape.",
        stats:[{val:"1–2 hours",lbl:"Duration"},{val:"1 night",lbl:"Hospital"},{val:"3–6 months",lbl:"Result"}],
        timeline:[
          {time:"Surgery day",title:"Procedure",desc:"General anesthesia. A support bra is applied."},
          {time:"Day 1–7",title:"Rest",desc:"Do not raise your arms. Pain medication support."},
          {time:"Month 3–6",title:"Implant Settles",desc:"The implant integrates with the tissue and the final shape appears."}
        ],
        prep:["Wear the support bra continuously","Do not raise your arms during the first week"],
        normal:["Firmness and tightness in the first week are normal","Temporary numbness around the implant area may occur","Swelling noticeably decreases by week 3–4"],
        followup:"Follow-up at 1, 3, and 6 months"
      },
      "Kol Germe":{
        desc:"Removing sagging skin and excess fat from the back and inner arm to reshape the arm contour.",
        stats:[{val:"General Anesthesia",lbl:"Anesthesia"},{val:"Day 10–14",lbl:"Sutures"},{val:"6 weeks",lbl:"Recovery"}],
        timeline:[
          {time:"Surgery day",title:"Procedure",desc:"Excess skin and fat tissue are removed through an incision from the armpit. Drains are placed."},
          {time:"Day 1–3",title:"Rest",desc:"Drains are removed. Arm movement is restricted."},
          {time:"Week 1–2",title:"Sutures Removed",desc:"Sutures are removed on day 10–14. Swelling decreases."},
          {time:"6 weeks",title:"Recovery",desc:"Return to heavy arm exercises is possible."}
        ],
        prep:["Avoid pools and the sea for 4 weeks","Avoid heavy arm work for 6 weeks","If you smoke, quit during the surgical period"],
        normal:["Significant swelling may occur in the first 2 days","The incision scar may be red and itchy in the first 3–4 months","Temporary numbness in the arm may be felt"],
        followup:"Follow-up at 1, 3, and 6 months"
      },
      "Uyluk veya Kol germe":{
        desc:"Surgical correction of sagging skin and excess fat in the thigh or arm area.",
        stats:[{val:"General Anesthesia",lbl:"Anesthesia"},{val:"1–2 nights",lbl:"Hospital"},{val:"6 weeks",lbl:"Recovery"}],
        timeline:[
          {time:"Surgery day",title:"Procedure",desc:"General anesthesia. Drains are placed."},
          {time:"Day 1–3",title:"Rest",desc:"Drains are removed. Rest in a V-position."},
          {time:"Week 1–2",title:"Sutures Removed",desc:"Sutures are removed on day 12–14."},
          {time:"6 weeks",title:"Recovery",desc:"Return to heavy activities is possible."}
        ],
        prep:["Begin eating soft foods 3–4 days beforehand","Avoid pools and the sea for 4 weeks","Avoid sauna and tanning beds for 6 weeks"],
        normal:["Significant swelling in the first 2 days","The suture line may be red in the first months","Temporary numbness in the area may be felt"],
        followup:"Follow-up at 1, 3, and 6 months"
      },
      "Kuşak Germe":{
        desc:"A comprehensive surgery that corrects sagging skin and excess fat around the entire abdomen, waist, hips, and tailbone area.",
        stats:[{val:"2–6 hours",lbl:"Duration"},{val:"1–5 nights",lbl:"Hospital"},{val:"6 weeks",lbl:"Recovery"}],
        timeline:[
          {time:"Surgery day",title:"Procedure",desc:"2–6 hours. Circumferential incision. Binder is applied."},
          {time:"Day 1–3",title:"Intensive Care",desc:"Leg exercises are very important. Rest in a V-position."},
          {time:"Day 3–7",title:"Swelling Decreases",desc:"Drains are removed. Mobility improves."},
          {time:"6 weeks",title:"Recovery",desc:"Return to heavy sports and activities is possible."}
        ],
        prep:["If you smoke, stop at least 2 weeks beforehand","If you take vitamin E, discontinue","Avoid pools and the sea for 4 weeks","Avoid heavy sports and activities for 6 weeks"],
        normal:["Intense swelling in the first 2 days is normal","You may feel dizzy when first standing — get up slowly","The incision line may be prominent and itchy in the first months","Temporary numbness in the area may be felt"],
        followup:"Follow-up at 1, 3, 6, and 12 months"
      },
      "İple Askı Uygulaması":{
        desc:"Lifting sagging facial tissues to their natural anatomical position using specialized threads.",
        stats:[{val:"Sedation",lbl:"Anesthesia"},{val:"Same day",lbl:"Hospital"},{val:"Variable",lbl:"Result Duration"}],
        timeline:[
          {time:"Procedure day",title:"Procedure",desc:"Sedation or local anesthesia. You go home the same day."},
          {time:"Week 1–2",title:"Initial Result",desc:"Swelling subsides. The effect of the threads becomes visible."},
          {time:"Month 1–3",title:"Final Appearance",desc:"The final result settles. A natural and refreshed look."}
        ],
        prep:["Avoid hard foods on the first day after the procedure","Avoid excessive facial expressions","Follow the massage recommendations"],
        normal:["Small dimples or indentations may occur after the procedure and will resolve","A mild burning sensation in the temple area is normal","Slight facial asymmetry in the first week is possible and will correct itself"],
        followup:"Follow-up at 1 month and 3 months"
      },
      "Yüz Germe":{
        desc:"Surgical correction of sagging in the face and neck.",
        stats:[{val:"3–5 hours",lbl:"Duration"},{val:"1–2 nights",lbl:"Hospital"},{val:"2–4 weeks",lbl:"Recovery"}],
        timeline:[
          {time:"Surgery day",title:"Procedure",desc:"General or sedation anesthesia. Bandages are applied."},
          {time:"Day 1–7",title:"Rest",desc:"Keep head elevated. Swelling and bruising are at their peak."},
          {time:"Week 2–4",title:"Normalization",desc:"Swelling and bruising resolve. Return to social life."},
          {time:"Month 3–6",title:"Final Appearance",desc:"The final result settles. Incision scars are hidden at the hairline and behind the ears."}
        ],
        prep:["If you smoke, quit","Avoid sauna and tanning beds for 6 weeks"],
        normal:["Significant facial swelling and bruising in the first week","Temporary numbness at the hairline is possible","A tightness sensation around the ears will resolve over time"],
        followup:"Follow-up at 1 and 3 months"
      },
      "Popo estetiği":{
        desc:"Enhancing the shape and volume of the buttocks through fat injection or implants.",
        stats:[{val:"1–3 hours",lbl:"Duration"},{val:"1–2 nights",lbl:"Hospital"},{val:"3–6 months",lbl:"Result"}],
        timeline:[
          {time:"Surgery day",title:"Procedure",desc:"General anesthesia. Compression garment is applied."},
          {time:"Week 2–4",title:"Sitting Restricted",desc:"Avoid prolonged sitting and lying on your back."},
          {time:"Month 3–6",title:"Final Shape",desc:"Fat retention stabilizes and the final shape settles."}
        ],
        prep:["Wear the compression garment continuously","Limit sitting activities for 2–4 weeks"],
        normal:["Sitting discomfort may occur in the first weeks","Some of the injected fat will be absorbed — this is normal","Temporary firmness and sensitivity in the area are possible"],
        followup:"Follow-up at 1, 3, and 6 months"
      },
      "Jinekomasti":{
        desc:"Surgical or liposuction correction of enlarged breast tissue in men.",
        stats:[{val:"1–2 hours",lbl:"Duration"},{val:"1 night",lbl:"Hospital"},{val:"6 weeks",lbl:"Recovery"}],
        timeline:[
          {time:"Surgery day",title:"Procedure",desc:"General or sedation anesthesia. Compression garment is applied."},
          {time:"Day 1–7",title:"Rest",desc:"Wear the compression garment continuously. Arm movement is restricted."},
          {time:"6 weeks",title:"Recovery",desc:"The final result settles. Return to heavy exercise is possible."}
        ],
        prep:["Wear the compression garment continuously","Avoid heavy arm exercises for 6 weeks"],
        normal:["Swelling and sensitivity in the first week are normal","Temporary numbness around the nipple area may occur","The incision scar is hidden around the nipple"],
        followup:"Follow-up at 1, 3, and 6 months"
      },
      "Meme Asimetrisinin Giderilmesi":{
        desc:"Surgical correction of differences in size, shape, or position between the breasts. Unilateral or bilateral intervention may be planned.",
        stats:[{val:"2–4 hours",lbl:"Duration"},{val:"1–2 nights",lbl:"Hospital"},{val:"6–12 months",lbl:"Result"}],
        timeline:[
          {time:"Surgery day",title:"Procedure",desc:"General anesthesia. Unilateral or bilateral intervention depending on the type of asymmetry."},
          {time:"Day 1–3",title:"Rest",desc:"Wear the support bra continuously. Arm movement is restricted."},
          {time:"Week 2–4",title:"Normalization",desc:"Swelling decreases. Light activities resume. The difference between breasts begins to diminish."},
          {time:"Month 3–6",title:"Shape Settles",desc:"Swelling fully resolves and tissues settle."},
          {time:"Month 6–12",title:"Final Result",desc:"Final symmetry appears. Incision scars begin to fade."}
        ],
        prep:["Wear the support bra continuously","Avoid pools for 4 weeks","Avoid heavy arm exercises for 6 weeks","Document the size difference between breasts with photographs"],
        normal:["Swelling differences between the two breasts in the first weeks are temporary","Temporary changes in nipple sensation may occur","Incision scars may be prominent in the first 3–4 months","Perfect symmetry cannot be anatomically guaranteed — significant improvement is the goal"],
        followup:"Follow-up at 1, 3, 6, and 12 months"
      },
      "Meme Onarımı (Kanser sonrası)":{
        desc:"Surgical reconstruction of breast tissue lost after breast cancer surgery. Implants or your own tissue may be used.",
        stats:[{val:"2–6 hours",lbl:"Duration"},{val:"2–5 nights",lbl:"Hospital"},{val:"6–12 months",lbl:"Result"}],
        timeline:[
          {time:"Surgery day",title:"Procedure",desc:"General anesthesia. May take 2–6 hours depending on the method."},
          {time:"Day 1–5",title:"Hospital Monitoring",desc:"Drains may be placed. Pain management and early mobilization."},
          {time:"Week 2–6",title:"Recovery",desc:"Drains are removed. Gradual return to daily activities."},
          {time:"Month 3–6",title:"Shaping",desc:"If needed, a second stage (nipple reconstruction, symmetry correction)."},
          {time:"Month 6–12",title:"Final Appearance",desc:"The final result appears when all stages are completed."}
        ],
        prep:["Coordination with your oncology team will be ensured","Wear the support bra continuously","Inform your surgeon if you have a radiotherapy plan","Avoid heavy arm exercises for 6 weeks"],
        normal:["Prolonged numbness in the reconstruction area is possible","If an implant is used, the settling process takes 3–6 months","If a flap is used, there will also be a healing process at the donor site","The process may require multiple surgeries — this is normal"],
        followup:"Coordinated follow-up with the oncology and plastic surgery team"
      },
      "Doğumsal Meme Anomalisinin Düzeltilmesi":{
        desc:"Surgical correction of congenital breast development disorders such as tuberous breast, Poland syndrome, and asymmetry.",
        stats:[{val:"2–4 hours",lbl:"Duration"},{val:"1–2 nights",lbl:"Hospital"},{val:"6–12 months",lbl:"Result"}],
        timeline:[
          {time:"Surgery day",title:"Procedure",desc:"General anesthesia. A personalized plan based on the type of anomaly."},
          {time:"Day 1–3",title:"Rest",desc:"A support bra is applied. Arm movement is restricted."},
          {time:"Week 2–6",title:"Recovery",desc:"Swelling decreases. Gradual return to daily activities."},
          {time:"Month 6–12",title:"Final Result",desc:"The final appearance emerges when all stages are completed."}
        ],
        prep:["Wear the support bra continuously","Avoid pools for 4 weeks","Avoid heavy arm exercises for 6 weeks"],
        normal:["Swelling and sensitivity may be significant in the first weeks","Temporary changes in nipple sensation may occur","Multiple surgical stages may be required","Incision scars are prominent initially but fade over time"],
        followup:"Follow-up at 1, 3, 6, and 12 months"
      },
      "Lazer Epilasyon":{
        desc:"Laser light is absorbed by the melanin in the hair follicle, converting to heat and disabling the root. Multiple sessions are needed since only hairs in the active growth phase are targeted. Results vary by skin type, hair structure, and hormonal status.",
        stats:[{val:"15–60 min",lbl:"Session Duration"},{val:"Avg. 6 sessions",lbl:"Recommended Sessions"},{val:"4–8 weeks",lbl:"Session Interval"}],
        timeline:[
          {time:"Session 1",title:"Getting Started",desc:"First application. A mild stinging sensation may occur. Redness lasts a few hours."},
          {time:"Week 1–3",title:"Initial Shedding",desc:"Treated hairs begin to fall out. Do not pluck or pull."},
          {time:"Session 2–4",title:"Visible Reduction",desc:"Hair density noticeably decreases. Thinning is evident in some areas."},
          {time:"Session 6–10",title:"Target Result",desc:"Permanent hair reduction is achieved. 1–2 maintenance sessions per year may suffice."}
        ],
        prep:["Avoid waxing, tweezing, or epilators that remove the hair root for 4–6 weeks beforehand","Avoid tanning — the lighter the skin tone, the more effective the laser","Shave 3 days before the session — hair length should be about 1 mm","Avoid chemical peels or hair bleaching products","Do not apply cream, deodorant, or perfume to the area on session day"],
        normal:["Mild redness, swelling, and temporary sensitivity resolve within hours to days","Avoid sun exposure, hot water, and saunas for the first 24–48 hours","Do not use wax, tweezers, or epilators for at least 4 weeks — shaving is safe","Soothe the skin with fragrance-free, hypoallergenic moisturizers and aloe vera","Hormonal changes (pregnancy, medication) can trigger new hair growth — maintenance sessions may be needed","Contact your physician if you experience severe pain, blistering, or a reaction lasting more than 7 days"],
        followup:"Assessment before each session"
      },
      "Lazer Dövme Silme":{
        desc:"FDA-approved laser technology penetrates color pigments beneath the skin, breaking them down for absorption by the immune system. The tattoo's color, size, and depth affect the result.",
        stats:[{val:"15–45 min",lbl:"Session Duration"},{val:"6–12 sessions",lbl:"Recommended Sessions"},{val:"6–8 weeks",lbl:"Session Interval"}],
        timeline:[
          {time:"Session 1",title:"Getting Started",desc:"First application. A stinging sensation may occur. Whitening and mild swelling in the area are normal."},
          {time:"Week 2–4",title:"Healing",desc:"Crusting may occur — do not pick at it. The area heals on its own."},
          {time:"Session 3–6",title:"Fading Begins",desc:"The tattoo begins to fade noticeably. Each session breaks down more pigment."},
          {time:"Session 6–12",title:"Target Result",desc:"Most of the tattoo is removed. Complete removal depends on color and depth."}
        ],
        prep:["Avoid tanning and tanning beds for 2–4 weeks before the session — the lighter the skin, the stronger the effect","Do not apply cream or lotion to the area before the session","Inform us if you take blood thinners","Discuss your expectations with your doctor — complete removal may not be possible with lighter-colored tattoos"],
        normal:["Whitening (frosting) after the session is normal and resolves in 15–30 minutes","Mild crusting and itching may last 1–2 weeks — do not pick at the scabs","Black and dark blue are the easiest colors to remove; white, yellow, red, and green are the most difficult","Line tattoos respond faster than solid filled designs","Professional tattoos may require more sessions than amateur ones","Allergic reactions are very rare, but contact your physician if one occurs"],
        followup:"Assessment before each session — progress evaluation"
      },
      "Cilt Yenileme (Rejuvenasyon)":{
        desc:"Fractional CO2 laser creates microscopic channels in the skin, triggering the natural healing mechanism and collagen production. Effective for anti-aging, acne scars, stretch marks, and dark spots.",
        stats:[{val:"30–60 min",lbl:"Session Duration"},{val:"3–6 sessions",lbl:"Recommended Sessions"},{val:"4–6 weeks",lbl:"Session Interval"}],
        timeline:[
          {time:"Session day",title:"Application",desc:"Painless with topical anesthesia. Redness and mild burning sensation after the session are normal."},
          {time:"Day 3–7",title:"Healing",desc:"Skin may peel; redness decreases. Moisturizer and sun protection are critical."},
          {time:"Week 2–4",title:"Renewal Begins",desc:"New collagen production starts. Skin texture noticeably improves."},
          {time:"Month 3–6",title:"Final Result",desc:"Collagen renewal is complete. Skin tone and texture are visibly improved."}
        ],
        prep:["Stop retinol and AHA/BHA use 1 week before the session","Protect yourself from the sun — use SPF 50 before and after the procedure","Come without makeup on session day","Sessions are postponed during active herpes or skin infections"],
        normal:["Redness and mild swelling for 1–3 days after the session","Skin peeling may last 3–7 days","Sun sensitivity may increase — protection is essential","Results are gradual; patience is required"],
        followup:"Skin assessment before each session"
      },
      "Karbon Peeling":{
        desc:"A carbon lotion is applied to the face and activated with laser to cleanse pores, even out skin tone, and control oiliness.",
        stats:[{val:"20–30 min",lbl:"Session Duration"},{val:"4–6 sessions",lbl:"Recommended Sessions"},{val:"2–4 weeks",lbl:"Session Interval"}],
        timeline:[
          {time:"Session day",title:"Application",desc:"20–30 min. Painless. A slight tickling sensation. No anesthesia required."},
          {time:"Immediately after",title:"Instant Glow",desc:"Skin immediately appears brighter and smoother. Mild redness may occur."},
          {time:"Week 1–2",title:"Recovery",desc:"Pores begin to shrink. Oiliness decreases."},
          {time:"Session 4–6",title:"Cumulative Effect",desc:"Skin quality improves with each session. Regular treatment provides lasting results."}
        ],
        prep:["Come without makeup on session day","Sessions are postponed during active acne or skin infections","Do not apply makeup for 24 hours after the procedure","Use sun protection"],
        normal:["A mild heat sensation and tickling during the procedure","Mild redness after the session (a few hours)","Results are cumulative — dramatic change from a single session should not be expected","Results are more pronounced in oily skin types"],
        followup:"Skin assessment before each session"
      },
      "Lazer Leke Tedavisi":{
        desc:"Laser targeting of areas where melanin pigment has concentrated excessively, lightening sun spots, hormonal discoloration, age spots, and acne marks.",
        stats:[{val:"15–30 min",lbl:"Session Duration"},{val:"1–4 sessions",lbl:"Recommended Sessions"},{val:"4–6 weeks",lbl:"Session Interval"}],
        timeline:[
          {time:"Session day",title:"Application",desc:"15–30 min. Mild stinging sensation. Darkening of the treated spot after the session is normal."},
          {time:"Day 3–7",title:"Crusting",desc:"Crusting occurs over the spot — do not pick at it; it will shed on its own."},
          {time:"Week 2–4",title:"Lightening Begins",desc:"Lighter skin appears beneath the shed crust."},
          {time:"Month 1–3",title:"Final Result",desc:"The spot is noticeably lighter or completely gone. Sun protection is essential for lasting results."}
        ],
        prep:["Use sunscreen year-round, even in winter — SPF 30+ is essential","Avoid tanning and tanning beds","Discontinue retinol and bleaching creams 1 week before the session","Take extra precautions during pregnancy or while using hormone medications","Share your skin type, spot history, and hormonal status with your doctor"],
        normal:["The spot area may temporarily darken after treatment — this is an expected reaction","Mild redness resolves quickly","Estrogen plays a significant role in pigmentation — spots are more common in women than men","Pregnancy, birth control pills, and hormone medications can trigger spot formation","Without sun protection, spots can recur — SPF use must be maintained after treatment","Lasting results are possible with regular sessions and proper care"],
        followup:"Spot assessment before each session — SPF usage check"
      },
      "Kaş Kaldırma":{
        desc:"Lifting a low brow position using surgical or endoscopic techniques for a more youthful and dynamic upper face appearance.",
        stats:[{val:"1–2 hours",lbl:"Duration"},{val:"Same day",lbl:"Hospital"},{val:"2–4 weeks",lbl:"Recovery"}],
        timeline:[
          {time:"Procedure day",title:"Procedure",desc:"Sedation or general anesthesia. 1–2 hours."},
          {time:"Day 1–7",title:"Rest",desc:"Swelling and bruising are normal. Cold compresses help."},
          {time:"Week 2–4",title:"Recovery",desc:"Swelling largely resolves. Return to social life."},
          {time:"Month 3–6",title:"Final Result",desc:"Brow position settles and the result becomes clear."}
        ],
        prep:["Discontinue blood thinners 1 week beforehand","Stop smoking 2 weeks beforehand"],
        normal:["Swelling and bruising are expected in the first week","Temporary numbness in the forehead area may occur","Incision scars are hidden within the hairline"],
        followup:"Follow-up at 1, 3, and 6 months"
      },
      "Yanak Estetiği (Bişektomi)":{
        desc:"Removal of the buccal fat pad inside the cheek to give the face a more defined contour.",
        stats:[{val:"30–60 min",lbl:"Duration"},{val:"Same day",lbl:"Hospital"},{val:"2–3 weeks",lbl:"Recovery"}],
        timeline:[
          {time:"Procedure day",title:"Procedure",desc:"Local anesthesia is sufficient. 30–60 min."},
          {time:"Day 1–3",title:"Rest",desc:"Swelling and sensitivity are normal. Eat soft foods."},
          {time:"Week 2–3",title:"Recovery",desc:"Swelling decreases, facial contour begins to emerge."},
          {time:"Month 3–6",title:"Final Result",desc:"Facial slimming and contour become clear."}
        ],
        prep:["Oral hygiene is important before the procedure","Discontinue blood thinners 1 week beforehand"],
        normal:["Swelling and sensitivity inside the cheek in the first week","Soft foods are recommended","Results are gradual — allow 3 months for the full effect"],
        followup:"Follow-up at 1 and 3 months"
      },
      "Kepçe Kulak Tedavisi":{
        desc:"Surgical correction of protruding ears by reshaping the cartilage to bring the ears closer to the head.",
        stats:[{val:"1–1.5 hours",lbl:"Duration"},{val:"Same day",lbl:"Hospital"},{val:"2–3 weeks",lbl:"Recovery"}],
        timeline:[
          {time:"Procedure day",title:"Procedure",desc:"Local or general anesthesia. 1–1.5 hours."},
          {time:"Day 1–7",title:"Rest",desc:"A bandage is applied. Pain is mild; pain medication is sufficient."},
          {time:"Week 2–3",title:"Recovery",desc:"Bandage is removed. A night headband is recommended for 4–6 weeks."},
          {time:"Month 2–3",title:"Final Result",desc:"Ear position settles, scars fade."}
        ],
        prep:["Come with clean, washed hair","Have a night headband ready for after the procedure"],
        normal:["Mild pain and swelling in the first week","The scar behind the ear fades over time","Wearing a night headband for 6 weeks is recommended"],
        followup:"Follow-up at 1 week, 1 month, and 3 months"
      },
      "Yüz Yağ Enjeksiyonu":{
        desc:"Fat tissue harvested from another part of the body is processed and injected into the face, providing natural fullness for volume loss, hollowing, and wrinkles.",
        stats:[{val:"1–2 hours",lbl:"Duration"},{val:"Same day",lbl:"Hospital"},{val:"2–4 weeks",lbl:"Recovery"}],
        timeline:[
          {time:"Procedure day",title:"Procedure",desc:"Sedation or general anesthesia. 1–2 hours."},
          {time:"Day 1–7",title:"Rest",desc:"Facial swelling and bruising are normal. Cold compresses help."},
          {time:"Week 2–4",title:"Recovery",desc:"Swelling decreases. Some of the fat will be absorbed — this is expected."},
          {time:"Month 3–6",title:"Final Result",desc:"The remaining fat is permanent. Natural fullness settles."}
        ],
        prep:["Discontinue blood thinners 1 week beforehand","Stop smoking 2 weeks beforehand"],
        normal:["Significant swelling and bruising in the first week","30–50% of the injected fat is absorbed — this is normal","Results become clear at 3 months"],
        followup:"Follow-up at 1, 3, and 6 months"
      },
      "Genital Estetik":{
        desc:"Surgical correction of aesthetic and functional concerns in the genital area, including changes related to childbirth or aging.",
        stats:[{val:"1–2 hours",lbl:"Duration"},{val:"Same day",lbl:"Hospital"},{val:"3–4 weeks",lbl:"Recovery"}],
        timeline:[
          {time:"Procedure day",title:"Procedure",desc:"Local or general anesthesia."},
          {time:"Day 1–7",title:"Rest",desc:"Sensitivity and mild swelling are normal."},
          {time:"Week 3–4",title:"Recovery",desc:"Sutures dissolve. Return to daily activities."},
          {time:"Month 2–3",title:"Final Result",desc:"Full healing and final result."}
        ],
        prep:["Area hygiene is important","Shaving before the procedure is recommended"],
        normal:["Sensitivity and swelling in the first week","Dissolving sutures are absorbed in 2–3 weeks","Avoid sexual intercourse for 4–6 weeks"],
        followup:"Follow-up at 1 week and 1 month"
      },
      "Labioplasti":{
        desc:"Reduction or reshaping of the labia minora (inner lips) for aesthetic or functional reasons.",
        stats:[{val:"45–90 min",lbl:"Duration"},{val:"Same day",lbl:"Hospital"},{val:"3–4 weeks",lbl:"Recovery"}],
        timeline:[
          {time:"Procedure day",title:"Procedure",desc:"Local or general anesthesia. 45–90 min."},
          {time:"Day 1–7",title:"Rest",desc:"Swelling and sensitivity are normal. Wear comfortable underwear."},
          {time:"Week 3–4",title:"Recovery",desc:"Sutures dissolve. Return to daily activities."},
          {time:"Month 2–3",title:"Final Result",desc:"Full healing. Aesthetic and functional results settle."}
        ],
        prep:["Area hygiene is important","Discontinue blood thinners 1 week beforehand"],
        normal:["Swelling, sensitivity, and mild bleeding may occur in the first week","Dissolving sutures are absorbed in 2–3 weeks","Avoid sexual intercourse and heavy exercise for 4–6 weeks"],
        followup:"Follow-up at 1 week and 1 month"
      },
      "Göz Altı Işık Dolgusu":{
        desc:"Hyaluronic acid-based filler to address under-eye hollowing, dark circles, and volume loss.",
        stats:[{val:"15–30 min",lbl:"Duration"},{val:"Immediate",lbl:"Result"},{val:"12–18 months",lbl:"Effect Duration"}],
        timeline:[
          {time:"Treatment day",title:"Application",desc:"15–30 min. Mild stinging sensation. Immediate results."},
          {time:"Day 1–3",title:"Mild Swelling",desc:"Slight swelling under the eyes may occur. Cold compresses help."},
          {time:"Week 1–2",title:"Settling",desc:"Filler settles, a natural look emerges."},
          {time:"Month 12–18",title:"Maintenance",desc:"The effect begins to diminish. A repeat session can be scheduled."}
        ],
        prep:["Discontinue blood thinners and aspirin 1 week beforehand","Come without makeup on treatment day"],
        normal:["Mild swelling and bruising may occur after treatment (1–3 days)","Filler fully settles in 1–2 weeks","Results last 12–18 months, varying by individual"],
        followup:"Follow-up after 2 weeks"
      },
      "Nano Yağ Enjeksiyonu":{
        desc:"Fat harvested from the body is processed to nano size and injected into the face, under-eye area, and delicate skin zones. A finer and more precise application than traditional fat injection.",
        stats:[{val:"1–1.5 hours",lbl:"Duration"},{val:"Same day",lbl:"Hospital"},{val:"2–3 weeks",lbl:"Recovery"}],
        timeline:[
          {time:"Procedure day",title:"Procedure",desc:"Local or sedation anesthesia."},
          {time:"Day 1–7",title:"Rest",desc:"Mild swelling and bruising. Cold compresses."},
          {time:"Week 2–3",title:"Recovery",desc:"Swelling resolves, results become visible."},
          {time:"Month 3–6",title:"Final Result",desc:"The remaining fat is permanent."}
        ],
        prep:["Discontinue blood thinners 1 week beforehand","Smoking slows healing"],
        normal:["Swelling at both the donor and injection sites is normal","Some of the injected fat will be absorbed","Results become clear at 3 months"],
        followup:"Follow-up at 1 and 3 months"
      },
      "Mezoterapi":{
        desc:"Micro-injection of a vitamin, mineral, amino acid, and hyaluronic acid blend beneath the skin. Used for skin rejuvenation, hydration, and hair loss treatment.",
        stats:[{val:"15–30 min",lbl:"Session Duration"},{val:"4–6 sessions",lbl:"Recommended Sessions"},{val:"2–4 weeks",lbl:"Session Interval"}],
        timeline:[
          {time:"Session day",title:"Application",desc:"15–30 min. Mild stinging sensation. Anesthesia is usually not required."},
          {time:"Day 1–2",title:"Mild Redness",desc:"Needle marks and mild redness are normal. Resolves in a few hours."},
          {time:"Session 3–4",title:"Effect Begins",desc:"Skin quality and hydration noticeably improve."},
          {time:"Session 6+",title:"Cumulative Result",desc:"Lasting skin quality improvement with regular sessions."}
        ],
        prep:["Come without makeup on session day","Sessions are postponed during active skin infections"],
        normal:["Brief redness at needle marks","Rare bruising may occur","Results are cumulative — regular sessions are needed"],
        followup:"Skin assessment before each session"
      },
      "Lazer Saç Tedavisi":{
        desc:"Laser-assisted hair treatment that stimulates hair follicles, reduces hair loss, and supports healthier hair growth. Can be combined with PRP and mesotherapy.",
        stats:[{val:"20–40 min",lbl:"Session Duration"},{val:"6–12 sessions",lbl:"Recommended Sessions"},{val:"2–4 weeks",lbl:"Session Interval"}],
        timeline:[
          {time:"Session 1",title:"Getting Started",desc:"Painless application. No recovery time required."},
          {time:"Session 2–4",title:"Shedding Decreases",desc:"Hair shedding begins to slow."},
          {time:"Session 6–8",title:"New Growth",desc:"Fine new hairs begin to appear."},
          {time:"Session 12+",title:"Strengthening",desc:"Hair thickness and density increase. Maintenance sessions are recommended."}
        ],
        prep:["A clean scalp is important","Sessions are postponed during active scalp infections","Inform your doctor about all medications you are taking"],
        normal:["The procedure is painless — no side effects are expected","Results are gradual; patience is required","Results for genetic hair loss vary by individual","Better results may be achieved when combined with PRP/mesotherapy"],
        followup:"Assessment every 3 sessions"
      },
    },
    crossSell:{
      "Üst Göz Kapağı Estetiği":[
        {proc:"Kaş Kaldırma",why:"Brow position directly affects the outcome of eyelid surgery — evaluating both together can produce a much more balanced result."},
        {proc:"Botoks",why:"Botox for fine lines around the eyes can beautifully complement eyelid surgery."},
      ],
      "Alt Göz Kapağı Estetiği":[
        {proc:"Yüz Germe",why:"Lower eyelid and lower face can be addressed in the same session — this can provide a much more comprehensive result for some patients."},
        {proc:"Dolgu",why:"Filler for under-eye hollowing can support the post-surgical appearance."},
      ],
      "Burun Estetiği":[
        {proc:"Çene Ucu Estetiği",why:"The chin-nose ratio is one of the most important factors defining your facial profile — a chin assessment can significantly strengthen the result."},
        {proc:"Çene Dolgusu",why:"For those who want to enhance the jawline without surgery, filler combined with rhinoplasty can create a much more balanced profile."},
      ],
      "Meme Büyütme (Silikon Protez ile)":[
        {proc:"Meme Dikleştirme",why:"If sagging is present, augmentation and lift can be done in the same session — potentially eliminating the need for a second surgery."},
        {proc:"Korse Liposuction",why:"Shaping the waistline together can make the augmentation result much more harmonious with your body."},
      ],
      "Meme Dikleştirme":[
        {proc:"Meme Büyütme (Silikon Protez ile)",why:"If there is also volume loss, it can be addressed together with the lift — a single session delivers a much more satisfying result."},
        {proc:"Korse Liposuction",why:"Waist and side contouring can make the breast aesthetics result much more harmonious with your body."},
      ],
      "Meme Küçültme":[
        {proc:"Liposuction",why:"The underarm and lateral chest area can be contoured with liposuction in the same session — worth considering for a more complete silhouette."},
        {proc:"Korse Liposuction",why:"When addressed together with the waist and back, breast reduction creates a much more proportional appearance."},
      ],
      "Karın Germe":[
        {proc:"Liposuction",why:"When tummy tuck and liposuction are combined, the waist and side contours can become much more defined."},
        {proc:"Korse Liposuction",why:"Corset liposuction complements the tummy tuck result, creating a more feminine silhouette."},
      ],
      "Liposuction":[
        {proc:"Karın Germe",why:"If skin laxity may develop after liposuction, a tummy tuck option can be evaluated in advance."},
        {proc:"Korse Liposuction",why:"Corset liposuction — shaping the waist, back, and sides together — can be a complementary approach to standard liposuction."},
      ],
      "Yüz Germe":[
        {proc:"Boyun Germe",why:"When the face and neck are addressed together, a much more natural and comprehensive rejuvenation can be achieved."},
        {proc:"Dolgu",why:"Supporting volume loss with filler after a facelift can significantly strengthen the result."},
        {proc:"Botoks",why:"Botox for the forehead and eye area is a very common complement to a facelift."},
      ],
      "Jinekomasti":[
        {proc:"Liposuction",why:"If there is fatty tissue around the chest along with gynecomastia, liposuction can be addressed in the same session."},
        {proc:"Karın Germe",why:"If the abdominal area is also a concern, it can be addressed in the same session — meaning just one recovery period."},
      ],
      "Kol Germe":[
        {proc:"Liposuction",why:"Combining liposuction with arm lift can help the arms both tighten and contour."},
        {proc:"Uyluk Germe",why:"When arms and thighs are addressed together, a comprehensive body tightening result can be achieved."},
      ],
      "Uyluk Germe":[
        {proc:"Liposuction",why:"Combining liposuction with thigh lift can more dramatically define the leg contour."},
        {proc:"Kol Germe",why:"When arm and thigh tightening are planned together, a comprehensive result is achieved in a single recovery period."},
      ],
      "Yüz Germe (Mini)":[
        {proc:"Boyun Germe",why:"When mini facelift and the neck area are addressed together, the result looks much more comprehensive and natural."},
        {proc:"Dolgu",why:"Volume support with filler after a mini facelift can maintain a youthful appearance for much longer."},
        {proc:"Botoks",why:"Botox for dynamic lines perfectly complements a mini facelift."},
      ],
      "Sıvı Yüz Germe":[
        {proc:"Botoks",why:"When filler and botox are applied together, the 'liquid facelift' effect offers a much more comprehensive rejuvenation."},
        {proc:"İp Askı",why:"When evaluated together with thread lift, sagging and volume loss can be addressed simultaneously."},
      ],
      "Botoks":[
        {proc:"Dolgu",why:"Botox addresses dynamic lines while filler addresses volume loss — together they provide a much more comprehensive rejuvenation."},
        {proc:"Sıvı Yüz Germe",why:"For those seeking comprehensive rejuvenation without surgery, the combination of filler and botox is increasingly popular."},
      ],
      "Dolgu":[
        {proc:"Botoks",why:"Filler is for volume, botox is for lines — when applied together, the result is much more balanced."},
        {proc:"Sıvı Yüz Germe",why:"A combined approach addressing different areas of the face creates a much more comprehensive effect than a single procedure."},
      ],
      "İp Askı":[
        {proc:"Dolgu",why:"When thread lift and filler are applied together, sagging and volume loss can be addressed in the same session."},
        {proc:"Botoks",why:"Botox support after thread lift can help extend the longevity of the result."},
      ],
    },
    crossSellMessages:{
      analyst:{
        "Kaş Kaldırma":"The brow-lid ratio is a critical variable in surgical planning — eyelid procedures done without evaluating brow position may prove insufficient over time.",
        "Botoks":"Neurotoxin treatment is the gold standard for dynamic lines — a combined approach with structural changes offers a much more comprehensive rejuvenation.",
        "Yüz Germe":"When rhytidectomy is planned alongside lower eyelid surgery, a much more comprehensive result is achieved in a single recovery period.",
        "Dolgu":"Volume restoration and structural change address different pathologies — when both are addressed together, the result is much more anatomically complete.",
        "Çene Ucu Estetiği":"In facial aesthetic analysis, the chin-nose ratio is a fundamental reference point — from a profilometric perspective, chin evaluation is an integral part of rhinoplasty planning.",
        "Çene Dolgusu":"Optimizing chin projection without surgery is possible — with filler before or after rhinoplasty, profile balance can be adjusted much more precisely.",
        "Meme Dikleştirme":"Simultaneous mastopexy with implant placement optimizes volume while preserving skin envelope quality — recovery time and scar burden are reduced compared to separate sessions.",
        "Korse Liposuction":"When the entire trunk contour is addressed, the proportionality of the aesthetic result to the body becomes much stronger.",
        "Liposuction":"In a combined approach, lateral contours can be shaped during flap elevation — achieving a much more comprehensive contour in a single session.",
        "Karın Germe":"Post-liposuction skin elasticity assessment is critical — pre-planning when laxity risk exists delivers much better results.",
        "Boyun Germe":"When rhytidectomy and platysmaplasty are performed together, anatomical integrity in the lower face-neck transition zone is achieved.",
        "Uyluk Germe":"Comprehensive planning in extremity contouring delivers a much more harmonious result in a single session.",
        "Sıvı Yüz Germe":"Synergy effects in non-surgical combinations are well documented — a much more comprehensive rejuvenation is achieved compared to single-agent application.",
        "İp Askı":"When mechanical support and volume restoration are planned together, the longevity of the result is much stronger.",
        "Meme Büyütme (Silikon Protez ile)":"When volume and ptosis are addressed simultaneously, a much more satisfying result is achieved in a single recovery period.",
      },
      pragmatic:{
        "Kaş Kaldırma":"Done in the same session, no extra recovery time — the result is much more noticeable.",
        "Botoks":"Can even be done on consultation day, 15–20 minutes — no separate appointment needed.",
        "Yüz Germe":"Same anesthesia, same recovery — one session instead of two separate surgeries.",
        "Dolgu":"Can be completed in the same session, no additional visit required.",
        "Çene Ucu Estetiği":"Both nose and chin are completed in one appointment — no separate trip needed.",
        "Çene Dolgusu":"A 20–30 minute procedure — can be done the same day, no extra process.",
        "Meme Dikleştirme":"One anesthesia, one recovery period — you don't have to plan a second surgery.",
        "Korse Liposuction":"Combined in the same session — the total process is much shorter than two separate surgeries.",
        "Liposuction":"Planned together means one recovery period — much more efficient in terms of time and cost.",
        "Karın Germe":"Evaluating and planning now eliminates the possibility of a second surgery later.",
        "Boyun Germe":"Face and neck are completed at the same time — one process instead of two separate ones.",
        "Uyluk Germe":"Both are completed in a single recovery period — much more practical.",
        "Sıvı Yüz Germe":"Can be done in the same session, no surgery required — a quick and practical option.",
        "İp Askı":"Minimally invasive, short recovery — can be planned for the same day as botox.",
        "Meme Büyütme (Silikon Protez ile)":"One anesthesia, one recovery — you don't have to plan a second surgery.",
      },
      trustSeeker:{
        "Kaş Kaldırma":"Most people who come in without noticing this hear about it for the first time during consultation — just asking is enough; let your doctor evaluate.",
        "Botoks":"If you're curious, you can ask — your doctor will tell you whether it's right for you.",
        "Yüz Germe":"Many people say afterward, 'I wish I had asked' — bringing it up during consultation doesn't commit you to anything.",
        "Dolgu":"A small question can make a big difference — asking during consultation is enough; the decision is entirely yours.",
        "Çene Ucu Estetiği":"Many people don't think of it, but it makes a huge difference in the facial profile — if you're curious, ask during your consultation.",
        "Çene Dolgusu":"You can try it without surgery — it's worth asking during consultation before making a permanent decision.",
        "Meme Dikleştirme":"Many people are curious about this but hesitate to ask — asking a question doesn't commit you to anything.",
        "Korse Liposuction":"You can simply ask, 'Is this right for me?' — your doctor is the best judge.",
        "Liposuction":"Don't worry, you can simply ask, 'Is this suitable for me?' — the decision is entirely yours.",
        "Karın Germe":"Many people discover this afterward — it's much better to ask and learn during consultation.",
        "Boyun Germe":"Many people say afterward they wish they had asked — bringing it up during consultation doesn't commit you to anything.",
        "Uyluk Germe":"If you're curious, you can ask — your doctor will recommend the best plan for you.",
        "Sıvı Yüz Germe":"If you're wondering how much change is possible without surgery, you can ask during your consultation.",
        "İp Askı":"It makes sense to ask about this option before making a permanent decision — it doesn't require surgery.",
        "Meme Büyütme (Silikon Protez ile)":"Many people are curious about this — asking during consultation doesn't commit you to anything; the decision is entirely yours.",
      },
      social:{
        "Kaş Kaldırma":"The eye area is the most noticeable part of the face — when brow and eyelid are addressed together, the difference in photos is much more striking.",
        "Botoks":"The skin surface looks much smoother in the light — the vast majority of those who want to share their results get this done too.",
        "Yüz Germe":"When the lower eyelid and face are rejuvenated together, the difference in photos and videos is incredible.",
        "Dolgu":"When volume and contour are addressed together, results become much more dramatic and shareable.",
        "Çene Ucu Estetiği":"One of the most defining details in profile photos — when the jawline is strengthened, the entire face looks much more attractive.",
        "Çene Dolgusu":"An application that makes a big difference from a selfie angle — the jawline can make your profile much more defined.",
        "Meme Dikleştirme":"The effect on clothing and posture is very noticeable — when both are done together, the result is much more eye-catching.",
        "Korse Liposuction":"When the entire silhouette is shaped, the effect on how clothes fit changes dramatically.",
        "Liposuction":"When the entire body contour is addressed, the silhouette can become much more dramatic and photogenic.",
        "Karın Germe":"When the waist and abdomen are shaped together, clothes fit very differently — the effect is much more pronounced.",
        "Boyun Germe":"When face and neck are rejuvenated together, the difference in photos and videos is incredible.",
        "Uyluk Germe":"When legs and arms are tightened together, the entire body looks much more balanced and striking.",
        "Sıvı Yüz Germe":"In a combined treatment, every area of the face lights up at once — the impact in photos is very powerful.",
        "İp Askı":"The effect achieved with minimal intervention is very noticeable in photos — ideal for sharing on social media.",
        "Meme Büyütme (Silikon Protez ile)":"The effect on clothing options and silhouette is very noticeable — most patients want to share their results.",
      },
    },
  };

  function t(key,fallback){if(lang==="tr") return fallback; const parts=key.split("."); let v=EN; for(const p of parts){v=v?.[p]; if(!v) return fallback;} return v;}
  function tOpt(qId,opt){if(lang==="tr") return opt; if(qId==="procedure") return EN.procs?.[opt]||opt; return EN.q?.[qId]?.options?.[opt]||opt;}
  function tSec(sec){if(lang==="tr") return sec; return EN.sections?.[sec]||sec;}
  function tProc(proc){if(lang==="tr") return proc; return EN.procs?.[proc]||proc;}
  const [doctorInfo,setDoctorInfo]=useState(null);
  const [ambassadorCode,setAmbassadorCode]=useState(null);
  const [patientSegment,setPatientSegment]=useState(null);
  const [personalGuide,setPersonalGuide]=useState(null);
  const [guideLoading,setGuideLoading]=useState(false);
  const [questionTimes,setQuestionTimes]=useState({});
  const [questionChanges,setQuestionChanges]=useState({});
  const qStartTime=useRef(Date.now());
  // Doktora özel prosedür listesi ve form modu
  const doctorProcs=doctorInfo?.enabled_procedures;
  const formMode=doctorInfo?.form_mode||"short"; // "short" = 6 çekirdek soru, "full" = tüm sorular
  const DYNAMIC_QUESTIONS=QUESTIONS.map(q=>
    q.id==="procedure"&&doctorProcs&&doctorProcs.length>0
      ?{...q,options:q.options.filter(o=>doctorProcs.includes(o))}
      :q
  );
  const VISIBLE_QUESTIONS=DYNAMIC_QUESTIONS.filter(q=>{
    // showIf koşulu varsa kontrol et
    if(q.showIf&&!q.showIf(answers)) return false;
    // short modda sadece core sorular
    if(formMode==="short"&&!q.core) return false;
    return true;
  });
  const q=VISIBLE_QUESTIONS[currentQ];
  const canNext=(q?.optional||answers[q?.id]!==undefined&&answers[q?.id]!=="")&&
    !(q?.id==="referralCode"&&answers["source"]!=="Bir hasta beni yönlendirdi (referans kodu var)"&&!answers[q?.id])
    ||(q?.id==="referralCode");
  const progress=(currentQ/VISIBLE_QUESTIONS.length)*100;
  const VISIBLE_SECTIONS=[...new Set(VISIBLE_QUESTIONS.map(q=>q.section))];
  const secIdx=VISIBLE_SECTIONS.indexOf(q?.section);
  const accent=doctorInfo?.primary_color||"#1e3a5f";
  const C={bg:"#f8fafd",accent:accent,navy:"#1e3a5f",muted:"#7b9ab5",border:"#d4e1ef"};

  useEffect(()=>{
    if(!doctorId) return;
    const isUUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(doctorId);
    const col=isUUID?"id":"username";
    sb.from("doctors").select("id,name,clinic_name,photo_url,primary_color,enabled_procedures,form_mode").eq(col,doctorId).maybeSingle()
      .then(({data})=>{ if(data){ setDoctorInfo(data); if(!isUUID) setDoctorId(data.id); } });
  },[doctorId]);

  // Geri tuşu + sekme kapatma koruması
  useEffect(()=>{
    if(submitted||currentQ===0) return; // ilk soru veya gönderilmiş ise koruma yok
    const handleBeforeUnload=(e)=>{e.preventDefault();e.returnValue="";};
    const handlePopState=(e)=>{
      e.preventDefault();
      if(currentQ>0) setCurrentQ(c=>Math.max(0,c-1));
      else window.history.pushState(null,"",window.location.href);
    };
    window.addEventListener("beforeunload",handleBeforeUnload);
    window.history.pushState(null,"",window.location.href);
    window.addEventListener("popstate",handlePopState);
    return()=>{
      window.removeEventListener("beforeunload",handleBeforeUnload);
      window.removeEventListener("popstate",handlePopState);
    };
  },[currentQ,submitted]);

  const [submitError,setSubmitError]=useState("");

  async function handleSubmit(){
    if(submitting) return; // çift gönderim engeli
    setSubmitting(true);
    setSubmitError("");
    // Skorlama: v6b (4 feature) primary → klinik modeli → v5 fallback
    let score, modelSource="global_v6b";
    try {
      // 1. v6b — 4 temiz feature, ampirik doğrulanmış
      score = computeV6bScore(answers).riskScore;

      // 2. Klinik modeli varsa blend et (klinik %30 + v6b %70)
      const clinicModel = await loadClinicModel(doctorId);
      if(clinicModel && clinicModel.weights) {
        const clinicScore = Math.round(computeScoreWithModel(answers, clinicModel.weights));
        score = Math.round(score * 0.70 + clinicScore * 0.30);
        modelSource = `v6b+clinic_v${clinicModel.version||1}`;
      }
    } catch(e) {
      // v5 fallback
      score = computeMLScore(answers).riskScore;
      modelSource = "global_v5_fallback";
    }
    const cls=classify(score,answers);
    const ambCode=cls.ambassador?"REF-"+Math.random().toString(36).substr(2,4).toUpperCase():null;
    const timingData={questionTimes,questionChanges};
    const slowQuestions=Object.entries(questionTimes).filter(([,s])=>s>30).map(([id])=>id);
    const changedQuestions=Object.entries(questionChanges).filter(([,c])=>c>0).map(([id,c])=>`${id}(${c}x)`);

    // İsmi şifrele
    const encryptedName=await encryptName(answers.name||"",doctorId||"default");
    const encryptedGender=await encryptName(answers.gender||"",doctorId||"default");
    const encryptedStory=answers.openStory?await encryptName(answers.openStory,doctorId||"default"):"";
    const safeAnswers={...answers,name:encryptedName,gender:encryptedGender,openStory:encryptedStory,kvkk_consent:true,kvkk_date:new Date().toISOString()};

    const rec={
      id:crypto.randomUUID?crypto.randomUUID():Date.now().toString(),
      doctor_id:doctorId,
      date:new Date().toISOString(),
      created_at:new Date().toISOString(),
      risk_score:score,
      segment:cls.label,
      answers:safeAnswers,
      ambassador_code:ambCode||"",
      ambassador_sent:false,
      outcome_procedures:[],
      no_appointment:false,
      model_source:modelSource,  // hangi model kullanıldı
      referred_by:answers.referralCode||null,  // referans kodu varsa kaydet
    };

    const {error}=await sb.from("patients").insert(rec);
    if(error){
      console.error("Insert hatası:",error);
      setSubmitError("Form kaydedilemedi. Lütfen internet bağlantınızı kontrol edip tekrar deneyin.");
      setSubmitting(false);
      return;
    }

    setSubmitted(true);
    setSubmitting(false);
    setAmbassadorCode(ambCode);
    setPatientSegment(cls);
    fetchPersonalGuide(answers,score,cls,slowQuestions,changedQuestions);
  }

  async function fetchPersonalGuide(a,score,cls,slowQ=[],changedQ=[]){
    setGuideLoading(true);
    const profile=detectProfile(a);
    const profileNames={analyst:"analitik ve araştırmacı",trustseeker:"güven arayan ve endişeli",social:"sosyal ve paylaşımcı",pragmatic:"pratik ve hızlı karar veren"};
    const toneInstructions={
      analyst:"Bilimsel ve teknik bir dil kullan. Spesifik süreler, yüzdeler ve mekanizmalar belirt. Klinik terminoloji kullan ama açıkla.",
      trustseeker:"Çok sıcak, güvence verici ve yargısız bir dil kullan. 'Normal', 'endişelenmeyin', 'yanınızdayız' ifadelerini kullan. Karmaşık terimlerden kaçın.",
      social:"Sosyal hayata dönüş, görünüm ve çevresiyle paylaşım odaklı yaz. Ne zaman dışarı çıkabileceğini, ne zaman fark edilmeyeceğini vurgula.",
      pragmatic:"Çok kısa, madde madde, net. Sayılar ve tarihler kullan. Gereksiz açıklama yapma.",
    };
    try{
      setGuideLoading(true);
      if(!canCallAPI()){setGuideLoading(false);return;}
      const res=await fetch("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        model:"claude-sonnet-4-20250514",
        max_tokens:800,
        messages:[{role:"user",content:`Sen empati yeteneği çok yüksek, klinik deneyimli bir hasta koordinatörüsün. ${doctorInfo?.clinic_name||"Plastik Cerrahi Kliniği"}'nde çalışıyorsun.

Aşağıdaki kişi formu doldurdu ve şu an teşekkür ekranını okuyor. Bu kişiye özel, sadece ona yazılmış gibi hissettiren bir rehber yaz.

KİŞİ HAKKINDA BİLDİKLERİN:
- ${a.name||"Hasta"}, ${a.age} yaş, ${a.gender}
- İstediği işlem: ${a.procedure}
- Ek bölge ilgisi: ${a.otherAreas||"belirtmedi"}
- Başka işlem düşünmüş mü: ${a.otherConsidered||"belirtmedi"}
- Motivasyon: ${a.motivation}
- Beklenti: ${a.expectation}
- Hayal ettiği: ${a.imagineAfter||"belirtmedi"}
- Süreci ne kadar biliyor: ${a.riskKnowledge}
- Sosyal destek: ${a.support}
- Revizyon tutumu: ${a.revision}
- Önceki işlem: ${a.prevSurgery}
- Benlik saygısı: ${a.selfEsteem||"belirtmedi"}
- Kaçınma davranışı: ${a.avoidance||"belirtmedi"}
- Uzun düşündüğü sorular: ${slowQ.length>0?slowQ.join(", "):"yok"}
- Cevap değiştirdiği: ${changedQ.length>0?changedQ.join(", "):"yok"}
- Değişim beklentisi: "${a.openStory||"boş bıraktı"}"
- Risk segmenti: ${cls.cat} (${cls.label})

SEGMENT'E GÖRE ODAK:
${cls.cat==="green"?"Bu kişi randevuya hazır ama henüz net karar vermemiş olabilir. 'Doğru adımı atıyorsunuz' mesajı ver. Randevuyu somutlaştır.":""}
${cls.cat==="amber"?"Bu kişi kararsız ya da bazı endişeleri var. Güvence ver, endişelerini normalize et, ama gerçekçi ol.":""}
${cls.cat==="red"?"Bu kişide yüksek risk var. Sakin, güven verici ama beklenti yönetici bir ton. Performatif heyecan yok.":""}

${(a.otherAreas&&a.otherAreas!=="Hayır, sadece bu bölge")||(a.otherConsidered&&a.otherConsidered!=="Hayır")?`CROSS-SELL FIRSATI: Bu kişi ${a.procedure} dışında da ilgi gösterdi (${a.otherAreas||""} / ${a.otherConsidered||""}). [Size Özel Tavsiye] bölümünde doktorla bu konuyu konuşmaya nazikçe teşvik et — "konsültasyonda bunu da sorabilirsiniz" gibi. Satış gibi değil, bilgilendirme gibi.`:""}

FORMAT — tam olarak bu 3 başlık:
[Sizi Bekleyen Süreç]
[Dikkat Etmeniz Gerekenler]
[Size Özel Tavsiye]

Her bölüm 2-3 cümle, akıcı paragraf. Toplam 180-220 kelime.
Profil etiketi kullanma. O kişiyle konuşur gibi yaz. Klişelerden kaçın.
Türkçe yaz.`}]
      })});
      const d=await res.json();
      const txt=d.content?.map(b=>b.text||"").join("")||"";
      setPersonalGuide(txt);
    }catch{
      setPersonalGuide(null);
    }
    setGuideLoading(false);
  }

  const proc=answers.procedure||"";
  const PI=PROCEDURE_INFO[proc]||PROCEDURE_INFO["default"];
  const piTimeline=lang==="en"&&EN.procInfo?.[proc]?.timeline?EN.procInfo[proc].timeline:PI.timeline;
  const piPrep=lang==="en"&&EN.procInfo?.[proc]?.prep?EN.procInfo[proc].prep:PI.prep;
  const piNormal=lang==="en"&&EN.procInfo?.[proc]?.normal?EN.procInfo[proc].normal:PI.normal;
  const piFollowup=lang==="en"&&EN.procInfo?.[proc]?.followup?EN.procInfo[proc].followup:PI.followup;

  // Cross-sell haritası — işleme göre tamamlayıcı öneriler
  const CROSS_SELL_MAP={
    "Üst Göz Kapağı Estetiği":[
      {proc:"Kaş Kaldırma",why:"Kaş pozisyonu göz kapağı sonucunu doğrudan etkiliyor — birlikte değerlendirilince çok daha dengeli bir sonuç ortaya çıkabiliyor."},
      {proc:"Botoks",why:"Göz çevresindeki ince çizgiler için botoks, göz kapağı estetiğini güzel şekilde tamamlayabiliyor."},
    ],
    "Alt Göz Kapağı Estetiği":[
      {proc:"Yüz Germe",why:"Alt göz kapağı ile yüz alt bölgesi aynı seansta değerlendirilebiliyor — bazı hastalarda çok daha bütüncül bir sonuç veriyor."},
      {proc:"Dolgu",why:"Göz altı çukurluğu için dolgu, ameliyat sonrası görünümü destekleyebiliyor."},
    ],
    "Burun Estetiği":[
      {proc:"Çene Ucu Estetiği",why:"Çene-burun oranı yüz profilini belirleyen en önemli faktörlerden biri — çene ucu değerlendirmesi sonucu belirgin şekilde güçlendirebiliyor."},
      {proc:"Çene Dolgusu",why:"Cerrahi olmadan çene hattını güçlendirmek isteyenler için dolgu, burun estetiğiyle birlikte çok daha dengeli bir profil oluşturabiliyor."},
    ],
    "Meme Büyütme (Silikon Protez ile)":[
      {proc:"Meme Dikleştirme",why:"Sarkma varsa meme büyütme ile dikleştirme aynı seansta yapılabiliyor — ikinci ameliyat ihtiyacını ortadan kaldırabiliyor."},
      {proc:"Korse Liposuction",why:"Bel hatlarını birlikte şekillendirmek, meme büyütme sonucunun vücutla uyumunu çok daha güçlü kılabiliyor."},
    ],
    "Meme Dikleştirme":[
      {proc:"Meme Büyütme (Silikon Protez ile)",why:"Hacim kaybı da varsa dikleştirme ile birlikte değerlendirilebiliyor — tek seansta çok daha tatmin edici sonuç veriyor."},
      {proc:"Korse Liposuction",why:"Bel ve yan hat şekillendirme, meme estetiği sonucunu vücutla çok daha uyumlu hale getirebiliyor."},
    ],
    "Meme Küçültme":[
      {proc:"Liposuction",why:"Koltuk altı ve yan göğüs bölgesi aynı seansta liposuction ile şekillendirilebiliyor — bütüncül bir siluet için değerlendirilebilir."},
      {proc:"Korse Liposuction",why:"Bel ve sırt bölgesiyle birlikte ele alındığında meme küçültme çok daha orantılı bir görünüm yaratıyor."},
    ],
    "Karın Germe":[
      {proc:"Liposuction",why:"Karın germe ile liposuction birlikte yapıldığında bel ve yan hatlar çok daha belirgin hale gelebiliyor."},
      {proc:"Korse Liposuction",why:"Korse liposuction karın germe sonucunu bütünleyerek daha kadınsı bir siluet oluşturabiliyor."},
    ],
    "Liposuction":[
      {proc:"Karın Germe",why:"Liposuction sonrası deri sarkması oluşabiliyorsa karın germe seçeneği önceden değerlendirilebiliyor."},
      {proc:"Korse Liposuction",why:"Bel, sırt ve yan hatları birlikte şekillendiren korse liposuction, standart liposuction'ı tamamlayan bir yaklaşım olabiliyor."},
    ],
    "Yüz Germe":[
      {proc:"Boyun Germe",why:"Yüz ve boyun birlikte ele alındığında çok daha doğal ve bütüncül bir yenilenme sağlanabiliyor."},
      {proc:"Dolgu",why:"Yüz germe sonrası hacim kayıplarını dolgu ile desteklemek sonucu belirgin şekilde güçlendirebiliyor."},
      {proc:"Botoks",why:"Alın ve göz çevresi için botoks, yüz germe sonucunu tamamlayan çok yaygın bir tercih."},
    ],
    "Jinekomasti":[
      {proc:"Liposuction",why:"Jinekomasti ile birlikte göğüs çevresi yağlanması varsa liposuction aynı seansta değerlendirilebiliyor."},
      {proc:"Karın Germe",why:"Karın bölgesi de rahatsızlık yaratıyorsa aynı seansta ele alınabiliyor — tek iyileşme süreci anlamına geliyor."},
    ],
    "Kol Germe":[
      {proc:"Liposuction",why:"Kol germe ile birlikte liposuction uygulanması kolların hem sıkılaşmasını hem şekillenmesini sağlayabiliyor."},
      {proc:"Uyluk Germe",why:"Kollar ve uyluklar birlikte ele alındığında bütüncül bir vücut sıkılaştırma sonucu elde edilebiliyor."},
    ],
    "Uyluk Germe":[
      {proc:"Liposuction",why:"Uyluk germe ile birlikte liposuction, bacak konturunu çok daha belirgin şekilde şekillendirebiliyor."},
      {proc:"Kol Germe",why:"Kol ve uyluk sıkılaştırma birlikte planlandığında tek iyileşme sürecinde kapsamlı bir sonuç alınabiliyor."},
    ],
    "Yüz Germe (Mini)":[
      {proc:"Boyun Germe",why:"Mini yüz germe ile boyun bölgesi birlikte ele alındığında sonuç çok daha kapsamlı ve doğal görünüyor."},
      {proc:"Dolgu",why:"Mini yüz germe sonrası hacim desteği için dolgu, yüzün gençliğini çok daha uzun süre koruyabiliyor."},
      {proc:"Botoks",why:"Dinamik çizgiler için botoks, mini yüz germeyi mükemmel şekilde tamamlıyor."},
    ],
    "Sıvı Yüz Germe":[
      {proc:"Botoks",why:"Dolgu ve botoks birlikte uygulandığında 'sıvı yüz germe' etkisi çok daha kapsamlı bir yenilenme sunuyor."},
      {proc:"İp Askı",why:"İp askı ile birlikte değerlendirildiğinde sarkma ve hacim kaybı aynı anda ele alınabiliyor."},
    ],
    "Botoks":[
      {proc:"Dolgu",why:"Botoks dinamik çizgileri, dolgu ise hacim kayıplarını ele alıyor — ikisi birlikte çok daha bütüncül bir yenilenme sağlıyor."},
      {proc:"Sıvı Yüz Germe",why:"Cerrahi olmadan kapsamlı bir yenilenme isteyenler için dolgu ve botoks kombinasyonu giderek yaygınlaşıyor."},
    ],
    "Dolgu":[
      {proc:"Botoks",why:"Dolgu hacim için, botoks çizgiler için — ikisi birlikte uygulandığında sonuç çok daha dengeli oluyor."},
      {proc:"Sıvı Yüz Germe",why:"Yüzün farklı bölgelerini birlikte ele alan kombine yaklaşım, tek işlemden çok daha kapsamlı bir etki yaratıyor."},
    ],
    "İp Askı":[
      {proc:"Dolgu",why:"İp askı ile dolgu birlikte uygulandığında sarkma ve hacim kaybı aynı seansta ele alınabiliyor."},
      {proc:"Botoks",why:"İp askı sonrası botoks desteği sonucun ömrünü uzatmaya yardımcı olabiliyor."},
    ],
  };

  const crossSellSuggestions=(()=>{
    const base=CROSS_SELL_MAP[proc]||[];
    if(base.length===0) return [];

    const a=answers;
    const age=parseInt(a.age)||30;

    const isAnalyst=a.riskKnowledge?.includes("Detaylı");
    const isPragmatic=false; // soru kaldırıldı
    const isTrustSeeker=a.riskKnowledge?.includes("Hiçbir")||a.support?.includes("Kimseye");
    const isSocial=false; // soru kaldırıldı
    const isExternal=["Yakınlarımın yorumları etkili oldu","Başka insanların yorumları beni kötü etkiliyor"].some(x=>a.motivation===x);
    const isHighExpect=a.expectation?.includes("Tamamen farklı");

    if(isExternal&&isHighExpect) return [];

    const filtered=base.filter(s=>{
      if(age<30&&(s.proc.includes("Yüz Germe")||s.proc.includes("Boyun Germe"))) return false;
      if(age<25&&s.proc.includes("Boyun Germe")) return false;
      if(age>55&&s.proc.includes("Dolgu")&&proc.includes("Meme")) return false;
      if(age<35&&s.proc.includes("Karın Germe")&&proc.includes("Liposuction")) return false;
      return true;
    });

    // Tüm işlemler × 4 profil mesaj tablosu
    const MESSAGES={
      analyst:{
        "Kaş Kaldırma":"Kaş-kapak oranı cerrahi planlamada kritik bir değişken — kaş pozisyonu değerlendirilmeden yapılan göz kapağı girişimleri zaman içinde yetersiz kalabiliyor.",
        "Botoks":"Nörotoksin uygulaması dinamik çizgiler için altın standart — statik değişikliklerle kombine yaklaşım çok daha kapsamlı bir yenilenme sunuyor.",
        "Yüz Germe":"Alt göz kapağı ile birlikte ritmidektomi planlandığında tek iyileşme sürecinde çok daha kapsamlı bir sonuç elde ediliyor.",
        "Dolgu":"Volüm restorasyonu ve yapısal değişiklik farklı patolojiler — ikisi birlikte ele alındığında sonuç anatomik açıdan çok daha bütüncül oluyor.",
        "Çene Ucu Estetiği":"Fasiyal estetik analizde çene-burun oranı temel referans noktası — profilometrik açıdan çene değerlendirmesi rinoplasti planlamasının ayrılmaz bir parçası.",
        "Çene Dolgusu":"Cerrahi olmadan çene projeksiyonunu optimize etmek mümkün — rinoplasti öncesi veya sonrasında filler ile profil dengesi çok daha hassas ayarlanabiliyor.",
        "Meme Dikleştirme":"Silikon yerleşimi ile eş zamanlı mastopexi, cilt zarf kalitesini korurken hacmi optimize ediyor — ayrı seanslara kıyasla iyileşme süreci ve skar yükü azalıyor.",
        "Korse Liposuction":"Gövde konturunun bütünü ele alındığında estetik sonucun vücutla orantısallığı çok daha güçlü hale geliyor.",
        "Liposuction":"Kombine yaklaşımda flap kaldırma sırasında lateral hatlar şekillendirilebiliyor — tek seansta çok daha kapsamlı bir kontur elde ediliyor.",
        "Karın Germe":"Liposuction sonrası deri elastikiyeti değerlendirmesi kritik — sarkma riski varsa önceden planlamak çok daha iyi sonuç veriyor.",
        "Boyun Germe":"Ritmidektomi ile platismaplasti birlikte yapıldığında alt yüz-boyun geçiş bölgesinde anatomik bütünlük sağlanıyor.",
        "Uyluk Germe":"Ekstremite konturlamasında bütüncül planlama tek seansta çok daha uyumlu bir sonuç veriyor.",
        "Sıvı Yüz Germe":"Nonsurgical kombinasyonlarda sinerji etkisi belgelenmiş — tek ajan uygulamasına kıyasla çok daha kapsamlı bir yenilenme sağlanıyor.",
        "İp Askı":"Mekanik destek ile volüm restorasyonu birlikte planlandığında sonucun sürekliliği çok daha güçlü oluyor.",
        "Meme Büyütme (Silikon Protez ile)":"Hacim ve ptoz eş zamanlı ele alındığında tek iyileşme sürecinde çok daha tatmin edici bir sonuç elde ediliyor.",
      },
      pragmatic:{
        "Kaş Kaldırma":"Aynı seansta yapılıyor, ek iyileşme süresi yok — sonuç çok daha belirgin çıkıyor.",
        "Botoks":"Konsültasyon günü bile yapılabiliyor, 15-20 dakika — ayrı randevu gerekmez.",
        "Yüz Germe":"Aynı anestezi, aynı iyileşme — iki ayrı ameliyat yerine tek seferlik.",
        "Dolgu":"Aynı seansta tamamlanabiliyor, ek ziyaret gerektirmiyor.",
        "Çene Ucu Estetiği":"Tek randevuda hem burun hem çene tamamlanıyor, ayrı sefer gerekmez.",
        "Çene Dolgusu":"20-30 dakikalık bir uygulama — aynı gün yapılabilir, ek süreç yok.",
        "Meme Dikleştirme":"Tek anestezi, tek iyileşme süreci — ikinci ameliyat planlamak zorunda kalmıyorsunuz.",
        "Korse Liposuction":"Aynı seansta birleştiriliyor — toplam süreç iki ayrı ameliyattan çok daha kısa.",
        "Liposuction":"Birlikte planlanınca tek iyileşme süreci — zaman ve maliyet açısından çok daha verimli.",
        "Karın Germe":"Şimdi değerlendirip planlamak, ileride ikinci bir ameliyat ihtimalini ortadan kaldırıyor.",
        "Boyun Germe":"Yüz ve boyun aynı anda tamamlanıyor — iki ayrı süreç yerine tek seferlik.",
        "Uyluk Germe":"Tek iyileşme sürecinde ikisi birlikte tamamlanıyor — çok daha pratik.",
        "Sıvı Yüz Germe":"Aynı seansta yapılabiliyor, cerrahi gerektirmiyor — hızlı ve pratik bir seçenek.",
        "İp Askı":"Minimal invaziv, kısa iyileşme — botoks ile aynı gün planlanabiliyor.",
        "Meme Büyütme (Silikon Protez ile)":"Tek anestezi, tek iyileşme — iki ayrı ameliyat planlamak zorunda kalmıyorsunuz.",
      },
      trustSeeker:{
        "Kaş Kaldırma":"Bunu fark etmeden gelenlerin çoğu konsültasyonda ilk kez duyuyor — sadece sormak bile yeterli, doktorunuz değerlendirsin.",
        "Botoks":"Merak ediyorsanız sorabilirsiniz — doktorunuz size uygun olup olmadığını zaten söyleyecek.",
        "Yüz Germe":"Pek çok kişi sonradan 'keşke sorsaydım' diyor — konsültasyonda gündeme getirmek hiçbir şeyi bağlamıyor.",
        "Dolgu":"Küçük bir soru, büyük fark yaratabilir — konsültasyonda sormak yeterli, karar tamamen size ait.",
        "Çene Ucu Estetiği":"Pek çok kişinin aklına gelmiyor ama yüz profilinde büyük fark yaratıyor — merak ediyorsanız konsültasyonda bir sorun.",
        "Çene Dolgusu":"Cerrahi olmadan deneyebilirsiniz — kalıcı bir karar vermeden önce konsültasyonda sormaya değer.",
        "Meme Dikleştirme":"Bunu merak eden çok kişi var ama çoğu sormaktan çekiniyor — bir soru sormak hiçbir şeyi bağlamıyor.",
        "Korse Liposuction":"Sadece 'benim için uygun mu' diye sorabilirsiniz — doktorunuz en iyi değerlendireni.",
        "Liposuction":"Endişelenmeyin, sadece 'bu benim için uygun mu' diye sorabilirsiniz — karar tamamen size ait.",
        "Karın Germe":"Birçok kişi bunu sonradan keşfediyor — konsültasyonda bir sorup öğrenmek çok daha iyi.",
        "Boyun Germe":"Pek çok kişi sonradan keşke sorsaydım diyor — konsültasyonda gündeme getirmek hiçbir şeyi bağlamıyor.",
        "Uyluk Germe":"Merak ediyorsanız sorabilirsiniz — doktorunuz size en uygun planı zaten önerecek.",
        "Sıvı Yüz Germe":"Cerrahi olmadan ne kadar değişiklik mümkün olduğunu merak ediyorsanız konsültasyonda sorabilirsiniz.",
        "İp Askı":"Kalıcı bir karar vermeden önce bu seçeneği sormak mantıklı — cerrahi gerektirmiyor.",
        "Meme Büyütme (Silikon Protez ile)":"Bunu merak eden çok kişi var — konsültasyonda sormak hiçbir şeyi bağlamıyor, karar tamamen sizin.",
      },
      social:{
        "Kaş Kaldırma":"Göz çevresi yüzün en çok dikkat çeken bölgesi — kaş ve kapak birlikte ele alınınca fotoğraflarda fark çok daha belirgin oluyor.",
        "Botoks":"Işık altında cilt yüzeyi çok daha pürüzsüz görünüyor — sonuçları paylaşmak isteyenlerin büyük çoğunluğu bunu da yaptırıyor.",
        "Yüz Germe":"Alt göz kapağı ile birlikte yüz gençleşince fotoğraflarda ve videolarda fark inanılmaz oluyor.",
        "Dolgu":"Hacim ve kontur birlikte ele alındığında sonuçlar çok daha çarpıcı ve paylaşılabilir hale geliyor.",
        "Çene Ucu Estetiği":"Profil fotoğraflarında en belirleyici detaylardan biri — çene hattı güçlenince tüm yüz çok daha çekici görünüyor.",
        "Çene Dolgusu":"Selfie açısından büyük fark yaratan bir uygulama — çene hattı profilinizi çok daha belirgin hale getirebiliyor.",
        "Meme Dikleştirme":"Giyim ve duruş üzerindeki etkisi çok belirgin — ikisi birlikte yapılınca sonuç çok daha göz alıcı oluyor.",
        "Korse Liposuction":"Siluet bütünüyle şekillenince kıyafetlerin üzerindeki etkisi dramatik biçimde değişiyor.",
        "Liposuction":"Vücut kontürünün bütünü ele alındığında siluet çok daha çarpıcı ve fotoğrafik bir hal alabiliyor.",
        "Karın Germe":"Bel ve karın birlikte şekillenince kıyafetler çok farklı oturuyor — etki çok daha belirgin oluyor.",
        "Boyun Germe":"Yüz ve boyun birlikte gençleşince fotoğraflarda ve videolarda fark inanılmaz oluyor.",
        "Uyluk Germe":"Bacak ve kol birlikte sıkılaşınca vücudun bütünü çok daha dengeli ve çarpıcı görünüyor.",
        "Sıvı Yüz Germe":"Kombine uygulamada yüzün her bölgesi birden parlıyor — fotoğraflara yansıması çok güçlü oluyor.",
        "İp Askı":"Minimal müdahaleyle elde edilen etki fotoğraflarda çok belirgin — sosyal medyada paylaşım için ideal.",
        "Meme Büyütme (Silikon Protez ile)":"Giyim seçenekleri ve siluet üzerindeki etkisi çok belirgin — çoğu hasta sonuçları paylaşmak istiyor.",
      },
    };

    const profileKey=isAnalyst?"analyst":isPragmatic?"pragmatic":isTrustSeeker?"trustSeeker":isSocial?"social":null;

    return filtered.map(s=>{
      let why=s.why;
      if(profileKey&&MESSAGES[profileKey][s.proc]){
        why=MESSAGES[profileKey][s.proc];
      }
      if(lang==="en"){
        if(profileKey&&EN.crossSellMessages?.[profileKey]?.[s.proc]){
          why=EN.crossSellMessages[profileKey][s.proc];
        }else{
          const csEntry=EN.crossSell?.[proc]?.find(x=>x.proc===s.proc);
          if(csEntry) why=csEntry.why;
        }
      }
      return {...s,why};
    });
  })();
  const profile=detectProfile(answers);
  const PC=lang==="en"?EN_PROFILE_CONTENT[profile]||PROFILE_CONTENT[profile]:PROFILE_CONTENT[profile];
  const recoveryText=getPersonalizedContent(proc,profile,"recovery",lang);
  const riskText=getPersonalizedContent(proc,profile,"risks",lang);
  const [infoPage,setInfoPage]=useState(0); // 0=thanks+proc, 1=prep+normal

  const BORD="#1d4ed8";
  const BORD2="#2d5a8e";

  // Kapanış ekranı — isim + cinsiyet hitabı
  const patientName=(answers.name||"").split(" ")[0];
  const honorific=lang==="tr"?(answers.gender==="Kadın"?" Hanım":answers.gender==="Erkek"?" Bey":""):"";

  if(submitted) return(
    <div style={{minHeight:"100vh",background:"#f8fafd",fontFamily:"'Nunito',sans-serif",display:"flex",flexDirection:"column"}}>
      {/* Header */}
      <div style={{padding:"16px 22px",display:"flex",alignItems:"center",justifyContent:"space-between",background:"#f8fafd",borderBottom:"1px solid #d4e1ef",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:7}}>
          <div style={{width:18,height:18,border:"1px solid #d4e1ef",borderRadius:4,display:"flex",alignItems:"center",justifyContent:"center"}}>
            <div style={{width:5,height:5,background:accent,borderRadius:"50%"}}/>
          </div>
          <div style={{fontFamily:"'Playfair Display',serif",fontSize:15,color:"#1e3a5f",letterSpacing:"0.02em"}}>SculptAI</div>
        </div>
        <div style={{fontSize:11,color:"#7b9ab5",letterSpacing:"0.06em"}}>{doctorInfo?.clinic_name||(lang==="tr"?"Plastik Cerrahi Kliniği":"Plastic Surgery Clinic")}</div>
      </div>

      {/* Content */}
      <div style={{flex:1,display:"flex",flexDirection:"column",justifyContent:"center",padding:"40px 24px"}}>
        <div style={{maxWidth:480,margin:"0 auto",textAlign:"center"}}>

          <div style={{fontSize:42,marginBottom:20}}>✨</div>

          <div style={{fontFamily:"'Playfair Display',serif",fontSize:32,fontWeight:300,color:"#1e3a5f",lineHeight:1.2,marginBottom:20,letterSpacing:"-0.01em"}}>
            {lang==="tr"?"Teşekkür Ederiz":"Thank You"}
          </div>

          <div style={{fontSize:15,color:"#7b9ab5",lineHeight:1.9,marginBottom:28}}>
            {lang==="tr"
              ?<>{patientName}{honorific}, formu tamamladığınız için teşekkür ederiz. Yanıtlarınız ekibimiz tarafından değerlendirilecek ve sizin için en uygun yaklaşım belirlenecektir.<br/><br/>Birçok hastamızın ortak noktası, karar vermeden önce doğru bilgiye ve güvenilir bir değerlendirmeye ihtiyaç duymasıdır. Bu nedenle ilk görüşmemizde tüm sorularınızı yanıtlayacak ve sizin için en uygun seçenekleri birlikte değerlendireceğiz.<br/><br/>Sizinle tanışmayı sabırsızlıkla bekliyoruz. 🌷</>
              :<>Dear {patientName}, thank you for completing the form. Your answers will be reviewed by our team to determine the approach best suited to you.<br/><br/>Something most of our patients share is the need for accurate information and a trustworthy assessment before deciding. That's why, in our first consultation, we'll answer all your questions and explore the most suitable options together.<br/><br/>We look forward to meeting you. 🌷</>
            }
          </div>

          <div style={{display:"inline-flex",alignItems:"center",gap:8,padding:"8px 22px",border:`1px solid ${accent}22`,borderRadius:24,fontSize:12,color:accent,background:`${accent}08`}}>
            ✦ {doctorInfo?.clinic_name||(lang==="tr"?"Plastik Cerrahi Kliniği":"Plastic Surgery Clinic")}
          </div>

        </div>
      </div>
    </div>
  );

  return(
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:"'Nunito',sans-serif",color:C.navy}}>
      {/* Hero — tek resim */}
      {currentQ===0&&(
        <div style={{width:"100%",height:240,position:"relative",overflow:"hidden",flexShrink:0,background:"linear-gradient(135deg, #e8f0fa 0%, #d4e5f5 50%, #c0d8f0 100%)"}}>
          <img src="/form-hero.png" alt="" style={{width:"100%",height:"100%",objectFit:"cover",objectPosition:"center"}}
            onError={e=>{e.target.style.display="none"}}/>
          <div style={{position:"absolute",inset:0,background:"linear-gradient(to bottom, rgba(248,250,253,0) 40%, #f8fafd 100%)"}}/>
          <div style={{position:"absolute",top:16,left:20,display:"flex",alignItems:"center",gap:7}}>
            <div style={{width:20,height:20,border:"1px solid rgba(255,255,255,0.7)",borderRadius:4,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(245,240,232,0.25)"}}>
              <div style={{width:6,height:6,background:"white",borderRadius:"50%"}}/>
            </div>
            <div style={{fontSize:13,fontWeight:500,color:"white",letterSpacing:"0.04em",textShadow:"0 1px 6px rgba(0,0,0,0.3)"}}>SculptAI</div>
          </div>
        </div>
      )}

      {/* Normal header — sadece soru ekranlarında */}
      {currentQ>0&&(
        <header style={{background:"#f8fafd",borderBottom:`1px solid ${C.border}`,padding:"16px 28px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{width:20,height:20,border:"1px solid #d4e1ef",borderRadius:4,display:"flex",alignItems:"center",justifyContent:"center"}}>
              <div style={{width:6,height:6,background:"#1e3a5f",borderRadius:"50%"}}/>
            </div>
            <div style={{fontFamily:"'Playfair Display',serif",fontSize:17,color:C.navy,letterSpacing:"-0.01em"}}>SculptAI</div>
          </div>
          
        </header>
      )}

      <main style={{maxWidth:580,margin:"0 auto",padding:currentQ===0?"0 20px 36px":"36px 20px"}}>
        {currentQ===0&&(
          <div style={{textAlign:"center",marginBottom:32,paddingTop:8}} className="f1">
            <div style={{display:"inline-flex",alignItems:"center",gap:8,padding:"5px 18px",border:`1px solid ${accent}33`,borderRadius:24,fontSize:12,letterSpacing:"0.22em",color:accent,marginBottom:18,textTransform:"uppercase",background:`${accent}11`}}>✦ {doctorInfo?.clinic_name||"Plastik Cerrahi Kliniği"}</div>
            <div style={{fontFamily:"'Playfair Display',serif",fontSize:42,color:C.navy,marginBottom:14,fontWeight:300,lineHeight:1.1,letterSpacing:"-0.01em"}}>{lang==="tr"?"Hoş Geldiniz":"Welcome"}</div>
            <div style={{fontSize:14,color:C.muted,lineHeight:1.9,maxWidth:440,margin:"0 auto",marginBottom:8}}>{lang==="tr"
              ?"Bu yolculuğunuzda bize yer verdiğiniz için mutluyuz. Sizi daha yakından tanıyabilmek ve size en uygun yaklaşımı sunabilmek için birkaç kısa sorumuz olacak. Ayıracağınız birkaç dakika, size daha kişisel ve özenli bir deneyim sunmamıza yardımcı olacak. Şimdiden teşekkür ederiz. \u{1F33F}"
              :"We're glad you've chosen to include us in your journey. To get to know you better and offer the approach that's right for you, we have a few short questions. The few minutes you take will help us give you a more personal and attentive experience. Thank you in advance. \u{1F33F}"}</div>
          </div>
        )}
        <div style={{display:"flex",gap:5,marginBottom:20,flexWrap:"wrap"}} className="f2">
          {false&&VISIBLE_SECTIONS.map((sec,i)=>(
            <div key={sec}/>
          ))}
        </div>
        <div style={{marginBottom:22}} className="f2">
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
            <span style={{fontSize:12,color:C.muted}}>{lang==="tr"?"SORU":"Q"} {currentQ+1} / {VISIBLE_QUESTIONS.length}</span>
            <div style={{display:"flex",gap:4}}>
              {[["tr","🇹🇷"],["en","🇬🇧"]].map(([l,flag])=>(
                <button key={l} onClick={()=>setLang(l)} style={{padding:"2px 8px",borderRadius:6,border:`1px solid ${lang===l?"#1e3a5f":"#d4e1ef"}`,background:lang===l?"#1e3a5f":"transparent",color:lang===l?"white":"#7b9ab5",fontSize:14,cursor:"pointer"}}>{flag}</button>
              ))}
            </div>
            <span style={{fontSize:12,color:C.accent,fontWeight:500}}>%{Math.round(progress)}</span>
          </div>
          <div style={{height:1,background:C.border,borderRadius:1}}>
            <div style={{height:"100%",width:`${progress}%`,background:`linear-gradient(90deg,${accent},${accent}cc)`,borderRadius:2,transition:"width 0.4s ease"}}/>
          </div>
        </div>
        <div style={{background:"#f8fafd",border:`1.5px solid ${C.border}`,borderRadius:14,padding:"24px 22px",marginBottom:14}} className="f3">
          <div style={{fontFamily:"'Playfair Display',serif",fontSize:24,fontWeight:300,color:C.navy,marginBottom:20,lineHeight:1.35,letterSpacing:"-0.01em"}}>{t(`q.${q.id}.label`,q.label)}</div>
          {q.type==="text"&&<input type="text" placeholder={q.placeholder} value={answers[q.id]||""} onChange={e=>setAnswers(p=>({...p,[q.id]:e.target.value}))} style={{width:"100%",padding:"12px 14px",background:"#eef3f9",border:`1.5px solid ${C.border}`,borderRadius:10,color:C.navy,fontSize:15,outline:"none"}}/>}
          {q.type==="number"&&<input type="number" placeholder={q.placeholder} value={answers[q.id]||""} onChange={e=>setAnswers(p=>({...p,[q.id]:e.target.value}))} style={{width:"100%",padding:"12px 14px",background:"#eef3f9",border:`1.5px solid ${C.border}`,borderRadius:10,color:C.navy,fontSize:15,outline:"none"}}/>}
          {q.type==="radio"&&(
            <div style={{display:"flex",flexDirection:"column",gap:7}}>
              {q.options.map(opt=>{
                const sel=answers[q.id]===opt;
                return(<button key={opt} onClick={()=>{
                  if(answers[q.id]&&answers[q.id]!==opt){
                    setQuestionChanges(p=>({...p,[q.id]:(p[q.id]||0)+1}));
                  }
                  setAnswers(p=>({...p,[q.id]:opt}));
                }} style={{padding:"12px 14px",background:sel?"#eef3f9":"#eef3f9",border:`1.5px solid ${sel?C.accent:C.border}`,borderRadius:10,color:sel?C.accent:"#2d5a8e",fontSize:14,cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:11,transition:"all 0.15s"}}>
                  <div style={{width:15,height:15,borderRadius:"50%",border:`2px solid ${sel?C.accent:C.muted}`,background:sel?C.accent:"transparent",flexShrink:0,transition:"all 0.15s"}}/>
                  {tOpt(q.id,opt)}
                </button>);
              })}
            </div>
          )}
        </div>
        {/* KVKK Onayı — son soruda göster */}
        {currentQ===VISIBLE_QUESTIONS.length-1&&(
          <div style={{marginBottom:14,padding:"12px 14px",background:"#f8fafd",border:"1px solid #d4e1ef",borderRadius:10}} className="f3">
            <label style={{display:"flex",alignItems:"flex-start",gap:10,cursor:"pointer",fontSize:12,color:"#2d5a8e",lineHeight:1.6}}>
              <input type="checkbox" checked={kvkkConsent} onChange={e=>setKvkkConsent(e.target.checked)}
                style={{width:18,height:18,marginTop:2,flexShrink:0,accentColor:"#1d4ed8",cursor:"pointer"}}/>
              <span>
                {lang==="tr"
                  ?"Kişisel verilerimin ve sağlık bilgilerimin, 6698 sayılı KVKK kapsamında, yalnızca konsültasyon sürecimin planlanması amacıyla işlenmesini ve doktorumla paylaşılmasını kabul ediyorum. Verilerim şifrelenerek saklanır ve üçüncü taraflarla paylaşılmaz."
                  :"I consent to the processing of my personal and health data solely for the purpose of planning my consultation, in accordance with data protection regulations. My data is stored encrypted and is not shared with third parties."}
              </span>
            </label>
          </div>
        )}
        <div style={{display:"flex",gap:9}} className="f3">
          {currentQ>0&&<button onClick={()=>{
            const elapsed=Math.round((Date.now()-qStartTime.current)/1000);
            setQuestionTimes(p=>({...p,[QUESTIONS[currentQ].id]:elapsed}));
            qStartTime.current=Date.now();
            setCurrentQ(c=>c-1);
          }} style={{flex:1,padding:"13px",background:"transparent",border:`1px solid ${C.border}`,borderRadius:8,color:C.muted,fontSize:13,cursor:"pointer"}}>{lang==="tr"?"← Geri":"← Back"}</button>}
          <button onClick={()=>{
            const elapsed=Math.round((Date.now()-qStartTime.current)/1000);
            setQuestionTimes(p=>({...p,[QUESTIONS[currentQ].id]:elapsed}));
            qStartTime.current=Date.now();
            if(currentQ<VISIBLE_QUESTIONS.length-1)setCurrentQ(c=>c+1);else handleSubmit();
          }} disabled={currentQ===VISIBLE_QUESTIONS.length-1?(!canNext||!kvkkConsent||submitting):!canNext}
            style={{flex:2,padding:"13px",background:(currentQ===VISIBLE_QUESTIONS.length-1?(canNext&&kvkkConsent&&!submitting):canNext)?"#1e3a5f":"#d4e1ef",border:"none",borderRadius:8,color:(currentQ===VISIBLE_QUESTIONS.length-1?(canNext&&kvkkConsent&&!submitting):canNext)?"#f8fafd":"#7b9ab5",fontSize:13,fontWeight:500,letterSpacing:"0.08em",cursor:(currentQ===VISIBLE_QUESTIONS.length-1?(canNext&&kvkkConsent&&!submitting):canNext)?"pointer":"not-allowed",transition:"all 0.2s",fontFamily:"'Nunito',sans-serif"}}>
            {submitting?(lang==="tr"?"Gönderiliyor...":"Submitting..."):currentQ===VISIBLE_QUESTIONS.length-1?(lang==="tr"?"Formu Gönder →":"Submit Form →"):(lang==="tr"?"Devam →":"Continue →")}
          </button>
        </div>
        {submitError&&(
          <div style={{marginTop:10,padding:"10px 14px",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,fontSize:13,color:"#dc2626",textAlign:"center"}}>{submitError}</div>
        )}
      </main>
    </div>
  );
}

/* ─── ANALYTICS BETA ─────────────────────────────────────────────────────── */
function AnalyticsBeta(){
  const [authed,setAuthed]=useState(false);
  const [pass,setPass]=useState("");
  const [patients,setPatients]=useState([]);
  const [doctors,setDoctors]=useState([]);
  const [loading,setLoading]=useState(false);

  async function login(){
    const {data,error}=await sb.auth.signInWithPassword({email:"admin@sculptai.health",password:pass});
    if(data?.session){setAuthed(true);loadData(data.session.access_token);}
    else alert("Hatalı şifre.");
  }

  async function loadData(token){
    setLoading(true);
    try{
      // Try server-side function (bypasses RLS)
      const t=token||(await sb.auth.getSession()).data?.session?.access_token;
      const res=await fetch("/api/admin-analytics",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({access_token:t})});
      if(res.ok){
        const d=await res.json();
        setPatients(d.patients||[]);
        setDoctors(d.doctors||[]);
      } else {
        // Fallback to client-side (may be empty due to RLS)
        const [r1,r2]=await Promise.all([
          sb.from("patients").select("id,doctor_id,created_at,risk_score,segment,outcome_procedures,no_appointment,had_procedure,satisfaction_1m,satisfaction_6m,answers"),
          sb.from("doctors").select("id,name,clinic_name"),
        ]);
        setPatients(r1.data||[]);
        setDoctors(r2.data||[]);
      }
    }catch(e){console.error(e);}
    setLoading(false);
  }

  if(!authed) return(
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#f8fafd",fontFamily:"'Nunito',sans-serif"}}>
      <div style={{background:"white",padding:40,borderRadius:16,border:"1px solid #d4e1ef",width:340,textAlign:"center"}}>
        <div style={{fontFamily:"'Playfair Display',serif",fontSize:22,color:"#1e3a5f",marginBottom:6}}>Sculpt<em style={{color:"#1d4ed8"}}>AI</em></div>
        <div style={{fontSize:11,color:"#7b9ab5",marginBottom:20,letterSpacing:"0.1em",textTransform:"uppercase"}}>Analytics Beta</div>
        <input type="password" value={pass} onChange={e=>setPass(e.target.value)} onKeyDown={e=>e.key==="Enter"&&login()} placeholder="Admin şifre" style={{width:"100%",padding:"10px 14px",border:"1px solid #d4e1ef",borderRadius:8,fontSize:14,marginBottom:12,fontFamily:"'Nunito',sans-serif"}}/>
        <button onClick={login} style={{width:"100%",padding:"10px",background:"#1e3a5f",color:"white",border:"none",borderRadius:8,fontSize:14,cursor:"pointer"}}>Giriş</button>
      </div>
    </div>
  );

  if(loading) return <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Nunito',sans-serif",color:"#7b9ab5"}}>Yükleniyor...</div>;

  // ── AGGREGATIONS ──
  const total=patients.length;
  const withOutcome=patients.filter(p=>p.outcome_procedures?.length>0||p.no_appointment);
  const converted=patients.filter(p=>p.outcome_procedures?.length>0);
  const convRate=withOutcome.length>0?Math.round(converted.length/withOutcome.length*100):0;
  const satPatients=patients.filter(p=>p.satisfaction_1m);
  const satMap={"Çok Memnun":100,"Memnun":75,"Kararsız":50,"Memnun Değil":25};
  const avgSat=satPatients.length>0?Math.round(satPatients.reduce((s,p)=>s+(satMap[p.satisfaction_1m]||50),0)/satPatients.length):null;

  // Age groups
  const ageGroups={"18-25":[],"26-35":[],"36-45":[],"46+":[]};
  patients.forEach(p=>{
    const age=parseInt(p.answers?.age)||0;
    if(age>=18&&age<=25) ageGroups["18-25"].push(p);
    else if(age<=35) ageGroups["26-35"].push(p);
    else if(age<=45) ageGroups["36-45"].push(p);
    else if(age>45) ageGroups["46+"].push(p);
  });

  // Top procedures
  const procCount={};
  patients.forEach(p=>{const pr=p.answers?.procedure;if(pr){procCount[pr]=(procCount[pr]||0)+1;}});
  const topProcs=Object.entries(procCount).sort((a,b)=>b[1]-a[1]).slice(0,6).map(x=>x[0]);

  // Procedure performance
  const procPerf=Object.entries(procCount).sort((a,b)=>b[1]-a[1]).map(([proc,n])=>{
    const pp=patients.filter(p=>p.answers?.procedure===proc);
    const wo=pp.filter(p=>p.outcome_procedures?.length>0||p.no_appointment);
    const cv=pp.filter(p=>p.outcome_procedures?.length>0);
    const lostCount=pp.filter(p=>p.no_appointment).length;
    return{
      proc,n,
      conv:wo.length>0?Math.round(cv.length/wo.length*100):null,
      lost:wo.length>0?Math.round(lostCount/wo.length*100):null,
      conf:n<10?"Yetersiz":n<30?"Düşük":"Yeterli",
    };
  });

  // Risk score vs outcome
  const segments=[
    {label:"Yeşil (0-39)",filter:p=>(p.risk_score||0)<40,color:"#059669",bg:"#ecfdf5"},
    {label:"Sarı (40-59)",filter:p=>(p.risk_score||0)>=40&&(p.risk_score||0)<60,color:"#d97706",bg:"#fffbeb"},
    {label:"Kırmızı (60+)",filter:p=>(p.risk_score||0)>=60,color:"#dc2626",bg:"#fef2f2"},
  ].map(seg=>{
    const sp=patients.filter(seg.filter);
    const wo=sp.filter(p=>p.outcome_procedures?.length>0||p.no_appointment);
    const cv=sp.filter(p=>p.outcome_procedures?.length>0);
    return{...seg,n:sp.length,conv:wo.length>0?Math.round(cv.length/wo.length*100):null};
  });

  // Source analysis
  const srcCount={};
  patients.forEach(p=>{const s=p.answers?.source;if(s) srcCount[s]=(srcCount[s]||0)+1;});
  const srcTotal=Object.values(srcCount).reduce((a,b)=>a+b,0);
  const srcPerf=Object.entries(srcCount).sort((a,b)=>b[1]-a[1]).map(([src,n])=>{
    const sp=patients.filter(p=>p.answers?.source===src);
    const wo=sp.filter(p=>p.outcome_procedures?.length>0||p.no_appointment);
    const cv=sp.filter(p=>p.outcome_procedures?.length>0);
    return{src,n,conv:wo.length>0?Math.round(cv.length/wo.length*100):null};
  });

  // Heat map cell
  function heatCell(ageKey,proc){
    const pp=ageGroups[ageKey].filter(p=>p.answers?.procedure===proc);
    const n=pp.length;
    const wo=pp.filter(p=>p.outcome_procedures?.length>0||p.no_appointment);
    const cv=pp.filter(p=>p.outcome_procedures?.length>0);
    const rate=wo.length>0?Math.round(cv.length/wo.length*100):null;
    const bg=n<3?"#f1f5f9":rate===null?"#f1f5f9":rate>=70?"#dcfce7":rate>=40?"#fef9c3":"#fee2e2";
    const color=n<3?"#94a3b8":rate===null?"#94a3b8":rate>=70?"#166534":rate>=40?"#854d0e":"#991b1b";
    return{n,rate,bg,color};
  }

  const C={navy:"#1e3a5f",muted:"#7b9ab5",border:"#d4e1ef"};
  const confColor=c=>c==="Yeterli"?"#059669":c==="Düşük"?"#d97706":"#dc2626";

  return(
    <div style={{minHeight:"100vh",background:"#f8fafd",fontFamily:"'Nunito',sans-serif",color:C.navy}}>
      <div style={{maxWidth:1100,margin:"0 auto",padding:"24px 20px"}}>
        {/* Header */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:24}}>
          <div>
            <div style={{fontFamily:"'Playfair Display',serif",fontSize:24,color:C.navy}}>Sculpt<em style={{color:"#1d4ed8"}}>AI</em> <span style={{fontSize:14,color:C.muted,fontFamily:"'Nunito',sans-serif"}}>Analytics Beta</span></div>
          </div>
          <button onClick={loadData} style={{padding:"6px 16px",border:"1px solid "+C.border,borderRadius:8,background:"white",color:C.muted,fontSize:12,cursor:"pointer"}}>↻ Yenile</button>
        </div>

        {/* Beta uyarısı */}
        <div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:10,padding:"12px 16px",marginBottom:20,fontSize:12,color:"#92400e",lineHeight:1.6}}>
          ⚠️ <strong>BETA</strong> — İstatistiksel anlamlılık için minimum 30 hasta/segment gereklidir. n&lt;30 segmentlerde sonuçlar güvenilir değildir. Gerçek pattern analizi 6 ay sonra olgunlaşacak.
        </div>

        {/* 1. GENEL ÖZET */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:24}}>
          {[
            {label:"Toplam Hasta",val:total,icon:"👥"},
            {label:"Dönüşüm Oranı",val:convRate+"%",sub:`${converted.length}/${withOutcome.length} (outcome girili)`,icon:"📊"},
            {label:"Kayıp Oranı",val:total?Math.round(patients.filter(p=>p.no_appointment).length/total*100)+"%":"—",sub:`${patients.filter(p=>p.no_appointment).length} kayıp`,icon:"📉"},
            {label:"Klinik Sayısı",val:doctors.length,icon:"🏥"},
          ].map((m,i)=>(
            <div key={i} style={{background:"white",border:"1px solid "+C.border,borderRadius:12,padding:"16px",textAlign:"center"}}>
              <div style={{fontSize:20,marginBottom:6}}>{m.icon}</div>
              <div style={{fontSize:24,fontWeight:700,color:C.navy}}>{m.val}</div>
              <div style={{fontSize:11,color:C.muted,marginTop:4}}>{m.label}</div>
              {m.sub&&<div style={{fontSize:10,color:C.muted,marginTop:2}}>{m.sub}</div>}
            </div>
          ))}
        </div>

        {/* 2. YAŞ × PROSEDÜR ISIL HARİTASI */}
        <div style={{background:"white",border:"1px solid "+C.border,borderRadius:12,padding:"20px",marginBottom:24}}>
          <div style={{fontSize:14,fontWeight:700,color:C.navy,marginBottom:4}}>Yaş × Prosedür Dönüşüm Matrisi</div>
          <div style={{fontSize:11,color:C.muted,marginBottom:14}}>Hücre: dönüşüm oranı (n=hasta sayısı). Gri = n&lt;3, yetersiz veri.</div>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead>
                <tr>
                  <th style={{padding:"8px 10px",textAlign:"left",borderBottom:"2px solid "+C.border,color:C.muted,fontSize:10,letterSpacing:"0.08em"}}>YAŞ</th>
                  {topProcs.map(p=><th key={p} style={{padding:"8px 6px",textAlign:"center",borderBottom:"2px solid "+C.border,color:C.muted,fontSize:9,letterSpacing:"0.06em",maxWidth:100}}>{p}</th>)}
                </tr>
              </thead>
              <tbody>
                {Object.keys(ageGroups).map(ag=>(
                  <tr key={ag}>
                    <td style={{padding:"8px 10px",fontWeight:600,borderBottom:"1px solid #eef3f9"}}>{ag}</td>
                    {topProcs.map(pr=>{
                      const h=heatCell(ag,pr);
                      return <td key={pr} style={{padding:"6px",textAlign:"center",borderBottom:"1px solid #eef3f9"}}>
                        <div style={{background:h.bg,color:h.color,borderRadius:6,padding:"8px 4px",fontSize:13,fontWeight:600}}>
                          {h.rate!==null?h.rate+"%":"—"}
                          <div style={{fontSize:9,fontWeight:400,opacity:0.7}}>n={h.n}</div>
                        </div>
                      </td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 3. PROSEDÜR PERFORMANS TABLOSU */}
        <div style={{background:"white",border:"1px solid "+C.border,borderRadius:12,padding:"20px",marginBottom:24}}>
          <div style={{fontSize:14,fontWeight:700,color:C.navy,marginBottom:14}}>Prosedür Performansı</div>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead>
              <tr>
                {["Prosedür","Hasta","Dönüşüm %","Kayıp %","Confidence"].map(h=>(
                  <th key={h} style={{padding:"8px 10px",textAlign:"left",borderBottom:"2px solid "+C.border,color:C.muted,fontSize:10,letterSpacing:"0.08em"}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {procPerf.map((r,i)=>(
                <tr key={i} style={{background:i%2===0?"white":"#fafbfc"}}>
                  <td style={{padding:"8px 10px",fontWeight:500,borderBottom:"1px solid #eef3f9"}}>{r.proc}</td>
                  <td style={{padding:"8px 10px",borderBottom:"1px solid #eef3f9"}}>{r.n}</td>
                  <td style={{padding:"8px 10px",borderBottom:"1px solid #eef3f9",fontWeight:600,color:r.conv===null?C.muted:r.conv>=60?"#059669":r.conv>=30?"#d97706":"#dc2626"}}>{r.conv!==null?r.conv+"%":"—"}</td>
                  <td style={{padding:"8px 10px",borderBottom:"1px solid #eef3f9",color:r.lost!==null?C.navy:C.muted}}>{r.lost!==null?r.lost+"%":"—"}</td>
                  <td style={{padding:"8px 10px",borderBottom:"1px solid #eef3f9"}}><span style={{padding:"2px 8px",borderRadius:10,fontSize:10,fontWeight:600,background:confColor(r.conf)+"18",color:confColor(r.conf),border:"1px solid "+confColor(r.conf)+"33"}}>{r.conf}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 4. RİSK SKORU vs OUTCOME */}
        <div style={{background:"white",border:"1px solid "+C.border,borderRadius:12,padding:"20px",marginBottom:24}}>
          <div style={{fontSize:14,fontWeight:700,color:C.navy,marginBottom:4}}>Risk Skoru vs Gerçek Outcome</div>
          <div style={{fontSize:11,color:C.muted,marginBottom:14}}>Modelin segmentlere ayırdığı hastaların gerçek dönüşüm oranları</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
            {segments.map((seg,i)=>(
              <div key={i} style={{background:seg.bg,border:"1px solid "+seg.color+"33",borderRadius:10,padding:"16px",textAlign:"center"}}>
                <div style={{fontSize:12,fontWeight:600,color:seg.color,marginBottom:8}}>{seg.label}</div>
                <div style={{fontSize:28,fontWeight:700,color:seg.color}}>{seg.conv!==null?seg.conv+"%":"—"}</div>
                <div style={{fontSize:11,color:seg.color,opacity:0.7,marginTop:4}}>n={seg.n} hasta</div>
                {seg.n<10&&<div style={{fontSize:9,color:"#dc2626",marginTop:4}}>⚠ Yetersiz veri</div>}
              </div>
            ))}
          </div>
          {segments[0].conv!==null&&segments[2].conv!==null&&(
            <div style={{marginTop:14,padding:"10px 14px",background:"#f8fafd",borderRadius:8,fontSize:12,color:C.navy,lineHeight:1.6}}>
              📊 <strong>Model doğrulaması:</strong> Yeşil hastalardan %{segments[0].conv} dönüşüm, kırmızılardan %{segments[2].conv}.
              {segments[0].conv>segments[2].conv?" ✅ Model doğru yönde ayrışıyor.":" ⚠ Daha fazla veri gerekiyor."}
            </div>
          )}
        </div>

        {/* 5. KANAL ANALİZİ */}
        <div style={{background:"white",border:"1px solid "+C.border,borderRadius:12,padding:"20px",marginBottom:24}}>
          <div style={{fontSize:14,fontWeight:700,color:C.navy,marginBottom:4}}>Kanal Analizi</div>
          <div style={{fontSize:11,color:C.muted,marginBottom:14}}>Hastaların "Bize nereden ulaştınız?" cevabına göre dağılım</div>
          {srcTotal===0?(
            <div style={{textAlign:"center",padding:"20px",color:C.muted,fontSize:13}}>📭 Henüz kaynak verisi yok — yeni formda "source" sorusu eklendi, veri birikecek.</div>
          ):(
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {srcPerf.map((r,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",background:i%2===0?"white":"#fafbfc",borderRadius:8}}>
                  <div style={{flex:1,fontWeight:500}}>{r.src}</div>
                  <div style={{width:60,textAlign:"right",fontSize:13,fontWeight:600}}>{r.n} hasta</div>
                  <div style={{width:80}}>
                    <div style={{height:6,background:"#eef3f9",borderRadius:3,overflow:"hidden"}}>
                      <div style={{height:"100%",width:Math.round(r.n/srcTotal*100)+"%",background:"#1d4ed8",borderRadius:3}}/>
                    </div>
                  </div>
                  <div style={{width:60,textAlign:"right",fontSize:12,color:r.conv!==null?C.navy:C.muted}}>{r.conv!==null?r.conv+"%":"—"}</div>
                </div>
              ))}
              <div style={{fontSize:10,color:C.muted,marginTop:4}}>{total-srcTotal} hastada kaynak verisi eksik ({Math.round((total-srcTotal)/total*100)}%)</div>
            </div>
          )}
        </div>

        <div style={{fontSize:10,color:C.muted,textAlign:"center",padding:"12px 0"}}>SculptAI Analytics Beta · Sadece dahili kullanım · {new Date().toLocaleDateString("tr-TR")}</div>
      </div>
    </div>
  );
}

/* ─── ADMIN PANEL ────────────────────────────────────────────────────────── */
function AdminPanel(){
  const [authed,setAuthed]=useState(false);
  const [pass,setPass]=useState("");
  const [err,setErr]=useState("");
  const [doctors,setDoctors]=useState([]);
  const [patients,setPatients]=useState([]);
  const [clinicModels,setClinicModels]=useState({});
  const [loading,setLoading]=useState(false);
  const [tab,setTab]=useState("overview");
  const [newDoc,setNewDoc]=useState({name:"",username:"",password:"",clinic_name:""});
  const [addErr,setAddErr]=useState("");
  const [addOk,setAddOk]=useState(false);
  const [lastAddedLink,setLastAddedLink]=useState("");
  const [confirmDeleteId,setConfirmDeleteId]=useState(null);

  async function login(){
    setErr("");
    // Supabase Auth ile admin girişi
    const {data,error}=await sb.auth.signInWithPassword({
      email:"admin@sculptai.health",
      password:pass
    });
    if(data?.user){setAuthed(true);loadData();}
    else setErr("Hatalı şifre.");
  }

  const [loadError,setLoadError]=useState("");

  async function loadData(){
    setLoading(true);setLoadError("");
    try{
      const [r1,r2,r3]=await Promise.all([
        sb.from("doctors").select("id,name,username,clinic_name"),
        sb.from("patients").select("id,doctor_id,created_at,risk_score,segment,outcome_procedures,no_appointment,ambassador_code,ambassador_sent,had_procedure,procedure_date,satisfaction_1m,satisfaction_6m,would_recommend,had_revision,revision_reason,referred_count,referral_source,answers"),
        Promise.resolve(sb.from("clinic_models").select("doctor_id,version,threshold,threshold_src,n_train,label_count,n_neg,neg_count,accuracy,val_accuracy,val_f1,val_precision,val_recall,train_date,updated_at,is_active")).catch(()=>({data:[]})),
      ]);
      if(r1.error) setLoadError("Doctors hatası: "+JSON.stringify(r1.error));
      else if(r2.error) setLoadError("Patients hatası: "+JSON.stringify(r2.error));
      else{
        setDoctors(r1.data||[]);
        setPatients(r2.data||[]);
        const modelMap = {};
        (r3.data||[]).forEach(m=>{ modelMap[m.doctor_id]=m; });
        setClinicModels(modelMap);
      }
    }catch(e){
      setLoadError("Bağlantı hatası: "+String(e));
    }
    setLoading(false);
  }

  async function addDoctor(){
    setAddErr("");setAddOk(false);
    if(!newDoc.name||!newDoc.username||!newDoc.password||!newDoc.clinic_name){setAddErr("Tüm alanları doldurun.");return;}
    if(newDoc.password.length<6){setAddErr("Şifre en az 6 karakter olmalı.");return;}
    const id="dr-"+newDoc.username.toLowerCase().replace(/\s/g,"-");
    const hashedPass=await hashPassword(newDoc.password);
    const {error}=await sb.from("doctors").insert({
      id, name:newDoc.name, username:newDoc.username.toLowerCase(),
      password_hash:hashedPass, clinic_name:newDoc.clinic_name
    });
    if(error){setAddErr("Hata: "+error.message);}
    else{setLastAddedLink(`${window.location.origin}/form/${id}`);setAddOk(true);setNewDoc({name:"",username:"",password:"",clinic_name:""});loadData();}
  }

  async function deleteDoctor(id){
    // 1. Doktorun tüm hastalarını sil
    await sb.from("patients").delete().eq("doctor_id",id);
    // 2. Klinik modelini sil (varsa)
    await Promise.resolve(sb.from("clinic_models").delete().eq("doctor_id",id)).catch(()=>{});
    await Promise.resolve(sb.from("clinic_model_history").delete().eq("doctor_id",id)).catch(()=>{});
    // 3. Doktor kaydını sil
    await sb.from("doctors").delete().eq("id",id);
    // 4. UI güncelle
    setConfirmDeleteId(null);
    loadData();
  }

  const C={border:"#d4e1ef",muted:"#7b9ab5",navy:"#1e3a5f",ivory:"#f8fafd",ivory2:"#eef3f9"};
  const cardS={background:C.ivory2,border:`1px solid ${C.border}`,borderRadius:9,padding:"14px 18px"};

  if(!authed) return(
    <div style={{minHeight:"100vh",background:C.ivory,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Nunito',sans-serif"}}>
      <div style={{width:360,background:C.ivory2,border:`1px solid ${C.border}`,borderRadius:12,padding:"32px 28px"}}>
        <div style={{fontFamily:"'Playfair Display',serif",fontSize:30,fontWeight:300,color:C.navy,marginBottom:4}}>Admin Paneli</div>
        <div style={{fontSize:13,color:C.muted,marginBottom:24}}>SculptAI · Sadece sistem yöneticisi</div>
        <input type="password" value={pass} onChange={e=>setPass(e.target.value)} onKeyDown={e=>e.key==="Enter"&&login()} placeholder="Şifre" style={{width:"100%",padding:"11px 13px",background:C.ivory,border:`1px solid ${C.border}`,borderRadius:7,fontSize:13,outline:"none",marginBottom:10,boxSizing:"border-box"}}/>
        {err&&<div style={{fontSize:13,color:"#dc2626",marginBottom:8}}>{err}</div>}
        <button onClick={login} style={{width:"100%",padding:"11px",background:C.navy,border:"none",borderRadius:7,color:C.ivory,fontSize:13,fontWeight:500,cursor:"pointer",letterSpacing:"0.06em"}}>GİRİŞ</button>
      </div>
    </div>
  );

  // Klinik bazlı istatistikler
  const stats=doctors.map(doc=>{
    const dp=patients.filter(p=>p.doctor_id===doc.id);
    const total=dp.length;
    const critical=dp.filter(p=>(p.risk_score||0)>=68).length;
    const noAppt=dp.filter(p=>p.no_appointment).length;
    const withOutcome=dp.filter(p=>p.outcome_procedures?.length>0);
    const donusum=total?Math.round(withOutcome.length/total*100):0;
    const crossSell=dp.filter(p=>p.outcome_procedures?.length>0&&p.outcome_procedures.some(x=>x!==(p.answers?.procedure||""))).length;
    const ambassadors=dp.filter(p=>p.ambassador_code&&p.ambassador_code!=="").length;
    // ML doğruluğu — kırmızı + randevu yok
    const redPats=dp.filter(p=>(p.risk_score||0)>=68);
    const redNoAppt=redPats.filter(p=>p.no_appointment).length;
    const redKnown=redPats.filter(p=>p.no_appointment||p.outcome_procedures?.length>0).length;
    const mlAcc=redKnown>0?Math.round(redNoAppt/redKnown*100):null;
    // Son aktivite
    const dates=dp.map(p=>new Date(p.created_at)).filter(d=>!isNaN(d));
    const lastActive=dates.length>0?new Date(Math.max(...dates)).toLocaleDateString("tr-TR",{day:"numeric",month:"short"}):"—";
    // Aktif mi? Son 30 gün
    const isActive=dates.some(d=>(Date.now()-d.getTime())<30*86400000);
    return{...doc,total,critical,noAppt,donusum,crossSell,ambassadors,mlAcc,lastActive,isActive};
  });

  const total={
    patients:patients.length,
    critical:patients.filter(p=>(p.risk_score||0)>=68).length,
    noAppt:patients.filter(p=>p.no_appointment).length,
    withOutcome:patients.filter(p=>p.outcome_procedures?.length>0).length,
    crossSell:patients.filter(p=>p.outcome_procedures?.length>0&&p.outcome_procedures.some(x=>x!==(p.answers?.procedure||""))).length,
    ambassadors:patients.filter(p=>p.ambassador_code&&p.ambassador_code!=="").length,
  };
  const totalDonusum=total.patients?Math.round(total.withOutcome/total.patients*100):0;

  // ML genel doğruluk
  const redAll=patients.filter(p=>(p.risk_score||0)>=68);
  const redNoApptAll=redAll.filter(p=>p.no_appointment).length;
  const redKnownAll=redAll.filter(p=>p.no_appointment||p.outcome_procedures?.length>0).length;
  const mlAccAll=redKnownAll>0?Math.round(redNoApptAll/redKnownAll*100):null;

  return(
    <div style={{minHeight:"100vh",background:C.ivory,fontFamily:"'Nunito',sans-serif"}}>
      {/* Header */}
      <div style={{background:C.navy,padding:"14px 32px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{fontFamily:"'Playfair Display',serif",fontSize:20,color:C.ivory,fontWeight:300}}>SculptAI <em>Admin</em></div>
          <div style={{fontSize:11,color:"rgba(245,240,232,0.4)",letterSpacing:"0.06em"}}>{doctors.length} klinik · {patients.length} hasta</div>
        </div>
        <div style={{display:"flex",gap:6}}>
          {[["overview","Genel"],["clinics","Klinikler"],["ml","ML"],["add","+ Yeni Klinik"]].map(([v,l])=>(
            <button key={v} onClick={()=>setTab(v)} style={{padding:"6px 14px",borderRadius:7,fontSize:12,border:"none",
              background:tab===v?"rgba(245,240,232,0.15)":"transparent",color:tab===v?C.ivory:"rgba(245,240,232,0.4)",cursor:"pointer"}}>
              {l}
            </button>
          ))}
          <button onClick={loadData} style={{padding:"6px 12px",borderRadius:7,fontSize:12,border:"1px solid rgba(245,240,232,0.2)",background:"transparent",color:"rgba(245,240,232,0.4)",cursor:"pointer"}}>↻</button>
        </div>
      </div>

      <div style={{maxWidth:1100,margin:"0 auto",padding:"28px 32px"}}>
        {loading&&<div style={{textAlign:"center",padding:40,color:C.muted}}>Yükleniyor...</div>}
        {loadError&&<div style={{margin:20,padding:"16px 20px",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:10,fontSize:13,color:"#dc2626",lineHeight:1.6,wordBreak:"break-all"}}>{loadError}</div>}

        {/* GENEL BAKIŞ */}
        {tab==="overview"&&!loading&&(
          <>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:10,marginBottom:24}}>
              {[
                {lbl:"Toplam Hasta",val:total.patients,color:C.navy},
                {lbl:"Dönüşüm",val:total.withOutcome>0?`%${totalDonusum}`:"—",color:totalDonusum>=60?"#059669":"#d97706"},
                {lbl:"Kritik Profil",val:total.critical,color:"#dc2626"},
                {lbl:"Cross-sell",val:total.crossSell,color:"#059669"},
                {lbl:"ML Doğruluğu",val:mlAccAll!=null?`%${mlAccAll}`:"—",color:"#7c3aed"},
              ].map((k,i)=>(
                <div key={i} style={{...cardS,position:"relative",overflow:"hidden"}}>
                  <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:k.color}}/>
                  <div style={{fontSize:10,letterSpacing:"0.12em",textTransform:"uppercase",color:C.muted,marginBottom:6}}>{k.lbl}</div>
                  <div style={{fontFamily:"'Playfair Display',serif",fontSize:32,fontWeight:300,fontVariantNumeric:"lining-nums",color:k.color,lineHeight:1}}>{k.val}</div>
                </div>
              ))}
            </div>

            {/* Klinik özet tablosu */}
            <div style={{...cardS,padding:0,overflow:"hidden"}}>
              <div style={{padding:"12px 20px",borderBottom:`1px solid ${C.border}`}}>
                <div style={{fontSize:11,letterSpacing:"0.14em",textTransform:"uppercase",color:C.muted,fontWeight:500}}>Klinik Özet</div>
              </div>
              <table style={{width:"100%",borderCollapse:"collapse"}}>
                <thead>
                  <tr style={{background:C.ivory2}}>
                    {["Klinik","Durum","Hasta","Dönüşüm","Kritik","Cross-sell","Son Aktivite"].map(h=>(
                      <th key={h} style={{padding:"10px 16px",fontSize:11,letterSpacing:"0.08em",textTransform:"uppercase",color:C.muted,fontWeight:500,textAlign:"left",borderBottom:`1px solid ${C.border}`}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {stats.map((s,i)=>(
                    <tr key={s.id} style={{borderBottom:i<stats.length-1?`1px solid ${C.border}`:"none"}}>
                      <td style={{padding:"12px 16px"}}>
                        <div style={{fontFamily:"'Playfair Display',serif",fontSize:15,color:C.navy}}>{s.clinic_name||"—"}</div>
                        <div style={{fontSize:11,color:C.muted}}>{s.name}</div>
                      </td>
                      <td style={{padding:"12px 16px"}}>
                        <span style={{fontSize:11,padding:"2px 8px",borderRadius:10,background:s.isActive?"#ecfdf5":"#fff5f5",color:s.isActive?"#059669":"#dc2626",border:`1px solid ${s.isActive?"#a7f3d0":"#fecaca"}`}}>
                          {s.isActive?"Aktif":"Pasif"}
                        </span>
                      </td>
                      <td style={{padding:"12px 16px",fontFamily:"'Playfair Display',serif",fontSize:20,color:C.navy}}>{s.total}</td>
                      <td style={{padding:"12px 16px",fontSize:13,color:s.donusum>=60?"#059669":s.donusum>0?"#d97706":C.muted}}>{s.total>0?`%${s.donusum}`:"—"}</td>
                      <td style={{padding:"12px 16px"}}><span style={{fontSize:12,padding:"2px 8px",borderRadius:10,background:s.critical>0?"#fef2f2":"transparent",color:s.critical>0?"#991b1b":C.muted,border:s.critical>0?"1px solid #fecaca":"none"}}>{s.critical}</span></td>
                      <td style={{padding:"12px 16px",fontSize:13,color:s.crossSell>0?"#059669":C.muted}}>{s.crossSell}</td>
                      <td style={{padding:"12px 16px",fontSize:12,color:C.muted}}>{s.lastActive}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* KLİNİKLER */}
        {tab==="clinics"&&!loading&&(
          <div style={{display:"grid",gap:12}}>
            {stats.map(s=>(
              <div key={s.id} style={{...cardS}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
                  <div>
                    <div style={{fontFamily:"'Playfair Display',serif",fontSize:18,color:C.navy}}>{s.clinic_name||"İsimsiz"}</div>
                    <div style={{fontSize:12,color:C.muted}}>Dr. {s.name} · @{s.username} · ID: {s.id}</div>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:11,padding:"3px 10px",borderRadius:10,background:s.isActive?"#ecfdf5":"#fff5f5",color:s.isActive?"#059669":"#dc2626",border:`1px solid ${s.isActive?"#a7f3d0":"#fecaca"}`}}>
                      {s.isActive?"Son 30 günde aktif":"30+ gündür işlem yok"}
                    </span>
                    {confirmDeleteId===s.id?(
                      <div style={{display:"flex",gap:4}}>
                        <button onClick={()=>deleteDoctor(s.id)} style={{padding:"3px 10px",borderRadius:6,border:"1px solid #dc2626",background:"#dc2626",color:"white",fontSize:11,cursor:"pointer"}}>Sil</button>
                        <button onClick={()=>setConfirmDeleteId(null)} style={{padding:"3px 10px",borderRadius:6,border:"1px solid #d4e1ef",background:"#f8fafd",color:"#7b9ab5",fontSize:11,cursor:"pointer"}}>İptal</button>
                      </div>
                    ):(
                      <button onClick={()=>setConfirmDeleteId(s.id)} title="Hesabı ve tüm hastaları sil" style={{padding:"3px 8px",borderRadius:6,border:"1px solid #fecaca",background:"#fff5f5",color:"#dc2626",fontSize:12,cursor:"pointer"}}>🗑</button>
                    )}
                  </div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(100px,1fr))",gap:8}}>
                  {[
                    {l:"Hasta",v:s.total,c:C.navy},
                    {l:"Dönüşüm",v:s.total>0?`%${s.donusum}`:"—",c:s.donusum>=60?"#059669":"#d97706"},
                    {l:"Kritik",v:s.critical,c:"#dc2626"},
                    {l:"Cross-sell",v:s.crossSell,c:"#059669"},
                    {l:"ML Doğruluğu",v:s.mlAcc!=null?`%${s.mlAcc}`:"—",c:"#7c3aed"},
                  ].map((k,i)=>(
                    <div key={i} style={{background:C.ivory,borderRadius:7,padding:"10px 12px",textAlign:"center"}}>
                      <div style={{fontSize:9,letterSpacing:"0.1em",textTransform:"uppercase",color:C.muted,marginBottom:4}}>{k.l}</div>
                      <div style={{fontFamily:"'Playfair Display',serif",fontSize:22,fontVariantNumeric:"lining-nums",color:k.c,fontWeight:300}}>{k.v}</div>
                    </div>
                  ))}
                </div>
                <div style={{marginTop:10,fontSize:11,color:C.muted}}>
                  Form linki: <span style={{color:C.navy,fontWeight:500}}>{window.location.origin}/form/{s.id}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ML PERFORMANS */}
        {tab==="ml"&&!loading&&(
          <div style={{display:"grid",gap:12}}>
            <div style={{...cardS}}>
              <div style={{fontSize:11,letterSpacing:"0.14em",textTransform:"uppercase",color:C.muted,marginBottom:16,fontWeight:500}}>Model Performansı — Genel</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:10,marginBottom:16}}>
                {[
                  {l:"Toplam Etiketli",v:patients.filter(p=>p.no_appointment||p.outcome_procedures?.length>0).length,c:C.navy},
                  {l:"Kırmızı Hasta",v:redAll.length,c:"#dc2626"},
                  {l:"Doğru Alarm",v:redNoApptAll,c:"#dc2626"},
                  {l:"Hassasiyet",v:mlAccAll!=null?`%${mlAccAll}`:"—",c:"#7c3aed"},
                ].map((k,i)=>(
                  <div key={i} style={{background:C.ivory,borderRadius:7,padding:"12px 14px",textAlign:"center"}}>
                    <div style={{fontSize:9,letterSpacing:"0.1em",textTransform:"uppercase",color:C.muted,marginBottom:6}}>{k.l}</div>
                    <div style={{fontFamily:"'Playfair Display',serif",fontSize:28,fontVariantNumeric:"lining-nums",color:k.c,fontWeight:300}}>{k.v}</div>
                  </div>
                ))}
              </div>
              <div style={{background:C.ivory,borderRadius:8,padding:"12px 16px",fontSize:12,color:C.muted,lineHeight:1.7}}>
                <div style={{marginBottom:4,color:C.navy,fontWeight:500}}>Model v3 — {patients.filter(p=>p.no_appointment||p.outcome_procedures?.length>0).length} etiketli hasta</div>
                En güçlü sinyal: Revizyon tutumu → Beklenti → Doktor sayısı<br/>
                Yeşil hastaların %100'ü güvenli — yanlış güven yok<br/>
                Daha fazla negatif örnek geldikçe hassasiyet artacak
              </div>
            </div>

            {/* Klinik bazlı ML */}
            {stats.filter(s=>s.total>0).map(s=>(
              <div key={s.id} style={{...cardS}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
                  <div>
                    <div style={{fontSize:14,fontWeight:500,color:C.navy}}>{s.clinic_name}</div>
                    <div style={{fontSize:11,color:C.muted}}>{s.total} hasta · {s.noAppt} negatif örnek</div>
                  </div>
                  <span style={{fontSize:11,padding:"3px 10px",borderRadius:10,
                    background:clinicModels[s.id]?"#eff6ff":s.noAppt<10?"#fffbeb":"#ecfdf5",
                    color:clinicModels[s.id]?"#1d4ed8":s.noAppt<10?"#92400e":"#065f46",
                    border:`1px solid ${clinicModels[s.id]?"#dbeafe":s.noAppt<10?"#fde68a":"#a7f3d0"}`}}>
                    {clinicModels[s.id]?"Klinik Modeli Aktif":s.noAppt<10?"Veri Biriktirilyor":"Eğitime Hazır"}
                  </span>
                </div>
                <div style={{marginBottom:10}}>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:C.muted,marginBottom:4}}>
                    <span>Klinik modeli için negatif örnek</span>
                    <span style={{fontWeight:500,color:s.noAppt>=10?"#059669":"#d97706"}}>{s.noAppt}/10</span>
                  </div>
                  <div style={{height:5,background:"#eef3f9",borderRadius:3,overflow:"hidden"}}>
                    <div style={{height:5,width:`${Math.min(100,s.noAppt*10)}%`,background:s.noAppt>=10?"#059669":"#1d4ed8",borderRadius:3}}/>
                  </div>
                </div>
                <div style={{fontSize:11,color:C.muted,background:C.ivory,borderRadius:7,padding:"10px 12px"}}>
                  {clinicModels[s.id] ? (
                    <div style={{display:"flex",flexDirection:"column",gap:4}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                        <span style={{fontWeight:500,color:C.navy}}>v{clinicModels[s.id].version||1} — {clinicModels[s.id].train_date?new Date(clinicModels[s.id].train_date).toLocaleDateString("tr-TR"):""}</span>
                        <span style={{fontSize:10,color:"#7c3aed",background:"#faf5ff",padding:"1px 7px",borderRadius:8,border:"1px solid #e9d5ff"}}>
                          {clinicModels[s.id].threshold_src==="auto_f1"?"Otomatik F1":"Manuel"}
                        </span>
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(80px,1fr))",gap:6,marginTop:4}}>
                        {[
                          {l:"Doğruluk", v:clinicModels[s.id].val_accuracy?`%${Math.round(clinicModels[s.id].val_accuracy*100)}`:(clinicModels[s.id].accuracy?`%${Math.round(clinicModels[s.id].accuracy*100)}`:"—")},
                          {l:"F1",       v:clinicModels[s.id].val_f1?clinicModels[s.id].val_f1.toFixed(2):"—"},
                          {l:"Eşik",     v:clinicModels[s.id].threshold||60},
                          {l:"Etiketli", v:`${clinicModels[s.id].label_count||clinicModels[s.id].n_train||"—"} hasta`},
                        ].map((k,i)=>(
                          <div key={i} style={{background:"white",borderRadius:5,padding:"5px 7px",textAlign:"center",border:"1px solid #d4e1ef"}}>
                            <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:"0.08em"}}>{k.l}</div>
                            <div style={{fontSize:13,fontWeight:500,color:C.navy,marginTop:2}}>{k.v}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : s.noAppt>=10
                    ? "10+ negatif örnek mevcut — klinik modeli eğitilebilir. Doruk'a bildirin."
                    : `${10-s.noAppt} negatif örnek daha gerekiyor. Outcome girişini düzenli tut.`}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* YENİ KLİNİK EKLE */}
        {tab==="add"&&(
          <div style={{maxWidth:480}}>
            <div style={{...cardS}}>
              <div style={{fontSize:11,letterSpacing:"0.14em",textTransform:"uppercase",color:C.muted,marginBottom:20,fontWeight:500}}>Yeni Klinik Ekle</div>
              {[
                ["Doktor Adı Soyadı","name","text","Dr. Ayşe Kaya"],
                ["Kullanıcı Adı","username","text","dr-ayse"],
                ["Şifre","password","password","sculpt2024"],
                ["Klinik Adı","clinic_name","text","Özel Plastik Cerrahi"],
              ].map(([label,field,type,ph])=>(
                <div key={field} style={{marginBottom:14}}>
                  <div style={{fontSize:11,letterSpacing:"0.1em",textTransform:"uppercase",color:C.muted,marginBottom:6}}>{label}</div>
                  <input type={type} value={newDoc[field]} placeholder={ph}
                    onChange={e=>setNewDoc(d=>({...d,[field]:e.target.value}))}
                    style={{width:"100%",padding:"10px 12px",background:C.ivory,border:`1px solid ${C.border}`,borderRadius:7,fontSize:13,outline:"none",boxSizing:"border-box"}}/>
                </div>
              ))}
              {addErr&&<div style={{fontSize:12,color:"#dc2626",marginBottom:10}}>{addErr}</div>}
              {addOk&&<div style={{fontSize:12,color:"#059669",marginBottom:10}}>✓ Klinik eklendi! Form linki: {lastAddedLink}</div>}
              <button onClick={addDoctor} style={{width:"100%",padding:"11px",background:C.navy,border:"none",borderRadius:7,color:C.ivory,fontSize:13,fontWeight:500,cursor:"pointer",letterSpacing:"0.06em"}}>
                KLİNİK EKLE
              </button>
              <div style={{marginTop:12,fontSize:11,color:C.muted,lineHeight:1.6}}>
                Eklenen klinik hemen aktif olur. Doktor /panel sayfasından giriş yapabilir.
                Şifreyi doktor istediği zaman ayarlardan değiştirebilir.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


/* ─── LOGIN + KAYIT ─────────────────────────────────────────────────────── */
function Login({onLogin}){
  const [mode,setMode]=useState("login"); // login | register
  const [u,setU]=useState("");const [p,setP]=useState("");const [err,setErr]=useState("");const [loading,setLoading]=useState(false);
  // Register fields
  const [regName,setRegName]=useState("");const [regClinic,setRegClinic]=useState("");
  const [regUser,setRegUser]=useState("");const [regPass,setRegPass]=useState("");const [regPass2,setRegPass2]=useState("");
  const [regOk,setRegOk]=useState(false);
  const [regId,setRegId]=useState("");

  const [isMobile,setIsMobile]=useState(window.innerWidth<640);
  useEffect(()=>{
    const fn=()=>setIsMobile(window.innerWidth<640);
    window.addEventListener("resize",fn);
    return()=>window.removeEventListener("resize",fn);
  },[]);
  const AUTH_EMAIL_DOMAIN="sculptai.health";

  async function attempt(){
    setLoading(true);setErr("");
    const email=`${u.trim().toLowerCase()}@${AUTH_EMAIL_DOMAIN}`;

    // 1. Supabase Auth ile dene
    const {data:authData,error:authErr}=await sb.auth.signInWithPassword({email,password:p});
    if(authData?.user){
      // Auth başarılı — doctor kaydını çek
      const {data:doc}=await sb.from("doctors").select("*").eq("auth_id",authData.user.id).maybeSingle();
      if(doc){ onLogin(doc); setLoading(false); return; }
      // auth_id eşleşmedi — username ile dene (migrasyon)
      const {data:doc2}=await sb.from("doctors").select("*").eq("username",u.trim()).maybeSingle();
      if(doc2){
        await sb.from("doctors").update({auth_id:authData.user.id}).eq("id",doc2.id);
        onLogin(doc2); setLoading(false); return;
      }
    }

    // 2. Auth başarısız — legacy login dene (mevcut doktorlar için migrasyon)
    const hashed=await hashPassword(p);
    const {data:legacy}=await sb.from("doctors").select("*").eq("username",u.trim()).maybeSingle();
    if(legacy && (legacy.password_hash===hashed || legacy.password_hash===p || legacy.password_hash==="migrated_to_auth")){
      // Legacy login başarılı — Supabase Auth kullanıcısı oluştur veya giriş yap
      let authUserId=null;
      try{
        // Önce signUp dene (yeni auth kullanıcısı)
        const {data:newAuth,error:signUpErr}=await sb.auth.signUp({email,password:p});
        if(newAuth?.user && !signUpErr){
          authUserId=newAuth.user.id;
        } else {
          // signUp başarısız — muhtemelen zaten var, signIn dene
          const {data:existAuth}=await sb.auth.signInWithPassword({email,password:p});
          if(existAuth?.user) authUserId=existAuth.user.id;
        }
      }catch(e){}
      // auth_id'yi güncelle
      if(authUserId){
        await sb.from("doctors").update({auth_id:authUserId,password_hash:"migrated_to_auth"}).eq("id",legacy.id);
        legacy.auth_id=authUserId; // local objeyi de güncelle
      }
      onLogin(legacy); setLoading(false); return;
    }

    setErr("Kullanıcı adı veya şifre hatalı.");
    setLoading(false);
  }
  async function register(){
    setLoading(true);setErr("");
    if(!regName.trim()||!regUser.trim()||!regPass.trim()){setErr("Tüm alanları doldurun.");setLoading(false);return;}
    if(regPass!==regPass2){setErr("Şifreler eşleşmiyor.");setLoading(false);return;}
    if(regPass.length<6){setErr("Şifre en az 6 karakter olmalı.");setLoading(false);return;}
    if(regUser.length<3){setErr("Kullanıcı adı en az 3 karakter olmalı.");setLoading(false);return;}
    // Check if username exists
    const {data:existing}=await sb.from("doctors").select("id").eq("username",regUser.trim().toLowerCase()).maybeSingle();
    if(existing){setErr("Bu kullanıcı adı zaten alınmış.");setLoading(false);return;}

    // Supabase Auth ile kayıt
    const email=`${regUser.trim().toLowerCase()}@${AUTH_EMAIL_DOMAIN}`;
    const {data:authData,error:authErr}=await sb.auth.signUp({email,password:regPass});
    if(authErr){setErr("Kayıt oluşturulamadı: "+authErr.message);setLoading(false);return;}

    const authId=authData?.user?.id;
    const newId=authId||(crypto.randomUUID?crypto.randomUUID():("dr-"+Date.now()));
    const {error}=await sb.from("doctors").insert({
      id:newId,
      auth_id:authId||null,
      name:regName.trim(),
      username:regUser.trim().toLowerCase(),
      password_hash:"managed_by_auth",
      clinic_name:regClinic.trim()||"Klinik",
    });
    if(error){setErr("Kayıt oluşturulamadı: "+error.message);setLoading(false);return;}
    setRegId(newId);
    setRegOk(true);
    setLoading(false);
  }
  return(
    <div style={{minHeight:"100vh",background:"#f8fafd",fontFamily:"'Nunito',sans-serif",display:"flex",flexDirection:isMobile?"column":"row"}}>

      {/* SOL — Görsel (masaüstü: büyük, mobil: banner) */}
      {!isMobile&&(
        <div style={{flex:"0 0 52%",position:"relative",overflow:"hidden",display:"flex",background:"linear-gradient(135deg, #1e3a5f 0%, #2d5a8e 40%, #4a7fb5 70%, #a8c5de 100%)"}}>
          <img src="/login-hero.png" alt="" style={{width:"100%",height:"100%",objectFit:"cover",objectPosition:"center"}}
            onError={e=>{e.target.style.display="none"}}/>
          <div style={{position:"absolute",inset:0,background:"linear-gradient(to right, transparent 50%, rgba(245,240,232,1) 100%)"}}/>
          <div style={{position:"absolute",top:28,left:28,display:"flex",alignItems:"center",gap:9}}>
            <div style={{width:28,height:28,border:"1.5px solid rgba(255,255,255,0.7)",borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(255,255,255,0.15)",backdropFilter:"blur(8px)"}}>
              <div style={{width:8,height:8,background:"white",borderRadius:"50%"}}/>
            </div>
            <div style={{fontFamily:"'Playfair Display',serif",fontSize:20,color:"white",letterSpacing:"0.02em",textShadow:"0 2px 12px rgba(0,0,0,0.3)"}}>Sculpt<em style={{color:"rgba(255,255,255,0.7)"}}>AI</em></div>
          </div>
          <div style={{position:"absolute",bottom:40,left:40,right:"30%"}}>
            <div style={{fontFamily:"'Playfair Display',serif",fontSize:24,fontWeight:300,color:"white",lineHeight:1.4,textShadow:"0 2px 20px rgba(0,0,0,0.3)",fontStyle:"italic"}}>
              "Doğru hastaya, doğru zamanda,<br/>doğru yaklaşımla."
            </div>
          </div>
        </div>
      )}
      {isMobile&&(
        <div style={{width:"100%",height:180,position:"relative",overflow:"hidden",background:"linear-gradient(135deg, #1e3a5f 0%, #2d5a8e 40%, #4a7fb5 70%, #a8c5de 100%)"}}>
          <img src="/login-hero.png" alt="" style={{width:"100%",height:"100%",objectFit:"cover",objectPosition:"center top"}}
            onError={e=>{e.target.style.display="none"}}/>
          <div style={{position:"absolute",inset:0,background:"linear-gradient(to bottom, transparent 30%, #f8fafd 100%)"}}/>
          <div style={{position:"absolute",top:16,left:16,display:"flex",alignItems:"center",gap:7}}>
            <div style={{width:22,height:22,border:"1.5px solid rgba(255,255,255,0.7)",borderRadius:5,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(255,255,255,0.15)"}}>
              <div style={{width:6,height:6,background:"white",borderRadius:"50%"}}/>
            </div>
            <div style={{fontFamily:"'Playfair Display',serif",fontSize:16,color:"white",textShadow:"0 1px 8px rgba(0,0,0,0.3)"}}>Sculpt<em style={{color:"rgba(255,255,255,0.7)"}}>AI</em></div>
          </div>
        </div>
      )}

      {/* SAĞ — Form */}
      <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",padding:isMobile?"24px 24px":"40px 48px",minHeight:isMobile?"auto":"auto"}}>
        <div style={{width:"100%",maxWidth:360}}>

          {/* Logo */}
          <div style={{display:"flex",flexDirection:"column",alignItems:isMobile?"center":"flex-start",gap:2,marginBottom:isMobile?24:40}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <div style={{width:22,height:22,border:"1px solid #d4e1ef",borderRadius:5,display:"flex",alignItems:"center",justifyContent:"center"}}>
                <div style={{width:7,height:7,background:"#1e3a5f",borderRadius:"50%"}}/>
              </div>
              <div style={{fontSize:13,fontWeight:500,color:"#1e3a5f",letterSpacing:"0.04em"}}>SculptAI</div>
            </div>
            {isMobile&&<div style={{fontSize:11,color:"#7b9ab5",letterSpacing:"0.08em"}}>Dönüşüm Zekası</div>}
          </div>

          {/* Title */}
          <div style={{fontFamily:"'Playfair Display',serif",fontSize:isMobile?28:38,fontWeight:300,color:"#1e3a5f",lineHeight:1.1,marginBottom:8,letterSpacing:"-0.02em",textAlign:isMobile?"center":"left"}}>
            {mode==="login"?<>Aynı bütçe.<br/>Daha fazla<br/><em>ameliyat.</em></>:<>Kliniğinizin<br/><em>dönüşüm zekası.</em></>}
          </div>
          <div style={{fontSize:13,color:"#7b9ab5",lineHeight:1.6,marginBottom:24,textAlign:isMobile?"center":"left"}}>
            {mode==="login"?"Panele giriş yapın.":"Hesap oluşturun, hemen kullanmaya başlayın."}
          </div>

          {/* TAB */}
          <div style={{display:"flex",gap:0,marginBottom:20,borderRadius:8,overflow:"hidden",border:"1px solid #d4e1ef"}}>
            {[["login","Giriş Yap"],["register","Hesap Oluştur"]].map(([v,l])=>(
              <button key={v} onClick={()=>{setMode(v);setErr("");setRegOk(false);}}
                style={{flex:1,padding:"9px",fontSize:12,fontWeight:mode===v?600:400,letterSpacing:"0.06em",border:"none",
                  background:mode===v?"#1e3a5f":"#f8fafd",color:mode===v?"#f8fafd":"#7b9ab5",cursor:"pointer",fontFamily:"'Nunito',sans-serif"}}>
                {l}
              </button>
            ))}
          </div>

          {mode==="login"&&(
            <>
              {[["KULLANICI ADI",u,setU,"text"],["ŞİFRE",p,setP,"password"]].map(([label,val,set,type])=>(
                <div key={label} style={{marginBottom:14}}>
                  <div style={{fontSize:11,color:"#7b9ab5",letterSpacing:"0.15em",marginBottom:6}}>{label}</div>
                  <input type={type} value={val} onChange={e=>set(e.target.value)} onKeyDown={e=>e.key==="Enter"&&attempt()} style={{width:"100%",padding:"12px 14px",background:"#eef3f9",border:"1px solid #d4e1ef",borderRadius:8,color:"#1e3a5f",fontSize:14,outline:"none",fontFamily:"'Nunito',sans-serif",boxSizing:"border-box"}}/>
                </div>
              ))}
              {err&&<div style={{marginBottom:14,padding:"9px 12px",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,fontSize:13,color:"#dc2626"}}>{err}</div>}
              <button onClick={attempt} disabled={loading} style={{width:"100%",padding:"13px",background:"#1e3a5f",border:"none",borderRadius:8,color:"#f8fafd",fontSize:13,fontWeight:500,letterSpacing:"0.1em",cursor:"pointer",opacity:loading?0.7:1,fontFamily:"'Nunito',sans-serif",marginTop:4}}>
                {loading?"GİRİŞ YAPILIYOR...":"GİRİŞ YAP"}
              </button>
            </>
          )}

          {mode==="register"&&!regOk&&(
            <>
              {[["AD SOYAD",regName,setRegName,"text","Dr. Ayşe Kaya"],["KLİNİK ADI",regClinic,setRegClinic,"text","Özel Plastik Cerrahi Kliniği"],["KULLANICI ADI",regUser,setRegUser,"text","dr-ayse"],["ŞİFRE",regPass,setRegPass,"password","En az 6 karakter"],["ŞİFRE TEKRAR",regPass2,setRegPass2,"password",""]].map(([label,val,set,type,ph])=>(
                <div key={label} style={{marginBottom:12}}>
                  <div style={{fontSize:11,color:"#7b9ab5",letterSpacing:"0.15em",marginBottom:5}}>{label}</div>
                  <input type={type} value={val} placeholder={ph} onChange={e=>set(e.target.value)} onKeyDown={e=>e.key==="Enter"&&register()}
                    style={{width:"100%",padding:"11px 14px",background:"#eef3f9",border:"1px solid #d4e1ef",borderRadius:8,color:"#1e3a5f",fontSize:14,outline:"none",fontFamily:"'Nunito',sans-serif",boxSizing:"border-box"}}/>
                </div>
              ))}
              {err&&<div style={{marginBottom:14,padding:"9px 12px",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,fontSize:13,color:"#dc2626"}}>{err}</div>}
              <button onClick={register} disabled={loading} style={{width:"100%",padding:"13px",background:"#1d4ed8",border:"none",borderRadius:8,color:"#f8fafd",fontSize:13,fontWeight:500,letterSpacing:"0.1em",cursor:"pointer",opacity:loading?0.7:1,fontFamily:"'Nunito',sans-serif",marginTop:4}}>
                {loading?"OLUŞTURULUYOR...":"HESAP OLUŞTUR"}
              </button>
            </>
          )}

          {mode==="register"&&regOk&&(
            <div style={{background:"#ecfdf5",border:"1px solid #a7f3d0",borderRadius:10,padding:"20px 18px",textAlign:"center"}}>
              <div style={{fontSize:20,marginBottom:8}}>✓</div>
              <div style={{fontFamily:"'Playfair Display',serif",fontSize:20,color:"#065f46",marginBottom:8}}>Hesabınız hazır!</div>
              <div style={{fontSize:13,color:"#047857",lineHeight:1.6,marginBottom:16}}>
                <strong>{regClinic||"Klinik"}</strong> için SculptAI paneli aktif.
              </div>
              <div style={{background:"white",border:"1px solid #a7f3d0",borderRadius:8,padding:"12px",marginBottom:12,textAlign:"left"}}>
                <div style={{fontSize:10,letterSpacing:"0.12em",color:"#7b9ab5",marginBottom:6}}>HASTA FORM LİNKİ</div>
                <div style={{fontSize:13,color:"#1e3a5f",wordBreak:"break-all",fontFamily:"'Nunito',monospace"}}>{window.location.origin}/form/{regId}</div>
              </div>
              <div style={{fontSize:12,color:"#7b9ab5",marginBottom:14}}>Bu linki hastalara verin veya QR kod olarak bekleme odasına asın.</div>
              <button onClick={()=>{setMode("login");setU(regUser);setRegOk(false);}}
                style={{width:"100%",padding:"12px",background:"#1e3a5f",border:"none",borderRadius:8,color:"#f8fafd",fontSize:13,fontWeight:500,cursor:"pointer",letterSpacing:"0.08em",fontFamily:"'Nunito',sans-serif"}}>
                GİRİŞ YAP →
              </button>
            </div>
          )}

          <div style={{textAlign:"center",fontSize:11,color:"#d4e1ef",marginTop:20,letterSpacing:"0.06em"}}>
            SculptAI · Dönüşüm Zekası
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── ROOT ───────────────────────────────────────────────────────────────── */

export class ErrorBoundary extends React.Component{
  constructor(props){super(props);this.state={hasError:false,error:null};}
  static getDerivedStateFromError(e){return{hasError:true,error:e};}
  componentDidCatch(e,info){console.error("SculptAI Error:",e,info);}
  render(){
    if(this.state.hasError){
      return(
        <div style={{padding:32,fontFamily:"'Nunito',sans-serif",color:"#1e3a5f"}}>
          <div style={{fontFamily:"'Playfair Display',serif",fontSize:20,marginBottom:8}}>Bir hata oluştu</div>
          <div style={{fontSize:13,color:"#7b9ab5",marginBottom:16}}>{String(this.state.error?.message||"")}</div>
          <button onClick={()=>window.location.reload()} style={{padding:"8px 20px",background:"#1d4ed8",color:"white",border:"none",borderRadius:8,cursor:"pointer",fontSize:13}}>Sayfayı Yenile</button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App(){
  const [view,setView]=useState(()=>{
    const path=window.location.pathname;
    const params=new URLSearchParams(window.location.search);
    if(params.get("demo")==="true") return "demo";
    if(path.match(/^\/form\/.+$/)) return "patient";
    if(path.startsWith("/admin")) return "admin";
    if(path==="/panel/analytics-beta") return "analytics_beta";
    if(path.startsWith("/panel")) return "doctor_or_login";
    return "patient";
  });
  const [doctor,setDoctor]=useState(null);
  const [doctorId,setDoctorId]=useState(()=>{
    const m=window.location.pathname.match(/^\/form\/(.+)$/);
    return m?m[1]:null;
  });

  const SESSION_MAX_HOURS=8;

  useEffect(()=>{
    const path=window.location.pathname;
    if(path==="/panel/analytics-beta") return; // analytics-beta kendi auth'unu yönetir
    if(path.startsWith("/panel")){
      const params=new URLSearchParams(window.location.search);
      if(params.get("demo")==="true"){setView("demo");return;}

      // Supabase Auth session kontrolü
      sb.auth.getSession().then(({data:{session}})=>{
        if(session?.user){
          // Auth session var — doctor kaydını çek
          sb.from("doctors").select("*").eq("auth_id",session.user.id).maybeSingle()
            .then(({data:doc})=>{
              if(doc){setDoctor(doc);setView("doctor");return;}
              // auth_id eşleşmedi — sessionStorage fallback
              trySessionStorage();
            });
        } else {
          // Auth session yok — sessionStorage fallback (legacy)
          trySessionStorage();
        }
      });

      function trySessionStorage(){
        try{
          const saved=sessionStorage.getItem("sculpt_doctor");
          const loginTime=sessionStorage.getItem("sculpt_login_time");
          if(saved){
            if(loginTime && (Date.now()-parseInt(loginTime)) > SESSION_MAX_HOURS*60*60*1000){
              sessionStorage.removeItem("sculpt_doctor");
              sessionStorage.removeItem("sculpt_login_time");
              setView("login"); return;
            }
            const d=JSON.parse(saved);
            setDoctor(d);setView("doctor");
          }else{setView("login");}
        }catch{setView("login");}
      }
    }
  },[]);

  if(view==="loading"||view==="doctor_or_login") return null;

  if(view==="demo") return(
    <div>
      <div style={{position:"fixed",top:0,left:0,right:0,zIndex:9999,background:"linear-gradient(135deg,#1d4ed8,#7c3aed)",padding:"8px 20px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{fontSize:14,color:"white",fontWeight:600,fontFamily:"'Nunito',sans-serif"}}>SculptAI Demo</div>
          <div style={{fontSize:11,color:"rgba(255,255,255,0.75)",fontFamily:"'Nunito',sans-serif"}}>Örnek lead verileri · Dönüşüm segmentasyonu</div>
        </div>
        <a href="/panel" style={{fontSize:11,color:"white",textDecoration:"underline",fontFamily:"'Nunito',sans-serif",opacity:0.8}}>Giriş Yap →</a>
      </div>
      <div style={{paddingTop:38}}>
        <DoctorPanel doctor={DEMO_DOCTOR} onLogout={()=>{window.location.href="/panel";}} demoPatients={DEMO_PATIENTS}/>
      </div>
    </div>
  );

  if(view==="patient") return(
    <div>
      <PatientForm doctorId={doctorId}/>
      <button onClick={()=>setView("login")} style={{position:"fixed",bottom:16,right:16,padding:"6px 14px",background:"rgba(12,20,40,0.06)",border:"1px solid rgba(12,20,40,0.1)",borderRadius:8,color:"rgba(12,20,40,0.35)",fontSize:13,cursor:"pointer"}}>🔒</button>
    </div>
  );

  if(view==="analytics_beta") return <AnalyticsBeta/>;
  if(view==="admin") return <AdminPanel/>;
  if(view==="login") return <Login onLogin={d=>{try{sessionStorage.setItem("sculpt_doctor",JSON.stringify(d));sessionStorage.setItem("sculpt_login_time",String(Date.now()));}catch{}setDoctor(d);setView("doctor");}}/>;

  return <DoctorPanel doctor={doctor} onLogout={async()=>{try{await sb.auth.signOut();}catch{}try{sessionStorage.removeItem("sculpt_doctor");sessionStorage.removeItem("sculpt_login_time");}catch{}setDoctor(null);setView("login");}}/>;
}
