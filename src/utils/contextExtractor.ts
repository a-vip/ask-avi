/// <reference types="vite/client" />
import type { AttachedContext, AttachedContextKind } from '../types/chat';

export const MAX_CONTEXT_ITEMS = 4;
export const MAX_FILE_BYTES = 12 * 1024 * 1024;
export const MAX_CHARS_PER_ITEM = 4000;
export const MAX_TOTAL_CONTEXT_CHARS = 10000;

export const GUEST_MAX_CONTEXT_ITEMS = 2;
export const GUEST_MAX_CHARS_PER_ITEM = 2200;
export const GUEST_MAX_TOTAL_CONTEXT_CHARS = 3600;

export interface ContextBudgetLimits {
  maxItems: number;
  maxCharsPerItem: number;
  maxTotalChars: number;
}

export function getContextBudgetLimits(isAuthenticated = true): ContextBudgetLimits {
  return isAuthenticated
    ? {
        maxItems: MAX_CONTEXT_ITEMS,
        maxCharsPerItem: MAX_CHARS_PER_ITEM,
        maxTotalChars: MAX_TOTAL_CONTEXT_CHARS,
      }
    : {
        maxItems: GUEST_MAX_CONTEXT_ITEMS,
        maxCharsPerItem: GUEST_MAX_CHARS_PER_ITEM,
        maxTotalChars: GUEST_MAX_TOTAL_CONTEXT_CHARS,
      };
}

const MAX_PDF_PAGES_SCANNED = 25;
const MAX_SLIDES_SCANNED = 40;

export const SUPPORTED_FILE_ACCEPT =
  '.pdf,.docx,.pptx,.xlsx,.odt,.odp,.txt,.md,.markdown,.csv,.tsv,.json,.html,.htm,.rtf,.xml,.yaml,.yml,.py,.ts,.tsx,.js,.jsx,.sql,.tex,.sh,.log';

export function estimateTokens(chars: number): number {
  if (chars <= 0) return 0;
  return Math.max(1, Math.ceil(chars / 4));
}

export function compactContextText(
  raw: string,
  maxChars = MAX_CHARS_PER_ITEM
): { text: string; originalChars: number; trimmed: boolean } {
  const cleaned = raw
    .replace(/\r\n?/g, '\n')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const originalChars = cleaned.length;
  if (originalChars <= maxChars) {
    return { text: cleaned, originalChars, trimmed: false };
  }

  const marker = '\n\n[… trimmed to preserve token budget …]\n\n';
  const available = Math.max(120, maxChars - marker.length);
  const headLen = Math.floor(available * 0.75);
  const tailLen = Math.max(0, available - headLen);
  const head = cleaned.slice(0, headLen).trimEnd();
  const tail = tailLen > 40 ? cleaned.slice(-tailLen).trimStart() : '';

  return {
    text: tail ? `${head}${marker}${tail}` : `${head}…`,
    originalChars,
    trimmed: true,
  };
}

export interface BudgetAllocationResult {
  items: AttachedContext[];
  totalChars: number;
  estimatedTokens: number;
  trimmedAny: boolean;
}

export function allocateContextBudget(
  items: AttachedContext[],
  isAuthenticated = true
): BudgetAllocationResult {
  const limits = getContextBudgetLimits(isAuthenticated);
  const capped = items.slice(0, limits.maxItems);
  if (capped.length === 0) {
    return { items: [], totalChars: 0, estimatedTokens: 0, trimmedAny: false };
  }

  // First pass: compact every item against maxCharsPerItem
  const firstPass = capped.map((item) => {
    const compacted = compactContextText(item.content, limits.maxCharsPerItem);
    const orig = Math.max(item.originalChars ?? 0, compacted.originalChars);
    return {
      item: {
        ...item,
        content: compacted.text,
        originalChars: orig,
        trimmed: Boolean(item.trimmed || compacted.trimmed),
      },
      len: compacted.text.length,
    };
  });

  const combinedLen = firstPass.reduce((sum, entry) => sum + entry.len, 0);
  let finalItems = firstPass.map((entry) => entry.item);

  if (combinedLen > limits.maxTotalChars) {
    // Fair-share water-filling across attachments so total stays <= limits.maxTotalChars
    const baseCap = Math.floor(limits.maxTotalChars / firstPass.length);
    let remainingBudget = limits.maxTotalChars;
    const lengths = new Array<number>(firstPass.length).fill(0);

    // Give small items what they already need first
    const largeIndices: number[] = [];
    firstPass.forEach((entry, i) => {
      if (entry.len <= baseCap) {
        lengths[i] = entry.len;
        remainingBudget -= entry.len;
      } else {
        largeIndices.push(i);
      }
    });

    if (largeIndices.length > 0) {
      const share = Math.max(400, Math.floor(remainingBudget / largeIndices.length));
      largeIndices.forEach((idx, pos) => {
        const isLast = pos === largeIndices.length - 1;
        lengths[idx] = isLast ? Math.min(remainingBudget, firstPass[idx].len) : Math.min(share, firstPass[idx].len);
        remainingBudget = Math.max(0, remainingBudget - lengths[idx]);
      });
    }

    finalItems = firstPass.map((entry, idx) => {
      const targetCap = lengths[idx];
      if (entry.len <= targetCap) return entry.item;
      const compacted = compactContextText(entry.item.content, targetCap);
      return {
        ...entry.item,
        content: compacted.text,
        trimmed: true,
      };
    });
  }

  const totalChars = finalItems.reduce((sum, item) => sum + item.content.length, 0);
  return {
    items: finalItems,
    totalChars,
    estimatedTokens: estimateTokens(totalChars),
    trimmedAny: finalItems.some((item) => Boolean(item.trimmed)),
  };
}

export function formatContextsForPrompt(
  items: AttachedContext[],
  isAuthenticated = true
): string {
  const { items: budgeted, estimatedTokens } = allocateContextBudget(items, isAuthenticated);
  if (budgeted.length === 0) return '';

  const blocks = budgeted.map((item, idx) => {
    const kindLabel = (item.kind ?? 'context').toUpperCase();
    const srcLine = item.sourceUrl ? ` (${item.sourceUrl})` : '';
    return `[Context ${idx + 1} · ${kindLabel}: ${item.title}${srcLine}]\n${item.content}`;
  });

  return `USER-ATTACHED CONTEXT (${budgeted.length} item${budgeted.length > 1 ? 's' : ''}, ~${estimatedTokens} tokens — respond carefully to these materials):\n\n${blocks.join('\n\n')}`;
}

export function resolveEffectiveContextUrl(customProxyUrl?: string): string {
  const custom = customProxyUrl?.trim();
  const baseChat = custom
    ? custom
    : typeof window !== 'undefined' &&
        (window.location.hostname === 'localhost' ||
          window.location.hostname === '127.0.0.1' ||
          window.location.pathname.includes('/ask-avi'))
      ? './api/chat'
      : '';

  if (!baseChat) return '';
  if (baseChat === './api/chat') return './api/context';
  if (baseChat === '/api/chat') return '/api/context';
  if (baseChat.endsWith('/api/chat')) {
    return `${baseChat.slice(0, -'/api/chat'.length)}/api/context`;
  }
  return '';
}

function parseXmlParagraphs(xmlText: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  const paragraphs = Array.from(doc.getElementsByTagNameNS('*', 'p'));
  if (paragraphs.length === 0) {
    return (doc.documentElement?.textContent ?? '').trim();
  }
  const lines: string[] = [];
  for (const p of paragraphs) {
    const runs = Array.from(p.getElementsByTagNameNS('*', 't'));
    const text = (runs.length > 0
      ? runs.map((node) => node.textContent ?? '').join('')
      : p.textContent ?? ''
    ).trim();
    if (text) lines.push(text);
  }
  return lines.join('\n');
}

function stripRtfMarkup(raw: string): string {
  return raw
    .replace(/\{\\(?:fonttbl|colortbl|stylesheet|info|pict|object|header|footer|footnote)[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/gis, ' ')
    .replace(/\\par[d]?\b/gi, '\n')
    .replace(/\\line\b/gi, '\n')
    .replace(/\\tab\b/gi, '\t')
    .replace(/\\'[0-9a-f]{2}/gi, ' ')
    .replace(/\\[a-z]+-?\d* ?/gi, '')
    .replace(/[{}]/g, ' ');
}

function stripHtmlMarkup(raw: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(raw, 'text/html');
  doc.querySelectorAll('script, style, noscript, svg').forEach((el) => el.remove());
  const title = doc.title?.trim();
  const bodyText = (doc.body?.textContent ?? '').replace(/\s+\n/g, '\n').trim();
  return title ? `${title}\n\n${bodyText}` : bodyText;
}

async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
  const [pdfjs, workerUrlMod] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrlMod.default;

  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer) });
  const pdf = await loadingTask.promise;
  const maxPages = Math.min(pdf.numPages, MAX_PDF_PAGES_SCANNED);
  const chunks: string[] = [];
  let collected = 0;

  for (let pageNo = 1; pageNo <= maxPages; pageNo++) {
    const page = await pdf.getPage(pageNo);
    const tc = await page.getTextContent();
    const pageText = tc.items
      .map((item) => ('str' in item && typeof item.str === 'string' ? item.str : ''))
      .join(' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (pageText) {
      chunks.push(`[Page ${pageNo}] ${pageText}`);
      collected += pageText.length;
    }
    if (collected >= MAX_CHARS_PER_ITEM * 2) {
      break;
    }
  }

  await loadingTask.destroy();
  const joined = chunks.join('\n\n').trim();
  if (!joined) {
    throw new Error(
      'This PDF appears to contain scanned images without selectable text. Try pasting key excerpts or uploading text.'
    );
  }
  return joined;
}

async function extractZipDocumentText(
  buffer: ArrayBuffer,
  ext: string
): Promise<{ text: string; kind: AttachedContextKind }> {
  const { unzipSync, strFromU8 } = await import('fflate');
  const files = unzipSync(new Uint8Array(buffer));

  if (ext === 'docx') {
    const entry = files['word/document.xml'];
    if (!entry) throw new Error('Could not find document body inside .docx file.');
    return { text: parseXmlParagraphs(strFromU8(entry)), kind: 'doc' };
  }

  if (ext === 'odt') {
    const entry = files['content.xml'];
    if (!entry) throw new Error('Could not find content inside .odt file.');
    return { text: parseXmlParagraphs(strFromU8(entry)), kind: 'doc' };
  }

  if (ext === 'pptx') {
    const slidePaths = Object.keys(files)
      .filter((k) => /^ppt\/slides\/slide\d+\.xml$/i.test(k))
      .sort((a, b) => {
        const na = Number(a.match(/slide(\d+)\.xml/i)?.[1] ?? 0);
        const nb = Number(b.match(/slide(\d+)\.xml/i)?.[1] ?? 0);
        return na - nb;
      })
      .slice(0, MAX_SLIDES_SCANNED);

    if (slidePaths.length === 0) {
      throw new Error('Could not find slides inside .pptx file.');
    }

    const slides: string[] = [];
    let collected = 0;
    const parser = new DOMParser();
    for (let i = 0; i < slidePaths.length; i++) {
      const xml = strFromU8(files[slidePaths[i]]);
      const doc = parser.parseFromString(xml, 'application/xml');
      let texts = Array.from(doc.getElementsByTagNameNS('*', 't'))
        .map((n) => n.textContent?.trim() ?? '')
        .filter(Boolean);
      if (texts.length === 0 && doc.getElementsByTagName('parsererror').length > 0) {
        texts = Array.from(xml.matchAll(/<(?:[a-z0-9_-]+:)?t(?:\s[^>]*)?>([^<]+)<\/(?:[a-z0-9_-]+:)?t>/gi))
          .map((m) => m[1]?.trim() ?? '')
          .filter(Boolean);
      }
      if (texts.length > 0) {
        const block = `[Slide ${i + 1}] ${texts.join(' ')}`;
        slides.push(block);
        collected += block.length;
      }
      if (collected >= MAX_CHARS_PER_ITEM * 2) break;
    }
    return { text: slides.join('\n\n'), kind: 'slides' };
  }

  if (ext === 'odp') {
    const entry = files['content.xml'];
    if (!entry) throw new Error('Could not find slides inside .odp file.');
    return { text: parseXmlParagraphs(strFromU8(entry)), kind: 'slides' };
  }

  if (ext === 'xlsx') {
    const parser = new DOMParser();
    const sharedStrings: string[] = [];
    if (files['xl/sharedStrings.xml']) {
      const ssDoc = parser.parseFromString(strFromU8(files['xl/sharedStrings.xml']), 'application/xml');
      const items = Array.from(ssDoc.getElementsByTagNameNS('*', 'si'));
      for (const si of items) {
        sharedStrings.push((si.textContent ?? '').trim());
      }
    }
    const sheetPaths = Object.keys(files)
      .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(k))
      .sort()
      .slice(0, 5);

    const out: string[] = [];
    for (const path of sheetPaths) {
      const doc = parser.parseFromString(strFromU8(files[path]), 'application/xml');
      const rows = Array.from(doc.getElementsByTagNameNS('*', 'row')).slice(0, 120);
      for (const row of rows) {
        const cells = Array.from(row.getElementsByTagNameNS('*', 'c')).map((cell) => {
          const t = cell.getAttribute('t');
          const v = cell.getElementsByTagNameNS('*', 'v')[0]?.textContent ?? '';
          if (t === 's' && v !== '') {
            return sharedStrings[Number(v)] ?? v;
          }
          if (t === 'inlineStr') {
            return (cell.getElementsByTagNameNS('*', 't')[0]?.textContent ?? '').trim();
          }
          return v;
        });
        const nonEmpty = cells.filter(Boolean);
        if (nonEmpty.length > 0) out.push(nonEmpty.join(' | '));
      }
    }
    return { text: out.join('\n'), kind: 'doc' };
  }

  throw new Error(`Unsupported archive extension .${ext}`);
}

export async function extractFileContext(file: File): Promise<AttachedContext> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`"${file.name}" is over 12 MB. Please upload a smaller document.`);
  }

  const ext = (file.name.split('.').pop() ?? '').toLowerCase();
  if (ext === 'doc' || ext === 'ppt' || ext === 'xls') {
    throw new Error(
      `Legacy binary .${ext} files cannot be parsed in-browser. Please save as .${ext}x or .pdf first.`
    );
  }

  let extracted = '';
  let kind: AttachedContextKind = 'text';

  if (ext === 'pdf' || file.type === 'application/pdf') {
    extracted = await extractPdfText(await file.arrayBuffer());
    kind = 'pdf';
  } else if (ext === 'docx' || ext === 'pptx' || ext === 'odt' || ext === 'odp' || ext === 'xlsx') {
    const res = await extractZipDocumentText(await file.arrayBuffer(), ext);
    extracted = res.text;
    kind = res.kind;
  } else {
    const rawText = await file.text();
    if (ext === 'html' || ext === 'htm') {
      extracted = stripHtmlMarkup(rawText);
    } else if (ext === 'rtf') {
      extracted = stripRtfMarkup(rawText);
    } else if (ext === 'json') {
      try {
        extracted = JSON.stringify(JSON.parse(rawText));
      } catch {
        extracted = rawText;
      }
    } else {
      extracted = rawText;
    }
    kind = 'text';
  }

  const compacted = compactContextText(extracted, MAX_CHARS_PER_ITEM);
  if (!compacted.text) {
    throw new Error(`No readable text found inside "${file.name}".`);
  }

  return {
    id: `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: file.name,
    content: compacted.text,
    kind,
    originalChars: compacted.originalChars,
    trimmed: compacted.trimmed,
  };
}

export async function fetchUrlContext(
  rawUrl: string,
  sessionToken?: string,
  customProxyUrl?: string
): Promise<AttachedContext> {
  let normalized = rawUrl.trim();
  if (!normalized) {
    throw new Error('Enter a valid https:// or http:// URL.');
  }
  if (!/^https?:\/\//i.test(normalized)) {
    normalized = `https://${normalized}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error('Please enter a valid web link (e.g., https://example.com/article).');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http:// and https:// links are supported.');
  }

  const endpoint = resolveEffectiveContextUrl(customProxyUrl);
  if (!endpoint) {
    throw new Error(
      'Fetching external links requires the Ask Avi backend endpoint (active on aviperera.com/ask-avi).'
    );
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
    },
    body: JSON.stringify({ url: parsed.toString() }),
  });

  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    title?: string;
    content?: string;
    url?: string;
  };

  if (!res.ok || !data.ok || !data.content) {
    throw new Error(data.error || `Unable to extract readable content from link (${res.status}).`);
  }

  const compacted = compactContextText(data.content, MAX_CHARS_PER_ITEM);
  return {
    id: `link-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: data.title?.trim() || parsed.hostname,
    content: compacted.text,
    sourceUrl: data.url || parsed.toString(),
    kind: 'link',
    originalChars: compacted.originalChars,
    trimmed: compacted.trimmed,
  };
}
