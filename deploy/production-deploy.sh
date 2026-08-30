#!/bin/sh
set -eu

usage() {
  echo "Usage: sh deploy/production-deploy.sh COMMIT [REPOSITORY] [privacy|direct] [SOURCE_REPOSITORY]" >&2
  exit 64
}

target=${1:-}
repo_dir=${2:-/home/mitsubishi/apps/GigaMail}
mode=${3:-privacy}
source_repo=${4:-${GITHUB_WORKSPACE:-}}

if ! printf '%s\n' "$target" | grep -Eq '^[0-9a-fA-F]{40}$'; then
  usage
fi

case "$mode" in
  direct|privacy) ;;
  *) usage ;;
esac

if ! command -v flock >/dev/null 2>&1; then
  echo "flock is required to serialize production deployments." >&2
  exit 1
fi

# A stable lock outside the checkout also covers one-time checkout recovery.
# The workflow holds descriptor 8 before it invokes this script; manual runs
# acquire the same lock here.
if [ "${GIGAMAIL_DEPLOY_LOCK_HELD:-0}" = "1" ]; then
  if ! flock -n 8; then
    echo "The inherited production deployment lock is not held." >&2
    exit 1
  fi
else
  exec 8>"$HOME/.gigamail-production-deploy.lock"
  if ! flock -w 600 8; then
    echo "Timed out waiting for the production deployment lock." >&2
    exit 1
  fi
fi

if [ ! -d "$repo_dir/.git" ]; then
  echo "Production repository not found at $repo_dir." >&2
  exit 1
fi

cd "$repo_dir"

# GitHub concurrency serializes workflow runs. This host lock also protects
# against a deployment started manually or by another runner process.
exec 9>"$repo_dir/.git/gigamail-deploy.lock"
if ! flock -w 600 9; then
  echo "Timed out waiting for the production deployment lock." >&2
  exit 1
fi

if [ ! -f .env ]; then
  echo "Missing protected production configuration: $repo_dir/.env" >&2
  exit 1
fi

env_mode=$(stat -c '%a' .env 2>/dev/null || stat -f '%Lp' .env 2>/dev/null || true)
if [ "$env_mode" != "600" ]; then
  echo "Refusing to deploy: $repo_dir/.env must have mode 600 (found ${env_mode:-unknown})." >&2
  exit 1
fi

if [ -n "$(git status --porcelain --untracked-files=all)" ]; then
  echo "Refusing to overwrite changes or untracked files in the production checkout." >&2
  exit 1
fi

for command in git docker; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "$command is required for production deployment." >&2
    exit 1
  fi
done

compose_version=$(docker compose version --short 2>/dev/null || true)
compose_version=${compose_version#v}
compose_major=$(printf '%s\n' "$compose_version" | awk -F. '{ print $1 }')
compose_minor=$(printf '%s\n' "$compose_version" | awk -F. '{ print $2 }')
compose_patch=$(printf '%s\n' "$compose_version" | awk -F. '{ value=$3; sub(/[^0-9].*$/, "", value); print value }')
case "$compose_major.$compose_minor.$compose_patch" in
  *[!0-9.]*|.*|*.|*..*) compose_supported=0 ;;
  *)
    if [ "$compose_major" -gt 2 ] \
      || { [ "$compose_major" -eq 2 ] && [ "$compose_minor" -gt 33 ]; } \
      || { [ "$compose_major" -eq 2 ] && [ "$compose_minor" -eq 33 ] && [ "$compose_patch" -ge 1 ]; }; then
      compose_supported=1
    else
      compose_supported=0
    fi
    ;;
esac
if [ "$compose_supported" -ne 1 ]; then
  echo "Docker Compose 2.33.1 or newer is required for deterministic gateway priority (found ${compose_version:-unknown})." >&2
  exit 1
fi

current_head=$(git rev-parse --verify HEAD)
previous=$current_head
if [ -f .git/gigamail-last-successful-sha ]; then
  recorded_previous=$(sed -n '1p' .git/gigamail-last-successful-sha)
  if ! printf '%s\n' "$recorded_previous" | grep -Eq '^[0-9a-fA-F]{40}$' \
    || ! git cat-file -e "$recorded_previous^{commit}" 2>/dev/null; then
    echo "The recorded last successful release is invalid; refusing an unsafe rollback target." >&2
    exit 1
  fi
  previous=$(git rev-parse --verify "$recorded_previous^{commit}")
fi

if [ -n "$source_repo" ]; then
  if [ ! -d "$source_repo/.git" ]; then
    echo "Tested source repository not found at $source_repo." >&2
    exit 1
  fi
  source_commit=$(git -C "$source_repo" rev-parse --verify HEAD)
  if [ "$source_commit" != "$(printf '%s' "$target" | tr 'A-F' 'a-f')" ]; then
    echo "Tested source HEAD $source_commit does not match requested release $target." >&2
    exit 1
  fi
  # Fetch from the already authenticated Actions checkout. This keeps the
  # persistent production clone free of long-lived private-repository tokens.
  git fetch --no-tags "$source_repo" HEAD
  target_commit=$(git rev-parse --verify FETCH_HEAD)
  remote_main=$source_commit
else
  # Manual fallback for an operator whose production clone already has
  # read-only origin credentials configured.
  git fetch --prune origin '+refs/heads/main:refs/remotes/origin/main'
  target_commit=$(git rev-parse --verify "$target^{commit}")
  remote_main=$(git rev-parse --verify refs/remotes/origin/main)
fi

# A manual run can become stale when a newer main commit arrives. The Actions
# path is main-push-only and serialized, and uses the exact tested workspace.
if [ "$target_commit" != "$remote_main" ]; then
  echo "Skipping superseded commit $target_commit; origin/main is $remote_main."
  exit 0
fi

compose() {
  if [ "$mode" = "privacy" ]; then
    docker compose --env-file .env --profile privacy "$@"
  else
    docker compose --env-file .env "$@"
  fi
}

backup_database() {
  container_id=$(compose ps --all -q gigamail 2>/dev/null || true)
  if [ -z "$container_id" ]; then
    echo "No existing GigaMail container; skipping the pre-deploy database backup."
    return
  fi
  if [ "$(docker inspect --format '{{.State.Running}}' "$container_id" 2>/dev/null || true)" != "true" ]; then
    echo "Existing GigaMail container is stopped; refusing to deploy without a database backup." >&2
    return 1
  fi

  backup_label="predeploy-$(date -u +%Y%m%dT%H%M%SZ)-$(printf '%.12s' "$previous")"
  echo "Creating SQLite backup $backup_label."
  compose exec -T -e "GIGAMAIL_BACKUP_LABEL=$backup_label" gigamail node --input-type=module - <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const source = '/data/gigamail.sqlite';
if (!fs.existsSync(source)) process.exit(0);

const directory = '/data/deploy-backups';
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
const destination = path.join(directory, `${process.env.GIGAMAIL_BACKUP_LABEL}.sqlite`);
const database = new Database(source, { readonly: true, fileMustExist: true });
await database.backup(destination);
database.close();

const backups = fs.readdirSync(directory)
  .filter((name) => /^predeploy-.*\.sqlite$/.test(name))
  .map((name) => ({ name, modifiedAt: fs.statSync(path.join(directory, name)).mtimeMs }))
  .sort((left, right) => right.modifiedAt - left.modifiedAt);
for (const oldBackup of backups.slice(5)) fs.rmSync(path.join(directory, oldBackup.name));
NODE
}

services_healthy() {
  app_id=$(compose ps -q gigamail 2>/dev/null || true)
  [ -n "$app_id" ] || return 1
  [ "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$app_id" 2>/dev/null || true)" = "healthy" ] || return 1

  if [ "$mode" = "privacy" ]; then
    tor_id=$(compose ps -q tor-proxy 2>/dev/null || true)
    [ -n "$tor_id" ] || return 1
    [ "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$tor_id" 2>/dev/null || true)" = "healthy" ] || return 1
  fi

  compose exec -T \
    -e "GIGAMAIL_EXPECT_PRIVACY=$mode" \
    -e "GIGAMAIL_EXPECT_RELEASE=$expected_release" \
    -e "GIGAMAIL_REQUIRE_RELEASE=$require_release" \
    gigamail node -e \
    "fetch('http://127.0.0.1:3000/api/health').then(async (response) => { const body = await response.json(); const privacyOk = process.env.GIGAMAIL_EXPECT_PRIVACY !== 'privacy' || body.remoteContentProxyConfigured === true; const releaseOk = process.env.GIGAMAIL_REQUIRE_RELEASE !== '1' || body.releaseSha === process.env.GIGAMAIL_EXPECT_RELEASE; process.exit(response.ok && body.status === 'ok' && body.authProtected === true && body.credentialsConfigured === true && privacyOk && releaseOk ? 0 : 1); }).catch(() => process.exit(1))" \
    >/dev/null 2>&1
}

wait_for_health() {
  attempts=0
  while [ "$attempts" -lt 120 ]; do
    if services_healthy; then
      return 0
    fi
    attempts=$((attempts + 1))
    sleep 5
  done
  return 1
}

report_health_diagnostics() {
  echo "Production service health diagnostics:" >&2

  app_id=$(compose ps -q gigamail 2>/dev/null || true)
  if [ -n "$app_id" ]; then
    docker inspect \
      --format 'gigamail: status={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} restarts={{.RestartCount}}' \
      "$app_id" >&2 || true
    echo "Recent GigaMail logs:" >&2
    compose logs --no-color --tail 200 gigamail >&2 || true
  else
    echo "gigamail: container not found" >&2
  fi

  if [ "$mode" = "privacy" ]; then
    tor_id=$(compose ps -q tor-proxy 2>/dev/null || true)
    if [ -n "$tor_id" ]; then
      docker inspect \
        --format 'tor-proxy: status={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} restarts={{.RestartCount}}' \
        "$tor_id" >&2 || true
      docker inspect \
        --format '{{if .State.Health}}{{range .State.Health.Log}}tor-health: exit={{.ExitCode}} output={{json .Output}}{{println}}{{end}}{{end}}' \
        "$tor_id" >&2 || true
      echo "Recent Tor/Privoxy logs:" >&2
      compose logs --no-color --tail 200 tor-proxy >&2 || true
    else
      echo "tor-proxy: container not found" >&2
    fi
  fi
}

restore_bootstrap_images() {
  marker=.git/gigamail-bootstrap-images
  [ ! -f .git/gigamail-last-successful-sha ] || return 1
  [ -f "$marker" ] || return 1

  for key in app_saved app_runtime tor_saved tor_runtime; do
    count=$(awk -F= -v key="$key" '$1 == key { count += 1 } END { print count + 0 }' "$marker")
    [ "$count" -eq 1 ] || return 1
  done
  app_saved=$(awk -F= '$1 == "app_saved" { print substr($0, length($1) + 2); exit }' "$marker")
  app_runtime=$(awk -F= '$1 == "app_runtime" { print substr($0, length($1) + 2); exit }' "$marker")
  tor_saved=$(awk -F= '$1 == "tor_saved" { print substr($0, length($1) + 2); exit }' "$marker")
  tor_runtime=$(awk -F= '$1 == "tor_runtime" { print substr($0, length($1) + 2); exit }' "$marker")
  for image_reference in "$app_saved" "$app_runtime" "$tor_saved" "$tor_runtime"; do
    case "$image_reference" in
      ''|*@*|*[!a-z0-9._/:-]*) return 1 ;;
    esac
  done

  docker image inspect "$app_saved" "$tor_saved" >/dev/null 2>&1 || return 1
  docker image tag "$app_saved" "$app_runtime" || return 1
  docker image tag "$tor_saved" "$tor_runtime" || return 1

  echo "Restoring the exact pre-CI application and privacy images."
  if [ "$mode" = "privacy" ]; then
    REMOTE_CONTENT_PROXY_URL=http://tor-proxy:8118 \
      docker compose --env-file .env --profile privacy up \
        --detach --no-build --force-recreate
  else
    REMOTE_CONTENT_PROXY_URL= \
      docker compose --env-file .env up \
        --detach --no-build --force-recreate
  fi
}

deployment_started=0
expected_release=$target_commit
require_release=1
rollback() {
  echo "Deployment failed; restoring code and containers from $previous." >&2
  git checkout --detach "$previous"
  expected_release=$previous
  if restore_bootstrap_images; then
    # The release preceding this CI/CD change does not expose a release SHA.
    # Keep rollback compatible while retaining every other security gate.
    require_release=0
  else
    GIGAMAIL_RELEASE_SHA="$previous" GIGAMAIL_FORCE_RECREATE=1 sh deploy/launch.sh "$mode"
  fi
  if wait_for_health; then
    echo "Rollback to $previous is healthy." >&2
  else
    report_health_diagnostics
    echo "CRITICAL: rollback containers did not become healthy; inspect Docker on the VM." >&2
  fi
}

on_exit() {
  status=$?
  trap - EXIT HUP INT TERM
  if [ "$status" -ne 0 ] && [ "$deployment_started" -eq 1 ]; then
    rollback || true
  fi
  exit "$status"
}
trap on_exit EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

recreate_tor=0
if [ "$mode" = "privacy" ]; then
  tor_id=$(compose ps -q tor-proxy 2>/dev/null || true)
  if [ -n "$tor_id" ]; then
    tor_health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$tor_id" 2>/dev/null || true)
    if [ "$tor_health" = "healthy" ]; then
      echo "Tor/Privoxy is already healthy; recreating only GigaMail."
    else
      echo "Tor/Privoxy is ${tor_health:-unknown}; recreating it with GigaMail."
      recreate_tor=1
    fi
  else
    echo "No running Tor/Privoxy container; it will be created with GigaMail."
    recreate_tor=1
  fi
fi

backup_database
git checkout --detach "$target_commit"
deployment_started=1

echo "Recreating GigaMail from $target_commit."
GIGAMAIL_RELEASE_SHA="$target_commit" \
  GIGAMAIL_FORCE_RECREATE=1 \
  GIGAMAIL_RECREATE_TOR="$recreate_tor" \
  sh deploy/launch.sh "$mode"

if ! wait_for_health; then
  echo "The recreated services did not become healthy within ten minutes." >&2
  compose ps >&2 || true
  report_health_diagnostics
  exit 1
fi

printf '%s\n' "$target_commit" > .git/gigamail-last-successful-sha
deployment_started=0
trap - EXIT HUP INT TERM
echo "GigaMail deployment $target_commit is healthy."
