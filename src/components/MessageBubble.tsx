import {
  BookOpen,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  Pencil,
  RotateCcw,
  ThumbsDown,
  ThumbsUp,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage, ModelLoadProgress, RetrievedSource } from '../types/chat';
import { renderMarkdownToSafeHtml } from '../utils/markdown';
import { splitThinkingAndAnswer } from '../utils/thinking';
import { AviAvatar } from './AviAvatar';

interface MessageBubbleProps {
  message: ChatMessage;
  isLastAssistant: boolean;
  modelProgress: ModelLoadProgress;
  onEditUserMessage: (messageId: string, newContent: string) => void;
  onRegenerate: (assistantMessageId: string) => void;
  onFollowUpClick: (prompt: string) => void;
  onInspectSource: (sources: RetrievedSource[], focusIndex: number) => void;
  onFeedback: (messageId: string, vote: 'up' | 'down' | null) => void;
  onFallbackToInstant: () => void;
}

export function MessageBubble({
  message,
  isLastAssistant,
  modelProgress,
  onEditUserMessage,
  onRegenerate,
  onFollowUpClick,
  onInspectSource,
  onFeedback,
  onFallbackToInstant,
}: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(message.content);
  const [sourcesExpanded, setSourcesExpanded] = useState(false);
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const sourcesCount = message.sources?.length ?? 0;

  const { thinking, answer, isThinking } = useMemo(() => {
    if (message.role !== 'assistant') {
      return { thinking: '', answer: message.content, isThinking: false };
    }
    return splitThinkingAndAnswer(message.content);
  }, [message.role, message.content]);

  const renderedHtml = useMemo(() => {
    if (message.role !== 'assistant' || !answer) return '';
    return renderMarkdownToSafeHtml(answer, sourcesCount);
  }, [message.role, answer, sourcesCount]);

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
      await navigator.clipboard.writeText(answer || message.content);
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
    const plain = (answer || message.content)
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

  const showModelWarmup =
    message.isStreaming && !message.content && modelProgress.status === 'loading';

  return (
    <article className="msg-row msg-assistant-row" aria-label="Ask Avi response">
      <div className="msg-assistant-avatar">
        <AviAvatar size={30} />
      </div>

      <div className="msg-assistant-body">
        <div className="msg-assistant-header">
          <span className="msg-speaker-name">Ask Avi</span>
          {message.modelLabel && (
            <span className="msg-model-badge">{message.modelLabel}</span>
          )}
        </div>

        {message.sources && message.sources.length > 0 && (
          <div className="retrieval-trace">
            <button
              type="button"
              className="trace-toggle-btn"
              onClick={() => setSourcesExpanded((p) => !p)}
              aria-expanded={sourcesExpanded}
            >
              <BookOpen size={13} />
              <span>
                Consulted {message.sources.length} dossier{message.sources.length > 1 ? 's' : ''}
                {message.retrievalMs ? ` · ${message.retrievalMs}ms` : ''}
              </span>
              {sourcesExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>

            {sourcesExpanded && (
              <div className="trace-sources-grid">
                {message.sources.map((src) => (
                  <div key={src.entry.id} className="trace-source-card">
                    <div className="trace-source-head">
                      <span className="trace-index">[{src.index}]</span>
                      <span className="trace-cat">{src.entry.category}</span>
                      <button
                        type="button"
                        className="trace-inspect-btn"
                        onClick={() => onInspectSource(message.sources!, src.index)}
                      >
                        Inspect
                      </button>
                    </div>
                    <a
                      href={src.entry.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="trace-title"
                    >
                      {src.entry.title} <ExternalLink size={11} />
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {(thinking || (isThinking && message.isStreaming)) && (
          <div className="thinking-trace">
            <button
              type="button"
              className={`thinking-toggle-btn ${isThinking && message.isStreaming ? 'live' : ''}`}
              onClick={() => setThinkingExpanded((p) => !p)}
              aria-expanded={thinkingExpanded}
            >
              <Brain size={13} />
              <span>{isThinking && message.isStreaming ? 'Thinking…' : 'Thought process'}</span>
              {thinkingExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>

            {thinkingExpanded && thinking && (
              <div className="thinking-body">{thinking}</div>
            )}
          </div>
        )}

        {showModelWarmup ? (
          <div className="model-warmup-card">
            <div className="warmup-top">
              <span className="warmup-title">
                Initializing In-Browser Neural Engine (WebGPU)…
              </span>
              <span className="warmup-pct">{Math.round(modelProgress.progress * 100)}%</span>
            </div>
            <div className="warmup-bar-track">
              <div
                className="warmup-bar-fill"
                style={{ width: `${Math.max(4, Math.round(modelProgress.progress * 100))}%` }}
              />
            </div>
            <p className="warmup-sub">
              {modelProgress.text || 'Caching model shards locally in your browser (one-time download).'}
            </p>
            <button type="button" className="warmup-fallback-btn" onClick={onFallbackToInstant}>
              <Zap size={13} />
              <span>Use Instant Archive fallback instead</span>
            </button>
          </div>
        ) : message.isStreaming && !answer && !isThinking ? (
          <div className="thinking-dots" aria-label="Thinking">
            <span />
            <span />
            <span />
          </div>
        ) : answer ? (
          <div
            ref={contentRef}
            className={`markdown-prose ${message.isStreaming ? 'streaming-cursor' : ''}`}
            dangerouslySetInnerHTML={{ __html: renderedHtml }}
          />
        ) : null}

        {!message.isStreaming && message.content && (
          <>
            {message.sources && message.sources.length > 0 && (
              <div className="inline-sources-strip">
                {message.sources.map((src) => (
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
