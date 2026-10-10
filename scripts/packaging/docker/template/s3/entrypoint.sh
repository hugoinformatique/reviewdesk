#!/bin/sh
# ReviewDesk — bundled S3 (SeaweedFS) start-up. Runs as root inside the `s3-storage`
# container only long enough to read the Compose secrets: it writes the
# SeaweedFS identity file and a copy of the TLS key into the container tmpfs
# (never into the image, the volume or the logs), then runs SeaweedFS as the
# unprivileged `seaweed` user. The container has no network interface
# (network_mode: none): every SeaweedFS listener, the S3 gRPC port (18444, whose
# IAM RPCs are unauthenticated without a filer signing key) included, exists on
# its loopback only. The S3 API leaves the container through the Unix socket
# /run/reviewdesk-s3/s3.sock (s3socket volume), served in HTTPS on the network
# by the `s3` gateway. On loopback, the primary S3 port 8444 is HTTPS only
# (-s3.port.https=0: no plaintext HTTP listener).
set -eu
umask 077
die() { printf 'ReviewDesk (S3 intégré) : %s\n' "$*" >&2; exit 1; }

# secret NOM MOTIF : prints the value to a command substitution, never to a log.
secret() {
  [ -r "/run/secrets/$1" ] || die "secret manquant : $1 (relancez sh install.sh)."
  value=$(cat "/run/secrets/$1")
  printf '%s' "$value" | grep -Eqx -- "$2" || die "secret invalide : $1."
  printf '%s' "$value"
}
# as_seaweed FICHIER < contenu : file owned by `seaweed`, mode 600.
# shellcheck disable=SC2016 # $1 expands in the inner shell, on purpose.
as_seaweed() { su-exec seaweed sh -c 'umask 077; cat > "$1"' sh "$1"; }

bucket=${S3_BUCKET:-}
printf '%s' "$bucket" | grep -Eqx '[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]' || die "S3_BUCKET invalide."
case "$bucket" in *..*) die "S3_BUCKET invalide." ;; esac
app_key=$(secret s3_access_key_id '[A-Za-z0-9]{16,128}')
app_secret=$(secret s3_secret_access_key '[A-Za-z0-9]{32,128}')
admin_key=$(secret s3_admin_access_key_id '[A-Za-z0-9]{16,128}')
admin_secret=$(secret s3_admin_secret_access_key '[A-Za-z0-9]{32,128}')
[ "$app_key" != "$admin_key" ] || die "les identités S3 application et initialisation doivent être distinctes."
grep -q -- '-----BEGIN PRIVATE KEY-----' /run/secrets/s3_tls_key 2>/dev/null || die "secret invalide ou manquant : s3_tls_key."
grep -q -- '-----BEGIN CERTIFICATE-----' /etc/reviewdesk/certs/s3.pem 2>/dev/null || die "certificat certs/s3.pem manquant."
[ "$(stat -c %U /data)" = seaweed ] || die "le volume /data doit appartenir à l'utilisateur seaweed du conteneur."
[ "$(stat -c %U /run/reviewdesk-s3)" = seaweed ] || die "le volume s3socket doit appartenir à l'utilisateur seaweed (UID 1000)."

run=/tmp/reviewdesk-s3
[ -d "$run" ] || su-exec seaweed mkdir -m 700 "$run"
# Two identities, both limited to the bucket: `reviewdesk-init` may create it
# (s3-init service), `reviewdesk-app` reads and writes objects. No anonymous access.
printf '{"identities":[{"name":"reviewdesk-init","credentials":[{"accessKey":"%s","secretKey":"%s"}],"actions":["Admin:%s"]},{"name":"reviewdesk-app","credentials":[{"accessKey":"%s","secretKey":"%s"}],"actions":["Read:%s","Write:%s","List:%s"]}]}\n' \
  "$admin_key" "$admin_secret" "$bucket" "$app_key" "$app_secret" "$bucket" "$bucket" "$bucket" | as_seaweed "$run/s3.json"
as_seaweed "$run/tls.key" < /run/secrets/s3_tls_key
as_seaweed "$run/tls.pem" < /etc/reviewdesk/certs/s3.pem
unset app_key app_secret admin_key admin_secret value

exec su-exec seaweed weed server \
  -dir=/data \
  -ip=127.0.0.1 -ip.bind=127.0.0.1 \
  -master.telemetry=false \
  -s3 -s3.ip.bind=127.0.0.1 -s3.port=8444 -s3.port.https=0 -s3.port.grpc=18444 \
  -s3.localSocket=/run/reviewdesk-s3/s3.sock \
  -s3.cert.file="$run/tls.pem" -s3.key.file="$run/tls.key" \
  -s3.config="$run/s3.json" \
  -s3.autoCreateBucket=false -s3.iam=false \
  -s3.port.iceberg=0 -s3.port.lance=0
