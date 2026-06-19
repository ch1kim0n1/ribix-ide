#!/bin/bash

# Ribix IDE binary installer for Linux/macOS.
# Downloads and installs the latest pre-built binary release.

set -euo pipefail

REPO="ch1kim0n1/ribix-ide"
INSTALL_ROOT="${HOME}/.ribix-ide"
APP_ROOT="${INSTALL_ROOT}/app"
BIN_DIR="${HOME}/.local/bin"
TMP_DIR="$(mktemp -d)"

# --- Progress tracking ---
TOTAL_STEPS=5
CURRENT_STEP=0

step_start() {
  CURRENT_STEP=$((CURRENT_STEP + 1))
  STEP_START_TIME=$(date +%s)
  printf "\n[%d/%d] %s ... " "$CURRENT_STEP" "$TOTAL_STEPS" "$1"
}

step_done() {
  local elapsed=$(( $(date +%s) - STEP_START_TIME ))
  printf "done (%ds)\n" "$elapsed"
}

step_fail() {
  local elapsed=$(( $(date +%s) - STEP_START_TIME ))
  printf "FAILED (%ds)\n" "$elapsed"
}

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

echo ""
echo "================================"
echo "  Ribix IDE Installer"
echo "  Platform: ${OS} ${ARCH}"
echo "================================"

step_start "Fetching release metadata"
RELEASE_JSON="${TMP_DIR}/release.json"
curl -fsSL \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/${REPO}/releases/latest" \
  -o "${RELEASE_JSON}"
step_done

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

step_start "Downloading ${ASSET_NAME}"
curl -fL "${DOWNLOAD_URL}" -o "${ARCHIVE_PATH}"
step_done

rm -rf "${APP_ROOT}"
mkdir -p "${APP_ROOT}"

step_start "Installing"
if [[ "${OS}" == "Linux" ]]; then
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

  INSTALL_LOCATION="${APP_ROOT}/VSCode-linux-x64"
  LAUNCHER_LOCATION="${BIN_DIR}/ribix-ide"
else
  require_cmd hdiutil

  MOUNT_POINT="${TMP_DIR}/mount"
  mkdir -p "${MOUNT_POINT}"
  hdiutil attach "${ARCHIVE_PATH}" -mountpoint "${MOUNT_POINT}" -nobrowse >/dev/null
  trap 'hdiutil detach "${MOUNT_POINT}" >/dev/null 2>&1 || true; cleanup' EXIT

  APP_SOURCE="$(find "${MOUNT_POINT}" -maxdepth 1 -name '*.app' -print -quit)"
  if [[ -z "${APP_SOURCE}" ]]; then
    step_fail
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

  INSTALL_LOCATION="${DEST_DIR}/Ribix IDE.app"
  LAUNCHER_LOCATION="${BIN_DIR}/ribix-ide"
fi
step_done

step_start "Verifying installation"
if [[ "${OS}" == "Linux" ]]; then
  if [[ ! -x "${APP_ROOT}/VSCode-linux-x64/code" ]]; then
    step_fail
    echo "Verification failed: binary not found at expected location" >&2
    exit 1
  fi
else
  if [[ ! -d "${DEST_DIR}/Ribix IDE.app" ]]; then
    step_fail
    echo "Verification failed: app bundle not found" >&2
    exit 1
  fi
fi
step_done

step_start "Creating launcher"
# Launcher already created above — this step is for user visibility
step_done

echo ""
echo "================================"
echo "  Installation Complete!"
echo "================================"
echo ""
echo "  Installed to: ${INSTALL_LOCATION}"
echo "  Launcher:     ${LAUNCHER_LOCATION}"
echo ""
echo "  Run 'ribix-ide' to start the IDE."
echo "  On first launch, the onboarding wizard will guide you through setup."
echo ""
