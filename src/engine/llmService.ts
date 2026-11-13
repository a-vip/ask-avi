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
  extractOpenAIChunkDelta,
  mergeUniqueQueries,
  mergeUniqueWebSources,
} from './geminiStream';
import { knowledgeIndex } from './rag';
import { fetchOpenWebFallback } from './webFallback';

export class BackendNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackendNotConfiguredError';
  }
}

const keysWithoutNativeSearch = new Set<string>();

const GROQ_MODELS_BY_ENGINE: Record<'oss-reasoning' | 'oss-fast', string[]> = {
  'oss-reasoning': ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b'],
  'oss-fast': ['qwen/qwen3.8-27b', 'openai/gpt-oss-20b', 'openai/gpt-oss-120b'],
};

const OPENROUTER_MODELS_BY_ENGINE: Record<'oss-reasoning' | 'oss-fast', string[]> = {
  'oss-reasoning': [
    'nvidia/nemotron-3-ultra-550b-a55b:free',
    'openrouter/free',
    'google/gemma-4-31b-it:free',
    'nvidia/nemotron-3.5-super-vl:free',
  ],
  'oss-fast': [
    'nvidia/nemotron-3.5-lightning:free',
    'openrouter/free',
    'google/gemma-4-26b-a4b-it:free',
  ],
};

function getKeyFingerprint(apiKey: string): string {
  return `${apiKey.slice(0, 6)}:${apiKey.length}`;
}

function formatApiErrorMessage(
  provider: string,
  status: number,
  errBody: string,
  statusText: string
): string {
  let detail = '';
  try {
    const parsed = JSON.parse(errBody) as {
      error?: { message?: string } | string;
      message?: string;
    };
    if (typeof parsed.error === 'string') {
      detail = parsed.message || parsed.error;
    } else {
      detail = parsed.error?.message?.trim() || parsed.message?.trim() || '';
    }
  } catch {
    detail = errBody.trim();
  }
  const compact = (detail || statusText).slice(0, 260);
  if (status === 401 || status === 403) {
    return `${provider} authentication failed (${status}): verify your API key in Settings. ${compact}`;
  }
  if (status === 429 || status === 402) {
    return `${provider} free rate limit reached (${status}): add a second free provider key in Settings for automatic failover or try again shortly. ${compact}`;
  }
  return `${provider} request failed (${status}): ${compact}`;
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
  groqApiKey?: string;
  openRouterApiKey?: string;
  geminiApiKey?: string;
  proxyUrl?: string;
  sessionToken?: string;
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
      return './api/chat';
    }
  }
  return '';
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

function formatOpenModelLabel(modelId: string, providerName: string): string {
  const clean = modelId
    .replace(':free', '')
    .replace('@cf/', '')
    .replace(/^openai\//, '')
    .replace(/^nvidia\//, '')
    .replace(/^google\//, '')
    .replace(/^qwen\//, '');
  return `${clean} (${providerName})`;
}

class AviLLMService {
  public async generateReply(params: StreamGenerateParams): Promise<StreamGenerateResult> {
    const recentUserHint = params.history
      .filter((m) => m.role === 'user')
      .slice(-2)
      .map((m) => m.content)
      .join(' ');

    const { sources, elapsedMs } = knowledgeIndex.search(params.query, {
      topK: 3,
      minScore: 4.5,
      conversationHint: recentUserHint,
    });

    const opt = ENGINE_OPTIONS.find((o) => o.id === params.engineId) ?? ENGINE_OPTIONS[0];

    if (
      params.engineId === 'custom-api' &&
      params.customApi?.endpointUrl?.trim() &&
      params.customApi?.modelName?.trim()
    ) {
      return this.generateCustomOpenAIReply(params, sources, elapsedMs);
    }

    if (opt.providerKind === 'google') {
      return this.generateGoogleReply(params, opt, sources, elapsedMs);
    }

    return this.generateOpenSourceReply(
      params,
      params.engineId === 'oss-fast' ? 'oss-fast' : 'oss-reasoning',
      sources,
      elapsedMs
    );
  }

  private async generateOpenSourceReply(
    params: StreamGenerateParams,
    tier: 'oss-reasoning' | 'oss-fast',
    sources: RetrievedSource[],
    retrievalMs: number
  ): Promise<StreamGenerateResult> {
    const groqKey = params.groqApiKey?.trim();
    const openRouterKey = params.openRouterApiKey?.trim();
    const proxyUrl = resolveEffectiveProxyUrl(params.proxyUrl);

    if (!groqKey && !openRouterKey && !proxyUrl) {
      throw new BackendNotConfiguredError(
        'Connect a 100% free Groq key (console.groq.com) or OpenRouter key (openrouter.ai) in Settings — no credit card required — or deploy the free Cloudflare Workers AI proxy. You can also switch to Google Gemini above.'
      );
    }

    let webSearchQueries: string[] = [];
    let webSources: WebSource[] = [];
    let liveWebContext = '';

    if (params.webSearchEnabled) {
      const fallback = await fetchOpenWebFallback(params.query, params.signal);
      if (fallback.queries.length > 0) webSearchQueries = fallback.queries;
      if (fallback.webSources.length > 0) {
        webSources = fallback.webSources;
        liveWebContext = fallback.contextBlock;
      }
    }

    const systemInstruction = buildAviSystemPrompt(
      params.voiceStyle,
      sources,
      params.attachedContext?.content,
      false,
      liveWebContext
    );

    const historyTurns = buildConversationWindow(params.history, 14, 14000);
    const openAIMessages = [
      { role: 'system' as const, content: systemInstruction },
      ...historyTurns.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      { role: 'user' as const, content: params.query },
    ];
    const temperature = params.voiceStyle === 'academic' ? 0.5 : 0.75;

    let lastProvider = 'Open-Source API';
    let lastStatus = 502;
    let lastErrBody = '';
    let lastStatusText = 'Bad Gateway';

    const tryDirectOpenAIProvider = async (
      providerName: string,
      endpoint: string,
      apiKey: string,
      models: string[],
      extraHeaders: Record<string, string>,
      providerKind: 'groq' | 'openrouter'
    ): Promise<StreamGenerateResult | null> => {
      for (const model of models) {
        if (params.signal?.aborted) return null;
        const payload: Record<string, unknown> = {
          model,
          messages: openAIMessages,
          stream: true,
          temperature,
          max_tokens: 4096,
        };
        if (providerKind === 'groq' && model.startsWith('openai/gpt-oss')) {
          payload.reasoning_format = 'parsed';
          payload.reasoning_effort = 'high';
        }

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
            ...extraHeaders,
          },
          signal: params.signal,
          body: JSON.stringify(payload),
        });

        if (res.ok && res.body) {
          return this.consumeSseResponse({
            response: res,
            protocol: 'openai',
            engineUsed: params.engineId,
            modelLabel: formatOpenModelLabel(model, providerName),
            sources,
            retrievalMs,
            initialQueries: webSearchQueries,
            initialWebSources: webSources,
            onUpdate: params.onUpdate,
          });
        }

        lastProvider = providerName;
        lastStatus = res.status;
        lastStatusText = res.statusText;
        lastErrBody = await res.text().catch(() => '');
        if (lastStatus !== 404 && lastStatus !== 429 && lastStatus !== 503 && lastStatus !== 402) {
          break;
        }
      }
      return null;
    };

    if (groqKey) {
      const groqResult = await tryDirectOpenAIProvider(
        'Groq',
        'https://api.groq.com/openai/v1/chat/completions',
        groqKey,
        GROQ_MODELS_BY_ENGINE[tier],
        {},
        'groq'
      );
      if (groqResult) return groqResult;
    }

    if (openRouterKey) {
      const originRef =
        typeof window !== 'undefined' ? window.location.origin : 'https://aviperera.com';
      const orResult = await tryDirectOpenAIProvider(
        'OpenRouter',
        'https://openrouter.ai/api/v1/chat/completions',
        openRouterKey,
        OPENROUTER_MODELS_BY_ENGINE[tier],
        {
          'HTTP-Referer': originRef,
          'X-Title': 'Ask Avi',
        },
        'openrouter'
      );
      if (orResult) return orResult;
    }

    if (proxyUrl) {
      const contents = [
        ...historyTurns.map((m) => ({
          role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
          parts: [{ text: m.content }],
        })),
        { role: 'user' as const, parts: [{ text: params.query }] },
      ];
      const proxyRes = await fetch(proxyUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          ...(params.sessionToken
            ? { Authorization: `Bearer ${params.sessionToken}` }
            : {}),
        },
        signal: params.signal,
        body: JSON.stringify({
          mode: tier,
          systemInstruction,
          contents,
          enableSearch: params.webSearchEnabled,
          temperature,
        }),
      });
      if (proxyRes.ok && proxyRes.body) {
        const protocolHeader = proxyRes.headers.get('X-Ask-Avi-Protocol');
        const modelHeader = proxyRes.headers.get('X-Ask-Avi-Model');
        return this.consumeSseResponse({
          response: proxyRes,
          protocol: protocolHeader === 'gemini' ? 'gemini' : 'openai',
          engineUsed: params.engineId,
          modelLabel: modelHeader || 'Open-Source Cloud Proxy',
          sources,
          retrievalMs,
          initialQueries: webSearchQueries,
          initialWebSources: webSources,
          onUpdate: params.onUpdate,
        });
      }

      lastProvider = 'Proxy API';
      lastStatus = proxyRes.status;
      lastStatusText = proxyRes.statusText;
      lastErrBody = await proxyRes.text().catch(() => '');

      if (
        lastStatus === 503 &&
        (lastErrBody.includes('proxy_unconfigured') || lastErrBody.includes('GROQ_API_KEY'))
      ) {
        throw new BackendNotConfiguredError(
          'Proxy is live — bind Cloudflare Workers AI [ai] or add a free Groq/OpenRouter key in Settings.'
        );
      }
      if (lastStatus === 404 && !groqKey && !openRouterKey) {
        throw new BackendNotConfiguredError(
          'Add a 100% free Groq key (console.groq.com) or OpenRouter key (openrouter.ai) in Settings — no credit card required — or deploy the Cloudflare Workers AI proxy.'
        );
      }
    }

    throw new Error(
      formatApiErrorMessage(lastProvider, lastStatus, lastErrBody, lastStatusText)
    );
  }

  private async generateGoogleReply(
    params: StreamGenerateParams,
    opt: (typeof ENGINE_OPTIONS)[number],
    sources: RetrievedSource[],
    retrievalMs: number
  ): Promise<StreamGenerateResult> {
    const candidateModels = opt.geminiFallbackModels?.length
      ? opt.geminiFallbackModels
      : [opt.geminiModelId ?? 'gemini-3-flash-preview'];
    const primaryModelId = candidateModels[0];
    const thinkingBudget = opt.thinkingBudget ?? 8192;
    const directKey = params.geminiApiKey?.trim();
    const proxyUrl = resolveEffectiveProxyUrl(params.proxyUrl);

    if (!directKey && !proxyUrl) {
      throw new BackendNotConfiguredError(
        'Connect your Gemini API key in Settings — or switch back to the 100% free Open-Source Reasoning engine.'
      );
    }

    const historyTurns = buildConversationWindow(params.history, 14, 16000);
    const contents = [
      ...historyTurns.map((m) => ({
        role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
        parts: [{ text: m.content }],
      })),
      { role: 'user' as const, parts: [{ text: params.query }] },
    ];

    const temperature = params.voiceStyle === 'academic' ? 0.5 : 0.78;
    let webSearchQueries: string[] = [];
    let webSources: WebSource[] = [];
    let liveWebContext = '';
    let activeModelId = primaryModelId;

    const buildInstruction = () =>
      buildAviSystemPrompt(
        params.voiceStyle,
        sources,
        params.attachedContext?.content,
        false,
        liveWebContext
      );

    let response: Response | null = null;
    let lastStatus = 502;
    let lastErrBody = '';
    let lastStatusText = 'Bad Gateway';

    if (directKey) {
      const fingerprint = getKeyFingerprint(directKey);
      let nativeSearchAllowed = params.webSearchEnabled && !keysWithoutNativeSearch.has(fingerprint);
      let fetchedOpenWeb = false;

      const ensureOpenWebFallback = async () => {
        if (fetchedOpenWeb || !params.webSearchEnabled) return;
        fetchedOpenWeb = true;
        const fallback = await fetchOpenWebFallback(params.query, params.signal);
        if (fallback.queries.length > 0) {
          webSearchQueries = mergeUniqueQueries(webSearchQueries, fallback.queries);
        }
        if (fallback.webSources.length > 0) {
          webSources = mergeUniqueWebSources(webSources, fallback.webSources);
          liveWebContext = fallback.contextBlock;
        }
      };

      if (params.webSearchEnabled && !nativeSearchAllowed) {
        await ensureOpenWebFallback();
      }

      const sendDirectRequest = (modelId: string, withNativeSearch: boolean) => {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          modelId
        )}:streamGenerateContent?alt=sse`;
        const bodyPayload: Record<string, unknown> = {
          systemInstruction: { parts: [{ text: buildInstruction() }] },
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
        if (withNativeSearch) {
          bodyPayload.tools = [{ googleSearch: {} }];
        }
        return fetch(geminiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': directKey,
          },
          signal: params.signal,
          body: JSON.stringify(bodyPayload),
        });
      };

      for (const candidate of candidateModels) {
        if (params.signal?.aborted) break;
        activeModelId = candidate;
        response = await sendDirectRequest(candidate, nativeSearchAllowed);
        if (response.ok && response.body) break;

        lastStatus = response.status;
        lastStatusText = response.statusText;
        lastErrBody = await response.text().catch(() => '');

        if (nativeSearchAllowed && (lastStatus === 429 || lastStatus === 403 || lastStatus === 400)) {
          nativeSearchAllowed = false;
          keysWithoutNativeSearch.add(fingerprint);
          await ensureOpenWebFallback();
          response = await sendDirectRequest(candidate, false);
          if (response.ok && response.body) break;

          lastStatus = response.status;
          lastStatusText = response.statusText;
          lastErrBody = await response.text().catch(() => '');
        }

        response = null;
        if (lastStatus !== 404 && lastStatus !== 503 && lastStatus !== 429) {
          break;
        }
      }
    } else {
      response = await fetch(proxyUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          ...(params.sessionToken
            ? { Authorization: `Bearer ${params.sessionToken}` }
            : {}),
        },
        signal: params.signal,
        body: JSON.stringify({
          mode: 'google',
          model: primaryModelId,
          systemInstruction: buildInstruction(),
          contents,
          thinkingBudget,
          enableSearch: params.webSearchEnabled,
          temperature,
        }),
      });
      if (!response.ok || !response.body) {
        lastStatus = response.status;
        lastStatusText = response.statusText;
        lastErrBody = await response.text().catch(() => '');
        response = null;
      }
    }

    if (!response || !response.ok || !response.body) {
      if (
        lastStatus === 503 &&
        (lastErrBody.includes('proxy_unconfigured') || lastErrBody.includes('GEMINI_API_KEY'))
      ) {
        throw new BackendNotConfiguredError(
          'Proxy is live, awaiting API key configuration — paste a free Groq/OpenRouter or Gemini key in Settings.'
        );
      }
      if (lastStatus === 404 && !directKey) {
        throw new BackendNotConfiguredError(
          'No live API backend connected at this origin yet. Add a free Groq/OpenRouter or Gemini key in Settings.'
        );
      }
      throw new Error(formatApiErrorMessage('Gemini API', lastStatus, lastErrBody, lastStatusText));
    }

    const protocolHeader = response.headers.get('X-Ask-Avi-Protocol');
    const modelHeader = response.headers.get('X-Ask-Avi-Model');
    const resolvedModelLabel =
      modelHeader || (activeModelId === primaryModelId ? opt.shortName : activeModelId);

    return this.consumeSseResponse({
      response,
      protocol: protocolHeader === 'openai' ? 'openai' : 'gemini',
      engineUsed: params.engineId,
      modelLabel: resolvedModelLabel,
      sources,
      retrievalMs,
      initialQueries: webSearchQueries,
      initialWebSources: webSources,
      onUpdate: params.onUpdate,
    });
  }

  private async generateCustomOpenAIReply(
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
      const errBody = await res.text().catch(() => '');
      throw new Error(formatApiErrorMessage('Custom API', res.status, errBody, res.statusText));
    }

    return this.consumeSseResponse({
      response: res,
      protocol: 'openai',
      engineUsed: 'custom-api',
      modelLabel: cfg.modelName,
      sources,
      retrievalMs,
      initialQueries: [],
      initialWebSources: [],
      onUpdate: params.onUpdate,
    });
  }

  private async consumeSseResponse(opts: {
    response: Response;
    protocol: 'gemini' | 'openai';
    engineUsed: EngineId;
    modelLabel: string;
    sources: RetrievedSource[];
    retrievalMs: number;
    initialQueries: string[];
    initialWebSources: WebSource[];
    onUpdate: (update: StreamProgressPayload) => void;
  }): Promise<StreamGenerateResult> {
    const reader = opts.response.body!.getReader();
    const decoder = new TextDecoder();
    const startedAt = Date.now();
    let thinkingEndedAt = 0;

    let buffer = '';
    let structuredThoughts = '';
    let rawAnswer = '';
    let webSearchQueries = [...opts.initialQueries];
    let webSources = [...opts.initialWebSources];

    const computeViewState = () => {
      if (opts.protocol === 'openai' && !structuredThoughts && /^\s*<(?:thought|think)\b/i.test(rawAnswer)) {
        const split = splitThinkingAndAnswer(rawAnswer);
        return {
          thoughts: split.thinking,
          answer: split.answer,
          isThinking: split.answer.length === 0,
        };
      }
      const cleanAnswer =
        opts.protocol === 'openai'
          ? rawAnswer.replace(/<\/?(?:thought|think)\b[^>]*>/gi, '').replace(/^\s+/, '')
          : rawAnswer;
      return {
        thoughts: structuredThoughts.trimStart(),
        answer: cleanAnswer,
        isThinking: cleanAnswer.length === 0,
      };
    };

    const emitCurrent = () => {
      const state = computeViewState();
      if (state.answer.length > 0 && !thinkingEndedAt) {
        thinkingEndedAt = Date.now();
      }
      opts.onUpdate({
        content: state.answer,
        thoughts: state.thoughts,
        isThinking: state.isThinking,
        thinkingMs: (thinkingEndedAt || Date.now()) - startedAt,
        webSearchQueries,
        webSources,
      });
    };

    const applyChunk = (data: string): boolean => {
      const delta =
        opts.protocol === 'gemini'
          ? extractGeminiChunkDelta(data)
          : extractOpenAIChunkDelta(data);

      let changed = false;
      if (delta.thoughtDelta) {
        structuredThoughts += delta.thoughtDelta;
        changed = true;
      }
      if (delta.answerDelta) {
        rawAnswer += delta.answerDelta;
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
      return changed;
    };

    emitCurrent();

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
        if (applyChunk(data)) {
          emitCurrent();
        }
      }
    }

    const leftover = buffer.trim();
    if (leftover.startsWith('data:')) {
      const data = leftover.slice(5).trim();
      if (data && data !== '[DONE]') {
        applyChunk(data);
      }
    }

    const finalState = computeViewState();
    const finalThinkingMs = (thinkingEndedAt || Date.now()) - startedAt;

    return {
      content: finalState.answer,
      thoughts: finalState.thoughts,
      isThinking: false,
      thinkingMs: finalThinkingMs,
      webSearchQueries,
      webSources,
      engineUsed: opts.engineUsed,
      modelLabel: opts.modelLabel,
      sources: opts.sources,
      retrievalMs: opts.retrievalMs,
      followUps: deriveFollowUps(opts.sources, webSources, finalState.answer),
    };
  }
}

export const llmService = new AviLLMService();
