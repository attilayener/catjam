import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { imageCache } from './images';
import { vaultImageCache } from './vault';

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
export function preprocessWikiLinks(md: string): string {
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
  const withLinks = preprocessWikiLinks(resolved);
  const renderer = new marked.Renderer();
  renderer.heading = ({ depth, text }) => {
    const id = 'h-' + (String(text).toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || 'heading') + '-' + headingSeq++;
    const inner = marked.parseInline(String(text));
    return `<h${depth} id="${id}">${inner}</h${depth}>\n`;
  };
  const html = marked.parse(withLinks, { async: false, gfm: true, breaks: true, renderer }) as string;
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['data-wiki', 'class', 'id'],
    ADD_TAGS: ['a', 'img'],
    ALLOWED_URI_REGEXP: /^\s*(https?|file|data|blob):/i,
  });
}
