// Ambiyans sesleri — tamamen yerel WebAudio üretimi (dosya indirmek yok)
// rain: filtreli beyaz gürültü + hafif damla tıkırtıları
// waves: kahverengi gürültü + yavaş dalga dalgalanması (LFO)
// fire: alçak kahverengi uğultu + rastgele çıtırtı patlamaları

export type AmbientKind = 'rain' | 'waves' | 'fire';

interface AmbientState {
  ctx: AudioContext | null;
  master: GainNode | null;
  nodes: AudioNode[];
  timers: (number | ReturnType<typeof setTimeout>)[];
  kind: AmbientKind | null;
  srcNode?: AudioBufferSourceNode;
}

const S: AmbientState = { ctx: null, master: null, nodes: [], timers: [], kind: null };

function makeBuffer(ctx: AudioContext, kind: 'white' | 'brown', seconds = 3): AudioBuffer {
  const len = ctx.sampleRate * seconds;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    if (kind === 'white') {
      d[i] = white;
    } else {
      last = (last + 0.02 * white) / 1.02;
      d[i] = last * 3.2;
    }
  }
  return buf;
}

function stopAll() {
  for (const t of S.timers) clearTimeout(t as ReturnType<typeof setTimeout>);
  S.timers = [];
  for (const n of S.nodes) { try { n.disconnect(); } catch { /* yoksay */ } }
  S.nodes = [];
  try { S.srcNode?.stop(); } catch { /* yoksay */ }
  S.srcNode = undefined;
}

export function ambientOn(): AmbientKind | null { return S.kind; }

export function startAmbient(kind: AmbientKind, volume: number) {
  stopAmbient();
  if (!S.ctx) S.ctx = new AudioContext();
  const ctx = S.ctx;
  void ctx.resume();
  const master = ctx.createGain();
  master.gain.value = volume;
  master.connect(ctx.destination);
  S.master = master;
  S.kind = kind;

  if (kind === 'rain') {
    const src = ctx.createBufferSource();
    src.buffer = makeBuffer(ctx, 'white', 2.5);
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 0.45;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 420;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 5200;
    const bed = ctx.createGain(); bed.gain.value = 0.45;
    src.connect(bp); bp.connect(hp); hp.connect(lp); lp.connect(bed); bed.connect(master);
    // damla tıkırtıları: rastgele kısa bant geçiren kısa bipcikler yerine zarif hissiyat için yavaş lfo
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.35;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.12;
    lfo.connect(lfoGain); lfoGain.connect(bed.gain);
    src.start(); lfo.start();
    S.srcNode = src;
    S.nodes.push(bp, hp, lp, bed, lfo, lfoGain);
  } else if (kind === 'waves') {
    const src = ctx.createBufferSource();
    src.buffer = makeBuffer(ctx, 'brown', 4);
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 560;
    const swell = ctx.createGain(); swell.gain.value = 0.55;
    src.connect(lp); lp.connect(swell); swell.connect(master);
    // yavaş dalga: 0.09Hz LFO gain dalgalanması
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.09;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.4;
    lfo.connect(lfoGain); lfoGain.connect(swell.gain);
    src.start(); lfo.start();
    S.srcNode = src;
    S.nodes.push(lp, swell, lfo, lfoGain);
  } else {
    // fire: alçak uğultu + çıtırtılar
    const src = ctx.createBufferSource();
    src.buffer = makeBuffer(ctx, 'brown', 4);
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 420;
    const bed = ctx.createGain(); bed.gain.value = 0.5;
    src.connect(lp); lp.connect(bed); bed.connect(master);
    src.start();
    S.srcNode = src;
    S.nodes.push(lp, bed);
    // çıtırtı zamanlayıcısı
    const crackle = () => {
      if (S.kind !== 'fire') return;
      const burst = ctx.createBufferSource();
      const b = ctx.createBuffer(1, ctx.sampleRate * 0.03, ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2.2);
      burst.buffer = b;
      const g = ctx.createGain(); g.gain.value = 0.5 + Math.random() * 0.8;
      const hf = ctx.createBiquadFilter();
      hf.type = 'highpass'; hf.frequency.value = 1200;
      burst.connect(hf); hf.connect(g); g.connect(master);
      burst.start();
      S.nodes.push(burst, g, hf);
      setTimeout(() => { try { burst.disconnect(); g.disconnect(); hf.disconnect(); } catch { /* yoksay */ } }, 200);
      S.timers.push(setTimeout(crackle, 120 + Math.random() * 480));
    };
    crackle();
  }
}

export function stopAmbient() {
  stopAll();
  if (S.master) { try { S.master.disconnect(); } catch { /* yoksay */ } }
  S.master = null;
  S.kind = null;
}

export function setAmbientVolume(v: number) {
  if (S.master && S.ctx) {
    S.master.gain.setTargetAtTime(v, S.ctx.currentTime, 0.08);
  }
}
