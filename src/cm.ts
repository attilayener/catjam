// Cat Jam — CodeMirror 6 editörü (phase A: canlı biçim dekorasyonları + görev tık)
// Obsidian tarzı "Live Preview-lite": imleç satırı dışında #/##/**/~~/`/>' işaretleri
// gizlenir, başlık satırları büyür, blok satırları renk alır, görev kutuları tıklanır.
import {
  Decoration,
  EditorView,
  ViewPlugin,
  ViewUpdate,
} from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import type { Range } from '@codemirror/state';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { basicSetup } from 'codemirror';

export interface CMHandle {
  view: EditorView;
  getValue(): string;
  setValue(v: string): void;
  focus(): void;
  getCursor(): { from: number; to: number };
  setCursor(from: number, to?: number): void;
}

// decolar: Decoration.range() ile gerçek Range'ler kurulan liste
const lineOf = (cls: string) => Decoration.line({ class: cls });
const hideMk = () => Decoration.replace({});

function buildDocDecorations(state: EditorState): DecorationSet {
  const doc = state.doc;
  if (doc.lines > 2500) return Decoration.none; // dev not: dekor yok (hız)
  const cursor = state.selection.main.head;
  const items: Range<Decoration>[] = [];
  const push = (from: number, to: number, deco: Decoration) => items.push(deco.range(from, to));
  for (let i = 1; i <= doc.lines; i++) {
    const ln = doc.line(i);
    const s = ln.text;
    const inside = cursor >= ln.from && cursor <= ln.to;
    // başlık
    const hm = s.match(/^(#{1,6})(\s+)/);
    if (hm) {
      push(ln.from, ln.from, lineOf('cm-md-h' + hm[1].length));
      if (!inside) push(ln.from, ln.from + (hm[1].length + hm[2].length), hideMk());
    }
    // blok alıntı
    const qm = s.match(/^>\s?/);
    if (qm) {
      push(ln.from, ln.from, lineOf('cm-md-quote'));
      if (!inside) push(ln.from, ln.from + qm[0].length, hideMk());
    }
    if (inside) continue; // imleç satırında işaret kapanmaları gösterme
    // kalın **x** / üstü çizili ~~x~~ / satır içi kod `x` / eğik *x* — tek geçiş (öncelikli alternatifler)
    const seq = /(\*\*[^*\n]+\*\*|~~[^~\n]+~~|`[^`\n]+`|\*(?!\s)[^*\n]+\*)/g;
    seq.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = seq.exec(s))) {
      const startIdx = m.index;
      const tok = m[0];
      const openerLen = tok.startsWith('**') || tok.startsWith('~~') ? 2 : 1;
      push(ln.from + startIdx, ln.from + startIdx + openerLen, hideMk());
      const endIdx = startIdx + tok.length;
      push(ln.from + endIdx - openerLen, ln.from + endIdx, hideMk());
    }
  }
  return Decoration.set(items, true);
}

const mdLivePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = buildDocDecorations(view.state); }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet) this.decorations = buildDocDecorations(u.state);
    }
  },
  { decorations: (v) => v.decorations }
);

// görev kutusuna tıklayınca kaynak metni değiştir
const taskToggle = EditorView.domEventHandlers({
  mousedown(ev, view) {
    const pos = view.posAtCoords({ x: ev.clientX, y: ev.clientY });
    if (pos == null) return false;
    const line = view.state.doc.lineAt(pos);
    const m = line.text.match(/(^|\s)- \[([ xX])\] /);
    if (!m || m.index == null) return false;
    const idx = line.from + m.index + m[1].length + 3; // "-" sonrası "[x]" içindeki karakter
    ev.preventDefault();
    view.dispatch({
      changes: { from: idx, to: idx + 1, insert: m[2] === ' ' ? 'x' : ' ' },
    });
    return true;
  },
});

export function mountCM(
  host: HTMLElement,
  initial: string,
  onChange: (text: string) => void,
  onCursor: () => void
): CMHandle {
  const view = new EditorView({
    doc: initial,
    extensions: [
      basicSetup,
      markdown(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      mdLivePlugin,
      taskToggle,
      EditorView.lineWrapping,
      EditorView.theme({
        '&': { height: '100%', color: 'var(--text-h)', backgroundColor: 'transparent', fontSize: '15px' },
        '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.62' },
        '.cm-content': { caretColor: 'var(--accent)' },
        '&.cm-editor.cm-focused': { outline: 'none' },
        '.cm-lineNumbers': { color: 'var(--border)' },
        '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--bg-soft) 60%, transparent)' },
        '.cm-gutters': { backgroundColor: 'transparent', border: 'none' },
      }),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) onChange(u.state.doc.toString());
        if (u.docChanged || u.selectionSet) onCursor();
      }),
    ],
    parent: host,
  });

  const h: CMHandle = {
    view,
    getValue: () => view.state.doc.toString(),
    setValue: (v: string) => {
      if (v === view.state.doc.toString()) return;
      const sel = view.state.selection.main;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v } });
      try { view.dispatch({ selection: { anchor: Math.min(sel.anchor, v.length) } }); } catch { /* no-op */ }
    },
    focus: () => view.focus(),
    getCursor: () => {
      const s = view.state.selection.main;
      return { from: s.from, to: s.to };
    },
    setCursor: (from, to) => {
      try {
        view.dispatch({ selection: { anchor: from, head: to ?? from } });
      } catch { /* sınırlar aşıldıysa sessiz */ }
    },
  };
  return h;
}
