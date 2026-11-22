#!/usr/bin/env bash
# Upgrade / redeploy an existing Kissmet MikroTik Connector install (intended host: Raspberry Pi, Node 22).
# Preserves the env file. Does not modify MikroTik, Cloudflare Tunnel, or purchase infra.
# Keeps the previous code tree at ${INSTALL_ROOT}.prev for rollback:
#   sudo systemctl stop kissmet-mikrotik-connector
#   sudo rsync -a --delete ${INSTALL_ROOT}.prev/ ${INSTALL_ROOT}/ && sudo systemctl start kissmet-mikrotik-connector
#
# SERVICE_USER / SERVICE_GROUP must match the values used at install time.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/lib/common.sh
source "${REPO_DIR}/scripts/lib/common.sh"

INSTALL_ROOT="${INSTALL_ROOT:-/opt/kissmet/mikrotik-connector}"
ENV_FILE="${ENV_FILE:-/etc/kissmet/mikrotik-connector.env}"
SERVICE_NAME="kissmet-mikrotik-connector"
SERVICE_USER="${SERVICE_USER:-${DEFAULT_SERVICE_USER}}"
SERVICE_GROUP="${SERVICE_GROUP:-${SERVICE_USER}}"
UNIT_TEMPLATE="${REPO_DIR}/deploy/mikrotik-connector.service"
UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}.service"

if [[ "$(id -u)" -ne 0 ]]; then
  die "Run as root (sudo)."
fi

[[ -d "${INSTALL_ROOT}" ]] || die "Install root missing (${INSTALL_ROOT}). Run scripts/install.sh first."
[[ -f "${ENV_FILE}" ]] || die "Env file missing (${ENV_FILE}). Run scripts/install.sh first."

validate_service_user_name "${SERVICE_USER}" || die "invalid SERVICE_USER"
validate_service_user_name "${SERVICE_GROUP}" || die "invalid SERVICE_GROUP"
check_abs_path INSTALL_ROOT "${INSTALL_ROOT}" || die "invalid INSTALL_ROOT"
check_abs_path ENV_FILE "${ENV_FILE}" || die "invalid ENV_FILE"
id -u "${SERVICE_USER}" >/dev/null 2>&1 || die "SERVICE_USER=${SERVICE_USER} does not exist (use the install-time value)"
if [[ -f "${UNIT_PATH}" ]] && ! grep -q "^User=${SERVICE_USER}\$" "${UNIT_PATH}"; then
  die "Installed unit runs as a different user than SERVICE_USER=${SERVICE_USER}; pass the install-time SERVICE_USER"
fi
assert_service_user_unprivileged "${SERVICE_USER}" || die "service account is privileged"

command -v node >/dev/null 2>&1 || die "Node.js ${REQUIRED_NODE_MAJOR}.x is required"
NODE_BIN="${NODE_BIN:-$(command -v node)}"
NODE_BIN="$(readlink -f "${NODE_BIN}")"
check_node_bin "${NODE_BIN}" || die "unsupported Node.js location"
check_node_version "$("${NODE_BIN}" -v)" || die "unsupported Node.js version"

echo "==> Stopping ${SERVICE_NAME} (if running)"
systemctl stop "${SERVICE_NAME}" || true

echo "==> Backing up current tree to ${INSTALL_ROOT}.prev"
rm -rf "${INSTALL_ROOT}.prev"
cp -a "${INSTALL_ROOT}" "${INSTALL_ROOT}.prev"

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
  find "${INSTALL_ROOT}" -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} +
  cp -a "${REPO_DIR}/." "${INSTALL_ROOT}/"
  rm -rf "${INSTALL_ROOT}/node_modules" "${INSTALL_ROOT}/.git" "${INSTALL_ROOT}/.env" 2>/dev/null || true
fi

echo "==> npm ci (lockfile, no third-party install scripts as root)"
npm_install_locked "${INSTALL_ROOT}"

apply_code_tree_permissions "${INSTALL_ROOT}" "${SERVICE_GROUP}"
apply_env_file_permissions "${ENV_FILE}"

UNIT_TMP="$(mktemp)"
trap 'rm -f "${UNIT_TMP}"' EXIT
render_unit "${UNIT_TEMPLATE}" "${SERVICE_USER}" "${SERVICE_GROUP}" "${INSTALL_ROOT}" "${ENV_FILE}" "${NODE_BIN}" > "${UNIT_TMP}" \
  || die "failed to render systemd unit"
install -m 0644 -o root -g root "${UNIT_TMP}" "${UNIT_PATH}"
systemctl daemon-reload

echo "==> Starting ${SERVICE_NAME}"
systemctl start "${SERVICE_NAME}"
systemctl --no-pager --full status "${SERVICE_NAME}" || true

echo "==> Process health"
if ! curl -fsS "http://127.0.0.1:8788/health"; then
  echo ""
  echo "health check failed — inspect: journalctl -u ${SERVICE_NAME} -n 100"
  echo "rollback: systemctl stop ${SERVICE_NAME} && rsync -a --delete ${INSTALL_ROOT}.prev/ ${INSTALL_ROOT}/ && systemctl start ${SERVICE_NAME}"
  exit 1
fi

echo ""
echo "Upgrade complete. Env file left untouched: ${ENV_FILE}. Previous tree: ${INSTALL_ROOT}.prev"
