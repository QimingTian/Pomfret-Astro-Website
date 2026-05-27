#!/usr/bin/env bash
# Create a venv for camera_service (avoids PEP 668 "externally-managed-environment" on Pi OS).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENV="${ROOT}/.venv-camera"

if ! python3 -m venv --help >/dev/null 2>&1; then
  echo "Installing python3-venv (required once)..."
  sudo apt update
  sudo apt install -y python3-venv python3-full
fi

echo "Creating venv at ${VENV}"
python3 -m venv "${VENV}"

echo "Installing dependencies..."
"${VENV}/bin/pip" install --upgrade pip
"${VENV}/bin/pip" install -r "${ROOT}/camera_service_requirements.txt"

echo ""
echo "Done. Use this Python for vista-camera.service:"
echo "  ${VENV}/bin/python3 ${ROOT}/camera_service.py"
echo ""
echo "Example systemd ExecStart:"
echo "  ExecStart=${VENV}/bin/python3 ${ROOT}/camera_service.py"
