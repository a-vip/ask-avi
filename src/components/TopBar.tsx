import {
  BookOpen,
  Check,
  ChevronDown,
  Cpu,
  Download,
  EyeOff,
  Moon,
  PanelLeft,
  Settings,
  Sparkles,
  Sun,
  Zap,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ENGINE_OPTIONS } from '../data/persona';
import type { EngineId, ModelLoadProgress, ThemeMode } from '../types/chat';

interface TopBarProps {
  sidebarOpen: boolean;
  theme: ThemeMode;
  engineId: EngineId;
  cachedModels: Record<string, boolean>;
  webGpuSupported: boolean | null;
  modelProgress: ModelLoadProgress;
  isTemporaryChat: boolean;
  canExport: boolean;
  knowledgeOpen: boolean;
  onOpenSidebar: () => void;
  onSelectEngine: (id: EngineId) => void;
  onToggleTheme: () => void;
  onToggleTemporary: () => void;
  onExportChat: () => void;
  onToggleKnowledge: () => void;
  onOpenSettings: () => void;
}

export function TopBar({
  sidebarOpen,
  theme,
  engineId,
  cachedModels,
  webGpuSupported,
  modelProgress,
  isTemporaryChat,
  canExport,
  knowledgeOpen,
  onOpenSidebar,
  onSelectEngine,
  onToggleTheme,
  onToggleTemporary,
  onExportChat,
  onToggleKnowledge,
  onOpenSettings,
}: TopBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const activeOption = ENGINE_OPTIONS.find((o) => o.id === engineId) ?? ENGINE_OPTIONS[0];

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  return (
    <header className="topbar">
      <div className="topbar-left">
        {!sidebarOpen && (
          <button
            type="button"
            className="icon-btn"
            onClick={onOpenSidebar}
            title="Open sidebar"
            aria-label="Open sidebar"
          >
            <PanelLeft size={19} />
          </button>
        )}

        <div className="model-switcher" ref={dropdownRef}>
          <button
            type="button"
            className="model-pill-btn"
            onClick={() => setMenuOpen((prev) => !prev)}
            aria-expanded={menuOpen}
            aria-haspopup="listbox"
          >
            {activeOption.requiresWebGPU ? (
              <Cpu size={15} className="model-pill-icon accent" />
            ) : (
              <Zap size={15} className="model-pill-icon accent" />
            )}
            <span className="model-pill-name">{activeOption.shortName}</span>
            {modelProgress.status === 'loading' && (
              <span className="model-pill-pct">{Math.round(modelProgress.progress * 100)}%</span>
            )}
            <ChevronDown size={15} className={`chevron ${menuOpen ? 'open' : ''}`} />
          </button>

          {menuOpen && (
            <div className="model-dropdown" role="listbox" aria-label="Choose AI engine">
              <div className="dropdown-head">
                <span>Intelligence Engine</span>
                <span className="webgpu-chip">
                  {webGpuSupported === true
                    ? 'WebGPU Ready'
                    : webGpuSupported === false
                      ? 'Fallback Mode'
                      : 'Checking GPU…'}
                </span>
              </div>

              {ENGINE_OPTIONS.map((opt) => {
                const selected = opt.id === engineId;
                const isCached = Boolean(cachedModels[opt.id]);
                const disabledWebGPU = opt.requiresWebGPU && webGpuSupported === false;

                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={`model-option ${selected ? 'selected' : ''} ${disabledWebGPU ? 'muted' : ''}`}
                    onClick={() => {
                      if (opt.id === 'custom-api') {
                        onSelectEngine(opt.id);
                        setMenuOpen(false);
                        onOpenSettings();
                        return;
                      }
                      onSelectEngine(opt.id);
                      setMenuOpen(false);
                    }}
                  >
                    <div className="model-option-top">
                      <div className="model-option-title">
                        {opt.requiresWebGPU ? <Sparkles size={14} /> : <Zap size={14} />}
                        <span>{opt.name}</span>
                      </div>
                      <div className="model-option-badges">
                        {isCached && <span className="cached-badge">Cached ✓</span>}
                        <span className="size-badge">{opt.badge}</span>
                        {selected && <Check size={14} className="check-icon" />}
                      </div>
                    </div>
                    <p className="model-option-desc">
                      {disabledWebGPU
                        ? `${opt.description} (WebGPU unavailable in this browser — falls back to Instant Archive.)`
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
                    setMenuOpen(false);
                    onOpenSettings();
                  }}
                >
                  <Settings size={13} />
                  <span>Manage WebGPU Cache &amp; Custom API</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {isTemporaryChat && (
          <span className="temp-badge" title="This chat will not be saved to browser history">
            <EyeOff size={13} />
            <span>Temporary</span>
          </span>
        )}
      </div>

      <div className="topbar-right">
        <button
          type="button"
          className={`icon-btn ${isTemporaryChat ? 'active-pill' : ''}`}
          onClick={onToggleTemporary}
          title={isTemporaryChat ? 'Switch to saved chat' : 'Temporary chat (not saved)'}
          aria-label="Toggle temporary chat"
        >
          <EyeOff size={17} />
        </button>

        {canExport && (
          <button
            type="button"
            className="icon-btn"
            onClick={onExportChat}
            title="Export conversation as Markdown"
            aria-label="Export conversation as Markdown"
          >
            <Download size={17} />
          </button>
        )}

        <button
          type="button"
          className={`topbar-dossiers-btn ${knowledgeOpen ? 'active' : ''}`}
          onClick={onToggleKnowledge}
          title="Open Dossiers & Sources Panel"
        >
          <BookOpen size={15} />
          <span className="hide-xs">Dossiers</span>
        </button>

        <button
          type="button"
          className="icon-btn"
          onClick={onToggleTheme}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        >
          {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
        </button>
      </div>
    </header>
  );
}
