import type { RetrievedSource, WebSource } from '../types/chat';
import { resolveSourceUrl } from '../utils/markdown';

export interface CandidateSource {
  tempIndex: number;
  kind: 'archive' | 'web';
  title: string;
  url: string;
  doi?: string;
  snippet: string;
  archiveSource?: RetrievedSource;
  webSource?: WebSource;
}

export interface AlignedCitationsResult {
  content: string;
  sources: RetrievedSource[];
  webSources: WebSource[];
}

function normalizeUrlKey(raw: string): string {
  return raw.trim().replace(/\/+$/, '').toLowerCase();
}

/**
 * Merges retrieved Avi archive sources and external open-web/academic sources into
 * a single deduplicated, sequentially numbered pool `[1]..[N]` so in-text citations
 * map unambiguously to both internal writings and external research.
 */
export function mergeCandidateSources(
  archiveSources: RetrievedSource[],
  webSources: WebSource[]
): CandidateSource[] {
  const candidates: CandidateSource[] = [];
  const seenUrls = new Set<string>();
  const seenEntryIds = new Set<string>();

  for (const src of archiveSources) {
    if (seenEntryIds.has(src.entry.id)) continue;
    const resolvedUrl = resolveSourceUrl(src.entry.url, src.entry.doi);
    const urlKey = resolvedUrl ? normalizeUrlKey(resolvedUrl) : '';
    if (urlKey && seenUrls.has(urlKey)) continue;

    seenEntryIds.add(src.entry.id);
    if (urlKey) seenUrls.add(urlKey);

    candidates.push({
      tempIndex: candidates.length + 1,
      kind: 'archive',
      title: src.entry.title,
      url: resolvedUrl,
      doi: src.entry.doi,
      snippet: src.snippet.replace(/\s+/g, ' ').trim().slice(0, 380),
      archiveSource: src,
    });
  }

  for (const ws of webSources) {
    const resolvedUrl = resolveSourceUrl(ws.url);
    if (!resolvedUrl) continue;
    const urlKey = normalizeUrlKey(resolvedUrl);
    if (seenUrls.has(urlKey)) continue;
    seenUrls.add(urlKey);

    candidates.push({
      tempIndex: candidates.length + 1,
      kind: 'web',
      title: ws.title,
      url: resolvedUrl,
      snippet: (ws.snippet ?? '').replace(/\s+/g, ' ').trim().slice(0, 420),
      webSource: ws,
    });
  }

  return candidates;
}

/**
 * Formats unified `[1]..[N]` reference blocks split cleanly for backend prompt injection
 * (`archiveBlock` for archive items and `webContext` for external web items).
 */
export function splitFormattedCandidateBlocks(candidates: CandidateSource[]): {
  archiveBlock: string;
  webContext: string;
  archiveCandidates: RetrievedSource[];
  webCandidates: WebSource[];
} {
  const archiveLines: string[] = [];
  const webLines: string[] = [];
  const archiveCandidates: RetrievedSource[] = [];
  const webCandidates: WebSource[] = [];

  for (const cand of candidates) {
    if (cand.kind === 'archive' && cand.archiveSource) {
      const doiTag = cand.doi ? ` (DOI: ${cand.doi})` : '';
      archiveLines.push(
        `[${cand.tempIndex}] ${cand.title}${doiTag} — ${cand.url}\nContext: ${cand.snippet}`
      );
      archiveCandidates.push({
        ...cand.archiveSource,
        index: cand.tempIndex,
      });
    } else if (cand.kind === 'web' && cand.webSource) {
      webLines.push(
        `[${cand.tempIndex}] ${cand.title} — ${cand.url}${cand.snippet ? `\nExcerpt: ${cand.snippet}` : ''}`
      );
      webCandidates.push({
        ...cand.webSource,
        index: cand.tempIndex,
      });
    }
  }

  const citationHeader =
    candidates.length > 0
      ? 'Cite sources inline ONLY as [n] matching the exact numbers assigned below, and cite a source only if your claim genuinely relies on it:\n'
      : '';

  return {
    archiveBlock: archiveLines.length > 0 ? archiveLines.join('\n\n') : '',
    webContext:
      webLines.length > 0
        ? `${archiveLines.length === 0 ? citationHeader : ''}LIVE OPEN-WEB & ACADEMIC REFERENCES:\n${webLines.join('\n\n')}`
        : '',
    archiveCandidates,
    webCandidates,
  };
}

/**
 * Splits markdown into prose segments vs protected code segments (fenced & inline code)
 * so citation parsing/rewriting never mutates array literals like `items[1]` inside code.
 */
function transformProseSegments(
  markdown: string,
  transform: (prose: string) => string
): string {
  const parts = markdown.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`)/g);
  return parts
    .map((part, idx) => (idx % 2 === 1 ? part : transform(part)))
    .join('');
}

const CITE_GROUP_RE = /\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\](?!\(|\[|:)/g;

/**
 * Parses `[n]` (and comma groups like `[1, 3]`) actually cited in the final answer,
 * strips out-of-range/hallucinated citation markers not present in candidates,
 * excludes uncited exploratory research sources from the rendered footer,
 * and re-indexes remaining sources sequentially `[1]`, `[2]`, ... 1:1 with prose pills.
 */
export function alignCitedSources(
  answerMarkdown: string,
  candidates: CandidateSource[],
  extraGroundedWebSources?: WebSource[]
): AlignedCitationsResult {
  if (!answerMarkdown.trim()) {
    return { content: answerMarkdown, sources: [], webSources: [] };
  }

  const candidateByTempId = new Map<number, CandidateSource>();
  for (const c of candidates) {
    candidateByTempId.set(c.tempIndex, c);
  }

  // First normalize valid numeric groups [1, 3] -> [1] [3] while scanning cited indices in appearance order
  // and removing hallucinated out-of-range markers like [2] when only [1] was provided.
  const citedOrder: number[] = [];
  const seenTempIds = new Set<number>();

  const normalizedMarkdown = transformProseSegments(answerMarkdown, (prose) => {
    let strippedInvalid = false;
    const replaced = prose.replace(CITE_GROUP_RE, (_fullMatch, groupStr: string) => {
      const nums = groupStr
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && candidateByTempId.has(n));

      if (nums.length === 0) {
        strippedInvalid = true;
        return '';
      }

      for (const n of nums) {
        if (!seenTempIds.has(n)) {
          seenTempIds.add(n);
          citedOrder.push(n);
        }
      }
      return nums.map((n) => `[${n}]`).join(' ');
    });
    if (!strippedInvalid) return replaced;
    return replaced
      .replace(/[ \t\u00A0\u202F]+([.,;:!?])/g, '$1')
      .replace(/[ \t]{2,}/g, ' ');
  });

  // Assign sequential final indices 1..K to strictly cited candidates
  const remap = new Map<number, number>();
  const finalArchive: RetrievedSource[] = [];
  const finalWeb: WebSource[] = [];
  const includedUrls = new Set<string>();

  citedOrder.forEach((oldIdx, pos) => {
    const newIdx = pos + 1;
    remap.set(oldIdx, newIdx);
    const cand = candidateByTempId.get(oldIdx);
    if (!cand) return;

    if (cand.url) includedUrls.add(normalizeUrlKey(cand.url));

    if (cand.kind === 'archive' && cand.archiveSource) {
      finalArchive.push({
        ...cand.archiveSource,
        index: newIdx,
      });
    } else if (cand.kind === 'web' && cand.webSource) {
      finalWeb.push({
        index: newIdx,
        title: cand.webSource.title,
        url: cand.webSource.url,
        ...(cand.webSource.snippet ? { snippet: cand.webSource.snippet } : {}),
      });
    }
  });

  // Optionally append native Gemini groundingChunks that were explicitly supported by groundingSupports
  if (extraGroundedWebSources && extraGroundedWebSources.length > 0) {
    for (const ws of extraGroundedWebSources) {
      const cleanUrl = resolveSourceUrl(ws.url);
      if (!cleanUrl) continue;
      const key = normalizeUrlKey(cleanUrl);
      if (includedUrls.has(key)) continue;
      includedUrls.add(key);

      const nextIdx = finalArchive.length + finalWeb.length + 1;
      finalWeb.push({
        index: nextIdx,
        title: ws.title,
        url: cleanUrl,
      });
    }
  }

  const finalContent =
    remap.size > 0
      ? transformProseSegments(normalizedMarkdown, (prose) =>
          prose.replace(/\[(\d{1,2})\](?!\()/g, (fullMatch, numStr: string) => {
            const oldNum = Number(numStr);
            const mapped = remap.get(oldNum);
            return mapped ? `[${mapped}]` : fullMatch;
          })
        )
      : normalizedMarkdown;

  return {
    content: finalContent,
    sources: finalArchive,
    webSources: finalWeb,
  };
}
