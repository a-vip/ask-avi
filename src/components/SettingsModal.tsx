import { Check, Code2, Copy, Cpu, KeyRound, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { ENGINE_OPTIONS } from '../data/persona';
import type { AppSettings, EngineId, ModelLoadProgress } from '../types/chat';

interface SettingsModalProps {
  isOpen: boolean;
  settings: AppSettings;
  webGpuSupported: boolean | null;
  webGpuReason?: string;
  cachedModels: Record<string, boolean>;
  modelProgress: ModelLoadProgress;
  onClose: () => void;
  onUpdateSettings: (next: AppSettings) => void;
  onPreloadModel: (engineId: EngineId) => void;
  onClearModelCache: (engineId: EngineId) => void;
}

export function SettingsModal({
  isOpen,
  settings,
  webGpuSupported,
  webGpuReason,
  cachedModels,
  modelProgress,
  onClose,
  onUpdateSettings,
  onPreloadModel,
  onClearModelCache,
}: SettingsModalProps) {
  const [copiedEmbed, setCopiedEmbed] = useState(false);

  if (!isOpen) return null;

  const embedCode = `<iframe
  src="https://a-vip.github.io/ask-avi/?embed=1"
  title="Ask Avi — AI Persona of Avi Perera"
  style="width:100%;height:820px;border:none;border-radius:16px;"
  allow="microphone; clipboard-write"
  loading="eager">
</iframe>`;

  const copyEmbedSnippet = async () => {
    try {
      await navigator.clipboard.writeText(embedCode);
      setCopiedEmbed(true);
      setTimeout(() => setCopiedEmbed(false), 1600);
    } catch {
      // Ignore clipboard failures
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Engine and Settings">
      <div className="modal-card">
        <div className="modal-head">
          <h2>Ask Avi · Engine &amp; Settings</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close settings">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <section className="settings-section">
            <div className="settings-section-title">
              <Cpu size={16} />
              <h3>In-Browser WebGPU Neural Models</h3>
            </div>
            <p className="settings-desc">
              {webGpuSupported
                ? 'Your browser supports WebGPU. Neural weights download directly into browser CacheStorage once and run 100% client-side with zero API keys.'
                : webGpuReason || 'WebGPU is unavailable in this browser; Instant Sovereign Archive Mode runs seamlessly everywhere.'}
            </p>

            <div className="model-cache-list">
              {ENGINE_OPTIONS.filter((o) => o.requiresWebGPU).map((opt) => {
                const cached = Boolean(cachedModels[opt.id]);
                const isLoading =
                  modelProgress.status === 'loading' && modelProgress.engineId === opt.id;

                return (
                  <div key={opt.id} className="cache-row">
                    <div>
                      <strong>{opt.shortName}</strong>
                      <span>
                        {opt.badge} · {cached ? 'Cached locally ✓' : 'Not cached yet'}
                      </span>
                    </div>
                    <div className="cache-row-actions">
                      {isLoading ? (
                        <span className="loading-inline">
                          {Math.round(modelProgress.progress * 100)}%
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="btn-secondary-sm"
                          disabled={!webGpuSupported}
                          onClick={() => onPreloadModel(opt.id)}
                        >
                          {cached ? 'Load' : 'Download'}
                        </button>
                      )}
                      {cached && (
                        <button
                          type="button"
                          className="mini-icon-btn danger"
                          onClick={() => onClearModelCache(opt.id)}
                          title="Delete cached model"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="settings-section">
            <div className="settings-section-title">
              <KeyRound size={16} />
              <h3>Optional Custom API / Local Ollama (BYOK)</h3>
            </div>
            <p className="settings-desc">
              Optional for power users: connect an OpenAI-compatible endpoint (stored only in your browser&apos;s{' '}
              <code>localStorage</code>) when selecting &ldquo;Custom API&rdquo; in the top model switcher.
            </p>
            <div className="settings-form-grid">
              <label>
                <span>Base Endpoint URL</span>
                <input
                  type="url"
                  value={settings.customApi.endpointUrl}
                  placeholder="https://api.openai.com/v1 or http://localhost:11434/v1"
                  onChange={(e) =>
                    onUpdateSettings({
                      ...settings,
                      customApi: { ...settings.customApi, endpointUrl: e.target.value },
                    })
                  }
                />
              </label>
              <label>
                <span>Model ID</span>
                <input
                  type="text"
                  value={settings.customApi.modelName}
                  placeholder="gpt-4o-mini / llama3.2 / gemini-2.5-flash"
                  onChange={(e) =>
                    onUpdateSettings({
                      ...settings,
                      customApi: { ...settings.customApi, modelName: e.target.value },
                    })
                  }
                />
              </label>
              <label>
                <span>API Key (optional for local Ollama)</span>
                <input
                  type="password"
                  value={settings.customApi.apiKey}
                  placeholder="sk-..."
                  onChange={(e) =>
                    onUpdateSettings({
                      ...settings,
                      customApi: { ...settings.customApi, apiKey: e.target.value },
                    })
                  }
                />
              </label>
            </div>
          </section>

          <section className="settings-section">
            <div className="settings-section-title">
              <Code2 size={16} />
              <h3>Embed on aviperera.com</h3>
            </div>
            <p className="settings-desc">
              Use the iframe below or the dedicated <code>embed/page-ask-avi.php</code> WordPress Kadence template included in the repository.
            </p>
            <pre className="embed-pre">{embedCode}</pre>
            <button type="button" className="btn-secondary-sm" onClick={copyEmbedSnippet}>
              {copiedEmbed ? <Check size={13} /> : <Copy size={13} />}
              <span>{copiedEmbed ? 'Copied Snippet' : 'Copy Embed Code'}</span>
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
