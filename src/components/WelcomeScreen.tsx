import { Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { getTimeGreeting, STARTER_PROMPTS, VERIFIED_LINKS } from '../data/persona';
import type { AttachedContext, ModelLoadProgress, VoiceStyle } from '../types/chat';
import { AviAvatar } from './AviAvatar';
import { Composer } from './Composer';

interface WelcomeScreenProps {
  inputValue: string;
  onInputChange: (val: string) => void;
  onSubmitPrompt: (overridePrompt?: string) => void;
  onStop: () => void;
  isStreaming: boolean;
  voiceStyle: VoiceStyle;
  onChangeVoiceStyle: (style: VoiceStyle) => void;
  attachedContext: AttachedContext | null;
  onAttachContext: (ctx: AttachedContext | null) => void;
  onOpenDossierPicker: () => void;
  modelProgress: ModelLoadProgress;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
}

const PROMPT_FILTERS = ['All', 'LAWS & IHL', 'AI Governance', 'Philosophy & Life', 'Systems & Code', 'Advisory'];

export function WelcomeScreen({
  inputValue,
  onInputChange,
  onSubmitPrompt,
  onStop,
  isStreaming,
  voiceStyle,
  onChangeVoiceStyle,
  attachedContext,
  onAttachContext,
  onOpenDossierPicker,
  modelProgress,
  inputRef,
}: WelcomeScreenProps) {
  const [selectedCategory, setSelectedCategory] = useState('All');
  const greeting = useMemo(() => getTimeGreeting(), []);

  const visiblePrompts = useMemo(() => {
    if (selectedCategory === 'All') return STARTER_PROMPTS;
    return STARTER_PROMPTS.filter((p) => p.category === selectedCategory);
  }, [selectedCategory]);

  return (
    <div className="welcome-stage">
      <div className="welcome-inner">
        <div className="welcome-hero">
          <div className="welcome-badge-row">
            <AviAvatar size={40} className="welcome-avatar" />
            <span className="welcome-eyebrow">
              <Sparkles size={13} />
              <span>AI Persona · Avi Perera</span>
            </span>
          </div>

          <h1 className="welcome-heading">
            {greeting}. <em>Ask Avi</em> anything.
          </h1>
        </div>

        <Composer
          value={inputValue}
          onChange={onInputChange}
          onSubmit={() => onSubmitPrompt()}
          onStop={onStop}
          isStreaming={isStreaming}
          voiceStyle={voiceStyle}
          onChangeVoiceStyle={onChangeVoiceStyle}
          attachedContext={attachedContext}
          onAttachContext={onAttachContext}
          onOpenDossierPicker={onOpenDossierPicker}
          centered
          inputRef={inputRef}
        />

        {modelProgress.status === 'loading' && (
          <div className="engine-callout-row">
            <div className="webgpu-loading-pill">
              <Sparkles size={14} className="spin-subtle" />
              <span>
                Preparing neural engine ({Math.round(modelProgress.progress * 100)}%)…
              </span>
            </div>
          </div>
        )}

        <div className="starter-section">
          <div className="starter-filters" role="tablist" aria-label="Prompt categories">
            {PROMPT_FILTERS.map((cat) => (
              <button
                key={cat}
                type="button"
                role="tab"
                aria-selected={selectedCategory === cat}
                className={`filter-pill ${selectedCategory === cat ? 'active' : ''}`}
                onClick={() => setSelectedCategory(cat)}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="starter-grid">
            {visiblePrompts.map((item) => (
              <button
                key={item.id}
                type="button"
                className="starter-card"
                onClick={() => onSubmitPrompt(item.prompt)}
              >
                <span className="starter-cat">{item.category}</span>
                <strong className="starter-title">{item.title}</strong>
                <span className="starter-prompt">{item.prompt}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="welcome-links-bar">
          {VERIFIED_LINKS.map((lnk) => (
            <a
              key={lnk.url}
              href={lnk.url}
              target="_blank"
              rel="noopener noreferrer"
              className="verified-link-chip"
            >
              {lnk.label} ↗
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
