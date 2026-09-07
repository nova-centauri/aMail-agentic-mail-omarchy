import { useEffect, useMemo, useState } from 'react';
import { smartCategoryMetadata } from '../mail/classify.js';
import { copyText, messageContextMenu, openThreadContextMenu } from '../mail/context-menu.js';
import { formatAttachmentSize, formatListDate, formatMessageDate } from '../mail/dates.js';
import { sanitizeEmailHtml } from '../mail/html.js';
import { formatRecipients, normalizeMessage, recipientArray } from '../mail/normalize.js';
import { ContextMenu, useContextMenu } from './ContextMenu.jsx';
import { Icon } from './Icon.jsx';
import { Avatar, IconButton } from './ui.jsx';
import { CategoryBadge } from './MailList.jsx';

export function ThreadToolbar({ onBack, onAction, isRead, isAnalyzed = true }) {
  return (
    <div className="thread-toolbar">
      <div className="toolbar-left">
        <IconButton label="Back to inbox" onClick={onBack}><Icon name="back" /></IconButton>
        <span className="toolbar-separator" />
        <IconButton label="Archive" onClick={() => onAction('archive')}><Icon name="archive" /></IconButton>
        <IconButton label="Report spam" onClick={() => onAction('spam')}><Icon name="spam" /></IconButton>
        <IconButton label="Delete" onClick={() => onAction('trash')}><Icon name="trash" /></IconButton>
        <IconButton label={isRead ? 'Mark as unread' : 'Mark as read'} onClick={() => onAction(isRead ? 'unread' : 'read')}><Icon name={isRead ? 'unread' : 'mail'} /></IconButton>
        <IconButton label="Snooze until tomorrow" onClick={() => onAction('snooze')}><Icon name="snooze" /></IconButton>
        <span className="toolbar-separator" />
        <IconButton label={isAnalyzed ? 'Mark as not analyzed' : 'Mark as analyzed by agent'} active={isAnalyzed} onClick={() => onAction(isAnalyzed ? 'unanalyzed' : 'analyzed')} className="analyzed-toggle"><Icon name="sparkles" /></IconButton>
      </div>
    </div>
  );
}

function MessageBody({ message, onLoadRemote, allowPrivateImages }) {
  const paragraphs = String(message.body || '').split(/\n\s*\n/).filter(Boolean);
  const safeHtml = useMemo(
    () => sanitizeEmailHtml(message.bodyHtml, Boolean(message.remoteContentLoaded && allowPrivateImages)),
    [message.bodyHtml, message.remoteContentLoaded, allowPrivateImages],
  );
  return (
    <div className="message-body">
      {message.remoteContentBlocked && (!message.remoteContentLoaded || !allowPrivateImages) && (
        <div className="privacy-notice">
          <span className="notice-icon"><Icon name="eyeOff" size={18} /></span>
          <div><strong>Remote content blocked for your privacy</strong><span>Known tracking pixels stay blocked; other images are never fetched directly.</span></div>
          {allowPrivateImages ? (
            <button type="button" onClick={() => onLoadRemote(message)}>Load images privately</button>
          ) : (
            <span className="private-load-off">Private image loading is off</span>
          )}
        </div>
      )}
      {safeHtml ? (
        <div className="html-email-body" dangerouslySetInnerHTML={{ __html: safeHtml }} />
      ) : paragraphs.length ? paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>) : <p className="muted-copy">This message has no plain-text preview.</p>}
      {message.attachments?.length > 0 && (
        <div className="attachments">
          {message.attachments.map((attachment, index) => {
            const sizeLabel = formatAttachmentSize(attachment.size || attachment.sizeBytes || attachment.bytes);
            const Chip = attachment.url ? 'a' : 'span';
            return (
              <Chip
                className="attachment-chip"
                key={attachment.id || attachment.name || index}
                title={attachment.name || 'Attachment'}
                {...(attachment.url ? {
                  href: attachment.url,
                  download: attachment.name || 'attachment',
                  target: '_blank',
                  rel: 'noopener noreferrer',
                } : {})}
              >
                <Icon name="attachment" size={17} />
                <span>{attachment.name || 'Attachment'}</span>
                {sizeLabel && <small>{sizeLabel}</small>}
              </Chip>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MessageCard({ message, expanded, onToggle, onLoadRemote, onReply, onReplyAll, onForward, onContextMenu, allowPrivateImages }) {
  const from = message.from || {};
  const recipientList = formatRecipients(message.to);
  const canReplyAll = [...recipientArray(message.to), ...recipientArray(message.cc)].length > 1;
  const handleContextMenu = (event) => {
    // The rendered email keeps the browser menu: copying text, opening links,
    // and saving images from mail is what people right-click there for.
    if (event.target.closest('.message-body')) return;
    onContextMenu?.(event, message, { expanded, canReplyAll });
  };
  return (
    <article className={`message-card email-light ${expanded ? 'is-expanded' : ''}`} onContextMenu={onContextMenu ? handleContextMenu : undefined}>
      <button type="button" className="message-summary" onClick={onToggle} aria-expanded={expanded}>
        <Avatar person={from} size="md" />
        <span className="message-sender"><strong>{from.name || from.email || 'Unknown sender'}</strong><small>{expanded ? (from.email || '') : message.body?.replace(/\s+/g, ' ').slice(0, 88)}</small></span>
        <time>{expanded ? formatMessageDate(message.timestamp) : formatListDate(message.timestamp)}</time>
        <Icon name="chevronDown" size={18} className={expanded ? 'is-rotated' : ''} />
      </button>
      {expanded && (
        <div className="message-content">
          <div className="message-utilities">
            <span>to {recipientList || 'me'}</span>
            <div>
              <IconButton label="Reply" onClick={() => onReply(message)}><Icon name="reply" size={18} /></IconButton>
              <IconButton label="Forward" onClick={() => onForward(message)}><Icon name="forward" size={18} /></IconButton>
            </div>
          </div>
          <MessageBody message={message} onLoadRemote={onLoadRemote} allowPrivateImages={allowPrivateImages} />
          <div className="message-reply-actions">
            <button type="button" className="secondary-button" onClick={() => onReply(message)}><Icon name="reply" size={18} /> Reply</button>
            {canReplyAll && <button type="button" className="secondary-button" onClick={() => onReplyAll(message)}><Icon name="reply" size={18} /> Reply all</button>}
            <button type="button" className="secondary-button" onClick={() => onForward(message)}><Icon name="forward" size={18} /> Forward</button>
          </div>
        </div>
      )}
    </article>
  );
}

export function ThreadView({ thread, activeFolder, onBack, onAction, onLoadRemote, onReply, onReplyAll, onForward, onToggleStar, onNotice, allowPrivateImages }) {
  const sourceMessages = thread.messages?.length ? thread.messages : [normalizeMessage(thread)];
  const classification = smartCategoryMetadata(thread);
  const [expandedIds, setExpandedIds] = useState(() => new Set([sourceMessages.at(-1)?.id]));
  useEffect(() => setExpandedIds(new Set([sourceMessages.at(-1)?.id])), [thread.id]);
  const toggleExpanded = (id) => setExpandedIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const { menu, openMenu, closeMenu } = useContextMenu();
  const copyWithNotice = onNotice
    ? (text, confirmation) => { void copyText(text).then((copied) => onNotice(copied ? confirmation : 'Could not copy to the clipboard.')); }
    : undefined;
  const openHeadingMenu = (event) => openMenu(event, openThreadContextMenu(thread, {
    handlers: {
      applyAction: onAction,
      toggleStar: onToggleStar,
      copyText: copyWithNotice,
      back: onBack,
    },
  }));
  const openMessageMenu = (event, message, { expanded, canReplyAll }) => openMenu(event, messageContextMenu(message, {
    expanded,
    canReplyAll,
    handlers: {
      reply: (target) => onReply(thread, target),
      replyAll: (target) => onReplyAll(thread, target),
      forward: (target) => onForward(thread, target),
      toggleExpanded: (target) => toggleExpanded(target.id),
      copyText: copyWithNotice,
    },
  }));
  return (
    <section className="thread-panel" aria-label="Open conversation">
      <ThreadToolbar onBack={onBack} onAction={(action) => onAction(action, [thread.id])} isRead={!thread.unread} isAnalyzed={thread.analyzed !== false} />
      <div className="thread-scroll">
        <div className="thread-heading" onContextMenu={openHeadingMenu}>
          <div className="thread-heading-main">
            <div className="thread-title-line">
              <h1>{thread.subject || '(no subject)'}</h1>
              <div className="heading-labels">
                <CategoryBadge thread={thread} showPrimary />
                {(thread.labels || []).map((label) => <span key={label} className="message-label">{label}</span>)}
                {activeFolder !== 'inbox' && <span className="message-label neutral-label">{activeFolder}</span>}
                {thread.analyzed === false
                  ? <span className="message-label analyzed-label is-pending" title="No agent has analyzed this conversation yet"><Icon name="sparkles" size={12} /> Not yet analyzed</span>
                  : thread.analyzedBy && <span className="message-label analyzed-label" title={thread.analyzedAt ? `Analyzed ${formatMessageDate(thread.analyzedAt)}` : undefined}><Icon name="sparkles" size={12} /> Analyzed by {thread.analyzedBy}</span>}
              </div>
            </div>
            <p className="category-reason"><Icon name="sparkles" size={13} />{classification.categoryReason}</p>
          </div>
        </div>
        <div className="conversation-stack">
          {sourceMessages.map((message) => (
            <MessageCard
              key={message.id}
              message={message}
              expanded={expandedIds.has(message.id)}
              onToggle={() => toggleExpanded(message.id)}
              onLoadRemote={onLoadRemote}
              onReply={(target) => onReply(thread, target)}
              onReplyAll={(target) => onReplyAll(thread, target)}
              onForward={(target) => onForward(thread, target)}
              onContextMenu={openMessageMenu}
              allowPrivateImages={allowPrivateImages}
            />
          ))}
        </div>
      </div>
      <ContextMenu menu={menu} onClose={closeMenu} />
    </section>
  );
}
