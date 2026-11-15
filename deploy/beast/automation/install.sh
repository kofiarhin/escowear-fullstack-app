#!/bin/bash
# Installs (or with --uninstall removes) the restricted escowear-deploy SSH path.
# Run as root on Beast from a reviewed checkout. Changes SSH and sudo configuration:
# requires Kofi's explicit approval. Every file is validated before activation.
set -Eeuo pipefail
umask 022

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
DEPLOY_USER=escowear-deploy
RUN_USER=ubuntu
KEY_COMMENT=escowear-github-actions
SSH_ENTRY=/usr/local/sbin/escowear-deploy-ssh
RUNNER=/usr/local/sbin/escowear-deploy-run
SUDOERS=/etc/sudoers.d/escowear-deploy
SSHD_SNIPPET=/etc/ssh/sshd_config.d/99-escowear-deploy.conf
STATE=/home/$RUN_USER/.local/state/escowear/automation

log() { printf '[install] %s\n' "$*"; }
fail() { printf '[install] ERROR: %s\n' "$*" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]] || fail "Run as root"
id "$DEPLOY_USER" >/dev/null 2>&1 || fail "User $DEPLOY_USER does not exist"
id "$RUN_USER" >/dev/null 2>&1 || fail "User $RUN_USER does not exist"
home="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"
keys="$home/.ssh/authorized_keys"

if [[ "${1:-}" == --uninstall ]]; then
  rm -f "$SSHD_SNIPPET"
  sshd -t || fail "sshd configuration invalid after removal; inspect before reloading"
  systemctl reload ssh
  rm -f "$SUDOERS" "$SSH_ENTRY" "$RUNNER"
  log "Removed. $DEPLOY_USER keeps its restricted key but can no longer deploy."
  exit 0
fi
[[ $# -eq 0 ]] || fail "Usage: install.sh [--uninstall]"

id -nG "$DEPLOY_USER" | tr ' ' '\n' | grep -qxE 'sudo|admin|docker|wheel' && fail "$DEPLOY_USER is in a privileged group"
[[ "$(passwd -S "$DEPLOY_USER" | awk '{print $2}')" == L ]] || fail "$DEPLOY_USER password must be locked"
[[ -f "$keys" && ! -L "$keys" ]] || fail "Missing $keys"
mapfile -t key_lines < <(grep -vE '^\s*(#|$)' "$keys")
[[ ${#key_lines[@]} -eq 1 ]] || fail "Expected exactly one key in $keys"
key="$(grep -oE '(ssh-ed25519|ecdsa-sha2-nistp256|ssh-rsa) [A-Za-z0-9+/=]+' <<<"${key_lines[0]}")" || fail "Unrecognised key line"
[[ "${key_lines[0]}" == *" $KEY_COMMENT" ]] || fail "Key comment is not $KEY_COMMENT"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
install -m 0440 "$SRC/sudoers.escowear-deploy" "$tmp/sudoers"
visudo -cqf "$tmp/sudoers" || fail "sudoers file is invalid"

log "Installing wrappers"
install -o root -g root -m 0755 "$SRC/escowear-deploy-ssh" "$SSH_ENTRY"
install -o root -g root -m 0755 "$SRC/escowear-deploy-run" "$RUNNER"
install -d -o "$RUN_USER" -g "$RUN_USER" -m 0700 "$STATE"

log "Restricting the deploy key and account"
printf 'restrict,command="%s" %s %s\n' "$SSH_ENTRY" "$key" "$KEY_COMMENT" >"$tmp/authorized_keys"
install -o root -g root -m 0755 -d "$home/.ssh"
install -o root -g root -m 0644 "$tmp/authorized_keys" "$keys"
usermod -s /bin/sh "$DEPLOY_USER"

log "Installing sudoers rule"
install -o root -g root -m 0440 "$tmp/sudoers" "$SUDOERS"
visudo -cq || { rm -f "$SUDOERS"; fail "sudoers invalid after install; rule removed"; }

log "Installing sshd Match block"
install -o root -g root -m 0644 "$SRC/sshd.escowear-deploy.conf" "$SSHD_SNIPPET"
sshd -t || { rm -f "$SSHD_SNIPPET"; fail "sshd -t failed; snippet removed, ssh not reloaded"; }
[[ "$(sshd -T -C "user=$DEPLOY_USER,host=github,addr=192.0.2.1" | awk '$1=="forcecommand"{print $2}')" == "$SSH_ENTRY" ]] \
  || { rm -f "$SSHD_SNIPPET"; fail "ForceCommand not effective; snippet removed"; }
[[ "$(sshd -T -C "user=$RUN_USER,host=x,addr=192.0.2.1" | awk '$1=="forcecommand"{print $2}')" == none ]] \
  || { rm -f "$SSHD_SNIPPET"; fail "Match block leaks to $RUN_USER; snippet removed"; }
systemctl reload ssh

good="$(printf 'a%.0s' {1..40})"
sudo -u "$DEPLOY_USER" sudo -n -l "$RUNNER" deploy "$good" >/dev/null || fail "sudo rule does not allow deploy <sha>"
sudo -u "$DEPLOY_USER" sudo -n -l "$RUNNER" check >/dev/null || fail "sudo rule does not allow check"
if sudo -u "$DEPLOY_USER" sudo -n -l "$RUNNER" deploy "$good; id" >/dev/null 2>&1 \
  || sudo -u "$DEPLOY_USER" sudo -n -l /bin/sh >/dev/null 2>&1; then
  fail "sudo rule is wider than intended; remove $SUDOERS now"
fi
log "Installed and verified. Deploys still need /home/$RUN_USER/.config/escowear/github-actions-read.token (docs/ci-deploy.md)."
