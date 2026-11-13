import {
  AlertCircle,
  BookOpen,
  ExternalLink,
  HelpCircle,
  Info,
  KeyRound,
  Mail,
  ShieldCheck,
  UserCheck,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { VERIFIED_LINKS } from '../data/persona';
import type { UserProfile } from '../types/chat';
import {
  ADMIN_EMAIL,
  isVerifiedAdmin,
  loadGoogleIdentityScript,
  resolveEffectiveAuthUrl,
  signInWithEmail,
  signInWithGoogleCredential,
  signUpWithEmail,
  type AuthConfigResponse,
} from '../utils/authClient';

interface SignInModalProps {
  isOpen: boolean;
  currentProfile: UserProfile | null;
  authConfig?: AuthConfigResponse | null;
  proxyUrl?: string;
  onClose: () => void;
  onSignIn: (profile: UserProfile) => void;
  onSignOut: () => void;
}

export function SignInModal({
  isOpen,
  currentProfile,
  authConfig = null,
  proxyUrl,
  onClose,
  onSignIn,
  onSignOut,
}: SignInModalProps) {
  const [authTab, setAuthTab] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [adminPasscode, setAdminPasscode] = useState('');
  const [marketingOptIn, setMarketingOptIn] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [googleLoadFailed, setGoogleLoadFailed] = useState(false);

  const googleBtnRef = useRef<HTMLDivElement>(null);

  const hasBackendAuth = Boolean(resolveEffectiveAuthUrl(proxyUrl));
  const needsAdminPasscode = email.trim().toLowerCase() === ADMIN_EMAIL;
  const googleClientId = authConfig?.googleClientId?.trim() || '';

  useEffect(() => {
    if (!isOpen) {
      setErrorMsg('');
      setPassword('');
      setAdminPasscode('');
      return;
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || currentProfile || !googleClientId) return;
    let cancelled = false;
    setGoogleLoadFailed(false);

    loadGoogleIdentityScript()
      .then(() => {
        if (cancelled || !googleBtnRef.current) return;
        const gWindow = window as unknown as {
          google?: {
            accounts?: {
              id?: {
                initialize: (cfg: {
                  client_id: string;
                  callback: (res: { credential?: string }) => void;
                }) => void;
                renderButton: (
                  parent: HTMLElement,
                  options: Record<string, string | number>
                ) => void;
              };
            };
          };
        };
        const gis = gWindow.google?.accounts?.id;
        if (!gis) return;

        gis.initialize({
          client_id: googleClientId,
          callback: async (response: { credential?: string }) => {
            if (!response.credential || cancelled) return;
            setSubmitting(true);
            setErrorMsg('');
            try {
              const verified = await signInWithGoogleCredential(
                response.credential,
                marketingOptIn,
                proxyUrl
              );
              onSignIn(verified);
              onClose();
            } catch (err) {
              setErrorMsg(
                err instanceof Error ? err.message : 'Google Sign-In failed.'
              );
            } finally {
              setSubmitting(false);
            }
          },
        });

        googleBtnRef.current.innerHTML = '';
        gis.renderButton(googleBtnRef.current, {
          theme: 'outline',
          size: 'large',
          text: authTab === 'signup' ? 'signup_with' : 'signin_with',
          width: 340,
          shape: 'pill',
        });
      })
      .catch(() => {
        if (!cancelled) setGoogleLoadFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [
    authTab,
    currentProfile,
    googleClientId,
    isOpen,
    marketingOptIn,
    onClose,
    onSignIn,
    proxyUrl,
  ]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    const cleanEmail = email.trim().toLowerCase();
    const cleanName = name.trim();

    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleanEmail)) {
      setErrorMsg('Please enter a valid email address.');
      return;
    }

    if (!hasBackendAuth) {
      if (cleanEmail === ADMIN_EMAIL) {
        setErrorMsg(
          'Admin verification requires the Ask Avi backend on aviperera.com/ask-avi or local server.'
        );
        return;
      }
      onSignIn({
        name: cleanName || cleanEmail.split('@')[0],
        email: cleanEmail,
        provider: 'email',
        isAdmin: false,
        marketingOptIn,
        signedInAt: Date.now(),
      });
      onClose();
      return;
    }

    if (password.length < 6) {
      setErrorMsg('Password must be at least 6 characters.');
      return;
    }

    setSubmitting(true);
    try {
      const user =
        authTab === 'signup'
          ? await signUpWithEmail(
              {
                name: cleanName || cleanEmail.split('@')[0],
                email: cleanEmail,
                password,
                marketingOptIn,
                ...(needsAdminPasscode ? { adminPasscode } : {}),
              },
              proxyUrl
            )
          : await signInWithEmail(
              {
                email: cleanEmail,
                password,
                ...(needsAdminPasscode ? { adminPasscode } : {}),
              },
              proxyUrl
            );
      onSignIn(user);
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const isAdmin = isVerifiedAdmin(currentProfile);

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={currentProfile ? 'Account profile' : 'Sign in to Ask Avi'}
    >
      <div className="modal-card modal-card-sm">
        <div className="modal-head">
          <h2>
            {currentProfile
              ? 'Account'
              : authTab === 'signup'
                ? 'Create your account'
                : 'Sign in to Ask Avi'}
          </h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {currentProfile ? (
            <div className="signed-in-panel">
              <div className="signed-in-header">
                {currentProfile.picture ? (
                  <img
                    src={currentProfile.picture}
                    alt={currentProfile.name}
                    className="signed-in-avatar"
                  />
                ) : (
                  <div className="signed-in-avatar fallback">
                    {(currentProfile.name[0] || 'A').toUpperCase()}
                  </div>
                )}
                <div>
                  <div className="signed-in-name">
                    <span>{currentProfile.name}</span>
                    {isAdmin && (
                      <span className="admin-verified-pill">
                        <ShieldCheck size={11} />
                        <span>Admin</span>
                      </span>
                    )}
                  </div>
                  {currentProfile.email && (
                    <div className="signed-in-email">{currentProfile.email}</div>
                  )}
                  <div className="signed-in-meta">
                    Provider: {currentProfile.provider ?? 'email'}
                    {currentProfile.marketingOptIn ? ' · Updates enabled' : ''}
                  </div>
                </div>
              </div>

              <div className="modal-actions-row">
                {currentProfile.provider === 'wordpress' && authConfig?.wpLogoutUrl ? (
                  <a href={authConfig.wpLogoutUrl} className="btn-secondary-sm">
                    Sign out of WordPress
                  </a>
                ) : (
                  <button
                    type="button"
                    className="btn-secondary-sm"
                    onClick={() => {
                      onSignOut();
                      onClose();
                    }}
                  >
                    Sign out
                  </button>
                )}
                <button type="button" className="btn-primary-sm" onClick={onClose}>
                  Done
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="auth-mode-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={authTab === 'signin'}
                  className={`auth-mode-tab ${authTab === 'signin' ? 'active' : ''}`}
                  onClick={() => {
                    setAuthTab('signin');
                    setErrorMsg('');
                  }}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={authTab === 'signup'}
                  className={`auth-mode-tab ${authTab === 'signup' ? 'active' : ''}`}
                  onClick={() => {
                    setAuthTab('signup');
                    setErrorMsg('');
                  }}
                >
                  Create account
                </button>
              </div>

              {(googleClientId || (authConfig?.wpSsoEnabled && authConfig.wpLoginUrl)) && (
                <div className="auth-sso-group">
                  {googleClientId && !googleLoadFailed && (
                    <div ref={googleBtnRef} className="google-gsi-slot" />
                  )}
                  {googleClientId && googleLoadFailed && (
                    <p className="settings-desc">
                      Google Sign-In could not load in this browser context. Continue with email below.
                    </p>
                  )}
                  {authConfig?.wpSsoEnabled && authConfig.wpLoginUrl && (
                    <a href={authConfig.wpLoginUrl} className="wp-sso-btn">
                      <UserCheck size={15} />
                      <span>Continue with aviperera.com WordPress</span>
                    </a>
                  )}
                  <div className="auth-divider">
                    <span>or continue with email</span>
                  </div>
                </div>
              )}

              <form onSubmit={handleSubmit} className="settings-section">
                {authTab === 'signup' && (
                  <label className="settings-field">
                    <span>Full name</span>
                    <input
                      type="text"
                      placeholder="Your name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                )}

                <label className="settings-field">
                  <span>Email address</span>
                  <input
                    type="email"
                    required
                    placeholder="you@domain.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>

                {hasBackendAuth && (
                  <label className="settings-field">
                    <span>Password</span>
                    <input
                      type="password"
                      required
                      minLength={6}
                      placeholder={
                        authTab === 'signup' ? 'Create a password (min 6 chars)' : 'Enter password'
                      }
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </label>
                )}

                {hasBackendAuth && needsAdminPasscode && (
                  <label className="settings-field admin-passcode-field">
                    <span>Admin verification passcode</span>
                    <input
                      type="password"
                      required
                      placeholder="Required for workwithavip@gmail.com"
                      value={adminPasscode}
                      onChange={(e) => setAdminPasscode(e.target.value)}
                    />
                  </label>
                )}

                {authTab === 'signup' && (
                  <label className="auth-optin-label">
                    <input
                      type="checkbox"
                      checked={marketingOptIn}
                      onChange={(e) => setMarketingOptIn(e.target.checked)}
                    />
                    <span>Send me occasional essays, dispatches &amp; product updates from Avi Perera.</span>
                  </label>
                )}

                {errorMsg && (
                  <div className="inline-alert error">
                    <AlertCircle size={15} />
                    <span>{errorMsg}</span>
                  </div>
                )}

                <div className="modal-actions-row">
                  <button
                    type="submit"
                    className="btn-primary-sm full-width-btn"
                    disabled={submitting}
                  >
                    <UserCheck size={14} />
                    <span>
                      {submitting
                        ? 'Please wait…'
                        : authTab === 'signup'
                          ? 'Create account'
                          : 'Sign in'}
                    </span>
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

interface AccountInfoModalProps {
  mode: 'help' | 'about' | null;
  onClose: () => void;
  onOpenSettings: () => void;
  onOpenDossiers: () => void;
}

export function AccountInfoModal({
  mode,
  onClose,
  onOpenSettings,
  onOpenDossiers,
}: AccountInfoModalProps) {
  if (!mode) return null;

  const isHelp = mode === 'help';

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={isHelp ? 'Help & Shortcuts' : 'Learn More About Ask Avi'}
    >
      <div className="modal-card modal-card-sm">
        <div className="modal-head">
          <h2>{isHelp ? 'Help & Shortcuts' : 'About Ask Avi'}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {isHelp ? (
            <>
              <section className="settings-section">
                <div className="settings-section-title">
                  <HelpCircle size={16} />
                  <h3>Using Ask Avi</h3>
                </div>
                <p className="settings-desc">
                  Ask Avi is an open-ended conversational persona modeled after Avi Perera’s writing, legal research, and systems work. Use the selector in the bottom-right of the composer to switch modes or toggle live web lookup, and click <strong>Context</strong> to attach essays or your own files.
                </p>
              </section>

              <section className="settings-section">
                <div className="settings-section-title">
                  <KeyRound size={16} />
                  <h3>Keyboard Shortcuts</h3>
                </div>
                <div className="shortcut-list">
                  <div className="shortcut-row">
                    <span>Focus message input</span>
                    <kbd>/</kbd>
                  </div>
                  <div className="shortcut-row">
                    <span>New conversation</span>
                    <kbd>Ctrl+Shift+O</kbd>
                  </div>
                  <div className="shortcut-row">
                    <span>Open Settings</span>
                    <kbd>Ctrl+Shift+,</kbd>
                  </div>
                  <div className="shortcut-row">
                    <span>Send / New line</span>
                    <kbd>Enter / Shift+Enter</kbd>
                  </div>
                </div>
              </section>

              <section className="settings-section">
                <div className="settings-section-title">
                  <Mail size={16} />
                  <h3>Support &amp; Feedback</h3>
                </div>
                <p className="settings-desc">
                  Questions, feedback, or need help with an issue? Reach out directly to{' '}
                  <a href="mailto:workwithavip@gmail.com">workwithavip@gmail.com</a> or adjust your preferences in Settings.
                </p>
                <div className="modal-actions-row">
                  <button
                    type="button"
                    className="btn-primary-sm"
                    onClick={() => {
                      onClose();
                      onOpenSettings();
                    }}
                  >
                    Open Settings
                  </button>
                </div>
              </section>
            </>
          ) : (
            <>
              <section className="settings-section">
                <div className="settings-section-title">
                  <Info size={16} />
                  <h3>Persona, Grounding &amp; Privacy</h3>
                </div>
                <p className="settings-desc">
                  Ask Avi pairs generative reasoning with optional live open-web verification and 108 indexed dossiers across International Humanitarian Law (LAWS), AI governance, philosophy, SovDash, and Lex Machina. Conversation threads remain stored locally in your own browser.
                </p>
              </section>

              <section className="settings-section">
                <div className="settings-section-title">
                  <BookOpen size={16} />
                  <h3>Explore Avi’s Work</h3>
                </div>
                <div className="learn-links-grid">
                  <button
                    type="button"
                    className="learn-link-item"
                    onClick={() => {
                      onClose();
                      onOpenDossiers();
                    }}
                  >
                    <span>Browse Indexed Dossiers (108)</span>
                    <BookOpen size={14} />
                  </button>
                  {VERIFIED_LINKS.map((lnk) => (
                    <a
                      key={lnk.url}
                      href={lnk.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="learn-link-item"
                    >
                      <span>{lnk.label}</span>
                      <ExternalLink size={14} />
                    </a>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
