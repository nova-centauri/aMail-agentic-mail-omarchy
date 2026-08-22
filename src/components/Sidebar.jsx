import { useState } from 'react';
import { folders, PERSON_FLAGS, UNIFIED_ACCOUNT } from '../mail/constants.js';
import { demoAccounts } from '../mail/demo.js';
import { Icon } from './Icon.jsx';
import { Avatar, IconButton } from './ui.jsx';

export function Sidebar({ compact, mobileOpen, onCloseMobile, activeFolder, setActiveFolder, counts, onCompose, accounts, activeAccount, setActiveAccount, onSelectUnified, onOpenSettings, isDemo, onAddAccount, activePersonFlag, onSelectPersonFlag }) {
  const [showMore, setShowMore] = useState(false);
  const displayAccounts = accounts.length ? accounts : isDemo ? demoAccounts : [];
  const items = showMore
    ? [...folders, { id: 'all', label: 'All mail', icon: 'mail' }, { id: 'spam', label: 'Spam', icon: 'spam' }, { id: 'trash', label: 'Trash', icon: 'trash' }]
    : folders;
  const connectedCount = accounts.length;
  return (
    <>
      {mobileOpen && <button type="button" className="sidebar-scrim" aria-label="Close navigation" onClick={onCloseMobile} />}
      <aside className={`sidebar ${compact ? 'is-compact' : ''} ${mobileOpen ? 'is-mobile-open' : ''}`}>
        <div className="sidebar-content">
          <button type="button" className="compose-button" onClick={onCompose} title="Compose">
            <Icon name="compose" size={22} />
            <span>Compose</span>
          </button>
          <nav className="folder-nav" aria-label="Mail folders">
            {items.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => { setActiveFolder(item.id); onSelectPersonFlag?.(null); onCloseMobile(); }}
                className={`nav-item ${activeFolder === item.id && !activePersonFlag ? 'is-selected' : ''}`}
                title={compact ? item.label : undefined}
              >
                <Icon name={item.icon} size={20} />
                <span className="nav-label">{item.label}</span>
                {counts[item.id] > 0 && <span className="nav-count">{counts[item.id]}</span>}
              </button>
            ))}
            <button type="button" className="nav-item more-nav" onClick={() => setShowMore((value) => !value)} title={compact ? 'More' : undefined} aria-expanded={showMore}>
              <Icon name={showMore ? 'chevronDown' : 'chevronRight'} size={19} />
              <span className="nav-label">{showMore ? 'Less' : 'More'}</span>
            </button>
          </nav>
          <div className="flags-section">
            <div className="side-section-heading"><span>Flagged people</span></div>
            <nav className="folder-nav flag-nav" aria-label="Flagged people">
              {PERSON_FLAGS.map((flag) => (
                <button
                  type="button"
                  key={flag.id}
                  onClick={() => { onSelectPersonFlag?.(flag.id); onCloseMobile(); }}
                  className={`nav-item label-nav ${activePersonFlag === flag.id ? 'is-selected' : ''}`}
                  title={compact ? flag.label : flag.description}
                >
                  <span className="label-dot" style={{ background: flag.color }} />
                  <span className="nav-label">{flag.shortLabel}</span>
                </button>
              ))}
            </nav>
          </div>
          <div className="accounts-section">
            <div className="side-section-heading">
              <span>Accounts</span>
              <IconButton label="Add account" onClick={() => { onAddAccount?.(); onCloseMobile(); }}><Icon name="plus" size={18} /></IconButton>
            </div>
            {accounts.length > 0 && (
              <button type="button" className={`account-row unified-account-row ${!activeAccount ? 'is-active' : ''}`} onClick={() => { onSelectUnified(); onCloseMobile(); }} title={compact ? 'All inboxes' : undefined}>
                <Avatar person={UNIFIED_ACCOUNT} size="sm" />
                <span className="account-row-text"><strong>All inboxes</strong><small>Unified inbox</small></span>
                {!activeAccount && <Icon name="check" size={16} />}
              </button>
            )}
            {displayAccounts.map((account) => (
              <button type="button" key={account.id} className={`account-row ${activeAccount?.id === account.id ? 'is-active' : ''}`} onClick={() => { setActiveAccount(account); onCloseMobile(); }} title={compact ? account.email : undefined}>
                <Avatar person={account} size="sm" />
                <span className="account-row-text"><strong>{account.name}</strong><small>{account.email}</small></span>
                <span className={`connection-dot ${account.connected ? 'is-connected' : ''}`} title={account.connected ? 'Connected' : 'Needs attention'} />
              </button>
            ))}
            {!accounts.length && !isDemo && (
              <button type="button" className="account-row" onClick={() => { onAddAccount?.(); onCloseMobile(); }}>
                <span className="account-row-text"><strong>Connect an account</strong><small>Gmail, iCloud, or IMAP</small></span>
              </button>
            )}
          </div>
        </div>
        <button type="button" className="storage-card" onClick={onOpenSettings} title={compact ? 'Settings' : undefined}>
          <span className="storage-privacy-mark" aria-hidden="true"><Icon name="shield" size={16} /></span>
          <span className="storage-copy">
            <strong>{connectedCount ? `${connectedCount} account${connectedCount === 1 ? '' : 's'} connected` : isDemo ? 'Preview mailbox' : 'No accounts yet'}</strong>
            <small>Trackers blocked · private images optional</small>
          </span>
        </button>
      </aside>
    </>
  );
}
