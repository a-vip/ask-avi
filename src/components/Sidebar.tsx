import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  HelpCircle,
  Info,
  LogIn,
  LogOut,
  MessageSquare,
  Moon,
  PanelLeftClose,
  Pencil,
  Pin,
  Plus,
  Search,
  Settings,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { KNOWLEDGE_META } from '../engine/rag';
import type { ChatThread, ThemeMode, UserProfile } from '../types/chat';
import { groupThreadsByRecency } from '../utils/storage';
import { AviAvatar } from './AviAvatar';

interface SidebarProps {
  isOpen: boolean;
  isMobile: boolean;
  threads: ChatThread[];
  activeThreadId: string | null;
  theme: ThemeMode;
  userProfile: UserProfile | null;
  onCloseMobile: () => void;
  onToggleCollapse: () => void;
  onNewChat: () => void;
  onSelectThread: (id: string) => void;
  onRenameThread: (id: string, title: string) => void;
  onPinThread: (id: string) => void;
  onDeleteThread: (id: string) => void;
  onOpenKnowledge: () => void;
  onOpenSettings: () => void;
  onToggleTheme: () => void;
  onOpenHelp: () => void;
  onOpenAbout: () => void;
  onOpenSignIn: () => void;
  onSignOut: () => void;
}

export function Sidebar({
  isOpen,
  isMobile,
  threads,
  activeThreadId,
  theme,
  userProfile,
  onCloseMobile,
  onToggleCollapse,
  onNewChat,
  onSelectThread,
  onRenameThread,
  onPinThread,
  onDeleteThread,
  onOpenKnowledge,
  onOpenSettings,
  onToggleTheme,
  onOpenHelp,
  onOpenAbout,
  onOpenSignIn,
  onSignOut,
}: SidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [accountOpen, setAccountOpen] = useState(false);
  const [learnExpanded, setLearnExpanded] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(e.target as Node)) {
        setAccountOpen(false);
        setLearnExpanded(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.messages.some((m) => m.content.toLowerCase().includes(q))
    );
  }, [threads, searchQuery]);

  const groups = useMemo(() => groupThreadsByRecency(filtered), [filtered]);

  if (!isOpen) return null;

  const commitRename = (id: string) => {
    const trimmed = draftTitle.trim();
    if (trimmed) onRenameThread(id, trimmed);
    setEditingId(null);
  };

  const displayName = userProfile?.name ?? 'Guest';
  const avatarInitial = displayName.charAt(0).toUpperCase();

  return (
    <>
      {isMobile && (
        <div
          className="sidebar-backdrop"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}
      <aside className={`sidebar ${isMobile ? 'sidebar-mobile' : ''}`} aria-label="Chat history">
        <div className="sidebar-header">
          <button
            type="button"
            className="brand-lockup"
            onClick={() => {
              onNewChat();
              if (isMobile) onCloseMobile();
            }}
            title="Start a new Ask Avi chat"
          >
            <AviAvatar size={30} />
            <div className="brand-text">
              <span className="brand-name">Ask Avi</span>
              <span className="brand-sub">aviperera.com</span>
            </div>
          </button>

          <button
            type="button"
            className="icon-btn"
            onClick={isMobile ? onCloseMobile : onToggleCollapse}
            title={isMobile ? 'Close sidebar' : 'Collapse sidebar'}
            aria-label={isMobile ? 'Close sidebar' : 'Collapse sidebar'}
          >
            {isMobile ? <X size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>

        <div className="sidebar-actions">
          <button
            type="button"
            className="new-chat-btn"
            onClick={() => {
              onNewChat();
              if (isMobile) onCloseMobile();
            }}
          >
            <Plus size={16} />
            <span>New chat</span>
          </button>

          <button
            type="button"
            className="dossiers-nav-btn"
            onClick={() => {
              onOpenKnowledge();
              if (isMobile) onCloseMobile();
            }}
          >
            <BookOpen size={15} />
            <span>Explore Dossiers</span>
            <span className="nav-count">{KNOWLEDGE_META.totalEntries}</span>
          </button>
        </div>

        <div className="sidebar-search">
          <Search size={14} className="search-icon" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search chats…"
            aria-label="Search conversation history"
          />
        </div>

        <div className="thread-list">
          {groups.length === 0 ? (
            <div className="thread-empty">
              {searchQuery
                ? 'No matching conversations.'
                : 'Your conversations are saved privately in this browser.'}
            </div>
          ) : (
            groups.map((group) => (
              <div key={group.label} className="thread-group">
                <div className="thread-group-label">{group.label}</div>
                {group.items.map((thread) => {
                  const isActive = thread.id === activeThreadId;
                  const isEditing = editingId === thread.id;
                  return (
                    <div
                      key={thread.id}
                      className={`thread-item ${isActive ? 'active' : ''}`}
                    >
                      {isEditing ? (
                        <input
                          type="text"
                          className="thread-rename-input"
                          value={draftTitle}
                          autoFocus
                          onChange={(e) => setDraftTitle(e.target.value)}
                          onBlur={() => commitRename(thread.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitRename(thread.id);
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                        />
                      ) : (
                        <>
                          <button
                            type="button"
                            className="thread-select-btn"
                            onClick={() => {
                              onSelectThread(thread.id);
                              if (isMobile) onCloseMobile();
                            }}
                            title={thread.title}
                          >
                            <MessageSquare size={14} className="thread-icon" />
                            <span className="thread-title">{thread.title}</span>
                          </button>

                          <div className="thread-item-actions">
                            <button
                              type="button"
                              className={`mini-icon-btn ${thread.pinned ? 'pinned' : ''}`}
                              onClick={() => onPinThread(thread.id)}
                              title={thread.pinned ? 'Unpin' : 'Pin'}
                              aria-label={thread.pinned ? 'Unpin conversation' : 'Pin conversation'}
                            >
                              <Pin size={12} />
                            </button>
                            <button
                              type="button"
                              className="mini-icon-btn"
                              onClick={() => {
                                setEditingId(thread.id);
                                setDraftTitle(thread.title);
                              }}
                              title="Rename"
                              aria-label="Rename conversation"
                            >
                              <Pencil size={12} />
                            </button>
                            <button
                              type="button"
                              className="mini-icon-btn danger"
                              onClick={() => onDeleteThread(thread.id)}
                              title="Delete"
                              aria-label="Delete conversation"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="sidebar-footer" ref={accountMenuRef}>
          {accountOpen && (
            <div className="account-popover-menu" role="menu" aria-label="Account and workspace menu">
              <div className="account-popover-header">
                {userProfile?.email
                  ? userProfile.email
                  : userProfile
                    ? `${userProfile.name} · Local workspace`
                    : 'Guest · Free'}
              </div>

              <button
                type="button"
                role="menuitem"
                className="account-menu-item"
                onClick={() => {
                  setAccountOpen(false);
                  setLearnExpanded(false);
                  onOpenSettings();
                  if (isMobile) onCloseMobile();
                }}
              >
                <Settings size={15} className="account-menu-icon" />
                <span className="account-menu-label">Settings</span>
                <kbd className="account-menu-kbd">Ctrl+Shift+,</kbd>
              </button>

              <button
                type="button"
                role="menuitem"
                className="account-menu-item"
                onClick={() => onToggleTheme()}
              >
                {theme === 'dark' ? (
                  <Sun size={15} className="account-menu-icon" />
                ) : (
                  <Moon size={15} className="account-menu-icon" />
                )}
                <span className="account-menu-label">Appearance</span>
                <span className="account-menu-meta">{theme === 'dark' ? 'Dark' : 'Light'}</span>
              </button>

              <button
                type="button"
                role="menuitem"
                className="account-menu-item"
                onClick={() => {
                  setAccountOpen(false);
                  setLearnExpanded(false);
                  onOpenHelp();
                  if (isMobile) onCloseMobile();
                }}
              >
                <HelpCircle size={15} className="account-menu-icon" />
                <span className="account-menu-label">Get help</span>
              </button>

              <div className="account-menu-divider" />

              <button
                type="button"
                role="menuitem"
                className="account-menu-item"
                aria-expanded={learnExpanded}
                onClick={() => setLearnExpanded((p) => !p)}
              >
                <Info size={15} className="account-menu-icon" />
                <span className="account-menu-label">Learn more</span>
                <ChevronRight size={14} className={`account-menu-chevron ${learnExpanded ? 'open' : ''}`} />
              </button>

              {learnExpanded && (
                <div className="account-submenu">
                  <button
                    type="button"
                    className="account-submenu-item"
                    onClick={() => {
                      setAccountOpen(false);
                      setLearnExpanded(false);
                      onOpenAbout();
                      if (isMobile) onCloseMobile();
                    }}
                  >
                    <span>About Ask Avi</span>
                  </button>
                  <a
                    href="https://aviperera.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="account-submenu-item"
                  >
                    <span>aviperera.com</span>
                    <ExternalLink size={12} />
                  </a>
                  <a
                    href="https://aviperera.com/stance/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="account-submenu-item"
                  >
                    <span>Stance on AI</span>
                    <ExternalLink size={12} />
                  </a>
                  <a
                    href="https://aviperera.com/research/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="account-submenu-item"
                  >
                    <span>Research &amp; DOIs</span>
                    <ExternalLink size={12} />
                  </a>
                </div>
              )}

              <div className="account-menu-divider" />

              {userProfile ? (
                <button
                  type="button"
                  role="menuitem"
                  className="account-menu-item"
                  onClick={() => {
                    setAccountOpen(false);
                    setLearnExpanded(false);
                    onSignOut();
                  }}
                >
                  <LogOut size={15} className="account-menu-icon" />
                  <span className="account-menu-label">Sign out</span>
                </button>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  className="account-menu-item"
                  onClick={() => {
                    setAccountOpen(false);
                    setLearnExpanded(false);
                    onOpenSignIn();
                    if (isMobile) onCloseMobile();
                  }}
                >
                  <LogIn size={15} className="account-menu-icon" />
                  <span className="account-menu-label">Sign in</span>
                </button>
              )}
            </div>
          )}

          <button
            type="button"
            className={`account-trigger-btn ${accountOpen ? 'open' : ''}`}
            onClick={() => setAccountOpen((p) => !p)}
            aria-expanded={accountOpen}
            aria-haspopup="menu"
          >
            <span className="account-avatar-badge" aria-hidden="true">
              {avatarInitial}
            </span>
            <span className="account-trigger-info">
              <span className="account-trigger-name">{displayName}</span>
              <span className="account-trigger-plan">Free</span>
            </span>
            <ChevronDown size={14} className={`account-trigger-chevron ${accountOpen ? 'open' : ''}`} />
          </button>
        </div>
      </aside>
    </>
  );
}
