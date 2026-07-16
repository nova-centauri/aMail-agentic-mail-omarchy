import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const API_BASE = (import.meta.env.VITE_API_BASE || '/api').replace(/\/$/, '');
const ACCESS_TOKEN_KEY = 'gigamail-access-token';

function getAccessToken() {
  try {
    return window.sessionStorage.getItem(ACCESS_TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

function persistAccessToken(token) {
  try {
    if (token) window.sessionStorage.setItem(ACCESS_TOKEN_KEY, token);
    else window.sessionStorage.removeItem(ACCESS_TOKEN_KEY);
  } catch {
    // Private browsing can deny session storage. The token still works for this page request.
  }
}

const folders = [
  { id: 'inbox', label: 'Inbox', icon: 'inbox' },
  { id: 'starred', label: 'Starred', icon: 'star' },
  { id: 'snoozed', label: 'Snoozed', icon: 'clock' },
  { id: 'sent', label: 'Sent', icon: 'send' },
  { id: 'drafts', label: 'Drafts', icon: 'draft' },
];

const demoAccounts = [
  {
    id: 'me',
    name: 'Nova Centauri',
    email: 'nova@centauri.dev',
    color: '#8e24aa',
    signature: '—\nNova Centauri\nCentauri Labs',
    connected: true,
  },
  {
    id: 'studio',
    name: 'Nova Studio',
    email: 'hello@novastudio.co',
    color: '#0b57d0',
    signature: 'Best,\nNova Studio',
    connected: true,
  },
  {
    id: 'personal',
    name: 'Personal',
    email: 'nova.personal@example.com',
    color: '#e8710a',
    connected: true,
  },
];

const UNIFIED_ACCOUNT = {
  id: '__unified__',
  name: 'All inboxes',
  email: 'Unified inbox',
  color: '#0b57d0',
  isUnified: true,
};

const demoThreads = [
  {
    id: 'design-sync',
    threadId: 'design-sync',
    subject: 'Design sync — final notes',
    snippet: 'I have added the final interaction notes and the handoff links for tomorrow.',
    from: { name: 'Maya Chen', email: 'maya@studio.com', color: '#0b57d0' },
    participants: ['Maya Chen', 'You', 'Jordan Lee'],
    timestamp: new Date(Date.now() - 1000 * 60 * 17).toISOString(),
    unread: true,
    starred: true,
    labels: ['Work'],
    folder: 'inbox',
    messageCount: 3,
    messages: [
      {
        id: 'design-sync-1',
        from: { name: 'Maya Chen', email: 'maya@studio.com', color: '#0b57d0' },
        to: ['Nova Centauri'],
        timestamp: new Date(Date.now() - 1000 * 60 * 65).toISOString(),
        body: 'Hi Nova,\n\nI have added the final interaction notes and the handoff links for tomorrow. The desktop flow is ready for one last pass.\n\nMaya',
        remoteContentBlocked: true,
      },
      {
        id: 'design-sync-2',
        from: { name: 'Nova Centauri', email: 'nova@centauri.dev', color: '#8e24aa' },
        to: ['Maya Chen', 'Jordan Lee'],
        timestamp: new Date(Date.now() - 1000 * 60 * 41).toISOString(),
        body: 'Looks excellent. I left two small comments in the prototype and will review the responsive states before the sync.\n\nThanks!',
      },
      {
        id: 'design-sync-3',
        from: { name: 'Maya Chen', email: 'maya@studio.com', color: '#0b57d0' },
        to: ['Nova Centauri', 'Jordan Lee'],
        timestamp: new Date(Date.now() - 1000 * 60 * 17).toISOString(),
        body: 'Perfect — I will bring the updated mobile behavior to the meeting too. See you tomorrow.',
      },
    ],
  },
  {
    id: 'infrastructure',
    threadId: 'infrastructure',
    subject: 'GigaMail infrastructure proposal',
    snippet: 'The isolated Docker deployment is ready for review, with no host port collisions.',
    from: { name: 'Avery Thompson', email: 'avery@ops.example', color: '#00897b' },
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
    unread: true,
    starred: false,
    labels: ['Important'],
    folder: 'inbox',
    messageCount: 1,
    messages: [
      {
        id: 'infrastructure-1',
        from: { name: 'Avery Thompson', email: 'avery@ops.example', color: '#00897b' },
        to: ['Nova Centauri'],
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
        body: 'Hi Nova,\n\nThe isolated Docker deployment is ready for review. It uses its own named volumes and a dedicated network, so it will not conflict with any existing services on the host.\n\nAvery',
      },
    ],
  },
  {
    id: 'receipt',
    threadId: 'receipt',
    subject: 'Your receipt from Figma',
    snippet: 'Thanks for your payment. Your monthly invoice is attached to this email.',
    from: { name: 'Figma', email: 'billing@figma.com', color: '#ef6c00' },
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(),
    unread: false,
    starred: false,
    labels: ['Receipts'],
    folder: 'inbox',
    messageCount: 1,
    hasAttachments: true,
    messages: [
      {
        id: 'receipt-1',
        from: { name: 'Figma', email: 'billing@figma.com', color: '#ef6c00' },
        to: ['Nova Centauri'],
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(),
        body: 'Thanks for your payment. Your monthly invoice is attached to this email.',
        attachments: [{ name: 'figma-invoice-july.pdf', size: '124 KB' }],
      },
    ],
  },
  {
    id: 'weekend',
    threadId: 'weekend',
    subject: 'A quiet place for the weekend',
    snippet: 'I found a small cabin that looks ideal — have a look when you get a minute.',
    from: { name: 'Jordan Lee', email: 'jordan@example.com', color: '#c2185b' },
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 23).toISOString(),
    unread: false,
    starred: true,
    labels: [],
    folder: 'inbox',
    messageCount: 2,
    messages: [
      {
        id: 'weekend-1',
        from: { name: 'Jordan Lee', email: 'jordan@example.com', color: '#c2185b' },
        to: ['Nova Centauri'],
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 25).toISOString(),
        body: 'I found a small cabin that looks ideal — have a look when you get a minute.',
      },
      {
        id: 'weekend-2',
        from: { name: 'Nova Centauri', email: 'nova@centauri.dev', color: '#8e24aa' },
        to: ['Jordan Lee'],
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 23).toISOString(),
        body: 'This looks wonderful. I am in — let’s check availability this evening.',
      },
    ],
  },
  {
    id: 'security',
    threadId: 'security',
    subject: 'New sign-in from Detroit, MI',
    snippet: 'A new device signed in to your account. If this was you, no action is needed.',
    from: { name: 'GigaMail Security', email: 'security@gigamail.local', color: '#455a64' },
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 28).toISOString(),
    unread: false,
    starred: false,
    labels: ['Security'],
    folder: 'inbox',
    messageCount: 1,
    messages: [
      {
        id: 'security-1',
        from: { name: 'GigaMail Security', email: 'security@gigamail.local', color: '#455a64' },
        to: ['Nova Centauri'],
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 28).toISOString(),
        body: 'A new device signed in to your account. If this was you, no action is needed.\n\nDevice: Firefox on macOS\nLocation: Detroit, MI',
      },
    ],
  },
  {
    id: 'newsletter',
    threadId: 'newsletter',
    subject: 'The Friday field notes',
    snippet: 'A few excellent reads, a small idea about tools, and a recipe worth keeping.',
    from: { name: 'Field Notes', email: 'hello@fieldnotes.news', color: '#7b1fa2' },
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 50).toISOString(),
    unread: false,
    starred: false,
    labels: ['Newsletters'],
    folder: 'inbox',
    messageCount: 1,
    messages: [
      {
        id: 'newsletter-1',
        from: { name: 'Field Notes', email: 'hello@fieldnotes.news', color: '#7b1fa2' },
        to: ['Nova Centauri'],
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 50).toISOString(),
        body: 'A few excellent reads, a small idea about tools, and a recipe worth keeping.\n\nThis edition was delivered with remote images held back for your privacy.',
        remoteContentBlocked: true,
      },
    ],
  },
];

function initials(value = '') {
  return value
    .trim()
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || '?';
}

function dateValue(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? new Date() : parsed;
}

function formatListDate(value) {
  const date = dateValue(value);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isToday) return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  if (date.getFullYear() === now.getFullYear()) return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatMessageDate(value) {
  return dateValue(value).toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getArray(payload, keys = []) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  for (const key of keys) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [];
}

function normalizePerson(value, fallback = {}) {
  if (typeof value === 'string') {
    const match = value.match(/^(.*)\s+<([^>]+)>$/);
    return { name: match?.[1]?.replace(/['\"]/g, '').trim() || value, email: match?.[2] || value, ...fallback };
  }
  const source = value || {};
  return {
    name: source.name || source.displayName || source.email || source.address || fallback.name || 'Unknown sender',
    email: source.email || source.address || source.mailbox || fallback.email || '',
    avatarUrl: source.avatarUrl || source.avatar || source.photoUrl || fallback.avatarUrl,
    color: source.color || fallback.color,
  };
}

function formatRecipients(value) {
  const recipients = Array.isArray(value) ? value : value ? [value] : [];
  return recipients.map((recipient) => {
    const person = normalizePerson(recipient);
    if (person.name && person.email && person.name !== person.email) return `${person.name} <${person.email}>`;
    return person.email || person.name;
  }).filter(Boolean).join(', ');
}

function normalizeMessage(raw, index = 0) {
  const from = normalizePerson(raw.from || raw.sender || raw.fromAddress, { color: raw.color });
  return {
    id: String(raw.id || raw.messageId || `message-${index}`),
    rfcMessageId: raw.messageId || raw.rfcMessageId || raw.id || null,
    from,
    to: raw.to || raw.recipients || raw.toAddresses || [],
    cc: raw.cc || [],
    bcc: raw.bcc || [],
    timestamp: raw.timestamp || raw.date || raw.sentAt || raw.receivedAt || new Date().toISOString(),
    body: raw.textBody || raw.bodyText || raw.text || raw.body || raw.snippet || '',
    bodyHtml: raw.htmlBody || raw.bodyHtml || raw.html || '',
    attachments: (raw.attachments || []).map((attachment) => ({
      ...attachment,
      name: attachment.name || attachment.filename || 'Attachment',
    })),
    remoteContentBlocked: Boolean(raw.remoteContentBlocked || raw.trackerBlocked || raw.hasRemoteContent || raw.remoteImageCount > 0),
    remoteContentLoaded: Boolean(raw.remoteContentLoaded),
  };
}

function inferFolder(raw = {}) {
  if (raw.folder) return String(raw.folder).toLowerCase();
  if (raw.isSent) return 'sent';
  if (raw.isTrashed) return 'trash';
  if (raw.isSpam) return 'spam';
  if (raw.isArchived) return 'archive';
  const mailbox = String(raw.mailbox || 'inbox').toLowerCase();
  if (/sent/.test(mailbox)) return 'sent';
  if (/(trash|deleted)/.test(mailbox)) return 'trash';
  if (/draft/.test(mailbox)) return 'drafts';
  if (/(spam|junk)/.test(mailbox)) return 'spam';
  if (/(archive|all mail)/.test(mailbox)) return 'archive';
  return 'inbox';
}

function normalizeThread(raw, index = 0) {
  const messages = getArray(raw, ['messages', 'items']).map(normalizeMessage);
  const latest = messages.at(-1) || normalizeMessage(raw, index);
  const from = normalizePerson(raw.from || raw.sender || latest.from, latest.from);
  return {
    id: String(raw.id || raw.threadId || raw.conversationId || `thread-${index}`),
    threadId: String(raw.threadId || raw.id || raw.conversationId || `thread-${index}`),
    subject: raw.subject || latest.subject || '(no subject)',
    snippet: raw.snippet || raw.preview || latest.body.replace(/\s+/g, ' ').slice(0, 170),
    from,
    participants: raw.participants || raw.people || [],
    timestamp: raw.timestamp || raw.latestAt || raw.updatedAt || raw.sentAt || raw.receivedAt || raw.date || latest.timestamp,
    unread: Boolean(raw.unread ?? raw.isUnread ?? (raw.unreadCount !== undefined ? Number(raw.unreadCount) > 0 : raw.isRead === false)),
    starred: Boolean(raw.starred ?? raw.isStarred),
    labels: raw.labels || raw.tags || [],
    folder: inferFolder(raw),
    messageCount: raw.messageCount || raw.count || messages.length || 1,
    hasAttachments: Boolean(raw.hasAttachments || raw.attachments?.length || messages.some((message) => message.attachments.length)),
    messages,
  };
}

function normalizeAccount(raw, index = 0) {
  const person = normalizePerson(raw);
  return {
    id: String(raw.id || raw.accountId || raw.email || `account-${index}`),
    name: raw.name || raw.displayName || person.name,
    email: raw.email || raw.address || person.email,
    avatarUrl: raw.avatarUrl || raw.avatar || raw.photoUrl,
    color: raw.color || ['#8e24aa', '#0b57d0', '#e8710a', '#00897b'][index % 4],
    signature: raw.signature || '',
    connected: raw.connected !== false && raw.status !== 'error',
  };
}

async function api(path, options = {}) {
  const hasBody = options.body !== undefined;
  const accessToken = getAccessToken();
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const error = new Error(detail || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) return null;
  const contentType = response.headers.get('content-type') || '';
  return contentType.includes('application/json') ? response.json() : response.text();
}

function plainTextToHtml(text) {
  const escaped = String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
  return escaped.split(/\n\s*\n/).map((paragraph) => `<p>${paragraph.replace(/\n/g, '<br>')}</p>`).join('');
}

function sanitizeEmailHtml(html, allowRemoteContent = false) {
  if (!html || typeof window === 'undefined' || typeof DOMParser === 'undefined') return '';
  const parser = new DOMParser();
  const documentNode = parser.parseFromString(String(html), 'text/html');
  documentNode.querySelectorAll('script, style, link, meta, base, form, iframe, object, embed, video, audio, svg, math').forEach((element) => element.remove());
  documentNode.querySelectorAll('*').forEach((element) => {
    [...element.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on') || name === 'style' || name === 'srcset' || name === 'poster' || name === 'background') element.removeAttribute(attribute.name);
    });
    if (element.tagName === 'A') {
      const href = element.getAttribute('href') || '';
      try {
        const parsed = new URL(href, window.location.href);
        if (!['http:', 'https:', 'mailto:', 'tel:'].includes(parsed.protocol)) element.removeAttribute('href');
        else {
          element.setAttribute('target', '_blank');
          element.setAttribute('rel', 'noopener noreferrer');
        }
      } catch {
        element.removeAttribute('href');
      }
    }
    if (element.tagName === 'IMG') {
      const privateRemotePath = element.getAttribute('data-remote-content') || '';
      if (privateRemotePath) {
        try {
          const remoteUrl = new URL(privateRemotePath, window.location.href);
          const isIssuedRemotePath = remoteUrl.origin === window.location.origin && remoteUrl.pathname === '/api/content/remote';
          const isTracker = element.getAttribute('data-remote-blocked') === 'tracker';
          if (allowRemoteContent && isIssuedRemotePath && !isTracker) {
            element.setAttribute('src', `${remoteUrl.pathname}${remoteUrl.search}`);
            element.setAttribute('referrerpolicy', 'no-referrer');
          } else {
            element.removeAttribute('src');
            element.setAttribute('alt', element.getAttribute('alt') || (isTracker ? 'Tracking image blocked' : 'Remote image blocked'));
            element.classList.add('blocked-email-image');
          }
          return;
        } catch {
          element.removeAttribute('data-remote-content');
        }
      }
      const src = element.getAttribute('src') || '';
      try {
        const parsed = new URL(src, window.location.href);
        const localImage = parsed.origin === window.location.origin && parsed.protocol !== 'data:';
        const safeDataImage = /^data:image\/(png|gif|jpe?g|webp);/i.test(src);
        if (localImage || safeDataImage) return;
        if (!localImage && !safeDataImage) {
          element.removeAttribute('src');
          element.setAttribute('alt', element.getAttribute('alt') || 'Remote image blocked');
          element.classList.add('blocked-email-image');
        }
      } catch {
        element.removeAttribute('src');
      }
    }
  });
  return documentNode.body.innerHTML;
}

function Icon({ name, size = 20, className = '' }) {
  const paths = {
    menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
    search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    inbox: <><path d="M4.5 5.5h15v12h-15z" /><path d="M4.5 13h4l1.5 2h4l1.5-2h4" /></>,
    star: <><path d="m12 3 2.7 5.5 6 .9-4.3 4.2 1 6-5.4-2.9-5.4 2.9 1-6-4.3-4.2 6-.9z" /></>,
    clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.4 2" /></>,
    send: <><path d="m3.8 4.5 16.4 7.1-16.4 7.9 2.4-6.2 6.1-1.7-6.1-1.6z" /></>,
    draft: <><path d="M5.5 4.5h9l4 4v11h-13z" /><path d="M14.5 4.5v4h4M8 13h8M8 16h5" /></>,
    tag: <><path d="M3.5 12V5.5h6.5l8.5 8.5-6 6z" /><circle cx="7.7" cy="8.2" r="1" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19 13.5v-3l-2.2-.7a6.6 6.6 0 0 0-.7-1.6l1.1-2-2.1-2.1-2 1.1a6.6 6.6 0 0 0-1.6-.7L10.8 2h-3l-.7 2.2a6.6 6.6 0 0 0-1.6.7l-2-1.1-2.1 2.1 1.1 2a6.6 6.6 0 0 0-.7 1.6l-2.2.7v3l2.2.7a6.6 6.6 0 0 0 .7 1.6l-1.1 2 2.1 2.1 2-1.1a6.6 6.6 0 0 0 1.6.7l.7 2.2h3l.7-2.2a6.6 6.6 0 0 0 1.6-.7l2 1.1 2.1-2.1-1.1-2a6.6 6.6 0 0 0 .7-1.6z" /></>,
    help: <><circle cx="12" cy="12" r="8.5" /><path d="M9.5 9a2.6 2.6 0 1 1 4.6 1.7c-1.1 1.2-2.1 1.5-2.1 3.1M12 16.9v.1" /></>,
    apps: <><circle cx="6" cy="6" r="1.2" fill="currentColor" stroke="none" /><circle cx="12" cy="6" r="1.2" fill="currentColor" stroke="none" /><circle cx="18" cy="6" r="1.2" fill="currentColor" stroke="none" /><circle cx="6" cy="12" r="1.2" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" /><circle cx="18" cy="12" r="1.2" fill="currentColor" stroke="none" /><circle cx="6" cy="18" r="1.2" fill="currentColor" stroke="none" /><circle cx="12" cy="18" r="1.2" fill="currentColor" stroke="none" /><circle cx="18" cy="18" r="1.2" fill="currentColor" stroke="none" /></>,
    refresh: <><path d="M20 11a8 8 0 0 0-14.8-4.2L3 9M3 4.5V9h4.5M4 13a8 8 0 0 0 14.8 4.2L21 15M21 19.5V15h-4.5" /></>,
    more: <><circle cx="12" cy="5" r="1.1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" /><circle cx="12" cy="19" r="1.1" fill="currentColor" stroke="none" /></>,
    archive: <><path d="M4 7h16v12H4zM3 4h18v3H3z" /><path d="M9 12h6" /></>,
    trash: <><path d="M5 7h14l-1 13H6zM9 7V4h6v3M3.5 7h17" /><path d="M10 11v5M14 11v5" /></>,
    spam: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z" /><path d="M12 8v5M12 16v.1" /></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="1.5" /><path d="m4 7 8 6 8-6" /></>,
    unread: <><path d="M4 6h16v12H4z" /><path d="m4.5 7 7.5 5.6L19.5 7" /></>,
    back: <><path d="m14.5 5-7 7 7 7M8 12h11" /></>,
    forward: <><path d="m9.5 5 7 7-7 7M16 12H5" /></>,
    reply: <><path d="m9.5 6-6 6 6 6v-4h4.3c2.6 0 4.6 1 6.2 3.3-.3-4.9-3-7.3-7.2-7.3H9.5z" /></>,
    chevronDown: <><path d="m7 9 5 5 5-5" /></>,
    chevronRight: <><path d="m9 6 6 6-6 6" /></>,
    move: <><path d="M4 6h6l2 2h8v10H4z" /><path d="m12 11 3 3-3 3M15 14H8" /></>,
    snooze: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.5 2M9 3h6" /></>,
    link: <><path d="M10.3 13.7a4 4 0 0 0 5.7 0l2-2a4 4 0 0 0-5.7-5.7l-1.1 1.1M13.7 10.3a4 4 0 0 0-5.7 0l-2 2A4 4 0 0 0 11.7 18l1.1-1.1" /></>,
    attachment: <><path d="m8.5 12.5 5.4-5.4a2.8 2.8 0 0 1 4 4l-7.5 7.5a4.6 4.6 0 0 1-6.5-6.5l7.2-7.2" /></>,
    compose: <><path d="M4 19.5 5.4 15 15.8 4.6a2.1 2.1 0 0 1 3 3L8.4 18zM13.8 6.6l3 3" /></>,
    expand: <><path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5" /></>,
    minimize: <><path d="M6 12h12" /></>,
    check: <><path d="m5 12 4.2 4.2L19 6.5" /></>,
    shield: <><path d="M12 3 19 6v5c0 4.4-2.8 7.7-7 10-4.2-2.3-7-5.6-7-10V6z" /><path d="m8.7 12 2.2 2.2 4.5-4.5" /></>,
    eyeOff: <><path d="M3 3l18 18M10.6 6.2A10 10 0 0 1 12 6c4.7 0 8.3 3.3 9.5 6- .5 1.1-1.4 2.3-2.7 3.4M6.4 6.5C4.4 7.8 3 9.8 2.5 12c1.2 2.7 4.8 6 9.5 6 1.4 0 2.7-.3 3.8-.8M9.7 9.8A3 3 0 0 0 14.2 14" /></>,
    tune: <><path d="M4 7h10M17 7h3M4 12h3M10 12h10M4 17h11M18 17h2" /><circle cx="15" cy="7" r="2" fill="var(--surface)" /><circle cx="8" cy="12" r="2" fill="var(--surface)" /><circle cx="16" cy="17" r="2" fill="var(--surface)" /></>,
  };
  return (
    <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name] || paths.more}
    </svg>
  );
}

function IconButton({ label, onClick, active = false, disabled = false, children, className = '', type = 'button' }) {
  return (
    <button
      type={type}
      className={`icon-button ${active ? 'is-active' : ''} ${className}`}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function Avatar({ person, size = 'md', className = '' }) {
  const [imageFailed, setImageFailed] = useState(false);
  const source = person || {};
  const image = source.avatarUrl || source.avatar;
  const style = source.color ? { '--avatar-color': source.color } : undefined;
  return (
    <span className={`avatar avatar-${size} ${className}`} style={style} aria-label={source.name || source.email || 'Profile'}>
      {source.isUnified ? (
        <Icon name="inbox" size={size === 'hero' ? 32 : size === 'top' ? 17 : 18} />
      ) : image && !imageFailed ? (
        <img src={image} alt="" onError={() => setImageFailed(true)} />
      ) : (
        initials(source.name || source.email)
      )}
    </span>
  );
}

function Checkbox({ checked, onChange, label = 'Select' }) {
  return (
    <label className="check-wrap" aria-label={label} onClick={(event) => event.stopPropagation()}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="custom-check"><Icon name="check" size={14} /></span>
    </label>
  );
}

function Tooltip({ children, text }) {
  return <span className="tooltip-wrap" data-tooltip={text}>{children}</span>;
}

function Topbar({ onToggleSidebar, sidebarCompact, query, setQuery, onOpenSettings, onOpenProfile, account, isDemo }) {
  const searchRef = useRef(null);
  useEffect(() => {
    const focusSearch = (event) => {
      if (event.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, []);

  return (
    <header className="topbar">
      <Tooltip text={sidebarCompact ? 'Show navigation' : 'Hide navigation'}>
        <IconButton label={sidebarCompact ? 'Show navigation' : 'Hide navigation'} onClick={onToggleSidebar} className="top-menu">
          <Icon name="menu" />
        </IconButton>
      </Tooltip>
      <button type="button" className="brand" aria-label="GigaMail home">
        <span className="brand-mark"><span>G</span></span>
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
        <Tooltip text="Show search options">
          <IconButton label="Show search options" className="search-filter">
            <Icon name="tune" size={20} />
          </IconButton>
        </Tooltip>
      </div>
      <div className="top-actions">
        <Tooltip text="Support">
          <IconButton label="Support"><Icon name="help" /></IconButton>
        </Tooltip>
        <Tooltip text="Quick settings">
          <IconButton label="Quick settings" onClick={onOpenSettings}><Icon name="settings" /></IconButton>
        </Tooltip>
        <Tooltip text="Google apps">
          <IconButton label="Apps"><Icon name="apps" /></IconButton>
        </Tooltip>
        <button type="button" className="account-trigger" onClick={onOpenProfile} aria-label="Open account menu">
          <Avatar person={account} size="top" />
        </button>
      </div>
    </header>
  );
}

function Sidebar({ compact, mobileOpen, onCloseMobile, activeFolder, setActiveFolder, counts, onCompose, accounts, activeAccount, setActiveAccount, onSelectUnified, onOpenSettings, isDemo }) {
  const [showMore, setShowMore] = useState(false);
  const displayAccounts = accounts.length ? accounts : isDemo ? demoAccounts : [];
  const items = showMore
    ? [...folders, { id: 'all', label: 'All mail', icon: 'mail' }, { id: 'spam', label: 'Spam', icon: 'spam' }, { id: 'trash', label: 'Trash', icon: 'trash' }]
    : folders;
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
                onClick={() => { setActiveFolder(item.id); onCloseMobile(); }}
                className={`nav-item ${activeFolder === item.id ? 'is-selected' : ''}`}
                title={compact ? item.label : undefined}
              >
                <Icon name={item.icon} size={20} />
                <span className="nav-label">{item.label}</span>
                {counts[item.id] > 0 && <span className="nav-count">{counts[item.id]}</span>}
              </button>
            ))}
            <button type="button" className="nav-item more-nav" onClick={() => setShowMore((value) => !value)} title={compact ? 'More' : undefined}>
              <Icon name={showMore ? 'chevronDown' : 'chevronRight'} size={19} />
              <span className="nav-label">{showMore ? 'Less' : 'More'}</span>
            </button>
          </nav>
          <div className="labels-section">
            <div className="side-section-heading">
              <span>Labels</span>
              <IconButton label="Create new label"><Icon name="plus" size={18} /></IconButton>
            </div>
            <button type="button" className="nav-item label-nav"><span className="label-dot label-work" /><span className="nav-label">Work</span></button>
            <button type="button" className="nav-item label-nav"><span className="label-dot label-important" /><span className="nav-label">Important</span></button>
            <button type="button" className="nav-item label-nav"><span className="label-dot label-receipts" /><span className="nav-label">Receipts</span></button>
          </div>
          <div className="accounts-section">
            <div className="side-section-heading"><span>Accounts</span></div>
            {accounts.length > 0 && (
              <button type="button" className={`account-row unified-account-row ${!activeAccount ? 'is-active' : ''}`} onClick={() => { onSelectUnified(); onCloseMobile(); }} title={compact ? 'All inboxes' : undefined}>
                <Avatar person={UNIFIED_ACCOUNT} size="sm" />
                <span className="account-row-text"><strong>All inboxes</strong><small>Unified inbox</small></span>
                {!activeAccount && <Icon name="check" size={16} />}
              </button>
            )}
            {displayAccounts.map((account) => (
              <button type="button" key={account.id} className={`account-row ${activeAccount?.id === account.id ? 'is-active' : ''}`} onClick={() => setActiveAccount(account)} title={compact ? account.email : undefined}>
                <Avatar person={account} size="sm" />
                <span className="account-row-text"><strong>{account.name}</strong><small>{account.email}</small></span>
                <span className={`connection-dot ${account.connected ? 'is-connected' : ''}`} />
              </button>
            ))}
          </div>
        </div>
        <button type="button" className="storage-card" onClick={onOpenSettings} title={compact ? 'Storage and settings' : undefined}>
          <span className="storage-meter"><i /></span>
          <span className="storage-copy"><strong>3.1 GB of 20 GB</strong><small>Storage used</small></span>
        </button>
      </aside>
    </>
  );
}

function ListToolbar({ visibleCount, totalCount, selectedCount, onRefresh, onBulkAction, allSelected, onToggleAll, loading }) {
  return (
    <div className="list-toolbar">
      <div className="toolbar-left">
        <Checkbox checked={allSelected} onChange={onToggleAll} label="Select all conversations" />
        <IconButton label="Select options"><Icon name="chevronDown" size={17} /></IconButton>
        {selectedCount > 0 ? (
          <>
            <IconButton label="Archive" onClick={() => onBulkAction('archive')}><Icon name="archive" /></IconButton>
            <IconButton label="Report spam" onClick={() => onBulkAction('spam')}><Icon name="spam" /></IconButton>
            <IconButton label="Delete" onClick={() => onBulkAction('trash')}><Icon name="trash" /></IconButton>
            <IconButton label="Mark as unread" onClick={() => onBulkAction('unread')}><Icon name="unread" /></IconButton>
            <IconButton label="Snooze" onClick={() => onBulkAction('snooze')}><Icon name="snooze" /></IconButton>
          </>
        ) : (
          <IconButton label="Refresh" onClick={onRefresh} disabled={loading} className={loading ? 'is-spinning' : ''}><Icon name="refresh" /></IconButton>
        )}
        <IconButton label="More"><Icon name="more" /></IconButton>
      </div>
      <div className="toolbar-right">
        <span className="range-copy">{visibleCount ? `1–${visibleCount} of ${totalCount}` : '0 of 0'}</span>
        <IconButton label="Newer"><Icon name="back" size={19} /></IconButton>
        <IconButton label="Older"><Icon name="forward" size={19} /></IconButton>
      </div>
    </div>
  );
}

function ThreadRow({ thread, selected, isChecked, onOpen, onCheck, onToggleStar }) {
  const sender = thread.from?.name || thread.from?.email || 'Unknown sender';
  return (
    <article
      className={`thread-row ${thread.unread ? 'is-unread' : ''} ${selected ? 'is-selected' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(thread)}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(thread); } }}
    >
      <Checkbox checked={isChecked} onChange={onCheck} label={`Select ${thread.subject}`} />
      <IconButton label={thread.starred ? 'Unstar' : 'Star'} active={thread.starred} onClick={(event) => { event.stopPropagation(); onToggleStar(thread); }} className="row-star">
        <Icon name="star" size={19} />
      </IconButton>
      <div className="row-sender" title={sender}>{sender}</div>
      <div className="row-subject">
        <strong>{thread.subject || '(no subject)'}</strong>
        <span> — {thread.snippet}</span>
      </div>
      <div className="row-meta">
        {thread.hasAttachments && <Icon name="attachment" size={17} />}
        {thread.messageCount > 1 && <span className="thread-count">{thread.messageCount}</span>}
        <time>{formatListDate(thread.timestamp)}</time>
      </div>
    </article>
  );
}

function EmptyMailbox({ folder, query, onCompose, onClearSearch, onRefresh }) {
  const title = query ? 'No mail matched your search' : folder === 'inbox' ? 'Your inbox is clear' : `Nothing in ${folder}`;
  const copy = query
    ? 'Try a sender, subject, or a different search term.'
    : folder === 'inbox'
      ? 'Take a breath. New conversations will appear here.'
      : 'Mail moved here will appear when it is available.';
  return (
    <div className="empty-state">
      <div className="empty-icon"><Icon name={query ? 'search' : folder === 'inbox' ? 'inbox' : 'mail'} size={38} /></div>
      <h2>{title}</h2>
      <p>{copy}</p>
      <div className="empty-actions">
        {query ? <button type="button" className="secondary-button" onClick={onClearSearch}>Clear search</button> : <button type="button" className="primary-button" onClick={onCompose}><Icon name="compose" size={18} /> Compose</button>}
        <button type="button" className="text-button" onClick={onRefresh}>Refresh</button>
      </div>
    </div>
  );
}

function SkeletonRows() {
  return (
    <div className="skeleton-list" aria-label="Loading messages">
      {Array.from({ length: 7 }, (_, index) => <div className="skeleton-row" key={index}><i /><span /><b /><em /></div>)}
    </div>
  );
}

function MailList({ threads, selectedThread, loading, folder, query, selectedIds, setSelectedIds, onOpenThread, onToggleStar, onRefresh, onBulkAction, onCompose }) {
  const allSelected = threads.length > 0 && threads.every((thread) => selectedIds.includes(thread.id));
  const toggleAll = () => setSelectedIds(allSelected ? [] : threads.map((thread) => thread.id));
  const toggleOne = (thread, checked) => setSelectedIds((current) => checked ? [...new Set([...current, thread.id])] : current.filter((id) => id !== thread.id));
  return (
    <section className={`mail-list-panel ${selectedThread ? 'has-selected-thread' : ''}`} aria-label="Conversation list">
      <ListToolbar
        visibleCount={threads.length}
        totalCount={threads.length}
        selectedCount={selectedIds.length}
        onRefresh={onRefresh}
        onBulkAction={onBulkAction}
        allSelected={allSelected}
        onToggleAll={toggleAll}
        loading={loading}
      />
      {loading && !threads.length ? <SkeletonRows /> : threads.length ? (
        <div className="thread-list">
          {threads.map((thread) => (
            <ThreadRow
              key={thread.id}
              thread={thread}
              selected={selectedThread?.id === thread.id}
              isChecked={selectedIds.includes(thread.id)}
              onOpen={onOpenThread}
              onCheck={(checked) => toggleOne(thread, checked)}
              onToggleStar={onToggleStar}
            />
          ))}
        </div>
      ) : (
        <EmptyMailbox folder={folder} query={query} onCompose={onCompose} onClearSearch={() => {}} onRefresh={onRefresh} />
      )}
    </section>
  );
}

function ThreadToolbar({ onBack, onAction, isRead }) {
  return (
    <div className="thread-toolbar">
      <div className="toolbar-left">
        <IconButton label="Back to inbox" onClick={onBack}><Icon name="back" /></IconButton>
        <span className="toolbar-separator" />
        <IconButton label="Archive" onClick={() => onAction('archive')}><Icon name="archive" /></IconButton>
        <IconButton label="Report spam" onClick={() => onAction('spam')}><Icon name="spam" /></IconButton>
        <IconButton label="Delete" onClick={() => onAction('trash')}><Icon name="trash" /></IconButton>
        <IconButton label={isRead ? 'Mark as unread' : 'Mark as read'} onClick={() => onAction(isRead ? 'unread' : 'read')}><Icon name={isRead ? 'unread' : 'mail'} /></IconButton>
        <IconButton label="Snooze" onClick={() => onAction('snooze')}><Icon name="snooze" /></IconButton>
        <IconButton label="Move to" onClick={() => onAction('move')}><Icon name="move" /></IconButton>
        <IconButton label="Labels" onClick={() => onAction('label')}><Icon name="tag" /></IconButton>
        <IconButton label="More"><Icon name="more" /></IconButton>
      </div>
      <div className="toolbar-right">
        <IconButton label="Newer conversation"><Icon name="back" size={19} /></IconButton>
        <IconButton label="Older conversation"><Icon name="forward" size={19} /></IconButton>
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
          {message.attachments.map((attachment, index) => (
            <button type="button" className="attachment-chip" key={attachment.id || attachment.name || index}>
              <Icon name="attachment" size={17} />
              <span>{attachment.name || 'Attachment'}</span>
              {attachment.size && <small>{attachment.size}</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MessageCard({ message, expanded, onToggle, onLoadRemote, onReply, onForward, allowPrivateImages }) {
  const from = message.from || {};
  const recipientList = formatRecipients(message.to);
  return (
    <article className={`message-card ${expanded ? 'is-expanded' : ''}`}>
      <button type="button" className="message-summary" onClick={onToggle} aria-expanded={expanded}>
        <Avatar person={from} size="md" />
        <span className="message-sender"><strong>{from.name || from.email || 'Unknown sender'}</strong><small>{expanded ? `to ${recipientList || 'me'}` : message.body?.replace(/\s+/g, ' ').slice(0, 88)}</small></span>
        <time>{expanded ? formatMessageDate(message.timestamp) : formatListDate(message.timestamp)}</time>
        <Icon name="chevronDown" size={18} className={expanded ? 'is-rotated' : ''} />
      </button>
      {expanded && (
        <div className="message-content">
          <div className="message-utilities">
            <span>to {recipientList || 'me'}</span>
            <div>
              <IconButton label="Reply" onClick={() => onReply(message)}><Icon name="reply" size={18} /></IconButton>
              <IconButton label="More"><Icon name="more" size={18} /></IconButton>
            </div>
          </div>
          <MessageBody message={message} onLoadRemote={onLoadRemote} allowPrivateImages={allowPrivateImages} />
          <div className="message-reply-actions">
            <button type="button" className="secondary-button" onClick={() => onReply(message)}><Icon name="reply" size={18} /> Reply</button>
            <button type="button" className="secondary-button" onClick={() => onForward(message)}><Icon name="forward" size={18} /> Forward</button>
          </div>
        </div>
      )}
    </article>
  );
}

function ThreadView({ thread, activeFolder, onBack, onAction, onLoadRemote, onReply, onForward, allowPrivateImages }) {
  const sourceMessages = thread.messages?.length ? thread.messages : [normalizeMessage(thread)];
  const [expandedIds, setExpandedIds] = useState(() => new Set([sourceMessages.at(-1)?.id]));
  useEffect(() => setExpandedIds(new Set([sourceMessages.at(-1)?.id])), [thread.id]);
  const toggleExpanded = (id) => setExpandedIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  return (
    <section className="thread-panel" aria-label="Open conversation">
      <ThreadToolbar onBack={onBack} onAction={onAction} isRead={!thread.unread} />
      <div className="thread-scroll">
        <div className="thread-heading">
          <h1>{thread.subject || '(no subject)'}</h1>
          <div className="heading-labels">
            {(thread.labels || []).map((label) => <span key={label} className="message-label">{label}</span>)}
            {activeFolder !== 'inbox' && <span className="message-label neutral-label">{activeFolder}</span>}
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
              onForward={(target) => onForward(thread, target)}
              allowPrivateImages={allowPrivateImages}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function ComposeModal({ account, accounts, onClose, onSent, initialReply }) {
  const [form, setForm] = useState({
    to: initialReply?.to || '',
    cc: '',
    bcc: '',
    subject: initialReply?.subject || '',
    body: initialReply?.body || '',
  });
  const [extraFields, setExtraFields] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');
  const [senderId, setSenderId] = useState(account?.id || accounts[0]?.id || '');
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  useEffect(() => {
    setSenderId((current) => accounts.some((item) => item.id === current) ? current : account?.id || accounts[0]?.id || '');
  }, [account?.id, accounts]);
  const senderAccount = accounts.find((item) => item.id === senderId) || account || accounts[0] || null;
  const send = async (event) => {
    event.preventDefault();
    if (!form.to.trim()) { setError('Add at least one recipient.'); return; }
    setError('');
    setIsSending(true);
    // The server appends the selected identity's stored signature exactly once.
    const textBody = form.body;
    const payload = {
      to: form.to.split(',').map((value) => value.trim()).filter(Boolean),
      cc: form.cc.split(',').map((value) => value.trim()).filter(Boolean),
      bcc: form.bcc.split(',').map((value) => value.trim()).filter(Boolean),
      subject: form.subject,
      textBody,
      htmlBody: plainTextToHtml(textBody),
      accountId: senderAccount?.id,
      ...(initialReply?.threadId ? { threadId: initialReply.threadId } : {}),
      ...(initialReply?.replyToMessageId ? { replyToMessageId: initialReply.replyToMessageId } : {}),
    };
    try {
      await api('/messages', { method: 'POST', body: JSON.stringify(payload) });
      onSent(payload, false, senderAccount);
      onClose();
    } catch (requestError) {
      // A disconnected local API should not make a draft disappear in preview mode.
      if (String(requestError.message).includes('Failed to fetch')) {
        onSent(payload, true, senderAccount);
        onClose();
      } else {
        setError('Could not send this message. Your draft is still open.');
      }
    } finally {
      setIsSending(false);
    }
  };
  return (
    <div className={`compose-window ${isMinimized ? 'is-minimized' : ''}`} role="dialog" aria-modal="true" aria-label="New message">
      <div className="compose-titlebar">
        <span>New Message</span>
        <div>
          <IconButton label={isMinimized ? 'Restore' : 'Minimize'} onClick={() => setIsMinimized((value) => !value)}><Icon name="minimize" size={17} /></IconButton>
          <IconButton label="Full screen"><Icon name="expand" size={16} /></IconButton>
          <IconButton label="Save and close" onClick={onClose}><Icon name="close" size={17} /></IconButton>
        </div>
      </div>
      {!isMinimized && (
        <form className="compose-form" onSubmit={send}>
          <div className="recipient-line">
            <input autoFocus value={form.to} onChange={update('to')} placeholder="Recipients" aria-label="Recipients" />
            <button type="button" onClick={() => setExtraFields((value) => !value)}>{extraFields ? 'Hide' : 'Cc Bcc'}</button>
          </div>
          {accounts.length > 1 && (
            <div className="recipient-line from-line">
              <span>From</span>
              <select value={senderId} onChange={(event) => setSenderId(event.target.value)} aria-label="Send from account">
                {accounts.map((item) => <option key={item.id} value={item.id}>{item.name} &lt;{item.email}&gt;</option>)}
              </select>
            </div>
          )}
          {extraFields && <><div className="recipient-line"><input value={form.cc} onChange={update('cc')} placeholder="Cc" aria-label="Cc" /></div><div className="recipient-line"><input value={form.bcc} onChange={update('bcc')} placeholder="Bcc" aria-label="Bcc" /></div></>}
          <div className="recipient-line subject-line"><input value={form.subject} onChange={update('subject')} placeholder="Subject" aria-label="Subject" /></div>
          <textarea value={form.body} onChange={update('body')} placeholder="Write your message" aria-label="Message body" />
          {senderAccount?.signature && <div className="signature-preview">{senderAccount.signature}</div>}
          {error && <p className="compose-error">{error}</p>}
          <div className="compose-footer">
            <button type="submit" className="send-button" disabled={isSending}>{isSending ? 'Sending…' : 'Send'}</button>
            <IconButton label="Attach files"><Icon name="attachment" /></IconButton>
            <IconButton label="Insert link"><Icon name="link" /></IconButton>
            <IconButton label="More options"><Icon name="more" /></IconButton>
            <span className="compose-spacer" />
            <IconButton label="Discard draft" onClick={onClose}><Icon name="trash" /></IconButton>
          </div>
        </form>
      )}
    </div>
  );
}

function Toggle({ checked, onChange, label, hint }) {
  return (
    <label className="settings-toggle">
      <span><strong>{label}</strong>{hint && <small>{hint}</small>}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <i aria-hidden="true" />
    </label>
  );
}

function SettingsPanel({ open, onClose, accounts, activeAccount, setActiveAccount, privacy, setPrivacy, onAddAccount, onUnlock, onSaveSignature, showUnified }) {
  const [density, setDensity] = useState('Default');
  const [signature, setSignature] = useState('');
  useEffect(() => setSignature(activeAccount?.signature || ''), [activeAccount?.id, activeAccount?.signature]);
  if (!open) return null;
  return (
    <>
      <button type="button" className="settings-scrim" onClick={onClose} aria-label="Close settings" />
      <aside className="settings-panel" aria-label="Quick settings">
        <div className="settings-header"><h2>Quick settings</h2><IconButton label="Close settings" onClick={onClose}><Icon name="close" /></IconButton></div>
        <div className="settings-scroll">
          <section className="settings-section">
            <h3>Accounts</h3>
            <p className="settings-description">Switch identities or check connection status.</p>
            <div className="settings-accounts">
              {showUnified && (
                <button type="button" className={`settings-account ${!activeAccount ? 'is-active' : ''}`} onClick={() => setActiveAccount(null)}>
                  <Avatar person={UNIFIED_ACCOUNT} size="md" />
                  <span><strong>All inboxes</strong><small>Unified inbox</small></span>
                  <Icon name={!activeAccount ? 'check' : 'chevronRight'} size={18} />
                </button>
              )}
              {accounts.map((account) => (
                <button type="button" className={`settings-account ${activeAccount?.id === account.id ? 'is-active' : ''}`} key={account.id} onClick={() => setActiveAccount(account)}>
                  <Avatar person={account} size="md" />
                  <span><strong>{account.name}</strong><small>{account.email}</small></span>
                  <Icon name={activeAccount?.id === account.id ? 'check' : 'chevronRight'} size={18} />
                </button>
              ))}
            </div>
            <button type="button" className="add-account-button" onClick={onAddAccount}><Icon name="plus" size={18} /> Add another account</button>
          </section>
          <section className="settings-section">
            <h3>Density</h3>
            <div className="density-options">
              {['Default', 'Comfortable', 'Compact'].map((option) => <button type="button" key={option} onClick={() => setDensity(option)} className={density === option ? 'is-selected' : ''}><span className={`density-preview density-${option.toLowerCase()}`}><i /><i /><i /></span>{option}</button>)}
            </div>
          </section>
          <section className="settings-section privacy-section">
            <div className="settings-section-title"><h3>Privacy</h3><Icon name="shield" size={20} /></div>
            <p className="settings-description">Keep email content from identifying you.</p>
            <div className="privacy-enforced">
              <span><strong>Block email trackers</strong><small>Always on for known tracking pixels, even when images are allowed.</small></span>
              <em><Icon name="shield" size={15} /> Locked on</em>
            </div>
            <Toggle checked={privacy.privateImages} onChange={(value) => setPrivacy((current) => ({ ...current, privateImages: value }))} label="Offer private image loading" hint="Show a per-message option to load non-tracking images through the GigaMail relay." />
          </section>
          <section className="settings-section signature-section">
            <h3>Signature</h3>
            <p className="settings-description">{activeAccount ? `Sent from ${activeAccount.email}.` : 'Choose an account above to edit its sending signature.'}</p>
            <textarea disabled={!activeAccount} value={signature} placeholder="Add a signature" onChange={(event) => setSignature(event.target.value)} onBlur={() => { if (activeAccount && signature !== (activeAccount.signature || '')) onSaveSignature(activeAccount.id, signature); }} />
          </section>
          <section className="settings-section server-access-section">
            <div className="settings-section-title"><h3>Server access</h3><Icon name="shield" size={20} /></div>
            <p className="settings-description">Set a session-only access token if this GigaMail server is protected.</p>
            <button type="button" className="secondary-button" onClick={onUnlock}>Unlock server</button>
          </section>
        </div>
        <button type="button" className="full-settings-button">See all settings</button>
      </aside>
    </>
  );
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('The profile image could not be read.'));
    reader.readAsDataURL(file);
  });
}

function AddAccountModal({ onClose, onAdded }) {
  const [form, setForm] = useState({ name: '', email: '', provider: 'gmail', appPassword: '', signature: '', color: '#0b57d0', imapHost: '', imapPort: '993', smtpHost: '', smtpPort: '465', avatarUrl: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const chooseAvatar = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('Choose an image file for the profile photo.'); return; }
    if (file.size > 1_000_000) { setError('Choose a profile photo smaller than 1 MB.'); return; }
    try {
      const avatarUrl = await readFileAsDataUrl(file);
      setForm((current) => ({ ...current, avatarUrl }));
      setError('');
    } catch (readError) { setError(readError.message); }
  };
  const submit = async (event) => {
    event.preventDefault();
    if (!form.name.trim() || !form.email.trim() || !form.appPassword) { setError('Display name, email, and an app password are required.'); return; }
    if (['custom', 'imap'].includes(form.provider) && (!form.imapHost.trim() || !form.smtpHost.trim())) { setError('Add both IMAP and SMTP hosts for a custom provider.'); return; }
    setSaving(true); setError('');
    const payload = {
      name: form.name.trim(),
      displayName: form.name.trim(),
      email: form.email.trim(),
      provider: form.provider,
      credentials: { username: form.email.trim(), email: form.email.trim(), password: form.appPassword },
      signature: form.signature,
      color: form.color,
      avatarDataUrl: form.avatarUrl || undefined,
      ...(['custom', 'imap'].includes(form.provider) ? {
        imap: { host: form.imapHost.trim(), port: Number(form.imapPort) || 993, secure: Number(form.imapPort) === 993, username: form.email.trim() },
        smtp: { host: form.smtpHost.trim(), port: Number(form.smtpPort) || 465, secure: Number(form.smtpPort) === 465, username: form.email.trim() },
      } : {}),
    };
    try {
      const result = await api('/accounts', { method: 'POST', body: JSON.stringify(payload) });
      onAdded(normalizeAccount(result?.account || result || payload));
      onClose();
    } catch (requestError) {
      setError(requestError.status === 401 ? 'Unlock GigaMail before adding an account.' : 'Could not connect this account. Check the provider details and app password.');
    } finally { setSaving(false); }
  };
  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-label="Add email account">
      <button type="button" className="modal-scrim" onClick={onClose} aria-label="Close add account" />
      <form className="account-modal" onSubmit={submit}>
        <div className="account-modal-header"><div><h2>Add an email account</h2><p>Connect up to 12 inboxes in one private workspace.</p></div><IconButton label="Close" onClick={onClose}><Icon name="close" /></IconButton></div>
        <div className="account-modal-scroll">
          <div className="account-profile-row"><Avatar person={{ name: form.name || form.email || 'G', color: form.color, avatarUrl: form.avatarUrl }} size="hero" /><label className="photo-upload"><input type="file" accept="image/*" onChange={chooseAvatar} />{form.avatarUrl ? 'Replace profile photo' : 'Upload profile photo'}</label></div>
          <label className="form-field"><span>Display name</span><input value={form.name} onChange={update('name')} placeholder="e.g. Nova Centauri" autoFocus /></label>
          <label className="form-field"><span>Email address</span><input type="email" value={form.email} onChange={update('email')} placeholder="you@example.com" /></label>
          <label className="form-field"><span>Provider</span><select value={form.provider} onChange={update('provider')}><option value="gmail">Gmail / Google Workspace</option><option value="outlook">Outlook / Microsoft 365</option><option value="imap">Standard IMAP</option><option value="custom">Custom IMAP + SMTP</option></select></label>
          <label className="form-field"><span>App password</span><input type="password" value={form.appPassword} onChange={update('appPassword')} placeholder="Never stored in the browser" autoComplete="new-password" /><small>Create an app password with your mail provider; do not use your normal sign-in password.</small></label>
          {['custom', 'imap'].includes(form.provider) && <div className="provider-grid"><label className="form-field"><span>IMAP host</span><input value={form.imapHost} onChange={update('imapHost')} placeholder="imap.example.com" /></label><label className="form-field"><span>IMAP port</span><input inputMode="numeric" value={form.imapPort} onChange={update('imapPort')} /></label><label className="form-field"><span>SMTP host</span><input value={form.smtpHost} onChange={update('smtpHost')} placeholder="smtp.example.com" /></label><label className="form-field"><span>SMTP port</span><input inputMode="numeric" value={form.smtpPort} onChange={update('smtpPort')} /></label></div>}
          <label className="form-field"><span>Signature <em>optional</em></span><textarea value={form.signature} onChange={update('signature')} placeholder="Kind regards," /></label>
          <div className="color-picker"><span>Profile color</span><div>{['#0b57d0', '#8e24aa', '#e8710a', '#00897b', '#c2185b', '#455a64'].map((color) => <button type="button" key={color} onClick={() => setForm((current) => ({ ...current, color }))} className={form.color === color ? 'is-selected' : ''} style={{ '--swatch': color }} aria-label={`Choose ${color}`} />)}</div></div>
          {error && <p className="form-error">{error}</p>}
        </div>
        <div className="account-modal-footer"><button type="button" className="text-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? 'Connecting…' : 'Connect account'}</button></div>
      </form>
    </div>
  );
}

function AccessPanel({ open, required, currentToken, onSave, onClose }) {
  const [token, setToken] = useState(currentToken || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (open) { setToken(currentToken || ''); setError(''); } }, [open, currentToken]);
  if (!open) return null;
  const submit = async (event) => {
    event.preventDefault();
    setSaving(true); setError('');
    try { await onSave(token.trim()); } catch (requestError) { setError(requestError.message || 'That token did not unlock this server.'); } finally { setSaving(false); }
  };
  return (
    <div className="modal-layer access-layer" role="dialog" aria-modal="true" aria-label="Unlock GigaMail">
      {!required && <button type="button" className="modal-scrim" onClick={onClose} aria-label="Close unlock dialog" />}
      <form className="access-modal" onSubmit={submit}>
        <div className="access-mark"><Icon name="shield" size={26} /></div>
        <h2>{required ? 'Unlock GigaMail' : 'Server access token'}</h2>
        <p>{required ? 'This GigaMail server is protected. Enter its access token to open your mail.' : 'If this server has GIGAMAIL_ACCESS_TOKEN set, paste the matching token here.'}</p>
        <label className="form-field"><span>Access token</span><input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="GigaMail access token" autoFocus autoComplete="off" /></label>
        <small className="access-note">Stored only in this browser session and sent as a Bearer token to this GigaMail server.</small>
        {error && <p className="form-error">{error}</p>}
        <div className="access-actions">{!required && <button type="button" className="text-button" onClick={onClose}>Cancel</button>}<button type="submit" className="primary-button" disabled={saving || !token.trim()}>{saving ? 'Unlocking…' : 'Unlock'}</button></div>
      </form>
    </div>
  );
}

function ProfileMenu({ open, onClose, account, accounts, setActiveAccount, onSelectUnified, onOpenSettings, showUnified }) {
  if (!open) return null;
  return (
    <>
      <button type="button" className="profile-scrim" onClick={onClose} aria-label="Close account menu" />
      <section className="profile-menu" aria-label="Account menu">
        <button type="button" className="profile-close" onClick={onClose}><Icon name="close" size={18} /></button>
        <Avatar person={account} size="hero" />
        <strong>{account?.name}</strong>
        <span>{account?.email}</span>
        <button type="button" className="manage-account-button" onClick={() => { onOpenSettings(); onClose(); }}>Manage your accounts</button>
        <div className="profile-account-list">
          {showUnified && <button type="button" onClick={() => { onSelectUnified(); onClose(); }}><Avatar person={UNIFIED_ACCOUNT} size="sm" /><span>All inboxes</span>{account?.isUnified && <Icon name="check" size={17} />}</button>}
          {accounts.map((item) => <button type="button" key={item.id} onClick={() => { setActiveAccount(item); onClose(); }}><Avatar person={item} size="sm" /><span>{item.email}</span>{item.id === account?.id && <Icon name="check" size={17} />}</button>)}
        </div>
        <div className="profile-menu-footer"><button type="button">Privacy Policy</button><i>•</i><button type="button">Terms of Service</button></div>
      </section>
    </>
  );
}

function Toast({ notice, onClose }) {
  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(onClose, 4200);
    return () => window.clearTimeout(timer);
  }, [notice, onClose]);
  if (!notice) return null;
  return <div className="toast" role="status"><span>{notice}</span><button type="button" onClick={onClose}>Dismiss</button></div>;
}

export default function App() {
  const [sidebarCompact, setSidebarCompact] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [activeFolder, setActiveFolder] = useState('inbox');
  const [accounts, setAccounts] = useState([]);
  const [activeAccount, setActiveAccount] = useState(null);
  const [threads, setThreads] = useState([]);
  const [selectedThread, setSelectedThread] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [isDemo, setIsDemo] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeContext, setComposeContext] = useState(null);
  const [notice, setNotice] = useState('');
  const [privacy, setPrivacy] = useState({ privateImages: true });
  const [accessToken, setAccessToken] = useState(() => getAccessToken());
  const [accessOpen, setAccessOpen] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [addAccountOpen, setAddAccountOpen] = useState(false);

  const openNewCompose = () => {
    setComposeContext(null);
    setComposeOpen(true);
  };

  const closeCompose = () => {
    setComposeOpen(false);
    setComposeContext(null);
  };

  const openReplyComposer = (thread, message) => {
    const subject = /^re:/i.test(thread.subject || '') ? thread.subject : `Re: ${thread.subject || '(no subject)'}`;
    const sender = message.from?.name || message.from?.email || 'the sender';
    const original = String(message.body || '').trim();
    setComposeContext({
      mode: 'reply',
      to: message.from?.email || '',
      subject,
      body: original ? `\n\nOn ${formatMessageDate(message.timestamp)}, ${sender} wrote:\n${original}` : '',
      threadId: thread.threadId || thread.id,
      replyToMessageId: message.rfcMessageId || message.id,
    });
    setComposeOpen(true);
  };

  const openForwardComposer = (thread, message) => {
    const subject = /^fwd:/i.test(thread.subject || '') ? thread.subject : `Fwd: ${thread.subject || '(no subject)'}`;
    const sender = message.from?.name || message.from?.email || 'Unknown sender';
    const original = String(message.body || '').trim();
    setComposeContext({
      mode: 'forward',
      to: '',
      subject,
      body: `\n\n---------- Forwarded message ----------\nFrom: ${sender}\nDate: ${formatMessageDate(message.timestamp)}\nSubject: ${thread.subject || '(no subject)'}\n\n${original}`,
    });
    setComposeOpen(true);
  };

  const loadMailbox = useCallback(async ({ keepSelection = true } = {}) => {
    setLoading(true);
    try {
      let session = null;
      try {
        session = await api('/session');
      } catch (sessionError) {
        if (sessionError.status === 401 || sessionError.status === 403) throw sessionError;
      }
      if (session?.protected && !session.authenticated) {
        setAuthRequired(true);
        setAccessOpen(true);
        setIsDemo(false);
        setAccounts([]);
        setThreads([]);
        setSelectedThread(null);
        return;
      }
      const accountParam = activeAccount?.id ? `&accountId=${encodeURIComponent(activeAccount.id)}` : '';
      const [accountData, mailData] = await Promise.all([
        api('/accounts').catch(() => null),
        api(`/messages?folder=${encodeURIComponent(activeFolder)}${accountParam}`),
      ]);
      const nextAccounts = getArray(accountData, ['accounts', 'items']).map(normalizeAccount);
      const rawThreads = getArray(mailData, ['threads', 'messages', 'items', 'data']);
      const nextThreads = rawThreads.map(normalizeThread);
      const isFreshSetup = nextAccounts.length === 0 && nextThreads.length === 0;
      setAuthRequired(false);
      setAccounts(isFreshSetup ? [] : nextAccounts);
      // Null represents the unified inbox. Preserve an explicit per-account choice,
      // but start every newly loaded mailbox with all connected accounts visible.
      setActiveAccount((current) => nextAccounts.find((item) => item.id === current?.id) || null);
      setThreads(isFreshSetup ? demoThreads : nextThreads);
      setIsDemo(isFreshSetup);
      if (keepSelection && selectedThread) {
        const replacement = (isFreshSetup ? demoThreads : nextThreads).find((item) => item.id === selectedThread.id);
        setSelectedThread(replacement || null);
      } else {
        setSelectedThread(null);
      }
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        setAuthRequired(true);
        setAccessOpen(true);
        setIsDemo(false);
        setAccounts([]);
        setThreads([]);
        setSelectedThread(null);
      } else {
        // A temporary API outage still leaves a first-run installation easy to explore.
        setAccounts([]);
        setActiveAccount(null);
        setThreads(demoThreads);
        setIsDemo(true);
        if (!keepSelection) setSelectedThread(null);
      }
    } finally {
      setLoading(false);
    }
  }, [accessToken, activeAccount?.id, activeFolder, selectedThread]);

  useEffect(() => { loadMailbox({ keepSelection: false }); }, [activeFolder, activeAccount?.id, accessToken]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshMailbox = async () => {
    if (isDemo) {
      await loadMailbox({ keepSelection: false });
      return;
    }
    setLoading(true);
    setNotice(activeAccount ? `Syncing ${activeAccount.email}…` : 'Syncing all connected accounts…');
    try {
      // Sync is deliberately explicit: polling is off by default for an isolated self-hosted deployment.
      await api('/sync', { method: 'POST', body: JSON.stringify({ mailbox: 'INBOX' }) });
      setNotice('Mailbox sync complete.');
    } catch {
      setNotice('Sync could not complete. Showing the latest stored mail.');
    } finally {
      await loadMailbox({ keepSelection: true });
    }
  };

  useEffect(() => {
    const handleKeys = (event) => {
      if ((event.key === 'c' || event.key === 'C') && !event.metaKey && !event.ctrlKey && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        event.preventDefault();
        openNewCompose();
      }
      if (event.key === 'Escape') {
        closeCompose();
        setSettingsOpen(false);
        setProfileOpen(false);
        setMobileSidebarOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeys);
    return () => window.removeEventListener('keydown', handleKeys);
  }, []);

  const visibleThreads = useMemo(() => {
    const search = query.trim().toLowerCase();
    return threads.filter((thread) => {
      const inFolder = activeFolder === 'all' || thread.folder === activeFolder || (activeFolder === 'starred' && thread.starred) || (activeFolder === 'drafts' && thread.folder === 'drafts');
      if (!inFolder) return false;
      if (!search) return true;
      return [thread.subject, thread.snippet, thread.from?.name, thread.from?.email, ...(thread.labels || [])].join(' ').toLowerCase().includes(search);
    });
  }, [threads, activeFolder, query]);

  const counts = useMemo(() => ({
    inbox: threads.filter((thread) => thread.folder === 'inbox' && thread.unread).length,
    starred: threads.filter((thread) => thread.starred).length,
    drafts: threads.filter((thread) => thread.folder === 'drafts').length,
  }), [threads]);

  const openThread = async (thread) => {
    const alreadyRead = !thread.unread;
    const provisional = { ...thread, unread: false };
    setSelectedThread(provisional);
    setThreads((current) => current.map((item) => item.id === thread.id ? provisional : item));
    if (!alreadyRead && !isDemo) api(`/messages/${encodeURIComponent(thread.id)}/read`, { method: 'POST' }).catch(() => undefined);
    if (isDemo || thread.messages?.length > 1) return;
    try {
      const data = await api(`/threads/${encodeURIComponent(thread.threadId)}`);
      const raw = {
        ...(data?.thread || data || {}),
        messages: data?.messages || data?.thread?.messages || [],
      };
      const detailed = normalizeThread(raw);
      setSelectedThread(detailed);
      setThreads((current) => current.map((item) => item.id === detailed.id ? { ...item, ...detailed } : item));
    } catch {
      // The compact list payload remains a valid reader view.
    }
  };

  const toggleStar = (thread) => {
    const next = { ...thread, starred: !thread.starred };
    setThreads((current) => current.map((item) => item.id === thread.id ? next : item));
    setSelectedThread((current) => current?.id === thread.id ? next : current);
    if (!isDemo) api(`/messages/${encodeURIComponent(thread.id)}/star`, { method: 'POST', body: JSON.stringify({ starred: next.starred }) }).catch(() => setNotice('Could not update the star.'));
  };

  const applyAction = (action, targetIds = selectedIds) => {
    if (!targetIds.length && selectedThread) targetIds = [selectedThread.id];
    if (!targetIds.length) return;
    const affected = new Set(targetIds);
    if (action === 'unread') {
      setThreads((current) => current.map((item) => affected.has(item.id) ? { ...item, unread: true } : item));
      setSelectedThread((current) => current && affected.has(current.id) ? { ...current, unread: true } : current);
    } else if (action === 'read') {
      setThreads((current) => current.map((item) => affected.has(item.id) ? { ...item, unread: false } : item));
    } else if (['archive', 'trash', 'spam', 'snooze'].includes(action)) {
      setThreads((current) => current.filter((item) => !affected.has(item.id)));
      if (selectedThread && affected.has(selectedThread.id)) setSelectedThread(null);
    }
    setSelectedIds([]);
    const labels = { archive: 'Conversation archived', trash: 'Conversation moved to Trash', spam: 'Conversation reported as spam', snooze: 'Conversation snoozed', unread: 'Marked as unread', read: 'Marked as read', move: 'Move menu will be available with folders', label: 'Label menu will be available with labels' };
    setNotice(labels[action] || 'Updated');
    if (!isDemo && !['move', 'label'].includes(action)) {
      void Promise.all(targetIds.map((id) => api(`/messages/${encodeURIComponent(id)}/${action}`, { method: 'POST' })))
        .then((results) => {
          const outcomes = results.flatMap((result) => result?.messages || (result?.message ? [result.message] : []))
            .map((message) => message?.remoteSync)
            .filter(Boolean);
          const failed = outcomes.find((outcome) => outcome.status === 'failed');
          const unsynced = outcomes.find((outcome) => ['local-only', 'skipped'].includes(outcome.status));
          if (failed) setNotice(`${labels[action] || 'Updated'} locally; IMAP did not confirm the change.`);
          else if (unsynced) setNotice(`${labels[action] || 'Updated'} locally; the provider change was not available.`);
        })
        .catch(() => setNotice('The local view was updated; the server action failed.'));
    }
  };

  const loadRemoteContent = async (message) => {
    try {
      const response = !isDemo ? await api(`/messages/${encodeURIComponent(message.id)}/remote-content`, { method: 'POST' }) : null;
      const hydrated = response?.message || response;
      const update = (thread) => ({ ...thread, messages: thread.messages.map((item) => item.id === message.id ? { ...item, remoteContentLoaded: true, bodyHtml: hydrated?.htmlBody || item.bodyHtml } : item) });
      setThreads((current) => current.map(update));
      setSelectedThread((current) => update(current));
      setNotice('Remote content loaded through the privacy relay.');
    } catch {
      setNotice('Remote content could not be loaded privately.');
    }
  };

  const sendMessage = (payload, localOnly, senderAccount) => {
    const from = senderAccount || activeAccount || accounts[0] || demoAccounts[0];
    const sentThread = normalizeThread({
      id: `sent-${Date.now()}`,
      subject: payload.subject || '(no subject)',
      snippet: payload.textBody,
      from,
      timestamp: new Date().toISOString(),
      folder: 'sent',
      messages: [{ ...payload, id: `sent-message-${Date.now()}`, from, timestamp: new Date().toISOString() }],
    });
    setThreads((current) => [sentThread, ...current]);
    setNotice(localOnly ? 'Message saved in the local preview.' : 'Message sent');
  };

  const unlockServer = async (token) => {
    persistAccessToken(token);
    setAccessToken(token);
    if (!token) {
      setAuthRequired(false);
      setAccessOpen(false);
      return;
    }
    const session = await api('/session', { method: 'POST', body: JSON.stringify({ accessToken: token }) });
    if (session?.protected && !session.authenticated) throw new Error('That token did not unlock this server.');
    setAuthRequired(false);
    setAccessOpen(false);
    setNotice('GigaMail unlocked for this browser session.');
  };

  const saveAccountSignature = async (accountId, signature) => {
    const previous = accounts.find((item) => item.id === accountId);
    if (!previous) return;
    const optimistic = { ...previous, signature };
    setAccounts((current) => current.map((item) => item.id === accountId ? optimistic : item));
    setActiveAccount((current) => current?.id === accountId ? optimistic : current);
    try {
      const result = await api(`/accounts/${encodeURIComponent(accountId)}`, { method: 'PATCH', body: JSON.stringify({ signature }) });
      const saved = normalizeAccount(result?.account || result || optimistic);
      setAccounts((current) => current.map((item) => item.id === accountId ? saved : item));
      setActiveAccount((current) => current?.id === accountId ? saved : current);
      setNotice('Signature saved.');
    } catch {
      setAccounts((current) => current.map((item) => item.id === accountId ? previous : item));
      setActiveAccount((current) => current?.id === accountId ? previous : current);
      setNotice('Could not save the signature.');
    }
  };

  const accountAdded = (account) => {
    setAccounts((current) => [...current.filter((item) => item.id !== account.id), account]);
    setActiveAccount(null);
    setIsDemo(false);
    setNotice(`${account.email} connected. Syncing mail…`);
    void (async () => {
      try {
        await api(`/accounts/${encodeURIComponent(account.id)}/sync`, { method: 'POST', body: JSON.stringify({ mailbox: 'INBOX' }) });
        setNotice(`${account.email} synced.`);
      } catch {
        setNotice(`${account.email} is connected. Initial sync could not complete yet.`);
      } finally {
        await loadMailbox({ keepSelection: false });
      }
    })();
  };

  const hasConnectedAccounts = accounts.length > 0;
  const displayAccount = activeAccount || (hasConnectedAccounts ? UNIFIED_ACCOUNT : demoAccounts[0]);
  const identityAccounts = hasConnectedAccounts ? accounts : demoAccounts;
  const composeAccount = activeAccount || identityAccounts[0] || null;

  return (
    <div className={`mail-app ${sidebarCompact ? 'sidebar-compact' : ''} ${selectedThread ? 'thread-open' : ''}`}>
      <Topbar
        onToggleSidebar={() => window.innerWidth <= 840 ? setMobileSidebarOpen((value) => !value) : setSidebarCompact((value) => !value)}
        sidebarCompact={sidebarCompact}
        query={query}
        setQuery={setQuery}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenProfile={() => setProfileOpen(true)}
        account={displayAccount}
        isDemo={isDemo}
      />
      <Sidebar
        compact={sidebarCompact}
        mobileOpen={mobileSidebarOpen}
        onCloseMobile={() => setMobileSidebarOpen(false)}
        activeFolder={activeFolder}
        setActiveFolder={setActiveFolder}
        counts={counts}
        onCompose={() => { openNewCompose(); setMobileSidebarOpen(false); }}
        accounts={accounts}
        activeAccount={activeAccount}
        setActiveAccount={setActiveAccount}
        onSelectUnified={() => setActiveAccount(null)}
        onOpenSettings={() => setSettingsOpen(true)}
        isDemo={isDemo}
      />
      <main className="mail-workspace">
        {isDemo && <div className="demo-banner"><Icon name="shield" size={16} /><span>Preview mailbox — connect your first account to replace this sample data.</span><button type="button" onClick={() => setAddAccountOpen(true)}>Add account</button></div>}
        <div className="mail-split">
          <MailList
            threads={visibleThreads}
            selectedThread={selectedThread}
            loading={loading}
            folder={activeFolder}
            query={query}
            selectedIds={selectedIds}
            setSelectedIds={setSelectedIds}
            onOpenThread={openThread}
            onToggleStar={toggleStar}
            onRefresh={refreshMailbox}
            onBulkAction={applyAction}
            onCompose={openNewCompose}
          />
          {selectedThread ? <ThreadView key={selectedThread.id} thread={selectedThread} activeFolder={activeFolder} onBack={() => setSelectedThread(null)} onAction={applyAction} onLoadRemote={loadRemoteContent} onReply={openReplyComposer} onForward={openForwardComposer} allowPrivateImages={privacy.privateImages} /> : (
            <section className="reader-placeholder" aria-label="No conversation selected">
              <div className="reader-placeholder-mark"><span>G</span></div>
              <h2>Select a conversation</h2>
              <p>Choose a message to read it here.</p>
              <div className="privacy-summary"><Icon name="shield" size={18} /><span><strong>Privacy is on</strong> — known tracking pixels are blocked before they can report back.</span></div>
            </section>
          )}
        </div>
      </main>
      {composeOpen && <ComposeModal account={composeAccount} accounts={identityAccounts} initialReply={composeContext} onClose={closeCompose} onSent={sendMessage} />}
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} accounts={identityAccounts} activeAccount={activeAccount} setActiveAccount={setActiveAccount} privacy={privacy} setPrivacy={setPrivacy} onAddAccount={() => setAddAccountOpen(true)} onUnlock={() => setAccessOpen(true)} onSaveSignature={saveAccountSignature} showUnified={hasConnectedAccounts} />
      <ProfileMenu open={profileOpen} onClose={() => setProfileOpen(false)} account={displayAccount} accounts={identityAccounts} setActiveAccount={setActiveAccount} onSelectUnified={() => setActiveAccount(null)} onOpenSettings={() => setSettingsOpen(true)} showUnified={hasConnectedAccounts} />
      {addAccountOpen && <AddAccountModal onClose={() => setAddAccountOpen(false)} onAdded={accountAdded} />}
      <AccessPanel open={accessOpen} required={authRequired} currentToken={accessToken} onSave={unlockServer} onClose={() => setAccessOpen(false)} />
      <Toast notice={notice} onClose={() => setNotice('')} />
    </div>
  );
}
