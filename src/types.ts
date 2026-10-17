export interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  folder?: string;
  path?: string;
  order?: number;
  deletedAt?: number;
  locked?: boolean;
  lockData?: { iv: string; salt: string; cipher: string; hint?: string };
}

export interface AppSettings {
  theme: string;
  editorMode: 'edit' | 'preview' | 'split';
  fontSize: number;
  language: 'en' | 'tr';
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'minimal-dark',
  editorMode: 'split',
  fontSize: 16,
  language: 'tr',
};
