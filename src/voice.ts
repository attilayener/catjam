// Tamamen yerel ses tanıma: Whisper (base) via Transformers.js / ONNX Runtime Web.
// Model ilk kullanımda bir kez indirilir (Cache API), sonrasında %100 internetsiz çalışır —
// ses hiçbir sunucuya gitmez, işlem tarayıcının WASM motorunda yapılır.

let transcriber: any = null;
let initPromise: Promise<any> | null = null;
let audioCtxRef: AudioContext | null = null;

export type VoiceProgress = { percent: number; label?: string };

// Model dosyaları (transformers.js quantized ONNX): kalite/boyut seçilebilir
export const WHISPER_MODELS: Record<string, { id: string; size: number }> = {
  tiny: { id: 'Xenova/whisper-tiny', size: 75 },
  base: { id: 'Xenova/whisper-base', size: 100 },
  small: { id: 'Xenova/whisper-small', size: 370 },
};
let currentModelKey = 'base';

export function whisperModel(): string {
  return currentModelKey;
}

// Kayıtlı model disk alanını temizle: HTTPS Cache API ('transformers-cache') içinden
// seçilenin (veya hepsinin) dosyalarını atar; transcriber'ı da kapatır.
export async function deleteWhisperModel(modelKey?: string): Promise<void> {
  transcriber = null;
  initPromise = null;
  try { await audioCtxRef?.close(); } catch { /* ignore */ }
  audioCtxRef = null;
  try {
    if (modelKey) localStorage.removeItem('catjam:whisperReady:' + modelKey);
    else Object.keys(WHISPER_MODELS).forEach((k) => localStorage.removeItem('catjam:whisperReady:' + k));
  } catch { /* ignore */ }
  try {
    if (typeof caches === 'undefined') return;
    const cache = await caches.open('transformers-cache');
    const keys = await cache.keys();
    const ids = modelKey ? [WHISPER_MODELS[modelKey]?.id] : Object.values(WHISPER_MODELS).map((m) => m.id);
    for (const req of keys) {
      const url = req.url;
      if (ids.some((id) => id && url.includes(id)) || (!modelKey && url.includes('whisper-'))) {
        await cache.delete(req);
      }
    }
  } catch (e) {
    console.warn('Whisper cache delete failed', e);
  }
}

export function whisperCached(modelKey: string): boolean {
  try { return localStorage.getItem('catjam:whisperReady:' + modelKey) === '1'; } catch { return false; }
}

export function whisperSupported(): boolean {
  return typeof (window as any).MediaRecorder !== 'undefined';
}

export function whisperReady(): boolean {
  return transcriber !== null;
}

export function whisperReadyFor(modelKey: string): boolean {
  return transcriber !== null && currentModelKey === modelKey;
}

function tryLocalWasmPaths(env: any) {
  // ORT wasm dosyalarını kendi originimizden servis ediyoruz (public/transformers/)
  // — internet yokken bile inference çalışabilsin diye.
  try {
    env.backends.onnx.wasm.wasmPaths = `${location.origin}/transformers/`;
    // SharedArrayBuffer yalnız cross-origin-isolated sayfalarda var; yoksa tek iş parçacığı.
    const cores = crossOriginIsolated ? Math.min(4, (navigator.hardwareConcurrency || 2)) : 1;
    env.backends.onnx.wasm.numThreads = Math.max(1, cores - (crossOriginIsolated ? 1 : 0));
  } catch { /* older versions: ignore */ }
}

// Dosya bazlı progress'i yüzdeye çevir
export function initWhisperLocal(onProgress?: (p: VoiceProgress) => void, modelKey?: string): Promise<any> {
  if (modelKey && modelKey !== currentModelKey) {
    // model değişimi: paketi kapat, yeni modelle kur
    transcriber = null;
    initPromise = null;
    currentModelKey = modelKey;
  }
  if (transcriber) return Promise.resolve(transcriber);
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const TF: any = await import('@xenova/transformers');
    const env = TF.env;
    env.allowLocalModels = false; // /models/ dizin aramasını kapat — modeller Cache API'de
    tryLocalWasmPaths(env);
    const fileProgress = new Map<string, number>();
    const report = () => {
      const vals = [...fileProgress.values()];
      const pct = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
      onProgress?.({ percent: pct });
    };
    const modelId = WHISPER_MODELS[currentModelKey]?.id ?? WHISPER_MODELS.base.id;
    transcriber = await TF.pipeline('automatic-speech-recognition', modelId, {
      quantized: true,
      progress_callback: (p: any) => {
        if (p.status === 'progress' && p.file) {
          fileProgress.set(p.file, Math.min(100, p.progress ?? 0));
          report();
        } else if (p.status === 'done') {
          report();
        }
      },
    });
    onProgress?.({ percent: 100 });
    try { localStorage.setItem('catjam:whisperReady:' + currentModelKey, '1'); } catch { /* no-op */ }
    return transcriber;
  })();
  initPromise.catch(() => { initPromise = null; });
  return initPromise;
}

// Blob (webm/opus/mp4) → 16 kHz Float32 → Whisper transcribe
export async function transcribeBlob(blob: Blob, lang: 'tr' | 'en'): Promise<string> {
  if (!transcriber) throw new Error('Whisper modeli hazır değil');
  const buf = await blob.arrayBuffer();
  // decodeAudioData + 16 kHz yeniden örnekleme
  audioCtxRef?.close();
  if (!audioCtxRef || audioCtxRef.state === 'closed') {
    audioCtxRef = new AudioContext({ sampleRate: 16000 });
    await audioCtxRef.resume().catch(() => {});
  }
  const decoded = await audioCtxRef.decodeAudioData(buf);
  let audio: Float32Array = decoded.getChannelData(0);
  const result = await transcriber(audio, {
    chunk_length_s: 30,
    stride_length_s: 5,
    language: lang,
    task: 'transcribe',
  });
  return String(result?.text ?? '').trim();
}
