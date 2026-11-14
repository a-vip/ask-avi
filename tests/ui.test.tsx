// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { SignInModal } from '../src/components/AccountDialogs';
import { Composer } from '../src/components/Composer';
import { MessageBubble } from '../src/components/MessageBubble';
import { SettingsModal } from '../src/components/SettingsModal';
import { Sidebar } from '../src/components/Sidebar';
import { TopBar } from '../src/components/TopBar';
import { WelcomeScreen } from '../src/components/WelcomeScreen';
import { STARTER_PROMPTS } from '../src/data/persona';
import type { ChatMessage } from '../src/types/chat';
import { DEFAULT_SETTINGS } from '../src/utils/storage';

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

    const headingLines = container.querySelectorAll('.welcome-heading-line');
    expect(headingLines.length).toBe(2);
    expect(headingLines[1]?.textContent?.trim()).toBe('Ask Avi anything.');

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
    expect(bubble.container.querySelector('.msg-speaker-name')?.textContent).toBe('Avi');
    expect(bubble.container.textContent).not.toContain('Ask Avi');
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

  it('uses updated AI disclaimer in composer and hides API controls from non-admin users', () => {
    const composer = mountTestElement(
      <Composer
        value=""
        onChange={vi.fn()}
        onSubmit={vi.fn()}
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
      />
    );
    expect(composer.container.querySelector('.composer-disclaimer')?.textContent).toBe(
      'Ask Avi is AI and can make mistakes. Please double-check responses.'
    );
    composer.cleanup();

    const guestSettings = mountTestElement(
      <SettingsModal
        isOpen
        settings={DEFAULT_SETTINGS}
        userProfile={null}
        onClose={vi.fn()}
        onUpdateSettings={vi.fn()}
        onToggleTheme={vi.fn()}
      />
    );
    expect(guestSettings.container.textContent).toContain('Appearance');
    expect(guestSettings.container.textContent).not.toContain('Admin & Analytics');
    expect(guestSettings.container.textContent).not.toContain('APIs & Deployment');
    expect(guestSettings.container.textContent).not.toContain('Groq Free Key');
    guestSettings.cleanup();

    const spoofedSettings = mountTestElement(
      <SettingsModal
        isOpen
        settings={DEFAULT_SETTINGS}
        userProfile={{
          name: 'Spoofer',
          email: 'other@example.com',
          isAdmin: true,
          signedInAt: 1,
        }}
        onClose={vi.fn()}
        onUpdateSettings={vi.fn()}
      />
    );
    expect(spoofedSettings.container.textContent).not.toContain('Admin & Analytics');
    expect(spoofedSettings.container.textContent).not.toContain('APIs & Deployment');
    spoofedSettings.cleanup();

    const adminSettings = mountTestElement(
      <SettingsModal
        isOpen
        settings={DEFAULT_SETTINGS}
        userProfile={{
          name: 'Avi Perera',
          email: 'workwithavip@gmail.com',
          provider: 'google',
          isAdmin: true,
          signedInAt: 1,
        }}
        onClose={vi.fn()}
        onUpdateSettings={vi.fn()}
      />
    );
    expect(adminSettings.container.textContent).toContain('Admin & Analytics');
    expect(adminSettings.container.textContent).toContain('APIs & Deployment');
    adminSettings.cleanup();

    const adminDevSettings = mountTestElement(
      <SettingsModal
        isOpen
        initialTab="developer"
        settings={DEFAULT_SETTINGS}
        userProfile={{
          name: 'Avi Perera',
          email: 'workwithavip@gmail.com',
          provider: 'wordpress',
          isAdmin: true,
          signedInAt: 1,
        }}
        authConfig={{
          ok: true,
          googleEnabled: false,
          googleClientId: '',
          wpSsoEnabled: true,
          wpAdminUrl: 'https://aviperera.com/wp-admin/admin.php?page=ask-avi-admin',
          hasAdminPasscode: true,
          currentUser: null,
        }}
        onClose={vi.fn()}
        onUpdateSettings={vi.fn()}
      />
    );
    expect(adminDevSettings.container.textContent).toContain(
      'Live Server Keys for All Public Visitors'
    );
    expect(adminDevSettings.container.textContent).toContain('Save Keys to Live Website Server');
    expect(adminDevSettings.container.textContent).toContain('WP Admin Dashboard');
    adminDevSettings.cleanup();
  });

  it('renders polished stacked auth form inputs with password toggle in SignInModal', () => {
    const { container, cleanup } = mountTestElement(
      <SignInModal
        isOpen
        currentProfile={null}
        proxyUrl="./api/chat"
        authConfig={{
          ok: true,
          googleEnabled: false,
          googleClientId: '',
          wpSsoEnabled: true,
          wpLoginUrl: 'https://aviperera.com/wp-login.php',
          hasAdminPasscode: true,
          currentUser: null,
        }}
        onClose={vi.fn()}
        onSignIn={vi.fn()}
        onSignOut={vi.fn()}
      />
    );

    expect(container.querySelector('.auth-form')).toBeTruthy();
    expect(container.querySelectorAll('.auth-field').length).toBe(2);
    expect(container.querySelectorAll('.auth-input-wrap').length).toBe(2);

    const passwordInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="Enter your password"]'
    );
    const toggleBtn = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Show password"]'
    );
    expect(passwordInput?.type).toBe('password');
    expect(toggleBtn).toBeTruthy();

    act(() => {
      toggleBtn?.click();
    });
    expect(passwordInput?.type).toBe('text');
    expect(container.querySelector('button[aria-label="Hide password"]')).toBeTruthy();

    const signupTab = Array.from(container.querySelectorAll<HTMLButtonElement>('.auth-mode-tab')).find(
      (b) => b.textContent?.includes('Create account')
    );
    act(() => {
      signupTab?.click();
    });

    expect(container.querySelectorAll('.auth-field').length).toBe(3);
    expect(container.querySelector('.auth-optin-card')).toBeTruthy();
    expect(container.textContent).toContain('Continue with aviperera.com WordPress');
    cleanup();
  });

  it('hides admin API setup buttons from public visitors when backend setup is incomplete', () => {
    const setupMsg: ChatMessage = {
      id: 'msg-setup',
      role: 'assistant',
      content: 'Live server API keys are not configured yet.',
      createdAt: Date.now(),
      needsBackendSetup: true,
    };
    const guestBubble = mountTestElement(
      <MessageBubble
        message={setupMsg}
        isLastAssistant
        isAdmin={false}
        onEditUserMessage={vi.fn()}
        onRegenerate={vi.fn()}
        onFollowUpClick={vi.fn()}
        onInspectSource={vi.fn()}
        onFeedback={vi.fn()}
        onOpenSettings={vi.fn()}
      />
    );
    expect(guestBubble.container.textContent).toContain(
      'Ask Avi could not reach the response service right now.'
    );
    expect(guestBubble.container.textContent).not.toContain('Open Admin API Settings');
    expect(guestBubble.container.textContent).not.toContain('Cloudflare');
    guestBubble.cleanup();
  });

  it('locks Gemini models when signed out, unlocks when authenticated, and shows multi-context chips', () => {
    const onSelectEngine = vi.fn();
    const onRequireSignIn = vi.fn();
    const onAttachContexts = vi.fn();

    const guestComposer = mountTestElement(
      <Composer
        value=""
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        onStop={vi.fn()}
        isStreaming={false}
        engineId="oss-reasoning"
        webSearchEnabled
        onSelectEngine={onSelectEngine}
        onToggleWebSearch={vi.fn()}
        onOpenSettings={vi.fn()}
        voiceStyle="standard"
        onChangeVoiceStyle={vi.fn()}
        attachedContexts={[
          { id: 'c1', title: 'SovDash Dossier', content: 'System architecture notes', kind: 'dossier' },
          { id: 'c2', title: 'Geneva Brief', content: 'Public IHL brief excerpt', kind: 'link', sourceUrl: 'https://example.com' },
        ]}
        onAttachContexts={onAttachContexts}
        onOpenDossierPicker={vi.fn()}
        isAuthenticated={false}
        onRequireSignIn={onRequireSignIn}
      />
    );

    expect(guestComposer.container.querySelectorAll('.attached-chip').length).toBe(2);
    expect(guestComposer.container.querySelector('.attached-budget-pill')?.textContent).toContain('2/4');
    expect(guestComposer.container.textContent).toContain('DOSSIER');
    expect(guestComposer.container.textContent).toContain('LINK');

    const removeFirst = guestComposer.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove attachment SovDash Dossier"]'
    );
    act(() => {
      removeFirst?.click();
    });
    expect(onAttachContexts).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'c2', title: 'Geneva Brief' }),
    ]);

    const contextTrigger = Array.from(
      guestComposer.container.querySelectorAll<HTMLButtonElement>('.tool-chip-btn')
    ).find((b) => b.textContent?.includes('Context'));
    act(() => {
      contextTrigger?.click();
    });
    expect(guestComposer.container.textContent).toContain('Upload PDF, Docs, Slides, Text');
    expect(guestComposer.container.textContent).toContain('Add web link (URL)');

    const modelBtn = guestComposer.container.querySelector<HTMLButtonElement>('.composer-model-btn');
    act(() => {
      modelBtn?.click();
    });

    const geminiOpt = Array.from(
      guestComposer.container.querySelectorAll<HTMLButtonElement>('.model-option')
    ).find((b) => b.textContent?.includes('Gemini 3 Flash'));
    expect(geminiOpt?.classList.contains('locked')).toBe(true);
    expect(geminiOpt?.textContent).toContain('Sign in');

    act(() => {
      geminiOpt?.click();
    });
    expect(onRequireSignIn).toHaveBeenCalledWith('gemini-flash');
    expect(onSelectEngine).not.toHaveBeenCalled();
    guestComposer.cleanup();

    const authedOnSelect = vi.fn();
    const authedComposer = mountTestElement(
      <Composer
        value=""
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        onStop={vi.fn()}
        isStreaming={false}
        engineId="oss-reasoning"
        webSearchEnabled
        onSelectEngine={authedOnSelect}
        onToggleWebSearch={vi.fn()}
        onOpenSettings={vi.fn()}
        voiceStyle="standard"
        onChangeVoiceStyle={vi.fn()}
        attachedContexts={[]}
        onAttachContexts={vi.fn()}
        onOpenDossierPicker={vi.fn()}
        isAuthenticated
        onRequireSignIn={vi.fn()}
      />
    );

    act(() => {
      authedComposer.container.querySelector<HTMLButtonElement>('.composer-model-btn')?.click();
    });
    const authedGemini = Array.from(
      authedComposer.container.querySelectorAll<HTMLButtonElement>('.model-option')
    ).find((b) => b.textContent?.includes('Gemini 3 Flash'));
    expect(authedGemini?.classList.contains('locked')).toBe(false);
    act(() => {
      authedGemini?.click();
    });
    expect(authedOnSelect).toHaveBeenCalledWith('gemini-flash');
    authedComposer.cleanup();
  });

  it('renders auth prompt banner and actionable buttons for needsAuth messages and pendingNotice', () => {
    const onOpenSignIn = vi.fn();
    const onSwitchToFreeEngine = vi.fn();
    const msg: ChatMessage = {
      id: 'm-auth',
      role: 'assistant',
      content: 'Sign in or create a free account to unlock Google Gemini models.',
      createdAt: Date.now(),
      needsAuth: true,
    };
    const bubble = mountTestElement(
      <MessageBubble
        message={msg}
        isLastAssistant
        onEditUserMessage={vi.fn()}
        onRegenerate={vi.fn()}
        onFollowUpClick={vi.fn()}
        onInspectSource={vi.fn()}
        onFeedback={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenSignIn={onOpenSignIn}
        onSwitchToFreeEngine={onSwitchToFreeEngine}
      />
    );
    expect(bubble.container.textContent).toContain('Sign in to unlock Gemini');
    expect(bubble.container.textContent).toContain('Use Free Open-Source');
    act(() => {
      Array.from(bubble.container.querySelectorAll<HTMLButtonElement>('button'))
        .find((b) => b.textContent?.includes('Sign in to unlock Gemini'))
        ?.click();
      Array.from(bubble.container.querySelectorAll<HTMLButtonElement>('button'))
        .find((b) => b.textContent?.includes('Use Free Open-Source'))
        ?.click();
    });
    expect(onOpenSignIn).toHaveBeenCalledTimes(1);
    expect(onSwitchToFreeEngine).toHaveBeenCalledTimes(1);
    bubble.cleanup();

    const noticeModal = mountTestElement(
      <SignInModal
        isOpen
        currentProfile={null}
        pendingNotice="Sign in to unlock Google Gemini models."
        onClose={vi.fn()}
        onSignIn={vi.fn()}
        onSignOut={vi.fn()}
      />
    );
    expect(noticeModal.container.querySelector('.auth-pending-notice')?.textContent).toContain(
      'Sign in to unlock Google Gemini models.'
    );
    noticeModal.cleanup();
  });
});
