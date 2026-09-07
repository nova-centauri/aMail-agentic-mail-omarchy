export const EMPTY_FOLDER_COUNTS = { inbox: 0, starred: 0, snoozed: 0, drafts: 0 };

export const folders = [
  { id: 'inbox', label: 'Inbox', icon: 'inbox' },
  { id: 'starred', label: 'Starred', icon: 'star' },
  { id: 'snoozed', label: 'Snoozed', icon: 'clock' },
  { id: 'sent', label: 'Sent', icon: 'send' },
  { id: 'drafts', label: 'Drafts', icon: 'draft' },
];

export const UNIFIED_ACCOUNT = {
  id: '__unified__',
  name: 'All inboxes',
  email: 'Unified inbox',
  color: '#0b57d0',
  isUnified: true,
};

export const SMART_CATEGORIES = [
  { id: 'all', label: 'All mail', shortLabel: 'All', icon: 'inbox', description: 'Everything across every connected account (routine ops digests stay hidden)' },
  { id: 'primary', label: 'Primary', shortLabel: 'Primary', icon: 'person', description: 'People, conversations, and mail that needs attention' },
  { id: 'github_ci', label: 'GitHub CI', shortLabel: 'GitHub CI', icon: 'branch', description: 'Pull requests, checks, builds, and workflow runs' },
  { id: 'logs', label: 'Logs', shortLabel: 'Logs', icon: 'terminal', description: 'Automated logs, digests, and machine output' },
  { id: 'status', label: 'Status updates', shortLabel: 'Status', icon: 'activity', description: 'Incidents, uptime, deploys, and service health' },
  { id: 'ops_error', label: 'Ops errors', shortLabel: 'Ops errors', icon: 'alert', description: 'Failures from your infrastructure digests (Proxmox, Watchtower, backup jobs, and any AMAIL_OPS_SOURCES you configure). Successful digests stay hidden.' },
];

/**
 * Person flags are configured per installation (Settings → Flagged people, or
 * PUT /api/flags) and loaded from the server. This is only the preview set
 * shown before any account is connected.
 */
export const DEMO_PERSON_FLAGS = [
  { id: 'priya', label: 'Priya', shortLabel: 'Priya', emails: ['priya@printworks.example'], color: '#0b57d0', description: 'Mail involving Priya' },
];

export const FLAG_COLORS = ['#0b57d0', '#c2185b', '#00897b', '#e8710a', '#6c4fc7', '#455a64', '#8e24aa', '#188038'];

export const CATEGORY_ALIASES = {
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
  proxmox: 'ops_error',
  watchtower: 'ops_error',
};

export const PROVIDER_PRESETS = {
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
    imapHost: '',
    imapPort: '993',
    smtpHost: '',
    smtpPort: '587',
    title: 'Connect Mail-in-a-Box',
    passwordTitle: 'Use the mailbox password',
    passwordHint: 'Enter the public hostname of your box (usually box.yourdomain.com, as shown on its TLS certificate), the full mailbox address, and its mailbox password. aMail uses IMAP TLS on 993 and SMTP STARTTLS on 587.',
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
