#!/usr/bin/env bash
# Install / first-deploy Kissmet MikroTik Connector on Linux (intended: Raspberry Pi OS 64-bit / Debian, Node 22 arm64).
# Does NOT provision cloud VMs, purchase infrastructure, modify MikroTik, or configure Cloudflare Tunnel.
# Does NOT start the service.
#
# Usage:
#   sudo ./scripts/install.sh                         # dedicated user kissmet-connector (recommended)
#   sudo SERVICE_USER=kissmet-svc ./scripts/install.sh # reuse the existing heartbeat account (supported, less isolated)
#
# Environment overrides: SERVICE_USER, SERVICE_GROUP (default = SERVICE_USER), INSTALL_ROOT, ENV_FILE, NODE_BIN.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/lib/common.sh
source "${REPO_DIR}/scripts/lib/common.sh"

INSTALL_ROOT="${INSTALL_ROOT:-/opt/kissmet/mikrotik-connector}"
ENV_FILE="${ENV_FILE:-/etc/kissmet/mikrotik-connector.env}"
SERVICE_NAME="kissmet-mikrotik-connector"
SERVICE_USER="${SERVICE_USER:-${DEFAULT_SERVICE_USER}}"
SERVICE_GROUP="${SERVICE_GROUP:-${SERVICE_USER}}"
ENV_TEMPLATE="${REPO_DIR}/deploy/connector.env.production.example"
UNIT_TEMPLATE="${REPO_DIR}/deploy/mikrotik-connector.service"

if [[ "$(id -u)" -ne 0 ]]; then
  die "Run as root (sudo)."
fi

validate_service_user_name "${SERVICE_USER}" || die "invalid SERVICE_USER"
validate_service_user_name "${SERVICE_GROUP}" || die "invalid SERVICE_GROUP"
check_abs_path INSTALL_ROOT "${INSTALL_ROOT}" || die "invalid INSTALL_ROOT"
check_abs_path ENV_FILE "${ENV_FILE}" || die "invalid ENV_FILE"

command -v node >/dev/null 2>&1 || die "Node.js ${REQUIRED_NODE_MAJOR}.x is required. Install Node ${REQUIRED_NODE_MAJOR} LTS (arm64) from NodeSource, then re-run."
NODE_BIN="${NODE_BIN:-$(command -v node)}"
NODE_BIN="$(readlink -f "${NODE_BIN}")"
check_node_bin "${NODE_BIN}" || die "unsupported Node.js location"
check_node_version "$("${NODE_BIN}" -v)" || die "unsupported Node.js version"
command -v npm >/dev/null 2>&1 || die "npm is required"

echo "==> Service account ${SERVICE_USER}:${SERVICE_GROUP}"
if id -u "${SERVICE_USER}" >/dev/null 2>&1; then
  echo "    Using existing account ${SERVICE_USER} (not modified)."
  if [[ "${SERVICE_USER}" != "${DEFAULT_SERVICE_USER}" ]]; then
    echo "    NOTE: sharing an account with another service (e.g. the Python heartbeat) reduces isolation."
  fi
else
  if [[ "${SERVICE_USER}" != "${DEFAULT_SERVICE_USER}" ]]; then
    die "SERVICE_USER=${SERVICE_USER} does not exist. Only ${DEFAULT_SERVICE_USER} is created automatically."
  fi
  useradd --system --user-group --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin "${SERVICE_USER}"
  echo "    Created system user ${SERVICE_USER} (no login, no home)."
fi
getent group "${SERVICE_GROUP}" >/dev/null 2>&1 || die "group ${SERVICE_GROUP} does not exist"
assert_service_user_unprivileged "${SERVICE_USER}" || die "service account is privileged"

echo "==> Installing application tree at ${INSTALL_ROOT} (root-owned)"
mkdir -p "${INSTALL_ROOT}" "$(dirname "${ENV_FILE}")"
chmod 0755 "$(dirname "${ENV_FILE}")"
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

echo "==> npm ci (lockfile, no third-party install scripts as root)"
npm_install_locked "${INSTALL_ROOT}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "==> Writing placeholder env at ${ENV_FILE} (EDIT BEFORE START)"
  install -m 0600 -o root -g root "${ENV_TEMPLATE}" "${ENV_FILE}"
  echo "    Edit ${ENV_FILE}: CONNECTOR_SECRET, MIKROTIK_API_PASSWORD, TLS CA file. The service will refuse placeholders."
else
  echo "==> Keeping existing ${ENV_FILE}"
fi
apply_env_file_permissions "${ENV_FILE}"

apply_code_tree_permissions "${INSTALL_ROOT}" "${SERVICE_GROUP}"

echo "==> Installing systemd unit (User=${SERVICE_USER}, Node=${NODE_BIN})"
UNIT_TMP="$(mktemp)"
trap 'rm -f "${UNIT_TMP}"' EXIT
render_unit "${UNIT_TEMPLATE}" "${SERVICE_USER}" "${SERVICE_GROUP}" "${INSTALL_ROOT}" "${ENV_FILE}" "${NODE_BIN}" > "${UNIT_TMP}" \
  || die "failed to render systemd unit"
install -m 0644 -o root -g root "${UNIT_TMP}" "/etc/systemd/system/${SERVICE_NAME}.service"
systemctl daemon-reload
if command -v systemd-analyze >/dev/null 2>&1; then
  systemd-analyze verify "/etc/systemd/system/${SERVICE_NAME}.service" || echo "    (systemd-analyze reported warnings; review above)"
fi

echo ""
echo "Install complete (service NOT started — configure secrets + Pi LAN first)."
echo ""
echo "Production host: Raspberry Pi on hostel LAN (Ethernet preferred)."
echo "Production path: Pi LAN → RouterOS api-ssl 192.168.88.1:8729 (TLS), NOT WireGuard .5."
echo ""
echo "Next steps (see pi-arrival commissioning checklist):"
echo "  1. Confirm Ethernet / reserved Pi LAN IP"
echo "  2. Edit ${ENV_FILE} (keep BIND_HOST=127.0.0.1; TRUST_PROXY=true only behind cloudflared + Access)"
echo "  3. Copy the RouterOS CA certificate to the path in MIKROTIK_API_TLS_CA_FILE (root:${SERVICE_GROUP} 0640)"
echo "  4. RouterOS: allowlist the Pi LAN IP on api-ssl (manual, approved change only)"
echo "  5. systemctl enable --now ${SERVICE_NAME}"
echo "  6. curl -sS http://127.0.0.1:8788/health"
echo "  7. cloudflared + Access service token, then Worker secrets (MIKROTIK_CONNECTOR_URL / SECRET / CF_ACCESS_*)"
echo ""
echo "STOP GATE: Do not claim production Internet Access live until router-side commissioning is approved."
