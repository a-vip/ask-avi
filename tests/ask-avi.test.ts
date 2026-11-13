// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildAviSystemPrompt, ENGINE_OPTIONS } from '../src/data/persona';
import {
  extractGeminiChunkDelta,
  mergeUniqueQueries,
  mergeUniqueWebSources,
} from '../src/engine/geminiStream';
import { resolveEffectiveProxyUrl } from '../src/engine/llmService';
import { knowledgeIndex, KNOWLEDGE_META } from '../src/engine/rag';
import { renderMarkdownToSafeHtml } from '../src/utils/markdown';
import { splitThinkingAndAnswer } from '../src/utils/thinking';
import {
  DEFAULT_SETTINGS,
  deriveThreadTitle,
  exportThreadAsMarkdown,
  groupThreadsByRecency,
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

describe('Gemini 3 & 4 Frontier Config, SSE Parser & Proxy Resolution', () => {
  it('defaults to Gemini 3 Flash with thinking & live web search enabled (no WebGPU/Instant Archive)', () => {
    expect(DEFAULT_SETTINGS.engineId).toBe('gemini-flash');
    expect(DEFAULT_SETTINGS.webSearchEnabled).toBe(true);
    expect(ENGINE_OPTIONS.map((e) => e.id)).toEqual(['gemini-flash', 'gemini-pro', 'custom-api']);
    expect(ENGINE_OPTIONS[0].geminiModelId).toBe('gemini-3-flash-preview');
    expect(ENGINE_OPTIONS[1].geminiModelId).toBe('gemini-4-hydrogen');
    expect(ENGINE_OPTIONS[0].thinkingBudget).toBe(8192);
    expect(ENGINE_OPTIONS[1].thinkingBudget).toBe(16384);
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
  it('converts valid inline [n] citations into clickable buttons and skips out-of-range numbers', () => {
    const html = renderMarkdownToSafeHtml(
      'Accountability requires verification [1] and intervention capacity [2], not [99].',
      2
    );
    expect(html).toContain('class="cite-pill" data-cite-idx="1"');
    expect(html).toContain('class="cite-pill" data-cite-idx="2"');
    expect(html).not.toContain('data-cite-idx="99"');
    expect(html).toContain('[99]');
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
});
