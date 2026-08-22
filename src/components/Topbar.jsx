import { BrandMark, Icon } from './Icon.jsx';
import { Avatar, IconButton, Tooltip } from './ui.jsx';

export function Topbar({
  onToggleSidebar,
  onGoHome,
  query,
  setQuery,
  onOpenSettings,
  onLogout,
  onOpenProfile,
  onFocusSmartFilters,
  onOpenShortcuts,
  searchRef,
  account,
  isDemo,
}) {
  return (
    <header className="topbar">
      <Tooltip text="Toggle navigation">
        <IconButton label="Toggle navigation" onClick={onToggleSidebar} className="top-menu">
          <Icon name="menu" />
        </IconButton>
      </Tooltip>
      <button type="button" className="brand" aria-label="GigaMail home" onClick={onGoHome}>
        <BrandMark />
        <span className="brand-name">GigaMail</span>
        {isDemo && <span className="preview-pill">Preview</span>}
      </button>
      <div className="search-shell">
        <Icon name="search" size={21} className="search-icon" />
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search mail"
          aria-label="Search mail"
        />
        {query && (
          <IconButton label="Clear search" onClick={() => setQuery('')} className="search-clear">
            <Icon name="close" size={18} />
          </IconButton>
        )}
        <Tooltip text="Smart mail filters">
          <IconButton label="Focus smart mail filters" className="search-filter" onClick={onFocusSmartFilters}>
            <Icon name="tune" size={20} />
          </IconButton>
        </Tooltip>
      </div>
      <div className="top-actions">
        {onOpenShortcuts && (
          <Tooltip text="Keyboard shortcuts">
            <IconButton label="Keyboard shortcuts" onClick={onOpenShortcuts}><Icon name="help" /></IconButton>
          </Tooltip>
        )}
        <Tooltip text="Quick settings">
          <IconButton label="Quick settings" onClick={onOpenSettings}><Icon name="settings" size={22} /></IconButton>
        </Tooltip>
        <Tooltip text="Log out">
          <IconButton label="Log out of this session" onClick={onLogout}><Icon name="logout" size={22} /></IconButton>
        </Tooltip>
        <button type="button" className="account-trigger" onClick={onOpenProfile} aria-label="Open account menu">
          <Avatar person={account} size="top" />
        </button>
      </div>
    </header>
  );
}
