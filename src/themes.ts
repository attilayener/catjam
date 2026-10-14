export interface Theme {
  id: string;
  name: string;
  description: string;
  vars: Record<string, string>;
  dark?: boolean;
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
];

export function applyTheme(id: string) {
  const t = THEMES.find((x) => x.id === id) ?? THEMES[0];
  const root = document.documentElement;
  for (const [k, v] of Object.entries(t.vars)) root.style.setProperty(k, v);
  root.dataset.theme = t.id;
  root.dataset.mode = t.dark ? 'dark' : 'light';
  document.body.classList.toggle('dark', !!t.dark);
}
export function getTheme(id: string) {
  return THEMES.find((x) => x.id === id) ?? THEMES[0];
}
