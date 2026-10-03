# RiffForge - Upgrade Plan

**Analiz Tarihi:** 2026-02-16
**Mevcut Versiyon:** v0.2.3 Beta
**Tip:** Vite + React + TypeScript

---

## Kritik Upgrades

### 1. State Management Refactor
**Oncelik:** KRITIK
**Dosya:** `App.tsx`

App.tsx icinde 12+ useState/useRef/useCallback dagitik olarak duruyor. React Context veya Zustand ile ayrilmali.

```bash
npm install zustand
```

**Gorev:**
- [ ] `stores/audioStore.ts` olustur
- [ ] `stores/chordStore.ts` olustur
- [ ] App.tsx'ten state'leri tasir

---

### 2. Bundle Boyutu Optimizasyonu
**Oncelik:** YUKSEK
**Dosya:** `constants.ts`

CHORD_LIBRARY 650+ satir inline object olarak bundle'da. JSON'a tasimali.

**Gorev:**
- [ ] `public/chords/` klasoru olustur
- [ ] Vibe'lara gore JSON dosyalari ayir
- [ ] Lazy fetch implementasyonu yap

---

### 3. Console.log Temizligi
**Oncelik:** YUKSEK
**Dosyalar:** `App.tsx`, `utils/musicTheory.ts`

Production'da debug loglari kalmamali.

**Gorev:**
- [ ] Tum console.log ifadelerini kaldir
- [ ] Veya `import.meta.env.DEV` ile sarmalayarak sadece dev'de goster

---

### 4. transposeTabs Yorum Temizligi
**Oncelik:** YUKSEK
**Dosya:** `utils/musicTheory.ts` (satir 93-211)

118 satirlik yorum alinmis kod ya implement edilmeli ya kaldirilmali.

**Gorev:**
- [ ] 4-fret spread optimizasyonunu implement et VEYA
- [ ] Yorumlanmis kodu tamamen sil

**Durum (2026-10-03): Gecersiz, `engine/` ile asildi.** `transposeTabs` kaldirildi. Kart tablari artik
`engine/` (parmak atamasi, mm cinsinden uzanma, barresiz uretim) tarafindan `utils/libraryVoicing.ts`
uzerinden uretiliyor; perde-acikligi kurali yerine kisisel el profili kullaniliyor.

---

## Orta Oncelikli Upgrades

### 5. Test Coverage
**Oncelik:** ORTA

```bash
npm install -D vitest @testing-library/react
```

**Gorev:**
- [ ] `utils/musicTheory.test.ts` olustur
- [ ] `services/audioEngine.test.ts` olustur
- [ ] Temel fonksiyonlar icin unit test yaz

---

### 6. Gemini API Entegrasyonu
**Oncelik:** ORTA
**Dosya:** `vite.config.ts`

API key altyapisi hazir ama kullanilmiyor. AI ozellik planlaniyorsa implement et.

**Gorev:**
- [ ] AI akor onerisi ozelligini implement et VEYA
- [ ] Kullanilmayan env config'i temizle

---

### 7. Keyboard Accessibility
**Oncelik:** ORTA
**Dosya:** `components/ChordCard.tsx`

Akor kartlari sadece mouse ile calisir. Klavye destegi ekle.

**Gorev:**
- [ ] Space/Enter ile akor calmaya izin ver
- [ ] aria-label'lari tamamla
- [ ] Focus ring stili ekle

---

## Dusuk Oncelikli Upgrades

### 8. Harici Texture URL'leri
**Dosyalar:** `App.tsx`, `components/DistortionSwitch.tsx`

Texture'lar dis URL'lerden yukleniyor. Local'e tasimali.

**Gorev:**
- [ ] `public/textures/` klasoru olustur
- [ ] noise.svg ve carbon-fibre.png indir
- [ ] URL'leri local path'lere guncelle

---

### 9. relatedChords Normalizasyonu
**Dosya:** `constants.ts`

Circular referanslar gereksiz veri tekrari yapiyor.

**Gorev:**
- [ ] ID referanslari sistemine gec
- [ ] relatedChords: ['dark-2', 'dark-3'] formatina cevir

---

### 10. Glitch Animasyon Optimizasyonu
**Dosya:** `index.css`

Infinite glitch animasyonu tum sayfa performansini etkiliyor.

**Gorev:**
- [ ] Animasyonu sadece title'a uygula
- [ ] Veya Framer Motion ile kontrollü animasyon yap

---

## Onerilen Yeni Kutuphaneler

| Kategori | Kutuphane | Amac |
|----------|-----------|------|
| State | `zustand` | Lightweight state management |
| Test | `vitest` | Vite-native test runner |
| Fretboard | `react-guitar` | Gorsel fretboard component |
| Audio Viz | Tone.js `Analyser` | Dalga formu gorseli |

---

## Tahmini Is Yukleri

| Upgrade | Zorluk |
|---------|--------|
| State Refactor | Orta |
| Bundle Optimizasyonu | Kolay |
| Console Temizligi | Cok Kolay |
| Test Ekleme | Orta |
| A11y Iyilestirme | Kolay |
