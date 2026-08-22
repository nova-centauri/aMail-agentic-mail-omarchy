import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

const API_BASE = (import.meta.env.VITE_API_BASE || '/api').replace(/\/$/, '');
const ACCESS_TOKEN_KEY = 'gigamail-access-token';
const PREFS_KEY = 'gigamail-ui-prefs';
const EMPTY_FOLDER_COUNTS = { inbox: 0, starred: 0, snoozed: 0, drafts: 0 };

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

function readUiPrefs() {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeUiPrefs(partial) {
  try {
    const next = { ...readUiPrefs(), ...partial };
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    return next;
  } catch {
    return partial;
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

const SMART_CATEGORIES = [
  { id: 'all', label: 'All mail', shortLabel: 'All', icon: 'inbox', description: 'Everything across every connected account (routine ops digests stay hidden)' },
  { id: 'primary', label: 'Primary', shortLabel: 'Primary', icon: 'person', description: 'People, conversations, and mail that needs attention' },
  { id: 'github_ci', label: 'GitHub CI', shortLabel: 'GitHub CI', icon: 'branch', description: 'Pull requests, checks, builds, and workflow runs' },
  { id: 'logs', label: 'Logs', shortLabel: 'Logs', icon: 'terminal', description: 'Automated logs, digests, and machine output' },
  { id: 'status', label: 'Status updates', shortLabel: 'Status', icon: 'activity', description: 'Incidents, uptime, deploys, and service health' },
  { id: 'ops_error', label: 'Ops errors', shortLabel: 'Ops errors', icon: 'alert', description: 'Failures from Workboard, Proxmox, Watchtower, and xer0/msl backups. Successful digests stay hidden.' },
];

const PERSON_FLAGS = [
  { id: 'phil', label: 'Phil', shortLabel: 'Phil', emails: ['phil@midstatelitho.com', 'phil@midstaelitho.com'], color: '#0b57d0', description: 'Mail involving Phil at Midstate Litho' },
  { id: 'sarah', label: 'Sarah', shortLabel: 'Sarah', emails: ['sarah@midstatelitho.com'], color: '#c2185b', description: 'Mail involving Sarah at Midstate Litho' },
  { id: 'mark', label: 'Mark Culley', shortLabel: 'Mark', emails: ['mark_culley@sdmc.com'], color: '#00897b', description: 'Mail involving Mark Culley' },
  { id: 'support', label: 'Midstate Support', shortLabel: 'Support', emails: ['support@midstatelitho.com', 'support@midstaetlitho.com'], color: '#e8710a', description: 'Mail involving Midstate Litho support' },
  { id: 'sales', label: 'Midstate Sales', shortLabel: 'Sales', emails: ['sales@midstatelitho.com'], color: '#6c4fc7', description: 'Mail involving Midstate Litho sales' },
];

const CATEGORY_ALIASES = {
  all: 'all',
  primary: 'primary',
  focused: 'primary',
  people: 'primary',
  github: 'github_ci',
  'github-ci': 'github_ci',
  github_ci: 'github_ci',
  ci: 'github_ci',
  builds: 'github_ci',
  log: 'logs',
  logs: 'logs',
  automated: 'logs',
  status: 'status',
  'status-update': 'status',
  status_updates: 'status',
  incidents: 'status',
  ops: 'ops_error',
  ops_error: 'ops_error',
  'ops-error': 'ops_error',
  ops_errors: 'ops_error',
  workboard: 'ops_error',
  proxmox: 'ops_error',
  watchtower: 'ops_error',
};

const PROVIDER_PRESETS = {
  gmail: {
    id: 'gmail',
    label: 'Gmail',
    caption: 'Gmail or Google Workspace',
    mark: 'G',
    color: '#1a73e8',
    provider: 'gmail',
    imapHost: 'imap.gmail.com',
    imapPort: '993',
    smtpHost: 'smtp.gmail.com',
    smtpPort: '465',
    title: 'Connect Gmail securely',
    passwordTitle: 'Use a Google app password',
    passwordHint: 'Turn on 2-Step Verification, create a 16-digit app password, then paste it here. Your regular Google password will not work.',
    helpLabel: 'Google app-password help',
    helpUrl: 'https://support.google.com/accounts/answer/185833?hl=en',
  },
  icloud: {
    id: 'icloud',
    label: 'iCloud Mail',
    caption: 'Apple Account mail',
    mark: '☁',
    color: '#2589f5',
    provider: 'icloud',
    imapHost: 'imap.mail.me.com',
    imapPort: '993',
    smtpHost: 'smtp.mail.me.com',
    smtpPort: '587',
    title: 'Connect iCloud Mail',
    passwordTitle: 'Create an app-specific password',
    passwordHint: 'Your Apple Account needs two-factor authentication. Generate an app-specific password under Sign-In and Security, then paste it here.',
    helpLabel: 'Apple app-specific password help',
    helpUrl: 'https://support.apple.com/en-us/102654',
  },
  mailinabox: {
    id: 'mailinabox',
    label: 'Mail-in-a-Box',
    caption: 'Self-hosted mail server',
    mark: 'M',
    color: '#6c4fc7',
    provider: 'mailinabox',
    imapHost: 'box.xer5.com',
    imapPort: '993',
    smtpHost: 'box.xer5.com',
    smtpPort: '587',
    title: 'Connect Mail-in-a-Box',
    passwordTitle: 'Use the mailbox password',
    passwordHint: 'Use the full mailbox address and its Mail-in-a-Box mailbox password. GigaMail connects to box.xer5.com with IMAP TLS and SMTP STARTTLS.',
  },
  outlook: {
    id: 'outlook',
    label: 'Outlook',
    caption: 'Microsoft 365 or Outlook.com',
    mark: 'O',
    color: '#0078d4',
    provider: 'outlook',
    imapHost: 'outlook.office365.com',
    imapPort: '993',
    smtpHost: 'smtp.office365.com',
    smtpPort: '587',
    title: 'Connect Outlook',
    passwordTitle: 'Use an app password if your account supports one',
    passwordHint: 'Microsoft may require OAuth or an organization-approved app password. Basic mailbox passwords are often blocked by tenant policy.',
  },
  custom: {
    id: 'custom',
    label: 'Other IMAP',
    caption: 'Any IMAP + SMTP provider',
    mark: '@',
    color: '#4f636f',
    provider: 'custom',
    imapHost: '',
    imapPort: '993',
    smtpHost: '',
    smtpPort: '465',
    title: 'Connect another provider',
    passwordTitle: 'Use a provider app password when available',
    passwordHint: 'Enter the encrypted IMAP and SMTP settings from your provider. A dedicated app password is safer than your primary sign-in password.',
  },
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
    id: 'github-ci',
    threadId: 'github-ci',
    subject: '[GigaMail] CI failed on main (#842)',
    snippet: 'The test job failed after 2m 18s in message-html.test.js. View the workflow run for annotations.',
    from: { name: 'GitHub Actions', email: 'notifications@github.com', color: '#24292f' },
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2.6).toISOString(),
    unread: true,
    starred: false,
    labels: ['GitHub', 'CI'],
    folder: 'inbox',
    messageCount: 1,
    category: 'github_ci',
    categoryLabel: 'GitHub CI',
    categoryReason: 'Matched a GitHub Actions workflow notification.',
    messages: [
      {
        id: 'github-ci-1',
        from: { name: 'GitHub Actions', email: 'notifications@github.com', color: '#24292f' },
        to: ['Nova Centauri'],
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2.6).toISOString(),
        body: 'Workflow: CI\nBranch: main\nCommit: 5ab1c72\n\nThe test job failed after 2m 18s in message-html.test.js. View the workflow run for annotations.',
      },
    ],
  },
  {
    id: 'service-status',
    threadId: 'service-status',
    subject: 'Resolved: Elevated API latency',
    snippet: 'All systems have recovered. We will publish a full incident review within two business days.',
    from: { name: 'Centauri Status', email: 'status@centauri.dev', color: '#188038' },
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 3.2).toISOString(),
    unread: false,
    starred: false,
    labels: ['Status'],
    folder: 'inbox',
    messageCount: 3,
    category: 'status',
    categoryLabel: 'Status update',
    categoryReason: 'Recognized a resolved service incident update.',
    messages: [
      {
        id: 'service-status-1',
        from: { name: 'Centauri Status', email: 'status@centauri.dev', color: '#188038' },
        to: ['Nova Centauri'],
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 3.2).toISOString(),
        body: 'All systems have recovered. We will publish a full incident review within two business days.',
      },
    ],
  },
  {
    id: 'backup-log',
    threadId: 'backup-log',
    subject: 'Nightly backup completed with 3 warnings',
    snippet: 'Backup completed in 18m 42s. Three stale cache files were skipped and no mailbox data was lost.',
    from: { name: 'Mail Server Logs', email: 'logs@mail.centauri.dev', color: '#5f6368' },
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 3.7).toISOString(),
    unread: false,
    starred: false,
    labels: ['Logs'],
    folder: 'inbox',
    messageCount: 1,
    category: 'logs',
    categoryLabel: 'Log digest',
    categoryReason: 'Matched automated server log and backup language.',
    messages: [
      {
        id: 'backup-log-1',
        from: { name: 'Mail Server Logs', email: 'logs@mail.centauri.dev', color: '#5f6368' },
        to: ['Nova Centauri'],
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 3.7).toISOString(),
        body: 'Backup completed in 18m 42s.\n\nWarnings: 3 stale cache files skipped.\nMailbox data lost: 0\nArchive verified: yes',
      },
    ],
  },
  {
    id: 'watchtower-ok',
    threadId: 'watchtower-ok',
    subject: 'Watchtower: all containers up to date',
    snippet: 'No container updates were required. This daily digest stays out of All mail unless something fails.',
    from: { name: 'Watchtower', email: 'watchtower@home.lab', color: '#455a64' },
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
    unread: true,
    starred: false,
    labels: ['Ops'],
    folder: 'inbox',
    messageCount: 1,
    category: 'ops_quiet',
    categoryLabel: 'Ops digests',
    categoryReason: 'Routine watchtower digest with no error signal.',
    messages: [
      {
        id: 'watchtower-ok-1',
        from: { name: 'Watchtower', email: 'watchtower@home.lab', color: '#455a64' },
        to: ['Nova Centauri'],
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
        body: 'All containers are up to date. No action needed.',
      },
    ],
  },
  {
    id: 'proxmox-fail',
    threadId: 'proxmox-fail',
    subject: 'Proxmox backup failed on pve-1',
    snippet: 'vzdump finished with errors on VM 105. Review the task log before the next nightly run.',
    from: { name: 'Proxmox', email: 'root@proxmox.local', color: '#e53935' },
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 1.5).toISOString(),
    unread: true,
    starred: false,
    labels: ['Ops'],
    folder: 'inbox',
    messageCount: 1,
    category: 'ops_error',
    categoryLabel: 'Ops errors',
    categoryReason: 'Ops error from proxmox.',
    messages: [
      {
        id: 'proxmox-fail-1',
        from: { name: 'Proxmox', email: 'root@proxmox.local', color: '#e53935' },
        to: ['Nova Centauri'],
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 1.5).toISOString(),
        body: 'TASK ERROR: vzdump failed for VM 105. Exit code 1.',
      },
    ],
  },
  {
    id: 'phil-note',
    threadId: 'phil-note',
    subject: 'Press schedule for Thursday',
    snippet: 'Can you confirm the afternoon press window for the Midstate run?',
    from: { name: 'Phil', email: 'phil@midstaelitho.com', color: '#0b57d0' },
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(),
    unread: true,
    starred: false,
    labels: [],
    folder: 'inbox',
    messageCount: 1,
    category: 'primary',
    messages: [
      {
        id: 'phil-note-1',
        from: { name: 'Phil', email: 'phil@midstaelitho.com', color: '#0b57d0' },
        to: ['Nova Centauri'],
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(),
        body: 'Can you confirm the afternoon press window for the Midstate run?',
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

function canonicalCategory(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
  return CATEGORY_ALIASES[normalized] || CATEGORY_ALIASES[normalized.replace(/_/g, '-')] || null;
}

function inferSmartCategory(raw = {}) {
  const labels = Array.isArray(raw.labels) ? raw.labels : Array.isArray(raw.tags) ? raw.tags : [];
  const from = normalizePerson(raw.from || raw.sender || raw.fromAddress);
  const haystack = [raw.subject, raw.snippet, raw.preview, from.name, from.email, ...labels].filter(Boolean).join(' ').toLowerCase();
  const isOpsSource = /\b(?:workboard|proxmox|\bpve\b|watchtower|xer0|msl)\b/i.test(haystack)
    || (/\bbackup\b/i.test(haystack) && /\b(?:xer0|msl)\b/i.test(haystack));
  const isOpsError = /\b(?:error|errors|failed|failure|fatal|critical|exception|unreachable|timeout|timed out)\b/i.test(haystack)
    && !/\b(?:0|no|without|zero)\s+errors?\b/i.test(haystack);
  if (isOpsSource) {
    return isOpsError
      ? { category: 'ops_error', reason: 'Matched a Workboard, Proxmox, Watchtower, or xer0/msl backup failure.' }
      : { category: 'ops_quiet', reason: 'Routine ops digest with no error signal (hidden from All mail).' };
  }
  if (/(github|github actions|actions@github|workflow|pull request|check run|build #|ci failed|ci passed)/i.test(haystack)) {
    return { category: 'github_ci', reason: 'Matched GitHub, workflow, pull-request, or CI language.' };
  }
  if (/(status@|status page|incident|degraded|outage|uptime|service health|all systems|resolved:|investigating|monitoring:)/i.test(haystack)) {
    return { category: 'status', reason: 'Matched service-health or incident-update language.' };
  }
  if (/(logs?@|server logs?|cron|nightly backup|backup completed|telemetry|automated digest|job output|stack trace|exception report)/i.test(haystack)) {
    return { category: 'logs', reason: 'Matched automated log, backup, telemetry, or job-output language.' };
  }
  return { category: 'primary', reason: 'Kept in Primary because it looks like regular correspondence.' };
}

function smartCategoryMetadata(raw = {}, fallback = {}) {
  const inferred = inferSmartCategory({ ...fallback, ...raw });
  const category = canonicalCategory(raw.category || raw.smartCategory || raw.categoryId || fallback.category) || inferred.category;
  const definition = SMART_CATEGORIES.find((item) => item.id === category)
    || (category === 'ops_quiet' ? { id: 'ops_quiet', label: 'Ops digests' } : null)
    || SMART_CATEGORIES[1];
  return {
    category: definition.id,
    categoryLabel: raw.categoryLabel || raw.category_label || fallback.categoryLabel || definition.label,
    categoryReason: raw.categoryReason || raw.category_reason || fallback.categoryReason || inferred.reason,
  };
}

function normalizePersonFlagEmail(value = '') {
  const match = String(value).trim().toLowerCase().match(/<([^>]+)>/);
  const email = (match?.[1] || String(value)).trim().toLowerCase();
  return email
    .replace(/@midstaelitho\.com$/, '@midstatelitho.com')
    .replace(/@midstaetlitho\.com$/, '@midstatelitho.com');
}

function conversationMatchesPersonFlag(thread, flagId) {
  const flag = PERSON_FLAGS.find((item) => item.id === flagId);
  if (!flag) return false;
  const wanted = new Set(flag.emails.map(normalizePersonFlagEmail));
  const people = [
    thread.from,
    ...(thread.participants || []),
    ...recipientArray(thread.to),
    ...recipientArray(thread.cc),
    ...recipientArray(thread.replyTo),
    ...(thread.messages || []).flatMap((message) => [
      message.from,
      ...recipientArray(message.to),
      ...recipientArray(message.cc),
      ...recipientArray(message.replyTo),
    ]),
  ];
  return people.some((person) => {
    const email = normalizePersonFlagEmail(person?.email || person?.address || person || '');
    return email && wanted.has(email);
  });
}

function countSmartCategories(threads = []) {
  const counts = Object.fromEntries(SMART_CATEGORIES.filter((item) => item.id !== 'all').map((item) => [item.id, 0]));
  threads.forEach((thread) => {
    const category = smartCategoryMetadata(thread).category;
    if (Object.hasOwn(counts, category)) counts[category] += 1;
  });
  return counts;
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

function recipientArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.value)) return value.value;
  return value ? [value] : [];
}

function formatRecipients(value) {
  const recipients = recipientArray(value);
  return recipients.map((recipient) => {
    const person = normalizePerson(recipient);
    if (person.name && person.email && person.name !== person.email) return `${person.name} <${person.email}>`;
    return person.email || person.name;
  }).filter(Boolean).join(', ');
}

function normalizeMessage(raw, index = 0) {
  const from = normalizePerson(raw.from || raw.sender || raw.fromAddress, { color: raw.color });
  const classification = smartCategoryMetadata(raw, { from });
  return {
    id: String(raw.latestMessageId || raw.id || raw.messageId || `message-${index}`),
    accountId: (raw.accountId || raw.account_id) ? String(raw.accountId || raw.account_id) : null,
    rfcMessageId: raw.messageId || raw.rfcMessageId || null,
    from,
    to: raw.to || raw.recipients || raw.toAddresses || [],
    cc: raw.cc || [],
    bcc: raw.bcc || [],
    replyTo: raw.replyTo || raw.reply_to || [],
    isSent: Boolean(raw.isSent ?? raw.is_sent),
    timestamp: raw.timestamp || raw.date || raw.sentAt || raw.receivedAt || new Date().toISOString(),
    body: raw.textBody || raw.bodyText || raw.text || raw.body || raw.snippet || '',
    bodyHtml: raw.htmlBody || raw.bodyHtml || raw.html || '',
    attachments: (raw.attachments || []).map((attachment) => ({
      ...attachment,
      name: attachment.name || attachment.filename || 'Attachment',
    })),
    remoteContentBlocked: Boolean(raw.remoteContentBlocked || raw.trackerBlocked || raw.hasRemoteContent || raw.remoteImageCount > 0),
    remoteContentLoaded: Boolean(raw.remoteContentLoaded),
    ...classification,
  };
}

function inferFolder(raw = {}) {
  if (raw.folder) return String(raw.folder).toLowerCase();
  if (raw.isDraft || raw.draftId || raw.draft_id) return 'drafts';
  if (raw.isSent) return 'sent';
  if (raw.isTrashed) return 'trash';
  if (raw.isSpam) return 'spam';
  const snoozedUntil = raw.snoozedUntil || raw.snoozed_until;
  if (snoozedUntil) {
    const until = new Date(snoozedUntil);
    if (!Number.isNaN(until.valueOf()) && until > new Date()) return 'snoozed';
  }
  if (raw.isArchived) return 'archive';
  const mailbox = String(raw.mailbox || 'inbox').toLowerCase();
  if (/sent/.test(mailbox)) return 'sent';
  if (/(trash|deleted)/.test(mailbox)) return 'trash';
  if (/draft/.test(mailbox)) return 'drafts';
  if (/(spam|junk)/.test(mailbox)) return 'spam';
  if (/(archive|all mail)/.test(mailbox)) return 'archive';
  return 'inbox';
}

function formatAttachmentSize(size) {
  if (size == null || size === '') return '';
  if (typeof size === 'string' && /[a-z]/i.test(size)) return size;
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes < 0) return String(size);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function normalizeThread(raw, index = 0) {
  const messages = getArray(raw, ['messages', 'items']).map(normalizeMessage);
  const latest = messages.at(-1) || normalizeMessage(raw, index);
  const from = normalizePerson(raw.from || raw.sender || latest.from, latest.from);
  const classification = smartCategoryMetadata(raw, latest);
  return {
    id: String(raw.id || raw.threadId || raw.conversationId || `thread-${index}`),
    draftId: raw.draftId || raw.draft_id || null,
    accountId: (raw.accountId || raw.account_id || latest.accountId) ? String(raw.accountId || raw.account_id || latest.accountId) : null,
    threadId: String(raw.threadId || raw.id || raw.conversationId || `thread-${index}`),
    subject: raw.subject || latest.subject || '(no subject)',
    snippet: raw.snippet || raw.preview || latest.body.replace(/\s+/g, ' ').slice(0, 170),
    from,
    to: raw.to || latest.to || [],
    cc: raw.cc || latest.cc || [],
    bcc: raw.bcc || latest.bcc || [],
    replyTo: raw.replyTo || latest.replyTo || [],
    isSent: Boolean(raw.isSent ?? latest.isSent),
    participants: raw.participants || raw.people || [],
    timestamp: raw.timestamp || raw.latestAt || raw.updatedAt || raw.sentAt || raw.receivedAt || raw.date || latest.timestamp,
    unread: Boolean(raw.unread ?? raw.isUnread ?? (raw.unreadCount !== undefined ? Number(raw.unreadCount) > 0 : raw.isRead === false)),
    starred: Boolean(raw.starred ?? raw.isStarred),
    labels: raw.labels || raw.tags || [],
    folder: inferFolder(raw),
    messageCount: raw.messageCount || raw.count || messages.length || 1,
    hasAttachments: Boolean(raw.hasAttachments || raw.attachments?.length || messages.some((message) => message.attachments.length)),
    // Keep the compact list message available immediately so a fast Reply has
    // the correct account and RFC Message-ID while full thread detail loads.
    messages: messages.length ? messages : [latest],
    ...classification,
  };
}

const demoMailboxThreads = demoThreads.map(normalizeThread);

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
    provider: raw.provider || 'custom',
    status: raw.status || (raw.connected === false ? 'error' : 'connected'),
    lastSyncedAt: raw.lastSyncedAt || raw.last_synced_at || null,
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
    const contentType = response.headers.get('content-type') || '';
    let detail = null;
    try {
      detail = contentType.includes('application/json') ? await response.json() : await response.text();
    } catch {
      detail = null;
    }
    const errorBody = detail && typeof detail === 'object' ? (detail.error || detail) : null;
    const message = typeof errorBody?.message === 'string'
      ? errorBody.message
      : typeof detail === 'string' && detail.trim()
        ? detail.trim()
        : `Request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    error.code = errorBody?.code || detail?.code || null;
    error.details = errorBody?.details || detail?.details || null;
    throw error;
  }
  if (response.status === 204) return null;
  const contentType = response.headers.get('content-type') || '';
  return contentType.includes('application/json') ? response.json() : response.text();
}

function syncResultStatus(payload) {
  const source = payload?.result ?? payload?.results ?? payload;
  const results = Array.isArray(source) ? source : source ? [source] : [];
  if (!results.length) return 'ok';
  if (results.every((result) => result?.skipped)) return 'skipped';
  if (results.some((result) => result?.skipped)) return 'partial';
  const statuses = results.map((result) => result?.status).filter(Boolean);
  if (statuses.length && statuses.every((status) => status === 'failed')) return 'failed';
  if (statuses.some((status) => status === 'failed' || status === 'partial')) return 'partial';
  return 'ok';
}

function syncSkippedMessageCount(payload) {
  const source = payload?.result ?? payload?.results ?? payload;
  const results = Array.isArray(source) ? source : source ? [source] : [];
  return results.reduce((sum, result) => sum + (typeof result?.skipped === 'number' ? Math.max(0, result.skipped) : 0), 0);
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
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>,
    logout: <><path d="M15 8V6.2A2.2 2.2 0 0 0 12.8 4H6.2A2.2 2.2 0 0 0 4 6.2v11.6A2.2 2.2 0 0 0 6.2 20h6.6A2.2 2.2 0 0 0 15 17.8V16" /><path d="M10 12h10" /><path d="m16 8 4 4-4 4" /></>,
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
    person: <><circle cx="12" cy="8" r="3.5" /><path d="M5.5 20c.5-4 2.7-6 6.5-6s6 2 6.5 6" /></>,
    branch: <><circle cx="7" cy="5" r="2" /><circle cx="17" cy="7" r="2" /><circle cx="7" cy="19" r="2" /><path d="M7 7v10M9 12h2c3.3 0 6-1.3 6-3" /></>,
    terminal: <><rect x="3" y="4.5" width="18" height="15" rx="2" /><path d="m7 9 3 3-3 3M13 15h4" /></>,
    activity: <><path d="M3 12h4l2.1-6 4.2 12 2.2-6H21" /></>,
    alert: <><path d="M12 4 3 19h18z" /><path d="M12 10v4M12 16.5v.5" /></>,
    sparkles: <><path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2zM6.5 14l.8 2.2 2.2.8-2.2.8L6.5 20l-.8-2.2-2.2-.8 2.2-.8zM18.5 13l.6 1.6 1.6.6-1.6.6-.6 1.7-.6-1.7-1.6-.6 1.6-.6z" /></>,
    lock: <><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v2.5" /></>,
    eye: <><path d="M2.5 12c1.3-2.8 4.8-6 9.5-6s8.2 3.2 9.5 6c-1.3 2.8-4.8 6-9.5 6S3.8 14.8 2.5 12Z" /><circle cx="12" cy="12" r="3" /></>,
  };
  return (
    <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name] || paths.more}
    </svg>
  );
}

function BrandMark({ size = 32, className = '' }) {
  const uid = useId().replace(/:/g, '');
  return (
    <svg className={`brand-mark ${className}`.trim()} width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id={`${uid}-bg`} x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#1d4f86" />
          <stop offset="1" stopColor="#0b1f3a" />
        </linearGradient>
        <linearGradient id={`${uid}-mail`} x1="8" y1="9" x2="24" y2="23" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7dd3fc" />
          <stop offset="1" stopColor="#2dd4bf" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill={`url(#${uid}-bg)`} />
      <rect x="6.4" y="9.3" width="19.2" height="13.4" rx="2.2" fill="none" stroke={`url(#${uid}-mail)`} strokeWidth="1.85" />
      <path d="M7.6 10.7 16 16.6l8.4-5.9" fill="none" stroke={`url(#${uid}-mail)`} strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="24.1" cy="9.1" r="2.45" fill="#5eead4" />
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
  useEffect(() => { setImageFailed(false); }, [image]);
  const style = source.color ? { '--avatar-color': source.color } : undefined;
  return (
    <div className={`avatar avatar-${size} ${className}`} style={style} role="img" aria-label={source.name || source.email || 'Profile'}>
      {source.isUnified ? (
        <Icon name="inbox" size={size === 'hero' ? 32 : size === 'top' ? 17 : 18} />
      ) : image && !imageFailed ? (
        <img src={image} alt="" onError={() => setImageFailed(true)} />
      ) : (
        initials(source.name || source.email)
      )}
    </div>
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

function Topbar({ onToggleSidebar, onGoHome, query, setQuery, onOpenSettings, onLogout, onOpenProfile, onFocusSmartFilters, account, isDemo }) {
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

function Sidebar({ compact, mobileOpen, onCloseMobile, activeFolder, setActiveFolder, counts, onCompose, accounts, activeAccount, setActiveAccount, onSelectUnified, onOpenSettings, isDemo, onAddAccount, activePersonFlag, onSelectPersonFlag }) {
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

function ListToolbar({ visibleCount, totalCount, selectedCount, onRefresh, onBulkAction, allSelected, onToggleAll, loading }) {
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

function SmartFilterBar({ activeCategory, onChange, visibleCount, categoryCounts, loading }) {
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

function CategoryBadge({ thread, showPrimary = false }) {
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

function ThreadRow({ thread, selected, isChecked, onOpen, onCheck, onToggleStar }) {
  const sender = thread.from?.name || thread.from?.email || 'Unknown sender';
  return (
    <article
      className={`thread-row ${thread.unread ? 'is-unread' : ''} ${selected ? 'is-selected' : ''}`}
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
    ? 'Try a sender, subject, or a different search term.'
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

function ReaderPlaceholder({ isDemo, onAddAccount }) {
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

function MailList({ threads, totalCount, categoryCounts, selectedThread, loading, folder, query, activeCategory, setActiveCategory, selectedIds, setSelectedIds, onOpenThread, onToggleStar, onRefresh, onBulkAction, onCompose, onClearSearch, hideSmartFilters = false }) {
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
        <IconButton label="Snooze until tomorrow" onClick={() => onAction('snooze')}><Icon name="snooze" /></IconButton>
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
            return (
              <span className="attachment-chip" key={attachment.id || attachment.name || index} title={attachment.name || 'Attachment'}>
                <Icon name="attachment" size={17} />
                <span>{attachment.name || 'Attachment'}</span>
                {sizeLabel && <small>{sizeLabel}</small>}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MessageCard({ message, expanded, onToggle, onLoadRemote, onReply, onReplyAll, onForward, allowPrivateImages }) {
  const from = message.from || {};
  const recipientList = formatRecipients(message.to);
  const canReplyAll = [...recipientArray(message.to), ...recipientArray(message.cc)].length > 1;
  return (
    <article className={`message-card email-light ${expanded ? 'is-expanded' : ''}`}>
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

function ThreadView({ thread, activeFolder, onBack, onAction, onLoadRemote, onReply, onReplyAll, onForward, allowPrivateImages }) {
  const sourceMessages = thread.messages?.length ? thread.messages : [normalizeMessage(thread)];
  const classification = smartCategoryMetadata(thread);
  const [expandedIds, setExpandedIds] = useState(() => new Set([sourceMessages.at(-1)?.id]));
  useEffect(() => setExpandedIds(new Set([sourceMessages.at(-1)?.id])), [thread.id]);
  const toggleExpanded = (id) => setExpandedIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  return (
    <section className="thread-panel" aria-label="Open conversation">
      <ThreadToolbar onBack={onBack} onAction={(action) => onAction(action, [thread.id])} isRead={!thread.unread} />
      <div className="thread-scroll">
        <div className="thread-heading">
          <div className="thread-heading-main">
            <div className="thread-title-line">
              <h1>{thread.subject || '(no subject)'}</h1>
              <div className="heading-labels">
                <CategoryBadge thread={thread} showPrimary />
                {(thread.labels || []).map((label) => <span key={label} className="message-label">{label}</span>)}
                {activeFolder !== 'inbox' && <span className="message-label neutral-label">{activeFolder}</span>}
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
              allowPrivateImages={allowPrivateImages}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function ComposeModal({ account, accounts, isDemo, onClose, onSent, onDraftSaved, onDraftRemoved, initialReply, onNotice }) {
  const [form, setForm] = useState({
    to: initialReply?.to || '',
    cc: initialReply?.cc || '',
    bcc: initialReply?.bcc || '',
    subject: initialReply?.subject || '',
    body: initialReply?.body || '',
  });
  const [extraFields, setExtraFields] = useState(Boolean(initialReply?.cc || initialReply?.bcc));
  const [isMinimized, setIsMinimized] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [draftId, setDraftId] = useState(initialReply?.draftId || '');
  const [error, setError] = useState('');
  const [senderId, setSenderId] = useState(initialReply?.accountId || account?.id || accounts[0]?.id || '');
  const formRef = useRef(form);
  const draftIdRef = useRef(draftId);
  formRef.current = form;
  draftIdRef.current = draftId;
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  useEffect(() => {
    setSenderId((current) => accounts.some((item) => item.id === current) ? current : initialReply?.accountId || account?.id || accounts[0]?.id || '');
  }, [account?.id, accounts, initialReply?.accountId]);
  const senderAccount = accounts.find((item) => item.id === senderId) || account || accounts[0] || null;
  const addressValues = (value) => value.split(',').map((item) => item.trim()).filter(Boolean);
  const hasUnsavedContent = () => {
    const current = formRef.current;
    return Boolean(current.to.trim() || current.cc.trim() || current.bcc.trim() || current.subject.trim() || current.body.trim() || draftIdRef.current);
  };
  const draftPayload = () => ({
    accountId: senderAccount?.id,
    threadId: initialReply?.threadId || null,
    to: addressValues(form.to),
    cc: addressValues(form.cc),
    bcc: addressValues(form.bcc),
    subject: form.subject,
    textBody: form.body,
    htmlBody: plainTextToHtml(form.body),
  });
  const saveDraft = async ({ closeAfter = true } = {}) => {
    if (isSending || isSavingDraft) return false;
    if (!hasUnsavedContent()) {
      if (closeAfter) onClose();
      return true;
    }
    if (!senderAccount?.id) {
      setError('Connect an account before saving this draft.');
      return false;
    }
    setError('');
    setIsSavingDraft(true);
    const payload = draftPayload();
    try {
      if (isDemo) {
        const localId = draftId || `preview-${Date.now()}`;
        const draft = { id: localId, ...payload, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        setDraftId(localId);
        onDraftSaved(draft, senderAccount, true);
      } else {
        const result = await api(draftId ? `/drafts/${encodeURIComponent(draftId)}` : '/drafts', { method: draftId ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
        const draft = result?.draft || result;
        setDraftId(draft?.id || draftId);
        onDraftSaved(draft, senderAccount, false);
      }
      if (closeAfter) onClose();
      return true;
    } catch (requestError) {
      setError(requestError.status === 401 || requestError.status === 403 ? 'Unlock GigaMail before saving this draft.' : `Draft could not be saved. ${requestError.message || 'Check the server connection and try again.'}`);
      return false;
    } finally {
      setIsSavingDraft(false);
    }
  };
  const discardDraft = async () => {
    if (isSending || isSavingDraft) return;
    if (!draftId) { onClose(); return; }
    setIsSavingDraft(true);
    setError('');
    try {
      if (!isDemo) await api(`/drafts/${encodeURIComponent(draftId)}`, { method: 'DELETE' });
      onDraftRemoved(draftId);
      onClose();
    } catch (requestError) {
      setError(`The saved draft could not be discarded. ${requestError.message || 'Try again when the server is available.'}`);
    } finally {
      setIsSavingDraft(false);
    }
  };
  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (isExpanded) {
        setIsExpanded(false);
        return;
      }
      if (isMinimized) {
        onClose();
        return;
      }
      void saveDraft({ closeAfter: true });
    };
    window.addEventListener('keydown', handleEscape, true);
    return () => window.removeEventListener('keydown', handleEscape, true);
  });
  const send = async (event) => {
    event.preventDefault();
    if (!form.to.trim()) { setError('Add at least one recipient.'); return; }
    if (!senderAccount?.id && !isDemo) { setError('Connect an account before sending.'); return; }
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
      if (isDemo) {
        if (draftId) onDraftRemoved(draftId);
        onSent(payload, true, senderAccount, null);
        onClose();
        return;
      }
      const result = await api('/messages', { method: 'POST', body: JSON.stringify(payload) });
      if (draftId) {
        void api(`/drafts/${encodeURIComponent(draftId)}`, { method: 'DELETE' }).then(() => onDraftRemoved(draftId)).catch(() => undefined);
      }
      onSent(payload, false, senderAccount, result);
      onClose();
    } catch (requestError) {
      const rejectedDelivery = requestError.details?.delivery;
      const rejectedCount = Number(rejectedDelivery?.recipientCount) || 0;
      setError(requestError.status === 401 || requestError.status === 403
        ? 'Unlock GigaMail before sending. Your message is still open.'
        : rejectedDelivery?.status === 'rejected'
          ? `The provider rejected ${rejectedCount ? `all ${rejectedCount} recipients` : 'all recipients'}. Check the addresses and try again; your message is still open.`
          : 'Could not send this message. Check the connection and try again, or save it as a draft.');
    } finally {
      setIsSending(false);
    }
  };
  const unavailable = (feature) => () => onNotice?.(`${feature} is not available yet in GigaMail.`);
  return (
    <div className={`compose-window ${isMinimized ? 'is-minimized' : ''} ${isExpanded ? 'is-expanded' : ''}`} role="dialog" aria-modal="true" aria-label="New message">
      <div className="compose-titlebar">
        <span>{draftId ? 'Draft' : initialReply?.mode === 'reply' || initialReply?.mode === 'reply-all' ? 'Reply' : initialReply?.mode === 'forward' ? 'Forward' : 'New Message'}</span>
        <div>
          <IconButton label={isMinimized ? 'Restore' : 'Minimize'} onClick={() => { setIsMinimized((value) => !value); if (!isMinimized) setIsExpanded(false); }}><Icon name="minimize" size={17} /></IconButton>
          <IconButton label={isExpanded ? 'Exit full screen' : 'Full screen'} onClick={() => { setIsExpanded((value) => !value); setIsMinimized(false); }}><Icon name="expand" size={16} /></IconButton>
          <IconButton label={isSavingDraft ? 'Saving draft' : 'Save and close'} onClick={() => void saveDraft({ closeAfter: true })} disabled={isSending || isSavingDraft}><Icon name="close" size={17} /></IconButton>
        </div>
      </div>
      {!isMinimized && (
        <form className="compose-form email-light" onSubmit={send}>
          <div className="recipient-line">
            <input autoFocus value={form.to} onChange={update('to')} placeholder="Recipients" aria-label="Recipients" />
            <button type="button" onClick={() => setExtraFields((value) => !value)}>{extraFields ? 'Hide' : 'Cc Bcc'}</button>
          </div>
          {accounts.length > 1 && (
            <div className="recipient-line from-line">
              <span>From</span>
              <select value={senderId} onChange={(event) => setSenderId(event.target.value)} aria-label="Send from account" disabled={Boolean(draftId)} title={draftId ? 'A saved draft stays with its original account' : undefined}>
                {accounts.map((item) => <option key={item.id} value={item.id}>{item.name} &lt;{item.email}&gt;</option>)}
              </select>
            </div>
          )}
          {extraFields && <><div className="recipient-line"><input value={form.cc} onChange={update('cc')} placeholder="Cc" aria-label="Cc" /></div><div className="recipient-line"><input value={form.bcc} onChange={update('bcc')} placeholder="Bcc" aria-label="Bcc" /></div></>}
          <div className="recipient-line subject-line"><input value={form.subject} onChange={update('subject')} placeholder="Subject" aria-label="Subject" /></div>
          <textarea value={form.body} onChange={update('body')} placeholder="Write your message" aria-label="Message body" />
          {senderAccount?.signature && <div className="signature-preview">{senderAccount.signature}</div>}
          {error && <p className="compose-error" role="alert">{error}</p>}
          <div className="compose-footer">
            <button type="submit" className="send-button" disabled={isSending || isSavingDraft}>{isSending ? 'Sending…' : 'Send'}</button>
            <IconButton label="Attach files" onClick={unavailable('Attachments')}><Icon name="attachment" /></IconButton>
            <IconButton label="Insert link" onClick={unavailable('Link insertion')}><Icon name="link" /></IconButton>
            <span className="compose-spacer" />
            <IconButton label="Discard draft" onClick={discardDraft} disabled={isSending || isSavingDraft}><Icon name="trash" /></IconButton>
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

function SettingsPanel({ open, onClose, accounts, activeAccount, setActiveAccount, privacy, setPrivacy, density, setDensity, onAddAccount, onUnlock, onSaveSignature, showUnified }) {
  const [signature, setSignature] = useState('');
  useEffect(() => setSignature(activeAccount?.signature || ''), [activeAccount?.id, activeAccount?.signature]);
  if (!open) return null;
  return (
    <>
      <button type="button" className="settings-scrim" onClick={onClose} aria-label="Close settings" />
      <aside className="settings-panel" aria-label="Quick settings">
        <div className="settings-header">
          <div className="settings-header-copy">
            <h2>Quick settings</h2>
            <p>Switch accounts and tune this mailbox.</p>
          </div>
          <IconButton label="Close settings" onClick={onClose}><Icon name="close" /></IconButton>
        </div>
        <div className="settings-scroll">
          <section className="settings-section">
            <h3>Accounts</h3>
            <p className="settings-description">Choose which identity you are reading and sending as.</p>
            <div className="settings-accounts">
              {showUnified && (
                <button type="button" className={`settings-account ${!activeAccount ? 'is-active' : ''}`} onClick={() => setActiveAccount(null)}>
                  <Avatar person={UNIFIED_ACCOUNT} size="md" />
                  <span className="settings-account-copy"><strong>All inboxes</strong><small>Unified inbox</small></span>
                  <span className="settings-account-meta">
                    <em className="status-pill">Unified</em>
                    <Icon name={!activeAccount ? 'check' : 'chevronRight'} size={18} />
                  </span>
                </button>
              )}
              {accounts.map((account) => (
                <button type="button" className={`settings-account ${activeAccount?.id === account.id ? 'is-active' : ''}`} key={account.id} onClick={() => setActiveAccount(account)}>
                  <Avatar person={account} size="md" />
                  <span className="settings-account-copy"><strong>{account.name}</strong><small>{account.email}</small></span>
                  <span className="settings-account-meta">
                    <em className={`status-pill ${account.connected ? 'is-connected' : 'is-attention'}`}>{account.connected ? 'Connected' : 'Needs attention'}</em>
                    <Icon name={activeAccount?.id === account.id ? 'check' : 'chevronRight'} size={18} />
                  </span>
                </button>
              ))}
            </div>
            <button type="button" className="add-account-button" onClick={onAddAccount}><Icon name="plus" size={18} /> Add another account</button>
          </section>
          <section className="settings-section">
            <h3>Density</h3>
            <p className="settings-description">How much space each conversation uses in the list.</p>
            <div className="density-options" role="radiogroup" aria-label="Mailbox density">
              {['Default', 'Comfortable', 'Compact'].map((option) => (
                <button
                  type="button"
                  key={option}
                  role="radio"
                  aria-checked={density === option}
                  onClick={() => setDensity(option)}
                  className={density === option ? 'is-selected' : ''}
                >
                  <span className={`density-preview density-${option.toLowerCase()}`}><i /><i /><i /></span>
                  {option}
                </button>
              ))}
            </div>
          </section>
          <section className="settings-section privacy-section">
            <div className="settings-section-title"><h3>Privacy</h3><Icon name="shield" size={20} /></div>
            <p className="settings-description">Keep email content from identifying you.</p>
            <div className="privacy-enforced">
              <span><strong>Block email trackers</strong><small>Always on for known tracking pixels, even when images are allowed.</small></span>
              <em><Icon name="shield" size={15} /> Locked on</em>
            </div>
            <Toggle
              checked={privacy.privateImages}
              onChange={(value) => setPrivacy((current) => {
                const next = { ...current, privateImages: value };
                writeUiPrefs({ privateImages: value });
                return next;
              })}
              label="Offer private image loading"
              hint="Show a per-message option to load non-tracking images through the GigaMail relay."
            />
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

function accountConnectionError(error) {
  if (error?.status === 401 || error?.status === 403) return 'Unlock GigaMail before adding an account.';
  if (error?.status === 409) return error.message || 'An account with this email is already connected.';
  if (error?.code === 'CREDENTIAL_ENCRYPTION_UNAVAILABLE') {
    return error.message || 'Credential encryption is not configured on this GigaMail server.';
  }
  const safeMessage = String(error?.message || '').trim();
  if (safeMessage && !safeMessage.startsWith('<') && safeMessage.length <= 360 && error?.status >= 400 && error?.status < 600) return safeMessage;
  return 'Could not verify this account. Check the email, server settings, and app password, then try again.';
}

function AddAccountModal({ onClose, onAdded }) {
  const initialProvider = PROVIDER_PRESETS.gmail;
  const [step, setStep] = useState('provider');
  const [form, setForm] = useState({
    name: '',
    email: '',
    username: '',
    imapUsername: '',
    providerKey: initialProvider.id,
    appPassword: '',
    signature: '',
    color: initialProvider.color,
    imapHost: initialProvider.imapHost,
    imapPort: initialProvider.imapPort,
    smtpHost: initialProvider.smtpHost,
    smtpPort: initialProvider.smtpPort,
    avatarUrl: '',
  });
  const [saving, setSaving] = useState(false);
  const [savingPhase, setSavingPhase] = useState('');
  const [protocolStatus, setProtocolStatus] = useState({ imap: 'idle', smtp: 'idle' });
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useRef(null);
  const firstProviderRef = useRef(null);
  const emailRef = useRef(null);
  const savingRef = useRef(false);
  const selectedProvider = PROVIDER_PRESETS[form.providerKey] || PROVIDER_PRESETS.custom;
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const updateEmail = (event) => {
    const value = event.target.value;
    setForm((current) => {
      const previousLocalPart = current.email.split('@')[0];
      return {
        ...current,
        email: value,
        username: !current.username || current.username === current.email ? value : current.username,
        imapUsername: current.providerKey === 'icloud' && (!current.imapUsername || current.imapUsername === previousLocalPart) ? value.split('@')[0] : current.imapUsername,
      };
    });
  };
  const chooseProvider = (providerKey) => {
    const provider = PROVIDER_PRESETS[providerKey];
    setForm((current) => ({
      ...current,
      providerKey,
      username: current.email,
      imapUsername: providerKey === 'icloud' ? current.email.split('@')[0] : '',
      appPassword: '',
      color: provider.color,
      imapHost: provider.imapHost,
      imapPort: provider.imapPort,
      smtpHost: provider.smtpHost,
      smtpPort: provider.smtpPort,
    }));
    setError('');
    setPasswordVisible(false);
    setProtocolStatus({ imap: 'idle', smtp: 'idle' });
    setStep('details');
    window.requestAnimationFrame(() => emailRef.current?.focus());
  };
  useEffect(() => { savingRef.current = saving; }, [saving]);
  useEffect(() => {
    const previousFocus = document.activeElement;
    firstProviderRef.current?.focus();
    const handleDialogKeys = (event) => {
      if (event.key === 'Escape' && !savingRef.current) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', handleDialogKeys);
    return () => {
      window.removeEventListener('keydown', handleDialogKeys);
      previousFocus?.focus?.();
    };
  }, []); // The modal is mounted for one onboarding session.
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
    if (step !== 'details') return;
    const email = form.email.trim().toLowerCase();
    const password = form.providerKey === 'gmail' ? form.appPassword.replace(/\s/g, '') : form.appPassword.trim();
    if (!email || !password) { setError(`Email address and ${form.providerKey === 'mailinabox' ? 'a mailbox password' : 'an app password'} are required.`); return; }
    if (!form.imapHost.trim() || !form.smtpHost.trim()) { setError('Add both IMAP and SMTP server hosts.'); return; }
    if (![form.imapPort, form.smtpPort].every((port) => Number(port) > 0 && Number(port) <= 65535)) { setError('Enter valid IMAP and SMTP ports.'); return; }
    savingRef.current = true;
    setSaving(true);
    setSavingPhase('Checking IMAP & SMTP…');
    setProtocolStatus({ imap: 'checking', smtp: 'checking' });
    setError('');
    const displayName = form.name.trim() || email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
    const payload = {
      name: displayName,
      displayName,
      email,
      provider: selectedProvider.provider,
      credentials: {
        username: form.username.trim() || email,
        email,
        password,
        ...(form.providerKey === 'icloud' ? { imapUsername: form.imapUsername.trim() || email.split('@')[0], smtpUsername: email } : {}),
      },
      signature: form.signature,
      color: form.color,
      avatarDataUrl: form.avatarUrl || undefined,
      imap: { host: form.imapHost.trim(), port: Number(form.imapPort) || 993, secure: Number(form.imapPort) === 993 },
      smtp: { host: form.smtpHost.trim(), port: Number(form.smtpPort) || 465, secure: Number(form.smtpPort) === 465 },
    };
    let savingPhaseTimer;
    try {
      savingPhaseTimer = window.setTimeout(() => setSavingPhase('Verifying & saving securely…'), 1200);
      const result = await api('/accounts', { method: 'POST', body: JSON.stringify(payload) });
      setProtocolStatus({ imap: 'passed', smtp: 'passed' });
      onAdded(normalizeAccount(result?.account || result || payload));
      onClose();
    } catch (requestError) {
      const protocols = requestError.details?.protocols || {};
      const hasProtocolDetails = Object.keys(protocols).length > 0;
      const outcome = (value, fallback) => {
        if (value === true || value?.ok === true || ['ok', 'passed', 'connected', 'success'].includes(String(value?.status || value || '').toLowerCase())) return 'passed';
        if (value === false || value?.ok === false || ['failed', 'error', 'rejected', 'timeout'].includes(String(value?.status || value || '').toLowerCase())) return 'failed';
        return fallback;
      };
      setProtocolStatus((current) => requestError.code === 'CREDENTIAL_ENCRYPTION_UNAVAILABLE' ? { imap: 'idle', smtp: 'idle' } : ({
        imap: outcome(protocols.imap, requestError.code?.startsWith('IMAP_') || (!hasProtocolDetails && current.imap === 'checking') ? 'failed' : current.imap),
        smtp: outcome(protocols.smtp, requestError.code?.startsWith('SMTP_') || (!hasProtocolDetails && current.smtp === 'checking') ? 'failed' : current.smtp),
      }));
      setError(accountConnectionError(requestError));
    } finally {
      window.clearTimeout(savingPhaseTimer);
      savingRef.current = false;
      setSaving(false);
      setSavingPhase('');
    }
  };
  return (
    <div className="modal-layer">
      <button type="button" className="modal-scrim" onClick={saving ? undefined : onClose} aria-label="Close add account" disabled={saving} />
      <form ref={dialogRef} className="account-modal account-onboarding" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="add-account-title" aria-describedby="add-account-subtitle">
        <div className="account-modal-header">
          <div className="account-modal-title">
            {step === 'details' && <IconButton label="Choose a different provider" onClick={() => { setStep('provider'); setError(''); }} disabled={saving} className="modal-back"><Icon name="back" /></IconButton>}
            <div><h2 id="add-account-title">{step === 'provider' ? 'Add an email account' : selectedProvider.title}</h2><p id="add-account-subtitle">{step === 'provider' ? 'Choose a provider. Every inbox lands in one private workspace.' : `Step 2 of 2 · ${selectedProvider.caption}`}</p></div>
          </div>
          <IconButton label="Close" onClick={onClose} disabled={saving}><Icon name="close" /></IconButton>
        </div>
        <div className="account-step-track" aria-hidden="true"><i className="is-complete" /><i className={step === 'details' ? 'is-complete' : ''} /></div>
        {step === 'provider' ? (
          <div className="account-modal-scroll provider-picker-step">
            <div className="provider-picker-heading"><span className="provider-picker-icon"><Icon name="mail" size={22} /></span><div><strong>Where is your email hosted?</strong><p>Connection settings are filled in automatically for common providers.</p></div></div>
            <div className="provider-card-grid">
              {Object.values(PROVIDER_PRESETS).map((provider, index) => (
                <button type="button" ref={index === 0 ? firstProviderRef : undefined} className="provider-card" key={provider.id} onClick={() => chooseProvider(provider.id)} style={{ '--provider-color': provider.color }}>
                  <span className="provider-card-mark">{provider.mark}</span>
                  <span className="provider-card-copy"><strong>{provider.label}</strong><small>{provider.caption}</small></span>
                  <Icon name="chevronRight" size={18} />
                </button>
              ))}
            </div>
            <div className="provider-picker-security"><Icon name="shield" size={19} /><span><strong>Private by design</strong><small>Mailbox credentials are sent only to your GigaMail server. The server refuses to save them unless encrypted-at-rest storage is configured.</small></span></div>
          </div>
        ) : (
          <div className="account-modal-scroll account-details-step">
            <div className="selected-provider-card" style={{ '--provider-color': selectedProvider.color }}>
              <span className="provider-card-mark">{selectedProvider.mark}</span>
              <span><strong>{selectedProvider.label}</strong><small>{selectedProvider.caption}</small></span>
              <button type="button" onClick={() => { setStep('provider'); setError(''); }} disabled={saving}>Change</button>
            </div>

            <aside className="provider-guidance">
              <span className="guidance-icon"><Icon name="lock" size={18} /></span>
              <div><strong>{selectedProvider.passwordTitle}</strong><p>{selectedProvider.passwordHint}</p>{selectedProvider.helpUrl && <a href={selectedProvider.helpUrl} target="_blank" rel="noreferrer">{selectedProvider.helpLabel} <span aria-hidden="true">↗</span></a>}</div>
            </aside>

            <div className="account-fields-grid">
              <label className="form-field"><span>Email address</span><input ref={emailRef} type="email" required value={form.email} onChange={updateEmail} placeholder={form.providerKey === 'icloud' ? 'you@icloud.com' : 'you@example.com'} autoComplete="email" spellCheck="false" autoCapitalize="none" /></label>
              <label className="form-field"><span>Display name <em>optional</em></span><input value={form.name} onChange={update('name')} placeholder="Name recipients will see" autoComplete="name" /></label>
            </div>

            <label className="form-field password-field">
              <span>{form.providerKey === 'mailinabox' ? 'Mailbox password' : 'App password'}</span>
              <span className="password-input"><input type={passwordVisible ? 'text' : 'password'} required value={form.appPassword} onChange={update('appPassword')} placeholder="Not saved in this browser" autoComplete="off" spellCheck="false" autoCapitalize="none" /><IconButton label={passwordVisible ? 'Hide password' : 'Show password'} onClick={() => setPasswordVisible((value) => !value)}><Icon name={passwordVisible ? 'eyeOff' : 'eye'} size={18} /></IconButton></span>
              <small>Used only to verify IMAP and SMTP, then encrypted by the server before storage.</small>
            </label>

            {form.providerKey === 'mailinabox' && (
              <label className="form-field"><span>Mail server hostname</span><input value={form.imapHost} onChange={(event) => { const value = event.target.value; setForm((current) => ({ ...current, imapHost: value, smtpHost: current.smtpHost === current.imapHost ? value : current.smtpHost })); }} placeholder="box.yourdomain.com" spellCheck="false" autoCapitalize="none" /><small>Verified as box.xer5.com so TLS certificates validate correctly. The LAN address remains private to the server.</small></label>
            )}

            {['custom', 'mailinabox'].includes(form.providerKey) ? (
              <details className="advanced-connection" open={form.providerKey === 'custom'}>
                <summary>{form.providerKey === 'custom' ? 'IMAP and SMTP settings' : 'Advanced connection settings'}</summary>
                <label className="form-field connection-username"><span>Mailbox username <em>usually the full email address</em></span><input value={form.username} onChange={update('username')} placeholder={form.email || 'you@example.com'} spellCheck="false" autoCapitalize="none" /></label>
                <div className="provider-grid">
                  <label className="form-field"><span>IMAP host</span><input value={form.imapHost} onChange={update('imapHost')} placeholder="imap.example.com" spellCheck="false" autoCapitalize="none" /></label>
                  <label className="form-field"><span>Port</span><input type="number" min="1" max="65535" inputMode="numeric" value={form.imapPort} onChange={update('imapPort')} /></label>
                  <label className="form-field"><span>SMTP host</span><input value={form.smtpHost} onChange={update('smtpHost')} placeholder="smtp.example.com" spellCheck="false" autoCapitalize="none" /></label>
                  <label className="form-field"><span>Port</span><input type="number" min="1" max="65535" inputMode="numeric" value={form.smtpPort} onChange={update('smtpPort')} /></label>
                </div>
              </details>
            ) : (
              <div className="connection-summary" aria-label="Provider connection settings"><span><Icon name="lock" size={14} /> IMAP {form.imapHost}:{form.imapPort}</span><span><Icon name="send" size={14} /> SMTP {form.smtpHost}:{form.smtpPort}</span></div>
            )}

            {form.providerKey === 'icloud' && (
              <details className="advanced-connection icloud-connection">
                <summary>Advanced iCloud sign-in</summary>
                <label className="form-field connection-username"><span>IMAP username</span><input value={form.imapUsername} onChange={update('imapUsername')} placeholder={form.email.split('@')[0] || 'yourname'} spellCheck="false" autoCapitalize="none" /><small>Apple usually accepts the part before @icloud.com. If sign-in fails, try the full iCloud email address here. SMTP always uses the full address.</small></label>
              </details>
            )}

            <details className="identity-details">
              <summary>Sending identity and appearance</summary>
              <div className="account-profile-row"><Avatar person={{ name: form.name || form.email || selectedProvider.label, color: form.color, avatarUrl: form.avatarUrl }} size="hero" /><label className="photo-upload"><input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={chooseAvatar} />{form.avatarUrl ? 'Replace profile photo' : 'Upload profile photo'}</label></div>
              <label className="form-field"><span>Signature <em>optional</em></span><textarea value={form.signature} onChange={update('signature')} placeholder="Kind regards," /></label>
              <div className="color-picker"><span>Profile color</span><div>{['#0b57d0', '#8e24aa', '#e8710a', '#00897b', '#c2185b', '#455a64'].map((color) => <button type="button" key={color} onClick={() => setForm((current) => ({ ...current, color }))} className={form.color === color ? 'is-selected' : ''} style={{ '--swatch': color }} aria-label={`Choose ${color}`} />)}</div></div>
            </details>

            <div className="credential-security-note"><Icon name="shield" size={19} /><span><strong>Encrypted, never browser-stored</strong><small>This form keeps the password only in memory. GigaMail verifies both connections before persisting anything, then encrypts the credential on the server.</small></span></div>
            {Object.values(protocolStatus).some((status) => status !== 'idle') && (
              <div className="protocol-status-row" aria-live="polite">
                {['imap', 'smtp'].map((protocol) => <span key={protocol} className={`protocol-status is-${protocolStatus[protocol]}`}><i>{protocolStatus[protocol] === 'passed' ? '✓' : protocolStatus[protocol] === 'failed' ? '!' : ''}</i><strong>{protocol.toUpperCase()}</strong><small>{protocolStatus[protocol] === 'passed' ? 'Verified' : protocolStatus[protocol] === 'failed' ? 'Failed' : protocolStatus[protocol] === 'checking' ? 'Checking…' : 'Waiting'}</small></span>)}
              </div>
            )}
            {error && <p className="form-error account-form-error" role="alert">{error}</p>}
          </div>
        )}
        <div className="account-modal-footer">
          {step === 'provider' ? <><span className="modal-footer-hint">Select a provider to continue</span><button type="button" className="text-button" onClick={onClose}>Cancel</button></> : <><button type="button" className="text-button" onClick={() => setStep('provider')} disabled={saving}>Back</button><button type="submit" className="primary-button connect-account-button" disabled={saving || !form.email.trim() || !form.appPassword}>{saving ? savingPhase || 'Connecting…' : 'Test & add account'}</button></>}
        </div>
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
        <div className="access-mark"><BrandMark size={48} /></div>
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

function ProfileMenu({ open, onClose, account, accounts, setActiveAccount, onSelectUnified, onOpenSettings, onLogout, showUnified }) {
  if (!open) return null;
  return (
    <>
      <button type="button" className="profile-scrim" onClick={onClose} aria-label="Close account menu" />
      <section className="profile-menu" aria-label="Account menu">
        <button type="button" className="profile-close" onClick={onClose}><Icon name="close" size={18} /></button>
        <Avatar person={account} size="hero" />
        <strong className="profile-name">{account?.name}</strong>
        <span className="profile-email">{account?.email}</span>
        <button type="button" className="manage-account-button" onClick={() => { onOpenSettings(); onClose(); }}>Manage your accounts</button>
        <div className="profile-account-list">
          {showUnified && <button type="button" onClick={() => { onSelectUnified(); onClose(); }}><Avatar person={UNIFIED_ACCOUNT} size="sm" /><span className="profile-account-copy">All inboxes</span>{account?.isUnified && <Icon name="check" size={17} />}</button>}
          {accounts.map((item) => <button type="button" key={item.id} onClick={() => { setActiveAccount(item); onClose(); }}><Avatar person={item} size="sm" /><span className="profile-account-copy">{item.email}</span>{item.id === account?.id && <Icon name="check" size={17} />}</button>)}
        </div>
        <button type="button" className="logout-button" onClick={onLogout}>
          <Icon name="logout" size={18} />
          Log out
        </button>
        <div className="profile-menu-footer">
          <span>Self-hosted · credentials stay on your server</span>
        </div>
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
  const initialPrefs = useMemo(() => readUiPrefs(), []);
  const [sidebarCompact, setSidebarCompact] = useState(Boolean(initialPrefs.sidebarCompact));
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [activeFolder, setActiveFolder] = useState('inbox');
  const [accounts, setAccounts] = useState([]);
  const [activeAccount, setActiveAccount] = useState(null);
  const [threads, setThreads] = useState([]);
  const [selectedThread, setSelectedThread] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [activePersonFlag, setActivePersonFlag] = useState(null);
  const [mailTotal, setMailTotal] = useState(0);
  const [categoryCounts, setCategoryCounts] = useState(() => countSmartCategories([]));
  const [folderCounts, setFolderCounts] = useState(() => ({ ...EMPTY_FOLDER_COUNTS }));
  const [loading, setLoading] = useState(true);
  const [isDemo, setIsDemo] = useState(false);
  const [offline, setOffline] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeContext, setComposeContext] = useState(null);
  const [notice, setNotice] = useState('');
  const [privacy, setPrivacy] = useState({ privateImages: initialPrefs.privateImages !== false });
  const [density, setDensity] = useState(['Default', 'Comfortable', 'Compact'].includes(initialPrefs.density) ? initialPrefs.density : 'Default');
  const [accessToken, setAccessToken] = useState(() => getAccessToken());
  const [accessOpen, setAccessOpen] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [addAccountOpen, setAddAccountOpen] = useState(false);
  const loadRequestRef = useRef(0);
  const demoDraftsRef = useRef([]);

  const updateDensity = (value) => {
    setDensity(value);
    writeUiPrefs({ density: value });
  };

  const toggleSidebarCompact = () => {
    setSidebarCompact((current) => {
      const next = !current;
      writeUiPrefs({ sidebarCompact: next });
      return next;
    });
  };

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 280);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const unread = Number(folderCounts.inbox) || 0;
    document.title = unread > 0 ? `(${unread}) GigaMail` : 'GigaMail';
  }, [folderCounts.inbox]);

  const openNewCompose = () => {
    setComposeContext(null);
    setComposeOpen(true);
  };

  const closeCompose = () => {
    setComposeOpen(false);
    setComposeContext(null);
  };

  const openReplyComposer = (thread, message, { replyAll = false } = {}) => {
    const subject = /^re:/i.test(thread.subject || '') ? thread.subject : `Re: ${thread.subject || '(no subject)'}`;
    const sender = message.from?.name || message.from?.email || 'the sender';
    const original = String(message.body || '').trim();
    const sentMessage = Boolean(message.isSent || thread.isSent || thread.folder === 'sent');
    const replyTo = recipientArray(message.replyTo);
    const primaryRecipients = sentMessage ? recipientArray(message.to) : replyTo.length ? replyTo : [message.from];
    const toCandidates = replyAll
      ? [...primaryRecipients, ...(!sentMessage ? recipientArray(message.to) : [])]
      : primaryRecipients.slice(0, 1);
    const identityList = accounts.length ? accounts : isDemo ? demoAccounts : [];
    const ownAddresses = new Set(identityList.map((item) => String(item.email || '').toLowerCase()).filter(Boolean));
    const seen = new Set();
    const uniqueRecipients = (values) => values.filter(Boolean).map((value) => normalizePerson(value)).filter((person) => {
      const email = String(person.email || '').toLowerCase();
      if (!email || seen.has(email) || (replyAll && ownAddresses.has(email))) return false;
      seen.add(email);
      return true;
    });
    // Keep original Cc recipients in Cc while de-duplicating them against To.
    const originalCc = replyAll ? recipientArray(message.cc) : [];
    const recipients = uniqueRecipients(toCandidates);
    const ccRecipients = uniqueRecipients(originalCc);
    if (!recipients.length && primaryRecipients[0]) recipients.push(normalizePerson(primaryRecipients[0]));
    setComposeContext({
      mode: replyAll ? 'reply-all' : 'reply',
      accountId: message.accountId || thread.accountId || null,
      to: formatRecipients(recipients),
      cc: formatRecipients(ccRecipients),
      subject,
      body: original ? `\n\nOn ${formatMessageDate(message.timestamp)}, ${sender} wrote:\n${original}` : '',
      threadId: thread.threadId || thread.id,
      replyToMessageId: message.rfcMessageId || undefined,
    });
    setComposeOpen(true);
  };

  const openForwardComposer = (thread, message) => {
    const subject = /^fwd:/i.test(thread.subject || '') ? thread.subject : `Fwd: ${thread.subject || '(no subject)'}`;
    const sender = message.from?.name || message.from?.email || 'Unknown sender';
    const original = String(message.body || '').trim();
    setComposeContext({
      mode: 'forward',
      accountId: message.accountId || thread.accountId || null,
      to: '',
      subject,
      body: `\n\n---------- Forwarded message ----------\nFrom: ${sender}\nDate: ${formatMessageDate(message.timestamp)}\nSubject: ${thread.subject || '(no subject)'}\n\n${original}`,
    });
    setComposeOpen(true);
  };

  const loadMailbox = useCallback(async ({ keepSelection = true } = {}) => {
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    try {
      let session = null;
      try {
        session = await api('/session');
      } catch (sessionError) {
        if (sessionError.status === 401 || sessionError.status === 403) throw sessionError;
      }
      if (session?.protected && !session.authenticated) {
        setOffline(false);
        setAuthRequired(true);
        setAccessOpen(true);
        setIsDemo(false);
        setAccounts([]);
        setThreads([]);
        setMailTotal(0);
        setCategoryCounts(countSmartCategories([]));
        setFolderCounts({ ...EMPTY_FOLDER_COUNTS });
        setSelectedThread(null);
        return;
      }
      const params = new URLSearchParams({ folder: activeFolder });
      if (activeAccount?.id) params.set('accountId', activeAccount.id);
      if (activeFolder === 'inbox' && !activePersonFlag && activeCategory !== 'all') params.set('category', activeCategory);
      if (activePersonFlag) params.set('flag', activePersonFlag);
      if (debouncedQuery) params.set('q', debouncedQuery);
      const [accountData, mailData] = await Promise.all([
        api('/accounts'),
        api(`/messages?${params.toString()}`),
      ]);
      if (requestId !== loadRequestRef.current) return;
      const nextAccounts = getArray(accountData, ['accounts', 'items']).map(normalizeAccount);
      const rawThreads = getArray(mailData, ['threads', 'messages', 'items', 'data']);
      const nextThreads = rawThreads.map(normalizeThread);
      const isFreshSetup = nextAccounts.length === 0 && nextThreads.length === 0;
      const previewThreads = [...demoDraftsRef.current, ...demoMailboxThreads];
      const responseTotal = Number(mailData?.total);
      const nextCategoryCounts = mailData?.categoryCounts && typeof mailData.categoryCounts === 'object'
        ? Object.fromEntries(SMART_CATEGORIES.filter((item) => item.id !== 'all').map((item) => [item.id, Number(mailData.categoryCounts[item.id] || 0)]))
        : countSmartCategories(nextThreads);
      const nextFolderCounts = mailData?.folderCounts && typeof mailData.folderCounts === 'object'
        ? {
          inbox: Number(mailData.folderCounts.inbox) || 0,
          starred: Number(mailData.folderCounts.starred) || 0,
          snoozed: Number(mailData.folderCounts.snoozed) || 0,
          drafts: Number(mailData.folderCounts.drafts) || 0,
        }
        : null;
      setAuthRequired(false);
      setOffline(false);
      setAccounts(isFreshSetup ? [] : nextAccounts);
      // Null represents the unified inbox. Preserve an explicit per-account choice,
      // but start every newly loaded mailbox with all connected accounts visible.
      setActiveAccount((current) => nextAccounts.find((item) => item.id === current?.id) || null);
      setThreads(isFreshSetup ? previewThreads : nextThreads);
      setMailTotal(isFreshSetup ? previewThreads.length : Number.isFinite(responseTotal) ? responseTotal : nextThreads.length);
      setCategoryCounts(isFreshSetup ? countSmartCategories(previewThreads) : nextCategoryCounts);
      if (isFreshSetup) {
        const preview = previewThreads;
        setFolderCounts({
          inbox: preview.filter((thread) => thread.folder === 'inbox' && thread.unread).length,
          starred: preview.filter((thread) => thread.starred).length,
          snoozed: preview.filter((thread) => thread.folder === 'snoozed').length,
          drafts: preview.filter((thread) => thread.folder === 'drafts').length + demoDraftsRef.current.length,
        });
      } else if (nextFolderCounts) {
        setFolderCounts(nextFolderCounts);
      }
      setIsDemo(isFreshSetup);
      if (keepSelection && selectedThread) {
        const replacement = (isFreshSetup ? previewThreads : nextThreads).find((item) => item.id === selectedThread.id);
        setSelectedThread(replacement || null);
      } else {
        setSelectedThread(null);
      }
    } catch (error) {
      if (requestId !== loadRequestRef.current) return;
      if (error.status === 401 || error.status === 403) {
        setOffline(false);
        setAuthRequired(true);
        setAccessOpen(true);
        setIsDemo(false);
        setAccounts([]);
        setThreads([]);
        setMailTotal(0);
        setCategoryCounts(countSmartCategories([]));
        setFolderCounts({ ...EMPTY_FOLDER_COUNTS });
        setSelectedThread(null);
      } else {
        // Keep the last confirmed mailbox intact. Preview data is only enabled
        // after a successful zero-account response, never as an outage fallback.
        setOffline(true);
        setNotice('GigaMail is offline. Showing the last mailbox loaded from this server.');
      }
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, [accessToken, activeAccount?.id, activeCategory, activePersonFlag, activeFolder, debouncedQuery, selectedThread]);

  useEffect(() => { loadMailbox({ keepSelection: false }); }, [activeFolder, activeAccount?.id, activeCategory, activePersonFlag, debouncedQuery, accessToken]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setSelectedIds([]);
    setSelectedThread(null);
  }, [activeAccount?.id, activeCategory, activePersonFlag, activeFolder, debouncedQuery, accessToken]);

  useEffect(() => {
    if (activeFolder !== 'inbox' && activeCategory !== 'all') {
      setActiveCategory('all');
      setSelectedIds([]);
    }
    if (activeFolder !== 'inbox' && activePersonFlag) {
      setActivePersonFlag(null);
    }
  }, [activeCategory, activeFolder, activePersonFlag]);

  const refreshMailbox = async () => {
    if (isDemo) {
      await loadMailbox({ keepSelection: false });
      return;
    }
    setLoading(true);
    setNotice(activeAccount ? `Syncing ${activeAccount.email}…` : 'Syncing all connected accounts…');
    try {
      // Sync is deliberately explicit: polling is off by default for an isolated self-hosted deployment.
      const syncPath = activeAccount?.id ? `/accounts/${encodeURIComponent(activeAccount.id)}/sync` : '/sync';
      const response = await api(syncPath, { method: 'POST', body: JSON.stringify({ mailbox: 'INBOX' }) });
      const status = syncResultStatus(response);
      const skippedMessages = syncSkippedMessageCount(response);
      if (status === 'failed') setNotice('Mailbox sync failed. Showing the latest stored mail.');
      else if (skippedMessages) setNotice(`Mailbox sync kept running; ${skippedMessages} ${skippedMessages === 1 ? 'message was' : 'messages were'} skipped by the download safety limit.`);
      else if (status === 'partial') setNotice('Mailbox sync finished with some folders unavailable.');
      else if (status === 'skipped') setNotice('Sync is disabled for this account.');
      else setNotice('Mailbox sync complete.');
    } catch {
      setNotice('Sync could not complete. Showing the latest stored mail.');
    } finally {
      await loadMailbox({ keepSelection: true });
    }
  };

  useEffect(() => {
    const handleKeys = (event) => {
      if ((event.key === 'c' || event.key === 'C') && !event.metaKey && !event.ctrlKey && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA' && document.activeElement?.tagName !== 'SELECT') {
        event.preventDefault();
        openNewCompose();
      }
      if (event.key === 'Escape') {
        // Compose handles Escape itself (save-and-close) with a capturing listener.
        if (composeOpen) return;
        setSettingsOpen(false);
        setProfileOpen(false);
        setMobileSidebarOpen(false);
        setSelectedThread(null);
      }
    };
    window.addEventListener('keydown', handleKeys);
    return () => window.removeEventListener('keydown', handleKeys);
  }, [composeOpen]);

  const visibleThreads = useMemo(() => {
    const search = query.trim().toLowerCase();
    return threads.filter((thread) => {
      const inFolder = activeFolder === 'all' || thread.folder === activeFolder || (activeFolder === 'starred' && thread.starred) || (activeFolder === 'drafts' && thread.folder === 'drafts');
      if (!inFolder) return false;
      if (activePersonFlag && !conversationMatchesPersonFlag(thread, activePersonFlag)) return false;
      if (!activePersonFlag && activeFolder === 'inbox' && activeCategory !== 'all' && smartCategoryMetadata(thread).category !== activeCategory) return false;
      // Demo/preview: hide routine ops digests from All/Primary unless searching.
      if (!search && !activePersonFlag && (activeCategory === 'all' || activeCategory === 'primary') && smartCategoryMetadata(thread).category === 'ops_quiet') return false;
      if (!search) return true;
      return [thread.subject, thread.snippet, thread.from?.name, thread.from?.email, thread.categoryLabel, thread.categoryReason, ...(thread.labels || [])].join(' ').toLowerCase().includes(search);
    });
  }, [threads, activeFolder, activeCategory, activePersonFlag, query]);

  const visibleTotal = isDemo ? visibleThreads.length : mailTotal;

  const counts = useMemo(() => ({
    inbox: folderCounts.inbox,
    starred: folderCounts.starred,
    snoozed: folderCounts.snoozed,
    drafts: folderCounts.drafts,
  }), [folderCounts]);

  const goHome = () => {
    setActiveFolder('inbox');
    setActiveCategory('all');
    setActivePersonFlag(null);
    setQuery('');
    setSelectedThread(null);
    setSelectedIds([]);
    setMobileSidebarOpen(false);
    setSettingsOpen(false);
    setProfileOpen(false);
  };

  const selectPersonFlag = (flagId) => {
    setActiveFolder('inbox');
    setActiveCategory('all');
    setActivePersonFlag(flagId);
    setSelectedIds([]);
    setSelectedThread(null);
  };

  const openThread = async (thread) => {
    if (thread.folder === 'drafts' || thread.draftId) {
      const draftMessage = thread.messages?.at(-1) || thread;
      setComposeContext({
        mode: 'draft',
        draftId: thread.draftId || String(thread.id).replace(/^draft:/, ''),
        accountId: thread.accountId || draftMessage.accountId || null,
        threadId: thread.threadId && thread.threadId !== thread.id ? thread.threadId : null,
        to: formatRecipients(thread.to || draftMessage.to),
        cc: formatRecipients(thread.cc || draftMessage.cc),
        bcc: formatRecipients(thread.bcc || draftMessage.bcc),
        subject: thread.subject === '(no subject)' ? '' : thread.subject,
        body: draftMessage.body || '',
      });
      setComposeOpen(true);
      return;
    }
    const alreadyRead = !thread.unread;
    const provisional = { ...thread, unread: false };
    setSelectedThread(provisional);
    setThreads((current) => current.map((item) => item.id === thread.id ? provisional : item));
    if (!alreadyRead) {
      setFolderCounts((current) => ({ ...current, inbox: Math.max(0, current.inbox - 1) }));
      if (!isDemo) api(`/messages/${encodeURIComponent(thread.id)}/read`, { method: 'POST' }).catch(() => undefined);
    }
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
    setFolderCounts((current) => ({
      ...current,
      starred: Math.max(0, current.starred + (next.starred ? 1 : -1)),
    }));
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
    const labels = {
      archive: 'Conversation archived',
      trash: 'Conversation moved to Trash',
      spam: 'Conversation reported as spam',
      snooze: 'Conversation snoozed until tomorrow',
      unread: 'Marked as unread',
      read: 'Marked as read',
    };
    setNotice(labels[action] || 'Updated');
    if (['archive', 'trash', 'spam', 'snooze', 'unread', 'read'].includes(action)) {
      setFolderCounts((current) => {
        // Keep badges roughly honest after optimistic local actions until the
        // next full mailbox load replaces them with server totals.
        const delta = targetIds.length;
        if (action === 'unread') return { ...current, inbox: current.inbox + delta };
        if (action === 'read') return { ...current, inbox: Math.max(0, current.inbox - delta) };
        if (action === 'snooze') return { ...current, snoozed: current.snoozed + delta, inbox: Math.max(0, current.inbox - delta) };
        if (['archive', 'trash', 'spam'].includes(action)) return { ...current, inbox: Math.max(0, current.inbox - delta) };
        return current;
      });
    }
    if (!isDemo && labels[action]) {
      void Promise.all(targetIds.map((id) => api(`/messages/${encodeURIComponent(id)}/${action}`, { method: 'POST' })))
        .then((results) => {
          const outcomes = results.flatMap((result) => result?.messages || (result?.message ? [result.message] : []))
            .map((message) => message?.remoteSync)
            .filter(Boolean);
          const failed = outcomes.find((outcome) => outcome.status === 'failed');
          const unsynced = outcomes.find((outcome) => ['local-only', 'skipped'].includes(outcome.status));
          if (failed) setNotice(`${labels[action] || 'Updated'} locally; IMAP did not confirm the change.`);
          else if (unsynced && action !== 'snooze') setNotice(`${labels[action] || 'Updated'} locally; the provider change was not available.`);
          else if (action === 'snooze') setNotice(labels.snooze);
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

  const sendMessage = (payload, localOnly, senderAccount, result) => {
    const from = senderAccount || activeAccount || accounts[0] || demoAccounts[0];
    const deliveredMessage = result?.message && typeof result.message === 'object' ? result.message : null;
    const delivery = result?.delivery || deliveredMessage?.delivery;
    const sentThread = normalizeThread({
      id: deliveredMessage?.id ? `sent-${deliveredMessage.id}` : `sent-${Date.now()}`,
      threadId: deliveredMessage?.threadId,
      accountId: deliveredMessage?.accountId || payload.accountId,
      subject: deliveredMessage?.subject || payload.subject || '(no subject)',
      snippet: deliveredMessage?.snippet || payload.textBody,
      from,
      timestamp: deliveredMessage?.sentAt || new Date().toISOString(),
      folder: 'sent',
      messages: [deliveredMessage || { ...payload, id: `sent-message-${Date.now()}`, from, timestamp: new Date().toISOString(), isSent: true }],
    });
    setThreads((current) => [sentThread, ...current]);
    setNotice(localOnly
      ? 'Message saved in the local preview.'
      : delivery?.status === 'partial'
        ? `Partially delivered: ${delivery.acceptedCount || 0} accepted, ${delivery.rejectedCount || 0} rejected.`
        : 'Message sent');
  };

  const draftSaved = (draft, senderAccount, localOnly) => {
    const id = String(draft?.id || `preview-${Date.now()}`);
    const replacesExisting = threads.some((item) => item.draftId === id || item.id === `draft:${id}`);
    const accountId = String(draft?.accountId || senderAccount?.id || '');
    const timestamp = draft?.updatedAt || new Date().toISOString();
    const draftThread = normalizeThread({
      id: `draft:${id}`,
      draftId: id,
      threadId: draft?.threadId || `draft:${id}`,
      accountId,
      folder: 'drafts',
      subject: draft?.subject || '(no subject)',
      snippet: String(draft?.textBody || '').replace(/\s+/g, ' ').slice(0, 170),
      from: senderAccount,
      to: draft?.to || [],
      cc: draft?.cc || [],
      bcc: draft?.bcc || [],
      timestamp,
      updatedAt: timestamp,
      messages: [{
        id: `draft-message:${id}`,
        accountId,
        from: senderAccount,
        to: draft?.to || [],
        cc: draft?.cc || [],
        bcc: draft?.bcc || [],
        textBody: draft?.textBody || '',
        htmlBody: draft?.htmlBody || '',
        timestamp,
      }],
    });
    if (localOnly) demoDraftsRef.current = [draftThread, ...demoDraftsRef.current.filter((item) => item.draftId !== id)];
    setThreads((current) => [draftThread, ...current.filter((item) => item.draftId !== id && item.id !== `draft:${id}`)]);
    if (!replacesExisting) {
      setFolderCounts((current) => ({ ...current, drafts: current.drafts + 1 }));
      if (!localOnly && activeFolder === 'drafts') setMailTotal((current) => current + 1);
    }
    setNotice(localOnly ? 'Draft saved in this preview.' : 'Draft saved.');
  };

  const draftRemoved = (draftId) => {
    const id = String(draftId);
    const existed = threads.some((item) => item.draftId === id || item.id === `draft:${id}`)
      || demoDraftsRef.current.some((item) => item.draftId === id || item.id === `draft:${id}`);
    demoDraftsRef.current = demoDraftsRef.current.filter((item) => item.draftId !== id && item.id !== `draft:${id}`);
    setThreads((current) => current.filter((item) => item.draftId !== id && item.id !== `draft:${id}`));
    if (existed) {
      setFolderCounts((current) => ({ ...current, drafts: Math.max(0, current.drafts - 1) }));
      if (!isDemo && activeFolder === 'drafts') setMailTotal((current) => Math.max(0, current - 1));
    }
    setSelectedThread((current) => current?.draftId === id || current?.id === `draft:${id}` ? null : current);
  };

  const lockSession = () => {
    persistAccessToken('');
    setAccessToken('');
    setProfileOpen(false);
    setSettingsOpen(false);
    setComposeOpen(false);
    setAddAccountOpen(false);
    setAccounts([]);
    setThreads([]);
    setSelectedThread(null);
    setSelectedIds([]);
    setMailTotal(0);
    setCategoryCounts(countSmartCategories([]));
    setFolderCounts({ ...EMPTY_FOLDER_COUNTS });
    setIsDemo(false);
    setOffline(false);
    setNotice('Signed out of this browser session.');
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
    setOffline(false);
    setAccounts((current) => [...current.filter((item) => item.id !== account.id), account]);
    setActiveAccount(null);
    setIsDemo(false);
    setNotice(`${account.email} connected. Syncing mail…`);
    void (async () => {
      try {
        const response = await api(`/accounts/${encodeURIComponent(account.id)}/sync`, { method: 'POST', body: JSON.stringify({ mailbox: 'INBOX' }) });
        const status = syncResultStatus(response);
        if (status === 'failed') setNotice(`${account.email} is connected, but initial sync failed.`);
        else if (status === 'partial') setNotice(`${account.email} is connected. Some folders could not sync yet.`);
        else if (status === 'skipped') setNotice(`${account.email} is connected. Sync is disabled for this account.`);
        else setNotice(`${account.email} synced.`);
      } catch {
        setNotice(`${account.email} is connected. Initial sync could not complete yet.`);
      } finally {
        await loadMailbox({ keepSelection: false });
      }
    })();
  };

  const hasConnectedAccounts = accounts.length > 0;
  const displayAccount = activeAccount || (hasConnectedAccounts ? UNIFIED_ACCOUNT : isDemo ? demoAccounts[0] : UNIFIED_ACCOUNT);
  const identityAccounts = hasConnectedAccounts ? accounts : isDemo ? demoAccounts : [];
  const composeAccount = activeAccount || identityAccounts[0] || null;

  const densityClass = density === 'Comfortable' ? 'density-comfortable-ui' : density === 'Compact' ? 'density-compact-ui' : '';

  return (
    <div className={`mail-app ${sidebarCompact ? 'sidebar-compact' : ''} ${selectedThread ? 'thread-open' : ''} ${densityClass}`.trim()}>
      <Topbar
        onToggleSidebar={() => (window.innerWidth <= 840 ? setMobileSidebarOpen((value) => !value) : toggleSidebarCompact())}
        onGoHome={goHome}
        query={query}
        setQuery={setQuery}
        onOpenSettings={() => setSettingsOpen(true)}
        onLogout={lockSession}
        onOpenProfile={() => setProfileOpen(true)}
        onFocusSmartFilters={() => {
          if (activeFolder !== 'inbox') setActiveFolder('inbox');
          window.setTimeout(() => document.querySelector('#smart-mail-filters [aria-selected="true"]')?.focus(), 0);
        }}
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
        onAddAccount={() => setAddAccountOpen(true)}
        activePersonFlag={activePersonFlag}
        onSelectPersonFlag={selectPersonFlag}
        isDemo={isDemo}
      />
      <main className="mail-workspace">
        {offline ? <div className="demo-banner offline-banner" role="status"><Icon name="eyeOff" size={16} /><span>Offline — showing the last mailbox loaded from this server.</span><button type="button" onClick={() => loadMailbox({ keepSelection: true })}>Retry</button></div> : isDemo && <div className="demo-banner"><Icon name="shield" size={16} /><span>Preview mailbox — connect your first account to replace this sample data.</span><button type="button" onClick={() => setAddAccountOpen(true)}>Add account</button></div>}
        {activePersonFlag && !offline && (
          <div className="demo-banner flag-banner" role="status">
            <Icon name="person" size={16} />
            <span>
              Flagged: {PERSON_FLAGS.find((flag) => flag.id === activePersonFlag)?.label || activePersonFlag}
              {' · '}
              {(PERSON_FLAGS.find((flag) => flag.id === activePersonFlag)?.emails || []).join(', ')}
            </span>
            <button type="button" onClick={() => setActivePersonFlag(null)}>Clear flag</button>
          </div>
        )}
        <div className="mail-split">
          <MailList
            threads={visibleThreads}
            totalCount={visibleTotal}
            categoryCounts={categoryCounts}
            selectedThread={selectedThread}
            loading={loading}
            folder={activeFolder}
            query={query}
            activeCategory={activeCategory}
            setActiveCategory={(category) => { setActiveCategory(category); setActivePersonFlag(null); setSelectedIds([]); }}
            selectedIds={selectedIds}
            setSelectedIds={setSelectedIds}
            onOpenThread={openThread}
            onToggleStar={toggleStar}
            onRefresh={refreshMailbox}
            onBulkAction={applyAction}
            onCompose={openNewCompose}
            onClearSearch={() => setQuery('')}
            hideSmartFilters={Boolean(activePersonFlag)}
          />
          {selectedThread ? <ThreadView key={selectedThread.id} thread={selectedThread} activeFolder={activeFolder} onBack={() => setSelectedThread(null)} onAction={applyAction} onLoadRemote={loadRemoteContent} onReply={openReplyComposer} onReplyAll={(thread, message) => openReplyComposer(thread, message, { replyAll: true })} onForward={openForwardComposer} allowPrivateImages={privacy.privateImages} /> : (
            <ReaderPlaceholder isDemo={isDemo} onAddAccount={() => setAddAccountOpen(true)} />
          )}
        </div>
      </main>
      {composeOpen && <ComposeModal account={composeAccount} accounts={identityAccounts} isDemo={isDemo} initialReply={composeContext} onClose={closeCompose} onSent={sendMessage} onDraftSaved={draftSaved} onDraftRemoved={draftRemoved} onNotice={setNotice} />}
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} accounts={identityAccounts} activeAccount={activeAccount} setActiveAccount={setActiveAccount} privacy={privacy} setPrivacy={setPrivacy} density={density} setDensity={updateDensity} onAddAccount={() => setAddAccountOpen(true)} onUnlock={() => setAccessOpen(true)} onSaveSignature={saveAccountSignature} showUnified={hasConnectedAccounts} />
      <ProfileMenu open={profileOpen} onClose={() => setProfileOpen(false)} account={displayAccount} accounts={identityAccounts} setActiveAccount={setActiveAccount} onSelectUnified={() => setActiveAccount(null)} onOpenSettings={() => setSettingsOpen(true)} onLogout={lockSession} showUnified={hasConnectedAccounts} />
      {addAccountOpen && <AddAccountModal onClose={() => setAddAccountOpen(false)} onAdded={accountAdded} />}
      <AccessPanel open={accessOpen} required={authRequired} currentToken={accessToken} onSave={unlockServer} onClose={() => setAccessOpen(false)} />
      <Toast notice={notice} onClose={() => setNotice('')} />
    </div>
  );
}
