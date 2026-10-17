# Upgrade the Omarchy plugin (0.2.0 → 0.3.0)

This is for every desktop that still runs the 0.2.0 bar plugin (`io.github.nova-centauri.amail`) against a shared aMail hub. Three hosts were observed in poll mode at `pollSeconds=10` / `syncSeconds=45`, overlapping `GET /api/accounts`, `GET /api/messages`, and `POST /api/sync` with `User-Agent: node`. That load is enough to pin the hub's CPU.

Do this on **each** of those desktops. Do not change the server for this upgrade; 0.3.0 is backward compatible with an old hub (no `/api/events`) and a new one (SSE + ETag + 429).

## 1. Update the plugin

```sh
# Omarchy-managed checkout
omarchy plugin update io.github.nova-centauri.amail

# or, if you track the git checkout yourself
cd ~/.config/omarchy/plugins/io.github.nova-centauri.amail
git fetch origin
git checkout <0.3.0-commit>
```

Confirm `manifest.json` says `"version": "0.3.0"`.

## 2. Leave the old poll/sync numbers alone

`~/.config/amail/plugin.json` may still contain:

```json
{
  "pollSeconds": 10,
  "syncSeconds": 45
}
```

You do not need to edit that. 0.3.0 clamps anything below 60s (poll) or 300s (sync) and writes a one-line warning to `~/.local/state/amail/daemon.log`:

```
pollSeconds=10 is below the 60s floor; clamping to 60s
syncSeconds=45 is below the 300s floor; clamping to 300s
```

Timer `POST /api/sync` is **off** unless you explicitly set `syncEnabled` true. Do not enable it on these hosts; the hub already syncs itself. A leftover `syncSeconds` key does not turn sync back on.

Optional cleanup after the daemon has been restarted:

```sh
amail-plugin set pollSeconds 60
# leave syncEnabled unset / false
```

## 3. Restart the daemon

The bar widget owns the daemon. Restart the Omarchy shell (or log out/in) so `plugin/daemon.mjs` is re-executed. Middle-click refresh is not enough; that only pokes the old process.

## 4. Check each host

```sh
amail-plugin state | jq '{transport, online, error, userAgent, unread, unanalyzed}'
tail -n 30 ~/.local/state/amail/daemon.log
```

Expect:

| Hub | `transport` | Traffic |
| --- | --- | --- |
| Old server (health has no `features.events`) | `poll` | One serialized `GET /api/messages?folder=inbox&pageSize=5` about every 60s, with `If-None-Match` once an ETag exists. No timer `POST /api/sync`. |
| New server (`GET /api/health` → `"features": ["events"]`) | `push` | Unauthenticated health discovery, then one long-lived `GET /api/events` (Bearer + `Last-Event-ID` on reconnect). Refetch on `hello.gap`, `change-version`, `new-mail` / `message.new`, `sync-status` / `sync.mailbox`, `account.updated`. Quiet-timeout from `hello.heartbeatMs`. Reconnects 2s→60s. |

On every host the `User-Agent` should look like `amail-omarchy/0.3.0 (<hostname>)` so hub logs can tell the desktops apart.

If `transport` is `reauth`, the token was rejected (`401`/`403`). The daemon has **stopped**. Re-run `amail-plugin connect <url>`; it will not hammer the hub.

## 5. Do not go back to 0.2.0 defaults

These settings are hostile to a shared hub and will be clamped if someone pastes them back in:

```json
{
  "pollSeconds": 10,
  "syncSeconds": 45,
  "syncEnabled": true
}
```
