import type { WebSource } from '../types/chat';

export interface GeminiChunkDelta {
  thoughtDelta: string;
  answerDelta: string;
  webSearchQueries: string[];
  webSources: WebSource[];
  groundedChunkUrls: string[];
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

interface RawGroundingSupport {
  groundingChunkIndices?: number[];
}

interface RawGeminiCandidate {
  content?: {
    parts?: RawGeminiPart[];
  };
  groundingMetadata?: {
    webSearchQueries?: string[];
    groundingChunks?: RawGroundingChunk[];
    groundingSupports?: RawGroundingSupport[];
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
    groundedChunkUrls: [],
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
      const supportedIndices = new Set<number>();
      if (Array.isArray(meta.groundingSupports)) {
        for (const sup of meta.groundingSupports) {
          for (const idx of sup.groundingChunkIndices ?? []) {
            if (typeof idx === 'number') supportedIndices.add(idx);
          }
        }
      }
      meta.groundingChunks.forEach((chunk, idx) => {
        const uri = chunk.web?.uri?.trim();
        const title = chunk.web?.title?.trim() || uri;
        if (uri && title) {
          out.webSources.push({ index: idx + 1, title, url: uri });
          if (supportedIndices.has(idx)) {
            out.groundedChunkUrls.push(uri);
          }
        }
      });
    }
  }

  return out;
}

interface RawOpenAIChunk {
  choices?: Array<{
    delta?: {
      content?: string;
      reasoning?: string;
      reasoning_content?: string;
      reasoning_details?: Array<{ text?: string; summary?: string }>;
    };
  }>;
  response?: string;
  reasoning?: string;
}

/**
 * Extracts streamed text and reasoning deltas from OpenAI-compatible SSE chunks
 * (Groq, OpenRouter, custom endpoints, or Cloudflare Workers AI).
 */
export function extractOpenAIChunkDelta(payloadJson: string): GeminiChunkDelta {
  const out: GeminiChunkDelta = {
    thoughtDelta: '',
    answerDelta: '',
    webSearchQueries: [],
    webSources: [],
    groundedChunkUrls: [],
  };

  let parsed: RawOpenAIChunk;
  try {
    parsed = JSON.parse(payloadJson) as RawOpenAIChunk;
  } catch {
    return out;
  }

  const delta = parsed.choices?.[0]?.delta;
  if (delta) {
    if (typeof delta.reasoning === 'string' && delta.reasoning.length > 0) {
      out.thoughtDelta += delta.reasoning;
    } else if (
      typeof delta.reasoning_content === 'string' &&
      delta.reasoning_content.length > 0
    ) {
      out.thoughtDelta += delta.reasoning_content;
    } else if (Array.isArray(delta.reasoning_details)) {
      for (const item of delta.reasoning_details) {
        const piece = item.text || item.summary || '';
        if (piece) out.thoughtDelta += piece;
      }
    }

    if (typeof delta.content === 'string' && delta.content.length > 0) {
      out.answerDelta += delta.content;
    }
    return out;
  }

  // Workers AI fallback format ({ response, reasoning })
  if (typeof parsed.reasoning === 'string' && parsed.reasoning.length > 0) {
    out.thoughtDelta += parsed.reasoning;
  }
  if (typeof parsed.response === 'string' && parsed.response.length > 0) {
    out.answerDelta += parsed.response;
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
