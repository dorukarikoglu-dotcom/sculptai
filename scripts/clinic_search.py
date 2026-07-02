"""
SculptAI — Plastik Cerrahi Klinik Arama
Google Custom Search API ile kamuya açık klinik bilgilerini toplar.

Kullanım:
  export GOOGLE_API_KEY="..."
  export GOOGLE_SEARCH_ENGINE_ID="..."
  python scripts/clinic_search.py

Çıktı: ankara_istanbul_plastik_klinikler.csv
"""

import os, re, csv, time, json, sys
from urllib.request import urlopen, Request
from urllib.parse import quote_plus
from urllib.error import HTTPError, URLError

# ─── Config ──────────────────────────────────────────────────────────────────

API_KEY = os.environ.get("GOOGLE_API_KEY", "")
SEARCH_ENGINE_ID = os.environ.get("GOOGLE_SEARCH_ENGINE_ID", "")
OUTPUT_FILE = "ankara_istanbul_plastik_klinikler.csv"
DELAY = 2  # seconds between requests
RESULTS_PER_QUERY = 10  # max 10 for free tier

KEYWORDS = [
    ("rinoplasti Ankara", "Ankara", "Rinoplasti"),
    ("rinoplasti İstanbul", "İstanbul", "Rinoplasti"),
    ("liposuction Ankara", "Ankara", "Liposuction"),
    ("liposuction İstanbul", "İstanbul", "Liposuction"),
    ("meme büyütme Ankara", "Ankara", "Meme Büyütme"),
    ("meme büyütme İstanbul", "İstanbul", "Meme Büyütme"),
    ("meme küçültme Ankara", "Ankara", "Meme Küçültme"),
    ("meme küçültme İstanbul", "İstanbul", "Meme Küçültme"),
    ("meme protezi Ankara", "Ankara", "Meme Protezi"),
    ("meme protezi İstanbul", "İstanbul", "Meme Protezi"),
    ("yüz germe Ankara", "Ankara", "Yüz Germe"),
    ("yüz germe İstanbul", "İstanbul", "Yüz Germe"),
    ("karın germe Ankara", "Ankara", "Karın Germe"),
    ("karın germe İstanbul", "İstanbul", "Karın Germe"),
    ("plastik cerrahi kliniği Ankara", "Ankara", "Genel"),
    ("plastik cerrahi kliniği İstanbul", "İstanbul", "Genel"),
]

# ─── Phone extraction ────────────────────────────────────────────────────────

PHONE_PATTERNS = [
    r'\+90\s*5\d{2}\s*\d{3}\s*\d{2}\s*\d{2}',
    r'\+90\s*[2-4]\d{2}\s*\d{3}\s*\d{2}\s*\d{2}',
    r'0\s*5\d{2}\s*\d{3}\s*\d{2}\s*\d{2}',
    r'0\s*[2-4]\d{2}\s*\d{3}\s*\d{2}\s*\d{2}',
    r'05\d{2}[-.\s]?\d{3}[-.\s]?\d{2}[-.\s]?\d{2}',
    r'0[2-4]\d{2}[-.\s]?\d{3}[-.\s]?\d{2}[-.\s]?\d{2}',
]

def extract_phones(text):
    phones = set()
    for pattern in PHONE_PATTERNS:
        for match in re.findall(pattern, text):
            normalized = re.sub(r'[\s\-\.\(\)]', '', match)
            if normalized.startswith('+90'):
                normalized = '0' + normalized[3:]
            if len(normalized) == 11 and normalized.startswith('0'):
                formatted = f"{normalized[0:4]} {normalized[4:7]} {normalized[7:9]} {normalized[9:11]}"
                phones.add(formatted)
    return list(phones)


def normalize_phone(phone):
    return re.sub(r'\s', '', phone)


# ─── Name extraction ─────────────────────────────────────────────────────────

DOCTOR_PREFIXES = [
    r'(?:Op\.?\s*)?Dr\.?\s+[A-ZÇĞİÖŞÜ][a-zçğıöşü]+\s+[A-ZÇĞİÖŞÜ][a-zçğıöşü]+(?:\s+[A-ZÇĞİÖŞÜ][a-zçğıöşü]+)?',
    r'(?:Doç\.?\s*)?Dr\.?\s+[A-ZÇĞİÖŞÜ][a-zçğıöşü]+\s+[A-ZÇĞİÖŞÜ][a-zçğıöşü]+(?:\s+[A-ZÇĞİÖŞÜ][a-zçğıöşü]+)?',
    r'(?:Prof\.?\s*)?Dr\.?\s+[A-ZÇĞİÖŞÜ][a-zçğıöşü]+\s+[A-ZÇĞİÖŞÜ][a-zçğıöşü]+(?:\s+[A-ZÇĞİÖŞÜ][a-zçğıöşü]+)?',
]

def extract_doctor_name(text):
    for pattern in DOCTOR_PREFIXES:
        match = re.search(pattern, text)
        if match:
            return match.group(0).strip()
    return ""


def extract_clinic_name(title, snippet):
    """Try to extract clinic name from title — usually before ' - ' or ' | '"""
    for sep in [' - ', ' | ', ' – ', ' — ']:
        if sep in title:
            return title.split(sep)[0].strip()
    return title.strip()


# ─── Google Custom Search ────────────────────────────────────────────────────

def search_google(query, start=1):
    url = (
        f"https://www.googleapis.com/customsearch/v1"
        f"?key={API_KEY}"
        f"&cx={SEARCH_ENGINE_ID}"
        f"&q={quote_plus(query)}"
        f"&gl=tr&lr=lang_tr"
        f"&start={start}"
        f"&num={RESULTS_PER_QUERY}"
    )
    req = Request(url, headers={"User-Agent": "SculptAI-ClinicSearch/1.0"})
    try:
        with urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())
    except HTTPError as e:
        print(f"  HTTP Error {e.code}: {e.reason}")
        if e.code == 429:
            print("  Rate limit — waiting 30s...")
            time.sleep(30)
        return None
    except (URLError, Exception) as e:
        print(f"  Error: {e}")
        return None


# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    if not API_KEY or not SEARCH_ENGINE_ID:
        print("Hata: GOOGLE_API_KEY ve GOOGLE_SEARCH_ENGINE_ID environment variable'larını set edin.")
        print("")
        print("  export GOOGLE_API_KEY='AIza...'")
        print("  export GOOGLE_SEARCH_ENGINE_ID='...'")
        sys.exit(1)

    clinics = {}  # phone → clinic data (dedup by phone)
    seen_urls = set()
    total_queries = 0

    print(f"SculptAI Klinik Arama")
    print(f"{'='*50}")
    print(f"{len(KEYWORDS)} arama terimi, tahmini {len(KEYWORDS)} API sorgusu")
    print()

    for keyword, location, procedure in KEYWORDS:
        print(f"🔍 \"{keyword}\"...")
        data = search_google(keyword)
        total_queries += 1

        if not data or "items" not in data:
            print(f"  Sonuç yok")
            time.sleep(DELAY)
            continue

        items = data["items"]
        print(f"  {len(items)} sonuç bulundu")

        for item in items:
            title = item.get("title", "")
            snippet = item.get("snippet", "")
            url = item.get("link", "")
            full_text = f"{title} {snippet}"

            # Skip duplicates by URL
            domain = re.sub(r'https?://(www\.)?', '', url).split('/')[0]
            if domain in seen_urls:
                continue
            seen_urls.add(domain)

            # Extract data
            phones = extract_phones(full_text)
            doctor = extract_doctor_name(full_text)
            clinic = extract_clinic_name(title, snippet)

            # If no phone found, still record with empty phone
            if not phones:
                phones = [""]

            for phone in phones:
                key = normalize_phone(phone) if phone else url
                if key in clinics:
                    # Merge procedure types
                    existing_procs = clinics[key]["procedures"]
                    if procedure not in existing_procs:
                        clinics[key]["procedures"].append(procedure)
                    # Fill in missing data
                    if not clinics[key]["doctor"] and doctor:
                        clinics[key]["doctor"] = doctor
                    continue

                clinics[key] = {
                    "clinic": clinic,
                    "doctor": doctor,
                    "location": location,
                    "phone": phone,
                    "url": url,
                    "procedures": [procedure],
                }

        # Incremental save
        save_csv(clinics)
        time.sleep(DELAY)

    print()
    print(f"{'='*50}")
    print(f"Toplam: {total_queries} API sorgusu, {len(clinics)} benzersiz klinik/URL")
    print(f"Kaydedildi: {OUTPUT_FILE}")


def save_csv(clinics):
    rows = []
    for key, c in clinics.items():
        rows.append({
            "Klinik Adı": c["clinic"],
            "Doktor Adı": c["doctor"],
            "Şehir": c["location"],
            "Telefon": c["phone"],
            "Website": c["url"],
            "Prosedürler": ", ".join(c["procedures"]),
        })

    # Sort: with phone first, then by city
    rows.sort(key=lambda r: (0 if r["Telefon"] else 1, r["Şehir"], r["Klinik Adı"]))

    with open(OUTPUT_FILE, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=["Klinik Adı", "Doktor Adı", "Şehir", "Telefon", "Website", "Prosedürler"])
        writer.writeheader()
        writer.writerows(rows)


if __name__ == "__main__":
    main()
