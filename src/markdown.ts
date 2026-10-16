import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { imageCache } from './images';
import { vaultImageCache } from './vault';
import katex from 'katex';
import 'katex/dist/katex.min.css';

export function extractWikiLinks(content: string): string[] {
  const links = new Set<string>();
  const re = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const t = m[1].trim();
    if (t) links.add(t);
  }
  return [...links];
}

export function extractTags(content: string): string[] {
  const tags = new Set<string>();
  const re = /(?:^|\s)#([A-Za-z0-9_\-/]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) tags.add(m[1]);
  return [...tags];
}

// Convert wiki links to placeholder anchors before marked runs, so they survive.
export function preprocessMath(md: string): string {
  // block math
  let out = md.replace(/^\$\$\n([\s\S]+?)\n\$\$$/gm, (_m, expr) => {
    try { return katex.renderToString(expr.trim(), { displayMode: true, throwOnError: false }); }
    catch { return _m; }
  });
  // inline math (single $, not $$)
  out = out.replace(/(^|[^$])\$([^$\n]+)\$(?![\d])/g, (m, pre, expr) => {
    try { return pre + katex.renderToString(expr.trim(), { displayMode: false, throwOnError: false }); }
    catch { return m; }
  });
  return out;
}

function preprocessBlockProps(md: string): string {
  return md.replace(/^(\s*[-*+ ]*)([A-Za-z0-9_-]+)::\s*(.+)$/gm, (_m, prefix, key, val) => {
    return `${prefix}<span class="block-prop"><span class="prop-key">${escapeHtml(key)}</span>: ${escapeHtml(val)}</span>`;
  });
}

function preprocessCallouts(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(/^>\s*\[!(\w+)\]\s*(.*)$/);
    if (m) {
      const type = m[1].toLowerCase();
      const title = m[2].trim();
      const bodyLines: string[] = [];
      i++;
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        bodyLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      const bodyHtml = marked.parse(bodyLines.join('\n'), { async: false, gfm: true, breaks: true }) as string;
      out.push(`<div class="callout callout-${type}"><div class="callout-title">${escapeHtml(title || type)}</div><div class="callout-body">${bodyHtml}</div></div>`);
    } else {
      out.push(lines[i]);
      i++;
    }
  }
  return out.join('\n');
}

function preprocessWikiLinks(md: string): string {
  return md.replace(/\[\[([^\]|#]+)(?:#([^\]|]*))?(?:\|([^\]]*))?\]\]/g, (_m, target, heading, alias) => {
    const t = String(target).trim();
    const label = (alias ?? heading ?? target).trim();
    const h = heading ? `#${heading.trim()}` : '';
    return `<a class="wiki-link" data-wiki="${escapeAttr(t + h)}" href="#wiki:${encodeURIComponent(t + h)}">${escapeHtml(label)}</a>`;
  });
}

function escapeAttr(s: string) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

let headingSeq = 0;

function resolveImagePlaceholders(md: string): string {
  let out = md.replace(/!\[([^\]]*)\]\(catjam-image:([^)]+)\)/g, (_m, alt, id) => {
    const url = imageCache.get(String(id).trim());
    return url ? `![${alt}](${url})` : `![${alt}](#missing-image)`;
  });
  // Obsidian-style image embeds ![[file.ext]]
  out = out.replace(/!\[\[([^]]+\.(?:png|jpe?g|gif|webp|svg|bmp))\]\]/gi, (_m, name) => {
    const url = vaultImageCache.get(name) || vaultImageCache.get(name.split('/').pop() || name);
    return url ? `![](${url})` : `![${name}](#missing-image)`;
  });
  // Relative markdown image paths that are in vault cache
  out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (m, alt, src) => {
    if (/^(https?:|data:|blob:|#)/i.test(src)) return m;
    const key = src.split('/').pop() || src;
    const url = vaultImageCache.get(src) || vaultImageCache.get(key);
    return url ? `![${alt}](${url})` : m;
  });
  return out;
}

export function renderMarkdown(md: string): string {
  headingSeq = 0;
  const resolved = resolveImagePlaceholders(md);
  const mathed = preprocessMath(resolved);
  const mermaided = mathed.replace(/```mermaid\n([\s\S]*?)```/g, '<div class="mermaid">$1</div>');
  const proped = preprocessBlockProps(mermaided);
  const called = preprocessCallouts(proped);
  const withLinks = preprocessWikiLinks(called);
  const renderer = new marked.Renderer();
  renderer.heading = ({ depth, text }) => {
    const id = 'h-' + (String(text).toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || 'heading') + '-' + headingSeq++;
    const inner = marked.parseInline(String(text));
    return `<h${depth} id="${id}">${inner}</h${depth}>\n`;
  };
  const html = marked.parse(withLinks, { async: false, gfm: true, breaks: true, renderer }) as string;
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['data-wiki', 'class', 'id', 'style', 'aria-hidden'],
    ADD_TAGS: ['a', 'img', 'span', 'div', 'mrow', 'math', 'semantics', 'annotation'],
    ALLOWED_URI_REGEXP: /^\s*(https?|file|data|blob):/i,
  });
}
