#!/usr/bin/env bash
# Disposable PostgreSQL + MinIO backends for integration tests.
# Nothing here touches a business database: both containers are created empty,
# named `reviewdesk-test-*`, and removed by `down`.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

PG_CONTAINER=reviewdesk-test-pg
S3_CONTAINER=reviewdesk-test-minio
PG_PORT="${REVIEWDESK_TEST_PG_PORT:-55432}"
S3_PORT="${REVIEWDESK_TEST_S3_PORT:-59000}"

up() {
  docker rm -f "$PG_CONTAINER" "$S3_CONTAINER" >/dev/null 2>&1 || true
  docker run -d --name "$PG_CONTAINER" \
    -e POSTGRES_USER=reviewdesk -e POSTGRES_PASSWORD=reviewdesk -e POSTGRES_DB=reviewdesk \
    -p "127.0.0.1:${PG_PORT}:5432" postgres:16-alpine >/dev/null
  docker run -d --name "$S3_CONTAINER" \
    -e MINIO_ROOT_USER=reviewdeskkey -e MINIO_ROOT_PASSWORD=reviewdesksecret \
    -p "127.0.0.1:${S3_PORT}:9000" quay.io/minio/minio:latest server /data >/dev/null

  for _ in $(seq 1 60); do
    docker exec "$PG_CONTAINER" pg_isready -q -U reviewdesk >/dev/null 2>&1 && break
    sleep 1
  done
  docker exec "$PG_CONTAINER" pg_isready -q -U reviewdesk

  for _ in $(seq 1 60); do
    curl -fsS -o /dev/null "http://127.0.0.1:${S3_PORT}/minio/health/live" && break
    sleep 1
  done
  curl -fsS -o /dev/null "http://127.0.0.1:${S3_PORT}/minio/health/live"

  cd "$ROOT"
  S3_ENDPOINT="http://127.0.0.1:${S3_PORT}" \
  S3_BUCKET="${REVIEWDESK_TEST_S3_BUCKET:-reviewdesk-test}" \
  S3_ACCESS_KEY_ID=reviewdeskkey S3_SECRET_ACCESS_KEY=reviewdesksecret S3_REGION=us-east-1 \
    npx tsx scripts/ensure-bucket.ts
}

down() {
  docker rm -f "$PG_CONTAINER" "$S3_CONTAINER" >/dev/null 2>&1 || true
}

case "${1:-up}" in
  up) up ;;
  down) down ;;
  *) printf 'usage: %s [up|down]\n' "$0" >&2; exit 2 ;;
esac
