import { ChevronDown, ChevronUp, RefreshCw, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  selectDynamicGreeting,
  type GreetingVisitorInput,
  type SelectedGreeting,
} from '../data/greetings';
import { STARTER_PROMPTS, VERIFIED_LINKS } from '../data/persona';
import type { AttachedContext, EngineId, ThemeMode, VoiceStyle } from '../types/chat';
import { AviAvatar } from './AviAvatar';
import { Composer } from './Composer';

interface WelcomeScreenProps {
  inputValue: string;
  onInputChange: (val: string) => void;
  onSubmitPrompt: (overridePrompt?: string) => void;
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
  userName?: string;
  threadCount?: number;
  theme?: ThemeMode;
  onRequireSignIn?: (pendingEngineId?: EngineId) => void;
  proxyUrl?: string;
  sessionToken?: string;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
}

const PROMPT_FILTERS = ['All', 'LAWS & IHL', 'AI Governance', 'Philosophy & Life', 'Systems & Code', 'Advisory'];

export function WelcomeScreen({
  inputValue,
  onInputChange,
  onSubmitPrompt,
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
  userName,
  threadCount = 0,
  theme = 'dark',
  onRequireSignIn,
  proxyUrl,
  sessionToken,
  inputRef,
}: WelcomeScreenProps) {
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('All');

  const visitorInput = useMemo<GreetingVisitorInput>(
    () => ({
      userName,
      isAuthenticated,
      threadCount,
      voiceStyle,
      engineId,
      theme,
    }),
    [userName, isAuthenticated, threadCount, voiceStyle, engineId, theme]
  );

  const [greeting, setGreeting] = useState<SelectedGreeting>(() => selectDynamicGreeting(visitorInput));
  const initialMountRef = useRef(true);

  useEffect(() => {
    if (initialMountRef.current) {
      initialMountRef.current = false;
      return;
    }
    setGreeting((prev) =>
      selectDynamicGreeting({
        ...visitorInput,
        excludeIds: [prev.id],
      })
    );
  }, [userName, voiceStyle, threadCount]);

  const handleShuffleGreeting = () => {
    setGreeting((prev) =>
      selectDynamicGreeting({
        ...visitorInput,
        excludeIds: [prev.id],
        skipVisitTracking: true,
      })
    );
  };

  const visiblePrompts = useMemo(() => {
    if (selectedCategory === 'All') return STARTER_PROMPTS;
    return STARTER_PROMPTS.filter((p) => p.category === selectedCategory);
  }, [selectedCategory]);

  return (
    <div className="welcome-stage">
      <div className="welcome-inner">
        <div className="welcome-hero">
          <div className="welcome-badge-row">
            <AviAvatar size={42} className="welcome-avatar" />
            <button
              type="button"
              className="welcome-eyebrow"
              onClick={handleShuffleGreeting}
              title="Show another context-aware greeting"
              aria-label={`Context telemetry: ${greeting.kicker}. Click for another greeting`}
            >
              <span>{greeting.kicker}</span>
              <RefreshCw size={11} className="welcome-shuffle-icon" />
            </button>
          </div>

          <h1 className="welcome-heading">
            <span className="welcome-heading-line">{greeting.headline}</span>
            <span className="welcome-heading-line">
              <em>Ask Avi</em> anything.
            </span>
          </h1>
        </div>

        <Composer
          value={inputValue}
          onChange={onInputChange}
          onSubmit={() => onSubmitPrompt()}
          onStop={onStop}
          isStreaming={isStreaming}
          engineId={engineId}
          webSearchEnabled={webSearchEnabled}
          onSelectEngine={onSelectEngine}
          onToggleWebSearch={onToggleWebSearch}
          onOpenSettings={onOpenSettings}
          voiceStyle={voiceStyle}
          onChangeVoiceStyle={onChangeVoiceStyle}
          attachedContext={attachedContext}
          onAttachContext={onAttachContext}
          attachedContexts={attachedContexts}
          onAttachContexts={onAttachContexts}
          onOpenDossierPicker={onOpenDossierPicker}
          isAdmin={isAdmin}
          isAuthenticated={isAuthenticated}
          onRequireSignIn={onRequireSignIn}
          proxyUrl={proxyUrl}
          sessionToken={sessionToken}
          centered
          inputRef={inputRef}
        />

        <div className="suggestions-toggle-row">
          <button
            type="button"
            className={`suggestions-toggle-btn ${suggestionsOpen ? 'active' : ''}`}
            onClick={() => setSuggestionsOpen((p) => !p)}
            aria-expanded={suggestionsOpen}
          >
            <Sparkles size={13} />
            <span>{suggestionsOpen ? 'Hide suggestions' : 'Show suggestions'}</span>
            {suggestionsOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        </div>

        {suggestionsOpen && (
          <div className="starter-disclosure">
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
        )}
      </div>
    </div>
  );
}
