export interface WorkersAiBinding {
  run: (model: string, inputs: Record<string, unknown>) => Promise<unknown>;
}

export interface ProxyEnv {
  GROQ_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  GEMINI_API_KEY?: string;
  ALLOWED_ORIGINS?: string;
  AI?: WorkersAiBinding;
}

const DEFAULT_ALLOWED_ORIGINS = [
  'https://aviperera.com',
  'https://www.aviperera.com',
  'https://a-vip.github.io',
];

const DEFAULT_GEMINI_MODEL = 'gemini-3-flash-preview';

const ALLOWED_GEMINI_MODELS = new Set([
  'gemini-3-flash-preview',
  'gemini-3.8-flash',
  'gemini-3.5-flash',
  'gemini-3.6-flash',
  'gemini-3.7-flash',
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
  'gemini-4-hydrogen',
  'gemini-3.1-pro-preview',
  'gemini-pro-latest',
  'gemini-4-argon',
  'gemini-4-carbon',
]);

const DEEP_GEMINI_MODELS = new Set(['gemini-4-hydrogen', 'gemini-3.1-pro-preview', 'gemini-pro-latest']);
const GEMINI_FALLBACK_ORDER = [
  'gemini-3-flash-preview',
  'gemini-3.5-flash',
  'gemini-4-hydrogen',
  'gemini-flash-lite-latest',
];

const GROQ_REASONING_MODELS = ['openai/gpt-oss-120b', 'qwen/qwen3-32b', 'llama-3.3-70b-versatile'];
const GROQ_FAST_MODELS = ['llama-3.3-70b-versatile', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant'];

const OPENROUTER_REASONING_MODELS = [
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'google/gemma-4-31b-it:free',
  'nvidia/nemotron-3.5-super-vl:free',
  'openrouter/free',
];
const OPENROUTER_FAST_MODELS = [
  'nvidia/nemotron-3.5-lightning:free',
  'google/gemma-4-26b-a4b-it:free',
  'openrouter/free',
];

const CF_AI_REASONING_MODELS = [
  '@cf/openai/gpt-oss-120b',
  '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  '@cf/meta/llama-4-scout-17b-16e-instruct',
];
const CF_AI_FAST_MODELS = [
  '@cf/meta/llama-4-scout-17b-16e-instruct',
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  '@cf/openai/gpt-oss-20b',
];

export function resolveCorsHeaders(request: Request, extraOrigins?: string): Record<string, string> {
  const origin = request.headers.get('Origin') ?? '';
  const extra = (extraOrigins ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const allowAllLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
  const isVercelPreview = /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin);
  const isExplicitlyAllowed =
    DEFAULT_ALLOWED_ORIGINS.includes(origin) || extra.includes(origin);

  const allowOrigin =
    allowAllLocal || isVercelPreview || isExplicitlyAllowed
      ? origin
      : DEFAULT_ALLOWED_ORIGINS[0];

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Expose-Headers': 'X-Ask-Avi-Protocol, X-Ask-Avi-Model',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

interface ContentTurn {
  role: 'user' | 'model';
  parts: Array<{ text: string }>;
}

interface ChatRequestPayload {
  mode?: 'oss-reasoning' | 'oss-fast' | 'google';
  model?: string;
  systemInstruction?: string;
  contents?: ContentTurn[];
  thinkingBudget?: number;
  enableSearch?: boolean;
  temperature?: number;
}

interface UpstreamResult {
  body: ReadableStream<Uint8Array>;
  protocol: 'openai' | 'gemini';
  modelLabel: string;
  lastStatus?: number;
  lastError?: string;
}

function clampTemperature(value?: number): number {
  return typeof value === 'number' ? Math.max(0.1, Math.min(1.3, value)) : 0.75;
}

function toOpenAIMessages(
  systemInstruction: string | undefined,
  contents: ContentTurn[]
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
  if (systemInstruction?.trim()) {
    messages.push({ role: 'system', content: systemInstruction.trim() });
  }
  for (const turn of contents.slice(-24)) {
    const text = turn.parts.map((p) => p.text).join('\n').trim();
    if (!text) continue;
    messages.push({
      role: turn.role === 'model' ? 'assistant' : 'user',
      content: text,
    });
  }
  return messages;
}

function buildSseResponse(
  result: UpstreamResult,
  corsHeaders: Record<string, string>
): Response {
  return new Response(result.body, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Ask-Avi-Protocol': result.protocol,
      'X-Ask-Avi-Model': result.modelLabel,
    },
  });
}

async function tryOpenAICompatibleUpstream(params: {
  provider: 'groq' | 'openrouter';
  endpoint: string;
  apiKey: string;
  models: string[];
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature: number;
  signal: AbortSignal;
}): Promise<{ ok: true; result: UpstreamResult } | { ok: false; status: number; error: string }> {
  let lastStatus = 502;
  let lastError = '';

  for (const model of params.models) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    };
    if (params.provider === 'openrouter') {
      headers['HTTP-Referer'] = 'https://aviperera.com';
      headers['X-Title'] = 'Ask Avi';
    }

    const payload: Record<string, unknown> = {
      model,
      messages: params.messages,
      stream: true,
      temperature: params.temperature,
      max_tokens: 4096,
    };
    if (
      params.provider === 'groq' &&
      (model.startsWith('openai/gpt-oss') || model.startsWith('qwen/qwen3'))
    ) {
      payload.reasoning_format = 'parsed';
      payload.reasoning_effort = model.startsWith('openai/gpt-oss') ? 'high' : 'default';
    }

    const res = await fetch(params.endpoint, {
      method: 'POST',
      headers,
      signal: params.signal,
      body: JSON.stringify(payload),
    });

    if (res.ok && res.body) {
      return {
        ok: true,
        result: {
          body: res.body,
          protocol: 'openai',
          modelLabel: `${model} (${params.provider === 'groq' ? 'Groq Free' : 'OpenRouter Free'})`,
        },
      };
    }

    lastStatus = res.status || 502;
    lastError = await res.text().catch(() => res.statusText);
    if (lastStatus !== 404 && lastStatus !== 429 && lastStatus !== 503 && lastStatus !== 402) {
      break;
    }
  }

  return { ok: false, status: lastStatus, error: lastError };
}

async function tryCloudflareWorkersAI(params: {
  ai: WorkersAiBinding;
  models: string[];
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature: number;
}): Promise<UpstreamResult | null> {
  for (const model of params.models) {
    try {
      const output = await params.ai.run(model, {
        messages: params.messages,
        stream: true,
        max_tokens: 4096,
        temperature: params.temperature,
      });
      if (output instanceof ReadableStream) {
        return {
          body: output as ReadableStream<Uint8Array>,
          protocol: 'openai',
          modelLabel: `${model.replace('@cf/', '')} (Workers AI)`,
        };
      }
    } catch {
      // Try next open-source Workers AI model
    }
  }
  return null;
}

async function tryGeminiUpstream(params: {
  apiKey: string;
  body: ChatRequestPayload;
  temperature: number;
  signal: AbortSignal;
}): Promise<{ ok: true; result: UpstreamResult } | { ok: false; status: number; error: string }> {
  const requestedModel = params.body.model ?? DEFAULT_GEMINI_MODEL;
  const primaryModel = ALLOWED_GEMINI_MODELS.has(requestedModel)
    ? requestedModel
    : DEFAULT_GEMINI_MODEL;

  const budget = Math.max(
    1024,
    Math.min(
      24576,
      Number(params.body.thinkingBudget) || (DEEP_GEMINI_MODELS.has(primaryModel) ? 16384 : 8192)
    )
  );

  const buildPayload = (includeSearch: boolean): Record<string, unknown> => {
    const payload: Record<string, unknown> = {
      contents: params.body.contents!.slice(-24),
      generationConfig: {
        temperature: params.temperature,
        topP: 0.92,
        maxOutputTokens: 8192,
        thinkingConfig: {
          includeThoughts: true,
          thinkingBudget: budget,
        },
      },
    };
    if (params.body.systemInstruction?.trim()) {
      payload.systemInstruction = {
        parts: [{ text: params.body.systemInstruction.trim() }],
      };
    }
    if (includeSearch) {
      payload.tools = [{ googleSearch: {} }];
    }
    return payload;
  };

  const candidates = [
    primaryModel,
    ...GEMINI_FALLBACK_ORDER.filter((m) => m !== primaryModel),
  ];

  const callModel = (model: string, includeSearch: boolean) =>
    fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        model
      )}:streamGenerateContent?alt=sse`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': params.apiKey,
        },
        signal: params.signal,
        body: JSON.stringify(buildPayload(includeSearch)),
      }
    );

  let lastStatus = 502;
  let lastError = '';
  let searchAllowed = params.body.enableSearch !== false;

  for (const model of candidates) {
    let upstream = await callModel(model, searchAllowed);
    if (upstream.ok && upstream.body) {
      return {
        ok: true,
        result: {
          body: upstream.body,
          protocol: 'gemini',
          modelLabel: model,
        },
      };
    }

    lastStatus = upstream.status || 502;
    lastError = await upstream.text().catch(() => upstream.statusText);

    if (searchAllowed && (lastStatus === 429 || lastStatus === 403 || lastStatus === 400)) {
      searchAllowed = false;
      upstream = await callModel(model, false);
      if (upstream.ok && upstream.body) {
        return {
          ok: true,
          result: {
            body: upstream.body,
            protocol: 'gemini',
            modelLabel: model,
          },
        };
      }
      lastStatus = upstream.status || 502;
      lastError = await upstream.text().catch(() => upstream.statusText);
    }

    if (lastStatus !== 404 && lastStatus !== 503 && lastStatus !== 429) {
      break;
    }
  }

  return { ok: false, status: lastStatus, error: lastError };
}

export async function handleGeminiProxyRequest(
  request: Request,
  env: ProxyEnv
): Promise<Response> {
  const corsHeaders = resolveCorsHeaders(request, env.ALLOWED_ORIGINS);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const groqKey = env.GROQ_API_KEY?.trim();
  const openRouterKey = env.OPENROUTER_API_KEY?.trim();
  const geminiKey = env.GEMINI_API_KEY?.trim();
  const hasWorkersAI = Boolean(env.AI);

  if (!groqKey && !openRouterKey && !hasWorkersAI && !geminiKey) {
    return new Response(
      JSON.stringify({
        error: 'proxy_unconfigured',
        message:
          'Bind Workers AI [ai] on Cloudflare or set GROQ_API_KEY / OPENROUTER_API_KEY / GEMINI_API_KEY on the proxy.',
      }),
      {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }

  let body: ChatRequestPayload;
  try {
    body = (await request.json()) as ChatRequestPayload;
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!Array.isArray(body.contents) || body.contents.length === 0) {
    return new Response(JSON.stringify({ error: 'missing_contents' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const temperature = clampTemperature(body.temperature);
  const mode = body.mode ?? (body.model ? 'google' : 'oss-reasoning');
  const openAIMessages = toOpenAIMessages(body.systemInstruction, body.contents);

  let lastStatus = 502;
  let lastError = 'No upstream provider succeeded.';

  // 1. Explicit Google Gemini choice tries Gemini first
  if (mode === 'google' && geminiKey) {
    const gem = await tryGeminiUpstream({
      apiKey: geminiKey,
      body,
      temperature,
      signal: request.signal,
    });
    if (gem.ok) return buildSseResponse(gem.result, corsHeaders);
    lastStatus = gem.status;
    lastError = gem.error;
  }

  // 2. Completely Free Open-Source Provider Cascade (Groq -> OpenRouter :free -> Workers AI)
  if (groqKey) {
    const groq = await tryOpenAICompatibleUpstream({
      provider: 'groq',
      endpoint: 'https://api.groq.com/openai/v1/chat/completions',
      apiKey: groqKey,
      models: mode === 'oss-fast' ? GROQ_FAST_MODELS : GROQ_REASONING_MODELS,
      messages: openAIMessages,
      temperature,
      signal: request.signal,
    });
    if (groq.ok) return buildSseResponse(groq.result, corsHeaders);
    lastStatus = groq.status;
    lastError = groq.error;
  }

  if (openRouterKey) {
    const or = await tryOpenAICompatibleUpstream({
      provider: 'openrouter',
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      apiKey: openRouterKey,
      models: mode === 'oss-fast' ? OPENROUTER_FAST_MODELS : OPENROUTER_REASONING_MODELS,
      messages: openAIMessages,
      temperature,
      signal: request.signal,
    });
    if (or.ok) return buildSseResponse(or.result, corsHeaders);
    lastStatus = or.status;
    lastError = or.error;
  }

  if (env.AI) {
    const cf = await tryCloudflareWorkersAI({
      ai: env.AI,
      models: mode === 'oss-fast' ? CF_AI_FAST_MODELS : CF_AI_REASONING_MODELS,
      messages: openAIMessages,
      temperature,
    });
    if (cf) return buildSseResponse(cf, corsHeaders);
  }

  // 3. Final fallback to Gemini if OSS mode fell through and Gemini key exists
  if (mode !== 'google' && geminiKey) {
    const gem = await tryGeminiUpstream({
      apiKey: geminiKey,
      body,
      temperature,
      signal: request.signal,
    });
    if (gem.ok) return buildSseResponse(gem.result, corsHeaders);
    lastStatus = gem.status;
    lastError = gem.error;
  }

  return new Response(
    JSON.stringify({
      error: 'upstream_ai_error',
      status: lastStatus,
      message: lastError.slice(0, 500),
    }),
    {
      status: lastStatus || 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
}
