import { BookOpen, Download, EyeOff, Moon, PanelLeft, Sun } from 'lucide-react';
import type { ThemeMode } from '../types/chat';

interface TopBarProps {
  sidebarOpen: boolean;
  theme: ThemeMode;
  isTemporaryChat: boolean;
  canExport: boolean;
  knowledgeOpen: boolean;
  onOpenSidebar: () => void;
  onToggleTheme: () => void;
  onToggleTemporary: () => void;
  onExportChat: () => void;
  onToggleKnowledge: () => void;
}

export function TopBar({
  sidebarOpen,
  theme,
  isTemporaryChat,
  canExport,
  knowledgeOpen,
  onOpenSidebar,
  onToggleTheme,
  onToggleTemporary,
  onExportChat,
  onToggleKnowledge,
}: TopBarProps) {
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
          title="Open Avi Dossiers Explorer"
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
