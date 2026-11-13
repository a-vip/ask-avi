// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { MessageBubble } from '../src/components/MessageBubble';
import { Sidebar } from '../src/components/Sidebar';
import { TopBar } from '../src/components/TopBar';
import { WelcomeScreen } from '../src/components/WelcomeScreen';
import { STARTER_PROMPTS } from '../src/data/persona';
import type { ChatMessage } from '../src/types/chat';

function mountTestElement(element: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(element);
  });
  return {
    container,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('Minimalist Frontier UI Upgrades', () => {
  it('places model switcher in composer bottom-right, uses Claude placeholder, and collapses suggestions behind toggle', () => {
    const { container, cleanup } = mountTestElement(
      <WelcomeScreen
        inputValue=""
        onInputChange={vi.fn()}
        onSubmitPrompt={vi.fn()}
        onStop={vi.fn()}
        isStreaming={false}
        engineId="oss-reasoning"
        webSearchEnabled
        onSelectEngine={vi.fn()}
        onToggleWebSearch={vi.fn()}
        onOpenSettings={vi.fn()}
        voiceStyle="standard"
        onChangeVoiceStyle={vi.fn()}
        attachedContext={null}
        onAttachContext={vi.fn()}
        onOpenDossierPicker={vi.fn()}
        inputRef={{ current: null }}
      />
    );

    const textarea = container.querySelector('textarea');
    expect(textarea?.getAttribute('placeholder')).toBe('How can I help you today?');

    const rightTools = container.querySelector('.composer-tools-right');
    expect(rightTools?.querySelector('.composer-model-btn')?.textContent).toContain('OSS Reasoning');

    expect(container.querySelector('.starter-grid')).toBeNull();
    const toggleBtn = container.querySelector<HTMLButtonElement>('.suggestions-toggle-btn');
    expect(toggleBtn?.textContent).toContain('Show suggestions');

    act(() => {
      toggleBtn?.click();
    });

    expect(toggleBtn?.textContent).toContain('Hide suggestions');
    expect(container.querySelectorAll('.starter-card').length).toBe(STARTER_PROMPTS.length);
    cleanup();
  });

  it('removes model menu from TopBar and omits model label from assistant chat bubbles', () => {
    const topbar = mountTestElement(
      <TopBar
        sidebarOpen={false}
        theme="dark"
        isTemporaryChat={false}
        canExport={false}
        knowledgeOpen={false}
        onOpenSidebar={vi.fn()}
        onToggleTheme={vi.fn()}
        onToggleTemporary={vi.fn()}
        onExportChat={vi.fn()}
        onToggleKnowledge={vi.fn()}
      />
    );
    expect(topbar.container.querySelector('.model-switcher')).toBeNull();
    topbar.cleanup();

    const assistantMsg: ChatMessage = {
      id: 'a-1',
      role: 'assistant',
      content: 'Accountability starts with structural incentives.',
      modelLabel: 'openai/gpt-oss-120b (Groq Free)',
      createdAt: Date.now(),
    };
    const bubble = mountTestElement(
      <MessageBubble
        message={assistantMsg}
        isLastAssistant
        onEditUserMessage={vi.fn()}
        onRegenerate={vi.fn()}
        onFollowUpClick={vi.fn()}
        onInspectSource={vi.fn()}
        onFeedback={vi.fn()}
        onOpenSettings={vi.fn()}
      />
    );
    expect(bubble.container.textContent).toContain('Ask Avi');
    expect(bubble.container.querySelector('.msg-model-badge')).toBeNull();
    expect(bubble.container.textContent).not.toContain('gpt-oss-120b');
    expect(bubble.container.textContent).not.toContain('Groq Free');
    bubble.cleanup();
  });

  it('renders Claude-style bottom-left account menu with Settings, Get help, Learn more, and Sign in', () => {
    const { container, cleanup } = mountTestElement(
      <Sidebar
        isOpen
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
        onOpenSignIn={vi.fn()}
        onSignOut={vi.fn()}
      />
    );

    expect(container.querySelector('.engine-status-pill')).toBeNull();
    const trigger = container.querySelector<HTMLButtonElement>('.account-trigger-btn');
    expect(trigger?.textContent).toContain('Guest');
    expect(trigger?.textContent).toContain('Free');

    act(() => {
      trigger?.click();
    });

    const menuText = container.querySelector('.account-popover-menu')?.textContent ?? '';
    expect(menuText).toContain('Settings');
    expect(menuText).toContain('Get help');
    expect(menuText).toContain('Learn more');
    expect(menuText).toContain('Sign in');
    cleanup();
  });
});
