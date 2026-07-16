# GigaMail Docker deployment

This Compose bundle is isolated from other Docker workloads: it uses its own
project-scoped containers, networks, and named volumes, never mounts the
Docker socket, and never uses `down`, `prune`, or `--remove-orphans` in its
launch helper. It cannot guarantee that an administrator with Docker access
will never affect another container, but its normal operations are scoped to
this project.

## First launch

On the VM, place this repository in a directory owned by the deployment user,
then create the private runtime configuration:

```sh
cd /path/to/GigaMail
cp .env.example .env
chmod 600 .env
openssl rand -hex 32
```

Put a distinct generated value into each of `GIGAMAIL_ENCRYPTION_KEY` and
`GIGAMAIL_ACCESS_TOKEN`. The encryption key protects the saved email-account
credentials in the SQLite database. Losing it makes those credentials
unreadable; expose it only through the protected `.env` file or an equivalent
secret manager.

Start the privacy-preserving configuration (the recommended default):

```sh
sh deploy/launch.sh
docker compose ps
```

The first command validates the resolved Compose configuration and then builds
and starts only GigaMail plus its internal Tor/Privoxy proxy. Application data lives in the named
`gigamail-data` volume (prefixed by `COMPOSE_PROJECT_NAME`) rather than in the
repository or any host bind mount.

The supplied `.env.example` polls enabled accounts every five minutes without
keeping twelve long-lived IMAP IDLE sockets open. Set `SYNC_INTERVAL_MINUTES=0`
only if you prefer manual refreshes.

On its first pass, GigaMail imports the newest `GIGAMAIL_SYNC_BATCH_SIZE`
messages from each supported folder (200 by default). This is a recent-mail
client rather than a full historical migration tool; increase the value (up to
1000) before connecting an account if you need a larger initial window.

## Access without opening a VM port

By default GigaMail binds to `127.0.0.1:3080` on the VM, not the LAN or
internet. From the workstation, create a tunnel:

```sh
ssh -N -L 3080:127.0.0.1:3080 mitsubishi@10.0.0.15
```

Then open `http://127.0.0.1:3080` locally and authenticate using
`GIGAMAIL_ACCESS_TOKEN`. Keep that token secret: this application has access
to stored mail-provider credentials. The UI keeps the token only for the
current browser session and sends it as a Bearer token, so the secure cookie
setting can remain enabled even when the SSH tunnel itself uses local HTTP.

For a reverse proxy, leave the GigaMail port loopback-only and run the proxy
as a separately authenticated, TLS-terminating service on the same host.
Only set `GIGAMAIL_TRUST_PROXY=true` when that proxy is local and strips any
client-supplied forwarding headers; do not publish GigaMail directly.

## Nginx Proxy Manager

For a domain served by an existing Nginx Proxy Manager instance, set the
application to listen only on the VM's private address, then restart the
GigaMail project:

```sh
# .env
GIGAMAIL_BIND_ADDRESS=10.0.0.15
GIGAMAIL_PORT=3080
```

In Nginx Proxy Manager, use `http` as the upstream scheme with
`10.0.0.15` and port `3080`. Configure the public host (for example
`mail.xer0.io`) with a valid TLS certificate and force HTTPS before sending
traffic upstream. Do not make a public HTTP-only route. Keep
`GIGAMAIL_ACCESS_TOKEN` set: it is the application-level gate for every
mailbox API request. An NPM access list is a useful additional layer.

`GIGAMAIL_TRUST_PROXY` can remain `false` for this configuration because
GigaMail uses Bearer-token authentication and does not need forwarded client
addresses. If the proxy is on another LAN host, any LAN device able to reach
`10.0.0.15:3080` can reach the login screen; it still cannot read mail without
the high-entropy GigaMail access token.

## Optional Tor/Privoxy remote-content path

The default `deploy/launch.sh` mode routes remote content through an internal
Tor/Privoxy service. GigaMail fetches sanitized remote content server-side, so
a sender does not learn the browser's IP address or the VM's public IP. To
start that configuration explicitly:

```sh
sh deploy/launch.sh privacy
docker compose --profile privacy ps
```

This starts `tor-proxy` and passes
`REMOTE_CONTENT_PROXY_URL=http://tor-proxy:8118` only to that launch. Neither
its SOCKS nor HTTP proxy port is published to the Docker host. GigaMail can
reach Privoxy over an internal network; Tor alone has a separate egress
network. If the proxy is unavailable, remote-content requests fail closed
rather than silently going direct.

Tor is a privacy aid, not a complete anonymity system. It does not anonymize
IMAP/SMTP traffic, and remote images can still reveal message-specific data
once explicitly loaded. Keep tracker blocking enabled, avoid opening unknown
content unnecessarily, and expect some image hosts to reject Tor exits.

If you run `sh deploy/launch.sh direct`, GigaMail starts without Tor/Privoxy,
but production builds keep remote content blocked. They do **not** fall back to
direct remote fetching, so a stopped or omitted proxy cannot accidentally
expose the VM's public IP. Direct mode is useful when you want mail access
while keeping external message content disabled.

## Routine operations

```sh
docker compose logs --follow gigamail
docker compose ps
docker compose exec gigamail node -e "fetch('http://127.0.0.1:3000/api/health').then(r => r.text()).then(console.log)"
```

To update, pull or copy the new source, review `.env` changes, then rerun the
same `deploy/launch.sh` command. Do not delete the `gigamail-data` volume
unless intentionally discarding all accounts, cached mail metadata, and
settings.
