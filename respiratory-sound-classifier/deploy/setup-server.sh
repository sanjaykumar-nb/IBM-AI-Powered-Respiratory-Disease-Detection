#!/usr/bin/env bash
# One-time preparation of a fresh x86_64 Linux server: installs Docker Engine + Compose plugin
# and opens HTTP in the firewall. Supports Ubuntu/Debian and RHEL/Rocky/AlmaLinux/CentOS Stream.
# Usage: sudo bash deploy/setup-server.sh
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
    echo "Run as root: sudo bash $0" >&2
    exit 1
fi

. /etc/os-release
echo "==> Detected: $PRETTY_NAME ($(uname -m))"

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    echo "==> Docker and Compose already installed"
else
    case "$ID" in
        ubuntu|debian)
            apt-get update
            apt-get install -y ca-certificates curl gnupg
            install -m 0755 -d /etc/apt/keyrings
            curl -fsSL "https://download.docker.com/linux/$ID/gpg" -o /etc/apt/keyrings/docker.asc
            chmod a+r /etc/apt/keyrings/docker.asc
            echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/$ID ${VERSION_CODENAME} stable" \
                > /etc/apt/sources.list.d/docker.list
            apt-get update
            apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin git
            ;;
        rhel|rocky|almalinux|centos|ol)
            dnf -y install dnf-plugins-core git
            dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
            dnf -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
            ;;
        *)
            echo "Unsupported distro '$ID'. Install Docker manually: https://docs.docker.com/engine/install/" >&2
            exit 1
            ;;
    esac
fi

systemctl enable --now docker

# Let the invoking (non-root) user run docker without sudo
if [[ -n "${SUDO_USER:-}" && "$SUDO_USER" != "root" ]]; then
    usermod -aG docker "$SUDO_USER"
    echo "==> Added $SUDO_USER to the docker group (log out and back in to take effect)"
fi

# Open HTTP/HTTPS if a firewall is active
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
    ufw allow 80/tcp
    ufw allow 443/tcp
elif command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
    firewall-cmd --permanent --add-service=http
    firewall-cmd --permanent --add-service=https
    firewall-cmd --reload
fi

echo "==> Done. $(docker --version); $(docker compose version)"
echo "    Next: cd into the project and run: bash deploy/deploy.sh"
