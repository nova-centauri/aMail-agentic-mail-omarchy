#!/usr/bin/env bash
set -euo pipefail

source_repo=${1:-}
configured_repo=${2:-}
expected_origin=https://github.com/nova-centauri/GigaMail.git

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

if [ -z "$source_repo" ] || [ ! -d "$source_repo/.git" ]; then
  fail "The tested Actions checkout is required to prepare production."
fi

source_repo=$(realpath -e "$source_repo")
source_head=$(git -C "$source_repo" rev-parse --verify HEAD)
runner_home=$(realpath -e "$HOME")
actions_work_root=$(realpath -e "$source_repo/../..")
runner_uid=$(id -u)

case "$source_repo" in
  *$'\n'*|*$'\r'*) fail "Repository paths must not contain line breaks." ;;
esac

is_expected_origin() {
  case "$1" in
    https://github.com/nova-centauri/GigaMail|https://github.com/nova-centauri/GigaMail.git|git@github.com:nova-centauri/GigaMail|git@github.com:nova-centauri/GigaMail.git|ssh://git@github.com/nova-centauri/GigaMail|ssh://git@github.com/nova-centauri/GigaMail.git)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

is_runner_owned() {
  [ "$(stat -c '%u' "$1" 2>/dev/null || true)" = "$runner_uid" ]
}

validated_repository() {
  local candidate repository top_level origin env_mode
  candidate=$1
  repository=$(realpath -e "$candidate" 2>/dev/null) || return 1

  case "$repository" in
    *$'\n'*|*$'\r'*|"$source_repo"|"$source_repo"/*|"$actions_work_root"|"$actions_work_root"/*)
      return 1
      ;;
  esac

  [ -d "$repository/.git" ] && [ ! -L "$repository/.git" ] || return 1
  [ -f "$repository/.env" ] && [ ! -L "$repository/.env" ] || return 1
  [ -f "$repository/docker-compose.yml" ] || return 1
  [ -f "$repository/deploy/launch.sh" ] || return 1
  [ -f "$repository/package.json" ] || return 1

  top_level=$(git -C "$repository" rev-parse --show-toplevel 2>/dev/null) || return 1
  [ "$(realpath -e "$top_level")" = "$repository" ] || return 1
  origin=$(git -C "$repository" remote get-url origin 2>/dev/null || true)
  is_expected_origin "$origin" || return 1

  is_runner_owned "$repository" || return 1
  is_runner_owned "$repository/.git" || return 1
  is_runner_owned "$repository/.env" || return 1
  env_mode=$(stat -c '%a' "$repository/.env" 2>/dev/null || true)
  [ "$env_mode" = "600" ] || return 1
  printf '%s\n' "$repository"
}

configured_existing=
if [ -n "$configured_repo" ]; then
  configured_existing=$(validated_repository "$configured_repo" 2>/dev/null || true)
fi

container_scan=$(mktemp "$RUNNER_TEMP/gigamail-containers.XXXXXX")
tor_scan=$(mktemp "$RUNNER_TEMP/gigamail-tor-containers.XXXXXX")
home_scan=$(mktemp "$RUNNER_TEMP/gigamail-home-scan.XXXXXX")
runtime_env=$(mktemp "$RUNNER_TEMP/gigamail-runtime-env.XXXXXX")
bootstrap_repo=
preserved_repo=
bootstrap_started=0

cleanup() {
  status=$?
  trap - EXIT
  rm -f "$container_scan" "$tor_scan" "$home_scan" "$runtime_env"
  if [ "$status" -ne 0 ] && [ "$bootstrap_started" -eq 1 ]; then
    recovery_failed=0
    failed_repo="${bootstrap_repo}.failed-bootstrap-${GITHUB_RUN_ID:-manual}-${GITHUB_RUN_ATTEMPT:-1}-$$"
    if [ -e "$bootstrap_repo" ]; then
      if [ -e "$failed_repo" ] || ! mv "$bootstrap_repo" "$failed_repo"; then
        printf 'CRITICAL: could not move the failed bootstrap away from %s.\n' "$bootstrap_repo" >&2
        recovery_failed=1
      else
        printf 'Preserved the failed bootstrap at %s.\n' "$failed_repo" >&2
      fi
    fi
    if [ -n "$preserved_repo" ] && [ -e "$preserved_repo" ]; then
      if [ -e "$bootstrap_repo" ]; then
        printf 'CRITICAL: the failed bootstrap still occupies %s; the prior directory remains at %s.\n' "$bootstrap_repo" "$preserved_repo" >&2
        recovery_failed=1
      elif mv "$preserved_repo" "$bootstrap_repo"; then
        printf 'Restored the prior deployment directory after bootstrap failure.\n' >&2
      else
        printf 'CRITICAL: could not restore the prior deployment directory from %s.\n' "$preserved_repo" >&2
        recovery_failed=1
      fi
    fi
    if [ "$recovery_failed" -ne 0 ]; then
      printf 'CRITICAL: bootstrap recovery needs manual attention before another deployment.\n' >&2
    fi
  fi
  exit "$status"
}
trap cleanup EXIT

if ! docker ps \
  --filter label=com.docker.compose.service=gigamail \
  --format '{{.ID}}' > "$container_scan"; then
  fail "Could not inspect the existing GigaMail Compose container."
fi

containers=()
while IFS= read -r container_id; do
  [ -n "$container_id" ] && containers+=("$container_id")
done < "$container_scan"

if [ "${#containers[@]}" -eq 0 ]; then
  if [ -n "$configured_repo" ]; then
    [ -n "$configured_existing" ] \
      || fail "The configured PRODUCTION_REPO is invalid and no live container can recover it."
    printf '%s\n' "$configured_existing"
    exit 0
  fi

  if ! find "$runner_home" -path "$actions_work_root" -prune -o \
    -type d -name .git -print0 > "$home_scan"; then
    fail "Could not safely scan for the persistent production checkout."
  fi

  matches=()
  while IFS= read -r -d '' git_directory; do
    if repository=$(validated_repository "${git_directory%/.git}"); then
      matches+=("$repository")
    fi
  done < "$home_scan"

  if [ "${#matches[@]}" -ne 1 ]; then
    fail "Expected one protected GigaMail checkout and no live container; found ${#matches[@]}."
  fi
  printf '%s\n' "${matches[0]}"
  exit 0
fi

if [ "${#containers[@]}" -ne 1 ]; then
  fail "Expected exactly one running GigaMail Compose container; found ${#containers[@]}."
fi
container_id=${containers[0]}

compose_root=$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' "$container_id")
compose_project=$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "$container_id")
compose_config=$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project.config_files" }}' "$container_id")
data_mount=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Type}}|{{.Name}}{{println}}{{end}}{{end}}' "$container_id")
case "$compose_root" in
  ''|'<no value>'|*$'\n'*|*$'\r'*) fail "The live Compose working-directory label is missing or unsafe." ;;
esac
case "$compose_project" in
  ''|'<no value>'|*[!a-z0-9_.-]*) fail "The live Compose project label is missing or unsafe." ;;
esac
case "$compose_config" in
  ''|'<no value>'|*$'\n'*|*$'\r'*|*,*) fail "The live Compose config-file label is missing or unsafe." ;;
esac
case "$data_mount" in
  volume\|[a-zA-Z0-9_.-]*) ;;
  *) fail "The live GigaMail /data mount is not one safe Compose named volume." ;;
esac
data_volume=${data_mount#volume|}
case "$data_volume" in
  ''|*[!a-zA-Z0-9_.-]*) fail "The live GigaMail data-volume name is unsafe." ;;
esac
volume_project=$(docker volume inspect --format '{{ index .Labels "com.docker.compose.project" }}' "$data_volume")
volume_role=$(docker volume inspect --format '{{ index .Labels "com.docker.compose.volume" }}' "$data_volume")
[ "$volume_project" = "$compose_project" ] || fail "The live data volume does not belong to the selected Compose project."
[ "$volume_role" = "gigamail-data" ] || fail "The live data volume is not the GigaMail application-data volume."

if ! docker ps \
  --filter "label=com.docker.compose.project=$compose_project" \
  --filter label=com.docker.compose.service=tor-proxy \
  --format '{{.ID}}' > "$tor_scan"; then
  fail "Could not inspect the live GigaMail privacy container."
fi
tor_containers=()
while IFS= read -r tor_id; do
  [ -n "$tor_id" ] && tor_containers+=("$tor_id")
done < "$tor_scan"
[ "${#tor_containers[@]}" -eq 1 ] || fail "Expected exactly one running Tor privacy container for the live GigaMail project."
tor_container_id=${tor_containers[0]}
tor_compose_root=$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' "$tor_container_id")
tor_compose_config=$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project.config_files" }}' "$tor_container_id")
[ "$tor_compose_root" = "$compose_root" ] || fail "The live privacy container has a different Compose working directory."
[ "$tor_compose_config" = "$compose_config" ] || fail "The live privacy container has a different Compose config file."

bootstrap_repo=$(realpath -m "$compose_root")
case "$bootstrap_repo" in
  "$runner_home"/*) ;;
  *) fail "The live Compose working directory must be below the runner user's home." ;;
esac
case "$bootstrap_repo" in
  "$source_repo"|"$source_repo"/*|"$actions_work_root"|"$actions_work_root"/*)
    fail "Refusing to bootstrap inside an Actions workspace."
    ;;
esac

if [ -n "$configured_repo" ]; then
  configured_target=$(realpath -m "$configured_repo")
  case "$configured_target" in
    *$'\n'*|*$'\r'*) fail "The configured production path is unsafe." ;;
  esac
  [ "$configured_target" = "$bootstrap_repo" ] \
    || fail "The configured production path does not match the live Compose working directory."
fi
expected_compose_config=$(realpath -m "$bootstrap_repo/docker-compose.yml")
case "$compose_config" in
  /*) resolved_compose_config=$(realpath -m "$compose_config") ;;
  *) resolved_compose_config=$(realpath -m "$bootstrap_repo/$compose_config") ;;
esac
[ "$resolved_compose_config" = "$expected_compose_config" ] \
  || fail "The live Compose config-file label does not match the production checkout."

live_release=$(docker exec "$container_id" node -e '
fetch("http://127.0.0.1:3000/api/health", { signal: AbortSignal.timeout(10000) }).then(async (response) => {
  const body = await response.json();
  const healthy = response.ok && body.status === "ok" && body.authProtected === true &&
    body.credentialsConfigured === true && body.remoteContentProxyConfigured === true;
  if (!healthy) process.exit(1);
  if (typeof body.releaseSha === "string") process.stdout.write(body.releaseSha);
}).catch(() => process.exit(1));
') || fail "The live GigaMail container did not pass the protected health gate."
app_image_id=$(docker inspect --format '{{.Image}}' "$container_id")
app_runtime_image=$(docker inspect --format '{{.Config.Image}}' "$container_id")
tor_image_id=$(docker inspect --format '{{.Image}}' "$tor_container_id")
tor_runtime_image=$(docker inspect --format '{{.Config.Image}}' "$tor_container_id")
for image_id in "$app_image_id" "$tor_image_id"; do
  printf '%s\n' "$image_id" | grep -Eq '^sha256:[0-9a-f]{64}$' \
    || fail "A live production image does not have an immutable image ID."
done
for image_reference in "$app_runtime_image" "$tor_runtime_image"; do
  case "$image_reference" in
    ''|*@*|*[!a-z0-9._/:-]*) fail "A live production image reference is unsafe for rollback." ;;
  esac
done

verify_compose_environment() {
  local repository
  repository=$1
  (
    cd "$repository"
    docker compose --env-file .env config --format json
  ) | docker exec -i \
    -e "GIGAMAIL_EXPECT_COMPOSE_PROJECT=$compose_project" \
    -e "GIGAMAIL_EXPECT_DATA_VOLUME=$data_volume" \
    "$container_id" node -e '
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  try {
    const config = JSON.parse(input);
    const service = config.services?.gigamail;
    if (!service || config.name !== process.env.GIGAMAIL_EXPECT_COMPOSE_PROJECT) process.exit(1);
    const mounts = Array.isArray(service.volumes)
      ? service.volumes.filter((mount) => mount?.target === "/data")
      : [];
    const volumeSource = mounts[0]?.source;
    const expectedVolume = process.env.GIGAMAIL_EXPECT_DATA_VOLUME;
    if (mounts.length !== 1 || mounts[0].type !== "volume" ||
      (volumeSource !== "gigamail-data" && volumeSource !== expectedVolume)) process.exit(1);
    let resolved = service.environment || {};
    if (Array.isArray(resolved)) {
      resolved = Object.fromEntries(resolved.map((entry) => {
        const separator = entry.indexOf("=");
        return separator === -1 ? [entry, ""] : [entry.slice(0, separator), entry.slice(separator + 1)];
      }));
    }
    const keys = [
      "GIGAMAIL_BIND_ADDRESS", "GIGAMAIL_PORT", "GIGAMAIL_ENCRYPTION_KEY",
      "GIGAMAIL_ACCESS_TOKEN", "GIGAMAIL_REMOTE_TOKEN_KEY", "GIGAMAIL_TRUST_PROXY",
      "GIGAMAIL_ALLOW_INSECURE_TLS", "GIGAMAIL_SYNC_BATCH_SIZE",
      "GIGAMAIL_SYNC_TIMEOUT_MS", "GIGAMAIL_SYNC_MAX_MESSAGE_BYTES",
      "SYNC_INTERVAL_MINUTES", "GIGAMAIL_REMOTE_CONTENT_MAX_BYTES",
      "GIGAMAIL_REMOTE_CONTENT_TIMEOUT_MS", "GIGAMAIL_REMOTE_CONTENT_TOKEN_TTL",
      "LOG_LEVEL"
    ];
    for (const key of keys) {
      const expected = process.env[key];
      if (expected !== undefined && resolved[key] !== expected) process.exit(1);
    }
  } catch {
    process.exit(1);
  }
});
'
}

if production_repo=$(validated_repository "$bootstrap_repo"); then
  verify_compose_environment "$production_repo" \
    || fail "The existing checkout does not resolve to the live Compose project and runtime configuration."
  printf '%s\n' "$production_repo"
  exit 0
fi

printf 'The live stack has no usable checkout; preparing %s.\n' "$bootstrap_repo" >&2

parent_directory=$(dirname "$bootstrap_repo")
mkdir -p "$parent_directory"
parent_directory=$(realpath -e "$parent_directory")
is_runner_owned "$parent_directory" || fail "The production checkout parent must be owned by the runner user."
bootstrap_repo="$parent_directory/$(basename "$bootstrap_repo")"

preserved_env=
if [ -e "$bootstrap_repo" ]; then
  [ -d "$bootstrap_repo" ] || fail "The Compose working directory exists but is not a directory."
  is_runner_owned "$bootstrap_repo" || fail "The prior deployment directory is not owned by the runner user."
  preserved_repo="${bootstrap_repo}.pre-cicd-$(date -u +%Y%m%dT%H%M%SZ)"
  [ ! -e "$preserved_repo" ] || fail "The pre-CI deployment backup path already exists."
  mv "$bootstrap_repo" "$preserved_repo"
  bootstrap_started=1
  if [ -f "$preserved_repo/.env" ]; then
    prior_env_mode=$(stat -c '%a' "$preserved_repo/.env" 2>/dev/null || true)
    if [ ! -L "$preserved_repo/.env" ] \
      && is_runner_owned "$preserved_repo/.env" \
      && [ "$prior_env_mode" = "600" ]; then
      preserved_env="$preserved_repo/.env"
    else
      printf 'The prior .env was not a safe mode-600 runner-owned file; recovering the allowlisted runtime values instead.\n' >&2
    fi
  fi
  printf 'Preserved the prior deployment directory at %s.\n' "$preserved_repo" >&2
else
  bootstrap_started=1
fi

baseline=
if [[ "$live_release" =~ ^[0-9a-fA-F]{40}$ ]] \
  && git -C "$source_repo" cat-file -e "$live_release^{commit}" 2>/dev/null \
  && git -C "$source_repo" merge-base --is-ancestor "$live_release" "$source_head"; then
  baseline=$(git -C "$source_repo" rev-parse --verify "$live_release^{commit}")
else
  workflow_introduction=$(git -C "$source_repo" log --diff-filter=A --format='%H' -- .github/workflows/ci-deploy.yml | tail -n 1)
  if [ -n "$workflow_introduction" ]; then
    baseline=$(git -C "$source_repo" rev-parse --verify "$workflow_introduction^" 2>/dev/null || true)
  fi
fi
[ -n "$baseline" ] || fail "Could not determine the live pre-CI rollback commit."

git clone --no-local --no-checkout "$source_repo" "$bootstrap_repo"
git -C "$bootstrap_repo" remote set-url origin "$expected_origin"
git -C "$bootstrap_repo" checkout --detach "$baseline"

if [ -n "$preserved_env" ]; then
  install -m 600 "$preserved_env" "$bootstrap_repo/.env"
else
  if ! docker exec "$container_id" node -e '
const keys = [
  "GIGAMAIL_BIND_ADDRESS", "GIGAMAIL_PORT", "GIGAMAIL_ENCRYPTION_KEY",
  "GIGAMAIL_ACCESS_TOKEN", "GIGAMAIL_REMOTE_TOKEN_KEY", "GIGAMAIL_TRUST_PROXY",
  "GIGAMAIL_ALLOW_INSECURE_TLS", "GIGAMAIL_SYNC_BATCH_SIZE",
  "GIGAMAIL_SYNC_TIMEOUT_MS", "GIGAMAIL_SYNC_MAX_MESSAGE_BYTES",
  "SYNC_INTERVAL_MINUTES", "GIGAMAIL_REMOTE_CONTENT_MAX_BYTES",
  "GIGAMAIL_REMOTE_CONTENT_TIMEOUT_MS", "GIGAMAIL_REMOTE_CONTENT_TOKEN_TTL",
  "LOG_LEVEL"
];
for (const key of keys) {
  const value = process.env[key];
  if (value === undefined) continue;
  if (!/^[A-Za-z0-9._:/@+~=\-]*$/.test(value)) process.exit(1);
  process.stdout.write(`${key}=${value}\n`);
}
' > "$runtime_env"; then
    fail "Could not safely recover the allowlisted runtime configuration."
  fi
  umask 077
  {
    printf 'COMPOSE_PROJECT_NAME=%s\n' "$compose_project"
    cat "$runtime_env"
    printf 'REMOTE_CONTENT_PROXY_URL=\n'
  } > "$bootstrap_repo/.env"
fi
chmod 600 "$bootstrap_repo/.env"

for key in GIGAMAIL_ENCRYPTION_KEY GIGAMAIL_ACCESS_TOKEN; do
  count=$(awk -v key="$key" 'index($0, key "=") == 1 { count += 1 } END { print count + 0 }' "$bootstrap_repo/.env")
  [ "$count" -eq 1 ] || fail "$key must appear exactly once in the recovered production configuration."
  value=$(awk -v key="$key" 'index($0, key "=") == 1 { print substr($0, length(key) + 2); exit }' "$bootstrap_repo/.env")
  [ "${#value}" -ge 32 ] || fail "$key is not a valid high-entropy production value."
done

project_count=$(awk 'index($0, "COMPOSE_PROJECT_NAME=") == 1 { count += 1 } END { print count + 0 }' "$bootstrap_repo/.env")
if [ "$project_count" -eq 0 ]; then
  printf 'COMPOSE_PROJECT_NAME=%s\n' "$compose_project" >> "$bootstrap_repo/.env"
elif [ "$project_count" -ne 1 ]; then
  fail "COMPOSE_PROJECT_NAME must appear at most once in the production configuration."
fi

verify_compose_environment "$bootstrap_repo" \
  || fail "The recovered configuration did not round-trip to the live runtime values."

production_repo=$(validated_repository "$bootstrap_repo") || fail "The bootstrapped production checkout failed validation."
image_suffix=${source_head:0:12}
app_saved_image="${compose_project}-bootstrap-app:pre-cicd-$image_suffix"
tor_saved_image="${compose_project}-bootstrap-tor:pre-cicd-$image_suffix"
docker image tag "$app_image_id" "$app_saved_image"
docker image tag "$tor_image_id" "$tor_saved_image"
umask 077
{
  printf 'app_saved=%s\n' "$app_saved_image"
  printf 'app_runtime=%s\n' "$app_runtime_image"
  printf 'tor_saved=%s\n' "$tor_saved_image"
  printf 'tor_runtime=%s\n' "$tor_runtime_image"
} > "$production_repo/.git/gigamail-bootstrap-images"
chmod 600 "$production_repo/.git/gigamail-bootstrap-images"
bootstrap_started=0
printf 'Prepared a persistent production checkout at %s with rollback baseline %s.\n' "$production_repo" "$baseline" >&2
printf '%s\n' "$production_repo"
