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

if [ "$mode" = privacy ]; then
  # Shell-scoped so a normal direct launch cannot accidentally retain a proxy
  # setting for a stopped Tor container.
  REMOTE_CONTENT_PROXY_URL=http://tor-proxy:8118 \
    docker compose --env-file .env --profile privacy up --detach --build
else
  # This intentionally runs no proxy. In production GigaMail keeps remote
  # content blocked rather than bypassing privacy controls with direct egress.
  REMOTE_CONTENT_PROXY_URL= \
    docker compose --env-file .env up --detach --build
fi
