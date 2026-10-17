# Changelog

## 0.3.0 — 2026-10-17

Gentle client for shared aMail hubs. The 0.2.0 daemon could pin a self-hosted server at 100% CPU: three (or more) desktops polling every 10s, syncing every 45s, overlapping `GET /api/accounts`, a ~3s `GET /api/messages`, and `POST /api/sync`, all as `User-Agent: node`.

### Plugin daemon

- **Floors:** `pollSeconds` defaults to 60 and never runs faster; `syncSeconds` defaults to 300. Values below the floor are clamped and logged.
- **No overlap:** the REST client serializes requests so a host has at most one in flight.
- **Prefer events:** try `GET /api/events` first, reconnect with jittered exponential backoff, and fall back to slow polling only on 404.
- **No timer sync:** `POST /api/sync` is off unless `syncEnabled` is set. The server syncs itself.
- **Backoff:** errors and timeouts back off; `429` honours `Retry-After`.
- **Re-auth:** `401`/`403` stop the loop and surface a re-authenticate state on the bar instead of retrying.
- **Conditional list:** `If-None-Match` / `ETag` on `GET /api/messages`; `304` keeps the last badge.
- **Small badge query:** timer polls use `pageSize=5` (folder counts + a few threads), not the full inbox.
- **User-Agent:** `amail-omarchy/<version> (<hostname>)`.

### Upgrade

Hosts still running 0.2.0 with `pollSeconds=10` / `syncSeconds=45` should update and restart the shell. Steps: [`docs/upgrade-omarchy-plugin.md`](docs/upgrade-omarchy-plugin.md).
