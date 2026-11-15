#!/bin/bash
# One-time: create the private production checkout used by automatic deploys.
# Run as ubuntu. /home/ubuntu/projects is writable by beast-agent, so production
# code must not be executed from there by an unattended path. This clones master
# from GitHub into /home/ubuntu/deploy (ubuntu-only, mode 700, no ACLs) and copies
# the private .env and the release state (rollback image, active release) across
# without printing them. It does not touch Docker or the running service.
set -Eeuo pipefail
umask 077

SOURCE=/home/ubuntu/projects/escowear
BASE=/home/ubuntu/deploy
TARGET=$BASE/escowear
REMOTE=https://github.com/kofiarhin/escowear-fullstack-app.git

log() { printf '[setup] %s\n' "$*"; }
fail() { printf '[setup] ERROR: %s\n' "$*" >&2; exit 1; }

[[ "$(id -un)" == ubuntu ]] || fail "Run as ubuntu"
[[ ! -e "$TARGET" ]] || fail "$TARGET already exists"
[[ -f "$SOURCE/.env" && ! -L "$SOURCE/.env" && "$(stat -c '%U %a' "$SOURCE/.env")" == "ubuntu 600" ]] \
  || fail "$SOURCE/.env missing, a symlink or not ubuntu mode 600"
# The source tree is writable by beast-agent, so verify the release state before
# trusting it: real ubuntu-owned files, and the saved release must be what is running.
state="$SOURCE/.deploy-state"
[[ -d "$state" && ! -L "$state" && "$(stat -c '%U' "$state")" == ubuntu ]] || fail "$state is not an ubuntu-owned directory"
for f in active.yaml previous-image; do
  [[ -f "$state/$f" && ! -L "$state/$f" && "$(stat -c '%U %a' "$state/$f")" == "ubuntu 600" ]] \
    || fail "Release state $f missing, a symlink or not ubuntu mode 600"
done
active_image="$(awk '$1=="image:"{print $2; exit}' "$state/active.yaml")"
rollback_image="$(<"$state/previous-image")"
[[ "$active_image" =~ ^escowear:release-[0-9a-f]{12}$ ]] || fail "Unexpected active release in active.yaml"
[[ "$rollback_image" =~ ^escowear:rollback-[0-9]{14}-[0-9a-f]{12}$ ]] || fail "Unexpected rollback image name"
live="$(sudo docker inspect -f '{{.Image}}' escowear-web-1)" || fail "Cannot inspect escowear-web-1"
[[ "$(sudo docker image inspect -f '{{.Id}}' "$active_image")" == "$live" ]] || fail "$active_image is not the running image"
sudo docker image inspect "$rollback_image" >/dev/null || fail "Rollback image $rollback_image is missing"

install -d -m 700 "$BASE"
[[ "$(stat -c '%U %a' "$BASE")" == "ubuntu 700" && "$(ls -ld "$BASE" | cut -c11)" != + ]] \
  || fail "$BASE must be ubuntu mode 700 without ACLs"

log "Cloning master from GitHub"
GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 git clone --quiet --branch master "$REMOTE" "$TARGET"
install -m 600 "$SOURCE/.env" "$TARGET/.env"
install -d -m 700 "$TARGET/.deploy-state"
install -m 600 "$SOURCE/.deploy-state/active.yaml" "$SOURCE/.deploy-state/previous-image" "$TARGET/.deploy-state/"
cmp -s "$SOURCE/.env" "$TARGET/.env" || fail ".env copy differs"

log "Read-only preflight from the new checkout"
bash "$TARGET/scripts/deploy.sh" --check
log "Ready: $TARGET at $(git -C "$TARGET" rev-parse --short HEAD). Run future manual deploys from here."
