#!/bin/sh
# ReviewDesk — initialisation de la configuration Docker Compose.
# Prérequis hôte : un shell POSIX, openssl et Docker Compose. Rien d'autre.
# Crée .env (paramètres non secrets) et secrets/ (un fichier par secret),
# en droits 600/700. Par défaut, le stockage S3 est intégré (SeaweedFS) :
# le script génère ses clés d'accès et son TLS interne (certs/ca.pem,
# certs/s3.pem, clé privée dans secrets/s3_tls_key ; la clé de l'autorité est
# jetée). Une configuration existante n'est jamais écrasée ni régénérée.
set -eu
umask 077
LC_ALL=C
export LC_ALL
cd "$(dirname "$0")"

SECRETS="admin_password postgres_password s3_access_key_id s3_secret_access_key"
# Bundled S3 only: init identity (creates the bucket) and the S3 TLS private key.
BUNDLED_SECRETS="s3_admin_access_key_id s3_admin_secret_access_key s3_tls_key"
CA_DIR=/etc/reviewdesk/certs
BUNDLED_ENDPOINT=https://s3:8443
BUNDLED_CA="$CA_DIR/ca.pem"
BUNDLED_PROFILE=bundled-s3
NL='
'
CR=$(printf '\r')

die() { printf 'Erreur : %s\n' "$*" >&2; exit 2; }
say() { printf '%s\n' "$*"; }

usage() {
  cat <<'EOF'
Usage : sh install.sh [options]

Par défaut, le stockage S3 est intégré (aucun compte cloud, aucune valeur S3
à fournir) : sh install.sh --non-interactive --port 48300

  --non-interactive            Ne rien demander ; échouer si une valeur manque.
  --port PORT                  Port local 127.0.0.1 de l'application (1024-65535, défaut 48300).
  --s3-bucket NOM              Bucket S3 privé (défaut intégré : reviewdesk-captures).
  --s3-key-prefix PREFIXE      Préfixe des objets (défaut : uploads).

S3 externe (facultatif) : --s3-endpoint active ce mode et les options suivantes.
  --s3-endpoint URL            Point d'accès S3 exact, https://hôte[:port] (HTTP refusé).
  --s3-region REGION           Région S3 (défaut : auto).
  --s3-path-style true|false   Adressage par chemin (défaut : true).
  --s3-credentials-file FICHIER  Fichier contenant S3_ACCESS_KEY_ID=... et S3_SECRET_ACCESS_KEY=...
  --s3-credentials-stdin       Lire ces deux lignes sur l'entrée standard.
  --ca-file NOM                Certificat PEM d'une autorité privée, placé dans certs/.

Relancer le script sans option vérifie une configuration existante sans la modifier.
EOF
}

single_line() {
  case "$1" in *"$NL"*|*"$CR"*) return 1 ;; esac
}
matches() { # matches VALEUR REGEX
  single_line "$1" && printf '%s\n' "$1" | grep -Eq "$2"
}
valid_port() {
  case "$1" in ''|0*|*[!0-9]*) return 1 ;; esac
  [ "${#1}" -le 5 ] && [ "$1" -ge 1024 ] && [ "$1" -le 65535 ]
}
# Same rule as the runtime (app/runtime-config.mjs): the value must already be in
# the canonical form a URL parser keeps byte for byte — lowercase host, no default
# :443, no leading zero in the port, and numeric hosts only as dotted-quad IPv4.
valid_endpoint() {
  case "$1" in https://*) ;; *) return 1 ;; esac
  rest=${1#https://}
  matches "$rest" '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[1-9][0-9]{0,4})?$' || return 1
  case "$rest" in
    *:*) port_part=${rest##*:}; host_part=${rest%:*}
         [ "$port_part" -le 65535 ] && [ "$port_part" != 443 ] || return 1 ;;
    *) host_part=$rest ;;
  esac
  last_label=${host_part##*.}
  case "$last_label" in
    *[!0-9]*) case "$last_label" in 0x*) return 1 ;; esac ;;
    *) valid_ipv4 "$host_part" ;;
  esac
}
valid_ipv4() {
  matches "$1" '^(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})$' || return 1
  old_ifs=$IFS; IFS=.
  # shellcheck disable=SC2086
  set -- $1
  IFS=$old_ifs
  for octet in "$@"; do [ "$octet" -le 255 ] || return 1; done
}
valid_bucket() {
  case "$1" in *..*) return 1 ;; esac
  matches "$1" '^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$'
}
valid_region() { matches "$1" '^[a-z0-9-]{1,32}$'; }
valid_bool() { [ "$1" = true ] || [ "$1" = false ]; }
valid_prefix() { matches "$1" '^[A-Za-z0-9._-]{1,64}$'; }
valid_credential() { matches "$1" '^[!-~]{1,256}$'; }
valid_ca_name() {
  matches "$1" '^[A-Za-z0-9][A-Za-z0-9._-]*\.(pem|crt)$' || return 1
  [ -f "certs/$1" ] && [ ! -L "certs/$1" ] || return 1
  grep -q -- '-----BEGIN CERTIFICATE-----' "certs/$1" || return 1
  ! grep -q -- 'PRIVATE KEY' "certs/$1"
}
is_private() { # is_private CHEMIN DROITS_ATTENDUS (ex. -rw-------)
  [ ! -L "$1" ] && [ "$(ls -ld "$1" | cut -c1-10)" = "$2" ]
}
public_cert() { # regular PEM certificate file without any private key
  [ -f "$1" ] && [ ! -L "$1" ] && grep -q -- '-----BEGIN CERTIFICATE-----' "$1" && ! grep -q -- 'PRIVATE KEY' "$1"
}

# ------------------------------------------------------------------ options
interactive=1 options=0 creds_stdin=0 external_options=''
port='' endpoint='' bucket='' region='' path_style='' prefix='' ca_file='' creds_file=''
while [ $# -gt 0 ]; do
  case "$1" in
    --non-interactive) interactive=0 ;;
    --s3-credentials-stdin) creds_stdin=1; options=1; external_options="$external_options $1" ;;
    -h|--help) usage; exit 0 ;;
    --port|--s3-endpoint|--s3-bucket|--s3-region|--s3-path-style|--s3-key-prefix|--s3-credentials-file|--ca-file)
      [ $# -ge 2 ] || die "$1 attend une valeur."
      case "$1" in
        --port) port=$2 ;;
        --s3-endpoint) endpoint=$2 ;;
        --s3-bucket) bucket=$2 ;;
        --s3-region) region=$2 ;;
        --s3-path-style) path_style=$2 ;;
        --s3-key-prefix) prefix=$2 ;;
        --s3-credentials-file) creds_file=$2 ;;
        --ca-file) ca_file=$2 ;;
      esac
      case "$1" in --s3-region|--s3-path-style|--s3-credentials-file|--ca-file) external_options="$external_options $1" ;; esac
      options=1; shift ;;
    *) die "option inconnue : $1 (voir --help)." ;;
  esac
  shift
done

# ------------------------------------------------------------------- verrou
# Exclusive lock (atomic mkdir) taken before reading or checking anything, held
# until exit: two concurrent runs can neither both pass the checks nor
# interleave their files. Only the run that created it removes it.
LOCK=.reviewdesk-install.lock
staging=''
locked=0
cleanup() {
  stty echo 2>/dev/null || true
  [ -z "$staging" ] || rm -rf "$staging"
  [ "$locked" = 0 ] || rmdir "$LOCK" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT TERM HUP
mkdir "$LOCK" 2>/dev/null || die "une autre installation est en cours (verrou $LOCK). Si aucune ne tourne, supprimez ce dossier puis relancez."
locked=1

# --------------------------------------------------- configuration existante
# A bundled configuration also owns its S3 identities and TLS files. Without
# .env, any of them present is a partial configuration, never a fresh start.
env_mode=''
if [ -f .env ] && [ ! -L .env ]; then env_mode=$(sed -n 's/^REVIEWDESK_S3=//p' .env | head -n 1); fi
secrets=$SECRETS
[ "$env_mode" != bundled ] || secrets="$SECRETS $BUNDLED_SECRETS"
bundled_markers="$(for s in $BUNDLED_SECRETS; do printf 'secrets/%s ' "$s"; done)certs/s3.pem"
present='' absent=''
for f in .env $(for s in $secrets; do printf 'secrets/%s ' "$s"; done); do
  if [ -e "$f" ] || [ -L "$f" ]; then present="$present $f"; else absent="$absent $f"; fi
done
if [ "$env_mode" = bundled ]; then
  for f in certs/ca.pem certs/s3.pem; do
    if [ -e "$f" ] || [ -L "$f" ]; then present="$present $f"; else absent="$absent $f"; fi
  done
else
  for f in $bundled_markers; do
    if [ -e "$f" ] || [ -L "$f" ]; then present="$present $f"; fi
  done
fi

check_env_file() {
  seen='' env_s3='' env_profiles='' env_endpoint='' env_ca='' env_path_style=''
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue ;; esac
    single_line "$line" || die ".env : retour chariot interdit."
    key=${line%%=*} value=${line#*=}
    matches "$key" '^[A-Z_][A-Z0-9_]*$' && [ "$key" != "$line" ] || die ".env : ligne invalide."
    case " $seen " in *" $key "*) die ".env : $key défini deux fois." ;; esac
    seen="$seen $key"
    case "$key" in
      REVIEWDESK_CONFIGURED) [ "$value" = 1 ] || die ".env : REVIEWDESK_CONFIGURED doit valoir 1." ;;
      REVIEWDESK_HTTP_PORT) valid_port "$value" || die ".env : REVIEWDESK_HTTP_PORT invalide (1024-65535)." ;;
      REVIEWDESK_S3) case "$value" in bundled|external) env_s3=$value ;; *) die ".env : REVIEWDESK_S3 doit valoir bundled ou external." ;; esac ;;
      COMPOSE_PROFILES) case "$value" in ''|"$BUNDLED_PROFILE") env_profiles=$value ;; *) die ".env : COMPOSE_PROFILES doit être vide ou valoir $BUNDLED_PROFILE." ;; esac ;;
      S3_ENDPOINT) valid_endpoint "$value" || die ".env : S3_ENDPOINT doit être exactement https://hôte[:port] (HTTP refusé)."; env_endpoint=$value ;;
      S3_BUCKET) valid_bucket "$value" || die ".env : S3_BUCKET invalide." ;;
      S3_REGION) valid_region "$value" || die ".env : S3_REGION invalide." ;;
      S3_FORCE_PATH_STYLE) valid_bool "$value" || die ".env : S3_FORCE_PATH_STYLE doit valoir true ou false."; env_path_style=$value ;;
      S3_KEY_PREFIX) valid_prefix "$value" || die ".env : S3_KEY_PREFIX invalide." ;;
      NODE_EXTRA_CA_CERTS)
        env_ca=$value
        if [ -n "$value" ]; then
          case "$value" in "$CA_DIR"/*) ;; *) die ".env : NODE_EXTRA_CA_CERTS doit pointer dans $CA_DIR." ;; esac
          valid_ca_name "${value#"$CA_DIR"/}" || die ".env : certificat d'autorité introuvable ou invalide dans certs/."
        fi ;;
      *) die ".env : clé inconnue $key." ;;
    esac
  done < .env
  for key in REVIEWDESK_CONFIGURED REVIEWDESK_HTTP_PORT S3_ENDPOINT S3_BUCKET S3_REGION S3_FORCE_PATH_STYLE; do
    case " $seen " in *" $key "*) ;; *) die ".env : $key manquant." ;; esac
  done
  # Previous installer (before the bundled S3): neither REVIEWDESK_S3 nor
  # COMPOSE_PROFILES, external S3 only. Accepted as is, never rewritten.
  env_legacy=0
  case " $seen " in
    *" REVIEWDESK_S3 "*) ;;
    *) case " $seen " in *" COMPOSE_PROFILES "*) die ".env : REVIEWDESK_S3 manquant (bundled ou external) alors que COMPOSE_PROFILES est défini." ;; esac
       env_legacy=1 env_s3=external ;;
  esac
  if [ "$env_s3" = bundled ]; then
    [ "$env_profiles" = "$BUNDLED_PROFILE" ] || die ".env : S3 intégré : COMPOSE_PROFILES=$BUNDLED_PROFILE est requis (sinon le service s3 ne démarre pas)."
    [ "$env_endpoint" = "$BUNDLED_ENDPOINT" ] || die ".env : S3 intégré : S3_ENDPOINT doit valoir $BUNDLED_ENDPOINT."
    [ "$env_ca" = "$BUNDLED_CA" ] || die ".env : S3 intégré : NODE_EXTRA_CA_CERTS doit valoir $BUNDLED_CA."
    [ "$env_path_style" = true ] || die ".env : S3 intégré : S3_FORCE_PATH_STYLE doit valoir true."
  else
    [ -z "$env_profiles" ] || die ".env : S3 externe : COMPOSE_PROFILES doit rester vide."
  fi
}

if [ -n "$present" ]; then
  [ -z "$absent" ] || die "configuration partielle (incomplète) : manque${absent}. Rien n'a été modifié ; restaurez ces fichiers depuis votre sauvegarde."
  [ "$options" = 0 ] || die "une configuration existe déjà ; elle n'est jamais écrasée. Modifiez .env à la main ou partez d'un dossier vierge."
  is_private .env -rw------- || die ".env doit être un fichier en droits 600 (chmod 600 .env)."
  is_private secrets drwx------ || die "secrets/ doit être un dossier en droits 700 (chmod 700 secrets)."
  for s in $secrets; do
    f="secrets/$s"
    is_private "$f" -rw------- || die "$f doit être un fichier en droits 600 (chmod 600 $f)."
    [ "$s" = s3_tls_key ] && continue
    [ -s "$f" ] && [ "$(grep -c '' "$f")" = 1 ] && ! grep -q "$CR" "$f" || die "$f doit contenir une seule ligne non vide."
  done
  check_env_file
  if [ "$env_s3" = bundled ]; then
    grep -q -- '-----BEGIN PRIVATE KEY-----' secrets/s3_tls_key || die "secrets/s3_tls_key ne contient pas de clé privée PEM."
    for f in certs/ca.pem certs/s3.pem; do public_cert "$f" || die "$f doit être un certificat PEM (sans clé privée)."; done
    command -v openssl >/dev/null 2>&1 || die "openssl est requis pour vérifier le certificat TLS du S3 intégré."
    openssl verify -CAfile certs/ca.pem -verify_hostname s3 -purpose sslserver certs/s3.pem >/dev/null 2>&1 \
      || die "certs/s3.pem n'est pas valide pour le nom s3 avec l'autorité certs/ca.pem (expiré, remplacé ou incohérent). Restaurez certs/ depuis votre sauvegarde."
    [ "$(openssl pkey -in secrets/s3_tls_key -pubout 2>/dev/null)" = "$(openssl x509 -in certs/s3.pem -noout -pubkey 2>/dev/null)" ] \
      || die "secrets/s3_tls_key ne correspond pas à certs/s3.pem. Restaurez secrets/ et certs/ depuis la même sauvegarde."
  fi
  say "Configuration existante conservée et vérifiée (.env, secrets/). Aucun fichier modifié."
  [ "$env_legacy" = 0 ] || say "Format de .env antérieur (sans REVIEWDESK_S3) : lu comme S3 externe, laissé tel quel."
  exit 0
fi

# ------------------------------------------------------- nouvelle configuration
command -v openssl >/dev/null 2>&1 || die "openssl est requis pour générer les mots de passe."
# Options that only make sense for an external S3 are refused rather than ignored.
if [ -z "$endpoint" ] && [ -n "$external_options" ] && { [ "$interactive" = 0 ] || [ ! -t 0 ]; }; then
  die "option(s)${external_options} réservée(s) au S3 externe : ajoutez --s3-endpoint, ou retirez-les pour le stockage S3 intégré."
fi
# New passwords and keys would lock out existing data: proceed only when Docker
# positively confirms that neither volume exists. Any doubt (no Docker, daemon
# down, permission denied) refuses.
project="${COMPOSE_PROJECT_NAME:-reviewdesk}"
volume="${project}_pgdata"
s3_volume="${project}_s3data"
command -v docker >/dev/null 2>&1 || die "Docker est introuvable : impossible de vérifier que les volumes $volume et $s3_volume n'existent pas déjà. Installez Docker (ou lancez le script avec un utilisateur autorisé) puis relancez."
volumes=$(docker volume ls -q 2>/dev/null) || die "Docker ne répond pas (démon arrêté ou droits insuffisants) : impossible de vérifier que les volumes $volume et $s3_volume n'existent pas déjà. Rien n'a été modifié."
if printf '%s\n' "$volumes" | grep -Fxq -- "$volume"; then
  die "le volume $volume existe déjà : il attend l'ancien mot de passe PostgreSQL. Restaurez l'ancien dossier secrets/ et .env au lieu d'en générer de nouveaux."
fi
if printf '%s\n' "$volumes" | grep -Fxq -- "$s3_volume"; then
  die "le volume $s3_volume existe déjà : il attend les anciennes clés S3 intégrées. Restaurez l'ancien dossier secrets/, certs/ et .env au lieu d'en générer de nouveaux."
fi

ask() { # ask VARIABLE LIBELLÉ DÉFAUT
  eval "current=\${$1}"
  [ -z "$current" ] || return 0
  if [ "$interactive" = 0 ] || [ ! -t 0 ]; then
    [ -n "$3" ] || die "$2 manquant (option requise en mode non interactif)."
    eval "$1=\$3"; return 0
  fi
  if [ -n "$3" ]; then printf '%s [%s] : ' "$2" "$3" >&2; else printf '%s : ' "$2" >&2; fi
  IFS= read -r answer || answer=''
  [ -n "$answer" ] || answer=$3
  eval "$1=\$answer"
}
hidden() { # hidden VARIABLE LIBELLÉ
  [ "$interactive" = 1 ] && [ -t 0 ] || die "$2 manquant : utilisez --s3-credentials-file ou --s3-credentials-stdin."
  printf '%s (saisie masquée) : ' "$2" >&2
  stty -echo
  IFS= read -r answer || answer=''
  stty echo
  printf '\n' >&2
  eval "$1=\$answer"
}

ask port "Port local de l'application" 48300
valid_port "$port" || die "port invalide (1024-65535)."
if [ -z "$endpoint" ] && [ "$interactive" = 1 ] && [ -t 0 ]; then
  printf "Point d'accès S3 externe https://hôte[:port] (vide = stockage S3 intégré, recommandé) : " >&2
  IFS= read -r endpoint || endpoint=''
fi
mode=external
[ -n "$endpoint" ] || mode=bundled
if [ "$mode" = bundled ]; then
  [ -z "$external_options" ] || die "option(s)${external_options} réservée(s) au S3 externe : indiquez un point d'accès externe, ou retirez-les pour le stockage S3 intégré."
  endpoint=$BUNDLED_ENDPOINT region=us-east-1 path_style=true
  for f in certs/ca.pem certs/s3.pem; do
    [ ! -e "$f" ] && [ ! -L "$f" ] || die "$f existe déjà : il n'est jamais remplacé. Déplacez-le (S3 intégré : l'autorité certs/ca.pem est générée par ce script)."
  done
fi
valid_endpoint "$endpoint" || die "S3_ENDPOINT doit être exactement https://hôte[:port] (HTTP, chemin et identifiants refusés)."
if [ "$mode" = bundled ]; then ask bucket "Bucket S3 privé" reviewdesk-captures; else ask bucket "Bucket S3 privé existant" ''; fi
valid_bucket "$bucket" || die "nom de bucket S3 invalide."
ask region "Région S3" auto
valid_region "$region" || die "région S3 invalide."
ask path_style "Adressage S3 par chemin (true/false)" true
valid_bool "$path_style" || die "--s3-path-style doit valoir true ou false."
ask prefix "Préfixe des objets" uploads
valid_prefix "$prefix" || die "préfixe d'objets invalide."
if [ "$mode" = external ] && [ -z "$ca_file" ] && [ "$interactive" = 1 ] && [ -t 0 ]; then
  printf "Certificat d'autorité privée dans certs/ (vide si aucun) : " >&2
  IFS= read -r ca_file || ca_file=''
fi
if [ -n "$ca_file" ]; then
  valid_ca_name "$ca_file" || die "certificat d'autorité invalide : un fichier .pem/.crt présent dans certs/, sans clé privée, est attendu."
fi

access_key='' secret_key=''
read_credentials() {
  n=0
  while IFS= read -r line || [ -n "$line" ]; do
    n=$((n + 1))
    line=${line%"$CR"}
    case "$line" in
      ''|'#'*) ;;
      S3_ACCESS_KEY_ID=*) [ -z "$access_key" ] || die "S3_ACCESS_KEY_ID défini deux fois."; access_key=${line#*=} ;;
      S3_SECRET_ACCESS_KEY=*) [ -z "$secret_key" ] || die "S3_SECRET_ACCESS_KEY défini deux fois."; secret_key=${line#*=} ;;
      *) die "identifiants S3 : ligne $n non reconnue (attendu S3_ACCESS_KEY_ID=... ou S3_SECRET_ACCESS_KEY=...)." ;;
    esac
  done
}
if [ "$mode" = external ]; then
  if [ -n "$creds_file" ]; then
    [ "$creds_stdin" = 0 ] || die "choisissez --s3-credentials-file ou --s3-credentials-stdin, pas les deux."
    [ -f "$creds_file" ] && [ -r "$creds_file" ] || die "fichier d'identifiants S3 illisible."
    read_credentials < "$creds_file"
  elif [ "$creds_stdin" = 1 ]; then
    read_credentials
  else
    hidden access_key "S3_ACCESS_KEY_ID"
    hidden secret_key "S3_SECRET_ACCESS_KEY"
  fi
  [ -n "$access_key" ] || die "S3_ACCESS_KEY_ID manquant."
  [ -n "$secret_key" ] || die "S3_SECRET_ACCESS_KEY manquant."
  valid_credential "$access_key" || die "S3_ACCESS_KEY_ID invalide (caractères ASCII imprimables, sans espace)."
  valid_credential "$secret_key" || die "S3_SECRET_ACCESS_KEY invalide (caractères ASCII imprimables, sans espace)."
fi

strong() {
  [ "${#1}" -ge 24 ] || return 1
  [ "$(printf '%s' "$1" | fold -w1 | sort -u | wc -l)" -ge 8 ] || return 1
  ! printf '%s\n' "$1" | grep -Eiq 'password|admin|reviewdesk|changeme|letmein|secret|12345678|qwerty'
}
generate() {
  i=0
  while [ "$i" -lt 20 ]; do
    candidate=$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | cut -c1-32)
    if strong "$candidate"; then printf '%s' "$candidate"; return 0; fi
    i=$((i + 1))
  done
  return 1
}
admin_password=$(generate) || die "génération du mot de passe administrateur impossible."
postgres_password=$(generate) || die "génération du mot de passe PostgreSQL impossible."
[ "$admin_password" != "$postgres_password" ] || die "mots de passe générés identiques ; relancez."
random_key() { # random_key LONGUEUR : alphanumeric, unique per installation
  key=$(openssl rand -base64 192 | tr -dc 'A-Za-z0-9' | cut -c1-"$1")
  [ "${#key}" = "$1" ] && printf '%s' "$key"
}
if [ "$mode" = bundled ]; then
  access_key=$(random_key 20) && secret_key=$(random_key 40) \
    && admin_access_key=$(random_key 20) && admin_secret_key=$(random_key 40) \
    || die "génération des clés S3 intégrées impossible."
  [ "$access_key" != "$admin_access_key" ] && [ "$secret_key" != "$admin_secret_key" ] || die "clés S3 générées identiques ; relancez."
fi

if [ -e secrets ] || [ -L secrets ]; then
  [ -d secrets ] && [ ! -L secrets ] && [ -z "$(ls -A secrets)" ] || die "secrets/ existe déjà et n'est pas un dossier vide."
fi
staging=$(mktemp -d ".reviewdesk-init.XXXXXX")
mkdir "$staging/secrets"
printf '%s' "$admin_password" > "$staging/secrets/admin_password"
printf '%s' "$postgres_password" > "$staging/secrets/postgres_password"
printf '%s' "$access_key" > "$staging/secrets/s3_access_key_id"
printf '%s' "$secret_key" > "$staging/secrets/s3_secret_access_key"
ca_path='' profiles=''
[ -z "$ca_file" ] || ca_path="$CA_DIR/$ca_file"
secrets=$SECRETS
if [ "$mode" = bundled ]; then
  secrets="$SECRETS $BUNDLED_SECRETS"
  ca_path=$BUNDLED_CA profiles=$BUNDLED_PROFILE
  printf '%s' "$admin_access_key" > "$staging/secrets/s3_admin_access_key_id"
  printf '%s' "$admin_secret_key" > "$staging/secrets/s3_admin_secret_access_key"
  # Internal TLS for the `s3` service name: a CA used once to sign the service
  # certificate, then discarded (staging is removed on exit), so no other
  # certificate can ever chain to certs/ca.pem. Nothing is printed.
  tls="$staging/tls"
  mkdir "$tls"
  ec='-newkey ec -pkeyopt ec_paramgen_curve:prime256v1'
  # shellcheck disable=SC2086 # $ec is a fixed list of options
  openssl req -x509 $ec -nodes -days 3650 -subj "/CN=ReviewDesk S3 interne (autorité locale)" \
    -addext 'basicConstraints=critical,CA:TRUE,pathlen:0' -addext 'keyUsage=critical,keyCertSign,cRLSign' \
    -keyout "$tls/ca.key" -out "$tls/ca.pem" >/dev/null 2>&1 || die "génération de l'autorité TLS interne impossible (openssl)."
  # shellcheck disable=SC2086
  openssl req -new $ec -nodes -subj '/CN=s3' -keyout "$tls/s3.key" -out "$tls/s3.csr" >/dev/null 2>&1 \
    || die "génération de la clé TLS du S3 intégré impossible (openssl)."
  printf 'subjectAltName=DNS:s3\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\n' > "$tls/s3.ext"
  openssl x509 -req -in "$tls/s3.csr" -CA "$tls/ca.pem" -CAkey "$tls/ca.key" -set_serial "0x$(openssl rand -hex 16)" \
    -days 3650 -extfile "$tls/s3.ext" -out "$tls/s3.pem" >/dev/null 2>&1 || die "signature du certificat TLS du S3 intégré impossible (openssl)."
  rm -f "$tls/ca.key"
  openssl verify -CAfile "$tls/ca.pem" -verify_hostname s3 -purpose sslserver "$tls/s3.pem" >/dev/null 2>&1 \
    || die "certificat TLS du S3 intégré invalide après génération."
  mv "$tls/s3.key" "$staging/secrets/s3_tls_key"
  chmod 644 "$tls/ca.pem" "$tls/s3.pem"
fi
cat > "$staging/env" <<EOF
# ReviewDesk — paramètres non secrets (généré par install.sh). Les secrets sont dans secrets/.
REVIEWDESK_CONFIGURED=1
REVIEWDESK_HTTP_PORT=$port
REVIEWDESK_S3=$mode
COMPOSE_PROFILES=$profiles
S3_ENDPOINT=$endpoint
S3_BUCKET=$bucket
S3_REGION=$region
S3_FORCE_PATH_STYLE=$path_style
S3_KEY_PREFIX=$prefix
NODE_EXTRA_CA_CERTS=$ca_path
EOF
chmod 700 "$staging/secrets"
chmod 600 "$staging/env" "$staging"/secrets/*
[ -d secrets ] || mkdir secrets
chmod 700 secrets
# `ln` refuses an existing destination (no clobber, unlike mv): even a run that
# bypassed the lock cannot replace a file. .env last: it marks completion.
for s in $secrets; do
  ln "$staging/secrets/$s" "secrets/$s" 2>/dev/null || die "secrets/$s est apparu pendant l'installation : rien n'a été écrasé ; vérifiez le dossier."
done
if [ "$mode" = bundled ]; then
  [ -d certs ] || mkdir -m 755 certs
  for f in ca.pem s3.pem; do
    ln "$tls/$f" "certs/$f" 2>/dev/null || die "certs/$f est apparu pendant l'installation : rien n'a été écrasé ; vérifiez le dossier."
  done
fi
ln "$staging/env" .env 2>/dev/null || die ".env est apparu pendant l'installation : rien n'a été écrasé ; vérifiez le dossier."

say "Configuration créée :"
say "  .env      paramètres non secrets (droits 600)"
if [ "$mode" = bundled ]; then
  say "  secrets/  mots de passe, clés S3 intégrées (application et initialisation), clé TLS s3_tls_key (700/600)"
  say "  certs/    ca.pem (autorité TLS interne, publique) et s3.pem (certificat du service s3)"
  say "Stockage S3 intégré : le bucket privé $bucket est créé au premier démarrage (service s3-init)."
else
  say "  secrets/  admin_password, postgres_password, s3_access_key_id, s3_secret_access_key (700/600)"
fi
say "Sauvegardez .env, secrets/ et certs/ ensemble, dans un coffre chiffré."
say "Aucun secret n'est affiché. Mot de passe administrateur, à lire localement :"
say "  cat secrets/admin_password"
say "Étape suivante : docker compose up -d --build"
