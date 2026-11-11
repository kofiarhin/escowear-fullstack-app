#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT"
source "$ROOT/scripts/deploy.conf"

log() { printf '[deploy] %s\n' "$*"; }
fail() { printf '[deploy] ERROR: %s\n' "$*" >&2; exit 1; }

for cmd in git curl node flock; do command -v "$cmd" >/dev/null || fail "Missing $cmd"; done
read -r -a dk <<< "$DEPLOY_DOCKER"
[[ ${#dk[@]} -gt 0 ]] || fail "Docker command missing"
"${dk[@]}" info >/dev/null || fail "Docker unavailable"
[[ "$DEPLOY_PROJECT" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || fail "Invalid project"
[[ "$DEPLOY_SERVICE" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]*$ ]] || fail "Invalid service"
[[ "$DEPLOY_IMAGE" =~ ^[a-z0-9][a-z0-9._/-]*$ ]] || fail "Invalid image"
[[ "$DEPLOY_KEEP_RELEASES" =~ ^[0-9]+$ && "$DEPLOY_KEEP_RELEASES" -ge 3 ]] || fail "Keep at least 3 releases"
[[ "$DEPLOY_HEALTH_RETRIES" =~ ^[0-9]+$ && "$DEPLOY_HEALTH_RETRIES" -gt 0 ]] || fail "Invalid retries"
[[ "$DEPLOY_HEALTH_DELAY" =~ ^[0-9]+$ ]] || fail "Invalid delay"
[[ -f "$DEPLOY_COMPOSE" && "$DEPLOY_COMPOSE" != /* && ! -L "$DEPLOY_COMPOSE" ]] || fail "Invalid Compose file"
[[ -f .env && ! -L .env && "$(stat -c '%a' .env)" == 600 ]] || fail ".env missing or not mode 600"
[[ "$(git rev-parse --show-toplevel)" == "$ROOT" ]] || fail "Incorrect Git repository"
[[ "$(git branch --show-current)" == "$DEPLOY_BRANCH" ]] || fail "Expected branch $DEPLOY_BRANCH"
origin="$(git remote get-url origin)"
case "$origin" in
  "https://$DEPLOY_REMOTE"|"https://$DEPLOY_REMOTE.git"|"git@${DEPLOY_REMOTE%%/*}:${DEPLOY_REMOTE#*/}"|"git@${DEPLOY_REMOTE%%/*}:${DEPLOY_REMOTE#*/}.git") ;;
  *) fail "Git origin does not match project" ;;
esac
[[ -z "$(git status --porcelain)" ]] || fail "Uncommitted work exists; resolve it first"

state="$ROOT/.deploy-state"
[[ ! -L "$state" ]] || fail "Unsafe state directory"
mkdir -p -m 700 "$state"
chmod 700 "$state"
exec 9>"$state/deploy.lock"
flock -n 9 || fail "Another deployment is running"
compose=("${dk[@]}" compose -p "$DEPLOY_PROJECT" -f "$DEPLOY_COMPOSE")
"${compose[@]}" config --quiet
mapfile -t services < <("${compose[@]}" config --services)
[[ " ${services[*]} " == *" $DEPLOY_SERVICE "* ]] || fail "Compose service not found"

mode="${1:-deploy}"
case "$mode" in deploy|--check|--rollback) ;; *) fail "Use --check or --rollback" ;; esac
if [[ "$mode" == deploy ]]; then
  log "Fetching latest $DEPLOY_BRANCH"
  git fetch --quiet origin "$DEPLOY_BRANCH"
  git merge --ff-only "refs/remotes/origin/$DEPLOY_BRANCH" || fail "Git fast-forward failed"
  [[ -z "$(git status --porcelain)" ]] || fail "Git tree changed unexpectedly"
fi

container="$("${compose[@]}" ps -aq "$DEPLOY_SERVICE" | head -n 1)"
[[ -n "$container" ]] || fail "No existing container; initial setup is separate"
[[ "$("${dk[@]}" inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$container")" == "$DEPLOY_PROJECT" ]] || fail "Wrong Compose project"
[[ "$("${dk[@]}" inspect -f '{{index .Config.Labels "com.docker.compose.service"}}' "$container")" == "$DEPLOY_SERVICE" ]] || fail "Wrong Compose service"
[[ "$("${dk[@]}" inspect -f '{{.State.Running}}' "$container")" == true ]] || fail "Existing service is not running"
old_image="$("${dk[@]}" inspect -f '{{.Image}}' "$container")"
[[ "$old_image" == sha256:* ]] || fail "No rollback image ID"

# Stop if the running image differs from the previously recorded release.
if [[ -f "$state/active.yaml" ]]; then
  expected="$("${compose[@]}" -f "$state/active.yaml" config --format json | node -e 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>console.log(JSON.parse(s).services[process.argv[1]].image))' "$DEPLOY_SERVICE")"
  expected_id="$("${dk[@]}" image inspect -f '{{.Id}}' "$expected")" || fail "Saved release image unavailable"
  [[ "$expected_id" == "$old_image" ]] || fail "Live release drift detected; review manually"
fi

if [[ "$mode" == --check ]]; then
  log "Preflight passed: $(git rev-parse --short HEAD), live=$old_image"
  exit 0
fi

overlay() {
  local target="$1" image="$2" tmp
  tmp="$(mktemp "$state/overlay.XXXXXXXX")"
  chmod 600 "$tmp"
  printf 'services:\n  %s:\n    image: %s\n    pull_policy: never\n' "$DEPLOY_SERVICE" "$image" > "$tmp"
  mv -f "$tmp" "$target"
}
health() {
  local id status
  id="$("${compose[@]}" ps -aq "$DEPLOY_SERVICE" | head -n 1)"
  [[ -n "$id" ]] || return 1
  status="$("${dk[@]}" inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id")" || return 1
  [[ "$status" == healthy ]] || return 1
  curl -fsS --max-time 5 "$DEPLOY_HEALTH_URL" >/dev/null || return 1
  curl -fsS --max-time 8 "$DEPLOY_PUBLIC_URL" >/dev/null || return 1
}
wait_healthy() {
  local i
  for ((i=0; i<DEPLOY_HEALTH_RETRIES; i++)); do
    if health; then return 0; fi
    sleep "$DEPLOY_HEALTH_DELAY"
  done
  return 1
}
restore() {
  log "Restoring $rollback_ref"
  overlay "$state/restore.yaml" "$rollback_ref"
  if "${compose[@]}" -f "$state/restore.yaml" up -d --no-deps --no-build "$DEPLOY_SERVICE" && wait_healthy; then
    log "Previous release restored and healthy"
    return 0
  fi
  log "CRITICAL: rollback failed; manual intervention required"
  return 1
}

if [[ "$mode" == --rollback ]]; then
  [[ -s "$state/previous-image" ]] || fail "No previous release saved"
  rollback_ref="$(cat "$state/previous-image")"
  [[ "$rollback_ref" == "$DEPLOY_IMAGE:rollback-"* ]] || fail "Invalid saved rollback image"
  "${dk[@]}" image inspect "$rollback_ref" >/dev/null || fail "Previous image no longer exists"
  restore || fail "Rollback failed"
  mv -f "$state/restore.yaml" "$state/active.yaml"
  exit 0
fi

commit="$(git rev-parse HEAD)"
release="$DEPLOY_IMAGE:release-${commit:0:12}"
rollback_ref="$DEPLOY_IMAGE:rollback-$(date -u +%Y%m%d%H%M%S)-${old_image:7:12}"

# No host npm dependencies needed; tests run in Docker's locked environments.
log "Running frontend tests and lint in Docker"
"${dk[@]}" build --target frontend-test -t "$DEPLOY_IMAGE:test-${commit:0:12}" .
overlay "$state/candidate.yaml" "$release"
"${compose[@]}" -f "$state/candidate.yaml" config --quiet
log "Building $release"
"${compose[@]}" -f "$state/candidate.yaml" build "$DEPLOY_SERVICE"
log "Running server tests without network access"
"${dk[@]}" run --rm --network none --entrypoint sh "$release" -c "$DEPLOY_BACKEND_TEST_COMMAND"

checkout="$("${compose[@]}" config --format json | node -e 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>console.log(JSON.parse(s).services[process.argv[1]].environment.ESCOWEAR_CHECKOUT_OPEN||"false"))' "$DEPLOY_SERVICE")"
if [[ "$checkout" == true ]]; then
  log "Checking checkout readiness"
  "${compose[@]}" -f "$state/candidate.yaml" run --rm --no-deps -T --entrypoint node "$DEPLOY_SERVICE" server/scripts/releaseCheck.js
fi

log "Preserving previous image"
"${dk[@]}" tag "$old_image" "$rollback_ref"
printf '%s\n' "$rollback_ref" > "$state/previous-image"
chmod 600 "$state/previous-image"

log "Replacing only $DEPLOY_PROJECT/$DEPLOY_SERVICE"
if ! "${compose[@]}" -f "$state/candidate.yaml" up -d --no-deps --no-build "$DEPLOY_SERVICE"; then
  restore || true
  fail "Deployment failed; rollback attempted"
fi
if ! wait_healthy; then
  restore || true
  fail "Health checks failed; rollback attempted"
fi
mv -f "$state/candidate.yaml" "$state/active.yaml"
rm -f "$state/restore.yaml"
log "Healthy. Cleaning old service containers and images"

active="$("${compose[@]}" ps -q "$DEPLOY_SERVICE" | head -n 1)"
while IFS= read -r id; do
  [[ -n "$id" && "$id" != "$active" ]] || continue
  [[ "$("${dk[@]}" inspect -f '{{.State.Running}}' "$id")" == false ]] || continue
  oneoff="$("${dk[@]}" inspect -f '{{index .Config.Labels "com.docker.compose.oneoff"}}' "$id")"
  [[ "$oneoff" == "False" || "$oneoff" == "false" ]] || continue
  "${dk[@]}" rm "$id" >/dev/null || log "Skipped container $id"
done < <("${dk[@]}" ps -aq --filter "label=com.docker.compose.project=$DEPLOY_PROJECT" --filter "label=com.docker.compose.service=$DEPLOY_SERVICE" --filter status=exited)

# Only image names belonging to this project are eligible; never prune Docker globally.
mapfile -t tags < <("${dk[@]}" image ls --format '{{.Repository}}:{{.Tag}}' --filter "reference=$DEPLOY_IMAGE:release-*")
kept=0
for tag in "${tags[@]}"; do
  [[ "$tag" == "$DEPLOY_IMAGE:release-"* ]] || continue
  if [[ "$tag" == "$release" ]]; then kept=$((kept+1)); continue; fi
  kept=$((kept+1))
  (( kept <= DEPLOY_KEEP_RELEASES )) && continue
  "${dk[@]}" image rm "$tag" >/dev/null 2>&1 || log "Skipped in-use image $tag"
done
mapfile -t tags < <("${dk[@]}" image ls --format '{{.Repository}}:{{.Tag}}' --filter "reference=$DEPLOY_IMAGE:rollback-*")
for tag in "${tags[@]}"; do
  [[ "$tag" == "$DEPLOY_IMAGE:rollback-"* && "$tag" != "$rollback_ref" ]] || continue
  "${dk[@]}" image rm "$tag" >/dev/null 2>&1 || log "Skipped in-use rollback image $tag"
done
"${dk[@]}" image rm "$DEPLOY_IMAGE:test-${commit:0:12}" >/dev/null 2>&1 || true
log "DEPLOYED $release (previous image retained: $rollback_ref)"
