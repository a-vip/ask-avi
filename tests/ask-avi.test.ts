// @vitest-environment jsdom
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildAviSystemPrompt, ENGINE_OPTIONS } from '../src/data/persona';
import {
  extractGeminiChunkDelta,
  extractOpenAIChunkDelta,
  mergeUniqueQueries,
  mergeUniqueWebSources,
} from '../src/engine/geminiStream';
import { handleGeminiProxyRequest } from '../shared/geminiProxy';
import { resolveEffectiveProxyUrl } from '../src/engine/llmService';
import { knowledgeIndex, KNOWLEDGE_META } from '../src/engine/rag';
import {
  exportUsersAsCsv,
  isVerifiedAdmin,
  resolveEffectiveAuthUrl,
} from '../src/utils/authClient';
import {
  allocateContextBudget,
  compactContextText,
  extractFileContext,
  formatContextsForPrompt,
  GUEST_MAX_CONTEXT_ITEMS,
  GUEST_MAX_TOTAL_CONTEXT_CHARS,
  MAX_CONTEXT_ITEMS,
  MAX_TOTAL_CONTEXT_CHARS,
} from '../src/utils/contextExtractor';
import { renderMarkdownToSafeHtml, resolveSourceUrl } from '../src/utils/markdown';
import { splitThinkingAndAnswer } from '../src/utils/thinking';
import {
  DEFAULT_SETTINGS,
  deriveThreadTitle,
  exportThreadAsMarkdown,
  groupThreadsByRecency,
  loadUserProfile,
  saveUserProfile,
} from '../src/utils/storage';
import type { ChatThread } from '../src/types/chat';

describe('Knowledge Index & RAG Retrieval', () => {
  it('loads all 108 sovereign knowledge entries with valid metadata', () => {
    const entries = knowledgeIndex.getAllEntries();
    expect(entries.length).toBe(108);
    expect(KNOWLEDGE_META.totalEntries).toBe(108);
    expect(knowledgeIndex.getCategories().length).toBeGreaterThanOrEqual(4);
  });

  it('retrieves relevant sources for Meaningful Human Control & LAWS queries', () => {
    const { sources, elapsedMs } = knowledgeIndex.search(
      'What is your framework for Meaningful Human Control over autonomous weapons?'
    );
    expect(elapsedMs).toBeGreaterThanOrEqual(0);
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.length).toBeLessThanOrEqual(3);

    const combinedText = sources
      .map((s) => `${s.entry.title} ${s.snippet}`.toLowerCase())
      .join(' ');
    expect(combinedText).toMatch(/meaningful human control|autonomous weapons|unidir|laws/);
  });

  it('returns empty sources for casual greetings or unmatched unrelated tokens', () => {
    expect(knowledgeIndex.search('hello').sources.length).toBe(0);
    expect(knowledgeIndex.search('zxqvbnm12345nonexistenttoken').sources.length).toBe(0);
  });
});

describe('Free Open-Source Default, Multi-Provider Config & SSE Parsers', () => {
  it('defaults to completely free Open-Source Reasoning with Google Gemini retained as options', () => {
    expect(DEFAULT_SETTINGS.engineId).toBe('oss-reasoning');
    expect(DEFAULT_SETTINGS.webSearchEnabled).toBe(true);
    expect(ENGINE_OPTIONS.map((e) => e.id)).toEqual([
      'oss-reasoning',
      'oss-fast',
      'gemini-flash',
      'gemini-pro',
      'custom-api',
    ]);
    expect(ENGINE_OPTIONS[0].providerKind).toBe('open-source');
    expect(ENGINE_OPTIONS[2].geminiModelId).toBe('gemini-3-flash-preview');
    expect(ENGINE_OPTIONS[3].geminiModelId).toBe('gemini-4-hydrogen');
    expect(ENGINE_OPTIONS[2].thinkingBudget).toBe(8192);
    expect(ENGINE_OPTIONS[3].thinkingBudget).toBe(16384);
  });

  it('extracts streamed reasoning and content deltas from Groq / OpenRouter / Workers AI chunks', () => {
    const groqThought = extractOpenAIChunkDelta(
      JSON.stringify({
        choices: [{ delta: { reasoning: 'Examining incentives first.' } }],
      })
    );
    expect(groqThought.thoughtDelta).toBe('Examining incentives first.');
    expect(groqThought.answerDelta).toBe('');

    const openRouterAnswer = extractOpenAIChunkDelta(
      JSON.stringify({
        choices: [{ delta: { content: 'Institutional accountability starts with bindings.' } }],
      })
    );
    expect(openRouterAnswer.answerDelta).toBe('Institutional accountability starts with bindings.');

    const workersAiChunk = extractOpenAIChunkDelta(
      JSON.stringify({ response: 'From first principles.' })
    );
    expect(workersAiChunk.answerDelta).toBe('From first principles.');
  });

  it('routes proxy OSS requests to Cloudflare Workers AI when no external API keys are set', async () => {
    const encoder = new TextEncoder();
    const fakeStream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode('data: {"choices":[{"delta":{"content":"Hello from Workers AI"}}]}\n\n')
        );
        controller.close();
      },
    });

    const req = new Request('https://proxy.test/api/chat', {
      method: 'POST',
      headers: { Origin: 'https://aviperera.com', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'oss-reasoning',
        systemInstruction: 'Be Avi.',
        contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
      }),
    });

    const res = await handleGeminiProxyRequest(req, {
      AI: {
        run: async () => fakeStream,
      },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Ask-Avi-Protocol')).toBe('openai');
    expect(res.headers.get('X-Ask-Avi-Model')).toContain('Workers AI');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://aviperera.com');
  });

  it('extracts native Gemini thought parts, answer text, web search queries, and grounding chunks', () => {
    const sseJson = JSON.stringify({
      candidates: [
        {
          content: {
            parts: [
              { thought: true, text: 'Let me weigh both sides of this philosophical question first.' },
              { text: 'Context determines whether a claim illuminates or misleads.' },
            ],
          },
          groundingMetadata: {
            webSearchQueries: ['current UK AI safety bill 2026'],
            groundingChunks: [
              { web: { uri: 'https://example.org/ai-bill', title: 'UK AI Regulation Update' } },
            ],
          },
        },
      ],
    });

    const delta = extractGeminiChunkDelta(sseJson);
    expect(delta.thoughtDelta).toBe('Let me weigh both sides of this philosophical question first.');
    expect(delta.answerDelta).toBe('Context determines whether a claim illuminates or misleads.');
    expect(delta.webSearchQueries).toEqual(['current UK AI safety bill 2026']);
    expect(delta.webSources).toEqual([
      { index: 1, title: 'UK AI Regulation Update', url: 'https://example.org/ai-bill' },
    ]);
  });

  it('merges web search queries and web sources without duplicates', () => {
    const q = mergeUniqueQueries(['query a'], ['query a', 'query b']);
    expect(q).toEqual(['query a', 'query b']);

    const ws = mergeUniqueWebSources(
      [{ index: 1, title: 'One', url: 'https://one.test' }],
      [
        { index: 1, title: 'One dup', url: 'https://one.test' },
        { index: 2, title: 'Two', url: 'https://two.test' },
      ]
    );
    expect(ws).toEqual([
      { index: 1, title: 'One', url: 'https://one.test' },
      { index: 2, title: 'Two', url: 'https://two.test' },
    ]);
  });

  it('resolves explicit proxy URL cleanly when provided', () => {
    expect(resolveEffectiveProxyUrl('https://ask-avi-api.vercel.app/api/chat')).toBe(
      'https://ask-avi-api.vercel.app/api/chat'
    );
  });

  it('omits archive block in system prompt when no archive dossiers match', () => {
    const prompt = buildAviSystemPrompt('standard', []);
    expect(prompt).toContain('Ask Avi');
    expect(prompt).not.toContain('RELEVANT ARCHIVE LINKS');
  });

  it('includes optional open-web reference snippets when native search quota falls back', () => {
    const prompt = buildAviSystemPrompt(
      'standard',
      [],
      undefined,
      false,
      'LIVE OPEN-WEB REFERENCE SNIPPETS:\n- UN CCW (https://en.wikipedia.org/wiki/Convention_on_Certain_Conventional_Weapons)'
    );
    expect(prompt).toContain('LIVE OPEN-WEB REFERENCE SNIPPETS');
    expect(prompt).toContain('en.wikipedia.org');
  });
});

describe('Safe Markdown, Citation Pills & Custom Reasoning Tags', () => {
  it('resolves safe source URLs or DOI fallbacks and rejects unsafe protocols', () => {
    expect(resolveSourceUrl('https://aviperera.com/global-shell-game/')).toBe(
      'https://aviperera.com/global-shell-game/'
    );
    expect(resolveSourceUrl(undefined, '10.1111/test-doi')).toBe('https://doi.org/10.1111/test-doi');
    expect(resolveSourceUrl('javascript:alert(1)')).toBe('');
  });

  it('converts valid inline [n] citations into direct hyperlinks when URLs exist and falls back cleanly otherwise', () => {
    const linkedHtml = renderMarkdownToSafeHtml(
      'Accountability requires verification [1] and intervention capacity [2], plus [existing link](https://example.com/[1]), not [99].',
      [
        { title: 'The Global Shell Game', url: 'https://aviperera.com/the-global-shell-game/' },
        { title: 'Autonomous Weapons Study', doi: '10.1000/xyz123' },
      ]
    );
    expect(linkedHtml).toContain(
      'href="https://aviperera.com/the-global-shell-game/" target="_blank" rel="noopener noreferrer" class="cite-pill" data-cite-idx="1"'
    );
    expect(linkedHtml).toContain(
      'href="https://doi.org/10.1000/xyz123" target="_blank" rel="noopener noreferrer" class="cite-pill" data-cite-idx="2"'
    );
    expect(linkedHtml).not.toContain('data-cite-idx="99"');
    expect(linkedHtml).toContain('[99]');
    expect(linkedHtml).toContain('href="https://example.com/[1]"');

    const numericHtml = renderMarkdownToSafeHtml(
      'Fallback citation [1] and invalid [9].',
      1
    );
    expect(numericHtml).toContain('<button type="button" class="cite-pill" data-cite-idx="1"');
    expect(numericHtml).not.toContain('data-cite-idx="9"');
  });

  it('sanitizes dangerous XSS payloads', () => {
    const html = renderMarkdownToSafeHtml(
      'Hello <script>window.__xss=1</script><img src=x onerror="alert(1)" /> world',
      0
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
  });

  it('splits optional <thought> blocks for custom endpoints cleanly', () => {
    const partial = splitThinkingAndAnswer('<thought>Testing their premise first.');
    expect(partial.isThinking).toBe(true);
    expect(partial.thinking).toBe('Testing their premise first.');

    const done = splitThinkingAndAnswer('<thought>Weighed options.</thought>\n\nDirect answer.');
    expect(done.isThinking).toBe(false);
    expect(done.answer).toBe('Direct answer.');
  });
});

describe('Thread Storage & Export Helpers', () => {
  it('derives clean titles and groups threads by recency', () => {
    expect(deriveThreadTitle('   What is SovDash?  ')).toBe('What is SovDash?');
    expect(deriveThreadTitle('')).toBe('New conversation');

    const now = Date.now();
    const oneDay = 86_400_000;
    const threads: ChatThread[] = [
      { id: '1', title: 'Pinned', createdAt: now, updatedAt: now - 10 * oneDay, pinned: true, messages: [] },
      { id: '2', title: 'Today', createdAt: now, updatedAt: now - 1000, messages: [] },
      { id: '3', title: 'Yesterday', createdAt: now, updatedAt: now - oneDay, messages: [] },
    ];
    expect(groupThreadsByRecency(threads).map((g) => g.label)).toEqual(['Pinned', 'Today', 'Yesterday']);
  });

  it('exports conversation threads as formatted markdown', () => {
    const { sources } = knowledgeIndex.search('SovDash');
    const thread: ChatThread = {
      id: 't-export',
      title: 'SovDash Briefing',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [
        { id: 'm1', role: 'user', content: 'Tell me about SovDash.', createdAt: Date.now() },
        {
          id: 'm2',
          role: 'assistant',
          content: 'SovDash builds sovereign decision intelligence [1].',
          createdAt: Date.now(),
          sources,
        },
      ],
    };
    const md = exportThreadAsMarkdown(thread);
    expect(md).toContain('# SovDash Briefing');
    expect(md).toContain('### Ask Avi');
  });

  it('persists and clears local user profile for bottom-left Sign in / Sign out', () => {
    saveUserProfile({
      name: 'Avi Perera',
      email: 'avi@example.com',
      provider: 'email',
      isAdmin: false,
      signedInAt: 1234,
    });
    expect(loadUserProfile()?.name).toBe('Avi Perera');
    expect(loadUserProfile()?.email).toBe('avi@example.com');
    saveUserProfile(null);
    expect(loadUserProfile()).toBeNull();
  });

  it('resolves relative Hostinger/local subpath endpoints and gates admin strictly', () => {
    expect(resolveEffectiveProxyUrl()).toBe('./api/chat');
    expect(resolveEffectiveAuthUrl()).toBe('./api/auth');
    expect(resolveEffectiveAuthUrl('https://aviperera.com/ask-avi/api/chat')).toBe(
      'https://aviperera.com/ask-avi/api/auth'
    );

    expect(
      isVerifiedAdmin({ name: 'Avi', email: 'workwithavip@gmail.com', isAdmin: true, signedInAt: 1 })
    ).toBe(true);
    expect(
      isVerifiedAdmin({ name: 'Visitor', email: 'workwithavip@gmail.com', isAdmin: false, signedInAt: 1 })
    ).toBe(false);
    expect(
      isVerifiedAdmin({ name: 'Evil', email: 'evil@example.com', isAdmin: true, signedInAt: 1 })
    ).toBe(false);

    const csv = exportUsersAsCsv([
      {
        id: '1',
        name: '=CMD()',
        email: 'user@example.com',
        provider: 'google',
        role: 'user',
        marketingOptIn: true,
        createdAt: 1000,
        lastSeenAt: 2000,
        loginCount: 1,
        chatCount: 3,
        errorCount: 0,
      },
    ]);
    expect(csv).toContain("'=CMD()");
    expect(csv).toContain('user@example.com,google,user,Yes');
  });

  it('requires authentication for Gemini engines while keeping open-source engines public', () => {
    const ossR = ENGINE_OPTIONS.find((e) => e.id === 'oss-reasoning');
    const ossF = ENGINE_OPTIONS.find((e) => e.id === 'oss-fast');
    const gFlash = ENGINE_OPTIONS.find((e) => e.id === 'gemini-flash');
    const gPro = ENGINE_OPTIONS.find((e) => e.id === 'gemini-pro');

    expect(ossR?.requiresAuth).toBeFalsy();
    expect(ossF?.requiresAuth).toBeFalsy();
    expect(gFlash?.requiresAuth).toBe(true);
    expect(gPro?.requiresAuth).toBe(true);
  });

  it('caps multi-context token budgets fairly and embeds without double-prefixing', () => {
    const huge1 = 'A '.repeat(3000);
    const huge2 = 'B '.repeat(3000);
    const huge3 = 'C '.repeat(3000);
    const small = 'Concise note on Meaningful Human Control.';
    const extra5 = 'Should be dropped beyond MAX_CONTEXT_ITEMS.';

    const result = allocateContextBudget([
      { id: '1', title: 'Doc 1', content: huge1, kind: 'pdf' },
      { id: '2', title: 'Doc 2', content: huge2, kind: 'doc' },
      { id: '3', title: 'Doc 3', content: small, kind: 'link' },
      { id: '4', title: 'Doc 4', content: huge3, kind: 'slides' },
      { id: '5', title: 'Doc 5', content: extra5, kind: 'text' },
    ]);

    expect(result.items.length).toBe(MAX_CONTEXT_ITEMS);
    expect(result.totalChars).toBeLessThanOrEqual(MAX_TOTAL_CONTEXT_CHARS);
    expect(result.items.find((i) => i.id === '3')?.content).toBe(small);
    expect(result.items.find((i) => i.id === '3')?.trimmed).toBe(false);
    expect(result.trimmedAny).toBe(true);

    const compacted = compactContextText('hello   world\n\n\n\nfoo', 100);
    expect(compacted.text).toBe('hello world\n\nfoo');

    const promptBlock = formatContextsForPrompt(result.items);
    const sysPrompt = buildAviSystemPrompt('standard', [], promptBlock);
    expect(sysPrompt).toContain('[Context 3 · LINK: Doc 3]');
    expect(sysPrompt).toContain(small);
    expect(sysPrompt).not.toContain('USER-ATTACHED DOCUMENT');

    const guestResult = allocateContextBudget(
      [
        { id: 'g1', title: 'G1', content: huge1, kind: 'pdf' },
        { id: 'g2', title: 'G2', content: huge2, kind: 'doc' },
        { id: 'g3', title: 'G3', content: small, kind: 'text' },
      ],
      false
    );
    expect(guestResult.items.length).toBe(GUEST_MAX_CONTEXT_ITEMS);
    expect(guestResult.totalChars).toBeLessThanOrEqual(GUEST_MAX_TOTAL_CONTEXT_CHARS);
    expect(guestResult.totalChars).toBeLessThan(result.totalChars);
  });

  it('extracts text cleanly from .docx, .pptx, and .xlsx fixtures', async () => {
    const makeZipFile = (entries: Record<string, string>, name: string) => {
      const zipped = zipSync(
        Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, strToU8(v)]))
      );
      const ab = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength);
      return {
        name,
        size: zipped.byteLength,
        arrayBuffer: async () => ab,
        text: async () => '',
      } as unknown as File;
    };

    const docx = await extractFileContext(
      makeZipFile(
        {
          'word/document.xml':
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Article 36 review brief</w:t></w:r></w:p></w:body></w:document>',
        },
        'brief.docx'
      )
    );
    expect(docx.kind).toBe('doc');
    expect(docx.content).toContain('Article 36 review brief');

    const pptx = await extractFileContext(
      makeZipFile(
        {
          'ppt/slides/slide1.xml':
            '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:t>Opening Thesis</a:t></p:sld>',
          'ppt/slides/slide2.xml':
            '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:t>Governance Architecture</a:t></p:sld>',
        },
        'deck.pptx'
      )
    );
    expect(pptx.kind).toBe('slides');
    expect(pptx.content).toContain('[Slide 1] Opening Thesis');
    expect(pptx.content).toContain('[Slide 2] Governance Architecture');

    const xlsx = await extractFileContext(
      makeZipFile(
        {
          'xl/sharedStrings.xml': '<sst><si><t>Treaty</t></si><si><t>Binding</t></si></sst>',
          'xl/worksheets/sheet1.xml':
            '<worksheet><sheetData><row><c t="s"><v>0</v></c><c t="s"><v>1</v></c></row></sheetData></worksheet>',
        },
        'matrix.xlsx'
      )
    );
    expect(xlsx.kind).toBe('doc');
    expect(xlsx.content).toContain('Treaty');
    expect(xlsx.content).toContain('Binding');
  });
});
