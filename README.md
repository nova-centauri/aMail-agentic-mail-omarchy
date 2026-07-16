# GigaMail

GigaMail is a self-hosted, Gmail-inspired inbox for multiple IMAP/SMTP accounts. It keeps mail credentials in your own Docker volume, combines conversations into threads, and treats remote message content as untrusted by default.

> GigaMail is an independent project. It is not affiliated with Google or Gmail.

## What it includes

- One unified inbox for up to 12 (or more) IMAP/SMTP accounts
- Conversation threading from `Message-ID`, `In-Reply-To`, `References`, and a safe subject fallback
- Per-account identities, signatures, profile photos/initials, compose, reply, archive, trash, read and star actions
- Server-side IMAP syncing and SMTP sending; no browser-to-mail-provider credentials
- Remote images blocked by default. When enabled per message, they are fetched server-side through the privacy proxy, never by the browser.
- Sanitized HTML mail, no scripts/forms/iframes, and SSRF protections for remote-content fetching
- Encrypted stored account credentials (AES-256-GCM); an access token gate; non-root Docker runtime

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

   Then visit `http://localhost:3080`, enter the access token, and use **Settings → Add account**. The UI is designed for a unified inbox of roughly 12 accounts.

See [`deploy/README.md`](deploy/README.md) for deployment and backup details.

If you use Nginx Proxy Manager for a public HTTPS domain, set
`GIGAMAIL_BIND_ADDRESS` to the VM's specific private IP (such as
`10.0.0.15`), not `0.0.0.0`; terminate TLS and force HTTPS in the proxy. The
full reverse-proxy configuration is in [`deploy/README.md`](deploy/README.md).

## Account settings

For each account, enter its email address, display name, IMAP host/port/security, SMTP host/port/security, username, and provider-specific app password or OAuth credentials where supported by your provider. Do not use an ordinary account password when your provider offers an app password.

Most hosted providers have IMAP disabled by default or require an app password. GigaMail validates an account connection before saving it.

## Privacy model

GigaMail blocks remote content until you explicitly choose to load it. The default launch script includes an outbound Tor/Privoxy path; the message HTML points only to a local GigaMail endpoint, which fetches approved `http(s)` media through that proxy. Known tracking pixels remain blocked even when ordinary images are loaded. URLs targeting loopback, private, link-local, multicast, and cloud-metadata address ranges are rejected. If the proxy is absent, remote content fails closed rather than falling back to the VM's direct network connection.

This protects your browser IP and stops open-tracking pixels by default. It does not make the mail provider, your VM, or an external proxy operator unaware of activity. Use a trustworthy network egress path and keep the host patched.

## Operations

- GigaMail only creates the `gigamail` Compose project, its own network, and named `gigamail-data` volume. It does not modify other Docker containers.
- Back up the `gigamail-data` volume and your `.env` file together. Losing the encryption key makes saved account credentials unrecoverable by design.
- Keep the service bound to localhost unless you put it behind TLS and an authentication-aware reverse proxy.
- Use `docker compose logs -f gigamail` to diagnose connections and `docker compose pull && docker compose up -d` to update images.

## Local development

```sh
npm install
npm run dev
```

The Vite UI runs on `http://localhost:5173`; API requests proxy to the server at port 3000. Before submitting changes, run:

```sh
npm run check
npm test
```

## Status

This is a self-hosted mail client, not a mail server. It connects to existing mailboxes over IMAP/SMTP and does not accept inbound SMTP for your domains.
