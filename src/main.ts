import './style.css';
import { initStore, getState, subscribe, createNote, updateNote, deleteNote, setActive, setSearch, setTheme, setEditorMode, getActiveNote, backlinksOf, findNoteByTitle, filteredNotes, openVault } from './store';
import { renderMarkdown, extractWikiLinks } from './markdown';
import { THEMES } from './themes';
import { saveSetting } from './db';

let saveTimer: any = null;
let currentView: 'editor' | 'graph' = 'editor';


const app = document.querySelector<HTMLDivElement>('#app')!;

function buildShell() {
  app.innerHTML = '';
  const tb = document.createElement('div');
  tb.className = 'topbar';
  tb.innerHTML = `
    <button class="iconbtn" id="hamburger" title="Menu">☰</button>
    <span class="brand">Cat Jam</span>
    <div class="spacer"></div>
    <button class="iconbtn" id="btnNew" title="New note (Ctrl+N)">＋</button>
    <button class="iconbtn" id="btnBacklinks" title="Backlinks">↔</button>
    <button class="iconbtn" id="btnGraph" title="Graph view">⬢</button>
    <button class="iconbtn" id="btnPalette" title="Command palette (Ctrl+P)">⌘</button>
    <button class="iconbtn" id="btnSettings" title="Settings">⚙</button>
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
      <input class="search-input" id="searchInput" placeholder="Search notes…" />
    </div>
    <div class="note-list" id="noteList"></div>
    <div class="sidebar-foot">
      <button class="iconbtn" id="btnSidebarNew" title="New note">＋ Note</button>
      <button class="iconbtn" id="btnSidebarDaily" title="Daily note">📅 Daily</button>
      <button class="iconbtn" id="btnOpenVault" title="Open vault folder">📁 Vault</button>
    </div>
  `;

  // main
  const main = document.createElement('div');
  main.className = 'main';
  main.innerHTML = `
    <div class="editor-header" id="editorHeader">
      <input class="title-input" id="titleInput" placeholder="Untitled" />
      <div class="mode-toggle" id="modeToggle">
        <button data-mode="edit">Edit</button>
        <button data-mode="preview">Preview</button>
        <button data-mode="split">Split</button>
      </div>
      <button class="iconbtn" id="btnDelete" title="Delete note">🗑</button>
    </div>
    <div class="editor-body" id="editorBody">
      <div class="editor-pane" id="editorPane">
        <textarea class="editor-textarea" id="editorTextarea" placeholder="Start writing… Use [[Wiki Links]] and #tags"></textarea>
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
  side.innerHTML = `<h3>Backlinks</h3><div id="backlinksList"></div><h3 style="margin-top:16px;">Outgoing links</h3><div id="outgoingList"></div>`;
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
  document.getElementById('btnGraph')!.addEventListener('click', () => showGraph());
  document.getElementById('btnPalette')!.addEventListener('click', () => openCommandPalette());
  document.getElementById('btnSettings')!.addEventListener('click', () => openSettings());
  document.getElementById('btnDelete')!.addEventListener('click', async () => {
    const n = getActiveNote(); if (!n) return;
    if (!confirm(`Delete "${n.title}"?`)) return;
    await deleteNote(n.id);
    renderAll();
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
  document.getElementById('sidePanel')!.classList.toggle('open');
  renderSidePanel();
}

function newNoteAndRender() {
  createNote().then(() => { renderAll(); saveTimer = null; });
  toggleSidebar(false);
}
function dailyNote() {
  const d = new Date();
  const title = `Daily ${d.toISOString().slice(0, 10)}`;
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
    const h = document.createElement('div'); h.className = 'empty-hint'; h.textContent = getState().search ? 'No matches.' : 'No notes yet. Create one.'; list.appendChild(h); return;
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
}

function renderSidePanel() {
  const n = getActiveNote();
  const bl = document.getElementById('backlinksList')!;
  const ol = document.getElementById('outgoingList')!;
  bl.innerHTML = ''; ol.innerHTML = '';
  if (!n) return;
  const links = extractWikiLinks(n.content);
  // outgoing
  for (const l of links) {
    const target = findNoteByTitle(l);
    const item = document.createElement('div');
    item.className = 'backlink-item';
    item.innerHTML = `${escapeHtml(l)} ${target ? '' : '<span style="color:var(--text-muted)">(not created)</span>'}`;
    item.addEventListener('click', () => openWikiTarget(l));
    ol.appendChild(item);
  }
  if (!links.length) ol.innerHTML = '<div style="color:var(--text-muted);font-size:13px;">None</div>';
  // backlinks
  const bls = backlinksOf(n.title);
  for (const b of bls) {
    const item = document.createElement('div');
    item.className = 'backlink-item';
    item.textContent = b.title;
    item.addEventListener('click', () => { setActive(b.id); renderAll(); });
    bl.appendChild(item);
  }
  if (!bls.length) bl.innerHTML = '<div style="color:var(--text-muted);font-size:13px;">None</div>';
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
  modal.innerHTML = `<h3>Settings</h3>
    <div style="margin-bottom:12px;">
      <div style="font-size:13px;color:var(--text-muted);margin-bottom:6px;">Theme</div>
      <div class="row" id="themeRow"></div>
    </div>
    <div style="margin-bottom:12px;">
      <div style="font-size:13px;color:var(--text-muted);margin-bottom:6px;">Font size</div>
      <input type="range" min="12" max="24" value="${getState().settings.fontSize}" id="fontSizeRange" />
      <span id="fontSizeLabel">${getState().settings.fontSize}px</span>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button class="iconbtn" id="closeSettings">Close</button>
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
  panel.innerHTML = `<input class="cmd-input" id="cmdInput" placeholder="Type a command or note name…" autocomplete="off" />
    <div class="cmd-list" id="cmdList"></div>`;
  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);
  const input = panel.querySelector('#cmdInput') as HTMLInputElement;
  const list = panel.querySelector('#cmdList') as HTMLDivElement;

  function renderCmd(filter: string) {
    list.innerHTML = '';
    const f = filter.toLowerCase();
    const cmds = [
      { label: 'New note', hint: 'Ctrl+N', action: () => { newNoteAndRender(); } },
      { label: 'Daily note', hint: '', action: () => dailyNote() },
      { label: 'Toggle graph view', hint: '', action: () => showGraph() },
      { label: 'Toggle backlinks', hint: '', action: () => toggleSidePanel() },
      { label: 'Settings', hint: '', action: () => openSettings() },
      { label: 'Switch to edit mode', hint: '', action: () => { setEditorMode('edit'); applyMode('edit'); } },
      { label: 'Switch to preview mode', hint: '', action: () => { setEditorMode('preview'); applyMode('preview'); } },
      { label: 'Switch to split mode', hint: '', action: () => { setEditorMode('split'); applyMode('split'); } },
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
});

async function main() {
  buildShell();
  await initStore();
  // apply settings font size
  document.documentElement.style.setProperty('--font-size', getState().settings.fontSize + 'px');
  if (!getState().notes.length) {
    await createNote('Welcome');
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
