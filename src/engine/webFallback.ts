import type { WebSource } from '../types/chat';

export interface OpenWebFallbackResult {
  queries: string[];
  webSources: WebSource[];
  contextBlock: string;
}

const TRIVIAL_QUERY_RE =
  /^(hi|hello|hey|good morning|good afternoon|good evening|thanks|thank you|ok|okay|yes|no|yo|sup)[!.,?\s]*$/i;

const QUERY_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'being', 'but', 'by',
  'can', 'could', 'did', 'do', 'does', 'doing', 'done', 'draw', 'draws',
  'explain', 'for', 'from', 'get', 'give', 'had', 'has', 'have', 'how', 'i',
  'if', 'in', 'into', 'is', 'it', 'its', 'just', 'like', 'look', 'looking',
  'make', 'may', 'me', 'might', 'more', 'most', 'must', 'my', 'no', 'not',
  'now', 'of', 'on', 'or', 'our', 'out', 'please', 'right', 'say', 'see',
  'should', 'show', 'so', 'some', 'such', 'tell', 'than', 'that', 'the',
  'their', 'them', 'then', 'there', 'these', 'they', 'think', 'thinker',
  'thinkers', 'this', 'those', 'to', 'too', 'up', 'us', 'very', 'view',
  'was', 'way', 'we', 'were', 'what', 'when', 'where', 'which', 'who',
  'why', 'will', 'with', 'would', 'you', 'your', 'avi', 'perera',
]);

const JUNK_PAPER_TITLE_RE = /^(?:conclusion|introduction|abstract|discussion|references|appendix|preface|index|editorial)\b[:\s-]*/i;

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
  return raw
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]/g, '')
    .split(/[^a-z0-9-]+/)
    .filter((tok) => tok.length >= 2 && !QUERY_STOP_WORDS.has(tok));
}

/**
 * Converts a conversational user prompt into a clean, compact keyword query
 * so encyclopaedic and academic search engines do not match filler phrasing.
 */
export function extractSearchKeywords(rawQuery: string, conversationHint?: string): string {
  const cleaned = rawQuery.replace(/\s+/g, ' ').trim();
  if (!cleaned || TRIVIAL_QUERY_RE.test(cleaned)) return '';

  const baseTokens = tokenizeKeywords(cleaned);
  let combined = baseTokens;
  if (baseTokens.length <= 4 && conversationHint) {
    const hintTokens = tokenizeKeywords(conversationHint);
    combined = Array.from(new Set([...baseTokens, ...hintTokens])).slice(0, 7);
  } else {
    combined = Array.from(new Set(baseTokens)).slice(0, 7);
  }

  return combined.join(' ').trim();
}

function reconstructAbstract(invertedIndex?: Record<string, number[]> | null): string {
  if (!invertedIndex || typeof invertedIndex !== 'object') return '';
  const words: string[] = [];
  for (const [token, positions] of Object.entries(invertedIndex)) {
    if (!Array.isArray(positions)) continue;
    for (const pos of positions) {
      if (typeof pos === 'number' && pos >= 0 && pos < 160) {
        words[pos] = token;
      }
    }
  }
  return words
    .filter((w) => typeof w === 'string' && w.length > 0)
    .join(' ')
    .replace(/\s+([.,;:?!])/g, '$1')
    .trim()
    .slice(0, 520);
}

interface ScoredWebCandidate {
  title: string;
  url: string;
  snippet: string;
  relevance: number;
}

function scoreWebCandidate(
  queryTokens: string[],
  title: string,
  snippet: string,
  url: string,
  isAcademic = false
): number {
  const cleanTitle = title.trim();
  if (!cleanTitle || cleanTitle.length < 4) return -1;
  if (isAcademic && JUNK_PAPER_TITLE_RE.test(cleanTitle) && cleanTitle.split(/\s+/).length < 5) {
    return -1;
  }
  if (/\(disambiguation\)$/i.test(cleanTitle)) return -1;
  if (!snippet || snippet.length < 25) {
    // Reject empty/stub hits unless title overlaps strongly
    const lowerTitleOnly = cleanTitle.toLowerCase();
    const hits = queryTokens.filter((t) => lowerTitleOnly.includes(t)).length;
    if (hits < 2) return -1;
  }

  const lowerTitle = cleanTitle.toLowerCase();
  const lowerBody = `${lowerTitle} ${snippet.toLowerCase()}`;
  let titleHits = 0;
  let bodyHits = 0;

  for (const tok of queryTokens) {
    if (lowerTitle.includes(tok)) titleHits += 1;
    if (lowerBody.includes(tok)) bodyHits += 1;
  }

  // Require at least one keyword hit in the title OR two distinct hits in body+title
  if (titleHits === 0 && bodyHits < Math.min(2, queryTokens.length)) {
    return -1;
  }

  let score = titleHits * 3.0 + bodyHits * 1.1;
  if (snippet.length >= 120) score += 0.8;
  if (isAcademic && /^https?:\/\/(dx\.)?doi\.org\//i.test(url)) score += 0.4;
  return score;
}

async function fetchSingleWebQuery(
  searchTerm: string,
  signal: AbortSignal | undefined
): Promise<ScoredWebCandidate[]> {
  const queryTokens = tokenizeKeywords(searchTerm);
  if (queryTokens.length === 0) return [];

  const results: ScoredWebCandidate[] = [];

  const wikiPromise = (async () => {
    try {
      const url = `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(
        searchTerm
      )}&gsrlimit=4&prop=extracts|info&inprop=url&exintro=1&explaintext=1&exchars=560&format=json&origin=*`;
      const res = await fetch(url, { signal });
      if (!res.ok) return;
      const data = (await res.json()) as {
        query?: {
          pages?: Record<
            string,
            { title?: string; fullurl?: string; extract?: string; index?: number }
          >;
        };
      };
      const pages = Object.values(data.query?.pages ?? {}).sort(
        (a, b) => (a.index ?? 99) - (b.index ?? 99)
      );
      for (const page of pages) {
        const title = page.title?.trim();
        if (!title) continue;
        const pageUrl =
          page.fullurl?.trim() ||
          `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
        const snippet = stripHtmlTags(page.extract ?? '').slice(0, 520);
        const relevance = scoreWebCandidate(queryTokens, title, snippet, pageUrl, false);
        if (relevance > 0) {
          results.push({
            title: `${title} — Wikipedia`,
            url: pageUrl,
            snippet,
            relevance,
          });
        }
      }
    } catch {
      // Ignore network/abort failures gracefully
    }
  })();

  const openAlexPromise = (async (): Promise<number> => {
    let added = 0;
    try {
      const url = `https://api.openalex.org/works?search=${encodeURIComponent(
        searchTerm
      )}&per-page=3&select=title,doi,publication_year,primary_location,abstract_inverted_index`;
      const res = await fetch(url, { signal });
      if (!res.ok) return 0;
      const data = (await res.json()) as {
        results?: Array<{
          title?: string;
          doi?: string | null;
          publication_year?: number | null;
          primary_location?: { landing_page_url?: string | null } | null;
          abstract_inverted_index?: Record<string, number[]> | null;
        }>;
      };
      for (const work of data.results ?? []) {
        const title = stripHtmlTags(work.title ?? '');
        const rawUrl = work.doi?.trim() || work.primary_location?.landing_page_url?.trim() || '';
        const urlStr = rawUrl.startsWith('http')
          ? rawUrl
          : rawUrl
            ? `https://doi.org/${rawUrl.replace(/^doi:\s*/i, '')}`
            : '';
        if (!title || !urlStr) continue;
        const snippet = reconstructAbstract(work.abstract_inverted_index);
        const relevance = scoreWebCandidate(queryTokens, title, snippet, urlStr, true);
        if (relevance > 0) {
          const label = work.publication_year ? `${title} (${work.publication_year})` : title;
          results.push({
            title: label,
            url: urlStr,
            snippet: snippet || `Peer-reviewed / scholarly publication (${work.publication_year ?? 'n.d.'}).`,
            relevance,
          });
          added += 1;
        }
      }
    } catch {
      // Fallback handled cleanly
    }
    return added;
  })();

  const [, oaCount] = await Promise.all([wikiPromise, openAlexPromise]);

  // Fallback to Crossref only when OpenAlex yields no relevant academic hits
  if (oaCount === 0 && !signal?.aborted) {
    try {
      const url = `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(
        searchTerm
      )}&rows=2&select=title,URL,published`;
      const res = await fetch(url, { signal });
      if (res.ok) {
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
          const title = stripHtmlTags(item.title?.[0] ?? '');
          const urlStr = item.URL?.trim() ?? '';
          if (!title || !urlStr) continue;
          const relevance = scoreWebCandidate(queryTokens, title, title, urlStr, true);
          if (relevance > 0) {
            const year = item.published?.['date-parts']?.[0]?.[0];
            const label = year ? `${title} (${year})` : title;
            results.push({
              title: label,
              url: urlStr,
              snippet: `Scholarly work indexed by Crossref (${year ?? 'n.d.'}).`,
              relevance,
            });
          }
        }
      }
    } catch {
      // Best-effort lookup
    }
  }

  return results;
}

/**
 * Executes multiple focused open-web & academic research queries, deduplicates
 * and filters irrelevant hits, and returns rich snippets for grounded reasoning.
 */
export async function fetchTargetedWebResearch(
  queries: string[],
  options?: { userSignal?: AbortSignal; maxSources?: number; timeoutMs?: number }
): Promise<OpenWebFallbackResult> {
  const cleanQueries = Array.from(
    new Set(
      queries
        .map((q) => q.replace(/\s+/g, ' ').trim().slice(0, 110))
        .filter((q) => q.length >= 4 && !TRIVIAL_QUERY_RE.test(q))
    )
  ).slice(0, 3);

  if (cleanQueries.length === 0) {
    return { queries: [], webSources: [], contextBlock: '' };
  }

  const timeoutSignal =
    typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(options?.timeoutMs ?? 5500)
      : undefined;
  const signal = mergeAbortSignals(options?.userSignal, timeoutSignal);

  const perQueryHits = await Promise.all(
    cleanQueries.map((q) => fetchSingleWebQuery(q, signal))
  );

  const deduped = new Map<string, ScoredWebCandidate>();
  for (const hitList of perQueryHits) {
    for (const hit of hitList) {
      const existing = deduped.get(hit.url);
      if (!existing || hit.relevance > existing.relevance) {
        deduped.set(hit.url, hit);
      }
    }
  }

  const maxSources = options?.maxSources ?? 6;
  const ranked = Array.from(deduped.values())
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, maxSources);

  if (ranked.length === 0) {
    return { queries: cleanQueries, webSources: [], contextBlock: '' };
  }

  const webSources: WebSource[] = ranked.map((item, idx) => ({
    index: idx + 1,
    title: item.title,
    url: item.url,
    snippet: item.snippet,
  }));

  const contextLines = ranked.map(
    (item) => `- ${item.title} (${item.url})\n  Excerpt: ${item.snippet}`
  );

  return {
    queries: cleanQueries,
    webSources,
    contextBlock: `LIVE OPEN-WEB & ACADEMIC EVIDENCE:\n${contextLines.join('\n')}`,
  };
}

/**
 * Backwards-compatible open-web fallback extracting clean search keywords
 * from conversational prompts before querying Wikipedia & OpenAlex/Crossref.
 */
export async function fetchOpenWebFallback(
  query: string,
  userSignal?: AbortSignal,
  conversationHint?: string
): Promise<OpenWebFallbackResult> {
  const cleaned = query.replace(/\s+/g, ' ').trim();
  if (cleaned.length < 6 || TRIVIAL_QUERY_RE.test(cleaned)) {
    return { queries: [], webSources: [], contextBlock: '' };
  }

  const focused = extractSearchKeywords(cleaned, conversationHint);
  if (!focused) {
    return { queries: [], webSources: [], contextBlock: '' };
  }

  return fetchTargetedWebResearch([focused], { userSignal, maxSources: 5 });
}
