import {
  CreateWebWorkerMLCEngine,
  deleteModelAllInfoInCache,
  hasModelInCache,
  prebuiltAppConfig,
  type WebWorkerMLCEngine,
} from '@mlc-ai/web-llm';
import { buildAviSystemPrompt, ENGINE_OPTIONS } from '../data/persona';
import type {
  AttachedContext,
  ChatMessage,
  CustomApiConfig,
  EngineId,
  ModelLoadProgress,
  RetrievedSource,
  VoiceStyle,
} from '../types/chat';
import { synthesizeInstantAviReply } from './instantSynthesizer';
import { knowledgeIndex } from './rag';

export interface WebGPUInfo {
  supported: boolean;
  reason?: string;
}

export interface StreamGenerateParams {
  query: string;
  history: ChatMessage[];
  engineId: EngineId;
  voiceStyle: VoiceStyle;
  attachedContext?: AttachedContext;
  customApi?: CustomApiConfig;
  signal?: AbortSignal;
  onSources: (sources: RetrievedSource[], elapsedMs: number) => void;
  onToken: (partialMarkdown: string) => void;
  onModelProgress?: (progress: ModelLoadProgress) => void;
}

export interface StreamGenerateResult {
  markdown: string;
  engineUsed: EngineId;
  modelLabel: string;
  sources: RetrievedSource[];
  retrievalMs: number;
  followUps: string[];
}

class AviLLMService {
  private worker: Worker | null = null;
  private mlcEngine: WebWorkerMLCEngine | null = null;
  private activeModelId: string | null = null;
  private loadingPromise: Promise<WebWorkerMLCEngine> | null = null;

  public async detectWebGPU(): Promise<WebGPUInfo> {
    if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
      return {
        supported: false,
        reason: 'WebGPU is not exposed by this browser. Using Instant Sovereign Archive Mode.',
      };
    }
    try {
      const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
      if (!gpu) {
        return { supported: false, reason: 'WebGPU adapter API unavailable.' };
      }
      const adapter = await gpu.requestAdapter();
      if (!adapter) {
        return {
          supported: false,
          reason: 'No compatible WebGPU hardware adapter detected on this device.',
        };
      }
      return { supported: true };
    } catch {
      return {
        supported: false,
        reason: 'WebGPU initialization blocked in this environment.',
      };
    }
  }

  public async getCachedModels(): Promise<Record<string, boolean>> {
    const out: Record<string, boolean> = {};
    for (const opt of ENGINE_OPTIONS) {
      if (!opt.mlcModelId) continue;
      try {
        out[opt.id] = await hasModelInCache(opt.mlcModelId, prebuiltAppConfig);
      } catch {
        out[opt.id] = false;
      }
    }
    return out;
  }

  public async clearCachedModel(engineId: EngineId): Promise<void> {
    const opt = ENGINE_OPTIONS.find((o) => o.id === engineId);
    if (!opt?.mlcModelId) return;
    if (this.activeModelId === opt.mlcModelId) {
      this.mlcEngine = null;
      this.activeModelId = null;
    }
    await deleteModelAllInfoInCache(opt.mlcModelId, prebuiltAppConfig);
  }

  public async loadWebGPUModel(
    engineId: EngineId,
    onProgress?: (p: ModelLoadProgress) => void
  ): Promise<WebWorkerMLCEngine> {
    const opt = ENGINE_OPTIONS.find((o) => o.id === engineId);
    if (!opt?.mlcModelId) {
      throw new Error(`Engine ${engineId} does not correspond to a WebGPU model.`);
    }

    if (this.mlcEngine && this.activeModelId === opt.mlcModelId) {
      onProgress?.({
        engineId,
        status: 'ready',
        progress: 1,
        text: `${opt.shortName} ready in WebGPU memory.`,
      });
      return this.mlcEngine;
    }

    if (this.loadingPromise && this.activeModelId === opt.mlcModelId) {
      return this.loadingPromise;
    }

    const modelId = opt.mlcModelId;
    this.activeModelId = modelId;

    this.loadingPromise = (async () => {
      try {
        onProgress?.({
          engineId,
          status: 'loading',
          progress: 0.02,
          text: `Preparing ${opt.shortName} (${opt.badge})…`,
        });

        if (!this.worker) {
          this.worker = new Worker(new URL('./webllm.worker.ts', import.meta.url), {
            type: 'module',
          });
        }

        const engine = await CreateWebWorkerMLCEngine(this.worker, modelId, {
          appConfig: prebuiltAppConfig,
          initProgressCallback: (report) => {
            onProgress?.({
              engineId,
              status: report.progress >= 1 ? 'ready' : 'loading',
              progress: report.progress,
              text: report.text || `Loading ${opt.shortName}…`,
            });
          },
        });

        this.mlcEngine = engine;
        onProgress?.({
          engineId,
          status: 'ready',
          progress: 1,
          text: `${opt.shortName} active (WebGPU)`,
        });
        return engine;
      } catch (err) {
        this.activeModelId = null;
        this.mlcEngine = null;
        const msg = err instanceof Error ? err.message : 'Failed to initialize WebGPU model.';
        onProgress?.({
          engineId,
          status: 'error',
          progress: 0,
          text: msg,
        });
        throw err;
      } finally {
        this.loadingPromise = null;
      }
    })();

    return this.loadingPromise;
  }

  public async interrupt(): Promise<void> {
    try {
      if (this.mlcEngine) {
        await this.mlcEngine.interruptGenerate();
      }
    } catch {
      // Ignore interruption errors when idle
    }
  }

  public async generateReply(params: StreamGenerateParams): Promise<StreamGenerateResult> {
    const recentUserHint = params.history
      .filter((m) => m.role === 'user')
      .slice(-2)
      .map((m) => m.content)
      .join(' ');

    const { sources, elapsedMs } = knowledgeIndex.search(params.query, {
      topK: 4,
      conversationHint: recentUserHint,
    });
    params.onSources(sources, elapsedMs);

    const opt = ENGINE_OPTIONS.find((o) => o.id === params.engineId) ?? ENGINE_OPTIONS[0];

    // 1. Custom OpenAI-compatible API route (optional power-user mode)
    if (params.engineId === 'custom-api' && params.customApi?.endpointUrl && params.customApi?.modelName) {
      const text = await this.streamCustomApi(params, sources);
      return {
        markdown: text,
        engineUsed: 'custom-api',
        modelLabel: params.customApi.modelName,
        sources,
        retrievalMs: elapsedMs,
        followUps: deriveContextualFollowUps(sources),
      };
    }

    // 2. WebGPU In-Browser Neural LLM
    if (opt.requiresWebGPU && opt.mlcModelId) {
      try {
        const gpuInfo = await this.detectWebGPU();
        if (!gpuInfo.supported) {
          throw new Error(gpuInfo.reason ?? 'WebGPU unavailable');
        }
        if (params.signal?.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }

        const engine = await this.loadWebGPUModel(params.engineId, params.onModelProgress);
        const systemPrompt = buildAviSystemPrompt(
          params.voiceStyle,
          sources,
          params.attachedContext?.content
        );

        const trimmedHistory = params.history
          .filter((m) => !m.isStreaming && m.content.trim().length > 0)
          .slice(-4)
          .map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content.slice(0, 900),
          }));

        const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
          { role: 'system', content: systemPrompt },
          ...trimmedHistory,
          { role: 'user', content: params.query },
        ];

        const chunks = await engine.chat.completions.create({
          messages,
          stream: true,
          temperature: params.voiceStyle === 'academic' ? 0.45 : 0.65,
          max_tokens: 850,
        });

        let accumulated = '';
        for await (const chunk of chunks) {
          if (params.signal?.aborted) {
            await this.interrupt();
            break;
          }
          const delta = chunk.choices?.[0]?.delta?.content ?? '';
          if (delta) {
            accumulated += delta;
            params.onToken(accumulated);
          }
        }

        if (accumulated.trim().length > 0) {
          return {
            markdown: accumulated,
            engineUsed: params.engineId,
            modelLabel: opt.shortName,
            sources,
            retrievalMs: elapsedMs,
            followUps: deriveContextualFollowUps(sources),
          };
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          throw err;
        }
        // Seamless graceful fallback to Instant Sovereign Archive synthesis
        const fallbackReason =
          err instanceof Error ? err.message : 'WebGPU unavailable; switched to Instant Archive.';
        const synth = synthesizeInstantAviReply(
          params.query,
          sources,
          params.voiceStyle,
          params.attachedContext
        );
        const fullText = `${synth.markdown}\n\n---\n*Engine note: ${fallbackReason}*`;
        await streamTextSmoothly(fullText, params.onToken, params.signal);
        return {
          markdown: fullText,
          engineUsed: 'instant',
          modelLabel: 'Instant Archive (Fallback)',
          sources,
          retrievalMs: elapsedMs,
          followUps: synth.followUps,
        };
      }
    }

    // 3. Instant Sovereign Archive Engine (0 MB default)
    const synth = synthesizeInstantAviReply(
      params.query,
      sources,
      params.voiceStyle,
      params.attachedContext
    );
    await streamTextSmoothly(synth.markdown, params.onToken, params.signal);

    return {
      markdown: synth.markdown,
      engineUsed: 'instant',
      modelLabel: 'Instant Archive',
      sources,
      retrievalMs: elapsedMs,
      followUps: synth.followUps,
    };
  }

  private async streamCustomApi(
    params: StreamGenerateParams,
    sources: RetrievedSource[]
  ): Promise<string> {
    const cfg = params.customApi!;
    const systemPrompt = buildAviSystemPrompt(
      params.voiceStyle,
      sources,
      params.attachedContext?.content
    );
    const messages = [
      { role: 'system', content: systemPrompt },
      ...params.history
        .filter((m) => !m.isStreaming && m.content.trim().length > 0)
        .slice(-6)
        .map((m) => ({ role: m.role, content: m.content })),
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
        temperature: 0.65,
      }),
    });

    if (!res.ok || !res.body) {
      throw new Error(`Custom API returned ${res.status} ${res.statusText}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let accumulated = '';

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
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const token = parsed.choices?.[0]?.delta?.content ?? '';
          if (token) {
            accumulated += token;
            params.onToken(accumulated);
          }
        } catch {
          // Ignore partial SSE chunk
        }
      }
    }

    return accumulated;
  }
}

async function streamTextSmoothly(
  text: string,
  onToken: (partial: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const tokens = text.split(/(\s+)/);
  let out = '';
  const stepSize = tokens.length > 260 ? 5 : 3;

  for (let i = 0; i < tokens.length; i += stepSize) {
    if (signal?.aborted) break;
    out += tokens.slice(i, i + stepSize).join('');
    onToken(out);
    await new Promise<void>((resolve) => setTimeout(resolve, 14));
  }
  if (!signal?.aborted) {
    onToken(text);
  }
}

function deriveContextualFollowUps(sources: RetrievedSource[]): string[] {
  const first = sources[0]?.entry;
  const second = sources[1]?.entry;
  const list: string[] = [];
  if (first) {
    list.push(`Can you go deeper into the legal or structural argument in "${first.title.slice(0, 46)}${first.title.length > 46 ? '…' : ''}"?`);
  }
  if (second) {
    list.push(`How does this connect to ${second.title.slice(0, 48)}${second.title.length > 48 ? '…' : ''}?`);
  }
  list.push('What concrete action or policy reform follows from this?');
  return list.slice(0, 3);
}

export const llmService = new AviLLMService();
