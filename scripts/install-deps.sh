#!/usr/bin/env bash
# Install system dependencies for dsh-computer-use on Debian/Ubuntu.
#
# Usage: sudo bash scripts/install-deps.sh
#
# Installs the X11 libraries and ImageMagick used by xc.py. No Python packages
# are required — the helper uses only the standard library + ctypes.
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo bash $0" >&2
  exit 1
fi

apt-get update
apt-get install -y --no-install-recommends \
  python3 \
  libx11-6 \
  libxtst6 \
  imagemagick

echo
echo "Dependencies installed. Verify with:"
echo "  python3 xc.py info"
echo
echo "Expect output containing \"xtest\": true. If Information Technology is not your"
echo "session, launch the agent in a graphical X11 session (DISPLAY set)."
