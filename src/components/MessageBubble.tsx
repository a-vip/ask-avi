import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  Globe,
  KeyRound,
  Link2,
  LogIn,
  Mail,
  Pencil,
  RotateCcw,
  Search,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Volume2,
  VolumeX,
  X,
  Presentation,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage, RetrievedSource, ThinkingEffort } from '../types/chat';
import { subscribeToDispatch } from '../utils/authClient';
import {
  renderMarkdownToSafeHtml,
  resolveSourceUrl,
  type CitationTarget,
} from '../utils/markdown';
import { sanitizeThinkingTrace } from '../utils/thinking';
import { AviAvatar } from './AviAvatar';

interface SourcePreviewItem {
  index: number;
  title: string;
  url: string;
  snippet: string;
  category: string;
  date?: string;
  doi?: string;
  kind: 'archive' | 'web';
}

const DISPATCH_OPTIN_STORAGE_KEY = 'ask_avi_dispatch_optin_v1';

interface MessageBubbleProps {
  message: ChatMessage;
  isLastAssistant: boolean;
  assistantTurnCount?: number;
  isAdmin?: boolean;
  wpAdminUrl?: string;
  userEmail?: string;
  isMarketingOptedIn?: boolean;
  proxyUrl?: string;
  sessionToken?: string;
  onEditUserMessage: (messageId: string, newContent: string) => void;
  onRegenerate: (assistantMessageId: string, overrideEffort?: ThinkingEffort) => void;
  onFollowUpClick: (prompt: string) => void;
  onInspectSource: (sources: RetrievedSource[], focusIndex: number) => void;
  onFeedback: (messageId: string, vote: 'up' | 'down' | null) => void;
  onOpenSettings: () => void;
  onOpenSignIn?: () => void;
  onSwitchToFreeEngine?: () => void;
}

export function MessageBubble({
  message,
  isLastAssistant,
  assistantTurnCount = 1,
  isAdmin = false,
  wpAdminUrl,
  userEmail,
  isMarketingOptedIn = false,
  proxyUrl,
  sessionToken,
  onEditUserMessage,
  onRegenerate,
  onFollowUpClick,
  onInspectSource,
  onFeedback,
  onOpenSettings,
  onOpenSignIn,
  onSwitchToFreeEngine,
}: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(message.content);
  const [userExpandedOverride, setUserExpandedOverride] = useState<boolean | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [liveSec, setLiveSec] = useState<number>(0);
  const [hoveredCite, setHoveredCite] = useState<{
    index: number;
    rect: { top: number; left: number; bottom: number };
  } | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const [dispatchEmail, setDispatchEmail] = useState(userEmail ?? '');
  const [dispatchDismissed, setDispatchDismissed] = useState(false);
  const [dispatchState, setDispatchState] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle');
  const [dispatchError, setDispatchError] = useState('');

  useEffect(() => {
    if (userEmail && !dispatchEmail) {
      setDispatchEmail(userEmail);
    }
  }, [userEmail, dispatchEmail]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  const sourcePreviewByIndex = useMemo(() => {
    const map = new Map<number, SourcePreviewItem>();
    for (const src of message.sources ?? []) {
      const idx = src.index;
      map.set(idx, {
        index: idx,
        title: src.entry.title,
        url: resolveSourceUrl(src.entry.url, src.entry.doi),
        snippet: (src.snippet || src.entry.summary || '').replace(/\s+/g, ' ').trim(),
        category: src.entry.category || 'Avi Archive',
        date: src.entry.date,
        doi: src.entry.doi,
        kind: 'archive',
      });
    }
    (message.webSources ?? []).forEach((ws, i) => {
      const idx = ws.index || (message.sources?.length ?? 0) + i + 1;
      const url = resolveSourceUrl(ws.url);
      let host = 'Web Source';
      try {
        if (url) host = new URL(url).hostname.replace(/^www\./i, '');
      } catch {
        host = 'Web Source';
      }
      map.set(idx, {
        index: idx,
        title: ws.title,
        url,
        snippet: (ws.snippet || ws.title || '').replace(/\s+/g, ' ').trim(),
        category: host,
        kind: 'web',
      });
    });
    return map;
  }, [message.sources, message.webSources]);

  const hoveredPreview = hoveredCite ? sourcePreviewByIndex.get(hoveredCite.index) ?? null : null;

  const cancelClosePreview = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const scheduleClosePreview = () => {
    cancelClosePreview();
    closeTimerRef.current = window.setTimeout(() => {
      setHoveredCite(null);
    }, 150);
  };

  const openPreviewForElement = (el: HTMLElement | null) => {
    if (!el) return;
    const idx = Number(el.getAttribute('data-cite-idx'));
    if (!Number.isFinite(idx) || !sourcePreviewByIndex.has(idx)) return;
    cancelClosePreview();
    const rect = el.getBoundingClientRect();
    setHoveredCite({
      index: idx,
      rect: { top: rect.top, left: rect.left, bottom: rect.bottom },
    });
  };

  const citationTargets = useMemo<CitationTarget[]>(() => {
    const archive = (message.sources ?? []).map((src) => ({
      index: src.index,
      url: resolveSourceUrl(src.entry.url, src.entry.doi),
      title: src.entry.title,
      snippet: src.snippet || src.entry.summary,
      category: src.entry.category,
      date: src.entry.date,
      kind: 'archive' as const,
    }));
    const web = (message.webSources ?? []).map((ws, i) => ({
      index: ws.index || archive.length + i + 1,
      url: resolveSourceUrl(ws.url),
      title: ws.title,
      snippet: ws.snippet || ws.title,
      kind: 'web' as const,
    }));
    return [...archive, ...web].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  }, [message.sources, message.webSources]);

  const orderedFooterSources = useMemo(() => {
    type FooterItem =
      | { kind: 'archive'; index: number; src: RetrievedSource }
      | { kind: 'web'; index: number; ws: NonNullable<ChatMessage['webSources']>[number] };

    const items: FooterItem[] = [];
    for (const src of message.sources ?? []) {
      items.push({ kind: 'archive', index: src.index, src });
    }
    for (const ws of message.webSources ?? []) {
      items.push({ kind: 'web', index: ws.index || items.length + 1, ws });
    }
    return items.sort((a, b) => a.index - b.index);
  }, [message.sources, message.webSources]);

  const renderedAnswerHtml = useMemo(() => {
    if (message.role !== 'assistant' || !message.content) return '';
    return renderMarkdownToSafeHtml(message.content, citationTargets);
  }, [message.role, message.content, citationTargets]);

  // Auto-open reasoning timeline while streaming thinking; auto-fold cleanly when answer begins
  const isActivelyThinking = Boolean(message.isStreaming && message.isThinking && !message.content);

  const sanitizedThoughts = useMemo(() => {
    if (message.role !== 'assistant' || !message.thoughts) return '';
    return sanitizeThinkingTrace(message.thoughts, !isActivelyThinking);
  }, [message.role, message.thoughts, isActivelyThinking]);

  const renderedThoughtHtml = useMemo(() => {
    if (!sanitizedThoughts) return '';
    return renderMarkdownToSafeHtml(sanitizedThoughts, 0);
  }, [sanitizedThoughts]);

  // Live seconds ticker while actively thinking
  useEffect(() => {
    if (message.role !== 'assistant' || !message.isStreaming || !message.isThinking) {
      return;
    }
    const start = message.createdAt;
    const tick = () => {
      setLiveSec(Math.max(1, Math.round((Date.now() - start) / 1000)));
    };
    tick();
    const id = window.setInterval(tick, 300);
    return () => window.clearInterval(id);
  }, [message.role, message.isStreaming, message.isThinking, message.createdAt]);

  const hasReasoningBlock = Boolean(
    sanitizedThoughts ||
      (message.webSearchQueries && message.webSearchQueries.length > 0) ||
      isActivelyThinking
  );
  const isThinkingOpen =
    userExpandedOverride !== null ? userExpandedOverride : isActivelyThinking;

  const durationSec = useMemo(() => {
    if (isActivelyThinking) return liveSec;
    if (message.thinkingMs && message.thinkingMs > 0) {
      return Math.max(1, Math.round(message.thinkingMs / 1000));
    }
    return 1;
  }, [isActivelyThinking, liveSec, message.thinkingMs]);

  // Delegated click handler for [1] citation pills & code block copy buttons
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    const onClick = async (ev: MouseEvent) => {
      const target = ev.target as HTMLElement | null;
      if (!target) return;

      const citeBtn = target.closest<HTMLButtonElement>('button[data-cite-idx]');
      if (citeBtn && message.sources) {
        const idx = Number(citeBtn.dataset.citeIdx);
        onInspectSource(message.sources, idx);
        return;
      }

      const copyBtn = target.closest<HTMLButtonElement>('[data-copy-code]');
      if (copyBtn) {
        const encoded = copyBtn.dataset.copyCode ?? '';
        const decoded = decodeURIComponent(encoded);
        try {
          await navigator.clipboard.writeText(decoded);
          copyBtn.textContent = 'Copied!';
          setTimeout(() => {
            copyBtn.textContent = 'Copy';
          }, 1500);
        } catch {
          // Ignore clipboard permissions
        }
      }
    };

    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, [message.sources, onInspectSource]);

  useEffect(() => {
    return () => {
      if (speaking && typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [speaking]);

  const handleCopyMessage = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Ignore clipboard failure
    }
  };

  const handleReadAloud = () => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    window.speechSynthesis.cancel();
    const plain = message.content
      .replace(/\[\d+\]/g, '')
      .replace(/```[\s\S]*?```/g, 'Code snippet omitted.')
      .replace(/[*_`#>]/g, '');

    const utter = new SpeechSynthesisUtterance(plain);
    const voices = window.speechSynthesis.getVoices();
    const britishMale =
      voices.find((v) => /en-GB/i.test(v.lang) && /(Ryan|Daniel|George|Oliver|Arthur)/i.test(v.name)) ??
      voices.find((v) => /en-GB/i.test(v.lang));
    if (britishMale) utter.voice = britishMale;
    utter.lang = 'en-GB';
    utter.rate = 1.02;
    utter.onend = () => setSpeaking(false);
    utter.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utter);
  };

  if (message.role === 'user') {
    const userAttachments =
      message.attachedContexts && message.attachedContexts.length > 0
        ? message.attachedContexts
        : message.attachedContext
          ? [message.attachedContext]
          : [];

    return (
      <div className="msg-row msg-user-row">
        <div className="msg-user-col">
          {userAttachments.length > 0 && (
            <div className="msg-user-attachments-wrap">
              {userAttachments.map((att) => {
                const Icon =
                  att.kind === 'link'
                    ? Link2
                    : att.kind === 'slides'
                      ? Presentation
                      : att.kind === 'dossier'
                        ? BookOpen
                        : FileText;
                return (
                  <div key={att.id} className="msg-user-attachment" title={att.sourceUrl || att.title}>
                    <Icon size={12} />
                    <span>{att.title}</span>
                  </div>
                );
              })}
            </div>
          )}

          {editing ? (
            <div className="msg-edit-box">
              <textarea
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                rows={3}
                autoFocus
              />
              <div className="msg-edit-actions">
                <button
                  type="button"
                  className="btn-ghost-sm"
                  onClick={() => {
                    setEditDraft(message.content);
                    setEditing(false);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-primary-sm"
                  onClick={() => {
                    const trimmed = editDraft.trim();
                    if (trimmed) onEditUserMessage(message.id, trimmed);
                    setEditing(false);
                  }}
                >
                  Save &amp; Resend
                </button>
              </div>
            </div>
          ) : (
            <div className="msg-user-bubble-wrap">
              <button
                type="button"
                className="msg-edit-trigger"
                onClick={() => {
                  setEditDraft(message.content);
                  setEditing(true);
                }}
                title="Edit prompt"
                aria-label="Edit prompt"
              >
                <Pencil size={13} />
              </button>
              <div className="msg-user-bubble">{message.content}</div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <article className="msg-row msg-assistant-row" aria-label="Avi response">
      <div className="msg-assistant-avatar">
        <AviAvatar size={30} />
      </div>

      <div
        className="msg-assistant-body"
        onMouseOver={(e) => {
          const el = (e.target as HTMLElement | null)?.closest<HTMLElement>(
            '.cite-pill[data-cite-idx], .source-chip-btn[data-cite-idx]'
          );
          if (el) openPreviewForElement(el);
        }}
        onMouseOut={(e) => {
          const el = (e.target as HTMLElement | null)?.closest<HTMLElement>(
            '.cite-pill[data-cite-idx], .source-chip-btn[data-cite-idx]'
          );
          const related = e.relatedTarget as HTMLElement | null;
          if (el && !related?.closest('.cite-hover-card')) {
            scheduleClosePreview();
          }
        }}
        onFocusCapture={(e) => {
          const el = (e.target as HTMLElement | null)?.closest<HTMLElement>(
            '.cite-pill[data-cite-idx], .source-chip-btn[data-cite-idx]'
          );
          if (el) openPreviewForElement(el);
        }}
        onBlurCapture={(e) => {
          const related = e.relatedTarget as HTMLElement | null;
          if (!related?.closest('.cite-hover-card')) {
            scheduleClosePreview();
          }
        }}
      >
        <div className="msg-assistant-header">
          <span className="msg-speaker-name">Avi</span>
        </div>

        {/* Antigravity / Claude / Gemini Reasoning Timeline */}
        {hasReasoningBlock && (
          <div className={`ag-thinking-block ${isActivelyThinking ? 'active' : ''}`}>
            <button
              type="button"
              className="ag-thinking-header"
              onClick={() => setUserExpandedOverride(!isThinkingOpen)}
              aria-expanded={isThinkingOpen}
            >
              <Sparkles
                size={13}
                className={`ag-thinking-icon ${isActivelyThinking ? 'spin-subtle' : ''}`}
              />
              <span className="ag-thinking-label">
                {isActivelyThinking
                  ? `Thinking · ${durationSec}s`
                  : `Thought for ${durationSec}s`}
              </span>
              {isActivelyThinking && message.thinkingPhase && (
                <span className="ag-thinking-phase">{message.thinkingPhase}</span>
              )}
              {isThinkingOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>

            {isThinkingOpen && (
              <div className={`ag-thinking-body ${isActivelyThinking ? 'live-scroll' : ''}`}>
                <div className="ag-timeline">
                  {message.webSearchQueries && message.webSearchQueries.length > 0 && (
                    <div className="ag-step">
                      <span className="ag-step-dot">
                        <Search size={10} />
                      </span>
                      <div className="ag-step-content">
                        <div className="ag-step-title">Searched the web</div>
                        <div className="ag-search-chips">
                          {message.webSearchQueries.map((q, i) => (
                            <span key={i} className="ag-search-chip">
                              <Globe size={11} />
                              <span>{q}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {message.sources && message.sources.length > 0 && (
                    <div className="ag-step">
                      <span className="ag-step-dot">
                        <BookOpen size={10} />
                      </span>
                      <div className="ag-step-content">
                        <div className="ag-step-title">
                          Checked {message.sources.length} relevant Avi reference
                          {message.sources.length > 1 ? 's' : ''}
                        </div>
                      </div>
                    </div>
                  )}

                  {renderedThoughtHtml ? (
                    <div className="ag-step">
                      <span className="ag-step-dot dot-pulse" />
                      <div
                        className="ag-step-content ag-thought-prose"
                        dangerouslySetInnerHTML={{ __html: renderedThoughtHtml }}
                      />
                    </div>
                  ) : isActivelyThinking ? (
                    <div className="ag-step">
                      <span className="ag-step-dot dot-pulse" />
                      <div className="ag-step-content ag-thought-placeholder">
                        Weighing angles and formulating a considered response…
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        )}

        {message.needsBackendSetup ? (
          <div className="setup-prompt-card">
            <p className="setup-prompt-text">
              {isAdmin
                ? message.content
                : 'Ask Avi could not reach the response service right now. Please try again in a moment.'}
            </p>
            {isAdmin ? (
              <div className="setup-prompt-actions">
                <button type="button" className="btn-primary-sm" onClick={onOpenSettings}>
                  <KeyRound size={14} />
                  <span>Open Admin API Settings</span>
                </button>
                {wpAdminUrl && (
                  <a
                    href={wpAdminUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-secondary-sm"
                  >
                    <ExternalLink size={14} />
                    <span>WP Admin Dashboard</span>
                  </a>
                )}
              </div>
            ) : (
              <button
                type="button"
                className="btn-secondary-sm"
                onClick={() => onRegenerate(message.id)}
              >
                <RotateCcw size={14} />
                <span>Try again</span>
              </button>
            )}
          </div>
        ) : message.needsAuth ? (
          <div className="setup-prompt-card">
            <p className="setup-prompt-text">{message.content}</p>
            <div className="setup-prompt-actions">
              {onOpenSignIn && (
                <button type="button" className="btn-primary-sm" onClick={onOpenSignIn}>
                  <LogIn size={14} />
                  <span>Sign in to unlock Gemini</span>
                </button>
              )}
              {onSwitchToFreeEngine && (
                <button
                  type="button"
                  className="btn-secondary-sm"
                  onClick={onSwitchToFreeEngine}
                >
                  <Sparkles size={14} />
                  <span>Use Free Open-Source</span>
                </button>
              )}
            </div>
          </div>
        ) : message.isStreaming && !message.content && !hasReasoningBlock ? (
          <div className="thinking-dots" aria-label="Thinking">
            <span />
            <span />
            <span />
          </div>
        ) : message.content ? (
          <div
            ref={contentRef}
            className={`markdown-prose ${message.isStreaming ? 'streaming-cursor' : ''}`}
            dangerouslySetInnerHTML={{ __html: renderedAnswerHtml }}
          />
        ) : null}

        {!message.isStreaming && message.content && !message.needsBackendSetup && !message.needsAuth && (
          <>
            {orderedFooterSources.length > 0 && (
              <div className="inline-sources-strip">
                {orderedFooterSources.map((item) => {
                  if (item.kind === 'web') {
                    return (
                      <a
                        key={`web-${item.ws.url}`}
                        href={item.ws.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="source-chip-btn web-source-chip"
                        data-cite-idx={item.index}
                        title={`${item.ws.title} — ${item.ws.url}`}
                      >
                        <span className="source-chip-num">{item.index}</span>
                        <Globe size={12} className="web-chip-icon" />
                        <span className="source-chip-title">{item.ws.title}</span>
                      </a>
                    );
                  }
                  const src = item.src;
                  const href = resolveSourceUrl(src.entry.url, src.entry.doi);
                  if (href) {
                    return (
                      <a
                        key={src.entry.id}
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="source-chip-btn"
                        data-cite-idx={item.index}
                        title={`${src.entry.title} — ${href}`}
                      >
                        <span className="source-chip-num">{item.index}</span>
                        <span className="source-chip-title">{src.entry.title}</span>
                      </a>
                    );
                  }
                  return (
                    <button
                      key={src.entry.id}
                      type="button"
                      className="source-chip-btn"
                      data-cite-idx={item.index}
                      onClick={() => onInspectSource(message.sources!, item.index)}
                      title={src.entry.title}
                    >
                      <span className="source-chip-num">{item.index}</span>
                      <span className="source-chip-title">{src.entry.title}</span>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="msg-actions-bar">
              <button
                type="button"
                className="msg-action-btn"
                onClick={handleCopyMessage}
                title="Copy response"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>

              <button
                type="button"
                className="msg-action-btn"
                onClick={() => onRegenerate(message.id)}
                title="Regenerate response"
              >
                <RotateCcw size={14} />
                <span>Retry</span>
              </button>

              {typeof window !== 'undefined' && 'speechSynthesis' in window && (
                <button
                  type="button"
                  className={`msg-action-btn ${speaking ? 'active' : ''}`}
                  onClick={handleReadAloud}
                  title={speaking ? 'Stop reading' : 'Read aloud (British English)'}
                >
                  {speaking ? <VolumeX size={14} /> : <Volume2 size={14} />}
                  <span>{speaking ? 'Stop' : 'Listen'}</span>
                </button>
              )}

              {isLastAssistant &&
                message.thinkingEffort === 'fast' &&
                message.complexityTier !== 'fast-trivial' && (
                  <button
                    type="button"
                    className="msg-action-btn msg-deeper-btn"
                    onClick={() => onRegenerate(message.id, 'deep')}
                    title="Re-answer this question with Deep Reasoning for fuller analysis"
                  >
                    <Sparkles size={13} />
                    <span>Go deeper</span>
                  </button>
                )}

              <div className="msg-vote-group">
                <button
                  type="button"
                  className={`mini-vote-btn ${message.feedback === 'up' ? 'voted-up' : ''}`}
                  onClick={() => onFeedback(message.id, message.feedback === 'up' ? null : 'up')}
                  aria-label="Helpful"
                  title="Helpful"
                >
                  <ThumbsUp size={13} />
                </button>
                <button
                  type="button"
                  className={`mini-vote-btn ${message.feedback === 'down' ? 'voted-down' : ''}`}
                  onClick={() => onFeedback(message.id, message.feedback === 'down' ? null : 'down')}
                  aria-label="Not helpful"
                  title="Could be improved"
                >
                  <ThumbsDown size={13} />
                </button>
              </div>
            </div>

            {isLastAssistant && message.followUps && message.followUps.length > 0 && (
              <div className="followup-chips">
                {message.followUps.map((f, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className="followup-chip"
                    onClick={() => onFollowUpClick(f)}
                  >
                    {f}
                  </button>
                ))}
              </div>
            )}

            {(() => {
              const savedLocal =
                typeof localStorage !== 'undefined' &&
                localStorage.getItem(DISPATCH_OPTIN_STORAGE_KEY) === '1';
              const shouldShowDispatch =
                isLastAssistant &&
                !isMarketingOptedIn &&
                !savedLocal &&
                !dispatchDismissed &&
                (assistantTurnCount >= 2 || Boolean(message.isContentGap));
              if (!shouldShowDispatch && dispatchState !== 'done') return null;

              const handleSubmitDispatch = async (ev?: React.FormEvent) => {
                if (ev) ev.preventDefault();
                const targetEmail = (userEmail || dispatchEmail).trim();
                if (!targetEmail || dispatchState === 'submitting') return;
                setDispatchState('submitting');
                setDispatchError('');
                try {
                  await subscribeToDispatch(
                    targetEmail,
                    message.gapTopic || message.sources?.[0]?.entry.title || '',
                    sessionToken,
                    proxyUrl
                  );
                  if (typeof localStorage !== 'undefined') {
                    localStorage.setItem(DISPATCH_OPTIN_STORAGE_KEY, '1');
                  }
                  setDispatchState('done');
                } catch (err) {
                  setDispatchError(err instanceof Error ? err.message : 'Unable to subscribe.');
                  setDispatchState('error');
                }
              };

              return (
                <div className="contextual-dispatch-bar" data-testid="contextual-dispatch-optin">
                  {dispatchState === 'done' ? (
                    <div className="contextual-dispatch-done">
                      <Check size={14} />
                      <span>Subscribed — new essays and dispatches from Avi will arrive in your inbox.</span>
                    </div>
                  ) : (
                    <>
                      <div className="contextual-dispatch-copy">
                        <Mail size={14} />
                        <span>
                          {message.isContentGap
                            ? 'Following an edge topic not yet covered in a full essay — get notified when Avi publishes on this?'
                            : 'Want Avi’s next essays & dispatches when new research goes live?'}
                        </span>
                      </div>
                      <form className="contextual-dispatch-form" onSubmit={handleSubmitDispatch}>
                        {!userEmail && (
                          <input
                            type="email"
                            value={dispatchEmail}
                            onChange={(e) => setDispatchEmail(e.target.value)}
                            placeholder="you@domain.com"
                            aria-label="Email for new essays"
                            className="contextual-dispatch-input"
                            required
                          />
                        )}
                        <button
                          type="submit"
                          className="contextual-dispatch-btn"
                          disabled={dispatchState === 'submitting'}
                        >
                          {dispatchState === 'submitting'
                            ? 'Saving…'
                            : userEmail
                              ? 'Get new essays →'
                              : 'Notify me'}
                        </button>
                        <button
                          type="button"
                          className="contextual-dispatch-close"
                          onClick={() => setDispatchDismissed(true)}
                          aria-label="Dismiss newsletter suggestion"
                          title="Dismiss"
                        >
                          <X size={13} />
                        </button>
                      </form>
                      {dispatchError && (
                        <div className="contextual-dispatch-error">{dispatchError}</div>
                      )}
                    </>
                  )}
                </div>
              );
            })()}
          </>
        )}

        {hoveredCite && hoveredPreview && (() => {
          const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
          const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
          const cardWidth = Math.min(340, vw - 28);
          const left = Math.max(14, Math.min(vw - cardWidth - 14, hoveredCite.rect.left - 24));
          const placeAbove = hoveredCite.rect.bottom + 215 > vh && hoveredCite.rect.top > 220;
          const top = placeAbove
            ? Math.max(14, hoveredCite.rect.top - 12)
            : Math.min(vh - 180, hoveredCite.rect.bottom + 10);

          return (
            <div
              className={`cite-hover-card ${placeAbove ? 'place-above' : ''}`}
              role="tooltip"
              data-testid="cite-hover-preview"
              style={{
                left: `${left}px`,
                top: `${top}px`,
                width: `${cardWidth}px`,
                transform: placeAbove ? 'translateY(-100%)' : undefined,
              }}
              onMouseEnter={cancelClosePreview}
              onMouseLeave={scheduleClosePreview}
            >
              <div className="cite-hover-head">
                <span className="cite-hover-num">[{hoveredPreview.index}]</span>
                <span className="cite-hover-cat">{hoveredPreview.category}</span>
                {hoveredPreview.date && <span className="cite-hover-date">{hoveredPreview.date}</span>}
              </div>
              <div className="cite-hover-title">{hoveredPreview.title}</div>
              {hoveredPreview.snippet && (
                <blockquote className="cite-hover-quote">
                  &ldquo;{hoveredPreview.snippet}&rdquo;
                </blockquote>
              )}
              <div className="cite-hover-actions">
                {hoveredPreview.url && (
                  <a
                    href={hoveredPreview.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="cite-hover-link"
                  >
                    <span>Read original source</span>
                    <ExternalLink size={11} />
                  </a>
                )}
                {hoveredPreview.kind === 'archive' && message.sources && (
                  <button
                    type="button"
                    className="cite-hover-dossier-btn"
                    onClick={() => {
                      setHoveredCite(null);
                      onInspectSource(message.sources!, hoveredPreview.index);
                    }}
                  >
                    Open in Dossier
                  </button>
                )}
              </div>
            </div>
          );
        })()}
      </div>
    </article>
  );
}
