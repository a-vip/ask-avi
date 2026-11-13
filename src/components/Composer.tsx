import {
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  FileText,
  Mic,
  MicOff,
  Paperclip,
  Square,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { VOICE_STYLES } from '../data/persona';
import type { AttachedContext, VoiceStyle } from '../types/chat';

interface ComposerProps {
  value: string;
  onChange: (val: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  isStreaming: boolean;
  voiceStyle: VoiceStyle;
  onChangeVoiceStyle: (style: VoiceStyle) => void;
  attachedContext: AttachedContext | null;
  onAttachContext: (ctx: AttachedContext | null) => void;
  onOpenDossierPicker: () => void;
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
  voiceStyle,
  onChangeVoiceStyle,
  attachedContext,
  onAttachContext,
  onOpenDossierPicker,
  centered = false,
  inputRef: externalRef,
}: ComposerProps) {
  const internalRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = externalRef ?? internalRef;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const styleMenuRef = useRef<HTMLDivElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);

  const [styleOpen, setStyleOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  const speechSupported =
    typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  const activeStyle = VOICE_STYLES.find((s) => s.id === voiceStyle) ?? VOICE_STYLES[0];

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
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    onAttachContext({
      id: `file-${Date.now()}`,
      title: file.name,
      content: text.slice(0, 4000),
    });
    e.target.value = '';
    setAttachOpen(false);
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
        {attachedContext && (
          <div className="attached-chip-row">
            <div className="attached-chip">
              <FileText size={13} />
              <span className="attached-title">{attachedContext.title}</span>
              <button
                type="button"
                className="attached-remove"
                onClick={() => onAttachContext(null)}
                aria-label="Remove attachment"
              >
                <X size={13} />
              </button>
            </div>
          </div>
        )}

        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask Avi anything…"
          aria-label="Message Ask Avi"
          className="composer-input"
        />

        <div className="composer-toolbar">
          <div className="composer-tools-left">
            <div className="popover-anchor" ref={attachMenuRef}>
              <button
                type="button"
                className="tool-chip-btn"
                onClick={() => setAttachOpen((p) => !p)}
                title="Attach dossier or text file"
              >
                <Paperclip size={15} />
                <span className="hide-xs">Context</span>
              </button>

              {attachOpen && (
                <div className="composer-popover">
                  <button
                    type="button"
                    className="popover-item"
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
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <FileText size={14} />
                    <strong>Upload .txt or .md</strong>
                  </button>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.md,.json,.csv"
                onChange={handleFileChange}
                hidden
              />
            </div>

            <div className="popover-anchor" ref={styleMenuRef}>
              <button
                type="button"
                className="tool-chip-btn"
                onClick={() => setStyleOpen((p) => !p)}
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
          Ask Avi can make mistakes. Please double-check responses.
        </p>
      )}
    </div>
  );
}
