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

export function renderMarkdownToSafeHtml(markdown: string, sourceCount = 0): string {
  const rawHtml = renderer.parse(markdown) as string;

  // Turn [1], [2] citation markers into interactive citation pills when sources exist
  const withCitations =
    sourceCount > 0
      ? rawHtml.replace(/\[(\d{1,2})\](?!\()/g, (match, numStr: string) => {
          const idx = Number(numStr);
          if (idx >= 1 && idx <= sourceCount) {
            return `<button type="button" class="cite-pill" data-cite-idx="${idx}" aria-label="View source ${idx}">${idx}</button>`;
          }
          return match;
        })
      : rawHtml;

  return DOMPurify.sanitize(withCitations, {
    ADD_ATTR: ['target', 'rel', 'data-cite-idx', 'data-copy-code', 'aria-label'],
    ADD_TAGS: ['button'],
  });
}
