import { db, loadSettings, saveSetting } from './db';
import type { Note, AppSettings } from './types';
import { applyTheme } from './themes';
import { extractWikiLinks } from './markdown';
import { setLanguage as applyLanguage } from './i18n';
import { getVaultHandle, importVault, createVaultNote, saveNoteToVault, deleteVaultFile, ensureVaultPermission, openVaultPicker, uniqueVaultPath, loadVaultImages } from './vault';
import { loadImages } from './images';

type Listener = () => void;
interface State {
  notes: Note[];
  activeId: string | null;
  settings: AppSettings;
  search: string;
  ready: boolean;
}

const state: State = {
  notes: [],
  activeId: null,
  settings: { theme: 'minimal-dark', editorMode: 'split', fontSize: 16, language: 'tr' },
  search: '',
  ready: false,
};
const listeners = new Set<Listener>();

export function getState() {
  return state;
}
export function subscribe(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() {
  for (const l of listeners) l();
}

export async function initStore() {
  state.settings = await loadSettings();
  applyTheme(state.settings.theme);
  applyLanguage(state.settings.language as any);
  await loadImages();
  // vault sync if present
  const handle = await getVaultHandle();
  if (handle && (await ensureVaultPermission(handle))) {
    try { await importVault(handle); await loadVaultImages(handle); } catch (e) { console.warn(e); }
    await loadVaultImages(handle);
  }
  const all = await db.notes.toArray();
  all.sort((a, b) => (a.order ?? a.createdAt ?? 0) - (b.order ?? b.createdAt ?? 0));
  state.notes = all;
  state.ready = true;
  if (all.length) state.activeId = all[0].id;
  emit();
}

export function filteredNotes(): Note[] {
  const q = state.search.trim().toLowerCase();
  const base = state.notes.filter((n) => !n.deletedAt);
  if (!q) return base;
  return base.filter(
    (n) => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q),
  );
}

export async function createNote(title?: string): Promise<Note> {
  const now = Date.now();
  const t = title?.trim() || 'Untitled';
  const note: Note = {
    id: crypto.randomUUID(),
    title: t,
    content: '',
    createdAt: now,
    updatedAt: now,
    order: Date.now(),
  };
  const handle = await getVaultHandle();
  if (handle && (await ensureVaultPermission(handle))) {
    const safe = t.replace(/[\\/:*?"<>|]/g, '-');
    const path = await uniqueVaultPath(handle, safe);
    note.path = path;
    try { await createVaultNote(handle, path, ''); } catch (e) { console.warn(e); }
  }
  await db.notes.put(note);
  state.notes.push(note);
  state.notes.sort((a, b) => (a.order ?? a.createdAt ?? 0) - (b.order ?? b.createdAt ?? 0));
  state.activeId = note.id;
  emit();
  return note;
}

export async function updateNote(id: string, patch: Partial<Note>) {
  const idx = state.notes.findIndex((n) => n.id === id);
  if (idx < 0) return;
  const updated = { ...state.notes[idx], ...patch, updatedAt: Date.now() };
  state.notes[idx] = updated;
  state.notes.sort((a, b) => (a.order ?? a.createdAt ?? 0) - (b.order ?? b.createdAt ?? 0));
  await db.notes.put(updated);
  if (updated.path) saveNoteToVault(updated).catch((e) => console.warn(e));
  // version snapshot (throttled to one per minute per note)
  try {
    const last = (await db.versions.where('noteId').equals(id).toArray()).sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!last || Date.now() - last.createdAt > 60000) {
      await db.versions.put({ id: crypto.randomUUID(), noteId: id, title: updated.title, content: updated.content, createdAt: Date.now() });
    }
  } catch (e) { /* ignore */ }
  emit();
}

export async function deleteNote(id: string, permanent = false) {
  const n = state.notes.find((x) => x.id === id);
  if (permanent) {
    if (n?.path) deleteVaultFile(n.path).catch(() => {});
    await db.notes.delete(id);
    state.notes = state.notes.filter((x) => x.id !== id);
    if (state.activeId === id) {
      state.activeId = state.notes.find((x) => !x.deletedAt)?.id ?? state.notes[0]?.id ?? null;
    }
    emit();
    return;
  }
  // softened: çöpe at (restore edilebilir)
  const idx = state.notes.findIndex((x) => x.id === id);
  if (idx < 0) return;
  const updated = { ...state.notes[idx], deletedAt: Date.now(), updatedAt: Date.now() };
  state.notes[idx] = updated as Note;
  if (state.activeId === id) {
    state.activeId = state.notes.find((x) => !x.deletedAt)?.id ?? null;
  }
  await db.notes.put(updated);
  emit();
}

export async function restoreNote(id: string) {
  const idx = state.notes.findIndex((x) => x.id === id);
  if (idx < 0) return;
  const updated: Note = { ...state.notes[idx], deletedAt: undefined, updatedAt: Date.now() };
  delete updated.deletedAt;
  state.notes[idx] = updated;
  state.activeId = id;
  await db.notes.put(updated);
  emit();
}

export function deletedNotes(): Note[] {
  return state.notes
    .filter((n) => !!n.deletedAt)
    .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
}

export function setActive(id: string | null) {
  state.activeId = id;
  emit();
}

export function setSearch(q: string) {
  state.search = q;
  emit();
}

export async function setTheme(id: string) {
  state.settings.theme = id;
  applyTheme(id);
  await saveSetting('theme', id);
  emit();
}

export async function setEditorMode(mode: 'edit' | 'preview' | 'split') {
  state.settings.editorMode = mode;
  await saveSetting('editorMode', mode);
  emit();
}

export async function setLanguage(lang: 'en' | 'tr') {
  state.settings.language = lang;
  applyLanguage(lang);
  await saveSetting('language', lang);
  emit();
}

export function getActiveNote(): Note | undefined {
  return state.notes.find((n) => n.id === state.activeId);
}

export function findNoteByTitle(title: string): Note | undefined {
  const t = title.toLowerCase();
  return state.notes.find((n) => n.title.toLowerCase() === t);
}

export async function openVault(): Promise<boolean> {
  let handle = await getVaultHandle();
  if (handle && (await ensureVaultPermission(handle))) {
    await importVault(handle); await loadVaultImages(handle);
    const all = await db.notes.toArray(); all.sort((a,b)=>(a.order??a.createdAt??0)-(b.order??b.createdAt??0));
    state.notes = all;
    if (all.length) state.activeId = all[0].id;
    emit();
    return true;
  }
  handle = await openVaultPicker();
  if (!handle) return false;
  if (!(await ensureVaultPermission(handle))) return false;
  await importVault(handle); await loadVaultImages(handle);
  const all = await db.notes.toArray(); all.sort((a,b)=>(a.order??a.createdAt??0)-(b.order??b.createdAt??0));
  state.notes = all;
  if (all.length) state.activeId = all[0].id;
  emit();
  return true;
}

export async function reorderNotes(activeId: string, overId: string): Promise<void> {
  const fromIdx = state.notes.findIndex((n) => n.id === activeId);
  const toIdx = state.notes.findIndex((n) => n.id === overId);
  if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
  const arr = [...state.notes];
  const [moved] = arr.splice(fromIdx, 1);
  arr.splice(toIdx, 0, moved);
  arr.forEach((n, i) => (n.order = i + 1));
  await Promise.all(arr.map((n) => db.notes.put(n)));
  state.notes = arr;
  emit();
}

export function backlinksOf(title: string): Note[] {
  const target = title.toLowerCase();
  const self = state.notes.find((x) => x.title.toLowerCase() === target)?.id;
  return state.notes.filter(
    (n) => n.id !== self && extractWikiLinks(n.content).some((l) => l.toLowerCase() === target),
  );
}
