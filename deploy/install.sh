#!/usr/bin/env bash
# Install the local, pull-based production deployer. Run this script as root
# from a checked-out copy of this repository; it never updates the live app.
set -Eeuo pipefail
umask 022

ROOT_DIR="/opt/arknight-guess"
APP_PATH="${ROOT_DIR}/app"
APP_USER="arkguess"
DEPLOY_USER="arkdeploy"
CONFIG_PATH="/etc/arknight-deploy.json"
GAME_ENV_PATH="/etc/arknight-guess.env"
DEPLOY_ENV_PATH="/etc/arknight-deploy.env"
LOCK_PATH="${ROOT_DIR}/deploy.lock"
IMAGE_MAP_PATH="${ROOT_DIR}/image-pages.map"

die() {
  printf 'install.sh: %s\n' "$*" >&2
  exit 1
}

note() {
  printf 'install.sh: %s\n' "$*"
}

[[ "${EUID}" -eq 0 ]] || die "run as root (for example: sudo bash deploy/install.sh)"

SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
for source_file in \
  "${SOURCE_DIR}/pull_deploy.py" \
  "${SOURCE_DIR}/arknight-deploy.service" \
  "${SOURCE_DIR}/arknight-deploy.timer" \
  "${SOURCE_DIR}/arknight-deploy.example.json"; do
  [[ -f "${source_file}" ]] || die "missing deployment source file: ${source_file}"
done

for required_command in awk basename bash curl date dirname find flock getent git grep install ln mv nginx node python3 realpath runuser stat systemctl unlink useradd; do
  command -v "${required_command}" >/dev/null 2>&1 || die "required command is unavailable: ${required_command}"
done

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[[ "${NODE_MAJOR}" == "24" ]] || die "Node.js 24 is required; found $(node --version)"
[[ -x /usr/bin/node && -x /usr/bin/git && -x /usr/sbin/runuser ]] || die "expected Ubuntu Node/Git/runuser executable paths are missing"
# Parse before any migration. A partial or incompatible installer checkout must
# fail without changing the live app. ast.parse does not execute repository code.
python3 -I -c 'import ast, pathlib, sys; ast.parse(pathlib.Path(sys.argv[1]).read_text())' "${SOURCE_DIR}/pull_deploy.py"
nginx -t

id -u "${APP_USER}" >/dev/null 2>&1 || die "required application user does not exist: ${APP_USER}"
[[ "$(id -u "${APP_USER}")" != "0" ]] || die "application user must not have root UID"
APP_SHELL="$(getent passwd "${APP_USER}" | awk -F: '{print $7}')"
[[ "${APP_SHELL}" == */nologin ]] || die "${APP_USER} must be a nologin service user"
systemctl cat arknight-guess.service >/dev/null 2>&1 || die "existing arknight-guess.service was not found"
[[ -f "${GAME_ENV_PATH}" ]] || die "missing production secret file: ${GAME_ENV_PATH}"
[[ "$(stat -c '%a:%U:%G' "${GAME_ENV_PATH}")" == "600:root:root" ]] || \
  die "${GAME_ENV_PATH} must be owned by root:root with mode 0600"
grep -q '^GAME_SECRET=.' "${GAME_ENV_PATH}" || die "${GAME_ENV_PATH} does not contain GAME_SECRET"
if [[ -e "${DEPLOY_ENV_PATH}" || -L "${DEPLOY_ENV_PATH}" ]]; then
  [[ -f "${DEPLOY_ENV_PATH}" && ! -L "${DEPLOY_ENV_PATH}" ]] || die "${DEPLOY_ENV_PATH} must be a regular file"
  [[ "$(stat -c '%a:%U:%G' "${DEPLOY_ENV_PATH}")" == "600:root:root" ]] || \
    die "${DEPLOY_ENV_PATH} must be owned by root:root with mode 0600"
fi

[[ ! -L "${ROOT_DIR}" ]] || die "${ROOT_DIR} must not be a symlink"
install -d -o root -g root -m 0755 "${ROOT_DIR}"
ROOT_REAL="$(realpath -e "${ROOT_DIR}")"
[[ "${ROOT_REAL}" == "${ROOT_DIR}" ]] || die "${ROOT_DIR} must not be a symlink"

# The Nginx http-context map includes this file after the operator installs the
# provided Nginx snippets.  It is data, not a configuration file supplied by
# GitHub, and the installer deliberately never edits Nginx's site files.
if [[ -e "${IMAGE_MAP_PATH}" || -L "${IMAGE_MAP_PATH}" ]]; then
  [[ -f "${IMAGE_MAP_PATH}" && ! -L "${IMAGE_MAP_PATH}" ]] || die "${IMAGE_MAP_PATH} must be a regular file"
  [[ "$(stat -c '%a:%U:%G' "${IMAGE_MAP_PATH}")" == "644:root:root" ]] || \
    die "${IMAGE_MAP_PATH} must be owned by root:root with mode 0644"
else
  install -o root -g root -m 0644 /dev/null "${IMAGE_MAP_PATH}"
  note "created empty ${IMAGE_MAP_PATH}; Nginx keeps local images until image_pages is enabled"
fi

# Prevent a timer activation from racing the migration or a prior manual run.
if systemctl is-active --quiet arknight-deploy.timer; then
  note "stopping the existing arknight-deploy.timer during installation"
  systemctl stop arknight-deploy.timer
fi
exec 9>"${LOCK_PATH}"
flock -n 9 || die "another deployment is in progress; wait for it to finish and rerun this installer"

if ! getent passwd "${DEPLOY_USER}" >/dev/null 2>&1; then
  useradd --system --user-group --no-create-home --home-dir "${ROOT_DIR}" --shell /usr/sbin/nologin "${DEPLOY_USER}"
  note "created service account ${DEPLOY_USER}"
fi
DEPLOY_SHELL="$(getent passwd "${DEPLOY_USER}" | awk -F: '{print $7}')"
[[ "${DEPLOY_SHELL}" == */nologin ]] || die "${DEPLOY_USER} must be a nologin service user"
[[ "$(id -u "${DEPLOY_USER}")" != "0" && "$(id -u "${DEPLOY_USER}")" != "$(id -u "${APP_USER}")" ]] || die "deployment and app users must have distinct non-root UIDs"
getent group "${DEPLOY_USER}" >/dev/null 2>&1 || die "${DEPLOY_USER} must have a matching service group"

for managed_dir in "${ROOT_DIR}/releases" "${ROOT_DIR}/repository.git"; do
  if [[ -e "${managed_dir}" || -L "${managed_dir}" ]]; then
    [[ -d "${managed_dir}" && ! -L "${managed_dir}" ]] || die "managed path is not a directory: ${managed_dir}"
  else
    install -d -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" -m 0755 "${managed_dir}"
  fi
  # Completed releases stay root-owned/read-only to both service accounts.
  chown "${DEPLOY_USER}:${DEPLOY_USER}" "${managed_dir}"
done

# A first install converts the hand-managed app directory into the baseline
# release. It is deliberately a rename, never a copy or deletion.
if [[ -L "${APP_PATH}" ]]; then
  APP_TARGET="$(realpath -e "${APP_PATH}")" || die "app symlink has no existing target"
  APP_TARGET_PARENT="$(dirname -- "${APP_TARGET}")"
  if [[ "${APP_TARGET_PARENT}" == "${ROOT_REAL}/releases" ]]; then
    :
  elif [[ "${APP_TARGET_PARENT}" == "${ROOT_REAL}" && "$(basename -- "${APP_TARGET}")" == app-manual-backup-* ]]; then
    :
  else
    die "app symlink target is outside trusted deployment directories: ${APP_TARGET}"
  fi
  [[ -d "${APP_TARGET}" ]] || die "app symlink target is not a directory: ${APP_TARGET}"
elif [[ -d "${APP_PATH}" ]]; then
  APP_REAL="$(realpath -e "${APP_PATH}")"
  [[ "$(dirname -- "${APP_REAL}")" == "${ROOT_REAL}" ]] || \
    die "existing app directory must be directly under ${ROOT_DIR}: ${APP_REAL}"
  EXISTING_BACKUP="$(find "${ROOT_REAL}" -maxdepth 1 -mindepth 1 -type d -name 'app-manual-backup-*' -print -quit)"
  [[ -z "${EXISTING_BACKUP}" ]] || die "an existing manual-app backup was found: ${EXISTING_BACKUP}"
  BACKUP_NAME="app-manual-backup-$(date -u +%Y%m%dT%H%M%SZ)"
  BACKUP_PATH="${ROOT_REAL}/${BACKUP_NAME}"
  [[ ! -e "${BACKUP_PATH}" && ! -L "${BACKUP_PATH}" ]] || die "backup path already exists: ${BACKUP_PATH}"
  NEXT_LINK="${ROOT_REAL}/.app.install-next"
  [[ ! -e "${NEXT_LINK}" && ! -L "${NEXT_LINK}" ]] || die "stale install link exists: ${NEXT_LINK}"
  # Prepare the replacement first; recover the original path if the final move fails.
  ln -s -- "${BACKUP_NAME}" "${NEXT_LINK}"
  note "migrating ${APP_PATH} to ${BACKUP_PATH}; this is a short static-file path transition"
  if ! mv -- "${APP_PATH}" "${BACKUP_PATH}"; then
    unlink -- "${NEXT_LINK}"
    die "could not move the manual app; its original location was preserved"
  fi
  if ! mv -T -- "${NEXT_LINK}" "${APP_PATH}"; then
    mv -- "${BACKUP_PATH}" "${APP_PATH}"
    unlink -- "${NEXT_LINK}"
    die "could not install app symlink; restored the original directory"
  fi
else
  die "expected an existing application directory or trusted symlink at ${APP_PATH}"
fi

install -d -o root -g root -m 0755 /usr/local/lib/arknight-deploy
install -o root -g root -m 0755 "${SOURCE_DIR}/pull_deploy.py" /usr/local/lib/arknight-deploy/pull_deploy.py
install -o root -g root -m 0644 "${SOURCE_DIR}/arknight-deploy.service" /etc/systemd/system/arknight-deploy.service
install -o root -g root -m 0644 "${SOURCE_DIR}/arknight-deploy.timer" /etc/systemd/system/arknight-deploy.timer

if [[ ! -e "${CONFIG_PATH}" && ! -L "${CONFIG_PATH}" ]]; then
  install -o root -g root -m 0644 "${SOURCE_DIR}/arknight-deploy.example.json" "${CONFIG_PATH}"
  note "created ${CONFIG_PATH}; its default public_url is the local Nginx entry point"
else
  note "preserved existing ${CONFIG_PATH}; this installer never changes its public_url"
fi

systemctl daemon-reload
note "installed the deployer, but did not enable its timer or restart the live application"
note "review ${CONFIG_PATH}, then run: systemctl start arknight-deploy.service"
note "after that command succeeds, enable the daily 12:30 Asia/Shanghai check with: systemctl enable --now arknight-deploy.timer"
