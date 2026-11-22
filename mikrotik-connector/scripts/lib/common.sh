#!/usr/bin/env bash
# Shared helpers for scripts/install.sh and scripts/upgrade.sh.
# Sourced only. Pure functions (validation + rendering) have no side effects so they can be
# exercised by tests/deploy-scripts.test.ts without root, systemd, or a Raspberry Pi.

# Supported Node.js major. Keep in sync with package.json "engines", .nvmrc and .node-version.
# shellcheck disable=SC2034  # used by scripts that source this file
REQUIRED_NODE_MAJOR=22

# Default service account: a dedicated, no-login system user that owns nothing in the code tree.
# The existing Pi account `kissmet-svc` (Python heartbeat) is supported via SERVICE_USER=kissmet-svc,
# but sharing it lets either service read the other's process memory/files, so it is not the default.
# shellcheck disable=SC2034
DEFAULT_SERVICE_USER="kissmet-connector"

# Accounts that must never run the connector (root, the interactive admin login, distro defaults).
FORBIDDEN_SERVICE_USERS=(root kissmet pi admin ubuntu)

die() {
  echo "ERROR: $*" >&2
  exit 1
}

# validate_service_user_name NAME -> 0 if acceptable as a service account name.
validate_service_user_name() {
  local name="$1"
  if [[ ! "${name}" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]]; then
    echo "SERVICE_USER must match ^[a-z_][a-z0-9_-]{0,31}$" >&2
    return 1
  fi
  local f
  for f in "${FORBIDDEN_SERVICE_USERS[@]}"; do
    if [[ "${name}" == "${f}" ]]; then
      echo "SERVICE_USER=${name} is not allowed (root/admin/login accounts must not run the connector)" >&2
      return 1
    fi
  done
  return 0
}

# assert_service_user_unprivileged NAME -> refuses uid 0 and members of admin groups.
# Only meaningful when the account already exists.
assert_service_user_unprivileged() {
  local name="$1"
  id -u "${name}" >/dev/null 2>&1 || return 0
  if [[ "$(id -u "${name}")" -eq 0 ]]; then
    echo "SERVICE_USER=${name} has uid 0" >&2
    return 1
  fi
  local g
  for g in $(id -nG "${name}"); do
    case "${g}" in
      sudo|wheel|admin|adm|root|docker|lxd|netdev|gpio|i2c|spi)
        echo "SERVICE_USER=${name} is in privileged group '${g}'; use a dedicated account" >&2
        return 1
        ;;
    esac
  done
  return 0
}

# node_major_from_version "v22.11.0" -> 22
node_major_from_version() {
  local v="$1"
  if [[ ! "${v}" =~ ^v?([0-9]+)\. ]]; then
    echo ""
    return 1
  fi
  echo "${BASH_REMATCH[1]}"
}

# check_node_version "v22.11.0" -> 0 only for the supported major.
check_node_version() {
  local v="$1" major
  major="$(node_major_from_version "${v}")" || {
    echo "Could not parse Node.js version '${v}'" >&2
    return 1
  }
  if [[ "${major}" != "${REQUIRED_NODE_MAJOR}" ]]; then
    echo "Node.js ${REQUIRED_NODE_MAJOR}.x LTS is required (found ${v}). Install Node ${REQUIRED_NODE_MAJOR} arm64 (NodeSource) and re-run." >&2
    return 1
  fi
  return 0
}

# check_node_bin PATH -> node must live outside home directories (ProtectHome=true hides them).
check_node_bin() {
  local p="$1"
  if [[ -z "${p}" || "${p}" != /* ]]; then
    echo "Node.js binary path must be absolute (got '${p}')" >&2
    return 1
  fi
  case "${p}" in
    /home/*|/root/*|/run/user/*)
      echo "Node.js at ${p} is inside a home directory (nvm?). Install a system Node ${REQUIRED_NODE_MAJOR} (e.g. /usr/bin/node)." >&2
      return 1
      ;;
  esac
  if [[ "${p}" =~ [[:space:]] ]]; then
    echo "Node.js path must not contain whitespace" >&2
    return 1
  fi
  return 0
}

# check_abs_path NAME VALUE -> absolute, no whitespace, no sed/systemd specials.
check_abs_path() {
  local name="$1" p="$2"
  if [[ -z "${p}" || "${p}" != /* || ! "${p}" =~ ^/[A-Za-z0-9._/-]+$ || "${p}" == *..* ]]; then
    echo "${name} must be an absolute path of [A-Za-z0-9._/-] (got '${p}')" >&2
    return 1
  fi
  return 0
}

# render_unit TEMPLATE SERVICE_USER SERVICE_GROUP INSTALL_ROOT ENV_FILE NODE_BIN -> unit on stdout.
render_unit() {
  local template="$1" user="$2" group="$3" root="$4" envf="$5" node="$6"
  validate_service_user_name "${user}" || return 1
  validate_service_user_name "${group}" || return 1
  check_abs_path INSTALL_ROOT "${root}" || return 1
  check_abs_path ENV_FILE "${envf}" || return 1
  check_node_bin "${node}" || return 1
  [[ -f "${template}" ]] || { echo "unit template missing: ${template}" >&2; return 1; }
  sed \
    -e '/^# TEMPLATE-ONLY/d' \
    -e "s|@SERVICE_USER@|${user}|g" \
    -e "s|@SERVICE_GROUP@|${group}|g" \
    -e "s|@INSTALL_ROOT@|${root}|g" \
    -e "s|@ENV_FILE@|${envf}|g" \
    -e "s|@NODE_BIN@|${node}|g" \
    "${template}"
}

# Code tree: root-owned, group-readable by the service group, not writable by the service.
apply_code_tree_permissions() {
  local root="$1" group="$2"
  chown -R root:"${group}" "${root}"
  chmod -R u=rwX,g=rX,o= "${root}"
}

# Env file: read by systemd (PID 1, root) via EnvironmentFile= before privileges drop,
# so the service account never needs direct read access.
apply_env_file_permissions() {
  local envf="$1"
  chown root:root "${envf}"
  chmod 0600 "${envf}"
}

# Install production deps + tsx (runtime TS loader is a devDependency) without running
# third-party lifecycle scripts as root; then apply our own RouterOS 7 `!empty` patch.
npm_install_locked() {
  local root="$1"
  (cd "${root}" && npm ci --include=dev --ignore-scripts --no-audit --no-fund && node scripts/patch-node-routeros.cjs)
}
