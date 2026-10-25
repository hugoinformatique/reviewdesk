#!/bin/sh
# ReviewDesk — mise à jour du kit Docker en une commande.
# Prérequis hôte : un shell POSIX, Docker Compose, unzip, curl (ou wget),
# sha256sum (ou shasum). À lancer depuis le dossier d'installation courant.
# Télécharge la release, vérifie son SHA-256, l'extrait dans un dossier frère,
# y copie .env, secrets/ et certs/, sauvegarde la base AVANT toute mise à jour,
# puis redémarre la pile depuis le nouveau dossier. L'ancien dossier est
# toujours conservé ; ce script n'exécute jamais `down -v`, `volume rm`,
# `prune` ni aucune suppression de l'ancien dossier ou des volumes.
set -eu
umask 077
LC_ALL=C
export LC_ALL

REPO=${REVIEWDESK_REPOSITORY:-hugoinformatique/reviewdesk}
POLL=${REVIEWDESK_UPDATE_POLL:-5}

die() { printf 'Erreur : %s\n' "$*" >&2; exit 2; }
say() { printf '%s\n' "$*"; }

usage() {
  cat <<'EOF2'
Usage : sh update.sh [options]

À lancer depuis le dossier d'installation courant (celui qui contient
compose.yaml, .env, secrets/ et app/package.json). Par défaut, installe la
dernière release publiée sur GitHub.

  --version X.Y.Z      Installer cette version précise (format strict X.Y.Z).
  --archive CHEMIN.zip Mise à jour hors ligne depuis une archive déjà téléchargée
                       (reviewdesk-vX.Y.Z-docker.zip) ; son fichier .sha256 doit
                       se trouver à côté (CHEMIN.zip.sha256).
  --force              Réinstaller la version courante (jamais de retour vers une
                       version plus ancienne). Le dossier cible ne doit pas exister.
  --yes                Ne pas demander de confirmation avant les actions Docker.
  --skip-backup        Ne pas sauvegarder la base avant la mise à jour (déconseillé).
  --timeout SECONDES   Délai d'attente du service app « healthy » (défaut 300).
  -h, --help           Afficher cette aide.

Déroulement : vérification du dossier courant, téléchargement dans un dossier
temporaire et contrôle SHA-256 (toute erreur arrête tout avant de toucher à
l'installation), extraction dans ../reviewdesk-vX.Y.Z-docker (refusée s'il
existe), copie de .env, secrets/ et certs/ avec leurs droits, vérification de
la configuration (sh install.sh), récapitulatif et confirmation, sauvegarde
backup-AAAAMMJJ-HHMMSS.sql dans l'ANCIEN dossier (pg_dump), puis
docker compose up -d --build --force-recreate depuis le nouveau dossier et
attente du service app « healthy ».

Variable d'environnement : REVIEWDESK_REPOSITORY (défaut hugoinformatique/reviewdesk).
L'ancien dossier, les volumes et la sauvegarde ne sont jamais supprimés.
EOF2
}

# ------------------------------------------------------------------ options
target='' version_given=0 archive='' force=0 assume_yes=0 skip_backup=0 timeout=300
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --force) force=1 ;;
    --yes) assume_yes=1 ;;
    --skip-backup) skip_backup=1 ;;
    --version|--archive|--timeout)
      [ $# -ge 2 ] || die "$1 attend une valeur."
      case "$1" in
        --version) target=$2 version_given=1 ;;
        --archive) archive=$2 ;;
        --timeout) timeout=$2 ;;
      esac
      shift ;;
    *) die "option inconnue : $1 (voir --help)." ;;
  esac
  shift
done

is_version() { printf '%s\n' "$1" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; }
case "$timeout" in ''|*[!0-9]*) die "--timeout attend un nombre de secondes." ;; esac
[ "$version_given" = 0 ] || is_version "$target" || die "version invalide : « $target » (format attendu X.Y.Z)."
[ "$version_given" = 0 ] || [ -z "$archive" ] || die "choisissez --version ou --archive, pas les deux."
printf '%s\n' "$REPO" | grep -Eq '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' || die "REVIEWDESK_REPOSITORY invalide (format attendu propriétaire/dépôt)."

# ------------------------------------------------------- dossier d'installation
cd "$(dirname "$0")"
for f in compose.yaml .env secrets app/package.json; do
  [ -e "$f" ] || die "$f introuvable : lancez ce script depuis le dossier d'installation courant."
done
[ -d secrets ] || die "secrets doit être un dossier."
old_dir=$(pwd -P)
current=$(sed -n 's/^ *"version" *: *"\([^"]*\)".*/\1/p' app/package.json | head -n 1)
is_version "$current" || die "version courante illisible dans app/package.json."

# ------------------------------------------------------------------- outils
if command -v curl >/dev/null 2>&1; then fetcher=curl
elif command -v wget >/dev/null 2>&1; then fetcher=wget
else fetcher=''
fi
if command -v sha256sum >/dev/null 2>&1; then hasher='sha256sum'
elif command -v shasum >/dev/null 2>&1; then hasher='shasum -a 256'
else hasher=''
fi
[ -n "$hasher" ] || die "sha256sum (ou shasum) est requis pour vérifier l'archive."
command -v unzip >/dev/null 2>&1 || die "unzip est requis pour extraire l'archive."
command -v docker >/dev/null 2>&1 || die "Docker est introuvable."

fetch() { # fetch URL DESTINATION
  case "$fetcher" in
    curl) curl -fsSL --proto '=https' -o "$2" "$1" ;;
    wget) wget -q -O "$2" "$1" ;;
  esac
}

# ---------------------------------------------------- nettoyage (trap) et temp
work='' created_dir=''
cleanup() {
  [ -z "$work" ] || rm -rf "$work"
  # Only a directory created by this very run, and only when it failed early.
  [ -z "$created_dir" ] || rm -rf "$created_dir"
}
trap cleanup EXIT
trap 'exit 130' INT TERM HUP
work=$(mktemp -d "${TMPDIR:-/tmp}/reviewdesk-update.XXXXXX")

# ------------------------------------------------------------- version cible
auto=0
if [ -n "$archive" ]; then
  [ -f "$archive" ] || die "archive introuvable : $archive"
  name=${archive##*/}
  archive_version=$(printf '%s\n' "$name" | sed -n 's/^reviewdesk-v\([0-9]*\.[0-9]*\.[0-9]*\)-docker\.zip$/\1/p')
  is_version "$archive_version" || die "nom d'archive inattendu : reviewdesk-vX.Y.Z-docker.zip est requis."
  target=$archive_version
elif [ "$version_given" = 0 ]; then
  auto=1
  [ -n "$fetcher" ] || die "curl ou wget est requis pour interroger GitHub (ou utilisez --archive)."
  say "Recherche de la dernière version de $REPO..."
  fetch "https://api.github.com/repos/$REPO/releases/latest" "$work/latest.json" || die "impossible d'interroger GitHub (réseau ou dépôt introuvable). Rien n'a été modifié."
  tag=$(sed -n 's/.*"tag_name" *: *"\([^"]*\)".*/\1/p' "$work/latest.json" | head -n 1)
  case "$tag" in v*) target=${tag#v} ;; *) target='' ;; esac
  is_version "$target" || die "tag de release inattendu : « $tag » (format vX.Y.Z attendu)."
fi

# Compare X.Y.Z numerically: prints lt, eq or gt for « $1 relative to $2 ».
compare() {
  old_ifs=$IFS; IFS=.
  # shellcheck disable=SC2086
  set -- $1 $2
  IFS=$old_ifs
  for i in 1 2 3; do
    eval "a=\${$i} b=\${$((i + 3))}"
    if [ "$a" -lt "$b" ]; then echo lt; return; fi
    if [ "$a" -gt "$b" ]; then echo gt; return; fi
  done
  echo eq
}
order=$(compare "$target" "$current")
if [ "$order" = lt ]; then
  if [ "$auto" = 1 ]; then
    say "ReviewDesk $current est déjà à jour (dernière release : $target). Rien à faire."
    exit 0
  fi
  die "la version cible $target est plus ancienne que la version courante $current : aucun retour en arrière automatique (voir la procédure de retour arrière du guide)."
fi
if [ "$order" = eq ] && [ "$force" = 0 ]; then
  say "ReviewDesk $current est déjà à jour. Rien à faire (--force pour réinstaller la même version)."
  exit 0
fi

root="reviewdesk-v$target-docker"
new_dir="$(dirname "$old_dir")/$root"
[ ! -e "$new_dir" ] && [ ! -L "$new_dir" ] || die "$new_dir existe déjà : il n'est jamais écrasé. Déplacez-le ou renommez-le puis relancez."

# ----------------------------------------------- téléchargement et SHA-256
if [ -n "$archive" ]; then
  zip=$archive
  sumfile="$archive.sha256"
  [ -f "$sumfile" ] || die "fichier de somme introuvable : $sumfile (attendu à côté de l'archive)."
else
  [ -n "$fetcher" ] || die "curl ou wget est requis pour télécharger la release (ou utilisez --archive)."
  base="https://github.com/$REPO/releases/download/v$target"
  zip="$work/$root.zip"
  sumfile="$zip.sha256"
  say "Téléchargement de $root.zip..."
  fetch "$base/$root.zip" "$zip" || die "téléchargement de l'archive impossible. Rien n'a été modifié."
  fetch "$base/$root.zip.sha256" "$sumfile" || die "téléchargement du fichier .sha256 impossible. Rien n'a été modifié."
fi
expected=$(sed -n 's/^\([0-9a-fA-F]\{64\}\)[ *].*/\1/p' "$sumfile" | head -n 1 | tr 'A-F' 'a-f')
[ -n "$expected" ] || die "fichier .sha256 illisible (format « <sha256>  <nom>.zip » attendu)."
actual=$($hasher "$zip" | cut -d ' ' -f 1 | tr 'A-F' 'a-f')
[ "$actual" = "$expected" ] || die "somme SHA-256 de l'archive incorrecte (attendue $expected, obtenue $actual). Archive corrompue ou altérée : rien n'a été modifié."
say "SHA-256 vérifié."

# ------------------------------------------------------------ extraction
parent=$(dirname "$old_dir")
[ -w "$parent" ] || die "le dossier $parent n'est pas modifiable : impossible d'y extraire la nouvelle version."
created_dir=$new_dir
unzip -q "$zip" -d "$parent" || die "extraction impossible."
[ -f "$new_dir/compose.yaml" ] && [ -f "$new_dir/app/package.json" ] && [ -f "$new_dir/install.sh" ] || die "archive inattendue : $root/ ne contient pas le kit Docker."
new_version=$(sed -n 's/^ *"version" *: *"\([^"]*\)".*/\1/p' "$new_dir/app/package.json" | head -n 1)
[ "$new_version" = "$target" ] || die "l'archive contient la version « $new_version » et non $target."

# Configuration: permissions preserved (cp -a); the new LISEZMOI.txt is kept.
cp -a .env "$new_dir/.env"
cp -a secrets "$new_dir/secrets"
mkdir -p "$new_dir/certs"
if [ -d certs ]; then
  for f in certs/* certs/.[!.]*; do
    [ -e "$f" ] || [ -L "$f" ] || continue
    [ "${f#certs/}" != LISEZMOI.txt ] || continue
    cp -a "$f" "$new_dir/certs/"
  done
fi
# install.sh without option only verifies an existing configuration (no write).
say "Vérification de la configuration copiée..."
(cd "$new_dir" && sh install.sh) || die "la configuration copiée n'est pas valide pour la nouvelle version. L'ancien dossier est intact."

# ------------------------------------------------------ récapitulatif
backup="backup-$(date +%Y%m%d-%H%M%S).sql"
say ""
say "Mise à jour de ReviewDesk"
say "  version actuelle  : $current"
say "  nouvelle version  : $target"
say "  ancien dossier    : $old_dir (conservé)"
say "  nouveau dossier   : $new_dir"
if [ "$skip_backup" = 1 ]; then say "  sauvegarde        : IGNOREE (--skip-backup)"; else say "  sauvegarde base   : $old_dir/$backup"; fi
say "La pile Docker va être reconstruite et redémarrée depuis le nouveau dossier (brève interruption)."
if [ "$assume_yes" = 0 ]; then
  printf 'Continuer ? [o/N] ' >&2
  answer=''
  IFS= read -r answer || answer=''
  case "$answer" in o|O|oui|OUI|y|Y|yes|YES) ;; *) say "Abandon : rien n'a été modifié."; exit 1 ;; esac
fi

# ------------------------------------------------------------ sauvegarde
if [ "$skip_backup" = 0 ]; then
  say "Sauvegarde de la base..."
  if ! (cd "$old_dir" && umask 077 && docker compose exec -T postgres pg_dump -U reviewdesk reviewdesk > "$backup") || [ ! -s "$old_dir/$backup" ]; then
    rm -f "$old_dir/$backup"
    die "la sauvegarde de la base a échoué : mise à jour arrêtée, rien n'a été modifié (le service actuel doit être démarré pour la sauvegarde)."
  fi
  say "Sauvegarde écrite : $old_dir/$backup"
fi

# ------------------------------------------------------ démarrage et santé
# From here on the new folder is the installation: never removed, even on failure.
created_dir=''
say "Reconstruction et redémarrage depuis $new_dir..."
rollback_help() {
  say "Retour arrière : depuis l'ancien dossier, relancez"
  say "  cd '$old_dir' && docker compose up -d --build --force-recreate"
  say "Si les migrations de la nouvelle version ont modifié la base, restaurez aussi la sauvegarde ($old_dir/$backup) avant de relancer."
}
if ! (cd "$new_dir" && docker compose up -d --build --force-recreate); then
  say "Erreur : docker compose a échoué." >&2
  rollback_help >&2
  exit 1
fi
say "Attente du service app (jusqu'à ${timeout} s)..."
waited=0 status=''
while :; do
  cid=$(cd "$new_dir" && docker compose ps -q app 2>/dev/null) || cid=''
  status=''
  [ -z "$cid" ] || status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null) || status=''
  [ "$status" != healthy ] || break
  if [ "$status" = unhealthy ] || [ "$waited" -ge "$timeout" ]; then
    printf "Erreur : le service app n'est pas healthy (état : %s) après %s s. Consultez : cd '%s' && docker compose logs app\n" "${status:-inconnu}" "$waited" "$new_dir" >&2
    rollback_help >&2
    exit 1
  fi
  sleep "$POLL"
  waited=$((waited + POLL))
done

say ""
say "ReviewDesk $target est en service (app healthy)."
say "  nouveau dossier   : $new_dir"
say "  ancien dossier    : $old_dir (conservé, non supprimé)"
[ "$skip_backup" = 1 ] || say "  sauvegarde        : $old_dir/$backup"
say ""
rollback_help
say "Une fois la nouvelle version validée, supprimer l'ancien dossier reste une décision manuelle."
