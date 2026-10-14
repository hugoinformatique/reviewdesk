# Construire et vérifier les distributions ZIP 10.0.0

Le packaging est isolé dans `scripts/packaging/` ; il ne modifie ni `src/`,
ni `public/`, ni les manifestes de l'application. Le guide livré au destinataire
est [KIT-LOCAL.md](KIT-LOCAL.md), renommé `GUIDE-FR.md` dans le ZIP.

## Génération

Prérequis de construction : Node 22.x et les dépendances de développement
installées dans le dépôt, notamment esbuild. Dans ce worktree, le verrou de
l'application a une incohérence préexistante détectée par npm 10.9.9
(`json-schema-ref-resolver@3.0.1` manquant). Sans modifier ce verrou, l'outillage
peut être installé avec :

```sh
npm install --no-package-lock --ignore-scripts --no-audit --no-fund
```

Depuis la racine du dépôt :

```sh
node --test tests/packaging/kit.test.mjs tests/packaging/install.test.mjs
node scripts/packaging/package-kit.mjs --output test-results/local-kit
node --test tests/packaging/smoke.test.mjs
```

Sous macOS/Linux, `python3 tests/packaging/terminal-smoke.py` ajoute un test
dans un pseudo-terminal : saisie faible, confirmation différente, annulation
Ctrl+C, saisie valide sans écho et installation. Il contrôle aussi le ZIP et
ses CRC avec un lecteur indépendant. Python n'est requis que pour ce test de
maintenance, jamais pour le kit.

Sorties :

- `test-results/local-kit/reviewdesk-v10.0.0-local.zip`
- `test-results/local-kit/reviewdesk-v10.0.0-local.zip.sha256`

Le dossier `--output` est obligatoire et accepte les espaces. Le smoke test
prend par défaut le chemin ci-dessus ; `REVIEWDESK_KIT_ZIP` permet de tester
une autre archive. Il extrait l'archive dans le dossier temporaire du système,
hors dépôt, efface `NODE_PATH` et `NODE_OPTIONS` des processus enfants et
vérifie la résolution CommonJS/ESM avant et après installation : dépendances
absentes avant npm ci, puis résolues uniquement dans le kit. Il installe
réellement les dépendances via npm, puis supprime
les données de test. Il nécessite Internet (ou un cache npm complet) et la
possibilité d'ouvrir des sockets locales. Aucun backend cloud ou Docker n'est
utilisé. Les mots de passe de test sont synthétiques.

Le script compile les entrées existantes avec esbuild dans un dossier
temporaire, jamais dans `public/` du dépôt :

- `dist/server.js` : serveur original compilé ;
- `dist/mcp.js` : serveur MCP original compilé ;
- `dist/local-server.js` : adaptateur de packaging du serveur local ;
- `public/index.html` et `public/assets/` (admin React, reconstruite par Vite) et `public/widget.js` : interfaces compilées ;
- tous les autres assets de `public/`, dont polices et licence.

L'adaptateur fixe les pilotes PGlite/filesystem et l'adresse loopback. Le
lanceur attend `app.close()` lors d'un arrêt normal pour fermer PGlite.
Le ZIP contient uniquement ces fichiers, les scripts runtime, le manifeste
runtime et son verrou, le guide et la notice de droits. Il ne parcourt jamais
le dépôt pour recopier son contenu global : pas de lecture de `.env`, ni de
copie de source TypeScript, sourcemap, donnée, secret, Git, journal ou
node_modules. Les liens symboliques et assets non autorisés font échouer la
construction. L'archive ZIP32 utilise des noms UTF-8, DEFLATE et une date fixe ;
à entrées et outillage identiques, son contenu est déterministe. Une somme
SHA-256 est écrite à côté, au format usuel `sha256sum -c`.

## Verrou runtime autonome

`scripts/packaging/runtime/package.json` est distinct du manifeste de
l'application. Il reprend ses dépendances runtime, épinglées aux versions du
verrou principal, et ajoute **`@electric-sql/pglite` comme dépendance runtime**.
Son propre `package-lock.json` verrouille la fermeture transitive, sans
esbuild, TypeScript ni dépendances de développement. `install.mjs` exécute
`npm ci --omit=dev --ignore-scripts --no-audit --no-fund` dans le dossier extrait.
Il lance l'entrée JavaScript de npm avec Node, sans commande shell, pour
prendre en charge les chemins avec espaces et l'installation Windows npm.cmd.

Lors d'une évolution des dépendances, mettez à jour ces deux fichiers runtime
ensemble, vérifiez leur alignement avec le verrou de l'application, puis
relancez les tests et le smoke test complet. Le générateur refuse les versions
flottantes ou une incohérence des dépendances directes. Ne modifiez pas le
manifeste de l'application pour rendre PGlite installable dans le kit.

## Vérification

Les tests unitaires couvrent version Node, ports, mots de passe, premier
lancement sans entrée, configuration privée, préservation à la réinstallation,
configuration invalide, liens symboliques, verrou de concurrence, résolution
npm Windows/Unix, exclusion des fichiers privés et déterminisme du ZIP.
Les tests d'annulation couvrent SIGINT/SIGTERM pendant npm ci, y compris un
téléchargement npm réel via un serveur local, les signaux répétés et un enfant
ignorant SIGTERM. Le verrou reste détenu jusqu'à l'arrêt de npm (SIGKILL après
deux secondes si nécessaire), puis est libéré pour permettre la réinstallation.

Le smoke test vérifie la somme de l'archive, ses membres et ses assets,
l'extraction dans un chemin avec espaces et accents, le refus de démarrer sans
configuration, le refus d'un mot de passe faible, l'installation verrouillée
réelle, l'absence d'outillage de développement, HTTP `/health`, l'interface,
les polices, l'authentification admin, la protection des routes et des fichiers
privés, la concurrence et la conservation des projets/retours/captures et du
mot de passe après redémarrage et réinstallation. Il vérifie séparément le refus de `NODE_ENV=production` et `VERCEL=1`,
puis injecte d'autres réglages cloud et `HOST=0.0.0.0` pour vérifier qu'ils
ne sont pas utilisés.
Quand une interface réseau non loopback existe, il vérifie que la connexion
sur cette interface est refusée.

Les scripts sont portables ; la validation exécutée dans ce worktree se fait
sous Linux, Node 22. Les branches de résolution npm Windows sont testées, mais
cela ne remplace pas une validation native Windows/macOS de l'installation et
de Ctrl+C. Aucune publication distante ni infrastructure n'est impliquée.

## Distribution Docker Compose

Voie recommandée pour l'auto-hébergement ; le kit local ci-dessus est
obsolète. Le guide livré au destinataire est
[GUIDE-DOCKER-FR.md](GUIDE-DOCKER-FR.md), copié tel quel dans le ZIP.

### Génération

```bash
node scripts/packaging/docker/package-docker.mjs --output test-results/docker-kit
```

Produit `reviewdesk-v10.0.0-docker.zip` et son `.sha256`, de façon
reproductible (octet pour octet). Mêmes prérequis de construction que le kit
local (Node 22, esbuild installé dans le dépôt).

Contenu, sous `reviewdesk-v10.0.0-docker/` : `compose.yaml`, `install.sh`
(POSIX sh + openssl), `GUIDE-DOCKER-FR.md`, `NOTICE.txt`, `certs/LISEZMOI.txt`,
`s3/entrypoint.sh` (démarrage du S3 intégré) et `app/` (contexte de build :
`Dockerfile`, `entrypoint.mjs`, `runtime-config.mjs`, `s3-bootstrap.mjs`,
`s3-gateway.mjs` (passerelle TLS du S3 intégré),
`package.json`, `package-lock.json`,
`dist/server.js`, `dist/mcp.js`, `dist/s3-signer.js`, `public/`). Aucun source
TypeScript, `.env`, secret, certificat, clé, `node_modules` ni PGlite : les
clés S3 et le TLS interne sont générés par `install.sh` chez le destinataire.
Le gabarit vit dans `scripts/packaging/docker/template/`.

### Verrou de production

`app/package.json` reprend les dépendances de l'application à leur version
exacte du verrou racine. `app/package-lock.json` est **dérivé** du verrou
runtime vérifié (`scripts/packaging/runtime/package-lock.json`) : PGlite et
les paquets qu'il serait seul à tirer sont retirés, le reste (tarballs,
intégrités) est recopié à l'identique. La génération échoue si une version
diverge, si une entrée n'a pas d'intégrité ou ne vient pas du registre npm, ou
si PGlite subsiste. L'image exécute `npm ci --omit=dev --ignore-scripts`, ce
qui prouve la cohérence manifeste/verrou à chaque build.

### Images

- `node:22.23.3-bookworm-slim@sha256:c3de60bf…8392` (build et exécution) ;
- `postgres:17.11-alpine3.24@sha256:b0f9560a…2b24` ;
- `chrislusf/seaweedfs@sha256:4e61d15f…872d` (S3 intégré, `weed version` 4.48).

Tags et digests node/postgres relevés sur Docker Hub (images officielles
`library/`) le 2026-10-10 avec `docker buildx imagetools inspect`. Le digest
SeaweedFS est celui de l'image locale déjà utilisée par le smoke précédent ;
il est référencé par digest seul (aucun tag n'est revendiqué).

### Vérification

```bash
node --test tests/packaging/docker-package.test.mjs tests/packaging/docker-install.test.mjs
REVIEWDESK_DOCKER_SMOKE=1 node --test tests/packaging/docker-smoke.test.mjs
```

- `docker-package` : manifeste et verrou (dérivation, déterminisme, refus de
  PGlite / plages / entrées hors registre), validation d'environnement du
  conteneur (HTTPS exact, bucket, secrets absents/vides/multilignes, chemin du
  CA, forme canonique de l'endpoint), sondes S3, objet de test de
  confidentialité contre un stockage simulé, création idempotente du bucket
  (existant intact, absent créé puis confirmé, refus et réponses inattendues,
  aucun secret dans les erreurs), `docker compose config` avec le projet
  `reviewdesk-kit-selfcontained-test` (images épinglées, PostgreSQL et S3
  intégré non publiés sur réseau interne, secrets en fichiers et répartis par
  service, healthcheck TLS avec `--cacert`, aucun contournement TLS, aucun
  secret dans la config résolue, services intégrés désactivés en S3 externe,
  échec sans `.env`, `.env` de l'ancien installateur lu comme S3 externe),
  topologie du S3 intégré (`s3-storage` en `network_mode: none`, socket dans un
  volume tmpfs partagé avec la seule passerelle `s3`, drapeaux SeaweedFS
  `-s3.ip.bind=127.0.0.1 -s3.port=8444 -s3.port.https=0 -s3.port.grpc=18444`),
  passerelle `s3-gateway.mjs` contre un faux SeaweedFS sur socket Unix (TLS
  vérifié pour `s3`, autre nom refusé, HTTP clair jamais transmis, socket
  absent sans arrêt de la passerelle), `s3/entrypoint.sh` POSIX, liste blanche du ZIP, NOTICE
  et guide (droits réservés, frais d'hébergement).
- `docker-install` : `install.sh` sous `sh` (dash) avec un `PATH` réduit à
  `/usr/bin:/bin` précédé d'un faux `docker` (le Docker de l'hôte n'est jamais
  interrogé). Mode intégré : aucune question S3, clés uniques et distinctes,
  clé TLS 600, certificats 644, chaîne vérifiée par `openssl verify` pour le
  nom `s3` (autre nom ou autre autorité refusés), clé de l'autorité absente,
  relance à l'identique, pièces manquantes ou `.env` altéré refusés sans rien
  régénérer, `certs/ca.pem` étranger jamais remplacé, options S3 externes
  refusées. Les deux modes : refus si Docker est absent, injoignable ou si le
  volume `pgdata` ou `s3data` existe, verrou d'installation, accord
  installateur/démarrage sur chaque forme d'endpoint, mots de passe forts et
  distincts, aucun secret dans la sortie, refus des entrées invalides. Mise à
  jour : un `.env` tel qu'écrit par l'installateur précédent (commit
  `bfea010`, fixture `tests/packaging/fixtures/env-bfea010.env`) est accepté
  et laissé octet pour octet ; avec `COMPOSE_PROFILES` mais sans
  `REVIEWDESK_S3`, il est refusé sans modification.
- `docker-smoke` (opt-in, Docker requis) : ZIP vérifié (`sha256sum -c`) et
  extrait dans un chemin avec espaces et accents, `install.sh --non-interactive
  --port X` puis `docker compose up -d --build` **sans overlay**, dans le seul
  projet `reviewdesk-kit-selfcontained-test` : `s3-init` terminé (code 0),
  app `healthy`, PostgreSQL et S3 sans port publié, app sur 127.0.0.1, app en
  UID 1000, SeaweedFS hors root dans un conteneur dont la seule interface est
  `lo`, tous ses ports (dont 8444 et le gRPC 18444) sur 127.0.0.1, aucun 8333
  ni 18333 ; passerelle seule à écouter (8443, UID 1000) ; depuis l'app, tous
  les ports SeaweedFS (8333, 8444, 18333, 18444, filer, master, volume)
  injoignables et `s3-storage` non résolu ; HTTP clair sur 8443 sans réponse,
  HTTP clair sur 8444 refusé (400) ;
  TLS depuis l'app (nom `s3` accepté, autre nom refusé, sans autorité refusé),
  proxy TLS local de test avec vérification du nom d'hôte, connexion admin
  (cookie `Secure`), refus d'écriture inter-sites, CORS du widget, capture et
  ticket, lecture et liste **anonymes** refusées sur l'objet stocké,
  persistance après `restart` puis `up --force-recreate`, S3 de nouveau
  joignable après redémarrage isolé de `s3-storage` puis de `s3`, `s3-init`
  idempotent, `pg_dump`, refus de démarrer en HTTP, sans CA ou avec un autre
  bucket, identité d'initialisation cantonnée au bucket, nouvelle installation
  refusée à côté des volumes existants, aucun objet de test restant, aucun
  secret dans `compose config`, les erreurs ni les journaux. Il ne fait jamais
  `down -v` ni `prune` : les volumes `reviewdesk-kit-selfcontained-test_*`
  sont conservés, et la configuration correspondante (`.env`, `secrets/`,
  `certs/`) est gardée dans `~/.cache/reviewdesk-kit-selfcontained-test`
  (`REVIEWDESK_DOCKER_STATE` pour un autre dossier). `REVIEWDESK_DOCKER_KEEP=1`
  laisse la pile démarrée.
