#!/bin/sh
set -eu

usage() {
  echo "Usage: sh deploy/launch.sh [privacy|direct]" >&2
  exit 64
}

mode=${1:-privacy}
case "$mode" in
  direct|privacy) ;;
  *) usage ;;
esac

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_dir"

if [ ! -f .env ]; then
  echo "Missing .env. Copy .env.example to .env, then replace both required secrets." >&2
  exit 1
fi

# Do not silently launch with the illustrative values shipped in .env.example.
# Parsing only the individual KEY=value lines avoids executing an operator's
# configuration file as shell code.
require_secret() {
  key=$1
  count=$(awk -v key="$key" 'index($0, key "=") == 1 { count += 1 } END { print count + 0 }' .env)
  if [ "$count" -ne 1 ]; then
    echo "$key must appear exactly once in .env (found $count declarations)." >&2
    exit 1
  fi
  value=$(awk -v key="$key" 'index($0, key "=") == 1 { print substr($0, length(key) + 2); exit }' .env)
  case "$value" in
    ''|replace-with-*|changeme*|change-me*|example*|"\"replace-with-"*|"'replace-with-"*)
      echo "$key must be replaced with a high-entropy secret in .env before launch." >&2
      exit 1
      ;;
  esac
  if [ "${#value}" -lt 32 ]; then
    echo "$key must be at least 32 characters long in .env before launch." >&2
    exit 1
  fi
}

require_secret GIGAMAIL_ENCRYPTION_KEY
require_secret GIGAMAIL_ACCESS_TOKEN

# `config --quiet` renders the exact project first. It does not create,
# remove, or restart containers, volumes, networks, or images.
docker compose --env-file .env config --quiet

compose_privacy() {
  # Shell-scoped so a normal direct launch cannot accidentally retain a proxy
  # setting for a stopped Tor container.
  REMOTE_CONTENT_PROXY_URL=http://tor-proxy:8118 \
    docker compose --env-file .env --profile privacy "$@"
}

if [ "$mode" = privacy ]; then
  if [ "${GIGAMAIL_FORCE_RECREATE:-0}" = "1" ]; then
    # Recreating Tor on every app release throws away a working circuit. A cold
    # bootstrap often stalls at 5% ("Connecting to a relay") past the deploy
    # health window. Keep the relay unless an explicit recreate is requested.
    if [ "${GIGAMAIL_RECREATE_TOR:-0}" = "1" ]; then
      compose_privacy up --detach --build --force-recreate
    else
      compose_privacy up --detach --build tor-proxy
      compose_privacy up --detach --build --force-recreate --no-deps gigamail
    fi
  else
    compose_privacy up --detach --build
  fi
else
  # This intentionally runs no proxy. In production GigaMail keeps remote
  # content blocked rather than bypassing privacy controls with direct egress.
  if [ "${GIGAMAIL_FORCE_RECREATE:-0}" = "1" ]; then
    REMOTE_CONTENT_PROXY_URL= \
      docker compose --env-file .env up --detach --build --force-recreate
  else
    REMOTE_CONTENT_PROXY_URL= \
      docker compose --env-file .env up --detach --build
  fi
fi
