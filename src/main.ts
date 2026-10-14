import './style.css';
import { initStore, getState, subscribe, createNote, updateNote, deleteNote, setActive, setSearch, setTheme, setEditorMode, getActiveNote, backlinksOf, findNoteByTitle, filteredNotes, openVault, setLanguage, reorderNotes } from './store';
import { renderMarkdown, extractWikiLinks, extractTags } from './markdown';
import { THEMES } from './themes';
import { saveSetting, db } from './db';
import { t, availableLanguages } from './i18n';
import { saveImage, loadImages } from './images';
import { getVaultHandle, ensureVaultPermission, saveImageToVault, uniqueVaultPath, createVaultNote, loadVaultImages } from './vault';

let saveTimer: any = null;
let propsTimer: any = null;
let suggestState: { triggerStart: number; items: { label: string; insert: string }[]; index: number; type: 'wiki' | 'tag' } | null = null;
let groupByFolder = false;
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
    <button class="iconbtn" id="btnSettings" title="${t('settings')}">⚙</button>
  `;
  app.appendChild(tb);

  // sidebar backdrop (mobile)
  const backdrop = document.createElement('div');
  backdrop.className = 'sidebar-backdrop';
  backdrop.id = 'sidebarBackdrop';
  app.appendChild(backdrop);

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
    </div>
  `;

  // main
  const main = document.createElement('div');
  main.className = 'main';
  main.innerHTML = `
    <div class="editor-header" id="editorHeader">
      <input class="title-input" id="titleInput" placeholder="${t('untitled')}" />
      <div class="mode-toggle" id="modeToggle">
        <button data-mode="edit">${t('edit')}</button>
        <button data-mode="preview">${t('preview')}</button>
        <button data-mode="split">${t('split')}</button>
      </div>
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
      <h3 style="margin:0;">${t('backlinksTitle')}</h3>
      <button class="iconbtn" id="closeSidePanel" title="${t('close')}">✕</button>
    </div>
    <div id="backlinksList"></div>
    <h3 style="margin-top:16px;">${t('outline')}</h3>
    <div id="outlineList"></div>
    <h3 style="margin-top:16px;">${t('outgoing')}</h3>
    <div id="outgoingList"></div>
    <h3 style="margin-top:16px;">${t('currentTags')}</h3>
    <div id="tagsList"></div>
  `;
  app.appendChild(side);

  const overlay = document.createElement('div');
  overlay.id = 'dropOverlay';
  overlay.className = 'drop-overlay';
  overlay.innerHTML = `<div>${t('dropHint')}</div>`;
  overlay.style.display = 'none';
  app.appendChild(overlay);

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
  document.getElementById('btnBacklinks')!.addEventListener('click', () => toggleSidePanel());
  document.getElementById('closeSidePanel')!.addEventListener('click', () => toggleSidePanel());
  document.getElementById('btnGraph')!.addEventListener('click', () => showGraph());
  document.getElementById('btnPalette')!.addEventListener('click', () => openCommandPalette());
  document.getElementById('btnTasks')!.addEventListener('click', () => openTasksModal());
  document.getElementById('btnTags')!.addEventListener('click', () => openTagsModal());
  document.getElementById('btnGroupFolders')!.addEventListener('click', () => { groupByFolder = !groupByFolder; renderNoteList(); });
  document.getElementById('btnTemplates')!.addEventListener('click', () => openTemplatesModal());
  document.getElementById('btnSettings')!.addEventListener('click', () => openSettings());
  document.getElementById('btnDelete')!.addEventListener('click', async () => {
    const n = getActiveNote(); if (!n) return;
    if (!confirm(`Delete "${n.title}"?`)) return;
    await deleteNote(n.id);
    renderAll();
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
    // debounce
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => updateNote(n.id, { title: titleInput.value }), 400);
  });
  titleInput.addEventListener('blur', () => {
    const n = getActiveNote(); if (!n) return;
    updateNote(n.id, { title: titleInput.value });
  });

  const editorTextarea = document.getElementById('editorTextarea') as HTMLTextAreaElement;
  editorTextarea.addEventListener('input', () => {
    const n = getActiveNote(); if (!n) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => updateNote(n.id, { content: editorTextarea.value }), 500);
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

function updatePreview(content: string) {
  const pc = document.getElementById('previewContent')!;
  pc.innerHTML = renderMarkdown(resolveRoamEmbeds(content));
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
  // Roam queries {{[[query]]: term}}
  out = out.replace(/\{\{\[\[query\]\]:\s*(.*?)\}\}/g, (_m, term) => {
    const t = String(term).trim().toLowerCase();
    const matches = getState().notes.filter((n) => n.title.toLowerCase().includes(t) || n.content.toLowerCase().includes(t));
    if (!matches.length) return '_(no results)_';
    return matches.map((n) => `- [[${n.title}]]`).join('\n');
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
      await deleteNote(n.id);
      renderAll();
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
  const titleInput = document.getElementById('titleInput') as HTMLInputElement;
  const textarea = document.getElementById('editorTextarea') as HTMLTextAreaElement;
  if (!n) {
    titleInput.value = '';
    textarea.value = '';
    document.getElementById('previewContent')!.innerHTML = '';
    return;
  }
  titleInput.value = n.title;
  textarea.value = n.content;
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
  bl.innerHTML = ''; ol.innerHTML = ''; tl.innerHTML = ''; outl.innerHTML = '';
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
    item.textContent = b.title;
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
}

function renderAll() {
  renderNoteList();
  renderEditor();
  if (currentView === 'graph') drawGraph();
}

function showGraph() {
  currentView = 'graph';
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
  const notes = getState().notes;
  graphNodes = notes.map((n) => ({ id: n.id, title: n.title, x: Math.random() * 400 + 100, y: Math.random() * 300 + 100, vx: 0, vy: 0 }));
  graphEdges = [];
  for (const n of notes) {
    for (const l of extractWikiLinks(n.content)) {
      const target = findNoteByTitle(l);
      if (target) graphEdges.push({ source: n.id, target: target.id });
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
  const label = modal.querySelector('#fontSizeLabel') as HTMLSpanElement;
  range.addEventListener('input', () => {
    const v = Number(range.value);
    label.textContent = v + 'px';
    document.documentElement.style.setProperty('--font-size', v + 'px');
    // store
    getState().settings.fontSize = v;
    saveSetting('fontSize', v);
  });
  document.documentElement.style.setProperty('--font-size', getState().settings.fontSize + 'px');
  modal.querySelector('#closeSettings')!.addEventListener('click', () => backdrop.remove());
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
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
      { label: t('toggleBacklinks'), hint: '', action: () => toggleSidePanel() },
      { label: t('openSettings'), hint: '', action: () => openSettings() },
      { label: t('modeEdit'), hint: '', action: () => { setEditorMode('edit'); applyMode('edit'); } },
      { label: t('modePreview'), hint: '', action: () => { setEditorMode('preview'); applyMode('preview'); } },
      { label: t('modeSplit'), hint: '', action: () => { setEditorMode('split'); applyMode('split'); } },
      { label: 'Add block reference ID', hint: '', action: () => addBlockIdToCurrentLine() },
    ].filter((c) => c.label.toLowerCase().includes(f));
    const notes = getState().notes.filter((n) => n.title.toLowerCase().includes(f)).slice(0, 12);
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
    const out: { noteId: string; noteTitle: string; lineIndex: number; done: boolean; text: string }[] = [];
    for (const note of getState().notes) {
      const lines = note.content.split('\n');
      lines.forEach((line, idx) => {
        const m = line.match(/^([\t ]*[-*+] \[)([ xX])(\] .*)$/);
        if (m) {
          out.push({ noteId: note.id, noteTitle: note.title, lineIndex: idx, done: m[2].toLowerCase() === 'x', text: m[3].slice(2).trim() || m[3].trim() });
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
        const mm = lines[t.lineIndex]?.match(/^([\t ]*[-*+] \[)([ xX])(\].*)$/);
        if (!mm) return;
        lines[t.lineIndex] = `${mm[1]}${cb.checked ? 'x' : ' '}${mm[3]}`;
        await updateNote(note.id, { content: lines.join('\n') });
        render();
      });
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
    for (const t of tags) {
      const row = document.createElement('div');
      row.className = 'backlink-item';
      row.style.display = 'flex';
      row.style.justifyContent = 'space-between';
      row.innerHTML = `<span>#${escapeHtml(t)}</span><span style="color:var(--text-muted);font-size:12px;">${counts.get(t)}</span>`;
      row.addEventListener('click', () => {
        setSearch('#' + t);
        (document.getElementById('searchInput') as HTMLInputElement).value = '#' + t;
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
    const input = document.createElement('input');
    input.className = 'search-input';
    input.style.flex = '1';
    input.value = Array.isArray(v) ? v.join(', ') : String(v ?? '');
    input.addEventListener('input', () => {
      let val: any = input.value;
      if (val.includes(',')) val = val.split(',').map((x: string) => x.trim()).filter(Boolean);
      if (val === 'true') val = true;
      else if (val === 'false') val = false;
      else if (val !== '' && !isNaN(Number(val)) && !Array.isArray(val)) val = Number(val);
      meta[k] = val;
      updatePropsContent(meta, panel.dataset.body || body);
    });
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
  const insertion = suggestState.type === 'wiki' ? `[[${item.insert}]] ` : `#${item.insert} `;
  ta.value = before + insertion + after;
  const newPos = before.length + insertion.length;
  ta.selectionStart = ta.selectionEnd = newPos;
  hideSuggestions();
  ta.dispatchEvent(new Event('input'));
}
function updateSuggestions() {
  const ta = document.getElementById('editorTextarea') as HTMLTextAreaElement;
  if (!ta) return;
  const pos = ta.selectionStart;
  const before = ta.value.slice(0, pos);
  let m = before.match(/\[\[([^\]]*)$/);
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
function showSuggest(items: { label: string; insert: string }[], triggerStart: number, type: 'wiki' | 'tag') {
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
  const ta = document.getElementById('editorTextarea') as HTMLTextAreaElement;
  const s = ta.selectionStart;
  ta.value = ta.value.slice(0, s) + text + ta.value.slice(ta.selectionEnd);
  ta.selectionStart = ta.selectionEnd = s + text.length;
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
  if (/\\^[A-Za-z0-9-]+\\s*$/.test(lines[lineIndex])) return;
  const id = crypto.randomUUID().slice(0, 8);
  lines[lineIndex] = lines[lineIndex].trimEnd() + ' ^' + id;
  ta.value = lines.join('\n');
  ta.selectionStart = ta.selectionEnd = pos + (' ^' + id).length;
  ta.dispatchEvent(new Event('input'));
}

async function main() {
  buildShell();
  await initStore();
  // apply settings font size
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
