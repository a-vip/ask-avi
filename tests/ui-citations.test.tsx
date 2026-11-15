// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { MessageBubble } from '../src/components/MessageBubble';
import type { ChatMessage } from '../src/types/chat';

describe('Unified Inline & Footer Citations in MessageBubble', () => {
  it('links unified archive [1] and web [2] pills and footer chips 1:1 with exact indices', () => {
    const msg: ChatMessage = {
      id: 'a-unified',
      role: 'assistant',
      content:
        'Structural governance demands verification [1], echoing treaty commentary [2].',
      createdAt: Date.now(),
      sources: [
        {
          index: 1,
          score: 12,
          matchedTerms: ['governance'],
          snippet: 'Relational accountability in AI.',
          entry: {
            id: 'essay-1',
            title: 'The Global Shell Game',
            category: 'Essay',
            date: '2025',
            url: 'https://aviperera.com/the-global-shell-game/',
            doi: '',
            keywords: [],
            summary: '',
            chunks: [],
          },
        },
      ],
      webSources: [
        {
          index: 2,
          title: 'Protocol I Article 36 — Wikipedia',
          url: 'https://en.wikipedia.org/wiki/Protocol_I',
          snippet: 'New weapons legal review requirement.',
        },
      ],
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <MessageBubble
          message={msg}
          isLastAssistant
          onEditUserMessage={vi.fn()}
          onRegenerate={vi.fn()}
          onFollowUpClick={vi.fn()}
          onFeedback={vi.fn()}
          onOpenSettings={vi.fn()}
          onOpenSignIn={vi.fn()}
          onSwitchToFreeEngine={vi.fn()}
          onInspectSource={vi.fn()}
        />
      );
    });

    const inlineLinks = Array.from(
      container.querySelectorAll<HTMLAnchorElement>('.markdown-prose a.cite-pill')
    );
    expect(inlineLinks.map((a) => [a.textContent?.trim(), a.getAttribute('href')])).toEqual([
      ['1', 'https://aviperera.com/the-global-shell-game/'],
      ['2', 'https://en.wikipedia.org/wiki/Protocol_I'],
    ]);

    const footerChips = Array.from(
      container.querySelectorAll<HTMLAnchorElement>('.inline-sources-strip a.source-chip-btn')
    );
    expect(footerChips.length).toBe(2);
    expect(footerChips[0]?.querySelector('.source-chip-num')?.textContent?.trim()).toBe('1');
    expect(footerChips[0]?.getAttribute('href')).toBe('https://aviperera.com/the-global-shell-game/');
    expect(footerChips[1]?.querySelector('.source-chip-num')?.textContent?.trim()).toBe('2');
    expect(footerChips[1]?.getAttribute('href')).toBe('https://en.wikipedia.org/wiki/Protocol_I');

    act(() => root.unmount());
    container.remove();
  });
});
