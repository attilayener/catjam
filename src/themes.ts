export interface Theme {
  id: string;
  name: string;
  description: string;
  vars: Record<string, string>;
  dark?: boolean;
  /** Tema aktifken eklenip, diğer temaya geçince sökülen serbest CSS */
  extraCss?: string;
}

export const THEMES: Theme[] = [
  {
    id: 'minimal-light',
    name: 'Minimal Light',
    description: 'Sade, açık tonlar',
    dark: false,
    vars: {
      '--bg': '#fafafa',
      '--bg-soft': '#f1f1f1',
      '--panel': '#ffffff',
      '--text': '#374151',
      '--text-muted': '#6b7280',
      '--text-h': '#111827',
      '--border': '#e5e7eb',
      '--accent': '#2563eb',
      '--accent-soft': 'rgba(37,99,235,0.1)',
      '--code-bg': '#f3f4f6',
      '--shadow': 'rgba(0,0,0,0.06) 0 4px 12px -2px',
      '--sans': "system-ui, 'Segoe UI', Roboto, sans-serif",
      '--mono': "ui-monospace, Consolas, monospace",
      '--sidebar-bg': '#f7f7f8',
    },
  },
  {
    id: 'minimal-dark',
    name: 'Minimal Dark',
    description: 'Sade, koyu tonlar',
    dark: true,
    vars: {
      '--bg': '#111214',
      '--bg-soft': '#16171a',
      '--panel': '#1b1c20',
      '--text': '#cbd5e1',
      '--text-muted': '#94a3b8',
      '--text-h': '#f1f5f9',
      '--border': '#2a2b30',
      '--accent': '#60a5fa',
      '--accent-soft': 'rgba(96,165,250,0.12)',
      '--code-bg': '#202126',
      '--shadow': 'rgba(0,0,0,0.4) 0 4px 12px -2px',
      '--sans': "system-ui, 'Segoe UI', Roboto, sans-serif",
      '--mono': "ui-monospace, Consolas, monospace",
      '--sidebar-bg': '#0e0f11',
    },
  },
  {
    id: 'sepia',
    name: 'Sepia',
    description: 'Kitap hissi veren sıcak tonlar',
    dark: false,
    vars: {
      '--bg': '#f4ecd8',
      '--bg-soft': '#efe4c8',
      '--panel': '#faf3e0',
      '--text': '#5b4636',
      '--text-muted': '#8a6f5a',
      '--text-h': '#3e2a1f',
      '--border': '#d9c9a3',
      '--accent': '#b45309',
      '--accent-soft': 'rgba(180,83,9,0.12)',
      '--code-bg': '#eadfc2',
      '--shadow': 'rgba(90,60,30,0.15) 0 4px 12px -2px',
      '--sans': "Georgia, 'Times New Roman', serif",
      '--mono': "ui-monospace, Consolas, monospace",
      '--sidebar-bg': '#efe4cb',
    },
  },
  {
    id: 'ocean',
    name: 'Ocean',
    description: 'Serin mavi-yeşil estetik',
    dark: true,
    vars: {
      '--bg': '#0b1a24',
      '--bg-soft': '#102330',
      '--panel': '#132a3a',
      '--text': '#cfe8f2',
      '--text-muted': '#9fb8c6',
      '--text-h': '#e6f6fd',
      '--border': '#1f3a4b',
      '--accent': '#34d399',
      '--accent-soft': 'rgba(52,211,153,0.12)',
      '--code-bg': '#0e202c',
      '--shadow': 'rgba(0,20,40,0.5) 0 4px 12px -2px',
      '--sans': "system-ui, 'Segoe UI', Roboto, sans-serif",
      '--mono': "ui-monospace, Consolas, monospace",
      '--sidebar-bg': '#08141c',
    },
  },
  {
    id: 'nord',
    name: 'Nord',
    description: 'Pastel nordik aurora',
    dark: true,
    vars: {
      '--bg': '#2e3440',
      '--bg-soft': '#3b4252',
      '--panel': '#434c5e',
      '--text': '#d8dee9',
      '--text-muted': '#aeb6c4',
      '--text-h': '#eceff4',
      '--border': '#4c566a',
      '--accent': '#88c0d0',
      '--accent-soft': 'rgba(136,192,208,0.15)',
      '--code-bg': '#3b4252',
      '--shadow': 'rgba(0,0,0,0.4) 0 4px 12px -2px',
      '--sans': "system-ui, 'Segoe UI', Roboto, sans-serif",
      '--mono': "ui-monospace, Consolas, monospace",
      '--sidebar-bg': '#242933',
    },
  },
  {
    id: 'frostpunk',
    name: 'Frostpunk',
    description: 'Jeneratör kontrastı: kömür katranı zemin + ocak turuncusu',
    dark: true,
    vars: {
      '--bg': '#101417',
      '--bg-soft': '#171c1f',
      '--panel': '#1d2326',
      '--text': '#d8d5c9',
      '--text-muted': '#858b8a',
      '--text-h': '#f0e9d8',
      '--border': '#3b4244',
      '--accent': '#d66a2c',
      '--accent-soft': 'rgba(214,106,44,0.15)',
      '--code-bg': '#0b0e10',
      '--shadow': 'rgba(0,0,0,0.4) 0 4px 12px -2px',
      '--sans': "system-ui, 'Segoe UI', Roboto, sans-serif",
      '--mono': "ui-monospace, Consolas, monospace",
      '--sidebar-bg': '#0e1315',
    },
    extraCss: FROSTPUNK_CSS(),
  },
];

export function applyTheme(id: string) {
  const t = THEMES.find((x) => x.id === id) ?? THEMES[0];
  lastThemeId = t.id;
  const root = document.documentElement;
  // Özel CSS kazanan mı? — evetse tema değişkenleri ve ek temasal CSS tamamen pasif
  if (deferToCustom) {
    for (const k of Object.keys(t.vars)) root.style.removeProperty(k);
    document.getElementById('themeExtra')?.remove();
    root.dataset.theme = 'custom';
    root.dataset.mode = 'custom';
    document.body.classList.remove('dark');
    return;
  }
  for (const [k, v] of Object.entries(t.vars)) root.style.setProperty(k, v);
  root.dataset.theme = t.id;
  root.dataset.mode = t.dark ? 'dark' : 'light';
  document.body.classList.toggle('dark', !!t.dark);
  // ek temasal CSS: aktif temaya özel katman (diğerine geçince sökülür)
  let el = document.getElementById('themeExtra') as HTMLStyleElement | null;
  if (!t.extraCss) { el?.remove(); return; }
  if (!el) { el = document.createElement('style'); el.id = 'themeExtra'; document.head.appendChild(el); }
  el.textContent = t.extraCss;
}

// ---- 🌗 Özel CSS baskınlığı: alan doluyken tema pasif ----
let deferToCustom = false;
let lastThemeId = 'minimal-dark';
export function setCustomOverride(on: boolean) {
  deferToCustom = on;
  applyTheme(lastThemeId); // pasifleştir (inline değişkenleri ve ek katmanı söner)
}
export function customOverrideActive(): boolean { return deferToCustom; }
export function currentThemeId(): string { return lastThemeId; }

export function getTheme(id: string) {
  return THEMES.find((x) => x.id === id) ?? THEMES[0];
}

// ===================== FROSTPUNK katmanı =====================
function FROSTPUNK_CSS(): string { return `
/* Frostpunk — atmosfer */
body {
  background:
    linear-gradient(rgba(10, 13, 15, 0.92), rgba(10, 13, 15, 0.96)),
    #101417;
  color: var(--text);
}
/* paneller */
.panel, .modal, .note-item {
  background: linear-gradient(145deg, #202629, #161b1e);
  border: 1px solid var(--border);
  box-shadow: inset 0 1px rgba(255,255,255,0.025), 0 6px 20px rgba(0,0,0,0.35);
}
/* başlıklar */
h1, h2, h3, h4 {
  color: var(--text-h);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
/* vurgu */
.accent, .iconbtn:hover { color: #f08a3c; }
/* ikon butonları — jeneratör hissi */
.iconbtn {
  color: var(--text-muted);
  background: #151a1c;
  border: 1px solid #343b3d;
  transition: color 0.2s ease, background 0.2s ease, border-color 0.2s ease;
}
.iconbtn:hover {
  background: #252b2d;
  border-color: #a94f26;
  box-shadow: 0 0 10px rgba(214,106,44,0.15);
}
/* notlar */
.note-item {
  color: var(--text);
  border-left: 3px solid #41494b;
  transition: background 0.2s ease, border-color 0.2s ease;
}
.note-item:hover {
  background: #252b2d;
  border-left-color: var(--accent);
}
/* callout */
.callout {
  background: linear-gradient(135deg, #252a2c, #171c1f);
  border: 1px solid #4a5051;
  border-left: 4px solid var(--accent);
  color: var(--text);
  box-shadow: inset 0 0 25px rgba(0,0,0,0.18);
}
/* modal */
.modal {
  background: linear-gradient(145deg, #252b2e, #151a1d);
  border: 1px solid #51585a;
  box-shadow: 0 20px 60px rgba(0,0,0,0.65), inset 0 1px rgba(255,255,255,0.04);
}
/* kod alanı */
pre, code {
  background: var(--code-bg);
  color: #c5c9c5;
  border: 1px solid #292f31;
}
/* linkler */
a { color: #d9793a; }
a:hover { color: #f19a52; }
/* seçili metin */
::selection {
  background: rgba(214,106,44,0.35);
  color: #ffffff;
}
/* kaydırma çubuğu */
::-webkit-scrollbar { width: 8px; }
::-webkit-scrollbar-track { background: #0d1113; }
::-webkit-scrollbar-thumb { background: #41484a; border: 2px solid #0d1113; }
::-webkit-scrollbar-thumb:hover { background: #a75a32; }
/* jeneratör efekti */
.generator {
  background: radial-gradient(circle, rgba(214,106,44,0.22), transparent 65%);
  border-color: #8c492a;
  box-shadow: 0 0 25px rgba(214,106,44,0.15);
}
/* donmuş / devre dışı */
.disabled, .muted { color: #626a6b; opacity: 0.65; }
/* buz vurgusu */
.ice, .secondary { color: #91b8c2; }
/* uyarı */
.warning { color: #e59b54; border-left: 3px solid #d66a2c; }
/* tehlike */
.danger { color: #c95b4c; border-left: 3px solid #9f3f35; }
/* hayatta kalma durumu */
.survival { color: #cfd5d2; background: #151a1c; border: 1px solid #394143; }
/* sıcak / soğuk geçişi */
.warm { color: #e17b3d; }
.cold { color: #8eafb7; }
`;
}
