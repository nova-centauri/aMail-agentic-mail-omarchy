# Changelog

## 0.3.0 — 2026-10-17

Gentle client for shared aMail hubs. The 0.2.0 daemon could pin a self-hosted server at 100% CPU: three (or more) desktops polling every 10s, syncing every 45s, overlapping `GET /api/accounts`, a ~3s `GET /api/messages`, and `POST /api/sync`, all as `User-Agent: node`.

### Plugin daemon

- **Floors:** `pollSeconds` defaults to 60 and never runs faster; `syncSeconds` defaults to 300. Values below the floor are clamped and logged.
- **No overlap:** the REST client serializes requests so a host has at most one in flight.
- **Prefer events:** unauthenticated `GET /api/health` is the discovery signal (`features` includes `events`). Then hold `GET /api/events` (Bearer + `Accept: text/event-stream` + optional `Last-Event-ID`). Reconnect 2s→60s. Fall back to slow polling only when health has no `events` or `/api/events` returns 404.
- **SSE contract (aMail PR #29):** quiet-timeout from `hello.heartbeatMs` (`max(30s, heartbeatMs * 3)`); `: heartbeat` comments reset to 60s; named events reset to 75s. Refetch on `hello.gap`, `change-version`, `new-mail` / `message.new`, `sync-status` / `sync.mailbox`, `account.updated`. `401 AUTH_REQUIRED` stops the loop.
- **No timer sync:** `POST /api/sync` is off unless `syncEnabled` is set. The server syncs itself.
- **Backoff:** errors and timeouts back off; `429` honours `Retry-After`.
- **Re-auth:** `401`/`403` stop the loop and surface a re-authenticate state on the bar instead of retrying.
- **Conditional list:** `If-None-Match` / `ETag` on `GET /api/messages`; `304` keeps the last badge.
- **Small badge query:** timer polls use `pageSize=5` (folder counts + a few threads), not the full inbox.
- **User-Agent:** `amail-omarchy/<version> (<hostname>)`.

### Dependencies

- `undici` 8.10.0 → 8.12.2 (GHSA-3wwx-pv8p-q78v and later 8.x DoS fixes). Cheerio’s nested 7.x copy is overridden to 7.30.1.
- Production `npm audit --audit-level=high` also required patched `nodemailer` 10.1.2, `@modelcontextprotocol/sdk` 1.32.1, `proxy-addr` 2.0.8, and `source-map-js` 1.2.2.

### Upgrade

Hosts still running 0.2.0 with `pollSeconds=10` / `syncSeconds=45` should update and restart the shell. Steps: [`docs/upgrade-omarchy-plugin.md`](docs/upgrade-omarchy-plugin.md).
