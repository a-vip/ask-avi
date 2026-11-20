// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import App from '../src/App';

function makeOpenAiSseResponse(answerText: string, thoughtText = 'Analysing the exact question.'): Response {
  const chunks = [
    `data: ${JSON.stringify({ choices: [{ delta: { reasoning: thoughtText } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: { content: answerText } }] })}\n\n`,
    'data: [DONE]\n\n',
  ];
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
      'X-Ask-Avi-Model': 'openai/gpt-oss-120b',
    },
  });
}

async function waitForCondition(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for multi-turn test condition');
    }
    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
    });
  }
}

describe('App Multi-Turn Conversation Flow', () => {
  beforeEach(() => {
    localStorage.clear();
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('preserves full prior messages and runs multi-stage deliberation across manual follow-ups, chip follow-ups, retry, and edit', async () => {
    const chatPayloads: Array<{
      phase?: string;
      continuityBrief?: string;
      reasoningSynthesis?: string;
      contents?: Array<{ role: string; parts: Array<{ text: string }> }>;
      archiveBlock?: string;
      webContext?: string;
    }> = [];

    let finalTurn = 0;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('api/auth')) {
        return new Response(JSON.stringify({ currentUser: null, providers: {} }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('en.wikipedia.org')) {
        return new Response(
          JSON.stringify({
            query: {
              pages: {
                '1': {
                  title: 'Baruch Spinoza',
                  fullurl: 'https://en.wikipedia.org/wiki/Baruch_Spinoza',
                  extract: 'Baruch Spinoza examined conatus, causal necessity, and political power in Ethics.',
                },
                '2': {
                  title: 'Isaac Newton',
                  fullurl: 'https://en.wikipedia.org/wiki/Isaac_Newton',
                  extract: 'Sir Isaac Newton formulated classical mechanics and optics.',
                },
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('api.openalex.org') || url.includes('crossref.org')) {
        return new Response(JSON.stringify({ results: [], message: { items: [] } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('api/chat')) {
        const parsed = JSON.parse(String(init?.body ?? '{}')) as {
          phase?: string;
          continuityBrief?: string;
          reasoningSynthesis?: string;
          contents?: Array<{ role: string; parts: Array<{ text: string }> }>;
          archiveBlock?: string;
          webContext?: string;
        };
        chatPayloads.push(parsed);

        if (parsed.phase === 'deliberate') {
          const promptText = parsed.contents?.[0]?.parts?.[0]?.text ?? '';
          if (promptText.includes('analytical research planner')) {
            return makeOpenAiSseResponse(
              JSON.stringify({
                coreQuestion: 'Examine relational power, causal necessity, and legal accountability.',
                conversationShift: finalTurn > 0 ? 'deepening' : 'initial',
                priorCommitments: finalTurn > 0 ? 'Established Spinozist relational power.' : '',
                angles: ['Relational conatus vs command models', 'Enforceable Article 36 constraints'],
                archiveQueries: ['Spinoza meaningful human control'],
                webQueries: ['Spinoza conatus power ethics'],
              }),
              ''
            );
          }
          if (promptText.includes('first-principles investigation')) {
            return makeOpenAiSseResponse(
              'Examining first-principles causal architecture and legal enforceability.\nSEARCH_FOLLOWUP: International Humanitarian Law Article 36',
              ''
            );
          }
          return makeOpenAiSseResponse(
            'Checking counter-arguments: legal norms require clear evidentiary thresholds.',
            ''
          );
        }

        finalTurn += 1;
        return makeOpenAiSseResponse(`Reply number ${finalTurn} citing [1].`);
      }
      return new Response('{}', { status: 200 });
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
    });

    const getFinalCalls = () => chatPayloads.filter((p) => (p.phase ?? 'final') === 'final');

    // Default initial thinking effort is Fast with a concise reminder to upgrade
    expect(container.querySelector('.effort-chip-btn')?.textContent).toContain('Fast');
    const deepHintBtn = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.effort-hint-link')
    ).find((b) => b.textContent?.includes('Deep Reasoning'));
    expect(deepHintBtn).toBeDefined();
    await act(async () => {
      deepHintBtn!.click();
    });
    expect(container.querySelector('.effort-chip-btn')?.textContent).toContain('Deep Reasoning');

    // Turn 1 via WelcomeScreen textarea + button click
    const textarea1 = container.querySelector('textarea')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(textarea1, 'What draws you to Spinoza on technology and power?');
      textarea1.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.send-btn')!.click();
    });
    await waitForCondition(() => getFinalCalls().length === 1 && !container.querySelector('.stop-btn'));

    // Uncited exploratory web hits (like Isaac Newton / Baruch Spinoza) must NOT leak into footer when only [1] is cited
    const turn1FooterText = container.querySelector('.inline-sources-strip')?.textContent ?? '';
    expect(turn1FooterText).not.toContain('Isaac Newton');
    expect(container.querySelectorAll('.inline-sources-strip .source-chip-btn').length).toBeLessThanOrEqual(1);

    // Turn 2 via manual input + Enter
    const textarea2 = container.querySelector('textarea')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(textarea2, 'Where does Spinoza break down under International Humanitarian Law?');
      textarea2.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      textarea2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await waitForCondition(() => getFinalCalls().length === 2 && !container.querySelector('.stop-btn'));

    // Turn 3 via follow-up chip click
    const chips = container.querySelectorAll<HTMLButtonElement>('.followup-chip');
    expect(chips.length).toBeGreaterThan(0);
    const chip = chips[chips.length - 1]!;
    const chipText = chip.textContent ?? '';
    await act(async () => {
      chip.click();
    });
    await waitForCondition(() => getFinalCalls().length === 3 && !container.querySelector('.stop-btn'));

    const deliberateCalls = chatPayloads.filter((p) => p.phase === 'deliberate');
    const finalCalls = getFinalCalls();
    expect(deliberateCalls.length).toBeGreaterThanOrEqual(6);
    expect(finalCalls.length).toBe(3);

    // Confirm Turn 2 deliberation stages received Turn 1 history context
    const firstFinalIdx = chatPayloads.findIndex((p) => (p.phase ?? 'final') === 'final');
    const turn2DelibPayloads = chatPayloads.slice(firstFinalIdx + 1).filter((p) => p.phase === 'deliberate');
    expect(turn2DelibPayloads.length).toBeGreaterThanOrEqual(2);
    expect(turn2DelibPayloads[0]?.contents?.[0]?.parts?.[0]?.text ?? '').toContain(
      'What draws you to Spinoza on technology and power?'
    );

    const call2 = finalCalls[1]?.contents ?? [];
    expect(call2.map((c) => c.role)).toEqual(['user', 'model', 'user']);
    expect(call2[2]?.parts[0]?.text).toContain('International Humanitarian Law');
    expect(finalCalls[1]?.continuityBrief).toContain('Ongoing dialogue shift');
    expect(finalCalls[1]?.reasoningSynthesis).toBeTruthy();

    const call3 = finalCalls[2]?.contents ?? [];
    expect(call3.map((c) => c.role)).toEqual(['user', 'model', 'user', 'model', 'user']);
    expect(call3[4]?.parts[0]?.text).toBe(chipText);

    const userBubbles = container.querySelectorAll('.msg-user-bubble');
    const assistantBubbles = container.querySelectorAll('.msg-assistant-row');
    expect(userBubbles.length).toBe(3);
    expect(assistantBubbles.length).toBe(3);

    // Retry Turn 3 and confirm prior Turn 1 + Turn 2 + Turn 3 user query are all preserved
    const retryButtons = container.querySelectorAll<HTMLButtonElement>('button[title="Regenerate response"]');
    expect(retryButtons.length).toBe(3);
    await act(async () => {
      retryButtons[2]!.click();
    });
    await waitForCondition(() => getFinalCalls().length === 4 && !container.querySelector('.stop-btn'));
    const retryCall = getFinalCalls()[3]?.contents ?? [];
    expect(retryCall.map((c) => c.role)).toEqual(['user', 'model', 'user', 'model', 'user']);
    expect(retryCall[4]?.parts[0]?.text).toBe(chipText);

    // Edit Turn 2 prompt and confirm history slices cleanly after Turn 1 assistant
    const editTriggers = container.querySelectorAll<HTMLButtonElement>('button[aria-label="Edit prompt"]');
    expect(editTriggers.length).toBe(3);
    await act(async () => {
      editTriggers[1]!.click();
    });
    const editArea = container.querySelector<HTMLTextAreaElement>('.msg-edit-box textarea')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(editArea, 'Edited turn 2: compare Spinoza with Hobbes on state coercion.');
      editArea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.msg-edit-actions .btn-primary-sm')!.click();
    });
    await waitForCondition(() => getFinalCalls().length === 5 && !container.querySelector('.stop-btn'));
    const editCall = getFinalCalls()[4]?.contents ?? [];
    expect(editCall.map((c) => c.role)).toEqual(['user', 'model', 'user']);
    expect(editCall[2]?.parts[0]?.text).toContain('compare Spinoza with Hobbes');

    fetchSpy.mockRestore();
    act(() => root.unmount());
    container.remove();
  });
});
