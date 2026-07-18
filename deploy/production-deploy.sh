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

if [ ! -d "$repo_dir/.git" ]; then
  echo "Production repository not found at $repo_dir." >&2
  exit 1
fi

if ! command -v flock >/dev/null 2>&1; then
  echo "flock is required to serialize production deployments." >&2
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

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is required for production deployment." >&2
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
  while [ "$attempts" -lt 60 ]; do
    if services_healthy; then
      return 0
    fi
    attempts=$((attempts + 1))
    sleep 5
  done
  return 1
}

deployment_started=0
expected_release=$target_commit
require_release=1
rollback() {
  echo "Deployment failed; restoring code and containers from $previous." >&2
  git checkout --detach "$previous"
  expected_release=$previous
  # The release preceding this CI/CD change does not expose a release SHA.
  # Keep rollback compatible while retaining every other security health gate.
  require_release=0
  GIGAMAIL_RELEASE_SHA="$previous" GIGAMAIL_FORCE_RECREATE=1 sh deploy/launch.sh "$mode"
  if wait_for_health; then
    echo "Rollback to $previous is healthy." >&2
  else
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

backup_database
git checkout --detach "$target_commit"
deployment_started=1

echo "Recreating GigaMail from $target_commit."
GIGAMAIL_RELEASE_SHA="$target_commit" GIGAMAIL_FORCE_RECREATE=1 sh deploy/launch.sh "$mode"

if ! wait_for_health; then
  echo "The recreated services did not become healthy within five minutes." >&2
  compose ps >&2 || true
  exit 1
fi

printf '%s\n' "$target_commit" > .git/gigamail-last-successful-sha
deployment_started=0
trap - EXIT HUP INT TERM
echo "GigaMail deployment $target_commit is healthy."
