#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
npx playwright install chromium >/dev/null
if command -v ldconfig >/dev/null 2>&1 && ldconfig -p 2>/dev/null | grep -F libnspr4 >/dev/null && ldconfig -p 2>/dev/null | grep -F libnss3 >/dev/null; then
  exit 0
fi
DEST="$ROOT/.deps"
if [ -f "$DEST/root/usr/lib/x86_64-linux-gnu/libnspr4.so" ] && [ -f "$DEST/root/usr/lib/x86_64-linux-gnu/libnss3.so" ]; then
  exit 0
fi
command -v apt-get >/dev/null 2>&1 || { printf '%s\n' 'Missing libnspr4/libnss3 and apt-get is unavailable.' >&2; exit 1; }
mkdir -p "$DEST"
cd "$DEST"
apt-get download libnspr4 libnss3
for archive in ./*.deb; do dpkg-deb -x "$archive" root; done
