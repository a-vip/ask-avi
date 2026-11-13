import {
  BookOpen,
  ExternalLink,
  MessageSquare,
  PanelLeftClose,
  Pencil,
  Pin,
  Plus,
  Search,
  Settings,
  Trash2,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { KNOWLEDGE_META } from '../engine/rag';
import type { ChatThread, EngineId, ModelLoadProgress } from '../types/chat';
import { groupThreadsByRecency } from '../utils/storage';
import { AviAvatar } from './AviAvatar';

interface SidebarProps {
  isOpen: boolean;
  isMobile: boolean;
  threads: ChatThread[];
  activeThreadId: string | null;
  activeEngineId: EngineId;
  modelProgress: ModelLoadProgress;
  webGpuSupported: boolean | null;
  onCloseMobile: () => void;
  onToggleCollapse: () => void;
  onNewChat: () => void;
  onSelectThread: (id: string) => void;
  onRenameThread: (id: string, title: string) => void;
  onPinThread: (id: string) => void;
  onDeleteThread: (id: string) => void;
  onOpenKnowledge: () => void;
  onOpenSettings: () => void;
}

export function Sidebar({
  isOpen,
  isMobile,
  threads,
  activeThreadId,
  activeEngineId,
  modelProgress,
  webGpuSupported,
  onCloseMobile,
  onToggleCollapse,
  onNewChat,
  onSelectThread,
  onRenameThread,
  onPinThread,
  onDeleteThread,
  onOpenKnowledge,
  onOpenSettings,
}: SidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');

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

  const engineStatusLabel = useMemo(() => {
    if (modelProgress.status === 'loading') {
      const pct = Math.round(modelProgress.progress * 100);
      return `Loading Neural Model (${pct}%)`;
    }
    if (activeEngineId === 'instant') {
      return webGpuSupported ? 'Instant Archive · WebGPU Ready' : 'Instant Archive Engine';
    }
    if (activeEngineId === 'custom-api') {
      return 'Custom API Mode';
    }
    if (modelProgress.status === 'ready' && modelProgress.engineId === activeEngineId) {
      return 'WebGPU Neural Active';
    }
    return 'WebGPU Neural Selected';
  }, [activeEngineId, modelProgress, webGpuSupported]);

  if (!isOpen) return null;

  const commitRename = (id: string) => {
    const trimmed = draftTitle.trim();
    if (trimmed) onRenameThread(id, trimmed);
    setEditingId(null);
  };

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

        <div className="sidebar-footer">
          <div className="engine-status-pill" title={engineStatusLabel}>
            <span
              className={`status-dot ${
                modelProgress.status === 'loading'
                  ? 'loading'
                  : webGpuSupported || activeEngineId === 'instant'
                    ? 'ready'
                    : 'warn'
              }`}
            />
            <span className="status-label">{engineStatusLabel}</span>
          </div>

          <div className="sidebar-footer-links">
            <button
              type="button"
              className="footer-link-btn"
              onClick={onOpenSettings}
            >
              <Settings size={15} />
              <span>Engine &amp; Settings</span>
            </button>
            <a
              href="https://aviperera.com"
              target="_blank"
              rel="noopener noreferrer"
              className="footer-ext-btn"
              title="Visit aviperera.com"
              aria-label="Visit aviperera.com"
            >
              <ExternalLink size={15} />
            </a>
          </div>
        </div>
      </aside>
    </>
  );
}
