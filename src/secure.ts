// Not kilitleme: PBKDF2(parola) → AES-GCM tamamen tarayıcıda.
// Parola hiçbir yerde saklanmaz; DB'de yalnız şifreli metin + salt + iv durur.

const te = new TextEncoder();
const td = new TextDecoder();

function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations: 150000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptText(password: string, text: string): Promise<{ iv: string; salt: string; cipher: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as unknown as BufferSource }, key, te.encode(text));
  return { iv: toB64(iv), salt: toB64(salt), cipher: toB64(cipher) };
}

export async function decryptText(password: string, data: { iv: string; salt: string; cipher: string }): Promise<string> {
  const key = await deriveKey(password, fromB64(data.salt));
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(data.iv) as unknown as BufferSource },
    key,
    fromB64(data.cipher) as unknown as BufferSource,
  );
  return td.decode(plain);
}
