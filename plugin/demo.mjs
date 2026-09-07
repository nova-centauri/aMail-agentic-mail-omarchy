// Fabricated inbox for screenshots and docs. Writes
// ~/.local/state/amail/demo.json; while that file exists the widget renders
// it instead of the daemon's state and does not start the daemon.
//
//   node plugin/demo.mjs          write the demo state
//   node plugin/demo.mjs off      remove it (the widget returns to live mail)
//
// Every name, address, and subject here is invented.
import fs from 'node:fs';
import path from 'node:path';
import { STATE_DIR, ensureDir, writeJsonAtomic } from './lib.mjs';

const DEMO_FILE = path.join(STATE_DIR, 'demo.json');

if (process.argv[2] === 'off') {
  try { fs.unlinkSync(DEMO_FILE); } catch { /* already gone */ }
  console.log('demo mode off');
  process.exit(0);
}

const accounts = [
  { id: 'acc-work', email: 'ada@lumenworks.example', displayName: 'Lumenworks', color: '#5b8def', provider: 'gmail' },
  { id: 'acc-personal', email: 'ada.q@icloud.example', displayName: 'Personal', color: '#d97a5b', provider: 'icloud' },
  { id: 'acc-ops', email: 'ops@lumenworks.example', displayName: 'Ops', color: '#4fae7a', provider: 'custom' },
  { id: 'acc-side', email: 'hello@quietharbor.example', displayName: 'Quiet Harbor', color: '#9b6bd6', provider: 'gmail' },
];
const byId = Object.fromEntries(accounts.map((account) => [account.id, account]));

const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();

const seed = [
  ['acc-work', 'Priya Raman', 'priya@northwind.example', 'Re: Q4 print run — proofs attached', 'Two colour shifts on page 3 fixed, the rest matches the signed proof. Can you confirm by Thursday?', 6, false, false, true, 3],
  ['acc-personal', 'Mateo Alvarez', 'mateo@alvarezfamily.example', 'Saturday: lake or hills?', 'Weather looks fine either way. I vote hills, the lake road is closed until the 14th.', 14, false, false, false, 1],
  ['acc-ops', 'Watchtower', 'watchtower@lumenworks.example', 'Updated 3 containers on print-01', 'amail, caddy, and tor-proxy pulled new images. No restarts failed.', 22, true, true, false, 1],
  ['acc-work', 'Dana Whitfield', 'dana@harborpress.example', 'Invoice 2211 — net 30 reminder', 'Friendly reminder that invoice 2211 falls due on the 19th. Let me know if the PO number needs to change.', 41, false, true, true, 1],
  ['acc-side', 'Quiet Harbor Store', 'orders@quietharbor.example', 'New order #1043 (2 items)', 'Sea salt candle ×1, Linen tote ×1. Ship to Portland, ME. Total $58.00.', 55, false, false, false, 1],
  ['acc-work', 'GitHub', 'notifications@github.example', '[lumenworks/press] CI passed on main (#412)', 'All 97 checks passed in 2m 41s.', 73, true, true, false, 1],
  ['acc-personal', 'Dr. Okafor’s Office', 'frontdesk@okafordental.example', 'Appointment confirmed for Tue 10:30', 'Reply C to confirm or R to reschedule. Please arrive ten minutes early.', 98, false, true, false, 1],
  ['acc-work', 'Sam Lindqvist', 'sam@lumenworks.example', 'Re: Re: onboarding checklist for the new press operator', 'Added the safety walkthrough and the colour management module. Draft is in the shared drive.', 130, false, false, false, 5],
  ['acc-ops', 'Proxmox', 'root@pve.lumenworks.example', 'vzdump backup status (pve): backup successful', 'VM 101 (print-db): 12.4 GB in 00:04:12. VM 102 (amail): 3.1 GB in 00:01:03.', 160, true, true, false, 1],
  ['acc-side', 'Etsy', 'no-reply@etsy.example', 'Your listing “Harbor Fog Candle” is running low', 'Only 2 left in stock. Update your quantity to keep it visible.', 190, true, false, false, 1],
  ['acc-work', 'Lena Fischer', 'lena@paperandink.example', 'Paper stock quote — 100# cover, 5,000 sheets', 'Quote attached. Price holds through end of month; lead time is 6 business days.', 240, false, true, true, 2],
  ['acc-personal', 'Bank of Elm Street', 'alerts@elmstreetbank.example', 'A new device signed in to your account', 'If this was you, no action is needed. Otherwise, secure your account now.', 300, true, true, false, 1],
  ['acc-work', 'Priya Raman', 'priya@northwind.example', 'Delivery window for the trade show kits', 'The venue receives freight Tue–Thu only. Can we ship Monday to land Wednesday?', 410, true, true, false, 4],
  ['acc-ops', 'Uptime Kuma', 'kuma@lumenworks.example', '[Down] mail.lumenworks.example (HTTPS)', 'Timeout after 48 seconds. 2 retries failed.', 520, false, false, false, 1],
  ['acc-side', 'Noor Haddad', 'noor@studiohaddad.example', 'Collab: candle + ceramic set for spring?', 'Loved your fog line. I have a small batch of speckled vessels that would pair well — interested?', 700, true, true, false, 2],
];

const conversations = seed.map(([accountId, name, email, subject, snippet, ago, isRead, isAnalyzed, hasAttachments, count], index) => ({
  id: `demo-thread-${index + 1}`,
  threadId: `demo-thread-${index + 1}`,
  latestMessageId: `demo-msg-${index + 1}`,
  accountId,
  accountEmail: byId[accountId].email,
  accountName: byId[accountId].displayName,
  accountColor: byId[accountId].color,
  from: { name, email },
  subject,
  snippet,
  latestAt: minutesAgo(ago),
  isRead,
  unreadCount: isRead ? 0 : 1,
  isAnalyzed,
  unanalyzedCount: isAnalyzed ? 0 : 1,
  isStarred: index === 0 || index === 10,
  isSent: false,
  hasAttachments,
  messageCount: count,
  category: /watchtower|proxmox/i.test(name) ? 'ops_quiet' : /github/i.test(name) ? 'github_ci' : 'primary',
  categoryLabel: '',
}));

const state = {
  ok: true,
  online: true,
  transport: 'push',
  mode: 'client',
  url: 'https://mail.lumenworks.example',
  badge: 'both',
  pid: 0,
  startedAt: minutesAgo(180),
  ts: new Date().toISOString(),
  lastEventAt: minutesAgo(0.2),
  lastRefreshAt: minutesAgo(0.2),
  eventSeq: 4821,
  features: ['events', 'idle'],
  error: '',
  idle: { enabled: true, connected: 4, total: 4 },
  unread: conversations.filter((c) => !c.isRead).length + 4,
  unanalyzed: conversations.filter((c) => !c.isAnalyzed).length + 9,
  inboxTotal: 148,
  starred: 2,
  drafts: 1,
  accounts: accounts.map((account) => ({ ...account, syncEnabled: true, lastSyncedAt: minutesAgo(1) })),
  conversations,
  demoThreads: Object.fromEntries(conversations.map((c) => [c.id, {
    ok: true,
    thread: { id: c.id, subject: c.subject, accountId: c.accountId },
    messages: Array.from({ length: Math.min(c.messageCount, 3) }, (_, i) => ({
      id: `${c.latestMessageId}-${i}`,
      from: i === Math.min(c.messageCount, 3) - 1 ? c.from : (i % 2 ? c.from : { name: 'Ada Quinn', email: byId[c.accountId].email }),
      to: [{ name: 'Ada Quinn', email: byId[c.accountId].email }],
      cc: [],
      subject: c.subject,
      sentAt: minutesAgo(Number(c.latestAt ? (Date.now() - Date.parse(c.latestAt)) / 60_000 : 0) + (Math.min(c.messageCount, 3) - 1 - i) * 95),
      isRead: c.isRead,
      isAnalyzed: c.isAnalyzed,
      analyzedBy: c.isAnalyzed ? 'triage-agent' : '',
      isSent: false,
      attachments: c.hasAttachments && i === Math.min(c.messageCount, 3) - 1 ? [{ filename: 'proofs-v3.pdf', size: 2_411_002 }] : [],
      text: i === Math.min(c.messageCount, 3) - 1
        ? `${c.snippet}\n\nThanks,\n${c.from.name.split(' ')[0]}`
        : i % 2
          ? `Following up on the earlier note — do you have a preference before I lock it in?\n\n${c.from.name.split(' ')[0]}`
          : 'Sounds good — sending the updated files this afternoon.\n\nAda',
    })),
  }])),
  seen: [],
};

ensureDir(STATE_DIR);
writeJsonAtomic(DEMO_FILE, state, 0o600);
console.log(`demo mode on: ${DEMO_FILE} (${conversations.length} fabricated conversations). Turn off with: node plugin/demo.mjs off`);
