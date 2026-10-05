#!/usr/bin/env bash
# One-time setup of the shelly-hub container (Debian 12). Run as root on the container.
# Usage: setup-host.sh <node-version>   e.g. setup-host.sh v24.21.0
set -euo pipefail

NODE_VERSION=${1:?node version, e.g. v24.21.0}
export DEBIAN_FRONTEND=noninteractive

apt-get update -qq
apt-get install -y -qq rsync avahi-daemon xz-utils >/dev/null

# Node.js from the official tarball (Debian 12 ships Node 18).
if [ "$(/opt/node/bin/node --version 2>/dev/null)" != "$NODE_VERSION" ]; then
  tmp=$(mktemp -d)
  curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-linux-x64.tar.xz" -o "$tmp/node.tar.xz"
  curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
  (cd "$tmp" && grep " node-$NODE_VERSION-linux-x64.tar.xz\$" SHASUMS256.txt | sed "s/node-.*/node.tar.xz/" | sha256sum -c -)
  rm -rf /opt/node && mkdir -p /opt/node
  tar -xJf "$tmp/node.tar.xz" -C /opt/node --strip-components=1
  rm -rf "$tmp"
fi

# Announce shelly-hub.local on the main network only, not on the Shelly/guest VLAN.
sed -i 's/^#\?allow-interfaces=.*/allow-interfaces=eth0/' /etc/avahi/avahi-daemon.conf
systemctl restart avahi-daemon

id shelly-hub >/dev/null 2>&1 || useradd --system --home /opt/shelly-hub --shell /usr/sbin/nologin shelly-hub
mkdir -p /opt/shelly-hub
/opt/node/bin/node --version
