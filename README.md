# Cat Jam Notes 🐱📝

> Minimalist, tamamen yerel markdown not defteri — Obsidian tarzı not alma, Logseq tarzı özellikler ve bir kedi maskot ile.
> Notlarınız hiçbir buluta gitmez; her şey cihazınızda yaşar.

Web, PWA (telefona kurulabilir) ve **Electron masaüstü uygulaması** (Windows) olarak tek kod tabanından çalışır.

---

## ✨ Özellikler

### Yazma
- **Markdown editörü** — canlı önizleme, çağrı kutuları (`> [!note]`), matematik (KaTeX), diyagramlar (mermaid), kod blokları
- **Bağlantı ağı** — `[[çift köşeli parantez]]` bağlantıları, otomatik link önerisi (yazarken), geri bağlantılar (backlinks)
- **Etiketler** — `#etiket` · **Görevler** — `- [ ]` onay kutuları
- **Özellikler (Logseq tarzı)** — YAML front-matter veya `özellik:: değer` söz dizimi
- **Sürüm geçmişi** — not değişiklikleri otomatik kaydedilir; kelime düzeyinde **diff görüntüleyici** (⇄)
- **Otomatik kayıt** + çöp kutusu + geri alma

### Görünümler & Panolar
- ▦ **Kanban panosu** — `status::` özelliğine göre Todo/Doing/Done sütunları, sürükle-bırak (masaüstü) / seçici (mobil)
- ☑ Görevler görünümü · # etiket bulutu · 📊 Haftalık rapor · 📈 İstatistik (26 haftalık heatmap 🔥, seriler 🔥, günlük kelime hedefi)
- 🗑 Çöp kutusu (kalıcı silmeden önce geri yükleme)

### Gizlilik & Güvenlik
- 🔒 **Uçtan uca şifreli kilitli notlar** — PBKDF2 (150k) + AES-GCM-256, parola asla kayıtlı tutulmaz
- 🎤 **Sesli yazı — %100 yerel Whisper** — model cihazına bir kere iner (~100 MB), sonrasında tamamen çevrimdışı çalışır; sesiniz cihazdan çıkmaz
- ☁️ Bulut yok, hesap yok, API anahtarı yok

### Kedi Maskotlu 🐱
- İmleci izleyen gözler, gözlenme, sevmek (tutup sürek basılı): mrlama sesi + kalpler
- **XP & seviye sistemi**: L2 yaka → L3 yay → L4 şapka → L5 gözlük → L6 taç; 5 tüy görünümü
- Yazdıkça mutlu olur, **Pomodoro sırasında uyur** 😴 (sayaç rozetli), gece erken uyumaz (yazı yazıyorsan)
- Anahtar kelime tepkileri, lazer kovalama, not önerisi, çift tık paneli

### Diğer
- 🎧 **Ortam sesleri** (yağmur / dalga / ateş) — WebAudio, dosya indirmeksizin sentezlenir
- 🌐 **Tek dosya HTML paylaşımı** — notu ekleriyle tek `file.html` olarak dışa aktar
- Belirli **temalar**, **tr/en dil değişimi** (varsayılan Türkçe)
- 📱 Mobil uyumlu + seçim yapınca çıkan **format çubuğu** (B/I/S/kod/başlık/bağlantı/liste/görev/alıntı)
- 📦 **PWA** — telefona/bilgisayara kurulabilir, çevrimdışı çalışır
- 🖥 **Electron masaüstü** — gerçek `Cat Jam.exe`, Başlat menüsü kısayolu, kendi veri diziniyle izole

---

## 🚀 Kullanım

### Web / Geliştirme
```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # dist/ üretimi (tsc + vite)
```

### Elektron Masaüstü (Windows)
```bash
npm run exe      # dist + NSIS kurulumcu: release/Cat Jam Setup x.x.x.exe
npm run app      # derle + kurulumcu olmadan hemen pencere aç
```

### Telefona Kurulum (PWA)
1. `npm run build` → `dist/` klasörünü statik bir sunucuya koy
2. Chrome/Edge adres çubuğundaki **kurulum** simgesi → "Yükle"
3. iOS Safari → Paylaş → "Ana Ekrana Ekle"

---

## 🔐 Gizlilik taahhüdü

| Ne | Cihazdan çıkıyorsa |
|---|---|
| Notlar | **Hayır** — IndexedDB'de ve açtığın klasör (vault) içinde lokal durur |
| Ses (mikrofon) | **Hayır** — Whisper tamamen yerel; sesiniz ağa gitmez |
| Whisper modeli (~100 MB) | **Bir kere** iner — yazan ve uygulayan HuggingFace CDN |
| Kod deposu | Bu repo — sadece kod, içerik hiçbir zaman |

---

## 🛠 Teknoloji

- **Vite + Vanilla TypeScript** — çerçevesiz, küçük
- **Dexie (IndexedDB)** — lokal not deposu
- **marked + katex + mermaid** — render katmanı
- **transformers.js (Xenova) + onnxruntime-web** — yerel Whisper (WebGPU/WASM)
- **Electron 44 + electron-builder** — masaüstü paketi
- **Web Speech API yerine yerel Whisper** — ücretsiz ve özel

---

## 🗺 Yol haritası (özet)

- [x] PWA · Kanban · mobil format çubuğu · Electron paketi · istatistik/heatmap · E2EE kilit · sürüm diff · kedi maskot tam etkileşim
- [ ] Flashcards + SRS ezber kartları
- [ ] İlgili notlar (yerel MiniLM embeddings)
- [ ] Whiteboard (beta)
- [ ] CodeMirror 6 editör yükseltmesi
- [ ] Vault bulup-değiştir

---

- 💛 **attilayener** tarafından geliştirildi · sürüm 0.1.0
