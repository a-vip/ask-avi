import DOMPurify from 'dompurify';
import hljs from 'highlight.js';
import { Marked, type Tokens } from 'marked';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const renderer = new Marked({
  gfm: true,
  breaks: true,
});

renderer.use({
  renderer: {
    code({ text, lang }: Tokens.Code): string {
      const safeLang = (lang ?? '').trim().toLowerCase();
      let highlighted = escapeHtml(text);
      if (safeLang && hljs.getLanguage(safeLang)) {
        try {
          highlighted = hljs.highlight(text, { language: safeLang }).value;
        } catch {
          highlighted = escapeHtml(text);
        }
      }
      const displayLang = escapeHtml(safeLang || 'text');
      return (
        `<div class="code-block-shell">` +
        `<div class="code-block-head">` +
        `<span class="code-block-lang">${displayLang}</span>` +
        `<button type="button" class="code-copy-btn" data-copy-code="${escapeHtml(encodeURIComponent(text))}">Copy</button>` +
        `</div>` +
        `<pre><code class="hljs language-${displayLang}">${highlighted}</code></pre>` +
        `</div>`
      );
    },
    link({ href, title, text }: Tokens.Link): string {
      const safeHref = href && /^(https?:|mailto:|#)/i.test(href) ? escapeHtml(href) : '#';
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
      return `<a href="${safeHref}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
  },
});

export interface CitationTarget {
  index?: number;
  url?: string;
  doi?: string;
  title?: string;
}

export function resolveSourceUrl(url?: string, doi?: string): string {
  const raw = (url ?? '').trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  const cleanDoi = (doi ?? '').trim();
  if (cleanDoi) {
    return /^https?:\/\//i.test(cleanDoi)
      ? cleanDoi
      : `https://doi.org/${cleanDoi.replace(/^doi:\s*/i, '')}`;
  }
  return '';
}

function replaceInlineCitations(
  html: string,
  sourcesOrCount: number | CitationTarget[]
): string {
  const targetMap = new Map<number, { url: string; title: string }>();
  let numericCap = 0;

  if (typeof sourcesOrCount === 'number') {
    numericCap = sourcesOrCount;
  } else {
    sourcesOrCount.forEach((src, pos) => {
      const idx = src.index && src.index > 0 ? src.index : pos + 1;
      targetMap.set(idx, {
        url: resolveSourceUrl(src.url, src.doi),
        title: (src.title ?? '').trim(),
      });
    });
  }

  if (numericCap <= 0 && targetMap.size === 0) {
    return html;
  }

  // Only replace [n] tokens in plain text segments outside HTML tags and existing <a> links.
  const segments = html.split(/(<[^>]+>)/g);
  let anchorDepth = 0;

  return segments
    .map((seg) => {
      if (seg.startsWith('<') && seg.endsWith('>')) {
        if (/^<a\b/i.test(seg)) anchorDepth += 1;
        else if (/^<\/a\b/i.test(seg)) anchorDepth = Math.max(0, anchorDepth - 1);
        return seg;
      }
      if (anchorDepth > 0) return seg;

      return seg.replace(/\[(\d{1,2})\](?!\()/g, (match, numStr: string) => {
        const idx = Number(numStr);
        if (typeof sourcesOrCount === 'number') {
          if (idx >= 1 && idx <= numericCap) {
            return `<button type="button" class="cite-pill" data-cite-idx="${idx}" aria-label="View source ${idx}">${idx}</button>`;
          }
          return match;
        }
        const entry = targetMap.get(idx);
        if (!entry) return match;
        if (entry.url) {
          const titleText = entry.title ? `${entry.title} — ${entry.url}` : entry.url;
          const ariaText = entry.title
            ? `Open source ${idx}: ${entry.title}`
            : `Open source ${idx}`;
          return `<a href="${escapeHtml(entry.url)}" target="_blank" rel="noopener noreferrer" class="cite-pill" data-cite-idx="${idx}" title="${escapeHtml(titleText)}" aria-label="${escapeHtml(ariaText)}">${idx}</a>`;
        }
        return `<button type="button" class="cite-pill" data-cite-idx="${idx}" aria-label="View source ${idx}">${idx}</button>`;
      });
    })
    .join('');
}

export function renderMarkdownToSafeHtml(
  markdown: string,
  sourcesOrCount: number | CitationTarget[] = 0
): string {
  const rawHtml = renderer.parse(markdown) as string;
  const withCitations = replaceInlineCitations(rawHtml, sourcesOrCount);

  return DOMPurify.sanitize(withCitations, {
    ADD_ATTR: ['target', 'rel', 'title', 'data-cite-idx', 'data-copy-code', 'aria-label'],
    ADD_TAGS: ['button'],
  });
}
