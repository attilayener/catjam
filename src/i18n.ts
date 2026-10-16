export type Lang = 'en' | 'tr';

const dict: Record<Lang, Record<string, string>> = {
  en: {
    'brand': 'Cat Jam',
    'menu': 'Menu',
    'newNote': 'New note (Ctrl+N)',
    'backlinks': 'Backlinks',
    'graph': 'Graph view',
    'palette': 'Command palette (Ctrl+P)',
    'tasks': 'Tasks',
    'tags': 'Tags',
    'settings': 'Settings',
    'searchPlaceholder': 'Search notes…',
    'emptyNoMatch': 'No matches.',
    'emptyNoNotes': 'No notes yet. Create one.',
    'newNoteBtn': 'Note',
    'dailyNote': 'Daily note',
    'openVault': 'Open vault folder',
    'untitled': 'Untitled',
    'edit': 'Edit',
    'preview': 'Preview',
    'split': 'Split',
    'deleteNote': 'Delete note',
    'props': 'Props',
    'editorPlaceholder': 'Start writing… Use [[Wiki Links]] and #tags',
    'commandPlaceholder': 'Type a command or note name…',
    'newNoteCmd': 'New note',
    'dailyNoteCmd': 'Daily note',
    'toggleGraph': 'Toggle graph view',
    'toggleBacklinks': 'Toggle backlinks',
    'openSettings': 'Settings',
    'modeEdit': 'Switch to edit mode',
    'modePreview': 'Switch to preview mode',
    'modeSplit': 'Switch to split mode',
    'settingsTitle': 'Settings',
    'theme': 'Theme',
    'fontSize': 'Font size',
    'language': 'Language',
    'close': 'Close',
    'tasksTitle': 'Tasks',
    'all': 'All',
    'active': 'Active',
    'done': 'Done',
    'noTasks': 'No tasks.',
    'tagsTitle': 'Tags',
    'noTags': 'No tags found.',
    'backlinksTitle': 'Backlinks',
    'outgoing': 'Outgoing links',
    'outline': 'Outline',
    'currentTags': 'Tags',
    'none': 'None',
    'propsTitle': 'Properties',
    'addProperty': 'Add property (prompt)',
    'welcome': 'Welcome',
    'deleteConfirm': 'Delete "{title}"?',
    'dropHint': 'Drop file to insert into note',
    'favorites': 'Favorites',
    'favoriteToggle': 'Toggle favorite',
  },
  tr: {
    'brand': 'Cat Jam',
    'menu': 'Menü',
    'newNote': 'Yeni not (Ctrl+N)',
    'backlinks': 'Geri bağlantılar',
    'graph': 'Graf görünümü',
    'palette': 'Komut paleti (Ctrl+P)',
    'tasks': 'Görevler',
    'tags': 'Etiketler',
    'settings': 'Ayarlar',
    'searchPlaceholder': 'Notlarda ara…',
    'emptyNoMatch': 'Eşleşme yok.',
    'emptyNoNotes': 'Henüz not yok. Bir tane oluştur.',
    'newNoteBtn': 'Not',
    'dailyNote': 'Günlük not',
    'openVault': 'Vault klasörü aç',
    'untitled': 'Başlıksız',
    'edit': 'Düzenle',
    'preview': 'Önizleme',
    'split': 'Bölünmüş',
    'deleteNote': 'Notu sil',
    'props': 'Özellikler',
    'editorPlaceholder': 'Yazmaya başla… [[Wiki Links]] ve #etiket kullan',
    'commandPlaceholder': 'Komut veya not adı yaz…',
    'newNoteCmd': 'Yeni not',
    'dailyNoteCmd': 'Günlük not',
    'toggleGraph': 'Graf görünümünü aç/kapat',
    'toggleBacklinks': 'Geri bağlantıları aç/kapat',
    'openSettings': 'Ayarlar',
    'modeEdit': 'Düzenleme moduna geç',
    'modePreview': 'Önizleme moduna geç',
    'modeSplit': 'Bölünmüş moda geç',
    'settingsTitle': 'Ayarlar',
    'theme': 'Tema',
    'fontSize': 'Yazı boyutu',
    'language': 'Dil',
    'close': 'Kapat',
    'tasksTitle': 'Görevler',
    'all': 'Tümü',
    'active': 'Aktif',
    'done': 'Tamamlanan',
    'noTasks': 'Görev yok.',
    'tagsTitle': 'Etiketler',
    'noTags': 'Etiket bulunamadı.',
    'backlinksTitle': 'Geri bağlantılar',
    'outgoing': 'Giden bağlantılar',
    'outline': 'Taslak',
    'currentTags': 'Etiketler',
    'none': 'Yok',
    'propsTitle': 'Özellikler',
    'addProperty': 'Özellik ekle',
    'welcome': 'Hoş geldin',
    'deleteConfirm': '"{title}" silinsin mi?',
    'dropHint': 'Dosyayı buraya bırak (nota ekle)',
    'favorites': 'Favoriler',
    'favoriteToggle': 'Favorilere ekle/çıkar',
  },
};

let current: Lang = 'tr';

export function setLanguage(lang: Lang) {
  current = lang;
}

export function getLanguage(): Lang {
  return current;
}

export function t(key: string, vars?: Record<string, string>): string {
  let s = dict[current][key] ?? dict.en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
  }
  return s;
}

export function availableLanguages(): { id: Lang; label: string }[] {
  return [
    { id: 'en', label: 'English' },
    { id: 'tr', label: 'Türkçe' },
  ];
}
