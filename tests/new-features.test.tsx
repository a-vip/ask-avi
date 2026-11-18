// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { KnowledgeDrawer, JUST_PUBLISHED_FILTER } from '../src/components/KnowledgeDrawer';
import { MessageBubble } from '../src/components/MessageBubble';
import { WelcomeScreen } from '../src/components/WelcomeScreen';
import { getEligibleGreetings, resolveVisitorSignals } from '../src/data/greetings';
import { buildFinalContinuityBrief, classifyQueryComplexity } from '../src/engine/deliberation';
import { knowledgeIndex } from '../src/engine/rag';
import type { ChatMessage } from '../src/types/chat';

describe('Ask Avi v20261119a feature suite', () => {
  const roots: Array<{ root: Root; container: HTMLDivElement }> = [];

  const mount = (node: React.ReactNode) => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push({ root, container });
    act(() => {
      root.render(node);
    });
    return container;
  };

  afterEach(() => {
    while (roots.length > 0) {
      const item = roots.pop()!;
      act(() => item.root.unmount());
      item.container.remove();
    }
    localStorage.clear();
    sessionStorage.clear();
  });

  it('ingests live WordPress posts into KnowledgeIndex and surfaces "Just Published" ONLY inside KnowledgeDrawer (never on WelcomeScreen)', () => {
    const inserted = knowledgeIndex.upsertEntries([
      {
        id: 'wp-post-99991',
        title: 'Treaty Verification Under Continuous Software Updates',
        category: 'LAWS & IHL',
        date: '2026-11-18',
        url: 'https://aviperera.com/treaty-verification-continuous-updates/',
        doi: '',
        keywords: ['article 36', 'continuous updates', 'verification'],
        summary: 'Analysis of legal compliance challenges when adaptive software weights shift post-deployment.',
        chunks: [
          'Continuous model weight updates undermine static Article 36 weapons review assumptions unless re-verification hooks trigger automatically.',
        ],
        justPublished: true,
        liveIngested: true,
      },
    ]);
    expect(inserted).toBeGreaterThanOrEqual(1);

    const searchRes = knowledgeIndex.search('continuous model weight updates article 36', { topK: 4 });
    expect(searchRes.sources.some((s) => s.entry.id === 'wp-post-99991')).toBe(true);

    // Confirm WelcomeScreen keeps main view free of any "Just Published" UI clutter
    const welcome = mount(
      <WelcomeScreen
        inputValue=""
        onInputChange={vi.fn()}
        onSubmitPrompt={vi.fn()}
        onStop={vi.fn()}
        isStreaming={false}
        engineId="oss-reasoning"
        webSearchEnabled={true}
        onSelectEngine={vi.fn()}
        onToggleWebSearch={vi.fn()}
        onOpenSettings={vi.fn()}
        voiceStyle="standard"
        onChangeVoiceStyle={vi.fn()}
        onOpenDossierPicker={vi.fn()}
        inputRef={{ current: null }}
      />
    );
    expect(welcome.textContent).not.toContain('Just Published');

    // Confirm KnowledgeDrawer surfaces "Just Published" filter and badge
    const drawer = mount(
      <KnowledgeDrawer
        isOpen={true}
        activeSources={[]}
        focusIndex={null}
        initialTab="archive"
        onClose={vi.fn()}
        onAskAboutEntry={vi.fn()}
        onAttachEntry={vi.fn()}
      />
    );
    expect(drawer.textContent).toContain('AI Proxy Corpus');
    const justPubBtn = Array.from(drawer.querySelectorAll<HTMLButtonElement>('.drawer-cat-pill')).find(
      (b) => b.textContent?.includes(JUST_PUBLISHED_FILTER)
    );
    expect(justPubBtn).toBeDefined();
    act(() => {
      justPubBtn?.click();
    });
    expect(drawer.textContent).toContain('Treaty Verification Under Continuous Software Updates');
    expect(drawer.querySelector('.dossier-just-published-badge')?.textContent).toContain('Just Published');
  });

  it('displays Inline Citation Hover Preview card with exact supporting excerpt before tab-switching', () => {
    const msg: ChatMessage = {
      id: 'a-cite-1',
      role: 'assistant',
      createdAt: Date.now(),
      content: 'Voluntary pledges cannot substitute for binding legal architecture [1].',
      sources: [
        {
          index: 1,
          score: 12.4,
          matchedTerms: ['voluntary', 'architecture'],
          snippet: 'Control is not a button; it is a verifiable technical and legal architecture.',
          entry: {
            id: 'pillar-stance-ai',
            title: 'My Stance on Artificial Intelligence — Accountability Over Binary Hype',
            category: 'AI Governance',
            date: '2026-10-01',
            url: 'https://aviperera.com/stance/',
            doi: '',
            keywords: ['stance', 'governance'],
            summary: 'Accountability over binary hype.',
            chunks: [],
          },
        },
      ],
    };

    const container = mount(
      <MessageBubble
        message={msg}
        isLastAssistant={true}
        onEditUserMessage={vi.fn()}
        onRegenerate={vi.fn()}
        onFollowUpClick={vi.fn()}
        onInspectSource={vi.fn()}
        onFeedback={vi.fn()}
        onOpenSettings={vi.fn()}
      />
    );

    expect(container.querySelector('[data-testid="cite-hover-preview"]')).toBeNull();
    const pill = container.querySelector<HTMLElement>('.cite-pill[data-cite-idx="1"]');
    expect(pill).not.toBeNull();

    act(() => {
      pill!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });

    const preview = container.querySelector('[data-testid="cite-hover-preview"]');
    expect(preview).not.toBeNull();
    expect(preview?.textContent).toContain('Control is not a button; it is a verifiable technical and legal architecture.');
    expect(preview?.textContent).toContain('My Stance on Artificial Intelligence');
    expect(preview?.querySelector('a')?.getAttribute('href')).toBe('https://aviperera.com/stance/');
  });

  it('calibrates query complexity across trivial, focused-direct, and deep-deliberative tiers and renders active thinkingPhase', () => {
    expect(classifyQueryComplexity('Hello!', []).tier).toBe('fast-trivial');
    expect(classifyQueryComplexity('What is your email address?', []).tier).toBe('focused-direct');
    expect(
      classifyQueryComplexity('What draws you to Spinoza on technology and power?', []).tier
    ).toBe('deep-deliberative');

    const thinkingMsg: ChatMessage = {
      id: 'a-think-1',
      role: 'assistant',
      createdAt: Date.now() - 3200,
      content: '',
      thoughts: 'Checking essays…',
      thinkingPhase: 'Stress-testing counter-arguments & edge cases',
      isThinking: true,
      isStreaming: true,
    };

    const container = mount(
      <MessageBubble
        message={thinkingMsg}
        isLastAssistant={true}
        onEditUserMessage={vi.fn()}
        onRegenerate={vi.fn()}
        onFollowUpClick={vi.fn()}
        onInspectSource={vi.fn()}
        onFeedback={vi.fn()}
        onOpenSettings={vi.fn()}
      />
    );

    expect(container.querySelector('.ag-thinking-phase')?.textContent).toContain(
      'Stress-testing counter-arguments & edge cases'
    );
  });

  it('enforces tone-scoped humour suppression in serious registers and high-stakes legal/IHL queries', () => {
    const academicSignals = resolveVisitorSignals({
      now: new Date(2026, 10, 20, 2, 15, 0),
      timeZone: 'Europe/London',
      voiceStyle: 'academic',
      skipVisitTracking: true,
    });
    const academicIds = getEligibleGreetings(academicSignals).map((g) => g.id);
    expect(academicIds).not.toContain('wee-sleep-or-hubris');
    expect(academicIds).not.toContain('land-friday-escape');
    expect(academicIds).not.toContain('wit-spinoza-to-python');

    const standardSignals = resolveVisitorSignals({
      now: new Date(2026, 10, 20, 2, 15, 0),
      timeZone: 'Europe/London',
      voiceStyle: 'standard',
      skipVisitTracking: true,
    });
    const standardIds = getEligibleGreetings(standardSignals).map((g) => g.id);
    expect(standardIds).toContain('wee-sleep-or-hubris');

    const brief = buildFinalContinuityBrief({
      plan: {
        coreQuestion: 'How does Article 36 govern lethal autonomous targeting?',
        conversationShift: 'initial',
        priorCommitments: '',
        angles: [],
        archiveQueries: [],
        webQueries: [],
      },
      isFollowUp: false,
      round2Analysis: '',
      round3Critique: '',
      hasCandidates: false,
      voiceStyle: 'standard',
      query: 'How does Article 36 govern lethal autonomous targeting?',
    });
    expect(brief.continuityBrief).toContain('REGISTER GUARDRAIL');
  });

  it('shows Contextual Dispatch Opt-In card when a response detects a content gap or reaches turn 2+', () => {
    const gapMsg: ChatMessage = {
      id: 'a-gap-1',
      role: 'assistant',
      createdAt: Date.now(),
      content: 'Here is how I approach that question from first principles.',
      isContentGap: true,
      gapTopic: 'Quantum post-cryptography export controls',
      isStreaming: false,
    };

    const container = mount(
      <MessageBubble
        message={gapMsg}
        isLastAssistant={true}
        assistantTurnCount={1}
        onEditUserMessage={vi.fn()}
        onRegenerate={vi.fn()}
        onFollowUpClick={vi.fn()}
        onInspectSource={vi.fn()}
        onFeedback={vi.fn()}
        onOpenSettings={vi.fn()}
      />
    );

    const optIn = container.querySelector('[data-testid="contextual-dispatch-optin"]');
    expect(optIn).not.toBeNull();
    expect(optIn?.textContent).toContain('not yet covered in a full essay');
  });
});
