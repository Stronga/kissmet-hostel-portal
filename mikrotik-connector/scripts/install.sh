#!/usr/bin/env bash
# Install / first-deploy Kissmet MikroTik Connector on a Linux host (systemd).
# Does NOT provision cloud VMs, purchase infrastructure, or modify MikroTik.
set -euo pipefail

APP_NAME="mikrotik-connector"
INSTALL_ROOT="${INSTALL_ROOT:-/opt/kissmet/mikrotik-connector}"
ENV_FILE="${ENV_FILE:-/etc/kissmet/mikrotik-connector.env}"
SERVICE_NAME="kissmet-mikrotik-connector"
SERVICE_USER="${SERVICE_USER:-kissmet-connector}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root (sudo)." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20+ is required. Install from NodeSource or distro packages, then re-run." >&2
  exit 1
fi

NODE_MAJOR="$(node -v | sed -E 's/^v([0-9]+).*/\1/')"
if [[ "${NODE_MAJOR}" -lt 20 ]]; then
  echo "Node.js 20+ required (found $(node -v))." >&2
  exit 1
fi

echo "==> Creating service user ${SERVICE_USER}"
if ! id -u "${SERVICE_USER}" >/dev/null 2>&1; then
  useradd --system --home "${INSTALL_ROOT}" --shell /usr/sbin/nologin "${SERVICE_USER}"
fi

echo "==> Installing application tree at ${INSTALL_ROOT}"
mkdir -p "${INSTALL_ROOT}" /etc/kissmet
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

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "==> Writing placeholder env at ${ENV_FILE} (EDIT BEFORE START)"
  cp "${INSTALL_ROOT}/.env.example" "${ENV_FILE}"
  # Force production mode in the system env file template
  sed -i 's/^CONNECTOR_MODE=.*/CONNECTOR_MODE=production/' "${ENV_FILE}" || true
  chmod 0600 "${ENV_FILE}"
  chown root:"${SERVICE_USER}" "${ENV_FILE}"
  echo "    Edit ${ENV_FILE} with real CONNECTOR_SECRET and MIKROTIK_API_PASSWORD before enabling."
else
  echo "==> Keeping existing ${ENV_FILE}"
  chmod 0600 "${ENV_FILE}"
  chown root:"${SERVICE_USER}" "${ENV_FILE}"
fi

chown -R "${SERVICE_USER}:${SERVICE_USER}" "${INSTALL_ROOT}"

echo "==> Installing systemd unit"
UNIT_SRC="${INSTALL_ROOT}/deploy/mikrotik-connector.service"
cp "${UNIT_SRC}" "/etc/systemd/system/${SERVICE_NAME}.service"
systemctl daemon-reload

echo ""
echo "Install complete (service NOT started — configure secrets + WireGuard first)."
echo ""
echo "Next steps:"
echo "  1. Configure WireGuard peer 192.168.216.5/32 (see MIKROTIK_CONNECTOR_DEPLOYMENT.md)"
echo "  2. Edit ${ENV_FILE}"
echo "  3. Validate: nc -vz 192.168.88.1 8728  (source must be .5)"
echo "  4. systemctl enable --now ${SERVICE_NAME}"
echo "  5. curl -sS http://127.0.0.1:8788/health"
echo "  6. Point Worker secrets MIKROTIK_CONNECTOR_URL / MIKROTIK_CONNECTOR_SECRET via wrangler"
echo ""
echo "STOP GATE: Do not claim production Internet Access live until WG + HTTPS + Worker secrets are verified."
