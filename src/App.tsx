import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccountInfoModal, SignInModal } from './components/AccountDialogs';
import { Composer } from './components/Composer';
import { KnowledgeDrawer } from './components/KnowledgeDrawer';
import { MessageBubble } from './components/MessageBubble';
import { SettingsModal } from './components/SettingsModal';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { WelcomeScreen } from './components/WelcomeScreen';
import { BackendNotConfiguredError, llmService } from './engine/llmService';
import type {
  AppSettings,
  AttachedContext,
  ChatMessage,
  ChatThread,
  EngineId,
  KnowledgeEntry,
  RetrievedSource,
  UserProfile,
  VoiceStyle,
} from './types/chat';
import {
  applyThemeToDocument,
  deriveThreadTitle,
  exportThreadAsMarkdown,
  loadSettings,
  loadThreads,
  loadUserProfile,
  postParentBridgeEvent,
  saveSettings,
  saveThreads,
  saveUserProfile,
} from './utils/storage';

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export default function App() {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [threads, setThreads] = useState<ChatThread[]>(() => loadThreads());
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [tempThread, setTempThread] = useState<ChatThread | null>(null);
  const [isTemporaryChat, setIsTemporaryChat] = useState(false);

  const [inputValue, setInputValue] = useState('');
  const [attachedContext, setAttachedContext] = useState<AttachedContext | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);

  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 860 : false
  );
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === 'undefined') return true;
    const params = new URLSearchParams(window.location.search);
    if (params.get('embed') === '1') return false;
    return window.innerWidth > 860;
  });

  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<'cited' | 'archive'>('archive');
  const [drawerSources, setDrawerSources] = useState<RetrievedSource[]>([]);
  const [drawerFocusIdx, setDrawerFocusIdx] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(() => loadUserProfile());
  const [signInOpen, setSignInOpen] = useState(false);
  const [accountInfoMode, setAccountInfoMode] = useState<'help' | 'about' | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);

  const activeThread = useMemo(() => {
    if (isTemporaryChat) return tempThread;
    if (!activeThreadId) return null;
    return threads.find((t) => t.id === activeThreadId) ?? null;
  }, [isTemporaryChat, tempThread, activeThreadId, threads]);

  // Apply theme & persist settings
  useEffect(() => {
    applyThemeToDocument(settings.theme);
    saveSettings(settings);
    postParentBridgeEvent('theme-change', { theme: settings.theme });
  }, [settings]);

  // Persist saved threads
  useEffect(() => {
    saveThreads(threads);
  }, [threads]);

  // Signal parent iframe readiness + listen for host theme transitions
  useEffect(() => {
    postParentBridgeEvent('ready', { engine: settings.engineId });

    const onResize = () => setIsMobile(window.innerWidth <= 860);
    window.addEventListener('resize', onResize);

    const onMessage = (ev: MessageEvent) => {
      const data = ev.data as { type?: string; theme?: string } | null;
      if (data?.type === 'ask-avi:theme' && (data.theme === 'dark' || data.theme === 'light')) {
        const nextTheme = data.theme;
        setSettings((prev) => ({ ...prev, theme: nextTheme }));
      }
    };
    window.addEventListener('message', onMessage);

    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('message', onMessage);
    };
  }, []);

  // Keyboard shortcuts (/ to focus composer, Ctrl/Cmd+Shift+O for New Chat, Ctrl/Cmd+Shift+, for Settings)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        handleNewChat();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === ',' || e.code === 'Comma')) {
        e.preventDefault();
        setSettingsOpen(true);
        return;
      }
      if (e.key === 'Escape') {
        setSettingsOpen(false);
        setSignInOpen(false);
        setAccountInfoMode(null);
        return;
      }
      if (
        e.key === '/' &&
        document.activeElement?.tagName !== 'TEXTAREA' &&
        document.activeElement?.tagName !== 'INPUT'
      ) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    saveUserProfile(userProfile);
  }, [userProfile]);

  // Track whether user is near bottom during streaming
  const handleScrollContainer = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom < 140;
  };

  useEffect(() => {
    if (shouldAutoScrollRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: isStreaming ? 'auto' : 'smooth' });
    }
  }, [activeThread?.messages, isStreaming]);

  const updateThreadMessages = useCallback(
    (threadId: string, updater: (msgs: ChatMessage[]) => ChatMessage[], newTitle?: string) => {
      if (isTemporaryChat) {
        setTempThread((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            title: newTitle ?? prev.title,
            updatedAt: Date.now(),
            messages: updater(prev.messages),
          };
        });
        return;
      }

      setThreads((prev) =>
        prev
          .map((t) =>
            t.id === threadId
              ? {
                  ...t,
                  title: newTitle ?? t.title,
                  updatedAt: Date.now(),
                  messages: updater(t.messages),
                }
              : t
          )
          .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt - a.updatedAt)
      );
    },
    [isTemporaryChat]
  );

  const runAssistantTurn = useCallback(
    async (
      threadId: string,
      historyBeforeQuery: ChatMessage[],
      queryText: string,
      assistantMsgId: string,
      overrideEngineId?: EngineId,
      attached?: AttachedContext | null
    ) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setIsStreaming(true);
      shouldAutoScrollRef.current = true;

      const engineToUse = overrideEngineId ?? settings.engineId;

      try {
        const result = await llmService.generateReply({
          query: queryText,
          history: historyBeforeQuery,
          engineId: engineToUse,
          voiceStyle: settings.voiceStyle,
          webSearchEnabled: settings.webSearchEnabled,
          groqApiKey: settings.groqApiKey,
          openRouterApiKey: settings.openRouterApiKey,
          geminiApiKey: settings.geminiApiKey,
          proxyUrl: settings.proxyUrl,
          attachedContext: attached ?? undefined,
          customApi: settings.customApi,
          signal: controller.signal,
          onUpdate: (update) => {
            updateThreadMessages(threadId, (msgs) =>
              msgs.map((m) =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      content: update.content,
                      thoughts: update.thoughts,
                      isThinking: update.isThinking,
                      thinkingMs: update.thinkingMs,
                      webSearchQueries: update.webSearchQueries,
                      webSources: update.webSources,
                    }
                  : m
              )
            );
          },
        });

        updateThreadMessages(threadId, (msgs) =>
          msgs.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  content: result.content,
                  thoughts: result.thoughts,
                  isThinking: false,
                  thinkingMs: result.thinkingMs,
                  webSearchQueries: result.webSearchQueries,
                  webSources: result.webSources,
                  engineUsed: result.engineUsed,
                  modelLabel: result.modelLabel,
                  sources: result.sources,
                  retrievalMs: result.retrievalMs,
                  followUps: result.followUps,
                  isStreaming: false,
                }
              : m
          )
        );
      } catch (err) {
        const isAbort = err instanceof DOMException && err.name === 'AbortError';
        const needsSetup = err instanceof BackendNotConfiguredError;
        const messageText = isAbort
          ? '*Generation stopped.*'
          : err instanceof Error
            ? err.message
            : 'Unable to reach Gemini API. Please check your connection or API settings.';

        updateThreadMessages(threadId, (msgs) =>
          msgs.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  content: m.content || messageText,
                  isThinking: false,
                  isStreaming: false,
                  needsBackendSetup: needsSetup,
                }
              : m
          )
        );
      } finally {
        abortRef.current = null;
        setIsStreaming(false);
      }
    },
    [
      settings.engineId,
      settings.voiceStyle,
      settings.webSearchEnabled,
      settings.groqApiKey,
      settings.openRouterApiKey,
      settings.geminiApiKey,
      settings.proxyUrl,
      settings.customApi,
      updateThreadMessages,
    ]
  );

  const handleSubmitPrompt = useCallback(
    async (overridePrompt?: string) => {
      const text = (overridePrompt ?? inputValue).trim();
      if (!text || isStreaming) return;

      const userMsg: ChatMessage = {
        id: makeId('u'),
        role: 'user',
        content: text,
        createdAt: Date.now(),
        attachedContext: attachedContext ?? undefined,
      };
      const assistantMsg: ChatMessage = {
        id: makeId('a'),
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
        voiceStyle: settings.voiceStyle,
        isThinking: true,
        isStreaming: true,
      };

      const contextSnapshot = attachedContext;
      if (!overridePrompt) setInputValue('');
      setAttachedContext(null);

      let targetThreadId = activeThread?.id ?? null;
      const priorMessages = activeThread?.messages ?? [];

      if (!targetThreadId) {
        const newThread: ChatThread = {
          id: makeId('th'),
          title: deriveThreadTitle(text),
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messages: [userMsg, assistantMsg],
        };
        targetThreadId = newThread.id;
        if (isTemporaryChat) {
          setTempThread(newThread);
        } else {
          setThreads((prev) => [newThread, ...prev]);
          setActiveThreadId(newThread.id);
        }
      } else {
        const newTitle =
          priorMessages.length === 0 ? deriveThreadTitle(text) : undefined;
        updateThreadMessages(
          targetThreadId,
          (msgs) => [...msgs, userMsg, assistantMsg],
          newTitle
        );
      }

      await runAssistantTurn(
        targetThreadId,
        priorMessages,
        text,
        assistantMsg.id,
        undefined,
        contextSnapshot
      );
    },
    [
      inputValue,
      isStreaming,
      attachedContext,
      settings.voiceStyle,
      activeThread,
      isTemporaryChat,
      updateThreadMessages,
      runAssistantTurn,
    ]
  );

  // Auto-submit ?q= or ?prompt= query parameter on initial visit if present
  const urlPromptConsumedRef = useRef(false);
  useEffect(() => {
    if (urlPromptConsumedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const p = params.get('prompt') || params.get('q');
    if (p && p.trim()) {
      urlPromptConsumedRef.current = true;
      void handleSubmitPrompt(p.trim());
    }
  }, [handleSubmitPrompt]);

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const handleNewChat = () => {
    if (isStreaming) handleStop();
    setTempThread(null);
    setActiveThreadId(null);
    setInputValue('');
    setAttachedContext(null);
    setTimeout(() => inputRef.current?.focus(), 60);
  };

  const handleEditUserMessage = async (messageId: string, newContent: string) => {
    if (!activeThread || isStreaming) return;
    const idx = activeThread.messages.findIndex((m) => m.id === messageId);
    if (idx === -1) return;

    const targetMsg = activeThread.messages[idx];
    const truncatedHistory = activeThread.messages.slice(0, idx);
    const updatedUser: ChatMessage = { ...targetMsg, content: newContent, createdAt: Date.now() };
    const nextAssistant: ChatMessage = {
      id: makeId('a'),
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      voiceStyle: settings.voiceStyle,
      isThinking: true,
      isStreaming: true,
    };

    updateThreadMessages(
      activeThread.id,
      () => [...truncatedHistory, updatedUser, nextAssistant],
      idx === 0 ? deriveThreadTitle(newContent) : undefined
    );

    await runAssistantTurn(
      activeThread.id,
      truncatedHistory,
      newContent,
      nextAssistant.id,
      undefined,
      targetMsg.attachedContext
    );
  };

  const handleRegenerate = async (assistantMessageId: string) => {
    if (!activeThread || isStreaming) return;
    const idx = activeThread.messages.findIndex((m) => m.id === assistantMessageId);
    if (idx <= 0) return;

    let userIdx = idx - 1;
    while (userIdx >= 0 && activeThread.messages[userIdx].role !== 'user') {
      userIdx -= 1;
    }
    if (userIdx < 0) return;

    const userMsg = activeThread.messages[userIdx];
    const historyBefore = activeThread.messages.slice(0, userIdx);
    const newAssistantId = makeId('a');

    updateThreadMessages(activeThread.id, (msgs) =>
      msgs.slice(0, idx).concat({
        id: newAssistantId,
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
        voiceStyle: settings.voiceStyle,
        isThinking: true,
        isStreaming: true,
      })
    );

    await runAssistantTurn(
      activeThread.id,
      historyBefore,
      userMsg.content,
      newAssistantId,
      undefined,
      userMsg.attachedContext
    );
  };

  const handleExportChat = () => {
    if (!activeThread) return;
    const md = exportThreadAsMarkdown(activeThread);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ask-avi-${activeThread.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 36)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleInspectSources = (sources: RetrievedSource[], focusIndex: number) => {
    setDrawerSources(sources);
    setDrawerFocusIdx(focusIndex);
    setDrawerTab('cited');
    setKnowledgeOpen(true);
  };

  const handleAskAboutEntry = (entry: KnowledgeEntry) => {
    setAttachedContext({
      id: entry.id,
      title: entry.title,
      content: `${entry.summary}\n\n${entry.chunks.join('\n\n')}`,
      sourceUrl: entry.url,
    });
    setInputValue(`Let’s discuss your argument in "${entry.title}" and how it applies right now.`);
    if (isMobile) setKnowledgeOpen(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleAttachEntry = (entry: KnowledgeEntry) => {
    setAttachedContext({
      id: entry.id,
      title: entry.title,
      content: `${entry.summary}\n\n${entry.chunks.join('\n\n')}`,
      sourceUrl: entry.url,
    });
    if (isMobile) setKnowledgeOpen(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const lastAssistantId = useMemo(() => {
    if (!activeThread) return null;
    for (let i = activeThread.messages.length - 1; i >= 0; i--) {
      if (activeThread.messages[i].role === 'assistant') return activeThread.messages[i].id;
    }
    return null;
  }, [activeThread]);

  const hasMessages = Boolean(activeThread && activeThread.messages.length > 0);

  const handleSelectEngine = useCallback((engineId: EngineId) => {
    setSettings((prev) => ({ ...prev, engineId }));
  }, []);

  const handleToggleWebSearch = useCallback(() => {
    setSettings((prev) => ({ ...prev, webSearchEnabled: !prev.webSearchEnabled }));
  }, []);

  const handleToggleTheme = useCallback(() => {
    setSettings((prev) => ({
      ...prev,
      theme: prev.theme === 'dark' ? 'light' : 'dark',
    }));
  }, []);

  return (
    <div className="app-shell">
      <Sidebar
        isOpen={sidebarOpen}
        isMobile={isMobile}
        threads={threads}
        activeThreadId={activeThread?.id ?? null}
        theme={settings.theme}
        userProfile={userProfile}
        onCloseMobile={() => setSidebarOpen(false)}
        onToggleCollapse={() => setSidebarOpen(false)}
        onNewChat={handleNewChat}
        onSelectThread={(id) => {
          setIsTemporaryChat(false);
          setActiveThreadId(id);
        }}
        onRenameThread={(id, title) =>
          setThreads((prev) => prev.map((t) => (t.id === id ? { ...t, title } : t)))
        }
        onPinThread={(id) =>
          setThreads((prev) =>
            prev
              .map((t) => (t.id === id ? { ...t, pinned: !t.pinned } : t))
              .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt - a.updatedAt)
          )
        }
        onDeleteThread={(id) => {
          setThreads((prev) => prev.filter((t) => t.id !== id));
          if (activeThreadId === id) setActiveThreadId(null);
        }}
        onOpenKnowledge={() => {
          setDrawerTab('archive');
          setKnowledgeOpen(true);
        }}
        onOpenSettings={() => setSettingsOpen(true)}
        onToggleTheme={handleToggleTheme}
        onOpenHelp={() => setAccountInfoMode('help')}
        onOpenAbout={() => setAccountInfoMode('about')}
        onOpenSignIn={() => setSignInOpen(true)}
        onSignOut={() => setUserProfile(null)}
      />

      <div className="main-pane">
        <TopBar
          sidebarOpen={sidebarOpen}
          theme={settings.theme}
          isTemporaryChat={isTemporaryChat}
          canExport={hasMessages}
          knowledgeOpen={knowledgeOpen}
          onOpenSidebar={() => setSidebarOpen(true)}
          onToggleTheme={handleToggleTheme}
          onToggleTemporary={() => {
            setIsTemporaryChat((prev) => {
              const next = !prev;
              if (next) setTempThread(null);
              return next;
            });
          }}
          onExportChat={handleExportChat}
          onToggleKnowledge={() => {
            setDrawerTab(drawerSources.length > 0 ? 'cited' : 'archive');
            setKnowledgeOpen((p) => !p);
          }}
        />

        <main
          className="chat-viewport"
          ref={scrollContainerRef}
          onScroll={handleScrollContainer}
        >
          {!hasMessages ? (
            <WelcomeScreen
              inputValue={inputValue}
              onInputChange={setInputValue}
              onSubmitPrompt={handleSubmitPrompt}
              onStop={handleStop}
              isStreaming={isStreaming}
              engineId={settings.engineId}
              webSearchEnabled={settings.webSearchEnabled}
              onSelectEngine={handleSelectEngine}
              onToggleWebSearch={handleToggleWebSearch}
              onOpenSettings={() => setSettingsOpen(true)}
              voiceStyle={settings.voiceStyle}
              onChangeVoiceStyle={(voiceStyle: VoiceStyle) =>
                setSettings((prev) => ({ ...prev, voiceStyle }))
              }
              attachedContext={attachedContext}
              onAttachContext={setAttachedContext}
              onOpenDossierPicker={() => {
                setDrawerTab('archive');
                setKnowledgeOpen(true);
              }}
              inputRef={inputRef}
            />
          ) : (
            <div className="chat-stream">
              {activeThread!.messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  isLastAssistant={msg.id === lastAssistantId}
                  onEditUserMessage={handleEditUserMessage}
                  onRegenerate={handleRegenerate}
                  onFollowUpClick={(prompt) => handleSubmitPrompt(prompt)}
                  onInspectSource={handleInspectSources}
                  onFeedback={(msgId, vote) =>
                    updateThreadMessages(activeThread!.id, (msgs) =>
                      msgs.map((m) => (m.id === msgId ? { ...m, feedback: vote } : m))
                    )
                  }
                  onOpenSettings={() => setSettingsOpen(true)}
                />
              ))}
              <div ref={messagesEndRef} className="scroll-anchor" />
            </div>
          )}
        </main>

        {hasMessages && (
          <div className="composer-dock">
            <Composer
              value={inputValue}
              onChange={setInputValue}
              onSubmit={() => handleSubmitPrompt()}
              onStop={handleStop}
              isStreaming={isStreaming}
              engineId={settings.engineId}
              webSearchEnabled={settings.webSearchEnabled}
              onSelectEngine={handleSelectEngine}
              onToggleWebSearch={handleToggleWebSearch}
              onOpenSettings={() => setSettingsOpen(true)}
              voiceStyle={settings.voiceStyle}
              onChangeVoiceStyle={(voiceStyle: VoiceStyle) =>
                setSettings((prev) => ({ ...prev, voiceStyle }))
              }
              attachedContext={attachedContext}
              onAttachContext={setAttachedContext}
              onOpenDossierPicker={() => {
                setDrawerTab('archive');
                setKnowledgeOpen(true);
              }}
              inputRef={inputRef}
            />
          </div>
        )}
      </div>

      <KnowledgeDrawer
        isOpen={knowledgeOpen}
        activeSources={drawerSources}
        focusIndex={drawerFocusIdx}
        initialTab={drawerTab}
        onClose={() => setKnowledgeOpen(false)}
        onAskAboutEntry={handleAskAboutEntry}
        onAttachEntry={handleAttachEntry}
      />

      <SettingsModal
        isOpen={settingsOpen}
        settings={settings}
        onClose={() => setSettingsOpen(false)}
        onUpdateSettings={setSettings}
      />

      <SignInModal
        isOpen={signInOpen}
        currentProfile={userProfile}
        onClose={() => setSignInOpen(false)}
        onSignIn={setUserProfile}
        onSignOut={() => setUserProfile(null)}
      />

      <AccountInfoModal
        mode={accountInfoMode}
        onClose={() => setAccountInfoMode(null)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenDossiers={() => {
          setDrawerTab('archive');
          setKnowledgeOpen(true);
        }}
      />
    </div>
  );
}
