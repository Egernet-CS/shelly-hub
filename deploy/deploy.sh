#!/usr/bin/env bash
# Deploys server + web to the shelly-hub container and restarts the service.
# Usage: deploy/deploy.sh [ssh-target]   (default $SHELLY_HUB_TARGET, else root@shelly-hub.local)
set -euo pipefail

TARGET=${1:-${SHELLY_HUB_TARGET:-root@shelly-hub.local}}
ROOT=$(cd "$(dirname "$0")/.." && pwd)

rsync -az --delete --exclude node_modules --exclude data "$ROOT/server/" "$TARGET:/opt/shelly-hub/server/"
rsync -az --delete "$ROOT/web/" "$TARGET:/opt/shelly-hub/web/"
rsync -az "$ROOT/deploy/shelly-hub.service" "$TARGET:/etc/systemd/system/shelly-hub.service"

ssh "$TARGET" bash -s <<'EOF'
set -euo pipefail
cd /opt/shelly-hub/server
PATH=/opt/node/bin:$PATH npm ci --omit=dev --no-fund --no-audit --loglevel=error
chown -R root:root /opt/shelly-hub
systemctl daemon-reload
systemctl enable --now shelly-hub >/dev/null 2>&1
systemctl restart shelly-hub
sleep 2
systemctl is-active shelly-hub
EOF
