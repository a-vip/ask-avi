// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { KnowledgeDrawer, JUST_PUBLISHED_FILTER } from '../src/components/KnowledgeDrawer';
import { MessageBubble } from '../src/components/MessageBubble';
import { Sidebar } from '../src/components/Sidebar';
import { TopBar } from '../src/components/TopBar';
import { WelcomeScreen } from '../src/components/WelcomeScreen';
import { getEligibleGreetings, resolveVisitorSignals } from '../src/data/greetings';
import { buildFinalContinuityBrief, classifyQueryComplexity } from '../src/engine/deliberation';
import { knowledgeIndex } from '../src/engine/rag';
import type { ChatMessage, ChatThread } from '../src/types/chat';
import { loadThreads, mergeThreadLists, saveThreads } from '../src/utils/storage';

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

  it('merges local and remote thread lists without dropping newer messages and isolates account-scoped storage', () => {
    const olderThread: ChatThread = {
      id: 'th-shared',
      title: 'Initial',
      createdAt: 1000,
      updatedAt: 2000,
      messages: [
        { id: 'u1', role: 'user', content: 'Q1', createdAt: 1000 },
        { id: 'a1', role: 'assistant', content: 'A1', createdAt: 2000 },
      ],
    };
    const fullerRemoteThread: ChatThread = {
      id: 'th-shared',
      title: 'Follow-up Discussion',
      createdAt: 1000,
      updatedAt: 4000,
      pinned: true,
      messages: [
        { id: 'u1', role: 'user', content: 'Q1', createdAt: 1000 },
        { id: 'a1', role: 'assistant', content: 'A1', createdAt: 2000 },
        { id: 'u2', role: 'user', content: 'Q2', createdAt: 3000 },
        { id: 'a2', role: 'assistant', content: 'A2', createdAt: 4000 },
      ],
    };
    const remoteOnlyThread: ChatThread = {
      id: 'th-remote-only',
      title: 'Saved on phone',
      createdAt: 1500,
      updatedAt: 3500,
      messages: [
        { id: 'u3', role: 'user', content: 'Hello', createdAt: 1500 },
        { id: 'a3', role: 'assistant', content: 'Hi', createdAt: 3500 },
      ],
    };

    const merged = mergeThreadLists([olderThread], [fullerRemoteThread, remoteOnlyThread]);
    expect(merged.map((t) => t.id)).toEqual(['th-shared', 'th-remote-only']);
    expect(merged[0].messages).toHaveLength(4);
    expect(merged[0].pinned).toBe(true);

    // Account-scoped storage isolation + legacy migration
    localStorage.setItem('ask_avi_threads_v1', JSON.stringify([olderThread]));
    const aliceMigrated = loadThreads('Alice@Example.com');
    expect(aliceMigrated).toHaveLength(1);
    expect(localStorage.getItem('ask_avi_threads_v1')).toBeNull();
    expect(localStorage.getItem('ask_avi_threads_v1:alice@example.com')).not.toBeNull();

    saveThreads([remoteOnlyThread], 'bob@example.com');
    expect(loadThreads('bob@example.com')[0].id).toBe('th-remote-only');
    expect(loadThreads('alice@example.com')[0].id).toBe('th-shared');
    expect(loadThreads(null)).toEqual([]);
  });

  it('encourages guests to sign in to save chats across Sidebar and TopBar, while confirming sync when signed in', () => {
    const onOpenSignIn = vi.fn();

    const guestSidebar = mount(
      <Sidebar
        isOpen={true}
        isMobile={false}
        threads={[]}
        activeThreadId={null}
        theme="dark"
        userProfile={null}
        onCloseMobile={vi.fn()}
        onToggleCollapse={vi.fn()}
        onNewChat={vi.fn()}
        onSelectThread={vi.fn()}
        onRenameThread={vi.fn()}
        onPinThread={vi.fn()}
        onDeleteThread={vi.fn()}
        onOpenKnowledge={vi.fn()}
        onOpenSettings={vi.fn()}
        onToggleTheme={vi.fn()}
        onOpenHelp={vi.fn()}
        onOpenAbout={vi.fn()}
        onOpenSignIn={onOpenSignIn}
        onSignOut={vi.fn()}
      />
    );
    expect(guestSidebar.textContent).toContain('Save your chat history');
    expect(guestSidebar.textContent).toContain('Sign in to save chats');
    expect(guestSidebar.textContent).not.toContain('Your conversations are saved privately in this browser.');

    const saveBtn = guestSidebar.querySelector<HTMLButtonElement>('.sidebar-save-btn');
    act(() => {
      saveBtn?.click();
    });
    expect(onOpenSignIn).toHaveBeenCalledTimes(1);

    const signedInSidebar = mount(
      <Sidebar
        isOpen={true}
        isMobile={false}
        threads={[]}
        activeThreadId={null}
        theme="dark"
        userProfile={{ name: 'Avi Perera', email: 'workwithavip@gmail.com', isAdmin: true, signedInAt: 1 }}
        onCloseMobile={vi.fn()}
        onToggleCollapse={vi.fn()}
        onNewChat={vi.fn()}
        onSelectThread={vi.fn()}
        onRenameThread={vi.fn()}
        onPinThread={vi.fn()}
        onDeleteThread={vi.fn()}
        onOpenKnowledge={vi.fn()}
        onOpenSettings={vi.fn()}
        onToggleTheme={vi.fn()}
        onOpenHelp={vi.fn()}
        onOpenAbout={vi.fn()}
        onOpenSignIn={vi.fn()}
        onSignOut={vi.fn()}
      />
    );
    expect(signedInSidebar.querySelector('.sidebar-save-card')).toBeNull();
    expect(signedInSidebar.textContent).toContain('Saved to your account');

    const topBarGuest = mount(
      <TopBar
        sidebarOpen={false}
        theme="dark"
        isTemporaryChat={false}
        canExport={true}
        knowledgeOpen={false}
        isAuthenticated={false}
        hasMessages={true}
        onOpenSignIn={onOpenSignIn}
        onOpenSidebar={vi.fn()}
        onToggleTheme={vi.fn()}
        onToggleTemporary={vi.fn()}
        onExportChat={vi.fn()}
        onToggleKnowledge={vi.fn()}
      />
    );
    const topBarBtn = topBarGuest.querySelector<HTMLButtonElement>('.topbar-signin-save-btn');
    expect(topBarBtn?.textContent).toContain('Sign in to save chat');
    act(() => {
      topBarBtn?.click();
    });
    expect(onOpenSignIn).toHaveBeenCalledTimes(2);
  });

  it('defines theme-matched custom scrollbars (no native white scrollbar or arrows)', () => {
    const proc = (
      globalThis as unknown as {
        process?: {
          cwd: () => string;
          getBuiltinModule?: (id: string) => { readFileSync: (p: string, enc: string) => string };
        };
      }
    ).process;
    const fsMod = proc?.getBuiltinModule?.('node:fs');
    const cssText = fsMod?.readFileSync(`${proc!.cwd()}/src/styles/index.css`, 'utf8') ?? '';
    expect(cssText).toContain('color-scheme: dark;');
    expect(cssText).toContain('color-scheme: light;');
    expect(cssText).toContain('::-webkit-scrollbar-button');
    expect(cssText).toContain('.ag-thinking-body.live-scroll::-webkit-scrollbar');
  });
});
