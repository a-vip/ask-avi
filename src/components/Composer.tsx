import {
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  FileText,
  Globe,
  Link2,
  Loader2,
  Lock,
  Mic,
  MicOff,
  Paperclip,
  Presentation,
  Settings,
  Sparkles,
  Square,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ENGINE_OPTIONS, VOICE_STYLES } from '../data/persona';
import type { AttachedContext, EngineId, VoiceStyle } from '../types/chat';
import {
  allocateContextBudget,
  extractFileContext,
  fetchUrlContext,
  MAX_CONTEXT_ITEMS,
  SUPPORTED_FILE_ACCEPT,
} from '../utils/contextExtractor';

interface ComposerProps {
  value: string;
  onChange: (val: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  isStreaming: boolean;
  engineId: EngineId;
  webSearchEnabled: boolean;
  onSelectEngine: (id: EngineId) => void;
  onToggleWebSearch: () => void;
  onOpenSettings: () => void;
  voiceStyle: VoiceStyle;
  onChangeVoiceStyle: (style: VoiceStyle) => void;
  attachedContext?: AttachedContext | null;
  onAttachContext?: (ctx: AttachedContext | null) => void;
  attachedContexts?: AttachedContext[];
  onAttachContexts?: (items: AttachedContext[]) => void;
  onOpenDossierPicker: () => void;
  isAdmin?: boolean;
  isAuthenticated?: boolean;
  onRequireSignIn?: (pendingEngineId?: EngineId) => void;
  proxyUrl?: string;
  sessionToken?: string;
  centered?: boolean;
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
}

interface SpeechRecognitionAlternative {
  transcript: string;
}
interface SpeechRecognitionResult {
  0: SpeechRecognitionAlternative;
  isFinal: boolean;
}
interface SpeechRecognitionEvent {
  results: ArrayLike<SpeechRecognitionResult>;
}
interface SpeechRecognitionInstance {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  isStreaming,
  engineId,
  webSearchEnabled,
  onSelectEngine,
  onToggleWebSearch,
  onOpenSettings,
  voiceStyle,
  onChangeVoiceStyle,
  attachedContext = null,
  onAttachContext,
  attachedContexts,
  onAttachContexts,
  onOpenDossierPicker,
  isAdmin = false,
  isAuthenticated = false,
  onRequireSignIn,
  proxyUrl,
  sessionToken,
  centered = false,
  inputRef: externalRef,
}: ComposerProps) {
  const internalRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = externalRef ?? internalRef;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const styleMenuRef = useRef<HTMLDivElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);

  const [styleOpen, setStyleOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [linkMode, setLinkMode] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [attachError, setAttachError] = useState('');
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  const rawContexts: AttachedContext[] =
    attachedContexts !== undefined
      ? attachedContexts
      : attachedContext
        ? [attachedContext]
        : [];
  const budget = allocateContextBudget(rawContexts);
  const items = budget.items;
  const remainingSlots = Math.max(0, MAX_CONTEXT_ITEMS - items.length);

  const commitContexts = (next: AttachedContext[]) => {
    const allocated = allocateContextBudget(next).items;
    if (onAttachContexts) {
      onAttachContexts(allocated);
    } else if (onAttachContext) {
      onAttachContext(allocated[0] ?? null);
    }
  };

  const speechSupported =
    typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  const activeStyle = VOICE_STYLES.find((s) => s.id === voiceStyle) ?? VOICE_STYLES[0];
  const activeEngine = ENGINE_OPTIONS.find((o) => o.id === engineId) ?? ENGINE_OPTIONS[0];

  // Auto-resize textarea smoothly
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 210)}px`;
  }, [value, textareaRef]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (styleMenuRef.current && !styleMenuRef.current.contains(e.target as Node)) {
        setStyleOpen(false);
      }
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) {
        setAttachOpen(false);
      }
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
        setModelOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isStreaming && value.trim().length > 0) {
        onSubmit();
      }
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;

    if (remainingSlots <= 0) {
      setAttachError(`Up to ${MAX_CONTEXT_ITEMS} context items can be attached per message.`);
      return;
    }

    setAttachError('');
    setIsExtracting(true);
    const chosen = files.slice(0, remainingSlots);
    const added: AttachedContext[] = [];
    const failures: string[] = [];

    try {
      for (const file of chosen) {
        try {
          const ctx = await extractFileContext(file);
          added.push(ctx);
        } catch (err) {
          failures.push(err instanceof Error ? err.message : `Could not read "${file.name}".`);
        }
      }

      if (added.length > 0) {
        commitContexts([...items, ...added]);
      }

      if (files.length > chosen.length) {
        failures.push(`Only the first ${chosen.length} file(s) fit the ${MAX_CONTEXT_ITEMS}-item cap.`);
      }

      if (failures.length > 0) {
        setAttachError(failures[0]);
      } else {
        setAttachOpen(false);
      }
    } finally {
      setIsExtracting(false);
    }
  };

  const handleAddLink = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (remainingSlots <= 0) {
      setAttachError(`Up to ${MAX_CONTEXT_ITEMS} context items can be attached per message.`);
      return;
    }
    setAttachError('');
    setIsExtracting(true);
    try {
      const ctx = await fetchUrlContext(urlDraft, sessionToken, proxyUrl);
      commitContexts([...items, ctx]);
      setUrlDraft('');
      setLinkMode(false);
      setAttachOpen(false);
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : 'Unable to fetch web link.');
    } finally {
      setIsExtracting(false);
    }
  };

  const toggleVoiceInput = () => {
    if (!speechSupported) return;
    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
      return;
    }

    const win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionInstance;
      webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
    };
    const Ctor = win.SpeechRecognition ?? win.webkitSpeechRecognition;
    if (!Ctor) return;

    const rec = new Ctor();
    rec.lang = 'en-GB';
    rec.interimResults = true;
    rec.continuous = false;
    const baseText = value;

    rec.onresult = (ev) => {
      let transcript = '';
      for (let i = 0; i < ev.results.length; i++) {
        transcript += ev.results[i][0].transcript;
      }
      onChange((baseText ? `${baseText.trimEnd()} ` : '') + transcript.trim());
    };
    rec.onerror = () => setIsListening(false);
    rec.onend = () => setIsListening(false);

    recognitionRef.current = rec;
    setIsListening(true);
    rec.start();
  };

  return (
    <div className={`composer-wrap ${centered ? 'centered' : 'docked'}`}>
      <div className="composer-pill">
        {items.length > 0 && (
          <div className="attached-chip-row">
            {items.map((ctx) => {
              const kind = ctx.kind ?? 'text';
              const KindIcon =
                kind === 'link'
                  ? Link2
                  : kind === 'slides'
                    ? Presentation
                    : kind === 'dossier'
                      ? BookOpen
                      : FileText;
              const badgeLabel =
                kind === 'dossier'
                  ? 'DOSSIER'
                  : kind === 'slides'
                    ? 'SLIDES'
                    : kind === 'link'
                      ? 'LINK'
                      : kind === 'pdf'
                        ? 'PDF'
                        : kind === 'doc'
                          ? 'DOC'
                          : 'TEXT';
              return (
                <div
                  key={ctx.id}
                  className="attached-chip"
                  title={
                    ctx.sourceUrl
                      ? `${ctx.title} (${ctx.sourceUrl})`
                      : ctx.trimmed
                        ? `${ctx.title} · compacted to preserve token budget`
                        : ctx.title
                  }
                >
                  <KindIcon size={13} />
                  <span className="attached-kind-tag">{badgeLabel}</span>
                  <span className="attached-title">{ctx.title}</span>
                  <button
                    type="button"
                    className="attached-remove"
                    onClick={() => commitContexts(items.filter((x) => x.id !== ctx.id))}
                    aria-label={`Remove attachment ${ctx.title}`}
                  >
                    <X size={13} />
                  </button>
                </div>
              );
            })}
            <span
              className="attached-budget-pill"
              title="Automatically compacted to keep token usage and API quotas healthy (max 4 items, ~2,000 tokens combined)"
            >
              {items.length}/{MAX_CONTEXT_ITEMS} · ~{budget.estimatedTokens} tok
              {budget.trimmedAny ? ' · compacted' : ''}
            </span>
          </div>
        )}

        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="How can I help you today?"
          aria-label="Message Ask Avi"
          className="composer-input"
        />

        <div className="composer-toolbar">
          <div className="composer-tools-left">
            <div className="popover-anchor" ref={attachMenuRef}>
              <button
                type="button"
                className={`tool-chip-btn ${items.length > 0 ? 'has-items' : ''}`}
                onClick={() => {
                  setStyleOpen(false);
                  setModelOpen(false);
                  setAttachError('');
                  setLinkMode(false);
                  setAttachOpen((p) => !p);
                }}
                title="Attach dossiers, PDFs, docs, slides, text files, or web links"
              >
                <Paperclip size={15} />
                <span className="hide-xs">
                  Context{items.length > 0 ? ` · ${items.length}` : ''}
                </span>
              </button>

              {attachOpen && (
                <div className="composer-popover composer-popover-context">
                  <div className="popover-context-meta">
                    <span>
                      Attach context ({items.length}/{MAX_CONTEXT_ITEMS})
                    </span>
                    <span className="popover-budget-hint">Auto-compacted ≤2k tok</span>
                  </div>
                  <button
                    type="button"
                    className="popover-item"
                    disabled={remainingSlots <= 0 || isExtracting}
                    onClick={() => {
                      setAttachOpen(false);
                      onOpenDossierPicker();
                    }}
                  >
                    <BookOpen size={14} />
                    <strong>Attach a dossier</strong>
                  </button>
                  <button
                    type="button"
                    className="popover-item"
                    disabled={remainingSlots <= 0 || isExtracting}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {isExtracting ? <Loader2 size={14} className="spin" /> : <FileText size={14} />}
                    <strong>Upload PDF, Docs, Slides, Text…</strong>
                  </button>
                  {!linkMode ? (
                    <button
                      type="button"
                      className="popover-item"
                      disabled={remainingSlots <= 0 || isExtracting}
                      onClick={() => {
                        setAttachError('');
                        setLinkMode(true);
                      }}
                    >
                      <Link2 size={14} />
                      <strong>Add web link (URL)</strong>
                    </button>
                  ) : (
                    <form className="popover-link-form" onSubmit={handleAddLink}>
                      <input
                        type="url"
                        className="popover-link-input"
                        value={urlDraft}
                        onChange={(e) => setUrlDraft(e.target.value)}
                        placeholder="https://example.com/article"
                        aria-label="Web link URL"
                        autoFocus
                        disabled={isExtracting}
                      />
                      <div className="popover-link-actions">
                        <button
                          type="button"
                          className="popover-link-cancel"
                          onClick={() => {
                            setLinkMode(false);
                            setAttachError('');
                          }}
                          disabled={isExtracting}
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          className="popover-link-submit"
                          disabled={isExtracting || !urlDraft.trim()}
                        >
                          {isExtracting ? 'Fetching…' : 'Attach'}
                        </button>
                      </div>
                    </form>
                  )}
                  {attachError && <p className="popover-context-error">{attachError}</p>}
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={SUPPORTED_FILE_ACCEPT}
                onChange={handleFileChange}
                hidden
              />
            </div>

            <div className="popover-anchor" ref={styleMenuRef}>
              <button
                type="button"
                className="tool-chip-btn"
                onClick={() => {
                  setAttachOpen(false);
                  setModelOpen(false);
                  setStyleOpen((p) => !p);
                }}
                title="Adjust Avi's response voice"
              >
                <span>{activeStyle.label}</span>
                <ChevronDown size={13} />
              </button>

              {styleOpen && (
                <div className="composer-popover style-popover">
                  <div className="popover-title">Response Voice</div>
                  {VOICE_STYLES.map((style) => (
                    <button
                      key={style.id}
                      type="button"
                      className={`popover-item ${voiceStyle === style.id ? 'selected' : ''}`}
                      onClick={() => {
                        onChangeVoiceStyle(style.id);
                        setStyleOpen(false);
                      }}
                    >
                      <strong className="style-item-text">{style.label}</strong>
                      {voiceStyle === style.id && <Check size={14} className="check-icon" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="composer-tools-right">
            <div className="popover-anchor" ref={modelMenuRef}>
              <button
                type="button"
                className="composer-model-btn"
                onClick={() => {
                  setAttachOpen(false);
                  setStyleOpen(false);
                  setModelOpen((p) => !p);
                }}
                aria-expanded={modelOpen}
                aria-haspopup="listbox"
                title="Switch reasoning model"
              >
                <span className="composer-model-name">{activeEngine.shortName}</span>
                <ChevronDown size={13} className={`chevron ${modelOpen ? 'open' : ''}`} />
              </button>

              {modelOpen && (
                <div
                  className="model-dropdown composer-model-dropdown"
                  role="listbox"
                  aria-label="Choose model"
                >
                  <div className="dropdown-head">
                    <span>Model</span>
                    <button
                      type="button"
                      className={`web-toggle-chip ${webSearchEnabled ? 'active' : ''}`}
                      onClick={onToggleWebSearch}
                      title="Toggle live internet search & reference grounding"
                    >
                      <Globe size={11} />
                      <span>{webSearchEnabled ? 'Web Search On' : 'Web Search Off'}</span>
                    </button>
                  </div>

                  {ENGINE_OPTIONS.filter((opt) => isAdmin || opt.id !== 'custom-api').map((opt) => {
                    const selected = opt.id === engineId;
                    const locked = Boolean(opt.requiresAuth && !isAuthenticated);
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        aria-disabled={locked || undefined}
                        className={`model-option ${selected ? 'selected' : ''} ${locked ? 'locked' : ''}`}
                        onClick={() => {
                          if (locked) {
                            setModelOpen(false);
                            onRequireSignIn?.(opt.id);
                            return;
                          }
                          onSelectEngine(opt.id);
                          setModelOpen(false);
                          if (opt.id === 'custom-api' && isAdmin) {
                            onOpenSettings();
                          }
                        }}
                      >
                        <div className="model-option-top">
                          <div className="model-option-title">
                            {locked ? <Lock size={14} className="lock-icon" /> : <Sparkles size={14} />}
                            <span>{opt.name}</span>
                          </div>
                          <div className="model-option-badges">
                            {locked ? (
                              <span className="size-badge size-badge-auth">Sign in</span>
                            ) : (
                              <span className="size-badge">{opt.badge}</span>
                            )}
                            {selected && !locked && <Check size={14} className="check-icon" />}
                          </div>
                        </div>
                        <p className="model-option-desc">
                          {locked
                            ? `${opt.description} Sign in or create a free account to unlock.`
                            : opt.description}
                        </p>
                      </button>
                    );
                  })}

                  <div className="dropdown-footer">
                    <button
                      type="button"
                      className="dropdown-settings-link"
                      onClick={() => {
                        setModelOpen(false);
                        onOpenSettings();
                      }}
                    >
                      <Settings size={13} />
                      <span>{isAdmin ? 'Admin & API Settings' : 'Settings'}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {speechSupported && (
              <button
                type="button"
                className={`icon-btn mic-btn ${isListening ? 'listening' : ''}`}
                onClick={toggleVoiceInput}
                title={isListening ? 'Stop listening' : 'Voice dictation'}
                aria-label={isListening ? 'Stop voice dictation' : 'Start voice dictation'}
              >
                {isListening ? <MicOff size={17} /> : <Mic size={17} />}
              </button>
            )}

            {isStreaming ? (
              <button
                type="button"
                className="send-btn stop"
                onClick={onStop}
                title="Stop generating"
                aria-label="Stop generating"
              >
                <Square size={14} fill="currentColor" />
              </button>
            ) : (
              <button
                type="button"
                className="send-btn"
                onClick={onSubmit}
                disabled={value.trim().length === 0}
                title="Send message (Enter)"
                aria-label="Send message"
              >
                <ArrowUp size={18} strokeWidth={2.3} />
              </button>
            )}
          </div>
        </div>
      </div>

      {!centered && (
        <p className="composer-disclaimer">
          Ask Avi is AI and can make mistakes. Please double-check responses.
        </p>
      )}
    </div>
  );
}
