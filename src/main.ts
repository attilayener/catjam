import './style.css';
import { initStore, getState, subscribe, createNote, updateNote, deleteNote, setActive, setSearch, setTheme, setEditorMode, getActiveNote, backlinksOf, findNoteByTitle, filteredNotes, openVault, setLanguage } from './store';
import { renderMarkdown, extractWikiLinks, extractTags } from './markdown';
import { THEMES } from './themes';
import { saveSetting } from './db';
import { t, availableLanguages } from './i18n';

let saveTimer: any = null;
let propsTimer: any = null;
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
    </div>
    <div class="note-list" id="noteList"></div>
    <div class="sidebar-foot">
      <button class="iconbtn" id="btnSidebarNew" title="${t('newNoteBtn')}">＋ ${t('newNoteBtn')}</button>
      <button class="iconbtn" id="btnSidebarDaily" title="${t('dailyNote')}">📅 ${t('dailyNote')}</button>
      <button class="iconbtn" id="btnOpenVault" title="${t('openVault')}">📁 ${t('openVault')}</button>
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
    </div>
    <div id="propsPanel" style="display:none;padding:8px 12px;border-bottom:1px solid var(--border);background:var(--panel);"></div>
    <div class="editor-body" id="editorBody">
      <div class="editor-pane" id="editorPane">
        <textarea class="editor-textarea" id="editorTextarea" placeholder="${t('editorPlaceholder')}"></textarea>
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
  document.getElementById('btnBacklinks')!.addEventListener('click', () => toggleSidePanel());
  document.getElementById('closeSidePanel')!.addEventListener('click', () => toggleSidePanel());
  document.getElementById('btnGraph')!.addEventListener('click', () => showGraph());
  document.getElementById('btnPalette')!.addEventListener('click', () => openCommandPalette());
  document.getElementById('btnTasks')!.addEventListener('click', () => openTasksModal());
  document.getElementById('btnTags')!.addEventListener('click', () => openTagsModal());
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
  pc.innerHTML = renderMarkdown(content);
}

function renderNoteList() {
  const list = document.getElementById('noteList')!;
  list.innerHTML = '';
  const notes = filteredNotes();
  if (!notes.length) {
    const h = document.createElement('div'); h.className = 'empty-hint'; h.textContent = getState().search ? t('emptyNoMatch') : t('emptyNoNotes'); list.appendChild(h); return;
  }
  for (const n of notes) {
    const item = document.createElement('div');
    item.className = 'note-item' + (n.id === getState().activeId ? ' active' : '');
    const date = new Date(n.updatedAt).toLocaleString();
    item.innerHTML = `<div class="title">${escapeHtml(n.title)}</div><div class="meta">${date}</div>`;
    item.addEventListener('click', () => { setActive(n.id); renderAll(); toggleSidebar(false); });
    list.appendChild(item);
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
    const re = /^(#{1,6})\\s+(.+)$/gm;
    let i = 0;
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(n.content))) {
      const text = mm[2].trim();
      const slug = text.toLowerCase().replace(/[^\\w]+/g, '-').replace(/^-|-$/g, '') || 'heading';
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
        const idx = n.content.split('\\n').findIndex((l) => l.trim() === '#'.repeat(h.level) + ' ' + h.text || l.trim().startsWith('#'.repeat(h.level) + ' ' + h.text));
        if (idx >= 0) {
          const lines = n.content.split('\\n');
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
  const m = content.match(/^---\\r?\\n([\\s\\S]*?)\\r?\\n---\\r?\\n?/);
  if (!m) return { meta: {}, body: content, has: false };
  const meta: Record<string, any> = {};
  for (const line of m[1].split('\\n')) {
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
  return `---\\n${lines.join('\\n')}\\n---\\n\\n`;
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
