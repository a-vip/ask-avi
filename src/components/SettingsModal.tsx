import { Check, Code2, Copy, Globe, KeyRound, Server, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { resolveEffectiveProxyUrl } from '../engine/llmService';
import type { AppSettings } from '../types/chat';

interface SettingsModalProps {
  isOpen: boolean;
  settings: AppSettings;
  onClose: () => void;
  onUpdateSettings: (next: AppSettings) => void;
}

export function SettingsModal({
  isOpen,
  settings,
  onClose,
  onUpdateSettings,
}: SettingsModalProps) {
  const [copiedEmbed, setCopiedEmbed] = useState(false);

  if (!isOpen) return null;

  const detectedProxy = resolveEffectiveProxyUrl(settings.proxyUrl);

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
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Ask Avi Settings">
      <div className="modal-card">
        <div className="modal-head">
          <h2>Ask Avi · Settings</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close settings">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <section className="settings-section">
            <div className="settings-section-title">
              <Sparkles size={16} />
              <h3>Gemini 3 &amp; 4 Thinking + Live Web Search</h3>
            </div>
            <p className="settings-desc">
              Powers open-ended philosophical, technical, and current-affairs conversations in Avi&apos;s voice using extended reasoning and live web grounding.
            </p>

            <div className="settings-form-grid">
              <label>
                <span>
                  Gemini API Key (saved only in your browser — get a key at{' '}
                  <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">
                    Google AI Studio
                  </a>
                  )
                </span>
                <input
                  type="password"
                  value={settings.geminiApiKey}
                  placeholder="AQ... or AIza..."
                  onChange={(e) =>
                    onUpdateSettings({
                      ...settings,
                      geminiApiKey: e.target.value,
                    })
                  }
                />
              </label>

              <label className="settings-toggle-row">
                <span className="toggle-label-wrap">
                  <Globe size={14} />
                  <span>Live Google Search Grounding (entire internet access)</span>
                </span>
                <input
                  type="checkbox"
                  checked={settings.webSearchEnabled}
                  onChange={(e) =>
                    onUpdateSettings({
                      ...settings,
                      webSearchEnabled: e.target.checked,
                    })
                  }
                />
              </label>
            </div>
          </section>

          <section className="settings-section">
            <div className="settings-section-title">
              <Server size={16} />
              <h3>Public Serverless Proxy (For aviperera.com Visitors)</h3>
            </div>
            <p className="settings-desc">
              For zero-key public access on <code>aviperera.com</code> and GitHub Pages, deploy the included{' '}
              <code>api/chat.ts</code> (Vercel) or <code>worker/src/index.ts</code> (Cloudflare Workers) with your{' '}
              <code>GEMINI_API_KEY</code> env variable and set <code>ASK_AVI_API_ENDPOINT</code> in GitHub repository variables (or override below).
            </p>
            <div className="settings-form-grid">
              <label>
                <span>Proxy Endpoint URL {detectedProxy ? `(active: ${detectedProxy})` : ''}</span>
                <input
                  type="url"
                  value={settings.proxyUrl}
                  placeholder="https://ask-avi-api.vercel.app/api/chat"
                  onChange={(e) =>
                    onUpdateSettings({
                      ...settings,
                      proxyUrl: e.target.value,
                    })
                  }
                />
              </label>
            </div>
          </section>

          <section className="settings-section">
            <div className="settings-section-title">
              <KeyRound size={16} />
              <h3>Optional Custom OpenAI-Compatible Endpoint</h3>
            </div>
            <p className="settings-desc">
              Optional override when &ldquo;Custom API&rdquo; is selected in the model switcher.
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
                  placeholder="gpt-4o / claude-sonnet-4-5 / deepseek-reasoner"
                  onChange={(e) =>
                    onUpdateSettings({
                      ...settings,
                      customApi: { ...settings.customApi, modelName: e.target.value },
                    })
                  }
                />
              </label>
              <label>
                <span>API Key</span>
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
