import type { WebSource } from '../types/chat';

export interface GeminiChunkDelta {
  thoughtDelta: string;
  answerDelta: string;
  webSearchQueries: string[];
  webSources: WebSource[];
}

interface RawGeminiPart {
  text?: string;
  thought?: boolean;
}

interface RawGroundingChunk {
  web?: {
    uri?: string;
    title?: string;
  };
}

interface RawGeminiCandidate {
  content?: {
    parts?: RawGeminiPart[];
  };
  groundingMetadata?: {
    webSearchQueries?: string[];
    groundingChunks?: RawGroundingChunk[];
  };
}

interface RawGeminiChunk {
  candidates?: RawGeminiCandidate[];
}

export function extractGeminiChunkDelta(payloadJson: string): GeminiChunkDelta {
  const out: GeminiChunkDelta = {
    thoughtDelta: '',
    answerDelta: '',
    webSearchQueries: [],
    webSources: [],
  };

  let parsed: RawGeminiChunk;
  try {
    parsed = JSON.parse(payloadJson) as RawGeminiChunk;
  } catch {
    return out;
  }

  const cand = parsed.candidates?.[0];
  if (!cand) return out;

  const parts = cand.content?.parts ?? [];
  for (const part of parts) {
    if (!part.text) continue;
    if (part.thought === true) {
      out.thoughtDelta += part.text;
    } else {
      out.answerDelta += part.text;
    }
  }

  const meta = cand.groundingMetadata;
  if (meta) {
    if (Array.isArray(meta.webSearchQueries)) {
      for (const q of meta.webSearchQueries) {
        const clean = q?.trim();
        if (clean) out.webSearchQueries.push(clean);
      }
    }
    if (Array.isArray(meta.groundingChunks)) {
      meta.groundingChunks.forEach((chunk, idx) => {
        const uri = chunk.web?.uri?.trim();
        const title = chunk.web?.title?.trim() || uri;
        if (uri && title) {
          out.webSources.push({ index: idx + 1, title, url: uri });
        }
      });
    }
  }

  return out;
}

export function mergeUniqueQueries(existing: string[], incoming: string[]): string[] {
  if (incoming.length === 0) return existing;
  const set = new Set(existing);
  const next = [...existing];
  for (const q of incoming) {
    if (!set.has(q)) {
      set.add(q);
      next.push(q);
    }
  }
  return next;
}

export function mergeUniqueWebSources(existing: WebSource[], incoming: WebSource[]): WebSource[] {
  if (incoming.length === 0) return existing;
  const seen = new Set(existing.map((s) => s.url));
  const next = [...existing];
  for (const src of incoming) {
    if (!seen.has(src.url)) {
      seen.add(src.url);
      next.push({
        index: next.length + 1,
        title: src.title,
        url: src.url,
      });
    }
  }
  return next;
}
