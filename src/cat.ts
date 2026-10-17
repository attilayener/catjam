// 🐱 Kedi maskot beyni — tamamen yerel: WebAudio sesler, localStorage XP, CSS ruh hâlleri.
import { t } from './i18n';
import { getState } from './store';

// ---------- Kısa yardımlar ----------
function isTr(): boolean { return getState().settings.language === 'tr'; }
function store(key: string): string | null { return localStorage.getItem(key); }
function save(key: string, v: string) { localStorage.setItem(key, v); }

export function catEnabled(): boolean { return store('catjam:cat') !== '0'; }
function soundOn(): boolean { return store('catjam:catsound') !== '0'; }

export function setCatEnabled(on: boolean) {
  save('catjam:cat', on ? '1' : '0');
  mountCat();
}

export const CAT_SKINS: { id: string; labelTr: string; labelEn: string }[] = [
  { id: 'orange', labelTr: 'Turuncu', labelEn: 'Orange' },
  { id: 'gray', labelTr: 'Gri', labelEn: 'Gray' },
  { id: 'black', labelTr: 'Siyah', labelEn: 'Black' },
  { id: 'white', labelTr: 'Beyaz', labelEn: 'White' },
  { id: 'calico', labelTr: 'Üç renkli', labelEn: 'Calico' },
];
function currentSkin(): string {
  const s = store('catjam:catskin');
  return CAT_SKINS.some((x) => x.id === s) && s ? s : 'orange';
}
export function setCatSkin(id: string) {
  save('catjam:catskin', id);
  applySkin();
}
export function setCatSound(on: boolean) {
  save('catjam:catsound', on ? '1' : '0');
}

// ---------- Konuşma balonu ----------
const QUIPS_TR = ['Miyav!', 'Pur pur… 😺', 'Notlar kayıtlı, minnettarım.', 'Bugün ne yazacağız?', 'Bana mama, sana ilham.', 'Kafein + kedi = verim.', 'Hitimeli bir kedi dayım.'];
const QUIPS_EN = ['Meow!', 'Purrr… 😺', 'Notes saved — you\'re welcome.', 'What are we writing today?', 'Catnip and coffee time.', 'Caffeine + cat = flow.', 'Purr productivity!'];
const NAG_TR = ['Uzun zaman oldu miyav… bir not mu?', 'Klavyeyi tırmalamamam mı lazım 🙀', 'Bugün 0 not? Edemem!'];
const NAG_EN = ['It\'s been a while… meow.', 'Should I scratch the keyboard? 🙀', 'Zero notes today? Unmeow-lievable!'];
const LEVELUP_TR = ['Seviye {n}! 🎀 Aksesuvarım geldi!', 'Seviye {n} benim! Balık ödülü?'];
const LEVELUP_EN = ['Level {n}! 🎀 New accessory!', 'Level {n}, baby! Fish reward?'];

let bubbleTimer: ReturnType<typeof setTimeout> | undefined;
function say(text: string | HTMLElement, ms = 3200) {
  const root = document.getElementById('catMascot');
  const bubble = document.getElementById('catBubble') as HTMLDivElement | null;
  if (!root || !bubble) return;
  bubble.innerHTML = '';
  if (typeof text === 'string') bubble.textContent = text;
  else bubble.appendChild(text);
  bubble.classList.add('show');
  root.classList.add('talking');
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => { bubble.classList.remove('show'); root.classList.remove('talking'); }, ms);
}
function quip(list: string[]) { return list[Math.floor(Math.random() * list.length)]; }

// ---------- WebAudio: pur + miyav (tamamen sentez, dosya yok) ----------
let actx: AudioContext | null = null;
function audio(): AudioContext {
  if (!actx) actx = new AudioContext();
  void actx.resume();
  return actx;
}

let purrNodes: { src: AudioBufferSourceNode; gain: GainNode; lfo: OscillatorNode } | null = null;
function purrStop() {
  if (!purrNodes || !actx) return;
  const { src, gain, lfo } = purrNodes;
  const now = actx.currentTime;
  gain.gain.setTargetAtTime(0.0001, now, 0.08);
  setTimeout(() => { try { src.stop(); lfo.stop(); } catch { /* zaten durmuş */ } }, 300);
  purrNodes = null;
}
function purrStart() {
  if (!soundOn() || purrNodes) return;
  const ctx = audio();
  const buf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    last = (last + 0.04 * w) / 1.04; // brown'umsu
    d[i] = last * 3;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf; src.loop = true;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260;
  const gain = ctx.createGain(); gain.gain.value = 0.0001;
  gain.gain.setTargetAtTime(0.055, ctx.currentTime, 0.15);
  const trem = ctx.createGain(); trem.gain.value = 1;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 24;
  const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.55;
  lfo.connect(lfoGain); lfoGain.connect(trem.gain);
  src.connect(lp); lp.connect(gain); gain.connect(trem); trem.connect(ctx.destination);
  src.start(); lfo.start();
  purrNodes = { src, gain, lfo };
}

function meow() {
  if (!soundOn()) return;
  const ctx = audio();
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(420, t0);
  osc.frequency.exponentialRampToValueAtTime(880, t0 + 0.1);
  osc.frequency.exponentialRampToValueAtTime(300, t0 + 0.42);
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1000; bp.Q.value = 2.5;
  bp.frequency.setValueAtTime(900, t0);
  bp.frequency.exponentialRampToValueAtTime(1400, t0 + 0.12);
  bp.frequency.exponentialRampToValueAtTime(650, t0 + 0.42);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.09, t0 + 0.04);
  gain.gain.setValueAtTime(0.09, t0 + 0.22);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.48);
  osc.connect(bp); bp.connect(gain); gain.connect(ctx.destination);
  osc.start(t0); osc.stop(t0 + 0.55);
}

// ---------- XP / seviye ----------
const XP_LEVELS = [0, 15, 40, 80, 140, 220]; // seviye 1..6
function getXp(): number { return Number(store('catjam:catxp') || '0'); }
function levelOf(xp: number): number {
  let lv = 1;
  for (let i = 0; i < XP_LEVELS.length; i++) if (xp >= XP_LEVELS[i]) lv = i + 1;
  return lv;
}
export function addAffection(points: number) {
  if (!catEnabled()) return;
  const before = levelOf(getXp());
  const xp = getXp() + points;
  save('catjam:catxp', String(xp));
  const after = levelOf(xp);
  applyAccessories();
  if (after > before) {
    setMood('happy');
    meow();
    say(quip(isTr() ? LEVELUP_TR : LEVELUP_EN).replace('{n}', String(after)), 4000);
  }
}

// ---------- DOM ----------
let moonTimers: ReturnType<typeof setInterval>[] = [];

function clearLoops() {
  for (const id of moonTimers) clearInterval(id);
  moonTimers = [];
}

function catSvgHtml(): string {
  return `
    <div id="catBubble"></div>
    <div id="catPomoChip" style="display:none;"></div>
    <div class="cat-zz">Z z z</div>
    <svg class="cat-svg" width="54" height="54" viewBox="0 0 46 46" aria-hidden="true">
      <g class="cat-tail"><path d="M33 33 Q 41 33 41 24" fill="none" stroke="var(--cat-fur)" stroke-width="3.4" stroke-linecap="round"/></g>
      <ellipse class="body" cx="23" cy="31.5" rx="11.5" ry="8.5" fill="var(--cat-fur)" stroke="var(--cat-line)" stroke-opacity=".28" stroke-width=".7"/>
      <ellipse class="patch" cx="23" cy="33" rx="6.5" ry="4.4" fill="var(--cat-patch)"/>
      <circle cx="23" cy="17" r="9.5" fill="var(--cat-fur)" stroke="var(--cat-line)" stroke-opacity=".28" stroke-width=".7"/>
      <path class="patch" d="M17.2 10.6 Q21 8.6 24.4 10.4 L23.2 15.4 Q19 16 17.2 10.6 Z" fill="var(--cat-patch)"/>
      <path d="M15.4 12.5 L14 4.5 L20.8 9.5 Z" fill="var(--cat-fur)" stroke="var(--cat-line)" stroke-opacity=".28" stroke-width=".7"/>
      <path d="M30.6 12.5 L32 4.5 L25.2 9.5 Z" fill="var(--cat-fur)" stroke="var(--cat-line)" stroke-opacity=".28" stroke-width=".7"/>
      <path d="M16.6 12 L15.6 7.2 L19.6 9.7 Z" fill="var(--cat-inner)"/>
      <path d="M29.4 12 L30.4 7.2 L26.4 9.7 Z" fill="var(--cat-inner)"/>
      <g class="cat-eyes">
        <g class="cat-eye"><ellipse class="eyeball" cx="19.6" cy="16.4" rx="2.5" ry="2.5" fill="var(--cat-eye-bg)"/><circle class="cat-pupil" cx="19.6" cy="16.4" r="1.25" fill="var(--cat-pupil)"/></g>
        <g class="cat-eye"><ellipse class="eyeball" cx="26.4" cy="16.4" rx="2.5" ry="2.5" fill="var(--cat-eye-bg)"/><circle class="cat-pupil" cx="26.4" cy="16.4" r="1.25" fill="var(--cat-pupil)"/></g>
      </g>
      <path class="cat-lid" d="M17.1 16.2 Q19.6 18.6 22.1 16.2" fill="none" stroke="var(--cat-line)" stroke-width="1.1" stroke-linecap="round"/>
      <path class="cat-lid" d="M23.9 16.2 Q26.4 18.6 28.9 16.2" fill="none" stroke="var(--cat-line)" stroke-width="1.1" stroke-linecap="round"/>
      <path class="cat-joy" d="M17.2 17.2 Q19.6 14.8 22 17.2" fill="none" stroke="var(--cat-line)" stroke-width="1.1" stroke-linecap="round"/>
      <path class="cat-joy" d="M24 17.2 Q26.4 14.8 28.8 17.2" fill="none" stroke="var(--cat-line)" stroke-width="1.1" stroke-linecap="round"/>
      <path d="M21.6 20 L24.4 20 L23 22.2 Z" fill="var(--cat-inner)"/>
      <g stroke="var(--cat-line)" stroke-width="0.9" opacity="0.7">
        <line x1="13.5" y1="18.5" x2="7.5" y2="16.5"/>
        <line x1="13.5" y1="20.5" x2="7.5" y2="22.5"/>
        <line x1="32.5" y1="18.5" x2="38.5" y2="16.5"/>
        <line x1="32.5" y1="20.5" x2="38.5" y2="22.5"/>
      </g>
      <g class="acc-collar"><ellipse cx="23" cy="26" rx="5.4" ry="1.7" fill="#e11d48"/><circle cx="23" cy="27.8" r="1.3" fill="#fbbf24"/></g>
      <g class="acc-bow"><path d="M23 25.4 L19 23.6 L19 27.2 Z" fill="#3b82f6"/><path d="M23 25.4 L27 23.6 L27 27.2 Z" fill="#3b82f6"/><rect x="22" y="24.4" width="2" height="2" rx=".5" fill="#1d4ed8"/></g>
      <g class="acc-hat"><ellipse cx="23" cy="9.6" rx="9.2" ry="2" fill="#7c3aed"/><path d="M15 9.6 Q15 2.6 23 2.6 Q31 2.6 31 9.6 Q23 7.8 15 9.6 Z" fill="#7c3aed"/><path d="M23 2.6 Q26 2.8 27.6 4.4 L31 9.6 Q27 8 23 7.8 Z" fill="#9f67ff"/></g>
      <g class="acc-glasses"><circle cx="19.6" cy="16.4" r="3.3" fill="none" stroke="#eab308" stroke-width=".9"/><circle cx="26.4" cy="16.4" r="3.3" fill="none" stroke="#eab308" stroke-width=".9"/><line x1="22.9" y1="16.4" x2="23.1" y2="16.4" stroke="#eab308" stroke-width=".9"/></g>
      <g class="acc-crown"><path d="M14.6 8.2 L16.4 2.9 L19.7 6.3 L23 2.2 L26.3 6.3 L29.6 2.9 L31.4 8.2 Q23 6.6 14.6 8.2 Z" fill="#fbbf24" stroke="#d97706" stroke-width=".5"/><circle cx="23" cy="5.6" r=".8" fill="#ef4444"/></g>
    </svg>`;
}

export function mountCat() {
  // eski loop/dot temizliği
  clearLoops();
  document.getElementById('catMascot')?.remove();
  laserAbort = true;
  const oldDot = document.getElementById('laserDot');
  oldDot?.remove();
  const oldPanel = document.getElementById('catPanel');
  oldPanel?.remove();
  if (!catEnabled()) return;

  const cat = document.createElement('button');
  cat.id = 'catMascot';
  cat.title = t('catMascot');
  cat.innerHTML = catSvgHtml();
  document.body.appendChild(cat);
  cat.classList.add('cat-skin-' + currentSkin());
  applyAccessories();
  updateMood();

  // --- tıklama: quip + miyav
  cat.addEventListener('click', () => {
    interact();
    meow();
    say(quip(isTr() ? QUIPS_TR : QUIPS_EN));
    poke('wiggle');
  });

  // --- çift tık: mini panel
  cat.addEventListener('dblclick', () => { interact(); togglePanel(); });

  // --- basılı tut: okşama (purr + kalpler)
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let heartsSpawned = 0;
  cat.addEventListener('pointerdown', () => {
    interact();
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = setTimeout(() => {
      cat.classList.add('petting');
      purrStart();
      const iv = setInterval(() => {
        heartsSpawned++;
        spawnHeart();
        addAffection(1);
        if (heartsSpawned >= 6) { stopPet(); }
      }, 650);
      pettingIv = iv;
    }, 550);
  });
  const stopPet = () => {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    if (pettingIv) { clearInterval(pettingIv); pettingIv = null; }
    cat.classList.remove('petting');
    purrStop();
  };
  cat.addEventListener('pointerup', stopPet);
  cat.addEventListener('pointerleave', stopPet);
  cat.addEventListener('pointercancel', stopPet);

  // --- gözler fareyi izler
  let rafPending = false;
  window.addEventListener('mousemove', (e) => {
    if ((e.target as HTMLElement)?.closest?.('#catMascot')) return;
    pupilTarget = { x: e.clientX, y: e.clientY };
    if (!rafPending) {
      rafPending = true;
      requestAnimationFrame(() => { rafPending = false; applyPupils(); });
    }
  }, { passive: true });

  startLoops(cat);

  // ilk buluşma quip'i
  setTimeout(() => {
    if (catEnabled() && !document.getElementById('catMascot')) return;
    say(isTr() ? 'Çift tık: menü · Başılı tut: okşa 💗' : 'Double-click: menu · Hold: pet me 💗', 4200);
  }, 1200);
}

let pettingIv: ReturnType<typeof setInterval> | null = null;
let pupilTarget: { x: number; y: number } | null = null;
let laserAbort = false;

function interact() {
  save('catjam:lastInteract', String(Date.now()));
}

// --- loop'lar: blink, mood, gezinti, pomodoro, çocuklu hatırlatma
function startLoops(cat: HTMLElement) {
  // (1) göz kırpma
  moonTimers.push(setInterval(() => {
    if (cat.classList.contains('mood-sleep')) return;
    cat.classList.add('blink');
    setTimeout(() => cat.classList.remove('blink'), 170);
  }, 4200 + Math.random() * 2600));
  // (2) ruh hâli tazele
  moonTimers.push(setInterval(() => updateMood(), 60000));
  // (3) gezinti
  moonTimers.push(setInterval(() => roamTick(cat), 52000));
  // (4) pomodoro saniyesi
  moonTimers.push(setInterval(() => pomoTick(), 1000));
  // (5) "uzun zaman oldu" hatırlatması (günde 1)
  setTimeout(() => nagIfIdle(), 9000);
  moonTimers.push(setInterval(() => nagIfIdle(), 3600000));
  pomoTick();
}

// --- göz bebeği takibi
function applyPupils() {
  const root = document.getElementById('catMascot');
  if (!root) return;
  if (root.classList.contains('mood-sleep')) return;
  let tx = 0, ty = 0;
  if (laserActive || (laserPoint)) {
    tx = laserPoint?.x ?? 0; ty = laserPoint?.y ?? 0;
  } else if (pupilTarget) {
    tx = pupilTarget.x; ty = pupilTarget.y;
  } else return;
  const r = root.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height * 0.4;
  const dx = tx - cx, dy = ty - cy;
  const dist = Math.max(1, Math.hypot(dx, dy));
  const max = 2.1;
  const ox = (dx / dist) * Math.min(max, dist * 0.05);
  const oy = (dy / dist) * Math.min(max, dist * 0.05);
  root.querySelectorAll<SVGCircleElement>('.cat-pupil').forEach((p) => {
    p.setAttribute('transform', `translate(${ox.toFixed(2)} ${oy.toFixed(2)})`);
  });
}

// --- ruh hâli
export function updateMood() {
  const root = document.getElementById('catMascot');
  if (!root) return;
  const now = Date.now();
  const hour = new Date().getHours();
  let mood: 'sleep' | 'happy' | 'lazy' | 'neutral' = 'neutral';
  if (pomoRunning() || hour >= 23 || hour < 7) mood = 'sleep';
  else {
    const last = Number(store('catjam:lastsave') || '0');
    if (last && now - last < 180000) mood = 'happy';
    else if (last && now - last > 12 * 3600000) mood = 'lazy';
  }
  setMood(mood);
}
function setMood(m: 'sleep' | 'happy' | 'lazy' | 'neutral') {
  const root = document.getElementById('catMascot');
  if (!root) return;
  root.classList.remove('mood-sleep', 'mood-happy', 'mood-lazy');
  if (m !== 'neutral') root.classList.add('mood-' + m);
}

// --- kelime tepkileri (autosave sonrası main çağırır)
let lastReact = 0;
let lastXpAward = 0;
export function catKeywordReaction(content: string) {
  const now = Date.now();
  save('catjam:lastsave', String(now));
  if (!catEnabled()) return;
  updateMood();
  if (now - lastXpAward > 25000) {
    lastXpAward = now;
    addAffection(1); // en fazla ~1 puan / 25 sn (yazma çabası)
  }
  if (now - lastReact < 30000) return;
  const rules: { re: RegExp; tr: string; en: string }[] = [
    { re: /\b(kahve|çay|coffee|tea)\b/i, tr: 'Kokusunu aldım! Bir yudum da bana? ☕', en: 'I smell it! One sip for me? ☕' },
    { re: /\b(kedi|cat|kitty)\b/i, tr: 'Beni mi çağırdın? 🐾', en: 'Did somebody call me? 🐾' },
    { re: /\b(bug|hata|error)\b/i, tr: 'O bug\'ı tırmalayıp çıkarsam mı 😾', en: 'Should I scratch that bug out? 😾' },
    { re: /\b(uyku|sleep|dinlenme)\b/i, tr: 'Uyku konusunda uzmanım 💤', en: 'Sleep is my superpower 💤' },
    { re: /\b(pizza|pasta)\b/i, tr: 'Pizzamı yoksa mamamı? İkisi! 🍕', en: 'Pizza or treats? BOTH 🍕' },
    { re: /\b(github|commit|git)\b/i, tr: 'Commit at, sonra mama at 😺', en: 'git commit; git treat 😺' },
  ];
  const head = content.slice(0, 4000);
  for (const r of rules) {
    if (r.re.test(head)) {
      lastReact = now;
      say(isTr() ? r.tr : r.en);
      return;
    }
  }
}

// --- kalpler
function spawnHeart() {
  const root = document.getElementById('catMascot');
  if (!root) return;
  const h = document.createElement('span');
  h.className = 'pet-heart';
  h.textContent = '💗';
  h.style.left = 10 + Math.random() * 26 + 'px';
  root.appendChild(h);
  setTimeout(() => h.remove(), 1000);
}

// --- "uzun zaman oldu" hatırlatması
function nagIfIdle() {
  if (!catEnabled()) return;
  const root = document.getElementById('catMascot');
  if (!root || root.classList.contains('mood-sleep')) return;
  const today = new Date().toDateString();
  if (store('catjam:catnag') === today) return;
  const last = Number(store('catjam:lastsave') || '0');
  if (!last || Date.now() - last <= 12 * 3600000) return;
  save('catjam:catnag', today);
  meow();
  say(quip(isTr() ? NAG_TR : NAG_EN), 4200);
}

// --- Pomodoro: kedi uyur sen çalışırsın; bitince "mama saati"
export function pomoRunning(): boolean {
  const end = Number(store('catjam:pomoEnd') || '0');
  return !!end && end > Date.now();
}
export function pomoStart(min = 25) {
  save('catjam:pomoEnd', String(Date.now() + min * 60000));
  setMood('sleep');
  say(isTr() ? 'Uyuyorum… 25 dk sonra mama saati 🌙' : 'Napping… treat time in 25 min 🌙', 3600);
  pomoTick();
}
export function pomoStop() {
  localStorage.removeItem('catjam:pomoEnd');
  const chip = document.getElementById('catPomoChip');
  if (chip) chip.style.display = 'none';
  updateMood();
}
function pomoTick() {
  const chip = document.getElementById('catPomoChip');
  if (!chip) return;
  const end = Number(store('catjam:pomoEnd') || '0');
  if (!end) { chip.style.display = 'none'; return; }
  const rest = end - Date.now();
  if (rest <= 0) {
    pomoStop();
    setMood('happy');
    meow(); setTimeout(meow, 380);
    say(isTr() ? 'Mama saati! 🍣 Miyav!' : 'Treat time! 🍣 Meow!', 4000);
    poke('happy');
    window.dispatchEvent(new CustomEvent('catjam:pomo-done'));
    return;
  }
  const m = Math.floor(rest / 60000), s = Math.floor((rest % 60000) / 1000);
  chip.textContent = `🍅 ${m}:${String(s).padStart(2, '0')}`;
  chip.style.display = 'block';
}

// --- Laçer oyuncağı
interface P { x: number; y: number }
let laserPoint: P | null = null;
let laserActive = false;
export function laserPlay() {
  if (!catEnabled()) return;
  if (laserActive) return;
  laserActive = true;
  laserAbort = false;
  setMood('neutral');
  say(isTr() ? 'LAZER! Koşuyorum 😻' : 'LASER! Chasing 😻', 2600);
  const dot = document.createElement('div');
  dot.id = 'laserDot';
  document.body.appendChild(dot);
  const hop = (i: number) => {
    if (laserAbort || i >= 7) {
      dot.remove();
      laserActive = false;
      laserPoint = null;
      if (!laserAbort) {
        setMood('happy');
        meow();
        say(quip(isTr() ? ['Yakaladım! 🐾', 'Nerdesin lazer? 😸', 'Bu sefer kaçırdın!'] : ['Gotcha! 🐾', 'Where are you, laser? 😸']), 2600);
        addAffection(3);
        poke('happy');
      }
      return;
    }
    const x = 40 + Math.random() * (window.innerWidth - 80);
    const y = 60 + Math.random() * (window.innerHeight - 120);
    laserPoint = { x, y };
    dot.style.left = x + 'px';
    dot.style.top = y + 'px';
    applyPupils();
    const root = document.getElementById('catMascot');
    if (root) root.classList.toggle('chase', i % 2 === 0);
    setTimeout(() => hop(i + 1), 640);
  };
  hop(0);
}

// --- gezinti
const WAYPOINTS: { r: number; b: number }[] = [
  { r: 16, b: 16 }, { r: 78, b: 26 }, { r: 150, b: 16 }, { r: 16, b: 120 }, { r: 60, b: 90 },
];
let waypointIdx = 0;
function roamTick(cat: HTMLElement) {
  if (window.innerWidth < 900) return;
  const root = cat;
  if (root.classList.contains('petting')) return;
  const lastI = Number(store('catjam:lastInteract') || '0');
  if (Date.now() - lastI < 90000) return;
  if (root.classList.contains('mood-sleep')) return;
  let next = waypointIdx;
  while (next === waypointIdx) next = Math.floor(Math.random() * WAYPOINTS.length);
  waypointIdx = next;
  const w = WAYPOINTS[next];
  root.classList.add('walk');
  root.style.right = w.r + 'px';
  root.style.bottom = w.b + 'px';
  setTimeout(() => root.classList.remove('walk'), 1000);
}

// --- aksesuvar görünürlüğü (seviyeye göre)
function applyAccessories() {
  const root = document.getElementById('catMascot');
  if (!root) return;
  const lv = levelOf(getXp());
  for (let i = 2; i <= 6; i++) root.classList.toggle('acc-' + i, lv >= i);
}
function applySkin() {
  const root = document.getElementById('catMascot');
  if (!root) return;
  const skin = currentSkin();
  for (const s of CAT_SKINS) root.classList.toggle('cat-skin-' + s.id, s.id === skin);
}

// --- pok'lar (main.ts'den çağrılır)
let lastCatWiggle = 0;
export function catAutoWiggle() {
  const now = Date.now();
  if (now - lastCatWiggle < 4000) return;
  lastCatWiggle = now;
  updateMood();
  poke('wiggle');
}
export function poke(kind: 'wiggle' | 'happy' = 'wiggle') {
  if (!catEnabled()) return;
  const cat = document.getElementById('catMascot');
  if (!cat) return;
  cat.classList.remove('wiggle', 'happy');
  void (cat as HTMLElement).offsetWidth; // animasyonu yeniden başlat
  cat.classList.add(kind);
  setTimeout(() => cat.classList.remove(kind), 900);
}
export { poke as catPoke };
export function catSay(text: string, ms = 3000) {
  if (!catEnabled()) return;
  say(text, ms);
}

// --- mini panel (çift tık)
function togglePanel() {
  const existing = document.getElementById('catPanel');
  if (existing) { existing.remove(); return; }
  const lv = levelOf(getXp());
  const xp = getXp();
  const cur = XP_LEVELS[lv - 1] ?? 0;
  const nxt = XP_LEVELS[lv] ?? null;
  const pct = nxt ? Math.min(100, Math.round(((xp - cur) / (nxt - cur)) * 100)) : 100;
  const running = pomoRunning();
  const panel = document.createElement('div');
  panel.id = 'catPanel';
  panel.innerHTML = `
    <div style="font-size:13px;font-weight:600;color:var(--text-h);display:flex;align-items:center;gap:6px;">🐱 ${t('catLevel')} ${lv} <span style="font-size:11px;color:var(--text-muted);font-weight:400;">${xp} ${t('catPoints')}</span></div>
    <div style="height:6px;border-radius:4px;background:var(--bg-soft);border:1px solid var(--border);margin:8px 0 12px;overflow:hidden;">
      <div style="height:100%;width:${pct}%;background:var(--accent);border-radius:4px;"></div>
    </div>
    <div style="display:flex;flex-direction:column;gap:6px;">
      <button class="iconbtn catp" id="catpSuggest" style="width:100%;height:auto;padding:7px 10px;font-size:13px;justify-content:flex-start;">🎲 ${t('catSuggest')}</button>
      <button class="iconbtn catp" id="catpLaser" style="width:100%;height:auto;padding:7px 10px;font-size:13px;justify-content:flex-start;">🔴 ${t('catLaser')}</button>
      <button class="iconbtn catp" id="catpPomo" style="width:100%;height:auto;padding:7px 10px;font-size:13px;justify-content:flex-start;">${running ? '⏹' : '🍅'} ${running ? t('pomoStop') : t('pomoStart')}</button>
    </div>
    <div style="font-size:11px;color:var(--text-muted);margin-top:10px;line-height:1.5;">💗 ${t('catHint')}</div>
  `;
  document.body.appendChild(panel);
  const suggest = panel.querySelector('#catpSuggest') as HTMLButtonElement;
  suggest.addEventListener('click', () => {
    panel.remove();
    suggestNote();
  });
  (panel.querySelector('#catpLaser') as HTMLButtonElement).addEventListener('click', () => { panel.remove(); laserPlay(); });
  (panel.querySelector('#catpPomo') as HTMLButtonElement).addEventListener('click', () => {
    panel.remove();
    if (running) pomoStop(); else pomoStart(25);
  });
  setTimeout(() => {
    const off = (e: MouseEvent) => {
      const tgt = e.target as HTMLElement;
      if (!panel.contains(tgt) && !tgt.closest('#catMascot')) {
        panel.remove();
        document.removeEventListener('click', off);
      }
    };
    document.addEventListener('click', off);
  }, 0);
}

// --- not önerisi: uzun süredir açılmamış rastgele not
function suggestNote() {
  const notes = getState().notes.filter((n) => !n.deletedAt && !n.locked);
  if (!notes.length) return;
  const active = getState().activeId;
  const oldish = notes.filter((n) => n.id !== active && Date.now() - n.updatedAt > 3 * 86400000);
  const pool = oldish.length ? oldish : notes.filter((n) => n.id !== active);
  if (!pool.length) return;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  const btn = document.createElement('button');
  btn.className = 'cat-note-btn';
  btn.textContent = pick.title || 'Untitled';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    window.dispatchEvent(new CustomEvent('catjam:opennote', { detail: { id: pick.id } }));
    addAffection(2);
    say(quip(isTr() ? ['Afiyet olsun 🐾', 'Bunu hep birlikte bulduk!'] : ['Enjoy 🐾', 'We found it together!']), 2200);
  });
  // başlık + butonlu balon
  const b = document.createElement('div');
  b.style.display = 'flex';
  b.style.flexDirection = 'column';
  b.style.gap = '4px';
  const lbl = document.createElement('div');
  lbl.textContent = isTr() ? 'Şunu bir açalım mı?' : 'Shall we open this?';
  b.appendChild(lbl);
  b.appendChild(btn);
  say(b, 8000);
  poke('wiggle');
}
