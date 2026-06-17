#!/bin/bash

# Ribix IDE binary installer for Linux/macOS.

set -euo pipefail

REPO="ch1kim0n1/ribix-ide"
INSTALL_ROOT="${HOME}/.ribix-ide"
APP_ROOT="${INSTALL_ROOT}/app"
BIN_DIR="${HOME}/.local/bin"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd curl
require_cmd python3

OS="$(uname -s)"
ARCH="$(uname -m)"

case "${OS}" in
  Linux)
    case "${ARCH}" in
      x86_64|amd64) ASSET_NAME="RibixIDE-linux-x64.tar.gz" ;;
      *)
        echo "Unsupported Linux architecture: ${ARCH}" >&2
        exit 1
        ;;
    esac
    ;;
  Darwin)
    case "${ARCH}" in
      arm64) ASSET_NAME="RibixIDE-arm64.dmg" ;;
      x86_64) ASSET_NAME="RibixIDE-x64.dmg" ;;
      *)
        echo "Unsupported macOS architecture: ${ARCH}" >&2
        exit 1
        ;;
    esac
    ;;
  *)
    echo "Unsupported operating system: ${OS}" >&2
    exit 1
    ;;
esac

echo "Fetching latest release metadata for ${REPO}..."
RELEASE_JSON="${TMP_DIR}/release.json"
curl -fsSL \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/${REPO}/releases/latest" \
  -o "${RELEASE_JSON}"

DOWNLOAD_URL="$(python3 - "${RELEASE_JSON}" "${ASSET_NAME}" <<'PY'
import json
import sys

release_path, asset_name = sys.argv[1], sys.argv[2]
with open(release_path, "r", encoding="utf-8") as fh:
    payload = json.load(fh)

for asset in payload.get("assets", []):
    if asset.get("name") == asset_name:
        print(asset["browser_download_url"])
        break
else:
    raise SystemExit(f"Could not find asset {asset_name!r} in latest release.")
PY
)"

mkdir -p "${INSTALL_ROOT}"
ARCHIVE_PATH="${TMP_DIR}/${ASSET_NAME}"

echo "Downloading ${ASSET_NAME}..."
curl -fL "${DOWNLOAD_URL}" -o "${ARCHIVE_PATH}"

rm -rf "${APP_ROOT}"
mkdir -p "${APP_ROOT}"

if [[ "${OS}" == "Linux" ]]; then
  echo "Extracting Linux build..."
  tar -xzf "${ARCHIVE_PATH}" -C "${APP_ROOT}"
  mkdir -p "${BIN_DIR}"
  cat > "${BIN_DIR}/ribix-ide" <<EOF
#!/bin/sh
exec "${APP_ROOT}/VSCode-linux-x64/code" "\$@"
EOF
  chmod +x "${BIN_DIR}/ribix-ide"

  mkdir -p "${HOME}/.local/share/applications"
  cat > "${HOME}/.local/share/applications/ribix-ide.desktop" <<EOF
[Desktop Entry]
Name=Ribix IDE
Comment=Agent-first software engineering OS
Exec=${BIN_DIR}/ribix-ide
Terminal=false
Type=Application
Categories=Development;IDE;
EOF

  echo "Installed to ${APP_ROOT}/VSCode-linux-x64"
  echo "Launcher created at ${BIN_DIR}/ribix-ide"
else
  require_cmd hdiutil

  echo "Mounting macOS disk image..."
  MOUNT_POINT="${TMP_DIR}/mount"
  mkdir -p "${MOUNT_POINT}"
  hdiutil attach "${ARCHIVE_PATH}" -mountpoint "${MOUNT_POINT}" -nobrowse >/dev/null
  trap 'hdiutil detach "${MOUNT_POINT}" >/dev/null 2>&1 || true; cleanup' EXIT

  APP_SOURCE="$(find "${MOUNT_POINT}" -maxdepth 1 -name '*.app' -print -quit)"
  if [[ -z "${APP_SOURCE}" ]]; then
    echo "Could not locate Ribix IDE.app inside ${ASSET_NAME}" >&2
    exit 1
  fi

  DEST_DIR="/Applications"
  if [[ ! -w "${DEST_DIR}" ]]; then
    DEST_DIR="${HOME}/Applications"
    mkdir -p "${DEST_DIR}"
  fi

  rm -rf "${DEST_DIR}/Ribix IDE.app"
  cp -R "${APP_SOURCE}" "${DEST_DIR}/Ribix IDE.app"
  hdiutil detach "${MOUNT_POINT}" >/dev/null
  trap cleanup EXIT

  mkdir -p "${BIN_DIR}"
  cat > "${BIN_DIR}/ribix-ide" <<EOF
#!/bin/sh
open -a "${DEST_DIR}/Ribix IDE.app" --args "\$@"
EOF
  chmod +x "${BIN_DIR}/ribix-ide"

  echo "Installed to ${DEST_DIR}/Ribix IDE.app"
  echo "Launcher created at ${BIN_DIR}/ribix-ide"
fi

echo
echo "Installation complete."
