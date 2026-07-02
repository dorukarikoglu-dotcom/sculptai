import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  "https://ndabbbnrlgtwparpivim.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5kYWJiYm5ybGd0d3BhcnBpdmltIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MTQ2NDAsImV4cCI6MjA4OTM5MDY0MH0.g9ZUYqFw00IE_aIVNumcGyGHi1lbrurSiPXnI5PzQJo"
);

const doctorId = "12e2797a-bd5b-4875-848e-45482ebcd122";

const patients = [
  // 1. Rinoplasti isteyen kararsız genç kadın
  {
    name: "Elif Yılmaz",
    age: "23",
    gender: "Kadın",
    procedure: "Burun Estetiği",
    otherAreas: "Evet, 1-2 bölge daha var ama önceliğim bu",
    rhinoVision: "Aklımda belirli bir referans var — bir ünlü veya fotoğraf",
    otherConsidered: "Evet, düşündüm ama erteledim",
    bodyFocus: "Sık sık düşünürüm, ama kontrol altında",
    avoidance: "Bazı sosyal ortamlardan kaçınıyorum",
    motivation: "Yakınlarımın yorumları etkili oldu",
    expectation: "Belirgin bir fark olmasını istiyorum",
    selfEsteem: "Kendimden pek memnun değilim",
    imagineAfter: "Çevremin tepkisini ve beğenisini hayal ediyorum",
    prevSurgery: "Hayır",
    multiDoctor: "Birçok doktorla görüştüm",
    decisionDuration: "Uzun süredir düşünüyorum ama hâlâ kararsız hissediyorum",
    riskKnowledge: "Genel olarak bilgi sahibiyim",
    support: "Biliyorlar ama kararsızlar",
    revision: "Kusursuz sonuç bekliyorum",
    sharing: "Sadece çok yakınlarımla",
    socialInfluence: "Bazen danışanlar olur",
    phone: "05321234567",
    openStory: "Arkadaşlarımın burnumla ilgili yorumları beni çok etkiliyor. Instagram'da gördüğüm bir modelin burnunu çok beğeniyorum, aynısını istiyorum.",
  },
  // 2. Meme küçültme isteyen kararlı orta yaş kadın
  {
    name: "Ayşe Demir",
    age: "42",
    gender: "Kadın",
    procedure: "Meme Küçültme",
    otherAreas: "Hayır, sadece bu bölge",
    breastSymmetry: "Fark var ama beni pek rahatsız etmiyor, ameliyatla düzelsin istiyorum",
    otherConsidered: "Hayır",
    bodyFocus: "Zaman zaman düşünürüm",
    avoidance: "Hayır, hayatımı etkilemiyor",
    motivation: "Kendim için daha iyi hissetmek istiyorum",
    expectation: "Dengeli ve orantılı bir sonuç bekliyorum",
    selfEsteem: "Evet, kendimden genel olarak memnunum",
    imagineAfter: "Kendimi daha özgüvenli ve hafif hayal ediyorum",
    prevSurgery: "Hayır",
    multiDoctor: "1-2 doktorla görüştüm",
    decisionDuration: "1 yılı aşkın süredir düşünüyorum — artık harekete geçme zamanı",
    riskKnowledge: "Detaylı araştırdım ve biliyorum",
    support: "Evet, destekliyorlar",
    revision: "Evet, olası revizyonu normal karşılarım",
    sharing: "Evet, açıkça paylaşırım",
    socialInfluence: "Evet, sık sık danışırlar",
    phone: "05339876543",
    openStory: "Yıllardır sırt ve omuz ağrısı çekiyorum, spor yaparken çok zorlanıyorum. Artık rahat hareket etmek ve kıyafet seçerken zorlanmamak istiyorum.",
  },
  // 3. Lazer epilasyon isteyen erkek
  {
    name: "Kaan Öztürk",
    age: "29",
    gender: "Erkek",
    procedure: "Lazer Epilasyon",
    otherAreas: "Hayır, sadece bu bölge",
    otherConsidered: "Hayır",
    bodyFocus: "Zaman zaman düşünürüm",
    avoidance: "Bazen dikkatimi dağıtıyor",
    motivation: "Özgüvenimi artırmak istiyorum",
    expectation: "Küçük, doğal bir iyileştirme yeterli",
    selfEsteem: "Çoğunlukla memnunum, bazı konularda değil",
    imagineAfter: "Kendimi daha özgüvenli ve hafif hayal ediyorum",
    prevSurgery: "Hayır",
    multiDoctor: "Hayır",
    decisionDuration: "Birkaç aydır düşünüyorum — hazır olduğumu hissediyorum",
    riskKnowledge: "Genel olarak bilgi sahibiyim",
    support: "Evet, destekliyorlar",
    revision: "Evet, olası revizyonu normal karşılarım",
    sharing: "Sadece çok yakınlarımla",
    socialInfluence: "Hayır, danışmazlar",
    phone: "05415556677",
    openStory: "Yazın denize girerken ve spor salonunda daha rahat hissetmek istiyorum.",
  },
  // 4. Yüz germe isteyen yüksek beklentili hasta
  {
    name: "Sevgi Aksoy",
    age: "56",
    gender: "Kadın",
    procedure: "Yüz Germe",
    otherAreas: "Evet, birkaç bölge var, hepsini konuşmak isterim",
    otherConsidered: "Evet, bu işlemle aynı anda değerlendiriyorum",
    bodyFocus: "Sık sık düşünürüm, ama kontrol altında",
    avoidance: "Bazı sosyal ortamlardan kaçınıyorum",
    motivation: "Hayatımın daha iyi gideceğini düşünüyorum",
    expectation: "Tamamen farklı bir görünüm istiyorum",
    selfEsteem: "Kendimden pek memnun değilim",
    imagineAfter: "Hayatımın daha iyi gideceğini hayal ediyorum",
    prevSurgery: "Evet ama beklentimi karşılamadı",
    multiDoctor: "Birçok doktorla görüştüm",
    decisionDuration: "1 yılı aşkın süredir düşünüyorum — artık harekete geçme zamanı",
    riskKnowledge: "Hiçbir bilgim yok",
    support: "Kimseye söylemedim",
    revision: "Kusursuz sonuç bekliyorum",
    sharing: "Hayır, paylaşmam",
    socialInfluence: "Hayır, danışmazlar",
    phone: "05527778899",
    openStory: "20 yaş gençleşmek istiyorum. Herkes fark etsin, bambaşka biri gibi görünmek istiyorum. Artık aynaya bakınca mutlu olmak istiyorum.",
  },
  // 5. Botoks isteyen düşük riskli hasta
  {
    name: "Zeynep Kaya",
    age: "35",
    gender: "Kadın",
    procedure: "Botoks Uygulaması",
    otherAreas: "Hayır, sadece bu bölge",
    otherConsidered: "Evet, gelecekte yapmayı planlıyorum",
    bodyFocus: "Nadiren aklıma gelir",
    avoidance: "Hayır, hayatımı etkilemiyor",
    motivation: "Kendim için daha iyi hissetmek istiyorum",
    expectation: "Küçük, doğal bir iyileştirme yeterli",
    selfEsteem: "Evet, kendimden genel olarak memnunum",
    imagineAfter: "Kendimi daha özgüvenli ve hafif hayal ediyorum",
    prevSurgery: "Evet ve memnunum",
    multiDoctor: "Hayır",
    decisionDuration: "Birkaç aydır düşünüyorum — hazır olduğumu hissediyorum",
    riskKnowledge: "Detaylı araştırdım ve biliyorum",
    support: "Evet, destekliyorlar",
    revision: "Evet, olası revizyonu normal karşılarım",
    sharing: "Evet, açıkça paylaşırım",
    socialInfluence: "Evet, sık sık danışırlar",
    phone: "05553334455",
    openStory: "Alın kırışıklıklarım son yıllarda belirginleşti, doğal bir tazeleme istiyorum. Abartı değil, kendime biraz bakım.",
  },
];

async function submit() {
  for (const p of patients) {
    // Simple risk score estimate (not exact ML but representative)
    let score = 30; // default low
    if (p.expectation?.includes("Tamamen farklı")) score += 25;
    if (p.motivation?.includes("Yakınlarımın") || p.motivation?.includes("Hayatımın")) score += 15;
    if (p.revision === "Kusursuz sonuç bekliyorum") score += 10;
    if (p.multiDoctor === "Birçok doktorla görüştüm") score += 8;
    if (p.support === "Kimseye söylemedim" || p.support === "Karşılar") score += 8;
    if (p.riskKnowledge === "Hiçbir bilgim yok") score += 10;
    if (p.prevSurgery === "Evet ama beklentimi karşılamadı") score += 8;
    if (p.rhinoVision?.includes("referans")) score += 10;
    if (p.avoidance?.includes("sosyal ortamlardan")) score += 5;
    score = Math.min(100, score);

    let segment = "Randevuya Hazır";
    let cat = "green";
    if (score >= 60) { segment = "Öncelikli Değerlendirme"; cat = "red"; }
    else if (score >= 45) { segment = "Dikkatli Değerlendir"; cat = "amber"; }
    else if (score < 25) { segment = "Marka Elçisi"; cat = "ambassador"; }

    const rec = {
      id: crypto.randomUUID(),
      doctor_id: doctorId,
      date: new Date().toISOString(),
      created_at: new Date().toISOString(),
      risk_score: score,
      segment,
      answers: { ...p, kvkk_consent: true, kvkk_date: new Date().toISOString() },
      ai_text: "",
      ai_loading: false,
      ambassador_code: cat === "ambassador" ? "REF-" + Math.random().toString(36).substr(2, 4).toUpperCase() : "",
      ambassador_sent: false,
      outcome_procedures: [],
      no_appointment: false,
      model_source: "test_manual",
      referred_by: null,
    };

    const { error } = await sb.from("patients").insert(rec);
    if (error) {
      console.error(`HATA - ${p.name}:`, error.message);
    } else {
      console.log(`✓ ${p.name} (${p.procedure}) — skor: ${score}, segment: ${segment}`);
    }
  }
  process.exit(0);
}

submit();
