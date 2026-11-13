// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildAviSystemPrompt, ENGINE_OPTIONS } from '../src/data/persona';
import { knowledgeIndex, KNOWLEDGE_META } from '../src/engine/rag';
import { synthesizeInstantAviReply } from '../src/engine/instantSynthesizer';
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
    expect(sources.length).toBeLessThanOrEqual(5);

    const combinedText = sources
      .map((s) => `${s.entry.title} ${s.snippet}`.toLowerCase())
      .join(' ');
    expect(combinedText).toMatch(/meaningful human control|autonomous weapons|unidir|laws/);
  });

  it('retrieves Avi personal story dossier when asked about Harrow and imposter syndrome', () => {
    const { sources } = knowledgeIndex.search(
      'How did you overcome imposter syndrome growing up first-gen in Harrow London?'
    );
    expect(sources.length).toBeGreaterThan(0);
    const titlesAndSnippets = sources
      .map((s) => `${s.entry.title} ${s.snippet}`.toLowerCase())
      .join(' ');
    expect(titlesAndSnippets).toMatch(/harrow|imposter|cambridge|buckingham|evidence/);
  });

  it('handles unmatched nonsense queries gracefully without throwing', () => {
    const { sources } = knowledgeIndex.search('zxqvbnm12345nonexistenttoken');
    expect(Array.isArray(sources)).toBe(true);
    expect(sources.length).toBe(0);
  });
});

describe('Instant Archive Synthesizer', () => {
  it('generates grounded markdown with inline citations and follow-up prompts across voice styles', () => {
    const { sources } = knowledgeIndex.search(
      'Why do voluntary AI safety commitments fail compared to binding regulation?'
    );
    expect(sources.length).toBeGreaterThan(0);

    for (const style of ['standard', 'blunt', 'academic', 'mentor'] as const) {
      const reply = synthesizeInstantAviReply(
        'Why do voluntary AI safety commitments fail compared to binding regulation?',
        sources,
        style
      );
      expect(reply.markdown.length).toBeGreaterThan(80);
      expect(reply.markdown).toMatch(/\[1\]/);
      expect(reply.markdown).not.toContain('<script>');
      expect(reply.followUps.length).toBeGreaterThan(0);
    }
  });

  it('incorporates attached reading context when provided', () => {
    const { sources } = knowledgeIndex.search('UNIDIR AI governance accountability');
    const reply = synthesizeInstantAviReply(
      'Summarize what this means for deployment speed vs governance.',
      sources,
      'standard',
      {
        id: 'ctx-1',
        title: 'AI Policy Brief Draft',
        content: 'Organizations must run adversarial risk audits before shipping autonomous loops.',
      }
    );
    expect(reply.markdown.toLowerCase()).toContain('ai policy brief draft');
  });
});

describe('Safe Markdown & Citation Rendering', () => {
  it('converts valid inline [n] citations into clickable buttons and skips out-of-range numbers', () => {
    const html = renderMarkdownToSafeHtml(
      'Governance requires binding verification [1] and intervention capacity [2], not [99].',
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

  it('renders fenced code blocks with copy button metadata', () => {
    const html = renderMarkdownToSafeHtml('```ts\nconst answer = 42;\n```', 0);
    expect(html).toContain('code-copy-btn');
    expect(html).toContain('data-copy-code=');
  });
});

describe('Thread Storage & Export Helpers', () => {
  it('derives clean titles and truncates long prompts with ellipsis', () => {
    expect(deriveThreadTitle('   What is SovDash?  ')).toBe('What is SovDash?');
    expect(deriveThreadTitle('')).toBe('New conversation');
    const longPrompt =
      'Please explain the entire three-part architecture of Meaningful Human Control under International Humanitarian Law';
    const title = deriveThreadTitle(longPrompt);
    expect(title.length).toBeLessThanOrEqual(55);
    expect(title.endsWith('…')).toBe(true);
  });

  it('groups threads by pinned state and recency buckets', () => {
    const now = Date.now();
    const oneDay = 86_400_000;
    const threads: ChatThread[] = [
      { id: '1', title: 'Pinned', createdAt: now, updatedAt: now - 10 * oneDay, pinned: true, messages: [] },
      { id: '2', title: 'Today', createdAt: now, updatedAt: now - 1000, messages: [] },
      { id: '3', title: 'Yesterday', createdAt: now, updatedAt: now - oneDay, messages: [] },
      { id: '4', title: 'Older', createdAt: now, updatedAt: now - 30 * oneDay, messages: [] },
    ];
    const groups = groupThreadsByRecency(threads);
    expect(groups.map((g) => g.label)).toEqual(['Pinned', 'Today', 'Yesterday', 'Earlier']);
  });

  it('exports conversation threads as formatted markdown with citations', () => {
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
    expect(md).toContain('### You');
    expect(md).toContain('### Ask Avi');
    expect(md).toContain('**Sources:**');
  });
});

describe('Conversational Neural Prompting & Thinking Parser', () => {
  it('defaults to WebGPU Neural Deep engine and keeps WebGPU Neural Qwen 3B available', () => {
    expect(DEFAULT_SETTINGS.engineId).toBe('webgpu-deep');
    expect(ENGINE_OPTIONS[0].id).toBe('webgpu-deep');
    const qwen = ENGINE_OPTIONS.find((e) => e.id === 'webgpu-balanced');
    expect(qwen?.mlcModelId).toBe('Qwen2.5-3B-Instruct-q4f16_1-MLC');
  });

  it('omits archive reference section when no dossiers are retrieved', () => {
    const { sources } = knowledgeIndex.search('hi');
    expect(sources.length).toBe(0);

    const prompt = buildAviSystemPrompt('standard', sources);
    expect(prompt).toContain('<thought>');
    expect(prompt).not.toContain('OPTIONAL REFERENCE LINKS');
  });

  it('splits live streaming <thought> blocks and completed reasoning cleanly', () => {
    const partial = splitThinkingAndAnswer('<thought>Testing their premise first.');
    expect(partial.isThinking).toBe(true);
    expect(partial.thinking).toBe('Testing their premise first.');
    expect(partial.answer).toBe('');

    const done = splitThinkingAndAnswer(
      '<thought>They want a practical Python example, not an essay.</thought>\n\nHere is a clean pattern.'
    );
    expect(done.isThinking).toBe(false);
    expect(done.thinking).toBe('They want a practical Python example, not an essay.');
    expect(done.answer).toBe('Here is a clean pattern.');

    const untagged = splitThinkingAndAnswer('Direct answer without tags.');
    expect(untagged.isThinking).toBe(false);
    expect(untagged.thinking).toBe('');
    expect(untagged.answer).toBe('Direct answer without tags.');
  });
});
