// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { llmService } from '../src/engine/llmService';
import { separateLeakedCotFromAnswer } from '../src/utils/cotSeparator';
import { sanitizeThinkingTrace } from '../src/utils/thinking';

function buildChunkedSseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'X-Ask-Avi-Protocol': 'openai',
      'X-Ask-Avi-Model': 'nvidia/nemotron-3-ultra-550b-a55b:free',
    },
  });
}

describe('Chain-of-Thought & Post-Draft Critique Isolation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('strips leading untagged Thinking Process / Deconstruction / Drafting / Polishing AND trailing Self-Correction / Review against constraints', () => {
    const leaked = [
      'Thinking Process:',
      '',
      '1.  **Analyze the Request:**',
      '    *   Topic: Spinoza and AI power.',
      '2.  **Deconstruction:**',
      '    *   Monism, conatus, relational causality.',
      '3.  **Reasoning & Structure:**',
      '    *   Connect causal agency to verifiable governance.',
      '4.  **Drafting Response:**',
      '    *   Opening paragraph explaining why Spinoza feels contemporary.',
      '5.  **Refinement and Structure:**',
      '    *   Keep transitions crisp.',
      '6.  **Polishing:**',
      '    *   Ensure natural cadence.',
      '',
      'Spinoza appeals to me because he refuses the myth of isolated willpower.',
      '',
      'In modern AI systems, power sits inside causal bottlenecks—compute, incentives, and liability rules.',
      '',
      '---',
      '**Review against constraints:**',
      '- Direct first-person tone? Yes.',
      '- British English ("realise")? Yes.',
      '',
      '*Self-Correction:* Make sure I did not overclaim voluntary pledges.',
      '**Revised Plan:** Already sharp.',
      '**Final Polish:** Done.',
    ].join('\n');

    const sep = separateLeakedCotFromAnswer(leaked, { flushPartial: true });
    expect(sep.cleanAnswer).toBe(
      'Spinoza appeals to me because he refuses the myth of isolated willpower.\n\nIn modern AI systems, power sits inside causal bottlenecks—compute, incentives, and liability rules.'
    );
    expect(sep.cleanAnswer).not.toMatch(/thinking process|deconstruction|drafting response|refinement|polishing|review against constraints|self-correction|revised plan|final polish/i);
    expect(sep.extractedThinking).toContain('Analyze the Request');
    expect(sep.extractedThinking).toContain('Self-Correction');
  });

  it('keeps only the final version after an explicit Final Output / Final Response handoff marker', () => {
    const draftThenFinal = [
      'Thinking Process:',
      '1. **Analyze the Request:** Legal thresholds under Article 36.',
      '2. **Drafting the Response:**',
      'Article 36 is an old treaty clause that does things slowly.',
      '*Self-Correction:* That draft undersells dynamic software updates.',
      '3. **Revised Plan:** Contrast static munitions review with continuous ML weights.',
      '4. **Final Polish:**',
      '- Tighten paragraph 1.',
      '',
      '**Final Response:**',
      'Article 36 of Additional Protocol I binds states to determine whether new weapons violate international law before deployment—which breaks down when software updates alter targeting behaviour in the field.',
    ].join('\n');

    const sep = separateLeakedCotFromAnswer(draftThenFinal, { flushPartial: true });
    expect(sep.cleanAnswer).toBe(
      'Article 36 of Additional Protocol I binds states to determine whether new weapons violate international law before deployment—which breaks down when software updates alter targeting behaviour in the field.'
    );
    expect(sep.extractedThinking).toContain('Article 36 is an old treaty clause');
    expect(sep.extractedThinking).toContain('Revised Plan');

    const implicitDraftThenFinal = [
      'Thinking Process:',
      '1. **Analyze the Request:** Compare classical ethics with algorithmic systems.',
      '2. **Drafting Response:**',
      'Initial weak draft mentioning generic AI rules without structural grounding.',
      '*Self-Correction:* That draft is too superficial; ground it in causal architecture.',
      '3. **Final Polish:**',
      '- Sharpen contrast.',
      '',
      'Algorithmic systems do not operate outside nature; they reorganise human incentives and institutional accountability inside a continuous causal network.',
    ].join('\n');

    const implicitSep = separateLeakedCotFromAnswer(implicitDraftThenFinal, { flushPartial: true });
    expect(implicitSep.cleanAnswer).toBe(
      'Algorithmic systems do not operate outside nature; they reorganise human incentives and institutional accountability inside a continuous causal network.'
    );
    expect(implicitSep.extractedThinking).toContain('Initial weak draft');
  });

  it('extracts <|channel>thought, <|thought|>, and <think> tags while sparing fenced code and genuine headings', () => {
    const channelLeak =
      '<|channel>thought\nWeighing incentive structures inside procurement.\n<|channel>response\nAccountability has to sit in enforceable architecture.';
    const chSep = separateLeakedCotFromAnswer(channelLeak, { flushPartial: true });
    expect(chSep.cleanAnswer).toBe('Accountability has to sit in enforceable architecture.');
    expect(chSep.extractedThinking).toContain('Weighing incentive structures');

    const realEssayWithNumbers = [
      '1. **Causal continuity over isolated blame**',
      'Spinoza treats power relationally rather than locating agency in an unmoved will.',
      '',
      '```md',
      '<think>Example inside markdown fence</think>',
      '```',
    ].join('\n');
    const safeSep = separateLeakedCotFromAnswer(realEssayWithNumbers, { flushPartial: true });
    expect(safeSep.cleanAnswer).toBe(realEssayWithNumbers);
    expect(safeSep.extractedThinking).toBe('');

    const reasoningHeaderLeak = [
      '**Reasoning:**',
      '1. **Analyze the Request:** Causal limits of Article 36.',
      '2. **Drafting Response:** Outline key distinction.',
      '',
      'Article 36 demands continuous legal scrutiny whenever weapon targeting parameters shift.',
    ].join('\n');
    const rhSep = separateLeakedCotFromAnswer(reasoningHeaderLeak, { flushPartial: true });
    expect(rhSep.cleanAnswer).toBe(
      'Article 36 demands continuous legal scrutiny whenever weapon targeting parameters shift.'
    );
  });

  it('withholds COT preambles and partial meta headers while streaming without flickering into the answer', () => {
    const partial1 = separateLeakedCotFromAnswer('Thinking Pro', { flushPartial: false });
    expect(partial1.cleanAnswer).toBe('');
    expect(partial1.isHoldingBack).toBe(true);

    const partial2 = separateLeakedCotFromAnswer(
      'Thinking Process:\n\n1. **Analyze the Request:**\n   * Check incentives.',
      { flushPartial: false }
    );
    expect(partial2.cleanAnswer).toBe('');
    expect(partial2.isHoldingBack).toBe(true);

    const partial3 = separateLeakedCotFromAnswer(
      'Clear answer paragraph.\n\n**Review against',
      { flushPartial: false }
    );
    expect(partial3.cleanAnswer).toBe('Clear answer paragraph.');
  });

  it('separates inline COT leaks in llmService even when structured delta.reasoning already arrived earlier in the stream', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('wikipedia') || url.includes('openalex') || url.includes('crossref')) {
        return new Response(JSON.stringify({ results: [], query: { pages: {} }, message: { items: [] } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return buildChunkedSseResponse([
        `data: ${JSON.stringify({ choices: [{ delta: { reasoning: 'Weighing Spinoza and institutional power.' } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'Thinking ' } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'Process:\n1. **Deconstruction:**\n   * Causal web.\n2. **Drafting Response:**\n   * Frame directly.\n\n' } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'Spinoza treats human agency as insight into causal necessity.' } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: '\n\n**Self-Correction:**\nKeep it concise.\n**Final Polish:**\nClean.' } }] })}\n\n`,
        'data: [DONE]\n\n',
      ]);
    });

    const streamedUpdates: Array<{ content: string; isThinking: boolean }> = [];
    const result = await llmService.generateReply({
      query: 'How does Spinoza view technology and agency?',
      history: [],
      engineId: 'oss-fast',
      voiceStyle: 'standard',
      webSearchEnabled: false,
      proxyUrl: 'https://proxy.test/api/chat',
      onUpdate: (u) => {
        streamedUpdates.push({ content: u.content, isThinking: u.isThinking });
      },
    });

    // No intermediate update ever flashed COT headings into visible answer content
    for (const u of streamedUpdates) {
      expect(u.content).not.toMatch(/thinking process|deconstruction|drafting response|self-correction|final polish/i);
    }

    expect(result.content).toBe('Spinoza treats human agency as insight into causal necessity.');
    expect(sanitizeThinkingTrace(result.thoughts, true)).toContain('Weighing Spinoza and institutional power.');
  });
});
