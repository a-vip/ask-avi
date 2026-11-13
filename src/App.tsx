import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Composer } from './components/Composer';
import { KnowledgeDrawer } from './components/KnowledgeDrawer';
import { MessageBubble } from './components/MessageBubble';
import { SettingsModal } from './components/SettingsModal';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { WelcomeScreen } from './components/WelcomeScreen';
import { ENGINE_OPTIONS } from './data/persona';
import { llmService } from './engine/llmService';
import type {
  AppSettings,
  AttachedContext,
  ChatMessage,
  ChatThread,
  EngineId,
  KnowledgeEntry,
  ModelLoadProgress,
  RetrievedSource,
  VoiceStyle,
} from './types/chat';
import {
  applyThemeToDocument,
  deriveThreadTitle,
  exportThreadAsMarkdown,
  loadSettings,
  loadThreads,
  postParentBridgeEvent,
  saveSettings,
  saveThreads,
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

  const [webGpuSupported, setWebGpuSupported] = useState<boolean | null>(null);
  const [webGpuReason, setWebGpuReason] = useState<string | undefined>(undefined);
  const [cachedModels, setCachedModels] = useState<Record<string, boolean>>({});
  const [modelProgress, setModelProgress] = useState<ModelLoadProgress>({
    engineId: 'instant',
    status: 'idle',
    progress: 0,
    text: '',
  });

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

  // Detect WebGPU & model caches on boot
  useEffect(() => {
    let mounted = true;
    (async () => {
      const gpu = await llmService.detectWebGPU();
      const caches = await llmService.getCachedModels();
      if (!mounted) return;
      setWebGpuSupported(gpu.supported);
      setWebGpuReason(gpu.reason);
      setCachedModels(caches);
      postParentBridgeEvent('ready', { webgpu: gpu.supported });
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Responsive check & parent theme postMessage listener
  useEffect(() => {
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

  // Keyboard shortcuts (/ to focus composer, Ctrl/Cmd+Shift+O for New Chat)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        handleNewChat();
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
          attachedContext: attached ?? undefined,
          customApi: settings.customApi,
          signal: controller.signal,
          onSources: (sources, elapsedMs) => {
            updateThreadMessages(threadId, (msgs) =>
              msgs.map((m) =>
                m.id === assistantMsgId ? { ...m, sources, retrievalMs: elapsedMs } : m
              )
            );
          },
          onToken: (partial) => {
            updateThreadMessages(threadId, (msgs) =>
              msgs.map((m) => (m.id === assistantMsgId ? { ...m, content: partial } : m))
            );
          },
          onModelProgress: (progress) => {
            setModelProgress(progress);
            if (progress.status === 'ready') {
              setCachedModels((prev) => ({ ...prev, [progress.engineId]: true }));
            }
          },
        });

        updateThreadMessages(threadId, (msgs) =>
          msgs.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  content: result.markdown,
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
        updateThreadMessages(threadId, (msgs) =>
          msgs.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  content: m.content || (isAbort ? '*Generation stopped.*' : 'Something interrupted the response. Please retry.'),
                  isStreaming: false,
                }
              : m
          )
        );
      } finally {
        abortRef.current = null;
        setIsStreaming(false);
      }
    },
    [settings.engineId, settings.voiceStyle, settings.customApi, updateThreadMessages]
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

  // Auto-submit ?prompt= query parameter on initial visit if present
  const urlPromptConsumedRef = useRef(false);
  useEffect(() => {
    if (urlPromptConsumedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const p = params.get('prompt');
    if (p && p.trim()) {
      urlPromptConsumedRef.current = true;
      void handleSubmitPrompt(p.trim());
    }
  }, [handleSubmitPrompt]);

  const handleStop = () => {
    abortRef.current?.abort();
    void llmService.interrupt();
  };

  const handleFallbackToInstant = async () => {
    handleStop();
    setSettings((prev) => ({ ...prev, engineId: 'instant' }));
    if (!activeThread || activeThread.messages.length === 0) return;
    const lastUser = [...activeThread.messages].reverse().find((m) => m.role === 'user');
    const lastAssistant = [...activeThread.messages].reverse().find((m) => m.role === 'assistant');
    if (!lastUser || !lastAssistant) return;

    const assistantIdx = activeThread.messages.findIndex((m) => m.id === lastAssistant.id);
    const historyBefore = activeThread.messages.slice(0, Math.max(0, assistantIdx - 1));
    updateThreadMessages(activeThread.id, (msgs) =>
      msgs.map((m) =>
        m.id === lastAssistant.id ? { ...m, content: '', isStreaming: true } : m
      )
    );
    await runAssistantTurn(
      activeThread.id,
      historyBefore,
      lastUser.content,
      lastAssistant.id,
      'instant',
      lastUser.attachedContext
    );
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

  const handlePreloadWebGPU = async (engineId: EngineId) => {
    try {
      await llmService.loadWebGPUModel(engineId, (p) => {
        setModelProgress(p);
        if (p.status === 'ready') {
          setCachedModels((prev) => ({ ...prev, [p.engineId]: true }));
        }
      });
    } catch {
      // Progress state already updates with error info
    }
  };

  const handleSelectEngine = (id: EngineId) => {
    setSettings((prev) => ({ ...prev, engineId: id }));
    const opt = ENGINE_OPTIONS.find((o) => o.id === id);
    if (opt?.requiresWebGPU && webGpuSupported && cachedModels[id]) {
      void handlePreloadWebGPU(id);
    }
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
    setInputValue(`Explain the core argument in "${entry.title}" and why it matters.`);
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

  return (
    <div className="app-shell">
      <Sidebar
        isOpen={sidebarOpen}
        isMobile={isMobile}
        threads={threads}
        activeThreadId={activeThread?.id ?? null}
        activeEngineId={settings.engineId}
        modelProgress={modelProgress}
        webGpuSupported={webGpuSupported}
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
      />

      <div className="main-pane">
        <TopBar
          sidebarOpen={sidebarOpen}
          theme={settings.theme}
          engineId={settings.engineId}
          cachedModels={cachedModels}
          webGpuSupported={webGpuSupported}
          modelProgress={modelProgress}
          isTemporaryChat={isTemporaryChat}
          canExport={hasMessages}
          knowledgeOpen={knowledgeOpen}
          onOpenSidebar={() => setSidebarOpen(true)}
          onSelectEngine={handleSelectEngine}
          onToggleTheme={() =>
            setSettings((prev) => ({
              ...prev,
              theme: prev.theme === 'dark' ? 'light' : 'dark',
            }))
          }
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
          onOpenSettings={() => setSettingsOpen(true)}
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
              engineId={settings.engineId}
              webGpuSupported={webGpuSupported}
              modelProgress={modelProgress}
              onActivateWebGPU={() => {
                handleSelectEngine('webgpu-swift');
                void handlePreloadWebGPU('webgpu-swift');
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
                  modelProgress={modelProgress}
                  onEditUserMessage={handleEditUserMessage}
                  onRegenerate={handleRegenerate}
                  onFollowUpClick={(prompt) => handleSubmitPrompt(prompt)}
                  onInspectSource={handleInspectSources}
                  onFeedback={(msgId, vote) =>
                    updateThreadMessages(activeThread!.id, (msgs) =>
                      msgs.map((m) => (m.id === msgId ? { ...m, feedback: vote } : m))
                    )
                  }
                  onFallbackToInstant={handleFallbackToInstant}
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
        webGpuSupported={webGpuSupported}
        webGpuReason={webGpuReason}
        cachedModels={cachedModels}
        modelProgress={modelProgress}
        onClose={() => setSettingsOpen(false)}
        onUpdateSettings={setSettings}
        onPreloadModel={handlePreloadWebGPU}
        onClearModelCache={async (id) => {
          await llmService.clearCachedModel(id);
          setCachedModels((prev) => ({ ...prev, [id]: false }));
        }}
      />
    </div>
  );
}
