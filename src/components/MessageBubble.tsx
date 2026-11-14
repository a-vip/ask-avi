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
  Pencil,
  RotateCcw,
  Search,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage, RetrievedSource } from '../types/chat';
import { renderMarkdownToSafeHtml } from '../utils/markdown';
import { AviAvatar } from './AviAvatar';

interface MessageBubbleProps {
  message: ChatMessage;
  isLastAssistant: boolean;
  isAdmin?: boolean;
  wpAdminUrl?: string;
  onEditUserMessage: (messageId: string, newContent: string) => void;
  onRegenerate: (assistantMessageId: string) => void;
  onFollowUpClick: (prompt: string) => void;
  onInspectSource: (sources: RetrievedSource[], focusIndex: number) => void;
  onFeedback: (messageId: string, vote: 'up' | 'down' | null) => void;
  onOpenSettings: () => void;
}

export function MessageBubble({
  message,
  isLastAssistant,
  isAdmin = false,
  wpAdminUrl,
  onEditUserMessage,
  onRegenerate,
  onFollowUpClick,
  onInspectSource,
  onFeedback,
  onOpenSettings,
}: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(message.content);
  const [userExpandedOverride, setUserExpandedOverride] = useState<boolean | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [liveSec, setLiveSec] = useState<number>(0);
  const contentRef = useRef<HTMLDivElement>(null);

  const sourcesCount = message.sources?.length ?? 0;

  const renderedAnswerHtml = useMemo(() => {
    if (message.role !== 'assistant' || !message.content) return '';
    return renderMarkdownToSafeHtml(message.content, sourcesCount);
  }, [message.role, message.content, sourcesCount]);

  const renderedThoughtHtml = useMemo(() => {
    if (message.role !== 'assistant' || !message.thoughts) return '';
    return renderMarkdownToSafeHtml(message.thoughts, 0);
  }, [message.role, message.thoughts]);

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

  // Auto-open reasoning timeline while streaming thinking; auto-fold cleanly when answer begins
  const isActivelyThinking = Boolean(message.isStreaming && message.isThinking && !message.content);
  const hasReasoningBlock = Boolean(
    message.thoughts?.trim() ||
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

      const citeBtn = target.closest<HTMLElement>('[data-cite-idx]');
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
    return (
      <div className="msg-row msg-user-row">
        <div className="msg-user-col">
          {message.attachedContext && (
            <div className="msg-user-attachment">
              <FileText size={12} />
              <span>{message.attachedContext.title}</span>
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

  const hasWebSources = Boolean(message.webSources && message.webSources.length > 0);
  const hasArchiveSources = Boolean(message.sources && message.sources.length > 0);

  return (
    <article className="msg-row msg-assistant-row" aria-label="Avi response">
      <div className="msg-assistant-avatar">
        <AviAvatar size={30} />
      </div>

      <div className="msg-assistant-body">
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

        {!message.isStreaming && message.content && !message.needsBackendSetup && (
          <>
            {(hasWebSources || hasArchiveSources) && (
              <div className="inline-sources-strip">
                {message.webSources?.map((ws) => (
                  <a
                    key={ws.url}
                    href={ws.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="source-chip-btn web-source-chip"
                    title={ws.url}
                  >
                    <Globe size={12} className="web-chip-icon" />
                    <span className="source-chip-title">{ws.title}</span>
                  </a>
                ))}

                {message.sources?.map((src) => (
                  <button
                    key={src.entry.id}
                    type="button"
                    className="source-chip-btn"
                    onClick={() => onInspectSource(message.sources!, src.index)}
                    title={src.entry.title}
                  >
                    <span className="source-chip-num">{src.index}</span>
                    <span className="source-chip-title">{src.entry.title}</span>
                  </button>
                ))}
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
          </>
        )}
      </div>
    </article>
  );
}
