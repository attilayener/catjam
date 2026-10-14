import Dexie, { type Table } from 'dexie';
import type { Note, AppSettings } from './types';

export class CatJamDB extends Dexie {
  notes!: Table<Note, string>;
  settings!: Table<{ key: string; value: any }, string>;
  images!: Table<{ id: string; name: string; dataUrl: string; createdAt: number }, string>;

  constructor() {
    super('catjam-db');
    this.version(1).stores({
      notes: 'id, title, updatedAt, folder, path',
      settings: 'key',
    });
    this.version(2).stores({
      notes: 'id, title, updatedAt, folder, path',
      settings: 'key',
    });
    this.version(3).stores({
      notes: 'id, title, updatedAt, folder, path',
      settings: 'key',
      images: 'id, name, createdAt',
    });
  }
}

export const db = new CatJamDB();

export async function loadSettings(): Promise<AppSettings> {
  const rows = await db.settings.toArray();
  const map: Record<string, any> = {};
  for (const r of rows) map[r.key] = r.value;
  return {
    theme: map.theme ?? 'minimal-dark',
    editorMode: map.editorMode ?? 'split',
    fontSize: map.fontSize ?? 16,
    language: map.language ?? 'tr',
  };
}

export async function saveSetting(key: string, value: any): Promise<void> {
  await db.settings.put({ key, value });
}
