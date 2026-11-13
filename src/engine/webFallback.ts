import type { WebSource } from '../types/chat';

export interface OpenWebFallbackResult {
  queries: string[];
  webSources: WebSource[];
  contextBlock: string;
}

const TRIVIAL_QUERY_RE =
  /^(hi|hello|hey|good morning|good afternoon|good evening|thanks|thank you|ok|okay|yes|no|yo|sup)[!.,?\s]*$/i;

function mergeAbortSignals(a?: AbortSignal, b?: AbortSignal): AbortSignal | undefined {
  if (!a) return b;
  if (!b) return a;
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any([a, b]);
  }
  const ctrl = new AbortController();
  const abort = () => ctrl.abort();
  if (a.aborted || b.aborted) {
    ctrl.abort();
  } else {
    a.addEventListener('abort', abort, { once: true });
    b.addEventListener('abort', abort, { once: true });
  }
  return ctrl.signal;
}

function stripHtmlTags(raw: string): string {
  return raw.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

/**
 * Queries CORS-enabled public knowledge APIs (Wikipedia & Crossref) when
 * native Gemini Google Search grounding hits a free-tier quota limit.
 */
export async function fetchOpenWebFallback(
  query: string,
  userSignal?: AbortSignal
): Promise<OpenWebFallbackResult> {
  const cleaned = query.replace(/\s+/g, ' ').trim();
  if (cleaned.length < 6 || TRIVIAL_QUERY_RE.test(cleaned)) {
    return { queries: [], webSources: [], contextBlock: '' };
  }

  const searchTerm = cleaned.slice(0, 140);
  const timeoutSignal =
    typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(3500) : undefined;
  const signal = mergeAbortSignals(userSignal, timeoutSignal);

  const webSources: WebSource[] = [];
  const snippetLines: string[] = [];

  const wikiPromise = (async () => {
    try {
      const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
        searchTerm
      )}&srlimit=3&utf8=1&format=json&origin=*`;
      const res = await fetch(url, { signal });
      if (!res.ok) return;
      const data = (await res.json()) as {
        query?: {
          search?: Array<{ title?: string; snippet?: string }>;
        };
      };
      for (const hit of data.query?.search ?? []) {
        const title = hit.title?.trim();
        if (!title) continue;
        const pageUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
        const snippet = stripHtmlTags(hit.snippet ?? '');
        if (!webSources.some((w) => w.url === pageUrl)) {
          webSources.push({ index: webSources.length + 1, title: `${title} — Wikipedia`, url: pageUrl });
          snippetLines.push(`- ${title} (${pageUrl}): ${snippet}`);
        }
      }
    } catch {
      // Best-effort lookup; ignore network/abort failures gracefully
    }
  })();

  const crossrefPromise = (async () => {
    try {
      const url = `https://api.crossref.org/works?query=${encodeURIComponent(
        searchTerm
      )}&rows=2&select=title,URL,published`;
      const res = await fetch(url, { signal });
      if (!res.ok) return;
      const data = (await res.json()) as {
        message?: {
          items?: Array<{
            title?: string[];
            URL?: string;
            published?: { 'date-parts'?: number[][] };
          }>;
        };
      };
      for (const item of data.message?.items ?? []) {
        const title = item.title?.[0]?.trim();
        const urlStr = item.URL?.trim();
        if (!title || !urlStr) continue;
        const year = item.published?.['date-parts']?.[0]?.[0];
        const label = year ? `${title} (${year})` : title;
        if (!webSources.some((w) => w.url === urlStr)) {
          webSources.push({ index: webSources.length + 1, title: label, url: urlStr });
          snippetLines.push(`- Research paper: ${label} (${urlStr})`);
        }
      }
    } catch {
      // Best-effort lookup; ignore network/abort failures gracefully
    }
  })();

  await Promise.all([wikiPromise, crossrefPromise]);

  if (snippetLines.length === 0) {
    return { queries: [], webSources: [], contextBlock: '' };
  }

  return {
    queries: [searchTerm],
    webSources: webSources.slice(0, 5),
    contextBlock: `LIVE OPEN-WEB REFERENCE SNIPPETS:\n${snippetLines.join('\n')}`,
  };
}
