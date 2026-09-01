# GigaMail

GigaMail is a self-hosted, Gmail-inspired inbox for multiple IMAP/SMTP accounts. It keeps mail credentials in your own Docker volume, combines conversations into threads, and treats remote message content as untrusted by default.

> GigaMail is an independent project. It is not affiliated with Google or Gmail.

## What it includes

- One unified inbox for up to 12 (or more) IMAP/SMTP accounts
- Guided Gmail, iCloud, Mail-in-a-Box, and custom IMAP/SMTP onboarding that checks both incoming and outgoing mail before saving
- Explainable smart views for GitHub/CI notifications, logs and alerts, and service-status updates
- Conversation threading from `Message-ID`, `In-Reply-To`, `References`, and a safe subject fallback
- Per-account identities, HTML or plain-text signatures, profile photos/initials, compose, reply, archive, trash, read and star actions
- Server-side IMAP syncing and SMTP sending; no browser-to-mail-provider credentials
- Remote images blocked by default. When enabled per message, they are fetched server-side through the privacy proxy, never by the browser.
- Sanitized HTML mail, no scripts/forms/iframes, and SSRF protections for remote-content fetching
- Encrypted stored account credentials (AES-256-GCM); an access token gate; passkey (WebAuthn) unlock; non-root Docker runtime
- Dark chrome UI, Gmail-style keyboard shortcuts, rich compose, recipient chips, compose attachments, on-demand attachment download, and Gmail-style search (FTS5 plus operators)

## Quick start

1. Copy `.env.example` to `.env` and generate strong values:

   ```sh
   cp .env.example .env
   openssl rand -base64 32 # paste as GIGAMAIL_ENCRYPTION_KEY
   openssl rand -hex 32    # paste as GIGAMAIL_ACCESS_TOKEN
   ```

2. Start the isolated, privacy-preserving stack:

   ```sh
   sh deploy/launch.sh
   ```

3. The default Compose mapping is deliberately loopback-only: `127.0.0.1:3080`. Open it through an SSH tunnel:

   ```sh
   ssh -L 3080:127.0.0.1:3080 mitsubishi@your-server
   ```

   Then visit `http://localhost:3080`. If a passkey is registered, use it to unlock; otherwise enter the access token, then add a passkey in **Settings**. Use **Settings → Add account** to connect mailboxes. The UI is designed for a unified inbox of roughly 12 accounts.

See [`deploy/README.md`](deploy/README.md) for deployment and backup details.

If you use Nginx Proxy Manager for a public HTTPS domain, set
`GIGAMAIL_BIND_ADDRESS` to the VM's specific private IP (such as
`10.0.0.15`), not `0.0.0.0`; terminate TLS and force HTTPS in the proxy. The
full reverse-proxy configuration is in [`deploy/README.md`](deploy/README.md).

## Account settings

Use **Settings → Add account**, select a provider, and enter the mailbox identity and provider-specific credential. GigaMail tests IMAP and SMTP in memory first; the account is persisted only after both checks succeed. Saved credentials are encrypted server-side and are never returned by the API.

- **Gmail / Google Workspace:** use the full email address and a Google app password. App passwords require 2-Step Verification and may be unavailable for some managed or Advanced Protection accounts.
- **iCloud Mail:** use an Apple app-specific password. GigaMail uses the mailbox name for IMAP and the full address for SMTP, matching Apple's client settings.
- **Mail-in-a-Box:** use the public hostname from the box's TLS certificate and the full mailbox address. This checkout includes a preset for `box.xer5.com` (IMAPS 993 and SMTP submission 587 with required STARTTLS); do not substitute its raw LAN IP because TLS hostname verification would fail.
- **Outlook / Microsoft 365:** use an app password. GigaMail does not use Microsoft OAuth.
- **Custom:** enter separate IMAP/SMTP hosts, ports, and TLS modes. Non-implicit-TLS connections require STARTTLS before authentication.

The setup API also exposes `GET /api/accounts/providers` for provider metadata and `POST /api/accounts/test` for a rate-limited, non-persisting connection check.

Per-account signatures accept **uploaded HTML**, **pasted HTML**, or **visual (WYSIWYG) editing** in Settings. Stored signatures are sanitized before save and send: scripts, event handlers, and CSS `url()` values are removed. Designed HTML signatures keep formatting, links, tables, and safe images; existing plain-text signatures still send as before.

## Passkeys and the access token

`GIGAMAIL_ACCESS_TOKEN` still gates the API. After a successful token unlock, **Settings → Passkeys** can register a discoverable WebAuthn credential for this inbox. Later visits can unlock with that passkey; the server sets the same `gigamail_session` cookie used by token login.

Production pins these to the public HTTPS site so passkeys work behind Nginx:

```sh
GIGAMAIL_RP_ID=mail.xer0.io
GIGAMAIL_ORIGIN=https://mail.xer0.io
```

Empty values still get that pin when `NODE_ENV=production`. Local development without those variables derives RP ID and origin from the request Host header.

## Keyboard shortcuts

Press `?` in the mailbox for the cheatsheet. The same Gmail-style keys work while a conversation is focused: `j` / `k` move, `Enter` opens, `u` returns to the list, `e` archives, `#` trashes, `r` replies, `s` stars, `x` selects, `/` focuses search, `c` composes.

## Attachments and search

Opening a message issues a short-lived signed URL for each attachment (`GET /api/content/attachment?token=`). Inbound bytes are fetched from IMAP on demand and are not stored as blobs. Inline `cid:` images in HTML are rewritten to the same endpoint. Compose can attach files (up to eight, 8 MiB combined); those bytes ride with the SMTP message and a local sent copy so they can be downloaded before the next IMAP sync.

Compose uses the same visual HTML editor as signatures (bold, lists, color, links, and images). Recipients are chips with autocomplete from people already in the mailbox. The paperclip still attaches files (up to eight, 8 MiB combined).

Mailbox search uses SQLite FTS5 over leftover free text (subject, snippet, sender, recipients, and plain text). Gmail-style operators are honored: `from:`, `to:`, `subject:`, `has:attachment`, `after:YYYY-MM-DD`, `before:YYYY-MM-DD`, `newer_than:7d`, `older_than:2w`, `is:unread`, `is:starred`, and `in:sent`. The tune control next to search writes those operators. Routine ops digests stay out of the default inbox, but search can still find them.

## Smart inbox views

Every synchronized message is classified locally into **Primary**, **GitHub & CI**, **Logs & alerts**, or **Status updates**. Classification is deterministic—no message content is sent to an external model—and every message includes a human-readable reason for its category. A conversation appears under the category of its latest message, while search can still find text in older messages without showing a stale conversation summary. Existing databases are backfilled automatically when the smart-filter rule version changes.

Use `GET /api/messages?category=github_ci` (or `primary`, `logs`, `status`) with the existing `folder`, `accountId`, and `q` parameters. Omitting `category` returns all messages, and the response includes zero-filled conversation `categoryCounts` for the current folder/account/search scope.

Most hosted providers have IMAP disabled by default or require an app password. GigaMail validates an account connection before saving it.

IMAP synchronization reads message metadata first and downloads raw message sources one at a time. `GIGAMAIL_SYNC_MAX_MESSAGE_BYTES` caps each raw RFC822 download (10 MiB by default; configurable from 64 KiB to 50 MiB). Messages above the cap are left on the mail server and reported as sanitized `IMAP_MESSAGE_TOO_LARGE` skips in the sync result, without downloading their body or attachments. Set the cap before an account's first sync: skipped UIDs are advanced so changing the cap later applies to future messages and does not backfill previously skipped mail.

## Privacy model

GigaMail blocks remote content until you explicitly choose to load it. The default launch script includes an outbound Tor/Privoxy path; the message HTML points only to a local GigaMail endpoint, which fetches approved `http(s)` media through that proxy. Known tracking pixels remain blocked even when ordinary images are loaded. URLs targeting loopback, private, link-local, multicast, and cloud-metadata address ranges are rejected. If the proxy is absent, remote content fails closed rather than falling back to the VM's direct network connection.

This protects your browser IP and stops open-tracking pixels by default. It does not make the mail provider, your VM, or an external proxy operator unaware of activity. Use a trustworthy network egress path and keep the host patched.

## Operations

- GigaMail only creates the `gigamail` Compose project, its own network, and named `gigamail-data` volume. It does not modify other Docker containers.
- Back up the `gigamail-data` volume and your `.env` file together. Losing the encryption key makes saved account credentials unrecoverable by design.
- While a mailbox tab is focused, GigaMail checks every connected inbox about every 15 seconds, and again immediately when the tab returns to the foreground. `SYNC_INTERVAL_MINUTES` (5 in `.env.example`) is the unattended fallback.
- Keep the service bound to localhost unless you put it behind TLS and an authentication-aware reverse proxy.
- Use `docker compose logs -f gigamail` to diagnose connections and `docker compose pull && docker compose up -d` to update images.

## MCP connector

GigaMail exposes a Cursor-compatible **Streamable HTTP** MCP endpoint on the same Express app as the REST API:

| | |
| --- | --- |
| URL | `https://<host>/mcp` (for example `https://mail.xer0.io/mcp`) |
| Transport | Streamable HTTP (`POST /mcp`) |
| Auth | Same gate as `/api`: `Authorization: Bearer <GIGAMAIL_ACCESS_TOKEN>` (or the existing `gigamail_session` cookie) |

Unauthenticated requests receive `401` with `AUTH_REQUIRED`. Tools call the same repositories and `mailService` as the REST API; stored IMAP/SMTP credentials are never returned.

### Cursor / remote MCP config

In Cursor: **Settings → Tools & Integrations → MCP**, or add to `~/.cursor/mcp.json` / `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "gigamail": {
      "url": "https://mail.xer0.io/mcp",
      "headers": {
        "Authorization": "Bearer ${env:GIGAMAIL_ACCESS_TOKEN}"
      }
    }
  }
}
```

Replace the URL with your deployment host. Prefer `${env:GIGAMAIL_ACCESS_TOKEN}` so the token is not committed.

### Tools

| Tool | Purpose |
| --- | --- |
| `list_accounts` | Connected accounts (id, email, provider, sync status) |
| `list_providers` | Provider presets / discovery for onboarding |
| `list_messages` | List/search conversations (`folder`, `accountId`, `category`, `q`, `page`, `pageSize`). `q` honors `from:`, `to:`, `subject:`, `has:attachment`, dates, `is:`, and `in:` |
| `get_message` / `get_thread` | Fetch one message or a full thread |
| `send_message` | Compose/send via SMTP |
| `message_action` | `read` / `unread` / `star` / `unstar` / `archive` / `unarchive` / `trash` / `untrash` / `spam` / `unspam` / `snooze` |
| `sync_mail` | Sync one account or all |
| `test_account` / `add_account` / `update_account` / `delete_account` | Account lifecycle (credentials accepted for connect/save only; never echoed) |

## Local development

```sh
npm install
npm run dev
```

The Vite UI runs on `http://localhost:5173` and binds to loopback only; API requests proxy to the loopback server at port 3000. Before submitting changes, run:

```sh
npm run check
npm test
```

## Status

This is a self-hosted mail client, not a mail server. It connects to existing mailboxes over IMAP/SMTP and does not accept inbound SMTP for your domains.
