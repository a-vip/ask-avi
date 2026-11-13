import { buildAviSystemPrompt, ENGINE_OPTIONS } from '../data/persona';
import type {
  AttachedContext,
  ChatMessage,
  CustomApiConfig,
  EngineId,
  RetrievedSource,
  VoiceStyle,
  WebSource,
} from '../types/chat';
import { splitThinkingAndAnswer } from '../utils/thinking';
import {
  extractGeminiChunkDelta,
  mergeUniqueQueries,
  mergeUniqueWebSources,
} from './geminiStream';
import { knowledgeIndex } from './rag';

export class BackendNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackendNotConfiguredError';
  }
}

export interface StreamProgressPayload {
  content: string;
  thoughts: string;
  isThinking: boolean;
  thinkingMs: number;
  webSearchQueries: string[];
  webSources: WebSource[];
}

export interface StreamGenerateParams {
  query: string;
  history: ChatMessage[];
  engineId: EngineId;
  voiceStyle: VoiceStyle;
  webSearchEnabled: boolean;
  geminiApiKey?: string;
  proxyUrl?: string;
  attachedContext?: AttachedContext;
  customApi?: CustomApiConfig;
  signal?: AbortSignal;
  onUpdate: (update: StreamProgressPayload) => void;
}

export interface StreamGenerateResult extends StreamProgressPayload {
  engineUsed: EngineId;
  modelLabel: string;
  sources: RetrievedSource[];
  retrievalMs: number;
  followUps: string[];
}

function buildConversationWindow(
  history: ChatMessage[],
  maxTurns: number,
  maxChars: number
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const cleaned = history
    .filter((m) => !m.isStreaming && !m.needsBackendSetup && m.content.trim().length > 0)
    .slice(-maxTurns)
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content.trim().slice(0, 2600),
    }));

  const out: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  let budget = maxChars;
  for (let i = cleaned.length - 1; i >= 0; i--) {
    const turn = cleaned[i];
    if (out.length > 0 && turn.content.length > budget) break;
    budget -= turn.content.length;
    out.unshift(turn);
  }
  return out;
}

export function resolveEffectiveProxyUrl(customProxyUrl?: string): string {
  const userConfigured = customProxyUrl?.trim();
  if (userConfigured) return userConfigured;

  const envUrl = import.meta.env.VITE_API_ENDPOINT?.trim();
  if (envUrl) return envUrl;

  if (typeof window !== 'undefined') {
    const host = window.location.hostname.toLowerCase();
    // Static GitHub Pages cannot host serverless functions at /api/chat
    if (!host.endsWith('github.io')) {
      return '/api/chat';
    }
  }
  return '';
}

class AviLLMService {
  public async generateReply(params: StreamGenerateParams): Promise<StreamGenerateResult> {
    const recentUserHint = params.history
      .filter((m) => m.role === 'user')
      .slice(-2)
      .map((m) => m.content)
      .join(' ');

    // Only pull Avi archive references when genuinely topical (high relevance threshold)
    const { sources, elapsedMs } = knowledgeIndex.search(params.query, {
      topK: 3,
      minScore: 4.5,
      conversationHint: recentUserHint,
    });

    const opt = ENGINE_OPTIONS.find((o) => o.id === params.engineId) ?? ENGINE_OPTIONS[0];

    // 1. Optional Custom OpenAI-Compatible Endpoint (BYOK power users)
    if (
      params.engineId === 'custom-api' &&
      params.customApi?.endpointUrl?.trim() &&
      params.customApi?.modelName?.trim()
    ) {
      return this.streamCustomOpenAI(params, sources, elapsedMs);
    }

    // 2. Native Gemini 2.5 (Extended Thinking + Live Google Search)
    const modelId = opt.geminiModelId ?? 'gemini-2.5-flash';
    const thinkingBudget = opt.thinkingBudget ?? 8192;
    const directKey = params.geminiApiKey?.trim();
    const proxyUrl = resolveEffectiveProxyUrl(params.proxyUrl);

    if (!directKey && !proxyUrl) {
      throw new BackendNotConfiguredError(
        'Connect your Gemini API key in Settings (or configure ASK_AVI_API_ENDPOINT to your Vercel/Cloudflare proxy) to enable live thinking and internet search.'
      );
    }

    const systemInstruction = buildAviSystemPrompt(
      params.voiceStyle,
      sources,
      params.attachedContext?.content,
      false
    );

    const historyTurns = buildConversationWindow(params.history, 14, 16000);
    const contents = [
      ...historyTurns.map((m) => ({
        role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
        parts: [{ text: m.content }],
      })),
      { role: 'user' as const, parts: [{ text: params.query }] },
    ];

    const temperature = params.voiceStyle === 'academic' ? 0.5 : 0.78;

    let response: Response;
    if (directKey) {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        modelId
      )}:streamGenerateContent?alt=sse&key=${encodeURIComponent(directKey)}`;

      const bodyPayload: Record<string, unknown> = {
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents,
        generationConfig: {
          temperature,
          topP: 0.92,
          maxOutputTokens: 8192,
          thinkingConfig: {
            includeThoughts: true,
            thinkingBudget,
          },
        },
      };
      if (params.webSearchEnabled) {
        bodyPayload.tools = [{ googleSearch: {} }];
      }

      response = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: params.signal,
        body: JSON.stringify(bodyPayload),
      });
    } else {
      response = await fetch(proxyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: params.signal,
        body: JSON.stringify({
          model: modelId,
          systemInstruction,
          contents,
          thinkingBudget,
          enableSearch: params.webSearchEnabled,
          temperature,
        }),
      });
    }

    if (!response.ok || !response.body) {
      let errBody = '';
      try {
        errBody = await response.text();
      } catch {
        // Ignore read error
      }
      if (
        response.status === 503 &&
        (errBody.includes('proxy_unconfigured') || errBody.includes('GEMINI_API_KEY'))
      ) {
        throw new BackendNotConfiguredError(
          'Serverless proxy is live, awaiting GEMINI_API_KEY configuration—or paste a personal Gemini API key in Settings to test right away.'
        );
      }
      if (response.status === 404 && !directKey) {
        throw new BackendNotConfiguredError(
          'No live API backend is connected at this origin yet. Add a Gemini API key or serverless proxy URL in Settings.'
        );
      }
      throw new Error(
        `Gemini API request failed (${response.status}): ${errBody.slice(0, 240) || response.statusText}`
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const startedAt = Date.now();
    let thinkingEndedAt = 0;

    let buffer = '';
    let accumulatedThoughts = '';
    let accumulatedAnswer = '';
    let webSearchQueries: string[] = [];
    let webSources: WebSource[] = [];

    const emitUpdate = (stillThinking: boolean) => {
      const now = Date.now();
      const thinkingMs = thinkingEndedAt
        ? thinkingEndedAt - startedAt
        : now - startedAt;
      params.onUpdate({
        content: accumulatedAnswer,
        thoughts: accumulatedThoughts,
        isThinking: stillThinking,
        thinkingMs,
        webSearchQueries,
        webSources,
      });
    };

    emitUpdate(true);

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === '[DONE]') continue;

        const delta = extractGeminiChunkDelta(data);
        let changed = false;

        if (delta.thoughtDelta) {
          accumulatedThoughts += delta.thoughtDelta;
          changed = true;
        }
        if (delta.answerDelta) {
          if (!accumulatedAnswer && !thinkingEndedAt) {
            thinkingEndedAt = Date.now();
          }
          accumulatedAnswer += delta.answerDelta;
          changed = true;
        }
        if (delta.webSearchQueries.length > 0) {
          webSearchQueries = mergeUniqueQueries(webSearchQueries, delta.webSearchQueries);
          changed = true;
        }
        if (delta.webSources.length > 0) {
          webSources = mergeUniqueWebSources(webSources, delta.webSources);
          changed = true;
        }

        if (changed) {
          emitUpdate(accumulatedAnswer.length === 0);
        }
      }
    }

    const finalThinkingMs = (thinkingEndedAt || Date.now()) - startedAt;

    return {
      content: accumulatedAnswer,
      thoughts: accumulatedThoughts,
      isThinking: false,
      thinkingMs: finalThinkingMs,
      webSearchQueries,
      webSources,
      engineUsed: params.engineId,
      modelLabel: opt.shortName,
      sources,
      retrievalMs: elapsedMs,
      followUps: deriveFollowUps(sources, webSources, accumulatedAnswer),
    };
  }

  private async streamCustomOpenAI(
    params: StreamGenerateParams,
    sources: RetrievedSource[],
    retrievalMs: number
  ): Promise<StreamGenerateResult> {
    const cfg = params.customApi!;
    const systemPrompt = buildAviSystemPrompt(
      params.voiceStyle,
      sources,
      params.attachedContext?.content,
      true
    );
    const messages = [
      { role: 'system', content: systemPrompt },
      ...buildConversationWindow(params.history, 10, 10000),
      { role: 'user', content: params.query },
    ];

    const endpoint = cfg.endpointUrl.replace(/\/+$/, '');
    const url = endpoint.endsWith('/chat/completions') ? endpoint : `${endpoint}/chat/completions`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (cfg.apiKey.trim()) {
      headers.Authorization = `Bearer ${cfg.apiKey.trim()}`;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      signal: params.signal,
      body: JSON.stringify({
        model: cfg.modelName,
        messages,
        stream: true,
        temperature: 0.72,
      }),
    });

    if (!res.ok || !res.body) {
      throw new Error(`Custom API returned ${res.status} ${res.statusText}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const startedAt = Date.now();
    let buffer = '';
    let rawAccumulated = '';
    let thinkingEndedAt = 0;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data) as {
            choices?: Array<{
              delta?: { content?: string; reasoning_content?: string };
            }>;
          };
          const deltaText = parsed.choices?.[0]?.delta?.content ?? '';
          const deltaReasoning = parsed.choices?.[0]?.delta?.reasoning_content ?? '';
          if (deltaReasoning && !rawAccumulated.startsWith('<thought>')) {
            rawAccumulated = `<thought>${deltaReasoning}`;
          } else if (deltaReasoning) {
            rawAccumulated += deltaReasoning;
          }
          if (deltaText) {
            if (rawAccumulated.startsWith('<thought>') && !rawAccumulated.includes('</thought>') && deltaReasoning === '') {
              rawAccumulated += `</thought>\n`;
            }
            rawAccumulated += deltaText;
          }
          const split = splitThinkingAndAnswer(rawAccumulated);
          if (split.answer && !thinkingEndedAt) thinkingEndedAt = Date.now();
          params.onUpdate({
            content: split.answer,
            thoughts: split.thinking,
            isThinking: split.isThinking,
            thinkingMs: (thinkingEndedAt || Date.now()) - startedAt,
            webSearchQueries: [],
            webSources: [],
          });
        } catch {
          // Ignore partial SSE chunk
        }
      }
    }

    const finalSplit = splitThinkingAndAnswer(rawAccumulated);
    const thinkingMs = (thinkingEndedAt || Date.now()) - startedAt;

    return {
      content: finalSplit.answer || rawAccumulated,
      thoughts: finalSplit.thinking,
      isThinking: false,
      thinkingMs,
      webSearchQueries: [],
      webSources: [],
      engineUsed: 'custom-api',
      modelLabel: cfg.modelName,
      sources,
      retrievalMs,
      followUps: deriveFollowUps(sources, [], finalSplit.answer || rawAccumulated),
    };
  }
}

function deriveFollowUps(
  sources: RetrievedSource[],
  webSources: WebSource[],
  answerText: string
): string[] {
  if (sources.length > 0) {
    const first = sources[0]?.entry;
    if (first) {
      return [
        `Where do you see the strongest counter-argument to that view?`,
        `How would you apply "${first.title.slice(0, 42)}${first.title.length > 42 ? '…' : ''}" to recent events?`,
      ];
    }
  }
  if (/```/.test(answerText)) {
    return [
      'Can we stress-test edge cases or simplify this architecture?',
      'Walk through the security and failure modes of this approach.',
    ];
  }
  if (webSources.length > 0) {
    return ['What do you think happens next, and where are the blind spots here?'];
  }
  return [];
}

export const llmService = new AviLLMService();
