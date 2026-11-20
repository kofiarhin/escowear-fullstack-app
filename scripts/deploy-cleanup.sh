#!/usr/bin/env bash
# Post-deploy cleanup of this project's old Docker images. deploy.sh runs it only after
# the new release passed its health checks, never after a failed deploy or a rollback.
# It removes only this project's own image names, and never the live release, the
# saved rollback image or an image that any container (any project, any state) uses.
# Fails closed: if anything needed to decide what is safe cannot be read, no image is
# removed. Never prunes Docker globally.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
source "$ROOT/scripts/deploy.conf"

log() { printf '[deploy] cleanup: %s\n' "$*"; }
fail() { printf '[deploy] cleanup: ERROR: %s\n' "$*" >&2; exit 1; }

dry_run=false
if [[ "${1:-}" == --dry-run ]]; then dry_run=true; shift; fi
[[ $# -eq 2 ]] || fail "Usage: deploy-cleanup.sh [--dry-run] <live release image> <rollback image>"
current="$1"
rollback="$2"

read -r -a dk <<< "$DEPLOY_DOCKER"
[[ ${#dk[@]} -gt 0 ]] || fail "Docker command missing"
[[ "$DEPLOY_PROJECT" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || fail "Invalid project"
[[ "$DEPLOY_SERVICE" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]*$ ]] || fail "Invalid service"
[[ "$DEPLOY_IMAGE" =~ ^[a-z0-9][a-z0-9._/-]*$ ]] || fail "Invalid image"
[[ "$DEPLOY_REGISTRY_IMAGE" =~ ^[a-z0-9][a-z0-9._/-]*$ && "$DEPLOY_REGISTRY_IMAGE" != "$DEPLOY_IMAGE" ]] || fail "Invalid registry image"
[[ "$DEPLOY_KEEP_RELEASES" =~ ^[0-9]+$ && "$DEPLOY_KEEP_RELEASES" -ge 3 ]] || fail "Keep at least 3 releases"
[[ "$current" =~ ^"$DEPLOY_IMAGE":release-[0-9a-f]{12}$ ]] || fail "Invalid live release image"
[[ "$rollback" =~ ^"$DEPLOY_IMAGE":rollback-[0-9]{14}-[0-9a-f]{12}$ ]] || fail "Invalid rollback image"

current_id="$("${dk[@]}" image inspect -f '{{.Id}}' "$current")" || fail "Live release image not found; no images removed"
rollback_id="$("${dk[@]}" image inspect -f '{{.Id}}' "$rollback")" || fail "Rollback image not found; no images removed"
[[ "$current_id" == sha256:* && "$rollback_id" == sha256:* ]] || fail "Unexpected image IDs; no images removed"

# Old stopped containers of this service only (never one-off runs or the live one).
if [[ "$dry_run" == false ]]; then
  active="$("${dk[@]}" compose -p "$DEPLOY_PROJECT" -f "$ROOT/$DEPLOY_COMPOSE" ps -q "$DEPLOY_SERVICE" | head -n 1)" \
    || fail "Cannot read the live container; no images removed"
  exited="$("${dk[@]}" ps -aq --filter "label=com.docker.compose.project=$DEPLOY_PROJECT" \
    --filter "label=com.docker.compose.service=$DEPLOY_SERVICE" --filter status=exited)" \
    || fail "Cannot list stopped containers; no images removed"
  for id in $exited; do
    [[ "$id" != "$active" ]] || continue
    oneoff="$("${dk[@]}" inspect -f '{{index .Config.Labels "com.docker.compose.oneoff"}}' "$id")" || continue
    [[ "$oneoff" == False || "$oneoff" == false ]] || continue
    "${dk[@]}" rm "$id" >/dev/null || log "Skipped container $id"
  done
fi

declare -A protected=(["$current_id"]=1 ["$rollback_id"]=1)
# Every container on the host, running or stopped, from any project, keeps its image.
containers="$("${dk[@]}" ps -aq --no-trunc)" || fail "Cannot list containers; no images removed"
if [[ -n "$containers" ]]; then
  # shellcheck disable=SC2086 # one argument per container ID
  used="$("${dk[@]}" inspect -f '{{.Image}}' $containers)" || fail "Cannot read container images; no images removed"
  for id in $used; do
    [[ "$id" == sha256:* ]] || fail "Unexpected container image ID; no images removed"
    protected["$id"]=1
  done
fi

# Newest first (Docker's order), so the first DEPLOY_KEEP_RELEASES releases are kept.
listing="$("${dk[@]}" image ls --no-trunc --format '{{.Repository}}:{{.Tag}} {{.ID}}')" || fail "Cannot list images; no images removed"
releases=0 removed=0 in_use=0
while read -r ref id; do
  [[ -n "${ref:-}" ]] || continue
  if [[ "$ref" =~ ^"$DEPLOY_IMAGE":release-[0-9a-f]{12}$ ]]; then
    releases=$((releases+1))
    [[ "$ref" != "$current" ]] || continue
    (( releases > DEPLOY_KEEP_RELEASES )) || continue
  elif [[ "$ref" =~ ^"$DEPLOY_IMAGE":rollback-[0-9]{14}-[0-9a-f]{12}$ ]]; then
    [[ "$ref" != "$rollback" ]] || continue
  elif [[ ! "$ref" =~ ^"$DEPLOY_IMAGE":test-[0-9a-f]{12}$ && ! "$ref" =~ ^"$DEPLOY_REGISTRY_IMAGE":[0-9a-f]{40}$ ]]; then
    # Any other name, including this project's manual leftovers, is not ours to remove.
    continue
  fi
  if [[ -n "${protected[$id]:-}" ]]; then
    in_use=$((in_use+1))
    log "Kept $ref (live, rollback or used by a container)"
    continue
  fi
  if [[ "$dry_run" == true ]]; then
    log "Would remove $ref"
    removed=$((removed+1))
  # Untags only; Docker frees the image when no other tag or container needs it.
  elif "${dk[@]}" image rm "$ref" >/dev/null 2>&1; then
    log "Removed $ref"
    removed=$((removed+1))
  else
    log "Skipped $ref (Docker refused to remove it)"
  fi
done <<< "$listing"

if [[ "$dry_run" == true ]]; then
  log "Dry run: would remove $removed image(s); kept $current and $rollback"
else
  log "Removed $removed image(s), kept $in_use protected; kept $current and $rollback"
fi
