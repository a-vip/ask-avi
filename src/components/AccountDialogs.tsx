import { BookOpen, ExternalLink, HelpCircle, Info, KeyRound, Mail, UserCheck, X } from 'lucide-react';
import { useState } from 'react';
import { VERIFIED_LINKS } from '../data/persona';
import type { UserProfile } from '../types/chat';

interface SignInModalProps {
  isOpen: boolean;
  currentProfile: UserProfile | null;
  onClose: () => void;
  onSignIn: (profile: UserProfile) => void;
  onSignOut: () => void;
}

export function SignInModal({
  isOpen,
  currentProfile,
  onClose,
  onSignIn,
  onSignOut,
}: SignInModalProps) {
  const [name, setName] = useState(currentProfile?.name ?? '');
  const [email, setEmail] = useState(currentProfile?.email ?? '');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) return;
    onSignIn({
      name: cleanName,
      email: email.trim() || undefined,
      signedInAt: Date.now(),
    });
    onClose();
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Sign in to Ask Avi">
      <div className="modal-card modal-card-sm">
        <div className="modal-head">
          <h2>{currentProfile ? 'Account profile' : 'Sign in to Ask Avi'}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <form className="modal-body" onSubmit={handleSubmit}>
          <p className="settings-desc">
            Personalize your workspace profile in this browser. Your name, profile details, and chat history stay strictly local and are never uploaded to third parties.
          </p>

          <div className="settings-form-grid">
            <label>
              <span>Display name</span>
              <input
                type="text"
                required
                autoFocus
                value={name}
                placeholder="e.g. Avi"
                onChange={(e) => setName(e.target.value)}
              />
            </label>

            <label>
              <span>Email (optional)</span>
              <input
                type="email"
                value={email}
                placeholder="you@domain.com"
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
          </div>

          <div className="modal-actions-row">
            {currentProfile && (
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
            <button type="submit" className="btn-primary-sm" disabled={!name.trim()}>
              <UserCheck size={14} />
              <span>{currentProfile ? 'Save profile' : 'Continue'}</span>
            </button>
          </div>
        </form>
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
                  Ask Avi is an open-ended conversational persona modeled after Avi Perera’s writing, legal research, and systems work. Use the model selector in the bottom-right of the chatbox to switch models or toggle live web lookup, and click <strong>Context</strong> to attach essays or your own files.
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
                  <h3>Direct Contact &amp; Configuration</h3>
                </div>
                <p className="settings-desc">
                  Need help embedding Ask Avi or connecting API keys? Open Settings or reach out to{' '}
                  <a href="mailto:workwithavip@gmail.com">workwithavip@gmail.com</a>.
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
                  Ask Avi pairs reasoning models with optional live open-web grounding and 108 indexed dossiers across International Humanitarian Law (LAWS), AI governance, philosophy, SovDash, and Lex Machina. Chats and optional browser keys remain in your own browser storage.
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
