# Construire et vérifier les distributions ZIP 8.0.0

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

- `test-results/local-kit/reviewdesk-v8.0.0-local.zip`
- `test-results/local-kit/reviewdesk-v8.0.0-local.zip.sha256`

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
- `public/admin.js` et `public/widget.js` : interfaces compilées ;
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

Produit `reviewdesk-v8.0.0-docker.zip` et son `.sha256`, de façon
reproductible (octet pour octet). Mêmes prérequis de construction que le kit
local (Node 22, esbuild installé dans le dépôt).

Contenu, sous `reviewdesk-v8.0.0-docker/` : `compose.yaml`, `install.sh`
(POSIX sh + openssl), `GUIDE-DOCKER-FR.md`, `NOTICE.txt`, `certs/LISEZMOI.txt`
et `app/` (contexte de build : `Dockerfile`, `entrypoint.mjs`,
`runtime-config.mjs`, `package.json`, `package-lock.json`,
`dist/server.js`, `dist/mcp.js`, `dist/s3-signer.js`, `public/`). Aucun source
TypeScript, `.env`, secret, `node_modules` ni PGlite. Le gabarit vit dans
`scripts/packaging/docker/template/`.

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
- `postgres:17.11-alpine3.24@sha256:b0f9560a…2b24`.

Tags et digests relevés sur Docker Hub (images officielles `library/`) le
2026-10-10 avec `docker buildx imagetools inspect`.

### Vérification

```bash
node --test tests/packaging/docker-package.test.mjs tests/packaging/docker-install.test.mjs
REVIEWDESK_DOCKER_SMOKE=1 node --test tests/packaging/docker-smoke.test.mjs
```

- `docker-package` : manifeste et verrou (dérivation, déterminisme, refus de
  PGlite / plages / entrées hors registre), validation d'environnement du
  conteneur (HTTPS exact, bucket, secrets absents/vides/multilignes, chemin du
  CA, forme canonique de l'endpoint), sondes S3, objet de test de
  confidentialité contre un stockage simulé (PUT signé dans le préfixe, GET
  anonyme 401/403 exigé, objet lisible publiquement refusé, DELETE signé
  toujours tenté, aucun secret dans les erreurs), `docker compose config` (images épinglées, PostgreSQL non
  publié sur réseau interne, app sur 127.0.0.1, variables de production, aucun
  secret dans la config résolue, échec sans `.env`), liste blanche du ZIP.
- `docker-install` : `install.sh` sous `sh` (dash) avec un `PATH` réduit à
  `/usr/bin:/bin` précédé d'un faux `docker` (le Docker de l'hôte n'est jamais
  interrogé) : refus si Docker est absent, injoignable ou si le volume existe,
  verrou d'installation (verrou étranger laissé en place, exécutions
  simultanées : une seule écrit), accord installateur/démarrage sur chaque
  forme d'endpoint, droits 600/700, mots de passe forts et distincts, aucun
  secret dans la sortie, conservation à l'identique, refus d'écraser, refus
  d'une configuration partielle ou invalide, refus des entrées invalides sans
  rien écrire, identifiants via fichier ou stdin, certificat d'autorité.
- `docker-smoke` (opt-in, Docker requis) : ZIP extrait dans un chemin avec
  espaces et accents, `install.sh`, `docker compose config/build/up` dans le
  projet isolé `reviewdesk-kit-docker-test` avec un S3 SeaweedFS de test en
  HTTPS signé par une autorité privée (`NODE_EXTRA_CA_CERTS`), proxy TLS local
  avec vérification du nom d'hôte, connexion admin (cookie `Secure`), refus
  d'écriture inter-sites, CORS du widget, envoi et relecture d'une capture,
  redémarrage, `pg_dump`, refus de démarrer en HTTP, sans CA ou avec un bucket
  absent, aucun objet de test restant dans le bucket privé, refus de démarrer
  contre un second SeaweedFS (tmpfs, sans volume) dont la liste anonyme est
  refusée mais les objets lisibles anonymement, objet de test supprimé malgré
  ce refus, absence de secrets dans `docker inspect` et les journaux, processus
  sous l'UID 1000. Il ne fait jamais `down -v` ni `prune` : les volumes
  `reviewdesk-kit-docker-test_*` sont conservés, et la configuration
  correspondante est gardée dans `~/.cache/reviewdesk-kit-docker-test`
  (`REVIEWDESK_DOCKER_STATE` pour un autre dossier). `REVIEWDESK_DOCKER_KEEP=1`
  laisse la pile démarrée.
