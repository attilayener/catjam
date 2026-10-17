import './style.css';
import katexCss from 'katex/dist/katex.min.css?inline';
import { initStore, getState, subscribe, createNote, updateNote, deleteNote, restoreNote, deletedNotes, setActive, setSearch, setTheme, setEditorMode, getActiveNote, backlinksOf, findNoteByTitle, filteredNotes, openVault, setLanguage, reorderNotes } from './store';
import { renderMarkdown, extractWikiLinks, extractTags } from './markdown';
import { THEMES } from './themes';
import { saveSetting, db } from './db';
import { t, availableLanguages, getLanguage } from './i18n';
import { saveImage, loadImages } from './images';
import { getVaultHandle, ensureVaultPermission, saveImageToVault, uniqueVaultPath, createVaultNote, loadVaultImages } from './vault';
import { initWhisperLocal, transcribeBlob, whisperReadyFor, whisperCached, whisperSupported, deleteWhisperModel, WHISPER_MODELS as WHISPER_MODEL_META } from './voice';
import { encryptText, decryptText } from './secure';
import { startAmbient, stopAmbient, setAmbientVolume, ambientOn } from './ambient';
import { mountCat, catPoke, catAutoWiggle, catEnabled, setCatEnabled, setCatSkin, setCatSound, catKeywordReaction, catSay, CAT_SKINS } from './cat';

const LOCKED_PLACEHOLDER = '[🔒 Encrypted — Cat Jam]';

// ---------- Not kilidi (E2EE) ----------
const unlockedSet = new Set<string>(); // bu oturumda kilidi açılmış not id'leri (plaintext yalnız bellekte)

function noteLocked(n: any): boolean {
  return !!n?.locked && !!n?.lockData;
}

async function lockCurrentNote() {
  const n = getActiveNote();
  if (!n || noteLocked(n)) return;
  const ta = document.getElementById('editorTextarea') as HTMLTextAreaElement;
  const pass = prompt(t('setPasswordPrompt'));
  if (!pass) return;
  const again = prompt(t('passwordAgain'));
  if (again === null) return;
  if (again !== pass) { alert(t('wrongPass')); return; }
  const hint = prompt(t('lockNote') + ' — hint (opsiyonel)') || undefined;
  const plain = ta?.value ?? n.content;
  if (!plain.trim()) { alert('Boş not şifrelenmez.'); return; }
  const lockData = await encryptText(pass, plain);
  if (hint) (lockData as { hint?: string }).hint = hint;
  clearTimeout(saveTimer); // bekleyen otosave plaintext yazmasın
  unlockedSet.delete(n.id);
  await updateNote(n.id, { content: LOCKED_PLACEHOLDER, locked: true, lockData });
  renderAll();
  showToast('🔒 ' + t('lockedTitle'));
}

async function toggleLockButton() {
  const n = getActiveNote();
  if (!n) return;
  if (noteLocked(n)) {
    if (unlockedSet.has(n.id)) {
      unlockedSet.delete(n.id);
      (n as any).content = LOCKED_PLACEHOLDER; // bellekteki plaintext'i gizle
      renderAll();
    } else {
      // kilitliyken tıklandı → kartın parola alanına odak
      (document.getElementById('lockPass') as HTMLInputElement | null)?.focus();
    }
    return;
  }
  await lockCurrentNote();
}

async function resolveSimpleUnlock() {
  const n = getActiveNote();
  if (!n || !noteLocked(n)) return;
  const input = document.getElementById('lockPass') as HTMLInputElement | null;
  const err = document.getElementById('lockErr');
  const pass = input?.value ?? '';
  if (!pass) return;
  try {
    const plain = await decryptText(pass, n.lockData!);
    if (err) err.textContent = '';
    unlockedSet.add(n.id);
    (n as any).content = plain; // yalnız bellek: DB hâlâ şifreli placeholder
    renderAll();
    showToast('🔓 ' + t('unlockBtn') + ' — ' + t('readonlyLock'));
  } catch {
    if (err) err.textContent = t('wrongPass');
  }
}

function isEditorLocked(n: any): boolean {
  return noteLocked(n) && !unlockedSet.has(n.id);
}

let saveTimer: any = null;
let propsTimer: any = null;
let suggestState: { triggerStart: number; items: { label: string; insert: string }[]; index: number; type: 'wiki' | 'tag' | 'slash' } | null = null;
let groupByFolder = false;
let lastViewedId: string | null = null;
let recentNoteIds: string[] = [];
let favorites: string[] = [];
let voiceEngine: 'webspeech' | 'whisper' = 'webspeech';
let whisperModelKey: 'tiny' | 'base' | 'small' = 'base';
let editorFontProfile: 'sans' | 'serif' | 'mono' = 'mono';
let customCss = '';

// cat ayarları hızlı yardımcıları
function isTr(): boolean { return getState().settings.language === 'tr'; }
function catSkinCurrent(): string { return localStorage.getItem('catjam:catskin') || 'orange'; }
function catSoundCurrent(): boolean { return localStorage.getItem('catjam:catsound') !== '0'; }

function applyCustomCss(css: string) {
  let el = document.getElementById('catjamCustomCss') as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = 'catjamCustomCss';
    document.head.appendChild(el);
  }
  el.textContent = css || '';
  customCss = css;
}

function applyEditorFont(profile: 'sans' | 'serif' | 'mono') {
  const fonts: Record<string, string> = {
    sans: `system-ui, 'Segoe UI', Roboto, sans-serif`,
    serif: `Georgia, 'Iowan Old Style', 'Times New Roman', serif`,
    mono: `ui-monospace, Consolas, 'Cascadia Mono', monospace`,
  };
  document.documentElement.style.setProperty('--editor-font', fonts[profile] ?? fonts.mono);
}
try { recentNoteIds = JSON.parse(localStorage.getItem('catjam:recent') || '[]'); } catch { recentNoteIds = []; }
function markRecent(id: string) {
  recentNoteIds = [id, ...recentNoteIds.filter((x) => x !== id)].slice(0, 12);
  localStorage.setItem('catjam:recent', JSON.stringify(recentNoteIds));
}
let currentView: 'editor' | 'graph' = 'editor';


const app = document.querySelector<HTMLDivElement>('#app')!;

function buildShell() {
  app.innerHTML = '';
  const tb = document.createElement('div');
  tb.className = 'topbar';
  tb.innerHTML = `
    <button class="iconbtn" id="hamburger" title="${t('menu')}">☰</button>
    <span class="brand">${t('brand')}</span>
    <div class="spacer"></div>
    <button class="iconbtn" id="btnNew" title="${t('newNote')}">＋</button>
    <button class="iconbtn" id="btnBacklinks" title="${t('backlinks')}">↔</button>
    <button class="iconbtn" id="btnGraph" title="${t('graph')}">⬢</button>
    <button class="iconbtn" id="btnPalette" title="${t('palette')}">⌘</button>
    <button class="iconbtn" id="btnTasks" title="${t('tasks')}">☑</button>
    <button class="iconbtn" id="btnTags" title="${t('tags')}">#</button>
    <button class="iconbtn" id="btnTemplates" title="Templates">📋</button>
    <button class="iconbtn" id="btnFocus" title="Focus mode">🎯</button>
    <button class="iconbtn" id="btnAmbient" title="${t('ambient')}">🎧</button>
    <button class="iconbtn" id="btnSettings" title="${t('settings')}">⚙</button>
  `;
  app.appendChild(tb);

  // sidebar backdrop (mobile)
  const backdrop = document.createElement('div');
  backdrop.className = 'sidebar-backdrop';
  backdrop.id = 'sidebarBackdrop';
  app.appendChild(backdrop);

  const exitFocus = document.createElement('button');
  exitFocus.id = 'exitFocus';
  exitFocus.className = 'iconbtn';
  exitFocus.textContent = '✕ Exit focus';
  app.appendChild(exitFocus);

  // layout
  const layout = document.createElement('div');
  layout.className = 'layout';

  // sidebar
  const sidebar = document.createElement('div');
  sidebar.className = 'sidebar';
  sidebar.id = 'sidebar';
  sidebar.innerHTML = `
    <div class="sidebar-head">
      <input class="search-input" id="searchInput" placeholder="${t('searchPlaceholder')}" />
      <button class="iconbtn" id="btnGroupFolders" title="Group by folder">📂</button>
    </div>
    <div class="note-list" id="noteList"></div>
    <div class="sidebar-foot">
      <button class="iconbtn" id="btnSidebarNew" title="${t('newNoteBtn')}">＋ ${t('newNoteBtn')}</button>
      <button class="iconbtn" id="btnSidebarDaily" title="${t('dailyNote')}">📅 ${t('dailyNote')}</button>
      <button class="iconbtn" id="btnOpenVault" title="${t('openVault')}">📁 ${t('openVault')}</button>
      <button class="iconbtn" id="btnExport" title="Export">⬇ Export</button>
      <button class="iconbtn" id="btnImport" title="Import">⬆ Import</button>
      <button class="iconbtn" id="btnImportRoam" title="Import Roam JSON">Roam</button>
      <button class="iconbtn" id="btnTrash" title="${t('trash')}">🗑 ${t('trash')}</button>
      <button class="iconbtn" id="btnShareHtml" title="${t('shareHtml')}">🌐 ${t('shareHtml')}</button>
      <button class="iconbtn" id="btnWeekly" title="${t('weeklyReport')}">📊 ${t('weeklyReport')}</button>
    </div>
  `;

  // main
  const main = document.createElement('div');
  main.className = 'main';
  main.innerHTML = `
    <div class="editor-header" id="editorHeader">
      <input class="title-input" id="titleInput" placeholder="${t('untitled')}" />
      <span class="reading-time" id="readingTime"></span>
      <div class="mode-toggle" id="modeToggle">
        <button data-mode="edit">${t('edit')}</button>
        <button data-mode="preview">${t('preview')}</button>
        <button data-mode="split">${t('split')}</button>
      </div>
      <button class="iconbtn" id="btnLock" title="${t('lockNote')}">🔒</button>
      <button class="iconbtn" id="btnVoice" title="${t('voiceTyping')}">🎙</button>
      <button class="iconbtn" id="btnStar" title="${t('favoriteToggle')}">☆</button>
      <button class="iconbtn" id="btnDelete" title="${t('deleteNote')}">🗑</button>
      <button class="iconbtn" id="btnProps" title="${t('props')}" style="width:auto;padding:4px 8px;font-size:12px;">${t('props')}</button>
      <button class="iconbtn" id="btnHistory" title="History" style="width:auto;padding:4px 8px;font-size:12px;">History</button>
    </div>
    <div id="propsPanel" style="display:none;padding:8px 12px;border-bottom:1px solid var(--border);background:var(--panel);"></div>
    <div class="editor-body" id="editorBody">
      <div class="editor-pane" id="editorPane" style="position:relative;">
        <textarea class="editor-textarea" id="editorTextarea" placeholder="${t('editorPlaceholder')}"></textarea>
        <div id="suggestBox" class="suggest-box" style="display:none;"></div>
      </div>
      <div class="preview-pane" id="previewPane">
        <div class="markdown" id="previewContent"></div>
      </div>
      <div class="lock-card" id="lockCard" style="display:none;">
        <div class="lock-emoji">🔒</div>
        <div class="lock-title">${t('lockedTitle')}</div>
        <div id="lockHint" style="font-size:12px;color:var(--text-muted);margin-bottom:10px;"></div>
        <input type="password" class="search-input" id="lockPass" style="text-align:center;max-width:260px;" placeholder="••••••" />
        <div id="lockErr" style="color:#ef4444;font-size:12px;min-height:16px;margin-top:4px;"></div>
        <button class="iconbtn" id="lockUnlock" style="width:auto;padding:8px 18px;font-size:13px;background:var(--accent-soft);border-color:var(--accent);color:var(--accent);">🔓 ${t('unlockBtn')}</button>
      </div>
    </div>
    <div class="graph-wrap" id="graphWrap" style="display:none;">
      <div class="graph-toolbar">
        <button id="graphFit">Fit</button>
        <button id="graphBack">Back to editor</button>
      </div>
      <canvas id="graphCanvas"></canvas>
    </div>
  `;

  layout.appendChild(sidebar);
  layout.appendChild(main);
  app.appendChild(layout);

  // side panel for backlinks
  const side = document.createElement('div');
  side.className = 'side-panel';
  side.id = 'sidePanel';
  side.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
      <h3 style="margin-top:0;">${t('backlinksTitle')}</h3>
      <button class="iconbtn" id="closeSidePanel" title="${t('close')}">✕</button>
    </div>
    <div id="backlinksList"></div>
    <h3 style="margin-top:16px;">${t('outline')}</h3>
    <div id="outlineList"></div>
    <h3 style="margin-top:16px;">${t('outgoing')}</h3>
    <div id="outgoingList"></div>
    <h3 style="margin-top:16px;">${t('currentTags')}</h3>
    <div id="tagsList"></div>
    <h3 style="margin-top:16px;">${t('unlinkedRefs')}</h3>
    <div id="unlinkedList"></div>
  `;
  app.appendChild(side);

  const overlay = document.createElement('div');
  overlay.id = 'dropOverlay';
  overlay.className = 'drop-overlay';
  overlay.innerHTML = `<div>${t('dropHint')}</div>`;
  overlay.style.display = 'none';
  app.appendChild(overlay);

  // sesli yazım durum pill'i (alt-orta)
  const voiceStatus = document.createElement('div');
  voiceStatus.id = 'voiceStatus';
  document.body.appendChild(voiceStatus);

  mountCat();
  bindEvents();
}

let graphAnimId: number | null = null;
let graphNodes: any[] = [];
let graphEdges: any[] = [];

function bindEvents() {
  document.getElementById('hamburger')!.addEventListener('click', () => toggleSidebar(true));
  document.getElementById('sidebarBackdrop')!.addEventListener('click', () => toggleSidebar(false));
  document.getElementById('btnNew')!.addEventListener('click', () => newNoteAndRender());
  document.getElementById('btnSidebarNew')!.addEventListener('click', () => newNoteAndRender());
  document.getElementById('btnSidebarDaily')!.addEventListener('click', () => dailyNote());
  document.getElementById('btnOpenVault')!.addEventListener('click', async () => {
    const ok = await openVault();
    if (ok) renderAll(); else alert('Vault açılamadı veya iptal edildi.');
  });
  document.getElementById('btnExport')!.addEventListener('click', async () => {
    const payload = { notes: await db.notes.toArray(), images: await db.images.toArray(), exportedAt: Date.now() };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `catjam-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  document.getElementById('btnImport')!.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (Array.isArray(data.notes)) await db.notes.bulkPut(data.notes);
        if (Array.isArray(data.images)) await db.images.bulkPut(data.images);
        await loadImages();
        await initStore();
        renderAll();
        alert('Import completed.');
      } catch (e) {
        alert('Import failed: ' + (e as Error).message);
      }
    };
    input.click();
  });
  document.getElementById('btnImportRoam')!.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try { await importRoamJson(file); alert('Roam import completed.'); }
      catch (e) { alert('Roam import failed: ' + (e as Error).message); }
    };
    input.click();
  });
  document.getElementById('btnTrash')!.addEventListener('click', () => openTrashModal());
  document.getElementById('btnShareHtml')!.addEventListener('click', () => { void exportCurrentNoteHtml(); });
  document.getElementById('btnWeekly')!.addEventListener('click', () => { void openWeeklyReport(); });
  document.getElementById('btnBacklinks')!.addEventListener('click', () => toggleSidePanel());
  document.getElementById('closeSidePanel')!.addEventListener('click', () => toggleSidePanel());
  document.getElementById('btnGraph')!.addEventListener('click', () => showGraph());
  document.getElementById('btnPalette')!.addEventListener('click', () => openCommandPalette());
  document.getElementById('btnTasks')!.addEventListener('click', () => openTasksModal());
  document.getElementById('btnTags')!.addEventListener('click', () => openTagsModal());
  document.getElementById('btnGroupFolders')!.addEventListener('click', () => { groupByFolder = !groupByFolder; renderNoteList(); });
  document.getElementById('btnTemplates')!.addEventListener('click', () => openTemplatesModal());
  document.getElementById('btnFocus')!.addEventListener('click', () => document.body.classList.toggle('focus-mode'));
  document.getElementById('exitFocus')!.addEventListener('click', () => document.body.classList.remove('focus-mode'));
  document.getElementById('btnSettings')!.addEventListener('click', () => openSettings());
  document.getElementById('btnAmbient')!.addEventListener('click', () => toggleAmbientPopover());
  document.getElementById('btnLock')!.addEventListener('click', () => { void toggleLockButton(); });
  const lockUnlockBtn = document.getElementById('lockUnlock')!;
  lockUnlockBtn.addEventListener('click', () => { void resolveSimpleUnlock(); });
  const lockPass = document.getElementById('lockPass') as HTMLInputElement | null;
  lockPass?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { void resolveSimpleUnlock(); } });
  // Sesli yazım: seçili motora göre çalış (bulut Web Speech / yerel Whisper)
  const voiceBtn = document.getElementById('btnVoice') as HTMLButtonElement;
  voiceBtn.addEventListener('click', () => onMicClick(voiceBtn));
  document.getElementById('btnStar')!.addEventListener('click', async () => {
    const n = getActiveNote(); if (!n) return;
    favorites = favorites.includes(n.id) ? favorites.filter((x) => x !== n.id) : [n.id, ...favorites];
    await saveSetting('favorites', favorites);
    renderEditor();
    renderNoteList();
  });
  document.getElementById('btnDelete')!.addEventListener('click', async () => {
    const n = getActiveNote(); if (!n) return;
    if (!confirm(`Delete "${n.title}"?`)) return;
    const noteId = n.id, title = n.title;
    await deleteNote(noteId);
    renderAll();
    undoToast(noteId, title);
  });
  document.getElementById('btnProps')!.addEventListener('click', () => {
    const p = document.getElementById('propsPanel')!;
    if (p.style.display === 'none') { p.style.display = ''; renderProps(); }
    else p.style.display = 'none';
  });
  document.getElementById('btnHistory')!.addEventListener('click', () => openVersionsModal());
  // expose command helper
  (window as any).__addBlockId = () => addBlockIdToCurrentLine();

  const searchInput = document.getElementById('searchInput') as HTMLInputElement;
  searchInput.addEventListener('input', () => { setSearch(searchInput.value); renderNoteList(); });

  const titleInput = document.getElementById('titleInput') as HTMLInputElement;
  titleInput.addEventListener('input', () => {
    const n = getActiveNote(); if (!n) return;
    if (titleInput.readOnly) return; // kilitli not: başlık değişmez
    // debounce
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => updateNote(n.id, { title: titleInput.value }), 400);
  });
  titleInput.addEventListener('blur', () => {
    const n = getActiveNote(); if (!n) return;
    if (titleInput.readOnly) return;
    updateNote(n.id, { title: titleInput.value });
  });

  const editorTextarea = document.getElementById('editorTextarea') as HTMLTextAreaElement;
  editorTextarea.addEventListener('input', () => {
    const n = getActiveNote(); if (!n) return;
    if (editorTextarea.readOnly) return; // kilitli not: DB'ye plaintext yazılmaz
    clearTimeout(saveTimer);
    const beforeWords = countWords(n.content);
    const noteId = n.id;
    saveTimer = setTimeout(async () => {
      await updateNote(noteId, { content: editorTextarea.value });
      catKeywordReaction(editorTextarea.value);
      const delta = countWords(editorTextarea.value) - beforeWords;
      if (delta > 0) trackDailyWords(delta);
      maybeCelebrateGoal();
    }, 500);
    updatePreview(editorTextarea.value);
    updateSuggestions();
  });
  editorTextarea.addEventListener('keyup', updateSuggestions);
  editorTextarea.addEventListener('click', updateSuggestions);
  editorTextarea.addEventListener('keydown', (e) => {
    const box = document.getElementById('suggestBox');
    const suggestVisible = !!suggestState && !!box && box.style.display !== 'none';
    if (suggestVisible) {
      const items = suggestState!.items;
      if (e.key === 'ArrowDown') { e.preventDefault(); suggestState!.index = (suggestState!.index + 1) % items.length; highlightSuggestion(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); suggestState!.index = (suggestState!.index - 1 + items.length) % items.length; highlightSuggestion(); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); acceptSuggestion(); return; }
      if (e.key === 'Escape') { hideSuggestions(); return; }
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = editorTextarea;
      const start = ta.selectionStart, end = ta.selectionEnd;
      const value = ta.value;
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      const lineEndIdx = value.indexOf('\n', end);
      const actualEnd = lineEndIdx === -1 ? value.length : lineEndIdx;
      const block = value.slice(lineStart, actualEnd);
      let newBlock: string;
      if (e.shiftKey) {
        newBlock = block.replace(/^  /gm, '').replace(/^ /gm, '');
      } else {
        newBlock = block.replace(/^/gm, '  ');
      }
      ta.value = value.slice(0, lineStart) + newBlock + value.slice(actualEnd);
      const delta = newBlock.length - block.length;
      ta.selectionStart = start + (e.shiftKey ? 0 : 2);
      ta.selectionEnd = end + delta;
      ta.dispatchEvent(new Event('input'));
    }
  });
  editorTextarea.addEventListener('blur', () => { setTimeout(hideSuggestions, 200); });
  editorTextarea.addEventListener('paste', async (e) => {
    const cd = (e as ClipboardEvent).clipboardData;
    if (!cd) return;
    const files: File[] = [];
    if (cd.files && cd.files.length) files.push(...Array.from(cd.files));
    if (!files.length && cd.items) {
      for (const it of Array.from(cd.items)) {
        if (it.kind === 'file') {
          const f = it.getAsFile();
          if (f) files.push(f);
        }
      }
    }
    if (!files.length) return; // let normal text paste happen
    e.preventDefault();
    await handleFiles(files);
  });

  const editorPane = document.getElementById('editorPane')!;
  editorPane.addEventListener('dragover', (e) => { e.preventDefault(); });

  const previewPane = document.getElementById('previewPane');
  if (previewPane) {
    previewPane.addEventListener('dragover', (e) => { e.preventDefault(); });
  }

  // global drag-and-drop overlay handling
  let dragCounter = 0;
  const overlay = document.getElementById('dropOverlay')!;
  const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    dragCounter++;
    overlay.style.display = 'flex';
  });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    dragCounter = Math.max(0, dragCounter - 1);
    if (dragCounter === 0) overlay.style.display = 'none';
  });
  window.addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragCounter = 0;
    overlay.style.display = 'none';
    await handleDrop(e);
  });

  document.getElementById('modeToggle')!.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button'); if (!btn) return;
    const mode = btn.dataset.mode as any;
    setEditorMode(mode).then(() => { applyMode(mode); });
    document.querySelectorAll('#modeToggle button').forEach((b) => b.classList.toggle('active', (b as HTMLElement).dataset.mode === mode));
  });

  // wiki link clicks in preview
  document.getElementById('previewContent')!.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('a.wiki-link') as HTMLAnchorElement | null;
    if (!a) return;
    e.preventDefault();
    const target = decodeURIComponent(a.getAttribute('data-wiki') || '');
    openWikiTarget(target);
  });

  document.getElementById('graphBack')!.addEventListener('click', () => showEditor());
  document.getElementById('graphFit')!.addEventListener('click', () => fitGraph());
  window.addEventListener('keydown', globalKeydown);

  // auto create first note if none
}

// ===== Sesli yazım: motor yönlendirme =====
let webSpeech: { rec: any; want: boolean } | null = null;
let whisperState: 'idle' | 'recording' | 'busy' = 'idle';
let whisperRecorder: any = null;
let whisperStream: MediaStream | null = null;
let whisperChunks: Blob[] = [];

function setVoiceStatus(text: string) {
  const el = document.getElementById('voiceStatus');
  if (!el) return;
  if (!text) { el.classList.remove('show'); el.textContent = ''; return; }
  el.textContent = text;
  el.classList.add('show');
}

function onMicClick(btn: HTMLButtonElement) {
  if (voiceEngine === 'whisper') { void onMicWhisper(btn); }
  else { onMicWebSpeech(btn); }
}

function onMicWebSpeech(btn: HTMLButtonElement) {
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SR) { alert(t('voiceUnsupported')); return; }
  if (webSpeech && (webSpeech.rec as any).__active) {
    webSpeech.want = false;
    webSpeech.rec.stop();
    return;
  }
  const rec = new SR();
  webSpeech = { rec, want: true };
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = getLanguage() === 'tr' ? 'tr-TR' : 'en-US';
  rec.onstart = () => {
    (rec as any).__active = true;
    btn.classList.add('recording');
    btn.textContent = '⏹';
    btn.title = t('voiceListening');
    setVoiceStatus(t('voiceListening'));
  };
  rec.onend = () => {
    (rec as any).__active = false;
    if (webSpeech?.want) {
      // Chrome oturumu ~1 dk'da kapatabilir; sürekli dikte için otomatik yeniden başlat
      setTimeout(() => { if (webSpeech?.want) { try { rec.start(); } catch { /* ignore */ } } }, 250);
    } else {
      resetVoiceButton(btn);
    }
  };
  rec.onerror = (e: any) => {
    if (e && e.error === 'not-allowed') { if (webSpeech) webSpeech.want = false; alert(t('voiceDeny')); }
  };
  rec.onresult = (e: any) => {
    let finalText = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
    }
    if (finalText.trim()) insertAtCursor(finalText.trim() + ' ');
  };
  try { rec.start(); } catch { /* already started */ }
}

function resetVoiceButton(btn: HTMLButtonElement) {
  btn.classList.remove('recording');
  btn.textContent = '🎙';
  btn.title = t('voiceTyping');
  setVoiceStatus('');
}

async function onMicWhisper(btn: HTMLButtonElement) {
  if (whisperState === 'busy') return;
  if (whisperState === 'recording') { await stopWhisperTranscribe(btn); return; }
  await startWhisperRecording(btn);
}

async function startWhisperRecording(btn: HTMLButtonElement) {
  if (!whisperSupported() || !navigator.mediaDevices?.getUserMedia) {
    alert(t('voiceUnsupported'));
    return;
  }
  // Model yoksa /_farklı kalite seçiliyse_ önce tek-seferlik indir (internet gerektiğinde uyarır)
  if (!whisperReadyFor(whisperModelKey)) {
    whisperState = 'busy';
    btn.classList.add('recording');
    setVoiceStatus(t('voicePreparing'));
    try {
      await initWhisperLocal((p) => setVoiceStatus(`${t('voicePreparing')} %${p.percent}`), whisperModelKey);
    } catch (err) {
      console.error('Whisper init failed', err);
      resetVoiceButton(btn);
      whisperState = 'idle';
      alert(t('voiceNeedInternet'));
      return;
    }
  }
  try {
    whisperStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    whisperState = 'idle';
    resetVoiceButton(btn);
    alert(t('voiceDeny'));
    return;
  }
  const mimes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  const mimeType = mimes.find((m) => MediaRecorder.isTypeSupported(m)) || '';
  try {
    whisperRecorder = mimeType ? new MediaRecorder(whisperStream!, { mimeType }) : new MediaRecorder(whisperStream!);
  } catch {
    whisperState = 'idle';
    whisperStream!.getTracks().forEach((tk) => tk.stop());
    resetVoiceButton(btn);
    alert(t('voiceUnsupported'));
    return;
  }
  whisperChunks = [];
  whisperRecorder.addEventListener('dataavailable', (e: any) => { if (e.data && e.data.size) whisperChunks.push(e.data); });
  whisperRecorder.start(1000);
  whisperState = 'recording';
  btn.classList.add('recording');
  btn.textContent = '⏹';
  btn.title = t('voiceRecording');
  setVoiceStatus(t('voiceRecording'));
}

async function stopWhisperTranscribe(btn: HTMLButtonElement) {
  const rec = whisperRecorder;
  const stream = whisperStream;
  whisperState = 'busy';
  btn.classList.remove('recording');
  btn.textContent = '⏳';
  btn.title = t('voiceTranscribing');
  setVoiceStatus(t('voiceTranscribing'));
  try {
    await new Promise<void>((resolve) => { rec.addEventListener('stop', () => resolve(), { once: true }); rec.stop(); });
  } catch { /* ignore */ }
  try { stream?.getTracks().forEach((tk) => tk.stop()); } catch { /* ignore */ }
  try {
    const blob = new Blob(whisperChunks, { type: rec.mimeType || 'audio/webm' });
    const text = await transcribeBlob(blob, getLanguage() === 'tr' ? 'tr' : 'en');
    if (text) insertAtCursor(text + ' ');
    whisperState = 'idle';
    resetVoiceButton(btn);
  } catch (err) {
    console.error('Transcribe failed', err);
    whisperState = 'idle';
    resetVoiceButton(btn);
    alert(t('voiceNeedInternet'));
  }
}

// Ayarlar içinde "modeli şimdi indir" butonu — sadece hazırlar, kayıt başlatmaz
async function prepareWhisperModel() {
  if (whisperReadyFor(whisperModelKey) || whisperState !== 'idle') return;
  whisperState = 'busy';
  setVoiceStatus(t('voicePreparing'));
  try {
    await initWhisperLocal((p) => setVoiceStatus(`${t('voicePreparing')} %${p.percent}`), whisperModelKey);
    setVoiceStatus(`✅ ${t('voiceModelReady')}`);
    setTimeout(() => setVoiceStatus(''), 1800);
  } catch (err) {
    console.error('Whisper init failed', err);
    setVoiceStatus('');
    alert(t('voiceNeedInternet'));
  } finally {
    whisperState = 'idle';
  }
}

function toggleSidebar(open: boolean) {
  document.getElementById('sidebar')!.classList.toggle('open', open);
  document.getElementById('sidebarBackdrop')!.classList.toggle('open', open);
}
function toggleSidePanel() {
  const panel = document.getElementById('sidePanel')!;
  panel.classList.toggle('open');
  document.getElementById('btnBacklinks')!.classList.toggle('active', panel.classList.contains('open'));
  renderSidePanel();
}

function newNoteAndRender() {
  createNote().then(() => { renderAll(); saveTimer = null; });
  toggleSidebar(false);
}
function dailyNote() {
  const d = new Date();
  const title = `${t('dailyNote')} ${d.toISOString().slice(0, 10)}`;
  const existing = findNoteByTitle(title);
  if (existing) { setActive(existing.id); renderAll(); return; }
  createNote(title).then((n) => {
    // insert daily template
    updateNote(n.id, { content: `# ${title}\n\n- [ ] \n` }).then(() => renderAll());
  });
  toggleSidebar(false);
}

function openWikiTarget(target: string) {
  // target may include #heading
  const name = target.split('#')[0];
  const n = findNoteByTitle(name);
  if (n) { setActive(n.id); renderAll(); }
  else {
    createNote(name).then((note) => {
      updateNote(note.id, { content: `# ${name}\n` }).then(() => renderAll());
    });
  }
}

function updateReadingTime(content: string) {
  const rt = document.getElementById('readingTime');
  if (!rt) return;
  const words = content.split(/\s+/).filter(Boolean).length;
  const mins = Math.max(1, Math.round(words / 200));
  rt.textContent = words ? t('readingTime', { n: String(mins) }) : '';
}

function updatePreview(content: string) {
  const pc = document.getElementById('previewContent')!;
  pc.innerHTML = renderMarkdown(resolveRoamEmbeds(content));
  updateReadingTime(content);
  // Outliner collapse toggles
  requestAnimationFrame(() => {
    pc.querySelectorAll('li').forEach((li) => {
      const hasChildList = li.querySelector(':scope > ul, :scope > ol');
      if (!hasChildList || li.querySelector('.collapse-toggle')) return;
      const toggle = document.createElement('span');
      toggle.className = 'collapse-toggle';
      toggle.textContent = '▼';
      toggle.style.cursor = 'pointer';
      toggle.style.marginRight = '4px';
      toggle.style.userSelect = 'none';
      li.insertBefore(toggle, li.firstChild);
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const collapsed = li.classList.toggle('collapsed');
        toggle.textContent = collapsed ? '▶' : '▼';
      });
    });
    try { (window as any).__mermaidRun?.(); } catch (e) {}
  });
  requestAnimationFrame(async () => {
    try {
      const { default: mermaid } = await import('mermaid');
      mermaid.initialize({ startOnLoad: false });
      await mermaid.run({ querySelector: '#previewContent .mermaid' });
    } catch (e) {}
  });
}

function resolveRoamEmbeds(md: string): string {
  // Build block id -> { title, snippet }
  const blockMap = new Map<string, { title: string; snippet: string }>();
  for (const note of getState().notes) {
    for (const line of note.content.split('\n')) {
      const m = line.match(/\^([A-Za-z0-9-]+)\s*$/);
      if (m) {
        const id = m[1];
        const snippet = line.replace(/^\s*[-*+]\s*/, '').replace(/\s*\^[A-Za-z0-9-]+\s*$/, '').trim();
        blockMap.set(id, { title: note.title, snippet });
      }
    }
  }
  // Transclusion ![[Target#^id]]
  let out = md.replace(/!\[\[([^\]#]+)#\^([A-Za-z0-9-]+)(?:\|([^\]]*))?\]\]/g, (_m, target, id, alias) => {
    const n = findNoteByTitle(target);
    if (!n) return `![[${target}#^${id}]]`;
    // find block
    let snippet = '';
    for (const line of n.content.split('\n')) {
      if (new RegExp('\^' + id + '\\s*$').test(line)) {
        snippet = line.replace(/^\s*[-*+]\s*/, '').replace(/\s*\^[A-Za-z0-9-]+\s*$/, '').trim();
        break;
      }
    }
    const label = alias || target;
    return `> **${escapeHtml(label)}** — ${escapeHtml(snippet || '(block)')}  \n> _from ${escapeHtml(target)}#^${id}_`;
  });
  // Block references ((id)) -> link
  out = out.replace(/\(\(([^)]+)\)\)/g, (_m, id) => {
    const info = blockMap.get(id);
    if (info) return `[[${info.title}#^${id}|^${id}]]`;
    return `((${id}))`;
  });
  // Logseq/Obsidian page embeds ![[Page]] (whole-note transclusion; images handled elsewhere)
  const self = getActiveNote();
  out = out.replace(/!\[\[([^\]|#]+)\]\]/g, (_m, name) => {
    const clean = String(name).trim();
    if (/\.(png|jpe?g|gif|webp|svg|bmp|pdf)$/i.test(clean)) return _m;
    const target = findNoteByTitle(clean);
    if (!target || (self && target.id === self.id)) return _m;
    const body = target.content.split('\n').map((l) => '> ' + l).join('\n');
    return `> [!info] ${clean}\n${body}`;
  });
  // Roam queries {{[[query]]: term}}
  out = out.replace(/\{\{\[\[query\]\]:\s*(.*?)\}\}/g, (_m, term) => {
    const t = String(term).trim().toLowerCase();
    const matches = getState().notes.filter((n) => n.title.toLowerCase().includes(t) || n.content.toLowerCase().includes(t));
    if (!matches.length) return '_(no results)_';
    return matches.map((n) => `- [[${n.title}]]`).join('\n');
  });
  // Logseq simple queries: {{query "term"}}, {{query [[Page]]}}, {{query (and [[a]] [[b]])}}, {{query (or "x" [[y]])}}
  out = out.replace(/\{\{query\s+([\s\S]*?)\}\}/gi, (_m, innerRaw) => {
    const inner = String(innerRaw).trim();
    const isOr = /\(\s*or\b/i.test(inner);
    const pages: string[] = [];
    const terms: string[] = [];
    let pm: RegExpExecArray | null;
    const pageRe = /\[\[([^\]]+)\]\]/g;
    while ((pm = pageRe.exec(inner))) pages.push(pm[1].trim().toLowerCase());
    const termRe = /"([^"]+)"/g;
    let tm: RegExpExecArray | null;
    while ((tm = termRe.exec(inner))) terms.push(tm[1].trim().toLowerCase());
    if (!pages.length && !terms.length) return '_(empty query)_';
    const matches = getState().notes.filter((n) => {
      const hay = (n.title + '\n' + n.content).toLowerCase();
      const hasPage = (p: string) => hay.includes('[[' + p + ']]') || hay.includes('#' + p);
      const hasTerm = (s: string) => hay.includes(s);
      if (isOr) return [...pages, ...terms].some((x) => hay.includes('[[' + x + ']]') || hay.includes('#' + x) || hay.includes(x));
      return pages.every(hasPage) && terms.every(hasTerm);
    });
    if (!matches.length) return '_(no results)_';
    return matches.slice(0, 50).map((n) => `- [[${n.title}]]`).join('\n');
  });
  return out;
}


function renderNoteList() {
  const list = document.getElementById('noteList')!;
  list.innerHTML = '';
  const notes = filteredNotes();
  if (!notes.length) {
    const h = document.createElement('div'); h.className = 'empty-hint'; h.textContent = getState().search ? t('emptyNoMatch') : t('emptyNoNotes'); list.appendChild(h); return;
  }
  const q = (getState().search || '').trim().toLowerCase();
  const renderOne = (n: any) => {
    const item = document.createElement('div');
    item.className = 'note-item' + (n.id === getState().activeId ? ' active' : '');
    item.draggable = true;
    item.dataset.noteId = n.id;
    const date = new Date(n.updatedAt).toLocaleString();
    let snippetHtml = '';
    if (q) {
      const haystack = (n.title + '\n' + n.content).toLowerCase();
      const idx = haystack.indexOf(q);
      if (idx >= 0) {
        const start = Math.max(0, idx - 30);
        const end = Math.min(haystack.length, idx + q.length + 50);
        const raw = (n.title + '\n' + n.content).slice(start, end).replace(/\s+/g, ' ');
        const hl = escapeHtml(raw).replace(new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\$&') + ')', 'ig'), '<mark>$1</mark>');
        snippetHtml = `<div class="meta snippet">${(start > 0 ? '...' : '') + hl + (end < haystack.length ? '...' : '')}</div>`;
      }
    }
    item.innerHTML = `<div class="title">${escapeHtml(n.title)}</div>${snippetHtml || `<div class="meta">${date}</div>`}
      <button class="note-del" title="${t('deleteNote')}" aria-label="${t('deleteNote')}">✕</button>`;
    item.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('.note-del'); if (btn) return;
      setActive(n.id); renderAll(); toggleSidebar(false);
    });
    const delBtn = item.querySelector('.note-del') as HTMLButtonElement;
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(t('deleteConfirm', { title: n.title }))) return;
      const noteId = n.id, title = n.title;
      await deleteNote(noteId);
      renderAll();
      undoToast(noteId, title);
    });
    item.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData('text/plain', n.id);
      item.classList.add('dragging');
    });
    item.addEventListener('dragend', () => item.classList.remove('dragging'));
    item.addEventListener('dragover', (e) => { e.preventDefault(); item.classList.add('drag-over'); });
    item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
    item.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      item.classList.remove('drag-over');
      const fromId = e.dataTransfer?.getData('text/plain');
      const toId = n.id;
      if (fromId && fromId !== toId) {
        await reorderNotes(fromId, toId);
        renderAll();
      }
    });
    list.appendChild(item);
  };

  if (groupByFolder) {
    const favs = favorites.map((id) => getState().notes.find((n) => n.id === id)).filter(Boolean) as any[];
    if (favs.length && !q) {
      const fh = document.createElement('div');
      fh.className = 'folder-header';
      fh.textContent = '⭐ ' + t('favorites');
      list.appendChild(fh);
      for (const n of favs) renderOne(n);
      const sep = document.createElement('div');
      sep.style.height = '6px';
      list.appendChild(sep);
    }
    const groups = new Map<string, any[]>();
    for (const n of notes) {
      const key = n.folder || '';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(n);
    }
    const keys = [...groups.keys()].sort((a, b) => String(a).localeCompare(String(b)));
    for (const key of keys) {
      if (key) {
        const fh = document.createElement('div');
        fh.className = 'folder-header';
        fh.textContent = key;
        list.appendChild(fh);
      }
      for (const n of groups.get(key)!) renderOne(n);
    }
  } else {
    for (const n of notes) renderOne(n);
  }
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---- 📊 Kelime istatistik altyapısı (günlük sayaç localStorage'da) ----
function countWords(s: string): number {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
}
function todayKey(): string { return new Date().toISOString().slice(0, 10); }
function dayWords(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem('catjam:daywords') || '{}'); } catch { return {}; }
}
function trackDailyWords(delta: number) {
  if (delta <= 0) return;
  const dw = dayWords();
  const k = todayKey();
  dw[k] = (dw[k] || 0) + delta;
  // 400 günden eski kayıtları budala
  const cutoff = Date.now() - 400 * 86400000;
  for (const key of Object.keys(dw)) {
    const t = new Date(key + 'T00:00:00Z').getTime();
    if (!isNaN(t) && t < cutoff) delete dw[key];
  }
  try { localStorage.setItem('catjam:daywords', JSON.stringify(dw)); } catch { /* kota */ }
}
function dailyGoal(): number {
  const g = Number(localStorage.getItem('catjam:goal') || '300');
  return g >= 50 ? g : 300;
}
function maybeCelebrateGoal() {
  const words = dayWords()[todayKey()] || 0;
  if (words < dailyGoal()) return;
  if (localStorage.getItem('catjam:goaltoday') === todayKey()) return;
  localStorage.setItem('catjam:goaltoday', todayKey());
  const pct = Math.round((words / dailyGoal()) * 100);
  catSay(isTr()
    ? `Bugün ${words} kelime — hedef %{${pct}} tamam! 🎉 Miyav!`
    : `${words} words today — goal ${pct}% done! 🎉 Meow!`, 5200);
  catPoke('happy');
}

// ---- Haftalık rapor ----
function isoWeek(d: Date): { year: number; week: number; monday: Date } {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7; // Pzt=1..Paz=7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum); // haftanın Perşembesi
  const year = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  const monday = new Date(date);
  monday.setUTCDate(monday.getUTCDate() - 3); // Perşembe -3 = Pazartesi
  return { year, week, monday };
}

async function openWeeklyReport() {
  const now = new Date();
  const { year, week, monday } = isoWeek(now);
  const title = `${t('weeklyReport')} ${year}-W${String(week).padStart(2, '0')}`;
  const existing = findNoteByTitle(title);
  if (existing) { setActive(existing.id); renderAll(); return; }
  const sunday = new Date(monday); sunday.setDate(sunday.getDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString(getState().settings.language === 'tr' ? 'tr-TR' : 'en-GB', { day: 'numeric', month: 'short' });
  const notes = getState().notes
    .filter((x) => !x.deletedAt && x.updatedAt >= monday.getTime() && x.title !== title)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 40);
  // görev taraması (tasks modal ile aynı desenler)
  const active: { text: string; state: string; note: string }[] = [];
  const done: { text: string; note: string }[] = [];
  for (const note of getState().notes) {
    if (note.deletedAt || note.locked) continue;
    for (const line of note.content.split('\n')) {
      const m = line.match(/^[\t ]*[-*+] \[([ xX])\] (.+)$/);
      if (m) { if (m[1].toLowerCase() === 'x') done.push({ text: m[2].trim(), note: note.title }); continue; }
      const ls = line.match(/^[\t ]*(?:[-*+]\s+)?\s*(NOW|DOING|TODO|LATER)\s+(.+)$/i);
      if (ls) active.push({ text: ls[2].trim(), state: ls[1].toUpperCase(), note: note.title });
    }
  }
  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push(`> 📅 ${fmt(monday)} → ${fmt(sunday)}`);
  lines.push('');
  lines.push(`## 📝 ${t('reportWritten')} (${notes.length})`);
  if (notes.length) for (const n of notes) lines.push(`- [[${n.title}]] — ${fmt(new Date(n.updatedAt))}`);
  else lines.push(`*—*`);
  lines.push('');
  lines.push(`## ✅ ${t('reportTasks')}`);
  lines.push(`### ${t('reportActive')} (${active.length})`);
  if (active.length) for (const a of active.slice(0, 30)) lines.push(`- ${a.state} ${a.text} *([[${a.note}]])*`);
  else lines.push(`*—*`);
  lines.push(`### ${t('reportCompleted')} (${done.length})`);
  if (done.length) for (const d of done.slice(0, 30)) lines.push(`- [x] ${d.text} *([[${d.note}]])*`);
  else lines.push(`*—*`);
  lines.push('');
  lines.push(`*🕐 ${new Date().toLocaleString()}*`);
  const note = await createNote(title);
  await updateNote(note.id, { content: lines.join('\n') });
  renderAll();
}

// ---- 🎧 Ambiyans sesleri (popover) ----
function ambientOnKind(): 'rain' | 'waves' | 'fire' | null {
  return ambientOn();
}
let ambientMarker: { kind: 'rain' | 'waves' | 'fire'; volume: number };
try {
  ambientMarker = JSON.parse(localStorage.getItem('catjam:ambient') || '');
} catch {
  ambientMarker = { kind: 'rain', volume: 40 };
}
function ambientPersist() {
  localStorage.setItem('catjam:ambient', JSON.stringify(ambientMarker));
}

function toggleAmbientPopover() {
  const existing = document.getElementById('ambientPopover');
  if (existing) { existing.remove(); return; }
  const pop = document.createElement('div');
  pop.id = 'ambientPopover';
  const vol = ambientMarker.volume;
  pop.innerHTML = `
    <div style="font-size:13px;font-weight:600;color:var(--text-h);margin-bottom:8px;">🎧 ${t('ambient')}</div>
    <div style="display:flex;gap:6px;margin-bottom:10px;">
      <button class="iconbtn amb-kind" data-kind="rain" style="flex:1;height:auto;width:auto;padding:7px 4px;font-size:20px;${ambientOnKind() === 'rain' ? 'border-color:var(--accent);color:var(--accent);background:var(--accent-soft);' : ''}" title="${t('ambientRain')}">🌧<div style="font-size:10px;margin-top:2px;">${t('ambientRain')}</div></button>
      <button class="iconbtn amb-kind" data-kind="waves" style="flex:1;height:auto;width:auto;padding:7px 4px;font-size:20px;${ambientOnKind() === 'waves' ? 'border-color:var(--accent);color:var(--accent);background:var(--accent-soft);' : ''}" title="${t('ambientWaves')}">🌊<div style="font-size:10px;margin-top:2px;">${t('ambientWaves')}</div></button>
      <button class="iconbtn amb-kind" data-kind="fire" style="flex:1;height:auto;width:auto;padding:7px 4px;font-size:20px;${ambientOnKind() === 'fire' ? 'border-color:var(--accent);color:var(--accent);background:var(--accent-soft);' : ''}" title="${t('ambientFire')}">🔥<div style="font-size:10px;margin-top:2px;">${t('ambientFire')}</div></button>
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
      <span style="font-size:12px;color:var(--text-muted);white-space:nowrap;">${t('ambientVolume')}</span>
      <input type="range" id="ambientVol" min="0" max="100" value="${vol}" style="flex:1;" />
      <span id="ambientVolLabel" style="font-size:12px;color:var(--text-muted);width:30px;text-align:right;">${vol}</span>
    </div>
    <button class="iconbtn" id="ambientStop" style="width:100%;height:auto;padding:7px 10px;font-size:13px;${ambientOnKind() ? '' : 'opacity:.5;'}">⏹ ${t('ambientStop')}</button>
  `;
  document.body.appendChild(pop);
  const stop = pop.querySelector('#ambientStop') as HTMLButtonElement;
  stop.addEventListener('click', () => { stopAmbient(); pop.remove(); });
  for (const b of Array.from(pop.querySelectorAll('.amb-kind')) as HTMLButtonElement[]) {
    b.addEventListener('click', () => {
      const kind = b.dataset.kind as 'rain' | 'waves' | 'fire';
      if (ambientMarker.kind === kind && ambientOnKind() === kind) {
        // aynı tür seçildi → durdur (toggle)
        stopAmbient();
        pop.remove();
        return;
      }
      ambientMarker = { ...ambientMarker, kind };
      ambientPersist();
      startAmbient(kind, ambientMarker.volume / 100);
      pop.remove();
      toggleAmbientPopover(); // yeniden render (renk tazele)
      catPoke('happy');
    });
  }
  const volInput = pop.querySelector('#ambientVol') as HTMLInputElement;
  volInput.addEventListener('input', () => {
    const v = Number(volInput.value);
    ambientMarker = { ...ambientMarker, volume: v };
    ambientPersist();
    (pop.querySelector('#ambientVolLabel') as HTMLSpanElement).textContent = String(v);
    setAmbientVolume(v / 100);
  });
  // dışarı tık → kapat
  setTimeout(() => {
    const off = (e: MouseEvent) => {
      if (!pop.contains(e.target as Node) && !(e.target as HTMLElement).closest('#btnAmbient')) {
        pop.remove();
        document.removeEventListener('click', off);
      }
    };
    document.addEventListener('click', off);
  }, 0);
}

// ---- Tek dosya HTML paylaşımı ----
function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

function slugFileName(title: string): string {
  const slug = title.toLowerCase().replace(/[^\w\u00c0-\u024f]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'not';
  return slug + '.html';
}

async function exportCurrentNoteHtml() {
  const n = getActiveNote();
  if (!n) return;
  if (isEditorLocked(n)) { alert(t('lockedTitle') + ' — ' + t('lockedPlaceholder')); return; }
  const textarea = document.getElementById('editorTextarea') as HTMLTextAreaElement | null;
  const content = textarea && !textarea.readOnly ? textarea.value : n.content;
  // fresh preview (KaTeX tıklama anında işlensin)
  updatePreview(content);
  await new Promise((r) => setTimeout(r, 400)); // mermaid/kat async bitisi
  const pc = document.getElementById('previewContent')!;
  const clone = pc.cloneNode(true) as HTMLElement;
  // klonda mermaid henüz render olmadıysa şimdi dene
  try {
    const pending = Array.from(clone.querySelectorAll('.mermaid')) as unknown as HTMLElement[];
    if (pending.length && !pending[0].querySelector('svg')) {
      const { default: mermaid } = await import('mermaid');
      mermaid.initialize({ startOnLoad: false });
      await mermaid.run({ nodes: pending });
    }
  } catch (e) {}
  // blob: görselleri dataURL'e çevir (dosya bağımsız olsun)
  for (const img of Array.from(clone.querySelectorAll('img'))) {
    const src = img.getAttribute('src') || '';
    if (src.startsWith('blob:')) {
      try {
        const resp = await fetch(src);
        img.setAttribute('src', await blobToDataURL(await resp.blob()));
      } catch (e) { /* görsel atlanır */ }
    }
  }
  const title = n.title || 'Cat Jam';
  const when = new Date().toLocaleString();
  const doc = `<!DOCTYPE html>
<html lang="${getState().settings.language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${katexCss}</style>
<style>
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; padding: 40px 20px 80px; background: #faf9f7; color: #33312e; font-family: Georgia, 'Times New Roman', serif; line-height: 1.65; }
.page { max-width: 760px; margin: 0 auto; }
h1, h2, h3, h4, h5, h6 { color: #1a1917; line-height: 1.3; font-family: Georgia, serif; margin: 1.4em 0 0.5em; }
h1 { font-size: 2em; margin-top: 0; border-bottom: 1px solid #e5e2dc; padding-bottom: 8px; }
p { margin: 0.75em 0; }
a { color: #0f6b5f; }
blockquote { margin: 1em 0; padding: 2px 14px; border-left: 3px solid #d8d4cc; color: #6b675f; }
code { background: #f0ede7; border-radius: 4px; padding: 2px 5px; font-family: ui-monospace, 'Cascadia Code', Consolas, monospace; font-size: 0.9em; }
pre { background: #2d2a26; color: #ece9e2; border-radius: 8px; padding: 14px 16px; overflow: auto; }
pre code { background: none; color: inherit; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 0.95em; }
th, td { border: 1px solid #e0dcd4; padding: 7px 10px; text-align: left; }
th { background: #f2efe9; }
img { max-width: 100%; border-radius: 8px; }
hr { border: none; border-top: 1px solid #e5e2dc; margin: 2em 0; }
ul, ol { padding-left: 1.5em; }
.checklist-item { list-style: none; margin-left: -1.2em; }
input[type="checkbox"] { margin-right: 6px; }
.wiki-link { color: #0f6b5f; text-decoration: none; border-bottom: 1px dotted #0f6b5f99; }
.callout { border-radius: 10px; padding: 12px 16px; margin: 1em 0; background: #f2efe9; border-left: 4px solid #8a857c; }
.callout-title { font-weight: 700; margin-bottom: 4px; font-size: 0.95em; }
.callout-note { background: #eef4fa; border-left-color: #3b82c4; } .callout-tip { background: #ecf8f1; border-left-color: #2e9e63; }
.callout-important { background: #fdf3e7; border-left-color: #d97706; } .callout-warning { background: #fdf6ec; border-left-color: #d9a406; }
.callout-danger { background: #fdeeee; border-left-color: #d9534f; } .callout-quote { background: #f4f2ee; border-left-color: #8a857c; }
.block-prop { display: inline-block; background: #f0ede7; border-radius: 6px; padding: 1px 8px; font-size: 0.8em; font-family: ui-monospace, monospace; }
.mermaid { text-align: center; margin: 1em 0; }
.foot { margin-top: 40px; padding-top: 12px; border-top: 1px solid #e5e2dc; color: #9a958c; font-size: 0.8em; font-style: italic; }
@media print { body { background: #fff; padding: 0; } .page { max-width: none; } }
</style>
</head>
<body>
<div class="page">
<h1>${escapeHtml(title)}</h1>
${clone.innerHTML}
<div class="foot">${escapeHtml(when)} · 🐱 Cat Jam ile oluşturuldu</div>
</div>
</body>
</html>`;
  const blob = new Blob([doc], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = slugFileName(n.title);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  showToast('🌐 ' + t('exportedHtml'));
  catPoke('happy');
}

// ---- Toast (aksiyonlu bildirim) ----
let toastTimer: any = null;
function showToast(text: string, action?: { label: string; onAction: () => void }) {
  let el = document.getElementById('appToast');
  if (!el) { el = document.createElement('div'); el.id = 'appToast'; document.body.appendChild(el); }
  el.innerHTML = `<span>${escapeHtml(text)}</span>` + (action ? `<button class="toast-action">${escapeHtml(action.label)}</button>` : '');
  if (action) (el.querySelector('.toast-action') as HTMLButtonElement)?.addEventListener('click', () => { action.onAction(); hideToast(); });
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 5500);
}
function hideToast() {
  document.getElementById('appToast')?.classList.remove('show');
}

function undoToast(noteId: string, title: string) {
  showToast(t('deletedUndo', { title }), {
    label: t('undo'),
    onAction: async () => { await restoreNote(noteId); renderAll(); },
  });
}

function openTrashModal() {
  const notes = deletedNotes();
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `<h3>🗑 ${t('trashTitle')}</h3><div id="trashList" style="max-height:55vh;overflow:auto;"></div>`;
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
  const list = modal.querySelector('#trashList') as HTMLDivElement;
  if (!notes.length) {
    list.innerHTML = `<div style="color:var(--text-muted);font-size:13px;">${t('trashEmpty')}</div>`;
  } else {
    for (const n of notes) {
      const row = document.createElement('div');
      row.className = 'backlink-item';
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '8px';
      const when = new Date(n.deletedAt ?? Date.now()).toLocaleString();
      row.innerHTML = `<div style="flex:1;min-width:0;"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-h);">${escapeHtml(n.title)}</div><div style="color:var(--text-muted);font-size:11px;">${escapeHtml(when)}</div></div>`;
      const rest = document.createElement('button');
      rest.className = 'iconbtn';
      rest.style.cssText = 'width:auto;padding:4px 10px;font-size:12px;flex-shrink:0;border-color:var(--border);background:var(--bg-soft);';
      rest.textContent = '↩ ' + t('restore');
      rest.addEventListener('click', async () => {
        await restoreNote(n.id); renderAll(); backdrop.remove();
      });
      const perm = document.createElement('button');
      perm.className = 'iconbtn';
      perm.style.cssText = 'width:auto;padding:4px 10px;font-size:12px;flex-shrink:0;border-color:var(--border);background:var(--bg-soft);';
      perm.textContent = '🗑';
      perm.addEventListener('click', async () => {
        if (!confirm(t('deleteForeverConfirm', { title: n.title }))) return;
        await deleteNote(n.id, true); renderAll(); backdrop.remove();
      });
      row.appendChild(rest);
      row.appendChild(perm);
      list.appendChild(row);
    }
  }
  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex;justify-content:flex-end;margin-top:10px;';
  const close = document.createElement('button');
  close.className = 'iconbtn';
  close.style.cssText = 'width:auto;padding:4px 12px;';
  close.textContent = t('close');
  close.addEventListener('click', () => backdrop.remove());
  footer.appendChild(close);
  modal.appendChild(footer);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
}

function applyMode(mode: string) {
  const body = document.getElementById('editorBody')!;
  body.className = 'editor-body mode-' + mode;
  const showEdit = mode === 'edit' || mode === 'split';
  const showPreview = mode === 'preview' || mode === 'split';
  document.getElementById('editorPane')!.style.display = showEdit ? '' : 'none';
  document.getElementById('previewPane')!.style.display = showPreview ? '' : 'none';
}

function renderEditor() {
  const n = getActiveNote();
  if (n && n.id !== lastViewedId) { lastViewedId = n.id; markRecent(n.id); }
  const titleInput = document.getElementById('titleInput') as HTMLInputElement;
  const textarea = document.getElementById('editorTextarea') as HTMLTextAreaElement;
  const lockCard = document.getElementById('lockCard')!;
  const editorPane = document.getElementById('editorPane')!;
  const previewPaneEl = document.getElementById('previewPane')!;
  const lockBtn = document.getElementById('btnLock') as HTMLButtonElement | null;
  if (!n) {
    titleInput.value = '';
    textarea.value = '';
    document.getElementById('previewContent')!.innerHTML = '';
    lockCard.style.display = 'none'; editorPane.style.display = ''; previewPaneEl.style.display = '';
    return;
  }
  const unlocked = noteLocked(n) && unlockedSet.has(n.id);
  const lockedNow = isEditorLocked(n);
  if (lockBtn) {
    lockBtn.textContent = noteLocked(n) ? (unlocked ? '🔓' : '🔒') : '🔒';
    lockBtn.classList.toggle('active', noteLocked(n));
    lockBtn.title = noteLocked(n) ? (unlocked ? t('relock') : t('unlockBtn')) : t('lockNote');
  }
  if (lockedNow) {
    lockCard.style.display = '';
    editorPane.style.display = 'none';
    previewPaneEl.style.display = 'none';
    const hint = document.getElementById('lockHint')!;
    hint.textContent = n.lockData?.hint ? '💡 ' + n.lockData.hint : t('lockedPlaceholder');
    titleInput.value = n.title;
    titleInput.readOnly = true;
    textarea.value = '';
    textarea.readOnly = true;
    setTimeout(() => { const lp = document.getElementById('lockPass') as HTMLInputElement | null; if (lp && document.activeElement !== lp) lp.focus(); }, 60);
    return;
  }
  lockCard.style.display = 'none';
  titleInput.readOnly = !!noteLocked(n); // kilit açık ama salt okunur
  textarea.readOnly = !!noteLocked(n);
  titleInput.value = n.title;
  textarea.value = n.content;
  const star = document.getElementById('btnStar') as HTMLButtonElement | null;
  if (star) {
    const isFav = favorites.includes(n.id);
    star.textContent = isFav ? '★' : '☆';
    star.classList.toggle('active', isFav);
  }
  updatePreview(n.content);
  // mode
  const mode = getState().settings.editorMode;
  document.querySelectorAll('#modeToggle button').forEach((b) => b.classList.toggle('active', (b as HTMLElement).dataset.mode === mode));
  applyMode(mode);
  renderSidePanel();
  const pp = document.getElementById('propsPanel');
  if (pp && pp.style.display !== 'none') renderProps();
}

function renderSidePanel() {
  const n = getActiveNote();
  const bl = document.getElementById('backlinksList')!;
  const ol = document.getElementById('outgoingList')!;
  const tl = document.getElementById('tagsList')!;
  const outl = document.getElementById('outlineList')!;
  const ul = document.getElementById('unlinkedList')!;
  bl.innerHTML = ''; ol.innerHTML = ''; tl.innerHTML = ''; outl.innerHTML = ''; ul.innerHTML = '';
  if (!n) return;
  const links = extractWikiLinks(n.content);
  // outline
  const headingItems: { level: number; text: string; id: string }[] = [];
  {
    const re = /^(#{1,6})\s+(.+)$/gm;
    let i = 0;
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(n.content))) {
      const text = mm[2].trim();
      const slug = text.toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || 'heading';
      headingItems.push({ level: mm[1].length, text, id: 'h-' + slug + '-' + i });
      i++;
    }
  }
  if (!headingItems.length) {
    outl.innerHTML = `<div style="color:var(--text-muted);font-size:13px;">${t('none')}</div>`;
  } else {
    for (const h of headingItems) {
      const item = document.createElement('div');
      item.className = 'backlink-item';
      item.style.paddingLeft = (h.level - 1) * 10 + 8 + 'px';
      item.textContent = h.text;
      item.addEventListener('click', () => {
        const target = document.getElementById(h.id);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        // also scroll textarea to heading line
        const ta = document.getElementById('editorTextarea') as HTMLTextAreaElement;
        const idx = n.content.split('\n').findIndex((l) => l.trim() === '#'.repeat(h.level) + ' ' + h.text || l.trim().startsWith('#'.repeat(h.level) + ' ' + h.text));
        if (idx >= 0) {
          const lines = n.content.split('\n');
          let pos = 0;
          for (let i = 0; i < idx; i++) pos += lines[i].length + 1;
          ta.focus();
          ta.selectionStart = ta.selectionEnd = pos;
          // scroll textarea
          const lineHeight = 20;
          ta.scrollTop = idx * lineHeight;
        }
      });
      outl.appendChild(item);
    }
  }
  // outgoing
  for (const l of links) {
    const target = findNoteByTitle(l);
    const item = document.createElement('div');
    item.className = 'backlink-item';
    item.innerHTML = `${escapeHtml(l)} ${target ? '' : '<span style="color:var(--text-muted)">(not created)</span>'}`;
    item.addEventListener('click', () => openWikiTarget(l));
    ol.appendChild(item);
  }
  if (!links.length) ol.innerHTML = `<div style="color:var(--text-muted);font-size:13px;">${t('none')}</div>`;
  // backlinks
  const bls = backlinksOf(n.title);
  for (const b of bls) {
    const item = document.createElement('div');
    item.className = 'backlink-item';
    const lower = n.title.toLowerCase();
    const snippetLine = b.content.split('\n').find((ln) => /\[\[[^\]]*\]\]/.test(ln) && ln.toLowerCase().includes(lower)) || b.content.split('\n').find((ln) => ln.toLowerCase().includes(lower)) || '';
    const trimmed = snippetLine.trim().slice(0, 90);
    item.innerHTML = `<div style="color:var(--text-h);font-weight:500;">${escapeHtml(b.title)}</div>${trimmed ? `<div style="color:var(--text-muted);font-size:11px;margin-top:2px;">${escapeHtml(trimmed)}</div>` : ''}`;
    item.addEventListener('click', () => { setActive(b.id); renderAll(); });
    bl.appendChild(item);
  }
  if (!bls.length) bl.innerHTML = `<div style="color:var(--text-muted);font-size:13px;">${t('none')}</div>`;
  // tags
  const tags = extractTags(n.content);
  if (!tags.length) {
    tl.innerHTML = `<div style="color:var(--text-muted);font-size:13px;">${t('none')}</div>`;
  } else {
    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.flexWrap = 'wrap';
    wrap.style.gap = '6px';
    for (const t of tags) {
      const chip = document.createElement('button');
      chip.className = 'iconbtn';
      chip.style.width = 'auto';
      chip.style.height = 'auto';
      chip.style.padding = '2px 8px';
      chip.style.fontSize = '12px';
      chip.textContent = '#' + t;
      chip.addEventListener('click', () => { setSearch('#' + t); (document.getElementById('searchInput') as HTMLInputElement).value = '#' + t; renderNoteList(); });
      wrap.appendChild(chip);
    }
    tl.appendChild(wrap);
  }
  // unlinked references (mentions without [[ ]])
  const lowerTitle = n.title.toLowerCase();
  const unlinked = getState().notes.filter((nb) => nb.id !== n.id && nb.content.toLowerCase().includes(lowerTitle) && !nb.content.toLowerCase().includes('[[' + lowerTitle + ']]'));
  for (const b of unlinked) {
    const item = document.createElement('div');
    item.className = 'backlink-item';
    const line = b.content.split('\n').find((ln) => ln.toLowerCase().includes(lowerTitle)) || '';
    const trimmed = line.trim().slice(0, 90);
    item.innerHTML = `<div style="color:var(--text-h);font-weight:500;">${escapeHtml(b.title)}</div>${trimmed ? `<div style="color:var(--text-muted);font-size:11px;margin-top:2px;">${escapeHtml(trimmed)}</div>` : ''}`;
    item.addEventListener('click', () => { setActive(b.id); renderAll(); });
    ul.appendChild(item);
  }
  if (!unlinked.length) ul.innerHTML = `<div style="color:var(--text-muted);font-size:13px;">${t('none')}</div>`;
}

function renderAll() {
  renderNoteList();
  renderEditor();
  if (currentView === 'graph') drawGraph();
}

function showGraph(local = false) {
  currentView = 'graph';
  (window as any).__graphLocal = local;
  document.getElementById('editorBody')!.style.display = 'none';
  document.getElementById('editorHeader')!.style.display = 'none';
  const gw = document.getElementById('graphWrap')!;
  gw.style.display = '';
  toggleSidebar(false);
  initGraph();
  drawGraph();
}
function showEditor() {
  currentView = 'editor';
  document.getElementById('editorBody')!.style.display = '';
  document.getElementById('editorHeader')!.style.display = '';
  document.getElementById('graphWrap')!.style.display = 'none';
  if (graphAnimId) { cancelAnimationFrame(graphAnimId); graphAnimId = null; }
}

// Graph
function initGraph() {
  let notes = getState().notes;
  const local = (window as any).__graphLocal;
  if (local && getState().activeId) {
    const adj = new Map<string, Set<string>>();
    for (const n of getState().notes) adj.set(n.id, new Set());
    const allEdges: { source: string; target: string }[] = [];
    for (const n of getState().notes) {
      for (const l of extractWikiLinks(n.content)) {
        const t = findNoteByTitle(l);
        if (t) allEdges.push({ source: n.id, target: t.id });
      }
    }
    for (const e of allEdges) {
      adj.get(e.source)?.add(e.target);
      adj.get(e.target)?.add(e.source);
    }
    const visited = new Set<string>([getState().activeId!]);
    let frontier = [getState().activeId!];
    for (let d = 0; d < 2 && frontier.length; d++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const nb of adj.get(id) || []) {
          if (!visited.has(nb)) { visited.add(nb); next.push(nb); }
        }
      }
      frontier = next;
    }
    notes = getState().notes.filter((n) => visited.has(n.id));
  }
  graphNodes = notes.map((n) => ({ id: n.id, title: n.title, x: Math.random() * 400 + 100, y: Math.random() * 300 + 100, vx: 0, vy: 0 }));
  graphEdges = [];
  for (const n of notes) {
    for (const l of extractWikiLinks(n.content)) {
      const target = findNoteByTitle(l);
      if (target && notes.some((x) => x.id === target.id)) graphEdges.push({ source: n.id, target: target.id });
    }
  }
  // attach canvas sizing
  const canvas = document.getElementById('graphCanvas') as HTMLCanvasElement;
  const wrap = canvas.parentElement!;
  canvas.width = wrap.clientWidth * devicePixelRatio;
  canvas.height = wrap.clientHeight * devicePixelRatio;
  canvas.style.width = wrap.clientWidth + 'px';
  canvas.style.height = wrap.clientHeight + 'px';
}
function fitGraph() {}
function drawGraph() {
  const canvas = document.getElementById('graphCanvas') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const W = canvas.width, H = canvas.height;
  const dpr = devicePixelRatio;
  // simple force simulation steps
  function step() {
    // repulsion
    for (let i = 0; i < graphNodes.length; i++) {
      for (let j = i + 1; j < graphNodes.length; j++) {
        const a = graphNodes[i], b = graphNodes[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        let d = Math.hypot(dx, dy) || 1;
        const force = 800 / (d * d);
        const fx = (dx / d) * force, fy = (dy / d) * force;
        a.vx -= fx; a.vy -= fy;
        b.vx += fx; b.vy += fy;
      }
    }
    // attraction edges
    for (const e of graphEdges) {
      const a = graphNodes.find((n) => n.id === e.source)!;
      const b = graphNodes.find((n) => n.id === e.target)!;
      let dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 1;
      const force = (d - 120) * 0.02;
      const fx = (dx / d) * force, fy = (dy / d) * force;
      a.vx += fx; a.vy += fy;
      b.vx -= fx; b.vy -= fy;
    }
    // center gravity
    for (const n of graphNodes) {
      n.vx += (W / (2 * dpr) - n.x) * 0.005;
      n.vy += (H / (2 * dpr) - n.y) * 0.005;
      n.vx *= 0.85; n.vy *= 0.85;
      n.x += n.vx; n.y += n.vy;
    }
    // draw
    ctx.clearRect(0, 0, W, H);
    // edges
    ctx.strokeStyle = 'rgba(148,163,184,0.3)';
    ctx.lineWidth = 1 * dpr;
    for (const e of graphEdges) {
      const a = graphNodes.find((n) => n.id === e.source)!;
      const b = graphNodes.find((n) => n.id === e.target)!;
      ctx.beginPath();
      ctx.moveTo(a.x * dpr, a.y * dpr);
      ctx.lineTo(b.x * dpr, b.y * dpr);
      ctx.stroke();
    }
    // nodes
    for (const n of graphNodes) {
      ctx.fillStyle = n.id === getState().activeId ? '#60a5fa' : '#94a3b8';
      ctx.beginPath();
      ctx.arc(n.x * dpr, n.y * dpr, 6 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f1f5f9';
      ctx.font = `${11 * dpr}px system-ui`;
      ctx.textAlign = 'center';
      ctx.fillText(n.title.slice(0, 18), n.x * dpr, n.y * dpr - 10 * dpr);
    }
    if (currentView === 'graph') graphAnimId = requestAnimationFrame(step);
  }
  if (graphAnimId) cancelAnimationFrame(graphAnimId);
  graphAnimId = requestAnimationFrame(step);
  // click to select
  const canvasEl = document.getElementById('graphCanvas') as HTMLCanvasElement;
  canvasEl.onclick = (ev) => {
    const rect = canvasEl.getBoundingClientRect();
    const x = (ev.clientX - rect.left) * dpr;
    const y = (ev.clientY - rect.top) * dpr;
    for (const n of graphNodes) {
      if (Math.hypot(n.x * dpr - x, n.y * dpr - y) < 12 * dpr) {
        setActive(n.id); showEditor(); renderAll(); break;
      }
    }
  };
}

// Settings modal
function openSettings() {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `<h3>${t('settingsTitle')}</h3>
    <div style="margin-bottom:12px;">
      <div style="font-size:13px;color:var(--text-muted);margin-bottom:6px;">${t('theme')}</div>
      <div class="row" id="themeRow"></div>
    </div>
    <div style="margin-bottom:12px;">
      <div style="font-size:13px;color:var(--text-muted);margin-bottom:6px;">${t('language')}</div>
      <select id="languageSelect" class="search-input" style="width:100%;"></select>
    </div>
    <div style="margin-bottom:12px;">
      <div style="font-size:13px;color:var(--text-muted);margin-bottom:6px;">${t('fontSize')}</div>
      <input type="range" min="12" max="24" value="${getState().settings.fontSize}" id="fontSizeRange" />
      <span id="fontSizeLabel">${getState().settings.fontSize}px</span>
    </div>
    <div style="margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;gap:12px;">
      <div style="font-size:13px;color:var(--text-muted);">🐱 ${t('catMascot')}</div>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text);cursor:pointer;white-space:nowrap;">
        <input type="checkbox" id="catMascotToggle" ${catEnabled() ? 'checked' : ''} />
        <span style="font-size:12px;color:var(--text-muted);">${catEnabled() ? t('catOn') : t('catOff')}</span>
      </label>
    </div>
    <div id="catExtras" style="margin-bottom:12px;display:${catEnabled() ? 'block' : 'none'};">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px;">
        <div style="font-size:13px;color:var(--text-muted);">🎨 ${t('catSkins')}</div>
        <select id="catSkinSelect" class="search-input" style="width:150px;">
          ${CAT_SKINS.map((s) => `<option value="${s.id}" ${catSkinCurrent() === s.id ? 'selected' : ''}>${isTr() ? s.labelTr : s.labelEn}</option>`).join('')}
        </select>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
        <div style="font-size:13px;color:var(--text-muted);">🔊 ${t('catSound')}</div>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text);cursor:pointer;white-space:nowrap;">
          <input type="checkbox" id="catSoundToggle" ${catSoundCurrent() ? 'checked' : ''} />
          <span style="font-size:12px;color:var(--text-muted);">${catSoundCurrent() ? t('catOn') : t('catOff')}</span>
        </label>
      </div>
    </div>
    <div style="margin-bottom:12px;">
      <div style="font-size:13px;color:var(--text-muted);margin-bottom:6px;">${t('writeProfile')}</div>
      <select id="editorFontSelect" class="search-input" style="width:100%;">
        <option value="sans">${t('writeProfileSans')}</option>
        <option value="serif">${t('writeProfileSerif')}</option>
        <option value="mono">${t('writeProfileMono')}</option>
      </select>
    </div>
    <div style="margin-bottom:12px;">
      <div style="font-size:13px;color:var(--text-muted);margin-bottom:6px;">${t('themeEditor')}</div>
      <textarea id="customCssInput" class="search-input" rows="8" spellcheck="false" style="width:100%;font-family:var(--mono);font-size:12px;line-height:1.5;resize:vertical;" placeholder=":root { --accent: #ff9900; }"></textarea>
      <div style="font-size:11px;color:var(--text-muted);margin-top:6px;line-height:1.5;">${t('themeEditorHint')}</div>
      <div style="display:flex;gap:8px;margin-top:8px;">
        <button class="iconbtn" id="customCssReset" style="width:auto;padding:5px 12px;font-size:12px;border-color:var(--border);background:var(--bg-soft);">⌫ ${t('themeEditorReset')}</button>
      </div>
    </div>
    <div style="margin-bottom:12px;">
      <div style="font-size:13px;color:var(--text-muted);margin-bottom:6px;">${t('voiceEngine')}</div>
      <select id="voiceEngineSelect" class="search-input" style="width:100%;">
        <option value="webspeech">${t('voiceWebSpeech')}</option>
        <option value="whisper">${t('voiceWhisper')}</option>
      </select>
      <div id="voiceEngineHint" style="font-size:11px;color:var(--text-muted);margin-top:6px;line-height:1.5;"></div>
      <button class="iconbtn" id="whisperPrepare" style="display:none;width:auto;padding:6px 12px;font-size:12px;margin-top:6px;border-color:var(--border);background:var(--bg-soft);">⬇ ${t('voiceDownloadHint')}</button>
      <div id="voiceModelWrap" style="display:none;margin-top:10px;">
        <div style="font-size:13px;color:var(--text-muted);margin-bottom:6px;">${t('voiceModel')}</div>
        <select id="whisperModelSelect" class="search-input" style="width:100%;">
          <option value="tiny">${t('voiceModelTiny')}</option>
          <option value="base">${t('voiceModelBase')}</option>
          <option value="small">${t('voiceModelSmall')}</option>
        </select>
        <div id="voiceModelHint" style="font-size:11px;color:var(--text-muted);margin-top:6px;line-height:1.5;">${t('voiceSmallRec')}</div>
        <button class="iconbtn" id="whisperDeleteBtn" style="width:auto;padding:5px 12px;font-size:12px;margin-top:8px;border-color:var(--border);background:var(--bg-soft);color:var(--text);">🗑 ${t('voiceDeleteModel')}</button>
      </div>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button class="iconbtn" id="closeSettings">${t('close')}</button>
    </div>`;
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
  const row = modal.querySelector('#themeRow')!;
  for (const t of THEMES) {
    const card = document.createElement('div');
    card.className = 'theme-card' + (t.id === getState().settings.theme ? ' active' : '');
    card.innerHTML = `<div class="name">${t.name}</div><div style="font-size:11px;color:var(--text-muted)">${t.description}</div>`;
    card.addEventListener('click', async () => {
      await setTheme(t.id);
      modal.querySelectorAll('.theme-card').forEach((c) => c.classList.remove('active'));
      card.classList.add('active');
    });
    row.appendChild(card);
  }
  const langSelect = modal.querySelector('#languageSelect') as HTMLSelectElement;
  for (const l of availableLanguages()) {
    const opt = document.createElement('option');
    opt.value = l.id;
    opt.textContent = l.label;
    if (l.id === getState().settings.language) opt.selected = true;
    langSelect.appendChild(opt);
  }
  langSelect.addEventListener('change', async () => {
    await setLanguage(langSelect.value as 'en' | 'tr');
    // rebuild shell to apply language
    backdrop.remove();
    buildShell();
    await initStore();
    renderAll();
  });

  const range = modal.querySelector('#fontSizeRange') as HTMLInputElement;
  // 🐱 maskot aç/kapa
  const catToggle = modal.querySelector('#catMascotToggle') as HTMLInputElement | null;
  const catExtras = modal.querySelector('#catExtras') as HTMLDivElement | null;
  catToggle?.addEventListener('change', () => {
    localStorage.setItem('catjam:cat', catToggle.checked ? '1' : '0');
    (modal.querySelector('#catMascotToggle')!.closest('label')!.querySelector('span') as HTMLSpanElement).textContent = catToggle.checked ? t('catOn') : t('catOff');
    setCatEnabled(catToggle.checked);
    if (catExtras) catExtras.style.display = catToggle.checked ? 'block' : 'none';
    if (catToggle.checked) catPoke('happy');
  });
  const catSoundToggle = modal.querySelector('#catSoundToggle') as HTMLInputElement | null;
  catSoundToggle?.addEventListener('change', () => {
    setCatSound(catSoundToggle.checked);
    (modal.querySelector('#catSoundToggle')!.closest('label')!.querySelector('span') as HTMLSpanElement).textContent = catSoundToggle.checked ? t('catOn') : t('catOff');
    if (catSoundToggle.checked) catSay('Miyav! 🔊');
  });
  const catSkinSelect = modal.querySelector('#catSkinSelect') as HTMLSelectElement | null;
  catSkinSelect?.addEventListener('change', () => {
    setCatSkin(catSkinSelect.value);
    catPoke('happy');
  });
  const label = modal.querySelector('#fontSizeLabel') as HTMLSpanElement;
  range.addEventListener('input', () => {
    const v = Number(range.value);
    label.textContent = v + 'px';
    document.documentElement.style.setProperty('--font-size', v + 'px');
    // store
    getState().settings.fontSize = v;
    saveSetting('fontSize', v);
  });
  // Yazma profili
  const fontSelect = modal.querySelector('#editorFontSelect') as HTMLSelectElement;
  fontSelect.value = editorFontProfile;
  fontSelect.addEventListener('change', async () => {
    editorFontProfile = fontSelect.value as 'sans' | 'serif' | 'mono';
    applyEditorFont(editorFontProfile);
    await saveSetting('editorFontProfile', editorFontProfile);
  });
  // Özel tema (CSS)
  const cssInput = modal.querySelector('#customCssInput') as HTMLTextAreaElement;
  cssInput.value = customCss;
  cssInput.addEventListener('input', () => {
    applyCustomCss(cssInput.value);
    saveSetting('customCss', cssInput.value);
  });
  modal.querySelector('#customCssReset')!.addEventListener('click', () => {
    cssInput.value = '';
    applyCustomCss('');
    saveSetting('customCss', '');
  });
  document.documentElement.style.setProperty('--font-size', getState().settings.fontSize + 'px');
  modal.querySelector('#closeSettings')!.addEventListener('click', () => backdrop.remove());
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });

  // Voice engine settings
  const veSelect = modal.querySelector('#voiceEngineSelect') as HTMLSelectElement;
  const veHint = modal.querySelector('#voiceEngineHint') as HTMLDivElement;
  const vePrepare = modal.querySelector('#whisperPrepare') as HTMLButtonElement;
  const veModelWrap = modal.querySelector('#voiceModelWrap') as HTMLDivElement;
  const veModelSelect = modal.querySelector('#whisperModelSelect') as HTMLSelectElement;
  const veModelHint = modal.querySelector('#voiceModelHint') as HTMLDivElement;
  const updateVeUi = () => {
    veSelect.value = voiceEngine;
    veHint.textContent = voiceEngine === 'whisper' ? t('voiceDownloadHint') : t('voiceWebSpeechHint');
    if (voiceEngine === 'whisper') {
      veModelWrap.style.display = '';
      veModelSelect.value = whisperModelKey;
      const meta = WHISPER_MODEL_META[whisperModelKey];
      const cached = whisperCached(whisperModelKey);
      veModelHint.textContent = whisperReadyFor(whisperModelKey)
        ? `✅ ${t('voiceModelReady')} (${meta?.id}) — ${meta?.size} MB`
        : cached
          ? `💾 ${t('voiceModelReady')} (önbellekte) — tekrar yüklemek için 🎙'e bas`
          : `${t('voiceSmallRec')} — ${meta?.size} MB ${t('voiceNotCached')}, seçince bir kez indirilir.`;
      vePrepare.style.display = whisperCached(whisperModelKey) ? 'none' : 'inline-flex';
    } else {
      veModelWrap.style.display = 'none';
    }
  };
  updateVeUi();
  veSelect.addEventListener('change', async () => {
    voiceEngine = veSelect.value as 'webspeech' | 'whisper';
    await saveSetting('voiceEngine', voiceEngine);
    updateVeUi();
  });
  vePrepare.addEventListener('click', () => {
    void prepareWhisperModel().then(() => updateVeUi());
  });
  const veDelete = modal.querySelector('#whisperDeleteBtn') as HTMLButtonElement;
  veDelete.addEventListener('click', async () => {
    if (whisperState !== 'idle') return;
    if (!confirm(t('voiceDeleteConfirm'))) return;
    await deleteWhisperModel(whisperModelKey);
    veModelHint.textContent = `🗑 ${t('voiceDeleted')} (${WHISPER_MODEL_META[whisperModelKey]?.size} MB)`;
    vePrepare.style.display = 'inline-flex';
    setVoiceStatus(`🗑 ${t('voiceDeleted')}`);
    setTimeout(() => setVoiceStatus(''), 1800);
  });
  veModelSelect.addEventListener('change', async () => {
    const key = veModelSelect.value as 'tiny' | 'base' | 'small';
    if (key === whisperModelKey) return;
    if (whisperState === 'busy') { veModelSelect.value = whisperModelKey; return; }
    const ok = confirm(`${t('voiceModelSwitched')} (${WHISPER_MODEL_META[key]?.size} MB)`);
    if (!ok) { veModelSelect.value = whisperModelKey; return; }
    whisperModelKey = key;
    await saveSetting('whisperModel', key);
    prepareWhisperModel().then(() => updateVeUi());
  });
}

// Command palette
function openCommandPalette() {
  const backdrop = document.createElement('div');
  backdrop.className = 'cmd-backdrop';
  const panel = document.createElement('div');
  panel.className = 'cmd-panel';
  panel.innerHTML = `<input class="cmd-input" id="cmdInput" placeholder="${t('commandPlaceholder')}" autocomplete="off" />
    <div class="cmd-list" id="cmdList"></div>`;
  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);
  const input = panel.querySelector('#cmdInput') as HTMLInputElement;
  const list = panel.querySelector('#cmdList') as HTMLDivElement;

  function renderCmd(filter: string) {
    list.innerHTML = '';
    const f = filter.toLowerCase();
    const cmds = [
      { label: t('newNoteCmd'), hint: 'Ctrl+N', action: () => { newNoteAndRender(); } },
      { label: t('dailyNoteCmd'), hint: '', action: () => dailyNote() },
      { label: t('toggleGraph'), hint: '', action: () => showGraph() },
      { label: 'Local graph (active note)', hint: '', action: () => showGraph(true) },
      { label: t('toggleBacklinks'), hint: '', action: () => toggleSidePanel() },
      { label: t('openSettings'), hint: '', action: () => openSettings() },
      { label: t('modeEdit'), hint: '', action: () => { setEditorMode('edit'); applyMode('edit'); } },
      { label: t('modePreview'), hint: '', action: () => { setEditorMode('preview'); applyMode('preview'); } },
      { label: t('modeSplit'), hint: '', action: () => { setEditorMode('split'); applyMode('split'); } },
      { label: 'Add block reference ID', hint: '', action: () => addBlockIdToCurrentLine() },
    ].filter((c) => c.label.toLowerCase().includes(f));
    let candidateNotes: any[] = getState().notes;
    if (f) {
      candidateNotes = candidateNotes
        .map((n) => {
          const score = fuzzyScore(n.title, f);
          return score >= 0 ? { n, score } : null;
        })
        .filter(Boolean) as { n: any; score: number }[];
      candidateNotes.sort((a, b) => b.score - a.score);
      candidateNotes = candidateNotes.map((x) => x.n).slice(0, 12);
    } else {
      const recent = recentNoteIds.map((id) => getState().notes.find((n) => n.id === id && !n.deletedAt)).filter(Boolean) as any[];
      const rest = getState().notes.filter((n) => !recentNoteIds.includes(n.id)).slice(0, 12 - recent.length);
      candidateNotes = [...recent, ...rest].slice(0, 12);
    }
    const notes = candidateNotes;
    const items: HTMLElement[] = [];
    for (const c of cmds) {
      const it = document.createElement('div');
      it.className = 'cmd-item';
      it.innerHTML = `<span class="label">${escapeHtml(c.label)}</span><span class="hint">${c.hint}</span>`;
      it.addEventListener('click', () => { c.action(); backdrop.remove(); });
      list.appendChild(it); items.push(it);
    }
    for (const n of notes) {
      const it = document.createElement('div');
      it.className = 'cmd-item';
      it.innerHTML = `<span class="label">📄 ${escapeHtml(n.title)}</span>`;
      it.addEventListener('click', () => { setActive(n.id); renderAll(); backdrop.remove(); });
      list.appendChild(it); items.push(it);
    }
    if (items.length) items[0].classList.add('active');
    // keyboard nav
    input.onkeydown = (e) => {
      if (e.key === 'Escape') { backdrop.remove(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const cur = items.findIndex((it) => it.classList.contains('active'));
        items[cur]?.classList.remove('active');
        const next = e.key === 'ArrowDown' ? Math.min(cur + 1, items.length - 1) : Math.max(cur - 1, 0);
        items[next]?.classList.add('active');
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const cur = items.findIndex((it) => it.classList.contains('active'));
        items[cur]?.click();
      }
    };
  }
  input.addEventListener('input', () => renderCmd(input.value));
  renderCmd('');
  input.focus();
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
}

// Global shortcuts
function globalKeydown(e: KeyboardEvent) {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'p') { e.preventDefault(); openCommandPalette(); }
  if (mod && e.key.toLowerCase() === 'n') { e.preventDefault(); newNoteAndRender(); }
  if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); quickSwitcher(); }
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-backdrop,.cmd-backdrop').forEach((el) => el.remove());
    const sp = document.getElementById('sidePanel');
    if (sp && sp.classList.contains('open')) toggleSidePanel();
  }
}
function quickSwitcher() {
  // reuse command palette but note-focused: simpler open palette
  openCommandPalette();
}

// Subscribe
subscribe(() => {
  // apply font size
  document.documentElement.style.setProperty('--font-size', getState().settings.fontSize + 'px');
  renderNoteList();
  // keep textarea in sync only if not focused
  const ta = document.getElementById('editorTextarea') as HTMLTextAreaElement | null;
  const n = getActiveNote();
  if (ta && document.activeElement !== ta && n) {
    if (ta.value !== n.content) ta.value = n.content;
    const ti = document.getElementById('titleInput') as HTMLInputElement;
    if (ti && document.activeElement !== ti) ti.value = n.title;
    updatePreview(n.content);
  }
  // refresh side panel if visible (backlinks/outgoing links may change)
  const sp = document.getElementById('sidePanel');
  if (sp && sp.classList.contains('open')) renderSidePanel();
  // 🐱 kediyi kuyruğuyla selamla
  catAutoWiggle();
});

function openTasksModal() {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.maxWidth = '640px';
  modal.innerHTML = `
    <h3>${t('tasksTitle')}</h3>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">
      <button class="iconbtn" data-taskfilter="all" style="width:auto;height:auto;padding:4px 10px;font-size:12px;">${t('all')}</button>
      <button class="iconbtn" data-taskfilter="active" style="width:auto;height:auto;padding:4px 10px;font-size:12px;">${t('active')}</button>
      <button class="iconbtn" data-taskfilter="done" style="width:auto;height:auto;padding:4px 10px;font-size:12px;">${t('done')}</button>
    </div>
    <div id="tasksList" style="max-height:50vh;overflow:auto;"></div>
  `;
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
  let filter = 'all';
  const listEl = modal.querySelector('#tasksList') as HTMLDivElement;

  function collect() {
    const out: { noteId: string; noteTitle: string; lineIndex: number; done: boolean; text: string; state: string }[] = [];
    for (const note of getState().notes) {
      const lines = note.content.split('\n');
      lines.forEach((line, idx) => {
        const m = line.match(/^([\t ]*[-*+] \[)([ xX])(\] .*)$/);
        if (m) {
          out.push({ noteId: note.id, noteTitle: note.title, lineIndex: idx, done: m[2].toLowerCase() === 'x', text: m[3].slice(2).trim() || m[3].trim(), state: 'checkbox' });
          return;
        }
        // Logseq task states: - NOW xx, TODO xx, DOING xx, LATER xx, DONE xx
        const ls = line.match(/^[\t ]*(?:[-*+]\s+)?\s*(NOW|DOING|TODO|LATER|DONE)\s+(.+)$/i);
        if (ls) {
          const stateRaw = ls[1].toUpperCase();
          out.push({ noteId: note.id, noteTitle: note.title, lineIndex: idx, done: stateRaw === 'DONE', text: ls[2].trim(), state: stateRaw });
        }
      });
    }
    return out;
  }

  function render() {
    const tasks = collect().filter((t) => (filter === 'all' ? true : filter === 'active' ? !t.done : t.done));
    listEl.innerHTML = '';
    if (!tasks.length) { listEl.innerHTML = `<div style="color:var(--text-muted);font-size:13px;">${t('noTasks')}</div>`; return; }
    for (const t of tasks) {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '8px';
      row.style.padding = '6px 4px';
      row.style.borderBottom = '1px solid var(--border)';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = t.done;
      cb.addEventListener('change', async () => {
        const note = getState().notes.find((n) => n.id === t.noteId);
        if (!note) return;
        const lines = note.content.split('\n');
        if (t.state === 'checkbox') {
          const mm = lines[t.lineIndex]?.match(/^([\t ]*[-*+] \[)([ xX])(\].*)$/);
          if (!mm) return;
          lines[t.lineIndex] = `${mm[1]}${cb.checked ? 'x' : ' '}${mm[3]}`;
        } else {
          const mm = lines[t.lineIndex]?.match(/^([\t ]*(?:[-*+]\s+)?\s*)(NOW|DOING|TODO|LATER|DONE)(\s+.*)$/i);
          if (!mm) return;
          const next = cb.checked ? 'DONE' : (t.state === 'DONE' ? 'NOW' : t.state);
          lines[t.lineIndex] = `${mm[1]}${next}${mm[3]}`;
        }
        await updateNote(note.id, { content: lines.join('\n') });
        render();
        catPoke('happy');
      });
      if (t.state !== 'checkbox') {
        const chip = document.createElement('span');
        chip.textContent = t.state;
        chip.style.fontSize = '11px';
        chip.style.fontWeight = '600';
        chip.style.padding = '2px 8px';
        chip.style.borderRadius = '4px';
        const colors: Record<string, string> = { NOW: '#f59e0b', DOING: '#3b82f6', TODO: '#94a3b8', LATER: '#a78bfa', DONE: '#22c55e' };
        chip.style.background = (colors[t.state] || '#888') + '33';
        chip.style.color = colors[t.state] || '#888';
        row.appendChild(chip);
      }
      const text = document.createElement('span');
      text.style.flex = '1';
      text.style.color = t.done ? 'var(--text-muted)' : 'var(--text)';
      text.style.textDecoration = t.done ? 'line-through' : 'none';
      text.textContent = t.text;
      const title = document.createElement('span');
      title.style.color = 'var(--text-muted)';
      title.style.fontSize = '12px';
      title.style.cursor = 'pointer';
      title.textContent = t.noteTitle;
      title.addEventListener('click', () => { setActive(t.noteId); renderAll(); backdrop.remove(); });
      row.appendChild(cb);
      row.appendChild(text);
      row.appendChild(title);
      listEl.appendChild(row);
    }
  }

  modal.querySelectorAll('[data-taskfilter]').forEach((b) => {
    (b as HTMLElement).addEventListener('click', () => {
      filter = (b as HTMLElement).dataset.taskfilter!;
      modal.querySelectorAll('[data-taskfilter]').forEach((x) => x.classList.remove('active'));
      (b as HTMLElement).classList.add('active');
      render();
    });
  });
  modal.querySelector('[data-taskfilter="all"]')!.classList.add('active');
  render();

  modal.querySelector('#tasksList')?.parentElement;
  // add close at bottom
  const footer = document.createElement('div');
  footer.style.display = 'flex';
  footer.style.justifyContent = 'flex-end';
  footer.style.marginTop = '10px';
  const close = document.createElement('button');
  close.className = 'iconbtn';
  close.style.width = 'auto';
  close.style.padding = '4px 12px';
  close.textContent = 'Close';
  close.addEventListener('click', () => backdrop.remove());
  footer.appendChild(close);
  modal.appendChild(footer);

  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
}

function openTagsModal() {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = '<h3>Tags</h3><div id="tagsModalList" style="max-height:60vh;overflow:auto;"></div>';
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
  const list = modal.querySelector('#tagsModalList') as HTMLDivElement;
  // collect
  const counts = new Map<string, number>();
  const notesByTag = new Map<string, string[]>();
  for (const note of getState().notes) {
    for (const t of extractTags(note.content)) {
      counts.set(t, (counts.get(t) ?? 0) + 1);
      const arr = notesByTag.get(t) ?? [];
      arr.push(note.id);
      notesByTag.set(t, arr);
    }
  }
  const tags = [...counts.keys()].sort();
  if (!tags.length) { list.innerHTML = `<div style="color:var(--text-muted);font-size:13px;">${t('noTags')}</div>`; }
  else {
    for (const tg of tags) {
      const row = document.createElement('div');
      row.className = 'backlink-item';
      row.style.display = 'flex';
      row.style.justifyContent = 'space-between';
      row.style.paddingLeft = (tg.split('/').length - 1) * 12 + 8 + 'px';
      row.innerHTML = `<span>#${escapeHtml(tg)}</span><span style="color:var(--text-muted);font-size:12px;">${counts.get(tg)}</span>`;
      row.addEventListener('click', () => {
        setSearch('#' + tg);
        (document.getElementById('searchInput') as HTMLInputElement).value = '#' + tg;
        renderNoteList();
        backdrop.remove();
      });
      list.appendChild(row);
    }
  }
  const footer = document.createElement('div');
  footer.style.display = 'flex';
  footer.style.justifyContent = 'flex-end';
  footer.style.marginTop = '10px';
  const close = document.createElement('button');
  close.className = 'iconbtn';
  close.style.width = 'auto';
  close.style.padding = '4px 12px';
  close.textContent = 'Close';
  close.addEventListener('click', () => backdrop.remove());
  footer.appendChild(close);
  modal.appendChild(footer);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
}

function parseFrontMatter(content: string): { meta: Record<string, any>; body: string; has: boolean } {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: content, has: false };
  const meta: Record<string, any> = {};
  for (const line of m[1].split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if (!key || val === '') { if (key) meta[key] = ''; continue; }
    if (val.startsWith('[')) {
      try { meta[key] = JSON.parse(val.replace(/'/g, '"')); } catch { meta[key] = val; }
    } else if (val === 'true') {
      meta[key] = true;
    } else if (val === 'false') {
      meta[key] = false;
    } else if (!isNaN(Number(val))) {
      meta[key] = Number(val);
    } else {
      meta[key] = val.replace(/^['"]|['"]$/g, '');
    }
  }
  return { meta, body: content.slice(m[0].length), has: true };
}

function serializeFrontMatter(meta: Record<string, any>): string {
  const lines = Object.entries(meta).map(([k, v]) => {
    if (Array.isArray(v)) return `${k}: [${v.map((x) => (typeof x === 'string' ? JSON.stringify(x) : x)).join(', ')}]`;
    if (typeof v === 'string') return `${k}: ${JSON.stringify(v)}`;
    return `${k}: ${v}`;
  });
  return `---\n${lines.join('\n')}\n---\n\n`;
}

function updatePropsContent(meta: Record<string, any>, body: string) {
  const n = getActiveNote(); if (!n) return;
  const panel = document.getElementById('propsPanel')!;
  const hasProps = Object.keys(meta).length > 0;
  const fm = hasProps ? serializeFrontMatter(meta) : '';
  const content = fm + body;
  panel.dataset.body = body;
  const ta = document.getElementById('editorTextarea') as HTMLTextAreaElement;
  if (ta && document.activeElement !== ta) ta.value = content;
  clearTimeout(propsTimer);
  propsTimer = setTimeout(() => updateNote(n.id, { content }), 300);
}

function renderProps() {
  const panel = document.getElementById('propsPanel')!;
  const n = getActiveNote();
  panel.innerHTML = '';
  if (!n) return;
  const { meta, body } = parseFrontMatter(n.content);
  panel.dataset.body = body;
  for (const [k, v] of Object.entries(meta)) {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '6px';
    row.style.alignItems = 'center';
    row.style.marginBottom = '4px';
    const label = document.createElement('span');
    label.textContent = k;
    label.style.minWidth = '120px';
    label.style.color = 'var(--text-muted)';
    label.style.fontSize = '13px';
    const isArray = Array.isArray(v);
    const isBool = typeof v === 'boolean';
    const isNum = typeof v === 'number' && !isArray;
    const isDate = /date|created|updated/i.test(k) || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v));
    let input: HTMLInputElement;
    if (isBool) {
      input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = v;
      input.addEventListener('change', () => { meta[k] = input.checked; updatePropsContent(meta, panel.dataset.body || body); });
    } else {
      input = document.createElement('input');
      input.className = 'search-input';
      input.style.flex = '1';
      if (isNum) input.type = 'number';
      else if (isDate) input.type = 'date';
      if (isArray) input.placeholder = 'comma separated';
      input.value = isArray ? v.join(', ') : String(v ?? '');
      if (isDate && typeof v === 'string') {
        const m = v.match(/^\d{4}-\d{2}-\d{2}/);
        if (m) input.value = m[0];
      }
      input.addEventListener('input', () => {
        let val: any = input.value;
        if (isArray || val.includes(',')) val = val.split(',').map((x: string) => x.trim()).filter(Boolean);
        if (val === 'true') val = true;
        else if (val === 'false') val = false;
        else if (!isArray && !Array.isArray(val) && val !== '' && !isNaN(Number(val)) && input.type === 'number') val = Number(val);
        else if (isDate && val) val = new Date(val).toISOString();
        meta[k] = val;
        updatePropsContent(meta, panel.dataset.body || body);
      });
    }
    const del = document.createElement('button');
    del.className = 'iconbtn';
    del.textContent = '×';
    del.addEventListener('click', () => { delete meta[k]; updatePropsContent(meta, panel.dataset.body || body); renderProps(); });
    row.appendChild(label);
    row.appendChild(input);
    row.appendChild(del);
    panel.appendChild(row);
  }
  const addBtn = document.createElement('button');
  addBtn.className = 'iconbtn';
  addBtn.style.width = 'auto';
  addBtn.style.padding = '4px 10px';
  addBtn.style.fontSize = '12px';
  addBtn.textContent = `+ ${t('addProperty')}`;
  addBtn.addEventListener('click', () => {
    const key = prompt('Property name:');
    if (!key || Object.prototype.hasOwnProperty.call(meta, key)) return;
    meta[key] = '';
    updatePropsContent(meta, panel.dataset.body || body);
    renderProps();
  });
  panel.appendChild(addBtn);
}

function hideSuggestions() {
  const box = document.getElementById('suggestBox');
  if (box) box.style.display = 'none';
  suggestState = null;
}
function highlightSuggestion() {
  if (!suggestState) return;
  const box = document.getElementById('suggestBox')!;
  box.querySelectorAll('.suggest-item').forEach((el, i) => el.classList.toggle('active', i === suggestState!.index));
}
function acceptSuggestion() {
  if (!suggestState) return;
  const ta = document.getElementById('editorTextarea') as HTMLTextAreaElement;
  const item = suggestState.items[suggestState.index];
  const before = ta.value.slice(0, suggestState.triggerStart);
  const after = ta.value.slice(ta.selectionStart);
  const insertion = suggestState.type === 'wiki' ? `[[${item.insert}]] `
    : suggestState.type === 'tag' ? `#${item.insert} `
    : item.insert;
  ta.value = before + insertion + after;
  const newPos = before.length + insertion.length;
  ta.selectionStart = ta.selectionEnd = newPos;
  hideSuggestions();
  ta.dispatchEvent(new Event('input'));
}
// Slash (/) menü Itemsları: line başında / yazınca hızlı şablon ekleme
const SLASH_ITEMS: { label: string; keywords: string; insert: string }[] = [
  { label: 'H1  Başlık', keywords: 'h1 başlık balik heading', insert: '# ' },
  { label: 'H2  Alt başlık', keywords: 'h2 alt başlık subtitle heading', insert: '## ' },
  { label: 'H3  Küçük başlık', keywords: 'h3 küçük heading', insert: '### ' },
  { label: '☐  Görev işareti', keywords: 'görev task checkbox todo', insert: '- [ ] ' },
  { label: '⏰  NOW görev', keywords: 'now doing gorul ongoing', insert: '- NOW ' },
  { label: '•  Madde işareti', keywords: 'madde bullet liste list item', insert: '- ' },
  { label: '1.  Numaralı liste', keywords: 'numaralı ordered list liste', insert: '1. ' },
  { label: '❝  Alıntı', keywords: 'alıntı quote blockquote', insert: '> ' },
  { label: 'ℹ️  Bilgi callout', keywords: 'callout bilgi info not', insert: '> [!info] Başlık\n> içerik\n' },
  { label: '⚠️  Uyarı callout', keywords: 'callout uyarı warning dikkat', insert: '> [!warning] Başlık\n> içerik\n' },
  { label: '☑️  Başarım callout', keywords: 'callout başarım success', insert: '> [!success] Başlık\n> içerik\n' },
  { label: '▦  Tablo (3×3)', keywords: 'tablo table grid', insert: '| A | B | C |\n|---|---|---|\n|  |  |  |\n|  |  |  |\n' },
  { label: '`  Kod bloğu', keywords: 'kod code block blok', insert: '```\n\n```\n' },
  { label: '⬡  Mermaid diyagram', keywords: 'mermaid diyagram diagram grafik chart', insert: '```mermaid\nflowchart LR\n  A --> B\n```\n' },
  { label: '∑  Matematik bloğu', keywords: 'matematik math latex kaTeX', insert: '$$\n\n$$\n' },
  { label: '—  Ayıraç', keywords: 'ayıraç divider hr çizgi', insert: '---\n' },
  { label: '📅  Bugünün tarihi', keywords: 'tarih date bugün today', insert: '' },
];

function slashItems(filter: string) {
  const q = filter.trim().toLowerCase();
  const list = SLASH_ITEMS.filter((it) => !q || it.label.toLowerCase().includes(q) || it.keywords.includes(q));
  const today = new Date().toISOString().slice(0, 10);
  return list.slice(0, 10).map((it) => ({ label: it.label, insert: it.keywords.includes('today') || it.keywords.includes('bugün') ? today : it.insert }));
}

function updateSuggestions() {
  const ta = document.getElementById('editorTextarea') as HTMLTextAreaElement;
  if (!ta) return;
  const pos = ta.selectionStart;
  const before = ta.value.slice(0, pos);
  // slash (/) menüsü: satır başında "/" + filtre
  let m = before.match(/(^|\n)([ \t]*)\/([\wçğıöşü-]*)$/i);
  if (m) {
    const filter = m[3];
    const triggerStart = pos - 1 - filter.length;
    const items = slashItems(filter);
    if (items.length) {
      showSuggest(items, triggerStart, 'slash');
      return;
    }
  }
  m = before.match(/\[\[([^\]]*)$/);
  if (m) {
    const prefix = m[1];
    const triggerStart = pos - m[0].length;
    const items = getState().notes
      .filter((n) => n.title.toLowerCase().includes(prefix.toLowerCase()))
      .slice(0, 8)
      .map((n) => ({ label: n.title, insert: n.title }));
    if (items.length) {
      showSuggest(items, triggerStart, 'wiki');
      return;
    }
  }
  m = before.match(/#([\w-]*)$/);
  if (m) {
    const prev = before[before.length - m[0].length - 1];
    if (!prev || /\s/.test(prev)) {
      const prefix = m[1];
      const triggerStart = pos - m[0].length;
      const allTags = [...new Set(getState().notes.flatMap((n) => extractTags(n.content)))];
      const items = allTags
        .filter((t) => t.toLowerCase().startsWith(prefix.toLowerCase()))
        .slice(0, 8)
        .map((t) => ({ label: '#' + t, insert: t }));
      if (items.length) {
        showSuggest(items, triggerStart, 'tag');
        return;
      }
    }
  }
  hideSuggestions();
}
function showSuggest(items: { label: string; insert: string }[], triggerStart: number, type: 'wiki' | 'tag' | 'slash') {
  suggestState = { triggerStart, items, index: 0, type };
  const box = document.getElementById('suggestBox')!;
  box.innerHTML = '';
  items.forEach((it, i) => {
    const row = document.createElement('div');
    row.className = 'suggest-item' + (i === 0 ? ' active' : '');
    row.textContent = it.label;
    row.addEventListener('mousedown', (e) => { e.preventDefault(); acceptSuggestionAt(i); });
    box.appendChild(row);
  });
  box.style.display = '';
}
function acceptSuggestionAt(i: number) {
  if (suggestState) suggestState.index = i;
  acceptSuggestion();
}
function insertAtCursor(text: string) {
  const ta = document.getElementById('editorTextarea') as HTMLTextAreaElement | null;
  if (!ta) return;
  const start = ta.selectionStart ?? ta.value.length;
  const end = ta.selectionEnd ?? start;
  const needsSpace = start > 0 && !/[\s\n({\[>#*-]$/.test(ta.value[start - 1]);
  const chunk = (needsSpace ? ' ' : '') + text;
  ta.value = ta.value.slice(0, start) + chunk + ta.value.slice(end);
  const pos = start + chunk.length;
  ta.selectionStart = ta.selectionEnd = pos;
  ta.dispatchEvent(new Event('input'));
}
async function handleFiles(files: File[]) {
  if (!files.length) return;
  for (const file of files) {
    if (file.type.startsWith('image/')) {
      const handle = await getVaultHandle();
      if (handle && (await ensureVaultPermission(handle))) {
        const filename = await saveImageToVault(handle, file);
        insertAtCursor(`\n![[${filename}]]\n`);
      } else {
        const id = await saveImage(file);
        insertAtCursor(`\n![${file.name}](catjam-image:${id})\n`);
      }
    } else {
      const text = await file.text();
      insertAtCursor(`\n### ${file.name}\n\`\`\`\n${text}\n\`\`\`\n`);
    }
  }
}
async function handleDrop(e: DragEvent) {
  const files = Array.from(e.dataTransfer?.files || []);
  if (!files.length) {
    const text = e.dataTransfer?.getData('text/plain');
    if (text) insertAtCursor(text);
    return;
  }
  await handleFiles(files);
}

function openTemplatesModal() {
  const templates = [
    { name: 'Meeting Notes', content: '# Meeting Notes\n\nDate: {{date}}\n\n## Attendees\n- \n\n## Agenda\n- \n\n## Action items\n- [ ] \n' },
    { name: 'Project', content: '# Project\n\n## Goal\n\n## Tasks\n- [ ] \n\n## Resources\n- \n' },
    { name: 'Research Note', content: '# Research\n\n## Source\n\n## Summary\n\n## Key takeaways\n- \n\n## Links\n- \n' },
    { name: 'Journal', content: '# Journal\n\n{{date}}\n\n## Mood\n\n## Highlights\n- \n\n## Gratitude\n- \n' },
    { name: 'Blank with Properties', content: '---\ntags: []\nstatus: draft\n---\n\n# New note\n\n' },
  ];
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = '<h3>Templates</h3><div id="tmplList" style="max-height:55vh;overflow:auto;"></div>';
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
  const list = modal.querySelector('#tmplList') as HTMLDivElement;
  for (const tp of templates) {
    const row = document.createElement('div');
    row.className = 'backlink-item';
    row.style.display = 'flex';
    row.style.flexDirection = 'column';
    row.style.gap = '2px';
    row.innerHTML = `<div style="color:var(--text-h);font-weight:500;">${escapeHtml(tp.name)}</div><div style="color:var(--text-muted);font-size:12px;white-space:pre-wrap;">${escapeHtml(tp.content.slice(0, 140))}…</div>`;
    row.addEventListener('click', async () => {
      const title = prompt('Note title', tp.name);
      if (!title) return;
      const note = await createNote(title);
      await updateNote(note.id, { content: tp.content.replace(/{{date}}/g, new Date().toISOString().slice(0, 10)) });
      renderAll();
      backdrop.remove();
    });
    list.appendChild(row);
  }
  const footer = document.createElement('div');
  footer.style.display = 'flex';
  footer.style.justifyContent = 'flex-end';
  footer.style.marginTop = '10px';
  const close = document.createElement('button');
  close.className = 'iconbtn';
  close.style.width = 'auto';
  close.style.padding = '4px 12px';
  close.textContent = 'Close';
  close.addEventListener('click', () => backdrop.remove());
  footer.appendChild(close);
  modal.appendChild(footer);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
}

function openVersionsModal() {
  const n = getActiveNote();
  if (!n) return;
  (async () => {
    const versions = (await db.versions.where('noteId').equals(n.id).toArray()).sort((a, b) => b.createdAt - a.createdAt);
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.maxWidth = '680px';
    modal.innerHTML = '<h3>Version history</h3><div id="versionsList" style="max-height:55vh;overflow:auto;"></div>';
    const list = modal.querySelector('#versionsList') as HTMLDivElement;
    if (!versions.length) list.innerHTML = '<div style="color:var(--text-muted);font-size:13px;">No saved versions yet.</div>';
    for (const v of versions) {
      const row = document.createElement('div');
      row.className = 'backlink-item';
      row.style.display = 'flex';
      row.style.flexDirection = 'column';
      row.style.gap = '2px';
      row.innerHTML = `<div style="color:var(--text-h);font-weight:500;">${new Date(v.createdAt).toLocaleString()}</div><div style="color:var(--text-muted);font-size:12px;white-space:pre-wrap;">${escapeHtml(v.content.slice(0, 160))}…</div>`;
      row.addEventListener('click', async () => {
        if (!confirm('Restore this version? Current content will be overwritten.')) return;
        await updateNote(n.id, { content: v.content, title: v.title });
        renderAll();
        backdrop.remove();
      });
      list.appendChild(row);
    }
    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';
    footer.style.marginTop = '10px';
    const close = document.createElement('button');
    close.className = 'iconbtn';
    close.style.width = 'auto';
    close.style.padding = '4px 12px';
    close.textContent = 'Close';
    close.addEventListener('click', () => backdrop.remove());
    footer.appendChild(close);
    modal.appendChild(footer);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  })();
}

function roamBlocksToMd(blocks: any[], depth = 0): string[] {
  const out: string[] = [];
  if (!Array.isArray(blocks)) return out;
  for (const b of blocks) {
    const str = typeof b === 'string' ? b : (b.string ?? b.str ?? b.text ?? '');
    const uid = b.uid || b.id || '';
    const suffix = uid ? ` ^${String(uid).replace(/[^A-Za-z0-9-]/g, '')}` : '';
    out.push('  '.repeat(depth) + '- ' + String(str) + suffix);
    if (Array.isArray(b.children)) out.push(...roamBlocksToMd(b.children, depth + 1));
  }
  return out;
}

async function importRoamJson(file: File): Promise<void> {
  const data = JSON.parse(await file.text());
  const pages = Array.isArray(data) ? data : (Array.isArray(data.pages) ? data.pages : []);
  const handle = await getVaultHandle();
  const permitted = handle ? await ensureVaultPermission(handle) : false;
  for (const page of pages) {
    const title = (page.title || page.name || 'Untitled').trim() || 'Untitled';
    const lines = [];
    lines.push('# ' + title);
    lines.push('');
    lines.push(...roamBlocksToMd(page.children || []));
    const content = lines.join('\n').trim() + '\n';
    const note = {
      id: crypto.randomUUID(),
      title,
      content,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      order: Date.now(),
    } as any;
    if (handle && permitted) {
      const safe = title.replace(/[\/:*?"<>|]/g, '-');
      const path = await uniqueVaultPath(handle, safe);
      await createVaultNote(handle, path, content);
      note.path = path;
    }
    await db.notes.put(note);
  }
  await loadImages();
  if (handle && permitted) await loadVaultImages(handle);
  await initStore();
  renderAll();
}

function addBlockIdToCurrentLine() {
  const ta = document.getElementById('editorTextarea') as HTMLTextAreaElement;
  if (!ta) return;
  const pos = ta.selectionStart;
  const lines = ta.value.split('\n');
  // find line index
  let lineIndex = 0;
  let acc = 0;
  for (let i = 0; i < lines.length; i++) {
    if (pos <= acc + lines[i].length) { lineIndex = i; break; }
    acc += lines[i].length + 1;
  }
  if (/\^[A-Za-z0-9-]+\s*$/.test(lines[lineIndex])) return;
  const id = crypto.randomUUID().slice(0, 8);
  lines[lineIndex] = lines[lineIndex].trimEnd() + ' ^' + id;
  ta.value = lines.join('\n');
  ta.selectionStart = ta.selectionEnd = pos + (' ^' + id).length;
  ta.dispatchEvent(new Event('input'));
}

function fuzzyScore(text: string, query: string): number {
  if (!query) return 0;
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  let i = 0;
  let score = 0;
  let streak = 0;
  for (let k = 0; k < t.length && i < q.length; k++) {
    if (t[k] === q[i]) {
      score += 1 + streak * 0.4;
      streak++;
      i++;
    } else {
      streak = 0;
    }
  }
  return i === q.length ? score : -1;
}

async function main() {
  // 🐱 kedi → not açma ve pomodoro bitiş köprüsü
  window.addEventListener('catjam:opennote', (e) => {
    const id = (e as CustomEvent).detail?.id as string;
    const note = getState().notes.find((n) => n.id === id && !n.deletedAt);
    if (!note) return;
    setActive(note.id);
    renderAll();
  });
  window.addEventListener('catjam:pomo-done', () => showToast('🍅 ' + t('pomoDone')));
  buildShell();
  await initStore();
  try {
    const favRow = await db.settings.get('favorites');
    if (favRow && Array.isArray(favRow.value)) favorites = favRow.value.filter((id: string) => getState().notes.some((n) => n.id === id));
  } catch { favorites = []; }
  try {
    const veRow = await db.settings.get('voiceEngine');
    if (veRow && (veRow.value === 'whisper' || veRow.value === 'webspeech')) voiceEngine = veRow.value;
  } catch { /* default */ }
  try {
    const wmRow = await db.settings.get('whisperModel');
    if (wmRow && WHISPER_MODEL_META[wmRow.value]) whisperModelKey = wmRow.value;
  } catch { /* default */ }
  try {
    const efRow = await db.settings.get('editorFontProfile');
    if (efRow && ['sans', 'serif', 'mono'].includes(efRow.value)) editorFontProfile = efRow.value;
  } catch { /* default */ }
  applyEditorFont(editorFontProfile);
  try {
    const csRow = await db.settings.get('customCss');
    if (csRow && typeof csRow.value === 'string') applyCustomCss(csRow.value);
  } catch { /* default */ }
  document.documentElement.style.setProperty('--font-size', getState().settings.fontSize + 'px');
  if (!getState().notes.length) {
    await createNote(t('welcome'));
    const n = getActiveNote()!;
    await updateNote(n.id, { content: WELCOME });
  }
  renderAll();
}

const WELCOME = `# Welcome to Cat Jam

Obsidian-style markdown notes, in your browser.

Try:
- [[Wiki Links]] to connect notes
- #tags for organization
- \`Ctrl+P\` command palette
- \`Ctrl+N\` new note
- \`Ctrl+O\` quick switcher

Switch themes in settings.
`;

main().catch((err) => {
  console.error(err);
  app.innerHTML = `<pre style="color:red;padding:20px;">${err?.stack || err}</pre>`;
});
