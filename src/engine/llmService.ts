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
import { formatContextsForPrompt } from '../utils/contextExtractor';
import { separateLeakedCotFromAnswer } from '../utils/cotSeparator';
import { sanitizeThinkingTrace } from '../utils/thinking';
import {
  alignCitedSources,
  mergeCandidateSources,
  splitFormattedCandidateBlocks,
  type CandidateSource,
} from './citations';
import {
  buildFinalContinuityBrief,
  buildPass1PlanMessages,
  buildPass2ExploreMessages,
  buildPass3CritiqueMessages,
  buildRichConversationWindow,
  extractFollowUpQueries,
  formatPlanForThinking,
  isTrivialOpeningGreeting,
  parsePlannerResult,
  type PlannerResult,
} from './deliberation';
import {
  extractGeminiChunkDelta,
  extractOpenAIChunkDelta,
  mergeUniqueQueries,
} from './geminiStream';
import { knowledgeIndex } from './rag';
import { fetchTargetedWebResearch } from './webFallback';

export class BackendNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackendNotConfiguredError';
  }
}

export class AuthRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthRequiredError';
  }
}

function resolveAttachedPromptBlock(params: StreamGenerateParams): string {
  const list =
    params.attachedContexts && params.attachedContexts.length > 0
      ? params.attachedContexts
      : params.attachedContext
        ? [params.attachedContext]
        : [];
  const isAuthed = Boolean(params.isAuthenticated ?? params.sessionToken);
  return formatContextsForPrompt(list, isAuthed);
}

const keysWithoutNativeSearch = new Set<string>();

const GROQ_MODELS_BY_ENGINE: Record<'oss-reasoning' | 'oss-fast', string[]> = {
  'oss-reasoning': ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'],
  'oss-fast': ['openai/gpt-oss-20b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-120b'],
};

const OPENROUTER_MODELS_BY_ENGINE: Record<'oss-reasoning' | 'oss-fast', string[]> = {
  'oss-reasoning': [
    'nvidia/nemotron-3-ultra-550b-a55b:free',
    'nvidia/nemotron-3.5-super-vl:free',
    'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
    'cohere/north-mini-code:free',
    'nvidia/nemotron-3.5-lightning:free',
  ],
  'oss-fast': [
    'nvidia/nemotron-3.5-lightning:free',
    'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
    'baidu/ernie-5.5-flash-preview:free',
    'nvidia/nemotron-3.5-super-vl:free',
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
  isAuthenticated?: boolean;
  attachedContext?: AttachedContext;
  attachedContexts?: AttachedContext[];
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
  return buildRichConversationWindow(history, maxTurns, maxChars);
}

function mergeDistinctArchiveSources(
  base: RetrievedSource[],
  incoming: RetrievedSource[],
  cap = 5
): RetrievedSource[] {
  const byId = new Map<string, RetrievedSource>();
  for (const s of [...base, ...incoming]) {
    const prev = byId.get(s.entry.id);
    if (!prev || s.score > prev.score) {
      byId.set(s.entry.id, s);
    }
  }
  return Array.from(byId.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, cap)
    .map((s, idx) => ({ ...s, index: idx + 1 }));
}

function mergeDistinctWebItems(
  base: WebSource[],
  incoming: WebSource[],
  cap = 7
): WebSource[] {
  const seen = new Set<string>();
  const out: WebSource[] = [];
  for (const w of [...base, ...incoming]) {
    const key = w.url.trim().replace(/\/+$/, '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ ...w, index: out.length + 1 });
    if (out.length >= cap) break;
  }
  return out;
}

function deriveCitedFollowUps(
  citedArchive: RetrievedSource[],
  citedWeb: WebSource[],
  answerText: string
): string[] {
  const suggestions: string[] = [];
  const lowerAns = answerText.toLowerCase();

  if (lowerAns.includes('article 36') || lowerAns.includes('ihl') || lowerAns.includes('humanitarian')) {
    suggestions.push('How would you test that in an Article 36 legal review?');
  }
  if (lowerAns.includes('spinoza') || lowerAns.includes('causal') || lowerAns.includes('incentive')) {
    suggestions.push('Where does that framework hit its hardest legal or institutional limit?');
  }
  if (citedArchive.length > 0) {
    const first = citedArchive[0].entry;
    if (!lowerAns.includes(first.title.toLowerCase().slice(0, 20))) {
      suggestions.push(`How does this connect with "${first.title}"?`);
    }
  } else if (citedWeb.length > 0) {
    suggestions.push('What primary evidence or counter-case challenges that source?');
  }
  if (suggestions.length < 2) {
    suggestions.push('What is the strongest counter-argument to this conclusion?');
  }
  if (suggestions.length < 2) {
    suggestions.push('How does that play out when incentives fail in practice?');
  }
  return Array.from(new Set(suggestions)).slice(0, 2);
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

  private async streamDeliberationPass(opts: {
    params: StreamGenerateParams;
    messages: Array<{ role: 'system' | 'user'; content: string }>;
    reasoningEffort: 'low' | 'medium' | 'high';
    maxTokens: number;
    temperature: number;
    onThoughtStream?: (accumulatedPassText: string) => void;
  }): Promise<{ display: string; summary: string }> {
    const { params, messages, reasoningEffort, maxTokens, temperature, onThoughtStream } = opts;
    if (params.signal?.aborted) return { display: '', summary: '' };

    const groqKey = params.groqApiKey?.trim();
    const openRouterKey = params.openRouterApiKey?.trim();
    const directGeminiKey = params.geminiApiKey?.trim();
    const proxyUrl = resolveEffectiveProxyUrl(params.proxyUrl);

    const readSseStreamText = async (
      response: Response,
      protocol: 'openai' | 'gemini'
    ): Promise<{ display: string; summary: string }> => {
      if (!response.ok || !response.body) return { display: '', summary: '' };
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let passReasoning = '';
      let passContent = '';

      const buildCombined = () => {
        const sep = separateLeakedCotFromAnswer(passContent, { flushPartial: true });
        return {
          display: [passReasoning.trim(), sep.extractedThinking, sep.cleanAnswer]
            .filter(Boolean)
            .join('\n\n'),
          summary: sep.cleanAnswer || passReasoning.trim(),
        };
      };

      const emitIfChanged = () => {
        if (!onThoughtStream) return;
        const { display } = buildCombined();
        if (display) onThoughtStream(display);
      };

      const consumeLine = (rawLine: string) => {
        const trimmed = rawLine.trim();
        if (!trimmed.startsWith('data:')) return;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') return;
        const delta =
          protocol === 'gemini'
            ? extractGeminiChunkDelta(payload)
            : extractOpenAIChunkDelta(payload);
        if (delta.thoughtDelta) passReasoning += delta.thoughtDelta;
        if (delta.answerDelta) passContent += delta.answerDelta;
        if (delta.thoughtDelta || delta.answerDelta) emitIfChanged();
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) consumeLine(line);
      }
      if (buffer.trim()) consumeLine(buffer);

      const { display, summary } = buildCombined();
      return { display: display || summary, summary };
    };

    try {
      if (groqKey) {
        for (const model of GROQ_MODELS_BY_ENGINE['oss-reasoning']) {
          if (params.signal?.aborted) return { display: '', summary: '' };
          const payload: Record<string, unknown> = {
            model,
            messages,
            stream: true,
            temperature,
            max_tokens: maxTokens,
          };
          if (model.startsWith('openai/gpt-oss')) {
            payload.reasoning_format = 'parsed';
            payload.reasoning_effort = reasoningEffort;
          } else if (model.startsWith('qwen/qwen3')) {
            payload.reasoning_format = 'parsed';
          }
          const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groqKey}` },
            signal: params.signal,
            body: JSON.stringify(payload),
          });
          if (res.ok && res.body) {
            const out = await readSseStreamText(res, 'openai');
            if (out.summary || out.display) return out;
          }
          if (res.status !== 404 && res.status !== 429 && res.status !== 503) break;
        }
      }

      if (openRouterKey) {
        const originRef =
          typeof window !== 'undefined' ? window.location.origin : 'https://aviperera.com';
        for (const model of OPENROUTER_MODELS_BY_ENGINE['oss-reasoning']) {
          if (params.signal?.aborted) return { display: '', summary: '' };
          const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${openRouterKey}`,
              'HTTP-Referer': originRef,
              'X-Title': 'Ask Avi',
            },
            signal: params.signal,
            body: JSON.stringify({
              model,
              messages,
              stream: true,
              temperature,
              max_tokens: maxTokens,
              reasoning: { effort: reasoningEffort },
            }),
          });
          if (res.ok && res.body) {
            const out = await readSseStreamText(res, 'openai');
            if (out.summary || out.display) return out;
          }
          if (res.status !== 404 && res.status !== 429 && res.status !== 503 && res.status !== 402) break;
        }
      }

      if (proxyUrl) {
        const flattenedPrompt = messages.map((m) => m.content).join('\n\n');
        const res = await fetch(proxyUrl, {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            ...(params.sessionToken ? { Authorization: `Bearer ${params.sessionToken}` } : {}),
          },
          signal: params.signal,
          body: JSON.stringify({
            mode: 'oss-reasoning',
            phase: 'deliberate',
            reasoningEffort,
            maxTokens,
            enableSearch: false,
            temperature,
            contents: [{ role: 'user', parts: [{ text: flattenedPrompt }] }],
          }),
        });
        if (res.ok && res.body) {
          const proto = res.headers.get('X-Ask-Avi-Protocol') === 'gemini' ? 'gemini' : 'openai';
          return await readSseStreamText(res, proto);
        }
      }

      if (directGeminiKey) {
        const sysPart = messages.find((m) => m.role === 'system')?.content ?? '';
        const usrPart = messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n\n');
        const gemRes = await fetch(
          'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:streamGenerateContent?alt=sse',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': directGeminiKey,
            },
            signal: params.signal,
            body: JSON.stringify({
              systemInstruction: sysPart ? { parts: [{ text: sysPart }] } : undefined,
              contents: [{ role: 'user', parts: [{ text: usrPart }] }],
              generationConfig: {
                temperature,
                maxOutputTokens: maxTokens,
                thinkingConfig: { includeThoughts: false, thinkingBudget: 2048 },
              },
            }),
          }
        );
        if (gemRes.ok && gemRes.body) {
          return await readSseStreamText(gemRes, 'gemini');
        }
      }
    } catch (err) {
      if (params.signal?.aborted) throw err;
    }

    return { display: '', summary: '' };
  }

  private async runIterativeDeliberation(opts: {
    params: StreamGenerateParams;
    initialSources: RetrievedSource[];
    deepReasoning: boolean;
    pipelineStartedAt: number;
  }): Promise<{
    candidates: CandidateSource[];
    archiveBlock: string;
    webContext: string;
    archiveSources: RetrievedSource[];
    webSources: WebSource[];
    webSearchQueries: string[];
    accumulatedThoughts: string;
    continuityBrief: string;
    reasoningSynthesis: string;
  }> {
    const { params, initialSources, deepReasoning, pipelineStartedAt } = opts;
    const isFollowUp = params.history.length > 0;
    const attachedBlock = resolveAttachedPromptBlock(params);

    let webSearchQueries: string[] = [];
    let archiveSources: RetrievedSource[] = [...initialSources];
    let webSources: WebSource[] = [];
    const thoughtSections: string[] = [];

    const publishThoughts = (liveSection = '') => {
      const combined = [...thoughtSections, liveSection].filter(Boolean).join('\n\n---\n\n');
      params.onUpdate({
        content: '',
        thoughts: sanitizeThinkingTrace(combined, false),
        isThinking: true,
        thinkingMs: Math.max(200, Date.now() - pipelineStartedAt),
        webSearchQueries,
        webSources: [],
      });
    };

    const trivial = isTrivialOpeningGreeting(params.query, params.history);
    if (trivial) {
      const candidates = mergeCandidateSources([], []);
      return {
        candidates,
        archiveBlock: '',
        webContext: '',
        archiveSources: [],
        webSources: [],
        webSearchQueries: [],
        accumulatedThoughts: '',
        continuityBrief: '',
        reasoningSynthesis: '',
      };
    }

    // Immediate opening indicator while Stage 1 decomposes conversation state & queries
    publishThoughts(
      isFollowUp
        ? 'Reviewing the conversation arc and framing the follow-up inquiry…'
        : 'Analysing the core question and planning first-principles inquiry…'
    );

    // Stage 1: Conversation State Parsing & Research Strategy
    const planPass = await this.streamDeliberationPass({
      params,
      messages: buildPass1PlanMessages({
        query: params.query,
        history: params.history,
        attachedSummary: attachedBlock,
      }),
      reasoningEffort: 'low',
      maxTokens: 900,
      temperature: 0.2,
    });
    const plan: PlannerResult = parsePlannerResult(planPass.summary, params.query, params.history);
    thoughtSections.push(formatPlanForThinking(plan, isFollowUp));
    publishThoughts();

    // Research Pass A: Resolved Internal Archive RAG + Targeted Open Web & Academic Search
    const ragQueries = Array.from(
      new Set([plan.coreQuestion, ...plan.archiveQueries].filter((q) => q.length >= 3))
    );
    const resolvedRag = knowledgeIndex.multiSearch(ragQueries, {
      topK: 4,
      minScore: isFollowUp && plan.conversationShift === 'pivoting' ? 4.5 : 4.0,
    });
    archiveSources =
      isFollowUp && plan.conversationShift === 'pivoting'
        ? resolvedRag.sources
        : mergeDistinctArchiveSources(
            resolvedRag.sources.length > 0 ? resolvedRag.sources : initialSources,
            resolvedRag.sources,
            4
          );

    if (params.webSearchEnabled && plan.webQueries.length > 0) {
      const roundA = await fetchTargetedWebResearch(plan.webQueries, {
        userSignal: params.signal,
        maxSources: 5,
        timeoutMs: 5500,
      });
      if (roundA.queries.length > 0) {
        webSearchQueries = mergeUniqueQueries(webSearchQueries, roundA.queries);
      }
      if (roundA.webSources.length > 0) {
        webSources = mergeDistinctWebItems(webSources, roundA.webSources, 6);
      }
      publishThoughts();
    }

    let round2CleanAnalysis = '';
    let round3Critique = '';

    if (deepReasoning && !params.signal?.aborted) {
      // Stage 2: Multi-Angle First-Principles Exploration & Evidence Interrogation
      const initialCandidates = mergeCandidateSources(archiveSources, webSources);
      const initialPoolBlocks = splitFormattedCandidateBlocks(initialCandidates);
      const poolTextA = [initialPoolBlocks.archiveBlock, initialPoolBlocks.webContext]
        .filter(Boolean)
        .join('\n\n');

      const explorePass = await this.streamDeliberationPass({
        params,
        messages: buildPass2ExploreMessages({
          plan,
          query: params.query,
          history: params.history,
          candidatePoolBlock: poolTextA,
          attachedBlock,
        }),
        reasoningEffort: 'medium',
        maxTokens: 1600,
        temperature: 0.45,
        onThoughtStream: (live) => {
          const { cleanAnalysis } = extractFollowUpQueries(live);
          if (cleanAnalysis) {
            publishThoughts(`**Examining perspectives & evidence**\n\n${cleanAnalysis}`);
          }
        },
      });

      const exploreDisplay = extractFollowUpQueries(explorePass.display).cleanAnalysis;
      const { cleanAnalysis, followUpQueries } = extractFollowUpQueries(explorePass.summary);
      round2CleanAnalysis = cleanAnalysis;
      if (exploreDisplay) {
        thoughtSections.push(`**Examining perspectives & evidence**\n\n${exploreDisplay}`);
        publishThoughts();
      }

      // Research Pass B: Adaptive Secondary Retrieval driven by Stage 2 discoveries
      if (params.webSearchEnabled && followUpQueries.length > 0 && !params.signal?.aborted) {
        const extraRag = knowledgeIndex.multiSearch(followUpQueries, { topK: 2, minScore: 4.5 });
        if (extraRag.sources.length > 0) {
          archiveSources = mergeDistinctArchiveSources(archiveSources, extraRag.sources, 5);
        }
        const roundB = await fetchTargetedWebResearch(followUpQueries, {
          userSignal: params.signal,
          maxSources: 3,
          timeoutMs: 4500,
        });
        if (roundB.queries.length > 0) {
          webSearchQueries = mergeUniqueQueries(webSearchQueries, roundB.queries);
        }
        if (roundB.webSources.length > 0) {
          webSources = mergeDistinctWebItems(webSources, roundB.webSources, 7);
        }
        publishThoughts();
      }

      // Stage 3: Adversarial Verification, Contradictions & Conversation Continuity Check
      if (!params.signal?.aborted && (round2CleanAnalysis || isFollowUp)) {
        const updatedCandidates = mergeCandidateSources(archiveSources, webSources);
        const updatedPoolBlocks = splitFormattedCandidateBlocks(updatedCandidates);
        const poolTextB = [updatedPoolBlocks.archiveBlock, updatedPoolBlocks.webContext]
          .filter(Boolean)
          .join('\n\n');

        const critiquePass = await this.streamDeliberationPass({
          params,
          messages: buildPass3CritiqueMessages({
            plan,
            query: params.query,
            history: params.history,
            round2Analysis: round2CleanAnalysis || plan.coreQuestion,
            candidatePoolBlock: poolTextB,
          }),
          reasoningEffort: 'medium',
          maxTokens: 1700,
          temperature: 0.35,
          onThoughtStream: (live) => {
            publishThoughts(`**Stress-testing counter-arguments & context**\n\n${live}`);
          },
        });
        round3Critique = critiquePass.summary;
        if (critiquePass.display) {
          thoughtSections.push(`**Stress-testing counter-arguments & context**\n\n${critiquePass.display}`);
          publishThoughts();
        }
      }
    }

    const candidates = mergeCandidateSources(archiveSources, webSources);
    const formatted = splitFormattedCandidateBlocks(candidates);
    const { continuityBrief, reasoningSynthesis } = buildFinalContinuityBrief({
      plan,
      isFollowUp,
      round2Analysis: round2CleanAnalysis,
      round3Critique,
      hasCandidates: candidates.length > 0,
    });

    return {
      candidates,
      archiveBlock: formatted.archiveBlock,
      webContext: formatted.webContext,
      archiveSources: formatted.archiveCandidates,
      webSources: formatted.webCandidates,
      webSearchQueries,
      accumulatedThoughts: sanitizeThinkingTrace(thoughtSections.join('\n\n---\n\n'), true),
      continuityBrief,
      reasoningSynthesis,
    };
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

    if (!proxyUrl && !groqKey && !openRouterKey) {
      throw new BackendNotConfiguredError(
        'No live server endpoint is configured here. Open Admin API Settings to save your free Groq or OpenRouter key to the live website server.'
      );
    }

    const pipelineStartedAt = Date.now();
    const delib = await this.runIterativeDeliberation({
      params,
      initialSources: sources,
      deepReasoning: tier === 'oss-reasoning',
      pipelineStartedAt,
    });

    const attachedPromptBlock = resolveAttachedPromptBlock(params);
    const hasDirectKey = Boolean(groqKey || openRouterKey);
    const historyTurns = buildConversationWindow(params.history, 18, 20000);
    const buildDirectOpenAIMessages = () => {
      const systemInstruction = buildAviSystemPrompt(
        params.voiceStyle,
        delib.archiveSources,
        attachedPromptBlock,
        false,
        delib.webContext,
        delib.continuityBrief,
        delib.reasoningSynthesis
      );
      return [
        { role: 'system' as const, content: systemInstruction },
        ...historyTurns.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        { role: 'user' as const, content: params.query },
      ];
    };
    const openAIMessages = hasDirectKey ? buildDirectOpenAIMessages() : [];
    const temperature = params.voiceStyle === 'academic' ? 0.5 : 0.72;
    const finalReasoningEffort = tier === 'oss-fast' ? 'low' : 'medium';

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
          max_tokens: tier === 'oss-fast' ? 4096 : 8192,
        };
        if (providerKind === 'groq' && model.startsWith('openai/gpt-oss')) {
          payload.reasoning_format = 'parsed';
          payload.reasoning_effort = finalReasoningEffort;
        } else if (providerKind === 'groq' && model.startsWith('qwen/qwen3')) {
          payload.reasoning_format = 'parsed';
        } else if (providerKind === 'openrouter') {
          payload.reasoning = { effort: finalReasoningEffort };
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
            candidateSources: delib.candidates,
            retrievalMs,
            initialQueries: delib.webSearchQueries,
            accumulatedPrefixThoughts: delib.accumulatedThoughts,
            pipelineStartedAt,
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
          phase: 'final',
          reasoningEffort: finalReasoningEffort,
          voiceStyle: params.voiceStyle,
          archiveBlock: delib.archiveBlock,
          webContext: delib.webContext,
          continuityBrief: delib.continuityBrief,
          reasoningSynthesis: delib.reasoningSynthesis,
          attachedContext: attachedPromptBlock ?? '',
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
          candidateSources: delib.candidates,
          retrievalMs,
          initialQueries: delib.webSearchQueries,
          accumulatedPrefixThoughts: delib.accumulatedThoughts,
          pipelineStartedAt,
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
        let serverMessage = '';
        try {
          const parsed = JSON.parse(lastErrBody) as { message?: string };
          serverMessage = parsed.message?.trim() || '';
        } catch {
          serverMessage = '';
        }
        throw new BackendNotConfiguredError(
          serverMessage ||
            'Live server API keys are not configured yet. Open Admin API Settings to save your free Groq/OpenRouter keys to the live server so all visitors can chat.'
        );
      }
      if (lastStatus === 404 && !groqKey && !openRouterKey) {
        throw new BackendNotConfiguredError(
          'Live chat backend route was not found here. Open Admin API Settings to connect a free Groq or OpenRouter key.'
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

    const pipelineStartedAt = Date.now();
    const delib = await this.runIterativeDeliberation({
      params,
      initialSources: sources,
      deepReasoning: true,
      pipelineStartedAt,
    });

    const historyTurns = buildConversationWindow(params.history, 20, 22000);
    const contents = [
      ...historyTurns.map((m) => ({
        role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
        parts: [{ text: m.content }],
      })),
      { role: 'user' as const, parts: [{ text: params.query }] },
    ];

    const temperature = params.voiceStyle === 'academic' ? 0.5 : 0.78;
    let activeModelId = primaryModelId;

    const buildInstruction = () =>
      buildAviSystemPrompt(
        params.voiceStyle,
        delib.archiveSources,
        resolveAttachedPromptBlock(params),
        false,
        delib.webContext,
        delib.continuityBrief,
        delib.reasoningSynthesis
      );

    let response: Response | null = null;
    let lastStatus = 502;
    let lastErrBody = '';
    let lastStatusText = 'Bad Gateway';

    if (directKey) {
      const fingerprint = getKeyFingerprint(directKey);
      let nativeSearchAllowed = params.webSearchEnabled && !keysWithoutNativeSearch.has(fingerprint);

      const sendDirectRequest = (modelId: string, withNativeSearch: boolean) => {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          modelId
        )}:streamGenerateContent?alt=sse`;
        const maxGeminiOutput = opt.id === 'gemini-pro' || thinkingBudget >= 20000 ? 32768 : 16384;
        const bodyPayload: Record<string, unknown> = {
          systemInstruction: { parts: [{ text: buildInstruction() }] },
          contents,
          generationConfig: {
            temperature,
            topP: 0.92,
            maxOutputTokens: maxGeminiOutput,
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
          phase: 'final',
          model: primaryModelId,
          voiceStyle: params.voiceStyle,
          archiveBlock: delib.archiveBlock,
          webContext: delib.webContext,
          continuityBrief: delib.continuityBrief,
          reasoningSynthesis: delib.reasoningSynthesis,
          attachedContext: resolveAttachedPromptBlock(params) ?? '',
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
      if (lastStatus === 401 || lastErrBody.includes('auth_required')) {
        throw new AuthRequiredError(
          'Unlock frontier models, deeper context, and saved conversations.'
        );
      }
      if (
        lastStatus === 503 &&
        (lastErrBody.includes('proxy_unconfigured') || lastErrBody.includes('GEMINI_API_KEY'))
      ) {
        throw new BackendNotConfiguredError(
          'Gemini server key is not configured yet. Open Admin API Settings to save a Gemini key to the live server (or switch to Open-Source Reasoning).'
        );
      }
      if (lastStatus === 404 && !directKey) {
        throw new BackendNotConfiguredError(
          'No live backend API endpoint is reachable here. Open Admin API Settings to configure your API keys.'
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
      candidateSources: delib.candidates,
      retrievalMs,
      initialQueries: delib.webSearchQueries,
      accumulatedPrefixThoughts: delib.accumulatedThoughts,
      pipelineStartedAt,
      onUpdate: params.onUpdate,
    });
  }

  private async generateCustomOpenAIReply(
    params: StreamGenerateParams,
    sources: RetrievedSource[],
    retrievalMs: number
  ): Promise<StreamGenerateResult> {
    const cfg = params.customApi!;
    const pipelineStartedAt = Date.now();
    let webSources: WebSource[] = [];
    let webSearchQueries: string[] = [];

    if (params.webSearchEnabled) {
      const research = await fetchTargetedWebResearch([params.query], {
        userSignal: params.signal,
        maxSources: 5,
        timeoutMs: 5000,
      });
      webSources = research.webSources;
      webSearchQueries = research.queries;
    }

    const candidates = mergeCandidateSources(sources, webSources);
    const formatted = splitFormattedCandidateBlocks(candidates);
    const continuityBrief =
      params.history.length > 0
        ? `Respond directly to the user's newest message ("${params.query.trim()}") in continuity with prior turns; do not repeat earlier answers.`
        : '';

    const systemPrompt = buildAviSystemPrompt(
      params.voiceStyle,
      formatted.archiveCandidates,
      resolveAttachedPromptBlock(params),
      true,
      formatted.webContext,
      continuityBrief
    );
    const messages = [
      { role: 'system', content: systemPrompt },
      ...buildConversationWindow(params.history, 14, 14000),
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
      candidateSources: candidates,
      retrievalMs,
      initialQueries: webSearchQueries,
      accumulatedPrefixThoughts: '',
      pipelineStartedAt,
      onUpdate: params.onUpdate,
    });
  }

  private async consumeSseResponse(opts: {
    response: Response;
    protocol: 'gemini' | 'openai';
    engineUsed: EngineId;
    modelLabel: string;
    candidateSources: CandidateSource[];
    retrievalMs: number;
    initialQueries: string[];
    accumulatedPrefixThoughts: string;
    pipelineStartedAt: number;
    onUpdate: (update: StreamProgressPayload) => void;
  }): Promise<StreamGenerateResult> {
    const reader = opts.response.body!.getReader();
    const decoder = new TextDecoder();
    const startedAt = opts.pipelineStartedAt || Date.now();
    let thinkingEndedAt = 0;

    let buffer = '';
    let structuredThoughts = '';
    let rawAnswer = '';
    let webSearchQueries = [...opts.initialQueries];
    let streamWebSources: WebSource[] = [];
    const supportedGroundedUrls = new Set<string>();

    const mergeThoughts = (pass4Thoughts: string, flush: boolean): string => {
      const cleanedPass4 = sanitizeThinkingTrace(pass4Thoughts.trimStart(), flush);
      const prefix = sanitizeThinkingTrace(opts.accumulatedPrefixThoughts.trim(), flush);
      return [prefix, cleanedPass4].filter(Boolean).join('\n\n---\n\n');
    };

    const computeViewState = (flushPartial = false) => {
      const sep = separateLeakedCotFromAnswer(rawAnswer, { flushPartial });
      const combinedPass4Thoughts = [structuredThoughts.trim(), sep.extractedThinking.trim()]
        .filter(Boolean)
        .join('\n\n');
      const isThinkingNow = sep.cleanAnswer.length === 0 || sep.isHoldingBack;
      return {
        thoughts: mergeThoughts(combinedPass4Thoughts, flushPartial || !isThinkingNow),
        answer: sep.cleanAnswer,
        isThinking: isThinkingNow,
      };
    };

    const emitCurrent = () => {
      const state = computeViewState(false);
      if (state.answer.length > 0 && !thinkingEndedAt) {
        thinkingEndedAt = Date.now();
      }
      const grounded =
        supportedGroundedUrls.size > 0
          ? streamWebSources.filter((ws) => supportedGroundedUrls.has(ws.url))
          : [];
      const liveAligned = state.answer
        ? alignCitedSources(state.answer, opts.candidateSources, grounded)
        : null;

      opts.onUpdate({
        content: liveAligned ? liveAligned.content : state.answer,
        thoughts: state.thoughts,
        isThinking: state.isThinking,
        thinkingMs: (thinkingEndedAt || Date.now()) - startedAt,
        webSearchQueries,
        webSources: liveAligned ? liveAligned.webSources : [],
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
        streamWebSources = mergeDistinctWebItems(streamWebSources, delta.webSources, 12);
        changed = true;
      }
      if (delta.groundedChunkUrls.length > 0) {
        for (const u of delta.groundedChunkUrls) {
          supportedGroundedUrls.add(u);
        }
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

    const finalState = computeViewState(true);
    const finalThinkingMs = (thinkingEndedAt || Date.now()) - startedAt;
    const extraGrounded =
      supportedGroundedUrls.size > 0
        ? streamWebSources.filter((ws) => supportedGroundedUrls.has(ws.url))
        : [];
    const aligned = alignCitedSources(finalState.answer, opts.candidateSources, extraGrounded);

    return {
      content: aligned.content,
      thoughts: finalState.thoughts,
      isThinking: false,
      thinkingMs: finalThinkingMs,
      webSearchQueries,
      webSources: aligned.webSources,
      engineUsed: opts.engineUsed,
      modelLabel: opts.modelLabel,
      sources: aligned.sources,
      retrievalMs: opts.retrievalMs,
      followUps: deriveCitedFollowUps(aligned.sources, aligned.webSources, aligned.content),
    };
  }
}

export const llmService = new AviLLMService();
