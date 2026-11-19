import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccountInfoModal, SignInModal } from './components/AccountDialogs';
import { Composer } from './components/Composer';
import { KnowledgeDrawer } from './components/KnowledgeDrawer';
import { MessageBubble } from './components/MessageBubble';
import { SettingsModal } from './components/SettingsModal';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { WelcomeScreen } from './components/WelcomeScreen';
import { ENGINE_OPTIONS } from './data/persona';
import { AuthRequiredError, BackendNotConfiguredError, llmService } from './engine/llmService';
import { knowledgeIndex } from './engine/rag';
import {
  deleteUserThreadRemote,
  fetchAuthConfig,
  isVerifiedAdmin,
  reportClientTelemetry,
  reportCompletedQaTurn,
  resolveEffectiveAuthUrl,
  saveUserThreadRemote,
  syncUserThreads,
  type AuthConfigResponse,
} from './utils/authClient';
import { allocateContextBudget, getContextBudgetLimits } from './utils/contextExtractor';
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
  clearGuestThreads,
  deriveThreadTitle,
  exportThreadAsMarkdown,
  loadGuestThreads,
  loadSettings,
  loadThreads,
  loadUserProfile,
  mergeThreadLists,
  postParentBridgeEvent,
  saveSettings,
  saveThreads,
  saveUserProfile,
} from './utils/storage';

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export default function App() {
  const [userProfile, setUserProfile] = useState<UserProfile | null>(() => loadUserProfile());
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [threads, setThreads] = useState<ChatThread[]>(() => loadThreads(loadUserProfile()?.email));
  const [isSyncingThreads, setIsSyncingThreads] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [tempThread, setTempThread] = useState<ChatThread | null>(null);
  const [isTemporaryChat, setIsTemporaryChat] = useState(false);

  const [inputValue, setInputValue] = useState('');
  const [attachedContexts, setAttachedContexts] = useState<AttachedContext[]>([]);
  const [pendingEngineAfterAuth, setPendingEngineAfterAuth] = useState<EngineId | null>(null);
  const [signInNotice, setSignInNotice] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);

  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 860 : false
  );
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<'cited' | 'archive'>('archive');
  const [drawerSources, setDrawerSources] = useState<RetrievedSource[]>([]);
  const [drawerFocusIdx, setDrawerFocusIdx] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'general' | 'admin' | 'developer'>('general');
  const [authConfig, setAuthConfig] = useState<AuthConfigResponse | null>(null);
  const [signInOpen, setSignInOpen] = useState(false);
  const [accountInfoMode, setAccountInfoMode] = useState<'help' | 'about' | null>(null);

  const openSettingsModal = useCallback((tab: 'general' | 'admin' | 'developer' = 'general') => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  }, []);

  const isAdmin = isVerifiedAdmin(userProfile);

  const threadsRef = useRef<ChatThread[]>(threads);
  threadsRef.current = threads;
  const syncedKeyRef = useRef<string | null>(null);
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

  // Persist saved threads (account-scoped when signed in, session-scoped for guests)
  useEffect(() => {
    saveThreads(threads, userProfile?.email);
  }, [threads, userProfile?.email]);

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
        openSettingsModal('general');
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

  const isAuthenticated = Boolean(userProfile);

  useEffect(() => {
    if (isAuthenticated) return;
    const selectedOpt = ENGINE_OPTIONS.find((o) => o.id === settings.engineId);
    if (selectedOpt?.requiresAuth) {
      setSettings((prev) => ({ ...prev, engineId: 'oss-reasoning' }));
    }
  }, [isAuthenticated, settings.engineId]);

  useEffect(() => {
    setAttachedContexts((prev) =>
      prev.length > 0 ? allocateContextBudget(prev, isAuthenticated).items : prev
    );
  }, [isAuthenticated]);

  const handleRequireSignIn = useCallback((pendingEngineId?: EngineId, customNotice?: string) => {
    setPendingEngineAfterAuth(pendingEngineId ?? null);
    setSignInNotice(
      customNotice ??
        (pendingEngineId
          ? 'Unlock frontier models, deeper context, and saved conversations.'
          : '')
    );
    setSignInOpen(true);
  }, []);

  const refreshAuthConfig = useCallback(async () => {
    const cfg = await fetchAuthConfig(userProfile?.sessionToken, settings.proxyUrl);
    if (!cfg) return;
    setAuthConfig(cfg);
    if (cfg.currentUser) {
      setUserProfile((prev) => ({
        ...cfg.currentUser!,
        sessionToken: cfg.currentUser!.sessionToken ?? prev?.sessionToken,
      }));
    } else {
      setUserProfile((prev) => {
        if (prev && (prev.isAdmin || prev.provider === 'wordpress')) {
          return null;
        }
        return prev;
      });
    }
  }, [settings.proxyUrl, userProfile?.sessionToken]);

  useEffect(() => {
    let active = true;
    fetchAuthConfig(userProfile?.sessionToken, settings.proxyUrl).then((cfg) => {
      if (!active || !cfg) return;
      setAuthConfig(cfg);
      if (cfg.currentUser) {
        setUserProfile((prev) => ({
          ...cfg.currentUser!,
          sessionToken: cfg.currentUser!.sessionToken ?? prev?.sessionToken,
        }));
      } else {
        setUserProfile((prev) => {
          if (prev && (prev.isAdmin || prev.provider === 'wordpress')) {
            return null;
          }
          return prev;
        });
      }
    });
    return () => {
      active = false;
    };
  }, [settings.proxyUrl]);

  useEffect(() => {
    void knowledgeIndex.syncLiveWordPressKnowledge(resolveEffectiveAuthUrl(settings.proxyUrl));
  }, [settings.proxyUrl]);

  useEffect(() => {
    const email = userProfile?.email?.trim().toLowerCase() || '';
    if (!email) {
      syncedKeyRef.current = null;
      setIsSyncingThreads(false);
      return;
    }

    const localAccountThreads = loadThreads(email);
    const guestThreads = loadGuestThreads();
    const mergedLocal = mergeThreadLists(
      threadsRef.current,
      mergeThreadLists(localAccountThreads, guestThreads)
    );
    if (mergedLocal.length > 0 && mergedLocal.length !== threadsRef.current.length) {
      setThreads(mergedLocal);
    }

    const hasAuthChannel = Boolean(
      userProfile?.sessionToken || userProfile?.provider === 'wordpress'
    );
    if (!hasAuthChannel) {
      clearGuestThreads();
      return;
    }

    const syncKey = `${email}:${userProfile?.sessionToken ?? 'wp'}`;
    if (syncedKeyRef.current === syncKey) return;
    syncedKeyRef.current = syncKey;

    let active = true;
    setIsSyncingThreads(true);
    void syncUserThreads(mergedLocal, userProfile?.sessionToken, settings.proxyUrl)
      .then((remoteThreads) => {
        if (!active) return;
        clearGuestThreads();
        if (remoteThreads) {
          setThreads((prev) => mergeThreadLists(prev, remoteThreads));
        }
      })
      .finally(() => {
        if (active) setIsSyncingThreads(false);
      });

    return () => {
      active = false;
    };
  }, [userProfile?.email, userProfile?.sessionToken, userProfile?.provider, settings.proxyUrl]);

  const handleSignOut = useCallback(() => {
    if (
      !isTemporaryChat &&
      userProfile?.email &&
      threadsRef.current.length > 0 &&
      (userProfile.sessionToken || userProfile.provider === 'wordpress')
    ) {
      void syncUserThreads(threadsRef.current, userProfile.sessionToken, settings.proxyUrl);
    }
    clearGuestThreads();
    syncedKeyRef.current = null;
    setUserProfile(null);
    setPendingEngineAfterAuth(null);
    setThreads([]);
    setActiveThreadId(null);
    setTempThread(null);
  }, [
    isTemporaryChat,
    settings.proxyUrl,
    userProfile?.email,
    userProfile?.provider,
    userProfile?.sessionToken,
  ]);

  const handleClearAllThreads = useCallback(() => {
    setThreads([]);
    setActiveThreadId(null);
    setTempThread(null);
    if (userProfile?.email && (userProfile.sessionToken || userProfile.provider === 'wordpress')) {
      void deleteUserThreadRemote(
        { clearAll: true },
        userProfile.sessionToken,
        settings.proxyUrl
      );
    }
  }, [settings.proxyUrl, userProfile?.email, userProfile?.provider, userProfile?.sessionToken]);

  const handleExportAllThreads = useCallback(() => {
    const payload = JSON.stringify({ exportedAt: new Date().toISOString(), threads }, null, 2);
    const blob = new Blob([payload], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `ask-avi-history-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [threads]);

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
      attached?: AttachedContext[]
    ) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setIsStreaming(true);
      shouldAutoScrollRef.current = true;

      const engineToUse = overrideEngineId ?? settings.engineId;
      const turnIndex = historyBeforeQuery.filter((m) => m.role === 'user').length + 1;
      const turnId = `turn_${assistantMsgId}`;

      try {
        const result = await llmService.generateReply({
          query: queryText,
          history: historyBeforeQuery,
          engineId: engineToUse,
          voiceStyle: settings.voiceStyle,
          webSearchEnabled: settings.webSearchEnabled,
          turnId,
          threadId,
          turnIndex,
          groqApiKey: settings.groqApiKey,
          openRouterApiKey: settings.openRouterApiKey,
          geminiApiKey: settings.geminiApiKey,
          proxyUrl: settings.proxyUrl,
          sessionToken: userProfile?.sessionToken,
          isAuthenticated,
          attachedContexts: attached,
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
                      thinkingPhase: update.thinkingPhase,
                      webSearchQueries: update.webSearchQueries,
                      webSources: update.webSources,
                    }
                  : m
              )
            );
          },
        });

        const finishedAt = Date.now();
        const finalFields: Partial<ChatMessage> = {
          content: result.content,
          thoughts: result.thoughts,
          isThinking: false,
          thinkingMs: result.thinkingMs,
          thinkingPhase: undefined,
          webSearchQueries: result.webSearchQueries,
          webSources: result.webSources,
          engineUsed: result.engineUsed,
          modelLabel: result.modelLabel,
          sources: result.sources,
          retrievalMs: result.retrievalMs,
          topRagScore: result.topRagScore,
          ragMatchCount: result.ragMatchCount,
          isContentGap: result.isContentGap,
          gapTopic: result.gapTopic,
          complexityTier: result.complexityTier,
          followUps: result.followUps,
          isStreaming: false,
        };

        updateThreadMessages(threadId, (msgs) =>
          msgs.map((m) => (m.id === assistantMsgId ? { ...m, ...finalFields } : m))
        );

        if (
          !isTemporaryChat &&
          userProfile?.email &&
          (userProfile.sessionToken || userProfile.provider === 'wordpress')
        ) {
          const baseThread = threadsRef.current.find((t) => t.id === threadId);
          const remoteSnapshot: ChatThread = baseThread
            ? {
                ...baseThread,
                updatedAt: finishedAt,
                messages: baseThread.messages.map((m) =>
                  m.id === assistantMsgId ? { ...m, ...finalFields } : m
                ),
              }
            : {
                id: threadId,
                title: deriveThreadTitle(queryText),
                createdAt: finishedAt,
                updatedAt: finishedAt,
                messages: [
                  ...historyBeforeQuery,
                  {
                    id: `u_${assistantMsgId}`,
                    role: 'user',
                    content: queryText,
                    createdAt: finishedAt - 1,
                    attachedContexts: attached && attached.length > 0 ? attached : undefined,
                  },
                  {
                    id: assistantMsgId,
                    role: 'assistant',
                    content: result.content,
                    createdAt: finishedAt,
                    voiceStyle: settings.voiceStyle,
                    ...finalFields,
                  },
                ],
              };
          void saveUserThreadRemote(
            remoteSnapshot,
            userProfile.sessionToken,
            settings.proxyUrl
          );
        }

        void reportCompletedQaTurn(
          {
            turnId,
            threadId,
            turnIndex,
            promptText: queryText,
            answerText: result.content,
            thoughtsText: result.thoughts,
            citedSources: [
              ...(result.sources ?? []).map((s) => ({
                index: s.index,
                title: s.entry.title,
                url: s.entry.url,
                kind: 'archive' as const,
              })),
              ...(result.webSources ?? []).map((w) => ({
                index: w.index,
                title: w.title,
                url: w.url,
                kind: 'web' as const,
              })),
            ],
            topRagScore: result.topRagScore,
            ragMatchCount: result.ragMatchCount,
            isContentGap: result.isContentGap,
            gapTopic: result.gapTopic,
            engineId: result.engineUsed,
            modelUsed: result.modelLabel,
            voiceStyle: settings.voiceStyle,
            latencyMs: result.thinkingMs,
          },
          userProfile?.sessionToken,
          settings.proxyUrl
        );
      } catch (err) {
        const isAbort = err instanceof DOMException && err.name === 'AbortError';
        const needsSetup = err instanceof BackendNotConfiguredError;
        const needsAuth = err instanceof AuthRequiredError;
        const messageText = isAbort
          ? '*Generation stopped.*'
          : err instanceof Error
            ? err.message
            : 'Unable to reach AI service. Please check your connection or try again.';

        if (!isAbort && !needsAuth) {
          void reportClientTelemetry(
            {
              event: needsSetup ? 'backend_unconfigured' : 'chat_client_error',
              level: 'error',
              message: messageText,
              engineId: engineToUse,
            },
            userProfile?.sessionToken,
            settings.proxyUrl
          );
        }

        updateThreadMessages(threadId, (msgs) =>
          msgs.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  content: m.content || messageText,
                  isThinking: false,
                  isStreaming: false,
                  needsBackendSetup: needsSetup,
                  needsAuth,
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
      isTemporaryChat,
      userProfile?.email,
      userProfile?.provider,
      userProfile?.sessionToken,
      updateThreadMessages,
    ]
  );

  const handleSubmitPrompt = useCallback(
    async (overridePrompt?: string) => {
      const text = (overridePrompt ?? inputValue).trim();
      if (!text || isStreaming) return;

      const selectedOpt = ENGINE_OPTIONS.find((o) => o.id === settings.engineId);
      if (selectedOpt?.requiresAuth && !userProfile) {
        handleRequireSignIn(selectedOpt.id);
        return;
      }

      const allocated = allocateContextBudget(attachedContexts, isAuthenticated).items;
      const userMsg: ChatMessage = {
        id: makeId('u'),
        role: 'user',
        content: text,
        createdAt: Date.now(),
        attachedContexts: allocated.length > 0 ? allocated : undefined,
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

      const contextSnapshot = allocated;
      if (!overridePrompt) setInputValue('');
      setAttachedContexts([]);

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
      attachedContexts,
      settings.engineId,
      settings.voiceStyle,
      userProfile,
      handleRequireSignIn,
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
    setAttachedContexts([]);
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

    const prevAttachments =
      targetMsg.attachedContexts ?? (targetMsg.attachedContext ? [targetMsg.attachedContext] : undefined);

    await runAssistantTurn(
      activeThread.id,
      truncatedHistory,
      newContent,
      nextAssistant.id,
      undefined,
      prevAttachments
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

    const prevAttachments =
      userMsg.attachedContexts ?? (userMsg.attachedContext ? [userMsg.attachedContext] : undefined);

    await runAssistantTurn(
      activeThread.id,
      historyBefore,
      userMsg.content,
      newAssistantId,
      undefined,
      prevAttachments
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

  const appendDossierContext = (entry: KnowledgeEntry) => {
    const nextItem: AttachedContext = {
      id: entry.id,
      title: entry.title,
      content: `${entry.summary}\n\n${entry.chunks.join('\n\n')}`,
      sourceUrl: entry.url,
      kind: 'dossier',
    };
    setAttachedContexts((prev) => {
      const limits = getContextBudgetLimits(isAuthenticated);
      const deduped = prev.filter((item) => item.id !== nextItem.id);
      const next = [...deduped, nextItem].slice(-limits.maxItems);
      return allocateContextBudget(next, isAuthenticated).items;
    });
  };

  const handleAskAboutEntry = (entry: KnowledgeEntry) => {
    appendDossierContext(entry);
    setInputValue(`Let’s discuss your argument in "${entry.title}" and how it applies right now.`);
    if (isMobile) setKnowledgeOpen(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleAttachEntry = (entry: KnowledgeEntry) => {
    appendDossierContext(entry);
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

  const handleSelectEngine = useCallback(
    (engineId: EngineId) => {
      const opt = ENGINE_OPTIONS.find((o) => o.id === engineId);
      if (opt?.requiresAuth && !userProfile) {
        handleRequireSignIn(engineId);
        return;
      }
      setSettings((prev) => ({ ...prev, engineId }));
    },
    [userProfile, handleRequireSignIn]
  );

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
        isSyncingThreads={isSyncingThreads}
        onCloseMobile={() => setSidebarOpen(false)}
        onToggleCollapse={() => setSidebarOpen(false)}
        onNewChat={handleNewChat}
        onSelectThread={(id) => {
          setIsTemporaryChat(false);
          setActiveThreadId(id);
        }}
        onRenameThread={(id, title) => {
          const now = Date.now();
          const target = threadsRef.current.find((t) => t.id === id);
          setThreads((prev) =>
            prev.map((t) => (t.id === id ? { ...t, title, updatedAt: now } : t))
          );
          if (
            target &&
            userProfile?.email &&
            (userProfile.sessionToken || userProfile.provider === 'wordpress')
          ) {
            void saveUserThreadRemote(
              { ...target, title, updatedAt: now },
              userProfile.sessionToken,
              settings.proxyUrl
            );
          }
        }}
        onPinThread={(id) => {
          const now = Date.now();
          const target = threadsRef.current.find((t) => t.id === id);
          setThreads((prev) =>
            prev
              .map((t) => (t.id === id ? { ...t, pinned: !t.pinned, updatedAt: now } : t))
              .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt - a.updatedAt)
          );
          if (
            target &&
            userProfile?.email &&
            (userProfile.sessionToken || userProfile.provider === 'wordpress')
          ) {
            void saveUserThreadRemote(
              { ...target, pinned: !target.pinned, updatedAt: now },
              userProfile.sessionToken,
              settings.proxyUrl
            );
          }
        }}
        onDeleteThread={(id) => {
          setThreads((prev) => prev.filter((t) => t.id !== id));
          if (activeThreadId === id) setActiveThreadId(null);
          if (userProfile?.email && (userProfile.sessionToken || userProfile.provider === 'wordpress')) {
            void deleteUserThreadRemote(
              { threadId: id },
              userProfile.sessionToken,
              settings.proxyUrl
            );
          }
        }}
        onOpenKnowledge={() => {
          setDrawerTab('archive');
          setKnowledgeOpen(true);
        }}
        onOpenSettings={() => openSettingsModal('general')}
        onToggleTheme={handleToggleTheme}
        onOpenHelp={() => setAccountInfoMode('help')}
        onOpenAbout={() => setAccountInfoMode('about')}
        onOpenSignIn={() => handleRequireSignIn()}
        onSignOut={handleSignOut}
      />

      <div className="main-pane">
        <TopBar
          sidebarOpen={sidebarOpen}
          theme={settings.theme}
          isTemporaryChat={isTemporaryChat}
          canExport={hasMessages}
          knowledgeOpen={knowledgeOpen}
          isAuthenticated={isAuthenticated}
          hasMessages={hasMessages}
          onOpenSignIn={() =>
            handleRequireSignIn(
              undefined,
              'Sign in or create a free account to save conversations to your account.'
            )
          }
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
              onOpenSettings={() => openSettingsModal('general')}
              voiceStyle={settings.voiceStyle}
              onChangeVoiceStyle={(voiceStyle: VoiceStyle) =>
                setSettings((prev) => ({ ...prev, voiceStyle }))
              }
              attachedContexts={attachedContexts}
              onAttachContexts={(items) =>
                setAttachedContexts(allocateContextBudget(items, isAuthenticated).items)
              }
              onOpenDossierPicker={() => {
                setDrawerTab('archive');
                setKnowledgeOpen(true);
              }}
              isAdmin={isAdmin}
              isAuthenticated={isAuthenticated}
              userName={userProfile?.name}
              threadCount={threads.length}
              theme={settings.theme}
              onRequireSignIn={handleRequireSignIn}
              proxyUrl={settings.proxyUrl}
              sessionToken={userProfile?.sessionToken}
              inputRef={inputRef}
            />
          ) : (
            <div className="chat-stream">
              {activeThread!.messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  isLastAssistant={msg.id === lastAssistantId}
                  assistantTurnCount={
                    activeThread!.messages.filter((m) => m.role === 'assistant').length
                  }
                  isAdmin={isAdmin}
                  wpAdminUrl={authConfig?.wpAdminUrl}
                  userEmail={userProfile?.email}
                  isMarketingOptedIn={Boolean(userProfile?.marketingOptIn)}
                  proxyUrl={settings.proxyUrl}
                  sessionToken={userProfile?.sessionToken}
                  onEditUserMessage={handleEditUserMessage}
                  onRegenerate={handleRegenerate}
                  onFollowUpClick={(prompt) => handleSubmitPrompt(prompt)}
                  onInspectSource={handleInspectSources}
                  onFeedback={(msgId, vote) =>
                    updateThreadMessages(activeThread!.id, (msgs) =>
                      msgs.map((m) => (m.id === msgId ? { ...m, feedback: vote } : m))
                    )
                  }
                  onOpenSettings={() => openSettingsModal(isAdmin ? 'developer' : 'general')}
                  onOpenSignIn={() => handleRequireSignIn(settings.engineId)}
                  onSwitchToFreeEngine={() =>
                    setSettings((prev) => ({ ...prev, engineId: 'oss-reasoning' }))
                  }
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
              onOpenSettings={() => openSettingsModal('general')}
              voiceStyle={settings.voiceStyle}
              onChangeVoiceStyle={(voiceStyle: VoiceStyle) =>
                setSettings((prev) => ({ ...prev, voiceStyle }))
              }
              attachedContexts={attachedContexts}
              onAttachContexts={(items) =>
                setAttachedContexts(allocateContextBudget(items, isAuthenticated).items)
              }
              onOpenDossierPicker={() => {
                setDrawerTab('archive');
                setKnowledgeOpen(true);
              }}
              isAdmin={isAdmin}
              isAuthenticated={isAuthenticated}
              onRequireSignIn={handleRequireSignIn}
              proxyUrl={settings.proxyUrl}
              sessionToken={userProfile?.sessionToken}
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
        initialTab={settingsTab}
        settings={settings}
        theme={settings.theme}
        userProfile={userProfile}
        authConfig={authConfig}
        onClose={() => setSettingsOpen(false)}
        onUpdateSettings={setSettings}
        onToggleTheme={handleToggleTheme}
        onOpenSignIn={() => handleRequireSignIn()}
        onClearAllThreads={handleClearAllThreads}
        onExportAllThreads={handleExportAllThreads}
        onRefreshAuthConfig={() => void refreshAuthConfig()}
      />

      <SignInModal
        isOpen={signInOpen}
        currentProfile={userProfile}
        authConfig={authConfig}
        proxyUrl={settings.proxyUrl}
        pendingNotice={signInNotice}
        onClose={() => {
          setSignInOpen(false);
          setSignInNotice('');
          setPendingEngineAfterAuth(null);
        }}
        onSignIn={(profile) => {
          setUserProfile(profile);
          if (pendingEngineAfterAuth) {
            setSettings((prev) => ({ ...prev, engineId: pendingEngineAfterAuth }));
            setPendingEngineAfterAuth(null);
          }
          setSignInNotice('');
        }}
        onSignOut={handleSignOut}
      />

      <AccountInfoModal
        mode={accountInfoMode}
        onClose={() => setAccountInfoMode(null)}
        onOpenSettings={() => openSettingsModal('general')}
        onOpenDossiers={() => {
          setDrawerTab('archive');
          setKnowledgeOpen(true);
        }}
      />
    </div>
  );
}
