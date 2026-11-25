#!/usr/bin/env bash
# One-time (idempotent) Flolist setup on the shared Oracle VM. Run as a sudo-capable user:
#   sudo bash server-setup.sh "<CI public key>"
# What this VM already had (2026-11-25) and this script therefore does NOT touch: Docker Engine +
# compose plugin, iptables rules for 22/80/443, fail2ban, unattended-upgrades, key-only SSH, and the
# front proxy (the n8n stack's Caddy in /home/ubuntu/n8n-docker). See docs/deploy-oracle.md.
set -euo pipefail

CI_PUBKEY="${1:?usage: server-setup.sh \"<ssh-ed25519 ... CI public key>\"}"
DIR=/opt/flolist
USER_NAME=deploy

[ "$(id -u)" = 0 ] || { echo "run with sudo" >&2; exit 1; }
command -v docker >/dev/null || { echo "Docker is not installed" >&2; exit 1; }

# 1. deploy user: key-only, no password, may run docker (which is root-equivalent on this host:
#    that's the price of compose deploys without sudo; the key is CI-only and `restrict`ed).
if ! id "$USER_NAME" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "Flolist deploy" "$USER_NAME"
fi
usermod -aG docker "$USER_NAME"
install -d -m 700 -o "$USER_NAME" -g "$USER_NAME" "/home/$USER_NAME/.ssh"
AUTH="/home/$USER_NAME/.ssh/authorized_keys"
touch "$AUTH"
# `restrict` = no port/agent/X11 forwarding and no PTY; commands (rsync, deploy.sh) still work.
grep -qF "$CI_PUBKEY" "$AUTH" || echo "restrict $CI_PUBKEY" >> "$AUTH"
chown "$USER_NAME:$USER_NAME" "$AUTH" && chmod 600 "$AUTH"

# 2. /opt/flolist layout (compose file, Caddyfile and scripts are uploaded by every deploy).
install -d -m 750 -o "$USER_NAME" -g "$USER_NAME" "$DIR" "$DIR/scripts" "$DIR/web-releases"
install -d -m 700 -o "$USER_NAME" -g "$USER_NAME" "$DIR/backups"
if [ ! -f "$DIR/.env" ]; then
  echo "NOTE: create $DIR/.env from infra/prod.env.example (chmod 600, owner $USER_NAME)"
fi

# 3. The front proxy's network must exist (Flolist's Caddy joins it as flolist-web).
docker network inspect n8n-docker_default >/dev/null

# 4. Backups: nightly at 02:30 UTC, restore test on the 1st of each month at 04:00 UTC.
cat > /etc/cron.d/flolist <<CRON
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
30 2 * * * $USER_NAME $DIR/scripts/backup.sh >> $DIR/backups/backup.log 2>&1
0 4 1 * * $USER_NAME $DIR/scripts/restore-test.sh >> $DIR/backups/restore-test.log 2>&1
CRON
chmod 644 /etc/cron.d/flolist

echo "[setup] done. Next: $DIR/.env, then add the front proxy site block (docs/deploy-oracle.md)."
