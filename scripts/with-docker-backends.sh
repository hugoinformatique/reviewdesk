#!/usr/bin/env bash
# Runs a command with TEST_DATABASE_URL / TEST_S3_* pointing at the disposable
# Docker backends, starting them first and tearing them down afterwards.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PG_PORT="${REVIEWDESK_TEST_PG_PORT:-55432}"
S3_PORT="${REVIEWDESK_TEST_S3_PORT:-59000}"
KEEP="${REVIEWDESK_KEEP_BACKENDS:-0}"

bash scripts/docker-backends.sh up

cleanup() {
  [ "$KEEP" = "1" ] || bash scripts/docker-backends.sh down
}
trap cleanup EXIT

TEST_DATABASE_URL="postgres://reviewdesk:reviewdesk@127.0.0.1:${PG_PORT}/reviewdesk" \
TEST_S3_ENDPOINT="http://127.0.0.1:${S3_PORT}" \
TEST_S3_BUCKET="${REVIEWDESK_TEST_S3_BUCKET:-reviewdesk-test}" \
TEST_S3_ACCESS_KEY_ID=reviewdeskkey \
TEST_S3_SECRET_ACCESS_KEY=reviewdesksecret \
TEST_S3_REGION=us-east-1 \
  "$@"
