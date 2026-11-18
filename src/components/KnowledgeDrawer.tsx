import { BookOpen, ExternalLink, MessageSquarePlus, Paperclip, Search, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { knowledgeIndex } from '../engine/rag';
import type { KnowledgeEntry, RetrievedSource } from '../types/chat';

export const JUST_PUBLISHED_FILTER = '✦ Just Published';

interface KnowledgeDrawerProps {
  isOpen: boolean;
  activeSources: RetrievedSource[];
  focusIndex: number | null;
  initialTab: 'cited' | 'archive';
  onClose: () => void;
  onAskAboutEntry: (entry: KnowledgeEntry) => void;
  onAttachEntry: (entry: KnowledgeEntry) => void;
}

export function KnowledgeDrawer({
  isOpen,
  activeSources,
  focusIndex,
  initialTab,
  onClose,
  onAskAboutEntry,
  onAttachEntry,
}: KnowledgeDrawerProps) {
  const [tab, setTab] = useState<'cited' | 'archive'>(
    activeSources.length > 0 ? initialTab : 'archive'
  );
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    return knowledgeIndex.subscribe(() => {
      setRevision((r) => r + 1);
    });
  }, []);

  const categories = useMemo(() => {
    const base = knowledgeIndex.getCategories();
    const justCount = knowledgeIndex.getJustPublishedEntries().length;
    if (justCount === 0) return base;
    return [base[0], JUST_PUBLISHED_FILTER, ...base.slice(1)];
  }, [revision]);

  const allEntries = useMemo(() => knowledgeIndex.getAllEntries(), [revision]);

  const filteredEntries = useMemo(() => {
    const q = query.trim().toLowerCase();
    const baseList =
      selectedCategory === JUST_PUBLISHED_FILTER
        ? knowledgeIndex.getJustPublishedEntries()
        : allEntries;

    return baseList.filter((entry) => {
      if (
        selectedCategory !== 'All' &&
        selectedCategory !== JUST_PUBLISHED_FILTER &&
        entry.category !== selectedCategory
      ) {
        return false;
      }
      if (!q) return true;
      return (
        entry.title.toLowerCase().includes(q) ||
        entry.summary.toLowerCase().includes(q) ||
        entry.keywords.some((k) => k.includes(q))
      );
    });
  }, [allEntries, query, selectedCategory]);

  if (!isOpen) return null;

  const effectiveTab = activeSources.length === 0 && tab === 'cited' ? 'archive' : tab;

  return (
    <aside className="knowledge-drawer" aria-label="Dossiers and Citations Inspector">
      <div className="drawer-header">
        <div className="drawer-title-group">
          <BookOpen size={17} />
          <div>
            <h2>Avi Knowledge Archive</h2>
            <span className="proxy-grounding-tag">AI Proxy Corpus · Grounded in Avi Perera&apos;s writings</span>
          </div>
        </div>
        <button
          type="button"
          className="icon-btn"
          onClick={onClose}
          aria-label="Close archive panel"
        >
          <X size={18} />
        </button>
      </div>

      <div className="drawer-tabs">
        <button
          type="button"
          className={`drawer-tab ${effectiveTab === 'cited' ? 'active' : ''}`}
          disabled={activeSources.length === 0}
          onClick={() => setTab('cited')}
        >
          Cited Sources ({activeSources.length})
        </button>
        <button
          type="button"
          className={`drawer-tab ${effectiveTab === 'archive' ? 'active' : ''}`}
          onClick={() => setTab('archive')}
        >
          All Dossiers ({allEntries.length})
        </button>
      </div>

      {effectiveTab === 'cited' ? (
        <div className="drawer-scroll">
          {activeSources.map((src) => {
            const focused = focusIndex === src.index;
            return (
              <div
                key={src.entry.id}
                className={`dossier-card ${focused ? 'focused' : ''}`}
              >
                <div className="dossier-meta">
                  <span className="cite-num-badge">[{src.index}]</span>
                  <span className="dossier-cat">{src.entry.category}</span>
                  {src.entry.date && <span className="dossier-date">{src.entry.date}</span>}
                </div>
                <h3 className="dossier-title">{src.entry.title}</h3>
                <p className="dossier-snippet">{src.snippet}</p>
                {src.entry.doi && (
                  <div className="dossier-doi">DOI: {src.entry.doi}</div>
                )}
                <div className="dossier-actions">
                  <a
                    href={src.entry.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="dossier-link-btn"
                  >
                    <span>Read Original</span>
                    <ExternalLink size={12} />
                  </a>
                  <button
                    type="button"
                    className="dossier-action-btn"
                    onClick={() => onAttachEntry(src.entry)}
                  >
                    <Paperclip size={12} />
                    <span>Attach</span>
                  </button>
                  <button
                    type="button"
                    className="dossier-action-btn primary"
                    onClick={() => onAskAboutEntry(src.entry)}
                  >
                    <MessageSquarePlus size={12} />
                    <span>Ask Avi</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <>
          <div className="drawer-controls">
            <div className="drawer-search">
              <Search size={14} />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search essays, LAWS, projects, DOIs…"
                aria-label="Search dossiers"
              />
            </div>

            <div className="drawer-cats">
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className={`drawer-cat-pill ${selectedCategory === cat ? 'active' : ''}`}
                  onClick={() => setSelectedCategory(cat)}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div className="drawer-scroll">
            {filteredEntries.map((entry) => (
              <div key={entry.id} className="dossier-card">
                <div className="dossier-meta">
                  {entry.justPublished && (
                    <span className="dossier-just-published-badge">
                      <Sparkles size={10} />
                      <span>Just Published</span>
                    </span>
                  )}
                  <span className="dossier-cat">{entry.category}</span>
                  {entry.date && <span className="dossier-date">{entry.date}</span>}
                </div>
                <h3 className="dossier-title">{entry.title}</h3>
                <p className="dossier-snippet">{entry.summary}</p>
                {entry.doi && <div className="dossier-doi">DOI: {entry.doi}</div>}
                <div className="dossier-actions">
                  <a
                    href={entry.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="dossier-link-btn"
                  >
                    <span>Source</span>
                    <ExternalLink size={12} />
                  </a>
                  <button
                    type="button"
                    className="dossier-action-btn"
                    onClick={() => onAttachEntry(entry)}
                  >
                    <Paperclip size={12} />
                    <span>Attach</span>
                  </button>
                  <button
                    type="button"
                    className="dossier-action-btn primary"
                    onClick={() => onAskAboutEntry(entry)}
                  >
                    <MessageSquarePlus size={12} />
                    <span>Ask Avi</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}
