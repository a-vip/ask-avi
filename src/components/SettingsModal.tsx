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
              <h3>Free Open-Source AI Providers (Default · No Card Required)</h3>
            </div>
            <p className="settings-desc">
              Runs open-weights reasoning flagships (<code>GPT-OSS 120B</code>, <code>Qwen3 32B</code>,{' '}
              <code>Nemotron 3 Ultra 550B</code>, <code>Gemma 4 31B</code>, <code>Llama 3.3 70B</code>) completely free. Connect one or both for automatic failover across rate limits, plus live open-web grounding.
            </p>

            <div className="settings-form-grid">
              <label>
                <span>
                  Groq Free Key — up to 1,000 req/day, ultra-fast (get a $0 key at{' '}
                  <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer">
                    console.groq.com/keys
                  </a>
                  )
                </span>
                <input
                  type="password"
                  value={settings.groqApiKey}
                  placeholder="gsk_..."
                  onChange={(e) =>
                    onUpdateSettings({
                      ...settings,
                      groqApiKey: e.target.value,
                    })
                  }
                />
              </label>

              <label>
                <span>
                  OpenRouter Free Key — 550B &amp; Gemma 4 <code>:free</code> models (get a $0 key at{' '}
                  <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer">
                    openrouter.ai/keys
                  </a>
                  )
                </span>
                <input
                  type="password"
                  value={settings.openRouterApiKey}
                  placeholder="sk-or-v1-..."
                  onChange={(e) =>
                    onUpdateSettings({
                      ...settings,
                      openRouterApiKey: e.target.value,
                    })
                  }
                />
              </label>

              <label className="settings-toggle-row">
                <span className="toggle-label-wrap">
                  <Globe size={14} />
                  <span>Live Internet Search &amp; Reference Grounding</span>
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
              <h3>Zero-Key Public Proxy for aviperera.com Visitors</h3>
            </div>
            <p className="settings-desc">
              For visitors on <code>aviperera.com</code> with zero API keys needed on their side, deploy{' '}
              <code>worker/src/index.ts</code> (Cloudflare Workers AI gives <strong>10,000 free Neurons/day</strong> built in via <code>[ai]</code> with zero external keys, plus optional <code>GROQ_API_KEY</code> / <code>OPENROUTER_API_KEY</code> / <code>GEMINI_API_KEY</code>) or <code>api/chat.ts</code> (Vercel), then set <code>ASK_AVI_API_ENDPOINT</code> in GitHub repository variables.
            </p>
            <div className="settings-form-grid">
              <label>
                <span>Proxy Endpoint URL {detectedProxy ? `(active: ${detectedProxy})` : ''}</span>
                <input
                  type="url"
                  value={settings.proxyUrl}
                  placeholder="https://ask-avi-api.<your-subdomain>.workers.dev"
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
              <Sparkles size={16} />
              <h3>Google Gemini (Optional Model Switcher Option)</h3>
            </div>
            <p className="settings-desc">
              Powers the optional <code>Gemini 3 Flash</code> &amp; <code>Gemini 4 Hydrogen</code> entries in the top model dropdown.
            </p>
            <div className="settings-form-grid">
              <label>
                <span>
                  Gemini API Key (saved only in your browser —{' '}
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
