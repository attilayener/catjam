import { db, loadSettings, saveSetting } from './db';
import type { Note, AppSettings } from './types';
import { applyTheme } from './themes';
import { extractWikiLinks } from './markdown';
import { getVaultHandle, importVault, createVaultNote, saveNoteToVault, deleteVaultFile, ensureVaultPermission, openVaultPicker } from './vault';

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
  settings: { theme: 'minimal-dark', editorMode: 'split', fontSize: 16 },
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
  // vault sync if present
  const handle = await getVaultHandle();
  if (handle && (await ensureVaultPermission(handle))) {
    try { await importVault(handle); } catch (e) { console.warn(e); }
  }
  const all = await db.notes.orderBy('updatedAt').reverse().toArray();
  state.notes = all;
  state.ready = true;
  if (all.length) state.activeId = all[0].id;
  emit();
}

export function filteredNotes(): Note[] {
  const q = state.search.trim().toLowerCase();
  if (!q) return state.notes;
  return state.notes.filter(
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
  };
  const handle = await getVaultHandle();
  if (handle && (await ensureVaultPermission(handle))) {
    const safe = t.replace(/[\\/:*?"<>|]/g, '-');
    const path = `${safe}.md`;
    // avoid overwrite: if exists, suffix
    note.path = path;
    try { await createVaultNote(handle, path, ''); } catch (e) { console.warn(e); }
  }
  await db.notes.put(note);
  state.notes = [note, ...state.notes];
  state.activeId = note.id;
  emit();
  return note;
}

export async function updateNote(id: string, patch: Partial<Note>) {
  const idx = state.notes.findIndex((n) => n.id === id);
  if (idx < 0) return;
  const updated = { ...state.notes[idx], ...patch, updatedAt: Date.now() };
  state.notes[idx] = updated;
  state.notes.sort((a, b) => b.updatedAt - a.updatedAt);
  await db.notes.put(updated);
  if (updated.path) saveNoteToVault(updated).catch((e) => console.warn(e));
  emit();
}

export async function deleteNote(id: string) {
  const n = state.notes.find((x) => x.id === id);
  if (n?.path) deleteVaultFile(n.path).catch(() => {});
  await db.notes.delete(id);
  state.notes = state.notes.filter((n) => n.id !== id);
  if (state.activeId === id) {
    state.activeId = state.notes[0]?.id ?? null;
  }
  emit();
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
    await importVault(handle);
    const all = await db.notes.orderBy('updatedAt').reverse().toArray();
    state.notes = all;
    if (all.length) state.activeId = all[0].id;
    emit();
    return true;
  }
  handle = await openVaultPicker();
  if (!handle) return false;
  if (!(await ensureVaultPermission(handle))) return false;
  await importVault(handle);
  const all = await db.notes.orderBy('updatedAt').reverse().toArray();
  state.notes = all;
  if (all.length) state.activeId = all[0].id;
  emit();
  return true;
}

export function backlinksOf(title: string): Note[] {
  const target = title.toLowerCase();
  const self = state.notes.find((x) => x.title.toLowerCase() === target)?.id;
  return state.notes.filter(
    (n) => n.id !== self && extractWikiLinks(n.content).some((l) => l.toLowerCase() === target),
  );
}
