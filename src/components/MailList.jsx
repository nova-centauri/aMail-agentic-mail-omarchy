import { PROVIDER_PRESETS, SMART_CATEGORIES } from '../mail/constants.js';
import { smartCategoryMetadata } from '../mail/classify.js';
import { formatListDate } from '../mail/dates.js';
import { BrandMark, Icon } from './Icon.jsx';
import { Checkbox, IconButton } from './ui.jsx';

export function ListToolbar({ visibleCount, totalCount, selectedCount, onRefresh, onBulkAction, allSelected, onToggleAll, loading }) {
  return (
    <div className="list-toolbar">
      <div className="toolbar-left">
        <Checkbox checked={allSelected} onChange={onToggleAll} label="Select all conversations" />
        {selectedCount > 0 ? (
          <>
            <IconButton label="Archive" onClick={() => onBulkAction('archive')}><Icon name="archive" /></IconButton>
            <IconButton label="Report spam" onClick={() => onBulkAction('spam')}><Icon name="spam" /></IconButton>
            <IconButton label="Delete" onClick={() => onBulkAction('trash')}><Icon name="trash" /></IconButton>
            <IconButton label="Mark as unread" onClick={() => onBulkAction('unread')}><Icon name="unread" /></IconButton>
            <IconButton label="Snooze until tomorrow" onClick={() => onBulkAction('snooze')}><Icon name="snooze" /></IconButton>
          </>
        ) : (
          <IconButton label="Refresh" onClick={onRefresh} disabled={loading} className={loading ? 'is-spinning' : ''}><Icon name="refresh" /></IconButton>
        )}
      </div>
      <div className="toolbar-right">
        <span className="range-copy">{visibleCount ? `1–${visibleCount} of ${totalCount}` : '0 of 0'}</span>
      </div>
    </div>
  );
}

export function SmartFilterBar({ activeCategory, onChange, visibleCount, categoryCounts, loading }) {
  const availableCounts = SMART_CATEGORIES
    .filter((category) => category.id !== 'all')
    .map((category) => categoryCounts?.[category.id])
    .filter((count) => Number.isFinite(Number(count)));
  const allCount = availableCounts.length
    ? availableCounts.reduce((sum, count) => sum + Number(count), 0)
    : Number(visibleCount || 0);
  return (
    <section className="smart-filter-bar" id="smart-mail-filters" aria-label="Smart inbox filters">
      <div className="smart-filter-intro">
        <span className="smart-filter-mark"><Icon name="sparkles" size={16} /></span>
        <span><strong>Smart views</strong><small>Automatic, explainable sorting</small></span>
      </div>
      <div className="smart-filter-scroll" role="tablist" aria-label="Filter conversations by category">
        {SMART_CATEGORIES.map((category) => {
          const selected = activeCategory === category.id;
          const categoryCount = category.id === 'all'
            ? allCount
            : Number(categoryCounts?.[category.id] || 0);
          return (
            <button
              type="button"
              role="tab"
              key={category.id}
              aria-selected={selected}
              aria-controls="conversation-list"
              className={`smart-filter-chip category-${category.id} ${selected ? 'is-selected' : ''}`}
              onClick={() => onChange(category.id)}
              title={category.description}
            >
              <Icon name={category.icon} size={15} />
              <span>{category.shortLabel}</span>
              {!loading && categoryCount > 0 && <small aria-label={`${categoryCount} ${categoryCount === 1 ? 'message' : 'messages'}`}>{categoryCount}</small>}
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function CategoryBadge({ thread, showPrimary = false }) {
  const metadata = smartCategoryMetadata(thread);
  if (metadata.category === 'primary' && !showPrimary) return null;
  if (metadata.category === 'ops_quiet' && !showPrimary) return null;
  const definition = SMART_CATEGORIES.find((item) => item.id === metadata.category)
    || (metadata.category === 'ops_quiet' ? { id: 'ops_quiet', label: 'Ops digests', icon: 'terminal' } : null)
    || SMART_CATEGORIES[1];
  return (
    <span
      className={`thread-category category-${metadata.category}`}
      title={metadata.categoryReason}
      aria-label={`${metadata.categoryLabel}. ${metadata.categoryReason}`}
    >
      <Icon name={definition.icon || 'sparkles'} size={12} />
      <span>{metadata.categoryLabel}</span>
    </span>
  );
}

function ThreadRow({ thread, selected, isCursor, isChecked, onOpen, onCheck, onToggleStar }) {
  const sender = thread.from?.name || thread.from?.email || 'Unknown sender';
  return (
    <article
      data-thread-id={thread.id}
      className={`thread-row ${thread.unread ? 'is-unread' : ''} ${selected ? 'is-selected' : ''} ${isCursor ? 'is-cursor' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(thread)}
      onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onOpen(thread); } }}
    >
      <Checkbox checked={isChecked} onChange={onCheck} label={`Select ${thread.subject}`} />
      <IconButton label={thread.starred ? 'Unstar' : 'Star'} active={thread.starred} onClick={(event) => { event.stopPropagation(); onToggleStar(thread); }} className="row-star">
        <Icon name="star" size={19} />
      </IconButton>
      <div className="row-sender" title={sender}>{sender}</div>
      <div className="row-subject">
        <span className="row-subject-heading"><strong>{thread.subject || '(no subject)'}</strong><CategoryBadge thread={thread} /></span>
        <span className="row-snippet">{thread.snippet}</span>
      </div>
      <div className="row-meta">
        {thread.hasAttachments && <Icon name="attachment" size={17} />}
        {thread.messageCount > 1 && <span className="thread-count">{thread.messageCount}</span>}
        <time>{formatListDate(thread.timestamp)}</time>
      </div>
    </article>
  );
}

function EmptyMailbox({ folder, query, category = 'all', onCompose, onClearSearch, onClearCategory, onRefresh }) {
  const categoryDefinition = SMART_CATEGORIES.find((item) => item.id === category);
  const title = query ? 'No mail matched your search' : categoryDefinition && category !== 'all' ? `No ${categoryDefinition.label.toLowerCase()} here` : folder === 'inbox' ? 'Your inbox is clear' : `Nothing in ${folder}`;
  const copy = query
    ? 'Try from:, to:, subject:, has:attachment, or a different search term.'
    : categoryDefinition && category !== 'all'
      ? `${categoryDefinition.description}. New matches will appear here automatically.`
    : folder === 'inbox'
      ? 'Take a breath. New conversations will appear here.'
      : 'Mail moved here will appear when it is available.';
  return (
    <div className="empty-state">
      <div className="empty-icon"><Icon name={query ? 'search' : folder === 'inbox' ? 'inbox' : 'mail'} size={38} /></div>
      <h2>{title}</h2>
      <p>{copy}</p>
      <div className="empty-actions">
        {query ? <button type="button" className="secondary-button" onClick={onClearSearch}>Clear search</button> : category !== 'all' ? <button type="button" className="secondary-button" onClick={onClearCategory}>View all mail</button> : <button type="button" className="primary-button" onClick={onCompose}><Icon name="compose" size={18} /> Compose</button>}
        <button type="button" className="text-button" onClick={onRefresh}>Refresh</button>
      </div>
    </div>
  );
}

export function ReaderPlaceholder({ isDemo, onAddAccount }) {
  if (!isDemo) {
    return (
      <section className="reader-placeholder" aria-label="No conversation selected">
        <div className="reader-placeholder-mark"><BrandMark size={72} /></div>
        <h2>Select a conversation</h2>
        <p>Choose a message to read it here.</p>
        <div className="privacy-summary"><Icon name="shield" size={18} /><span><strong>Privacy is on</strong> — known tracking pixels are blocked before they can report back.</span></div>
      </section>
    );
  }
  return (
    <section className="reader-placeholder onboarding-placeholder" aria-label="Connect your first email account">
      <span className="onboarding-eyebrow"><Icon name="sparkles" size={14} /> Private unified inbox</span>
      <div className="reader-placeholder-mark"><BrandMark size={72} /></div>
      <h2>All your mail. Much less noise.</h2>
      <p>Bring Gmail, iCloud, and self-hosted mail into one calm inbox, with CI, logs, and status updates sorted automatically.</p>
      <button type="button" className="primary-button onboarding-cta" onClick={onAddAccount}><Icon name="plus" size={18} /> Connect an account</button>
      <div className="onboarding-provider-list" aria-label="Supported providers">
        {['gmail', 'icloud', 'mailinabox'].map((id) => {
          const provider = PROVIDER_PRESETS[id];
          return <span key={id}><i style={{ '--provider-color': provider.color }}>{provider.mark}</i>{provider.label}</span>;
        })}
      </div>
      <div className="privacy-summary"><Icon name="lock" size={18} /><span><strong>Credentials stay server-side.</strong> GigaMail requires encrypted-at-rest storage and never saves mailbox passwords in browser storage.</span></div>
    </section>
  );
}

function SkeletonRows() {
  return (
    <div className="skeleton-list" aria-label="Loading messages">
      {Array.from({ length: 7 }, (_, index) => <div className="skeleton-row" key={index}><i /><span /><b /><em /></div>)}
    </div>
  );
}

export function MailList({ threads, totalCount, categoryCounts, selectedThread, cursorThreadId, loading, folder, query, activeCategory, setActiveCategory, selectedIds, setSelectedIds, onOpenThread, onToggleStar, onRefresh, onBulkAction, onCompose, onClearSearch, hideSmartFilters = false }) {
  const allSelected = threads.length > 0 && threads.every((thread) => selectedIds.includes(thread.id));
  const toggleAll = () => setSelectedIds(allSelected ? [] : threads.map((thread) => thread.id));
  const toggleOne = (thread, checked) => setSelectedIds((current) => checked ? [...new Set([...current, thread.id])] : current.filter((id) => id !== thread.id));
  return (
    <section className={`mail-list-panel ${selectedThread ? 'has-selected-thread' : ''}`} aria-label="Conversation list">
      <ListToolbar
        visibleCount={threads.length}
        totalCount={totalCount}
        selectedCount={selectedIds.length}
        onRefresh={onRefresh}
        onBulkAction={onBulkAction}
        allSelected={allSelected}
        onToggleAll={toggleAll}
        loading={loading}
      />
      {folder === 'inbox' && !hideSmartFilters && <SmartFilterBar activeCategory={activeCategory} onChange={setActiveCategory} visibleCount={threads.length} categoryCounts={categoryCounts} loading={loading} />}
      {loading && !threads.length ? <SkeletonRows /> : threads.length ? (
        <div className="thread-list" id="conversation-list" role="tabpanel">
          {threads.map((thread) => (
            <ThreadRow
              key={thread.id}
              thread={thread}
              selected={selectedThread?.id === thread.id}
              isCursor={cursorThreadId === thread.id}
              isChecked={selectedIds.includes(thread.id)}
              onOpen={onOpenThread}
              onCheck={(checked) => toggleOne(thread, checked)}
              onToggleStar={onToggleStar}
            />
          ))}
        </div>
      ) : (
        <EmptyMailbox folder={folder} query={query} category={activeCategory} onCompose={onCompose} onClearSearch={onClearSearch} onClearCategory={() => setActiveCategory('all')} onRefresh={onRefresh} />
      )}
    </section>
  );
}
