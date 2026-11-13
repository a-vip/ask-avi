import {
  Activity,
  AlertTriangle,
  BarChart3,
  Check,
  Code2,
  Copy,
  Download,
  Globe,
  KeyRound,
  Moon,
  RefreshCw,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Trash2,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { VOICE_STYLES } from '../data/persona';
import { resolveEffectiveProxyUrl } from '../engine/llmService';
import type { AppSettings, UserProfile } from '../types/chat';
import {
  exportUsersAsCsv,
  fetchAdminOverview,
  isVerifiedAdmin,
  type AdminOverviewResponse,
} from '../utils/authClient';

type SettingsTab = 'general' | 'admin' | 'developer';

interface SettingsModalProps {
  isOpen: boolean;
  settings: AppSettings;
  theme?: 'dark' | 'light';
  userProfile?: UserProfile | null;
  onClose: () => void;
  onUpdateSettings: (next: AppSettings) => void;
  onToggleTheme?: () => void;
  onOpenSignIn?: () => void;
  onClearAllThreads?: () => void;
  onExportAllThreads?: () => void;
}

export function SettingsModal({
  isOpen,
  settings,
  theme = 'dark',
  userProfile = null,
  onClose,
  onUpdateSettings,
  onToggleTheme,
  onOpenSignIn,
  onClearAllThreads,
  onExportAllThreads,
}: SettingsModalProps) {
  const isAdmin = isVerifiedAdmin(userProfile);
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [copiedEmbed, setCopiedEmbed] = useState(false);
  const [confirmClearChats, setConfirmClearChats] = useState(false);

  const [overview, setOverview] = useState<AdminOverviewResponse | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState('');
  const [logFilter, setLogFilter] = useState<'all' | 'errors'>('all');

  const loadAdminOverview = useCallback(async () => {
    if (!isAdmin) return;
    setOverviewLoading(true);
    setOverviewError('');
    try {
      const data = await fetchAdminOverview(userProfile?.sessionToken, settings.proxyUrl);
      setOverview(data);
    } catch (err) {
      setOverviewError(
        err instanceof Error ? err.message : 'Unable to load admin backend analytics.'
      );
    } finally {
      setOverviewLoading(false);
    }
  }, [isAdmin, settings.proxyUrl, userProfile?.sessionToken]);

  useEffect(() => {
    if (!isOpen) {
      setConfirmClearChats(false);
      return;
    }
    if (!isAdmin && activeTab !== 'general') {
      setActiveTab('general');
    }
  }, [activeTab, isAdmin, isOpen]);

  useEffect(() => {
    if (isOpen && isAdmin && activeTab === 'admin') {
      void loadAdminOverview();
    }
  }, [activeTab, isAdmin, isOpen, loadAdminOverview]);

  if (!isOpen) return null;

  const effectiveTab: SettingsTab = isAdmin ? activeTab : 'general';
  const detectedProxy = resolveEffectiveProxyUrl(settings.proxyUrl);

  const wpEmbedCode = `<!-- Native WordPress / Hostinger installation lives directly at https://aviperera.com/ask-avi/ -->
<iframe
  src="https://aviperera.com/ask-avi/?embed=1"
  title="Ask Avi — AI Persona of Avi Perera"
  style="width:100%;height:820px;border:none;border-radius:16px;"
  allow="microphone; clipboard-write"
  loading="eager">
</iframe>`;

  const copyEmbedSnippet = async () => {
    try {
      await navigator.clipboard.writeText(wpEmbedCode);
      setCopiedEmbed(true);
      window.setTimeout(() => setCopiedEmbed(false), 1800);
    } catch {
      // Clipboard blocked in some embedded contexts
    }
  };

  const handleDownloadUsersCsv = () => {
    if (!overview?.users) return;
    const csv = exportUsersAsCsv(overview.users);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `ask-avi-users-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const filteredLogs = (overview?.logs ?? []).filter((entry) =>
    logFilter === 'errors' ? entry.level === 'error' || entry.level === 'warn' : true
  );

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={isAdmin ? 'Ask Avi Admin & Settings' : 'Settings'}
    >
      <div className={`modal-card ${isAdmin ? 'modal-card-lg' : ''}`}>
        <div className="modal-head">
          <div className="modal-head-title-wrap">
            <h2>{isAdmin ? 'Ask Avi · Settings & Admin' : 'Settings'}</h2>
            {isAdmin && (
              <span className="admin-verified-pill">
                <ShieldCheck size={12} />
                <span>Admin ({userProfile?.email})</span>
              </span>
            )}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close settings">
            <X size={18} />
          </button>
        </div>

        {isAdmin && (
          <div className="settings-tabs" role="tablist" aria-label="Settings sections">
            <button
              type="button"
              role="tab"
              aria-selected={effectiveTab === 'general'}
              className={`settings-tab-btn ${effectiveTab === 'general' ? 'active' : ''}`}
              onClick={() => setActiveTab('general')}
            >
              <SlidersHorizontal size={14} />
              <span>General</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={effectiveTab === 'admin'}
              className={`settings-tab-btn ${effectiveTab === 'admin' ? 'active' : ''}`}
              onClick={() => setActiveTab('admin')}
            >
              <BarChart3 size={14} />
              <span>Admin &amp; Analytics</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={effectiveTab === 'developer'}
              className={`settings-tab-btn ${effectiveTab === 'developer' ? 'active' : ''}`}
              onClick={() => setActiveTab('developer')}
            >
              <KeyRound size={14} />
              <span>APIs &amp; Deployment</span>
            </button>
          </div>
        )}

        <div className="modal-body">
          {effectiveTab === 'general' && (
            <>
              {onToggleTheme && (
                <section className="settings-section">
                  <div className="settings-section-title">
                    {theme === 'dark' ? <Moon size={16} /> : <Sun size={16} />}
                    <h3>Appearance</h3>
                  </div>
                  <p className="settings-desc">
                    Switch between obsidian dark mode and crisp daylight contrast.
                  </p>
                  <div className="theme-choice-grid">
                    <button
                      type="button"
                      className={`theme-choice-btn ${theme === 'dark' ? 'active' : ''}`}
                      onClick={() => {
                        if (theme !== 'dark') onToggleTheme();
                      }}
                    >
                      <Moon size={15} />
                      <span>Dark</span>
                    </button>
                    <button
                      type="button"
                      className={`theme-choice-btn ${theme === 'light' ? 'active' : ''}`}
                      onClick={() => {
                        if (theme !== 'light') onToggleTheme();
                      }}
                    >
                      <Sun size={15} />
                      <span>Light</span>
                    </button>
                  </div>
                </section>
              )}

              <section className="settings-section">
                <div className="settings-section-title">
                  <Sparkles size={16} />
                  <h3>Default Response Style</h3>
                </div>
                <p className="settings-desc">
                  Choose the conversational tone Avi uses when starting new threads.
                </p>
                <div className="voice-choice-grid">
                  {VOICE_STYLES.map((voice) => {
                    const selected = settings.voiceStyle === voice.id;
                    return (
                      <button
                        key={voice.id}
                        type="button"
                        className={`voice-choice-card ${selected ? 'active' : ''}`}
                        onClick={() =>
                          onUpdateSettings({
                            ...settings,
                            voiceStyle: voice.id,
                          })
                        }
                      >
                        <div className="voice-choice-top">
                          <strong>{voice.label}</strong>
                          {selected && <Check size={14} />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="settings-section">
                <div className="settings-section-title">
                  <Globe size={16} />
                  <h3>Research &amp; Live Web Context</h3>
                </div>
                <label className="settings-toggle">
                  <span>Include live open-web verification &amp; citations in answers</span>
                  <input
                    type="checkbox"
                    checked={settings.webSearchEnabled}
                    onChange={(e) =>
                      onUpdateSettings({ ...settings, webSearchEnabled: e.target.checked })
                    }
                  />
                </label>
              </section>

              <section className="settings-section">
                <div className="settings-section-title">
                  <UserCheck size={16} />
                  <h3>Account</h3>
                </div>
                {userProfile ? (
                  <div className="settings-account-card">
                    <div>
                      <div className="settings-account-name">{userProfile.name}</div>
                      <div className="settings-account-email">
                        {userProfile.email}
                        {userProfile.provider ? ` · Signed in via ${userProfile.provider}` : ''}
                      </div>
                    </div>
                    {onOpenSignIn && (
                      <button
                        type="button"
                        className="btn-secondary-sm"
                        onClick={() => {
                          onClose();
                          onOpenSignIn();
                        }}
                      >
                        Manage
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="settings-account-card">
                    <div>
                      <div className="settings-account-name">Guest session</div>
                      <div className="settings-account-email">
                        Sign in or create an account with Google or Email.
                      </div>
                    </div>
                    {onOpenSignIn && (
                      <button
                        type="button"
                        className="btn-primary-sm"
                        onClick={() => {
                          onClose();
                          onOpenSignIn();
                        }}
                      >
                        Sign in
                      </button>
                    )}
                  </div>
                )}
              </section>

              {(onExportAllThreads || onClearAllThreads) && (
                <section className="settings-section">
                  <div className="settings-section-title">
                    <Trash2 size={16} />
                    <h3>Conversation History</h3>
                  </div>
                  <p className="settings-desc">
                    Conversations are saved locally in this browser. Export a backup or clear saved threads at any time.
                  </p>
                  <div className="modal-actions-row">
                    {onExportAllThreads && (
                      <button
                        type="button"
                        className="btn-secondary-sm"
                        onClick={onExportAllThreads}
                      >
                        <Download size={14} />
                        <span>Export chats (JSON)</span>
                      </button>
                    )}
                    {onClearAllThreads &&
                      (confirmClearChats ? (
                        <button
                          type="button"
                          className="btn-danger-sm"
                          onClick={() => {
                            onClearAllThreads();
                            setConfirmClearChats(false);
                          }}
                        >
                          <Trash2 size={14} />
                          <span>Confirm clear all chats</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn-secondary-sm"
                          onClick={() => setConfirmClearChats(true)}
                        >
                          <Trash2 size={14} />
                          <span>Clear chat history</span>
                        </button>
                      ))}
                  </div>
                </section>
              )}
            </>
          )}

          {isAdmin && effectiveTab === 'admin' && (
            <>
              <div className="admin-toolbar">
                <div className="admin-toolbar-title">
                  <Activity size={16} />
                  <span>Live Visitor Registry &amp; Diagnostics</span>
                </div>
                <div className="admin-toolbar-actions">
                  <button
                    type="button"
                    className="btn-secondary-sm"
                    onClick={() => void loadAdminOverview()}
                    disabled={overviewLoading}
                  >
                    <RefreshCw size={13} className={overviewLoading ? 'spin-icon' : ''} />
                    <span>{overviewLoading ? 'Refreshing…' : 'Refresh'}</span>
                  </button>
                  <button
                    type="button"
                    className="btn-primary-sm"
                    onClick={handleDownloadUsersCsv}
                    disabled={!overview || overview.users.length === 0}
                  >
                    <Download size={13} />
                    <span>Export Users CSV</span>
                  </button>
                </div>
              </div>

              {overviewError && (
                <div className="inline-alert error">
                  <AlertTriangle size={15} />
                  <span>{overviewError}</span>
                </div>
              )}

              {overview && (
                <>
                  <div className="admin-kpi-grid">
                    <div className="admin-kpi-card">
                      <span className="admin-kpi-label">Signed-Up Users</span>
                      <strong className="admin-kpi-value">{overview.stats.totalUsers}</strong>
                    </div>
                    <div className="admin-kpi-card">
                      <span className="admin-kpi-label">Mailing List Opt-Ins</span>
                      <strong className="admin-kpi-value">
                        {overview.stats.marketingOptInCount}
                      </strong>
                    </div>
                    <div className="admin-kpi-card">
                      <span className="admin-kpi-label">24h / Total Chats</span>
                      <strong className="admin-kpi-value">
                        {overview.stats.last24hChats} / {overview.stats.totalChats}
                      </strong>
                    </div>
                    <div className="admin-kpi-card">
                      <span className="admin-kpi-label">Logged Errors</span>
                      <strong
                        className={`admin-kpi-value ${
                          overview.stats.errorCount > 0 ? 'has-errors' : ''
                        }`}
                      >
                        {overview.stats.errorCount}
                      </strong>
                    </div>
                  </div>

                  <section className="settings-section">
                    <div className="settings-section-title">
                      <Server size={16} />
                      <h3>Backend Provider Health</h3>
                    </div>
                    <div className="admin-health-pills">
                      {Object.entries(overview.serverKeys).map(([key, enabled]) => (
                        <span
                          key={key}
                          className={`health-pill ${enabled ? 'online' : 'offline'}`}
                        >
                          <span className="health-dot" />
                          <span>
                            {key}: {enabled ? 'Configured' : 'Unset'}
                          </span>
                        </span>
                      ))}
                    </div>
                  </section>

                  <section className="settings-section">
                    <div className="settings-section-title">
                      <Users size={16} />
                      <h3>Registered Users ({overview.users.length})</h3>
                    </div>
                    {overview.users.length === 0 ? (
                      <p className="settings-desc">No registered users recorded yet.</p>
                    ) : (
                      <div className="admin-table-wrap">
                        <table className="admin-table">
                          <thead>
                            <tr>
                              <th>User</th>
                              <th>Provider</th>
                              <th>List</th>
                              <th>Chats</th>
                              <th>Last Seen</th>
                            </tr>
                          </thead>
                          <tbody>
                            {overview.users.map((u) => (
                              <tr key={u.id}>
                                <td>
                                  <div className="admin-user-cell">
                                    <strong>{u.name}</strong>
                                    <span>{u.email}</span>
                                  </div>
                                </td>
                                <td>
                                  <span className="admin-badge">{u.provider}</span>
                                </td>
                                <td>{u.marketingOptIn ? 'Yes' : 'No'}</td>
                                <td>
                                  {u.chatCount}
                                  {u.errorCount > 0 ? ` (${u.errorCount} err)` : ''}
                                </td>
                                <td>{new Date(u.lastSeenAt).toLocaleString()}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>

                  <section className="settings-section">
                    <div className="admin-section-header">
                      <div className="settings-section-title">
                        <AlertTriangle size={16} />
                        <h3>Troubleshooting &amp; Request Logs ({filteredLogs.length})</h3>
                      </div>
                      <div className="admin-filter-pills">
                        <button
                          type="button"
                          className={`filter-chip ${logFilter === 'all' ? 'active' : ''}`}
                          onClick={() => setLogFilter('all')}
                        >
                          All
                        </button>
                        <button
                          type="button"
                          className={`filter-chip ${logFilter === 'errors' ? 'active' : ''}`}
                          onClick={() => setLogFilter('errors')}
                        >
                          Errors &amp; Warnings
                        </button>
                      </div>
                    </div>

                    {filteredLogs.length === 0 ? (
                      <p className="settings-desc">No matching log events recorded.</p>
                    ) : (
                      <div className="admin-logs-list">
                        {filteredLogs.map((log) => (
                          <div key={log.id} className={`admin-log-row level-${log.level}`}>
                            <div className="admin-log-meta">
                              <span className={`log-level-pill level-${log.level}`}>
                                {log.type}
                              </span>
                              <span className="log-user">{log.userEmail}</span>
                              {log.modelUsed && <span className="log-model">{log.modelUsed}</span>}
                              <span className="log-time">
                                {new Date(log.ts).toLocaleTimeString()}
                              </span>
                            </div>
                            <p className="admin-log-msg">{log.message}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </>
              )}
            </>
          )}

          {isAdmin && effectiveTab === 'developer' && (
            <>
              <section className="settings-section">
                <div className="settings-section-title">
                  <Sparkles size={16} />
                  <h3>Free Open-Source AI Providers (Browser Override)</h3>
                </div>
                <p className="settings-desc">
                  Production visitors use your server-side keys in PHP (
                  <code>api/chat.php</code>) or Node (<code>.env.local</code>). Values below override locally in your admin browser only.
                </p>

                <label className="settings-field">
                  <span>
                    Groq Free Key — up to 1,000 req/day (
                    <a
                      href="https://console.groq.com/keys"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      console.groq.com/keys
                    </a>
                    )
                  </span>
                  <input
                    type="password"
                    autoComplete="off"
                    placeholder="gsk_... (saved locally in this admin browser)"
                    value={settings.groqApiKey ?? ''}
                    onChange={(e) =>
                      onUpdateSettings({ ...settings, groqApiKey: e.target.value })
                    }
                  />
                </label>

                <label className="settings-field">
                  <span>
                    OpenRouter Free Key — 550B &amp; Gemma 4 :free (
                    <a
                      href="https://openrouter.ai/keys"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      openrouter.ai/keys
                    </a>
                    )
                  </span>
                  <input
                    type="password"
                    autoComplete="off"
                    placeholder="sk-or-v1-... (saved locally in this admin browser)"
                    value={settings.openRouterApiKey ?? ''}
                    onChange={(e) =>
                      onUpdateSettings({ ...settings, openRouterApiKey: e.target.value })
                    }
                  />
                </label>

                <label className="settings-toggle">
                  <span>Live Internet Search &amp; Reference Grounding</span>
                  <input
                    type="checkbox"
                    checked={settings.webSearchEnabled}
                    onChange={(e) =>
                      onUpdateSettings({ ...settings, webSearchEnabled: e.target.checked })
                    }
                  />
                </label>
              </section>

              <section className="settings-section">
                <div className="settings-section-title">
                  <Server size={16} />
                  <h3>Backend Proxy Endpoint</h3>
                </div>
                <p className="settings-desc">
                  Active origin endpoint: <code>{detectedProxy || 'none (static mirror)'}</code>. On Hostinger WordPress (<code>aviperera.com/ask-avi</code>), <code>./api/chat</code> and <code>./api/auth</code> run directly on PHP without Vercel.
                </p>
                <label className="settings-field">
                  <span>Custom Proxy Endpoint Override</span>
                  <input
                    type="url"
                    placeholder="./api/chat"
                    value={settings.proxyUrl ?? ''}
                    onChange={(e) =>
                      onUpdateSettings({ ...settings, proxyUrl: e.target.value })
                    }
                  />
                </label>
              </section>

              <section className="settings-section">
                <div className="settings-section-title">
                  <Sparkles size={16} />
                  <h3>Google Gemini (Optional Model Switcher)</h3>
                </div>
                <label className="settings-field">
                  <span>Gemini API Key Override (Google AI Studio)</span>
                  <input
                    type="password"
                    autoComplete="off"
                    placeholder="AIza... or AQ..."
                    value={settings.geminiApiKey ?? ''}
                    onChange={(e) =>
                      onUpdateSettings({ ...settings, geminiApiKey: e.target.value })
                    }
                  />
                </label>
              </section>

              <section className="settings-section">
                <div className="settings-section-title">
                  <KeyRound size={16} />
                  <h3>Custom OpenAI-Compatible Endpoint</h3>
                </div>
                <label className="settings-field">
                  <span>Base Endpoint URL</span>
                  <input
                    type="url"
                    placeholder="https://api.together.xyz/v1/chat/completions"
                    value={settings.customApi.endpointUrl}
                    onChange={(e) =>
                      onUpdateSettings({
                        ...settings,
                        customApi: { ...settings.customApi, endpointUrl: e.target.value },
                      })
                    }
                  />
                </label>
                <div className="settings-grid-2">
                  <label className="settings-field">
                    <span>API Key</span>
                    <input
                      type="password"
                      autoComplete="off"
                      placeholder="sk-..."
                      value={settings.customApi.apiKey}
                      onChange={(e) =>
                        onUpdateSettings({
                          ...settings,
                          customApi: { ...settings.customApi, apiKey: e.target.value },
                        })
                      }
                    />
                  </label>
                  <label className="settings-field">
                    <span>Model ID</span>
                    <input
                      type="text"
                      placeholder="Qwen/Qwen2.5-72B-Instruct"
                      value={settings.customApi.modelName}
                      onChange={(e) =>
                        onUpdateSettings({
                          ...settings,
                          customApi: { ...settings.customApi, modelName: e.target.value },
                        })
                      }
                    />
                  </label>
                </div>
              </section>

              <section className="settings-section">
                <div className="settings-section-title">
                  <Code2 size={16} />
                  <h3>Embed in WordPress (aviperera.com/ask-avi)</h3>
                </div>
                <p className="settings-desc">
                  Recommended: publish the native WordPress bundle in <code>embed/hostinger-wp/</code> to serve directly at <code>https://aviperera.com/ask-avi/</code>. Or copy the iframe snippet:
                </p>
                <div className="embed-box">
                  <pre>
                    <code>{wpEmbedCode}</code>
                  </pre>
                  <button type="button" className="copy-embed-btn" onClick={copyEmbedSnippet}>
                    {copiedEmbed ? <Check size={14} /> : <Copy size={14} />}
                    <span>{copiedEmbed ? 'Copied' : 'Copy HTML'}</span>
                  </button>
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
