import { db } from './db';

export const imageCache = new Map<string, string>();

export async function loadImages(): Promise<void> {
  const rows = await db.images.toArray();
  for (const r of rows) imageCache.set(r.id, r.dataUrl);
}

export function getImage(id: string): string | undefined {
  return imageCache.get(id);
}

export async function saveImage(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((res) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.readAsDataURL(file);
  });
  const id = crypto.randomUUID();
  await db.images.put({ id, name: file.name, dataUrl, createdAt: Date.now() });
  imageCache.set(id, dataUrl);
  return id;
}
