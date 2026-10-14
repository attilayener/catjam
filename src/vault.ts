import { db } from './db';
import type { Note } from './types';

export function fsAvailable(): boolean {
  return typeof (window as any).showDirectoryPicker === 'function';
}

export async function getVaultHandle(): Promise<FileSystemDirectoryHandle | null> {
  const row = await db.settings.get('vaultHandle');
  return (row?.value as FileSystemDirectoryHandle) ?? null;
}

export async function ensureVaultPermission(handle: FileSystemDirectoryHandle | null): Promise<boolean> {
  if (!handle) return false;
  try {
    const opts: any = { mode: 'readwrite' };
    if ((await (handle as any).queryPermission(opts)) === 'granted') return true;
    if ((await (handle as any).requestPermission(opts)) === 'granted') return true;
  } catch {}
  return false;
}

export async function setVaultHandle(handle: FileSystemDirectoryHandle | null): Promise<void> {
  if (handle) await db.settings.put({ key: 'vaultHandle', value: handle });
  else await db.settings.delete('vaultHandle');
}

export async function openVaultPicker(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
    await setVaultHandle(handle);
    return handle;
  } catch (e) {
    return null;
  }
}

async function walk(dir: FileSystemDirectoryHandle, base = ''): Promise<{ path: string; handle: FileSystemFileHandle }[]> {
  const out: { path: string; handle: FileSystemFileHandle }[] = [];
  // @ts-ignore
  for await (const [name, h] of dir.entries()) {
    const p = base ? `${base}/${name}` : name;
    if (h.kind === 'directory') {
      // skip hidden/.obsidian
      if (name.startsWith('.')) continue;
      out.push(...(await walk(h as FileSystemDirectoryHandle, p)));
    } else if (h.kind === 'file' && name.toLowerCase().endsWith('.md')) {
      out.push({ path: p, handle: h as FileSystemFileHandle });
    }
  }
  return out;
}

export async function importVault(handle: FileSystemDirectoryHandle): Promise<number> {
  const files = await walk(handle);
  let count = 0;
  for (const f of files) {
    const file = await f.handle.getFile();
    const content = await file.text();
    const title = f.path.replace(/\.md$/i, '').split('/').pop() || f.path;
    // upsert by path
    const existing = await db.notes.where('path').equals(f.path).first();
    const note: Note = {
      id: existing?.id ?? crypto.randomUUID(),
      title: existing?.title ?? title,
      content,
      createdAt: existing?.createdAt ?? file.lastModified,
      updatedAt: file.lastModified,
      path: f.path,
      folder: f.path.includes('/') ? f.path.split('/').slice(0, -1).join('/') : undefined,
    };
    await db.notes.put(note);
    count++;
  }
  return count;
}

export async function saveNoteToVault(note: Note): Promise<void> {
  if (!note.path) return;
  const handle = await getVaultHandle();
  if (!handle) return;
  // navigate to file
  const parts = note.path.split('/');
  let dir: FileSystemDirectoryHandle = handle;
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i], { create: true });
  }
  const fh = await dir.getFileHandle(parts[parts.length - 1], { create: true });
  const w = await fh.createWritable();
  await w.write(note.content);
  await w.close();
}

export async function uniqueVaultPath(handle: FileSystemDirectoryHandle, desired: string): Promise<string> {
  const name = desired.replace(/[\\/:*?"<>|]/g, '-');
  let base = name.endsWith('.md') ? name : `${name}.md`;
  // try base
  const tryPath = async (p: string) => {
    const parts = p.split('/');
    let dir: FileSystemDirectoryHandle = handle;
    for (let i = 0; i < parts.length - 1; i++) {
      try { dir = await dir.getDirectoryHandle(parts[i]); } catch { return false; }
    }
    try { await dir.getFileHandle(parts[parts.length - 1]); return true; } catch { return false; }
  };
  if (!(await tryPath(base))) return base;
  const stem = base.replace(/\.md$/i, '');
  let i = 1;
  while (await tryPath(`${stem} ${i}.md`)) i++;
  return `${stem} ${i}.md`;
}

export async function createVaultNote(handle: FileSystemDirectoryHandle, path: string, content = ''): Promise<string> {
  const parts = path.split('/');
  let dir: FileSystemDirectoryHandle = handle;
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i], { create: true });
  }
  const fh = await dir.getFileHandle(parts[parts.length - 1], { create: true });
  const w = await fh.createWritable();
  await w.write(content);
  await w.close();
  return path;
}

export async function deleteVaultFile(path: string): Promise<void> {
  const handle = await getVaultHandle();
  if (!handle || !path) return;
  const parts = path.split('/');
  let dir: FileSystemDirectoryHandle = handle;
  for (let i = 0; i < parts.length - 1; i++) {
    try { dir = await dir.getDirectoryHandle(parts[i]); } catch { return; }
  }
  try { await (dir as any).removeEntry(parts[parts.length - 1]); } catch {}
}
