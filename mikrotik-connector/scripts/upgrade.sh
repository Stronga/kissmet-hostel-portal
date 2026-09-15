#!/usr/bin/env bash
# Upgrade / redeploy an existing Kissmet MikroTik Connector install.
# Preserves /etc/kissmet/mikrotik-connector.env. Does not modify MikroTik or purchase infra.
set -euo pipefail

INSTALL_ROOT="${INSTALL_ROOT:-/opt/kissmet/mikrotik-connector}"
ENV_FILE="${ENV_FILE:-/etc/kissmet/mikrotik-connector.env}"
SERVICE_NAME="kissmet-mikrotik-connector"
SERVICE_USER="${SERVICE_USER:-kissmet-connector}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root (sudo)." >&2
  exit 1
fi

if [[ ! -d "${INSTALL_ROOT}" ]]; then
  echo "Install root missing (${INSTALL_ROOT}). Run scripts/install.sh first." >&2
  exit 1
fi

echo "==> Stopping ${SERVICE_NAME} (if running)"
systemctl stop "${SERVICE_NAME}" || true

echo "==> Syncing application files"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete \
    --exclude node_modules \
    --exclude .env \
    --exclude '.env.*' \
    --exclude dist \
    --exclude .git \
    "${REPO_DIR}/" "${INSTALL_ROOT}/"
else
  # Portable fallback when rsync is unavailable
  find "${INSTALL_ROOT}" -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} +
  cp -a "${REPO_DIR}/." "${INSTALL_ROOT}/"
  rm -rf "${INSTALL_ROOT}/node_modules" "${INSTALL_ROOT}/.git" "${INSTALL_ROOT}/.env" 2>/dev/null || true
fi

echo "==> npm ci"
cd "${INSTALL_ROOT}"
npm ci --omit=dev=false

chown -R "${SERVICE_USER}:${SERVICE_USER}" "${INSTALL_ROOT}"
cp "${INSTALL_ROOT}/deploy/mikrotik-connector.service" "/etc/systemd/system/${SERVICE_NAME}.service"
systemctl daemon-reload

echo "==> Starting ${SERVICE_NAME}"
systemctl start "${SERVICE_NAME}"
systemctl --no-pager --full status "${SERVICE_NAME}" || true

echo "==> Process health"
curl -fsS "http://127.0.0.1:8788/health" || echo "health check failed — inspect journalctl -u ${SERVICE_NAME}"

echo "Upgrade complete. Env file left untouched: ${ENV_FILE}"
