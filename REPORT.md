# Rapport — distribution Docker Compose auto-hébergée (branche feat/kit-docker)

Date : 2026-10-10. Branche dédiée (sans push, fusion ni publication). Aucun secret dans ce rapport.

## Livrable

`test-results/docker-kit/reviewdesk-v8.0.0-docker.zip` (24 fichiers, 275 920 octets), après correctifs de revue :
SHA-256 `f2ae95b680cc8564dba6069a5e70dfdc81b25292adfcff9c96f470b7a5a23ecb`.
Reproductible : générée deux fois (`--output test-results/docker-kit-a` puis `-b`),
`cmp` octet pour octet identique, `sha256sum -c` OK.

## Chemins modifiés / ajoutés

Ajoutés :
- `scripts/packaging/docker/package-docker.mjs` — manifeste/lock de production, ZIP (réutilise `createZip` et `collectAssets` de `package-kit.mjs`)
- `scripts/packaging/docker/s3-signer.ts` — réexporte le signeur SigV4 de l'app pour la vérification au démarrage
- `scripts/packaging/docker/NOTICE.txt`
- `scripts/packaging/docker/template/{compose.yaml,install.sh,certs/LISEZMOI.txt}`
- `scripts/packaging/docker/template/app/{Dockerfile,entrypoint.mjs,runtime-config.mjs}`
- `docs/GUIDE-DOCKER-FR.md`
- `tests/packaging/{docker-package,docker-install,docker-smoke}.test.mjs`, `tests/packaging/docker-zip.mjs`
- `REPORT.md`

Modifiés (docs uniquement) : `README.md` (voie Docker recommandée, kit local marqué obsolète),
`docs/PACKAGING.md` (section Docker), `docs/KIT-LOCAL.md` (bandeau obsolète), `CHANGELOG.md` (Non publié).

Non modifiés : `src/`, `public/`, `package.json`, `package-lock.json`, kit local (scripts conservés),
`scripts/docker-backends.sh`, autres worktrees, `main`.

## Images (vérifiées via `docker buildx imagetools inspect`, Docker Hub `library/`)

- `node:22.23.3-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392` (= digest actuel de `node:22-bookworm-slim`)
- `postgres:17.11-alpine3.24@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24`

## Lock de production

`npm ci` sur le lock racine échoue (préexistant : `json-schema-ref-resolver@3.0.1` manquant) ;
il n'a pas été touché. Le lock Docker est dérivé de façon déterministe du lock runtime vérifié
du kit local (retrait de PGlite et de ses dépendances exclusives, entrées recopiées à l'identique),
contrôlé contre les versions du lock racine, et validé par `npm ci --omit=dev --ignore-scripts`
réussi lors du `docker compose build`. Pour l'outillage de build local, dépendances installées par
`npm install --package-lock=false --no-save --ignore-scripts` (node_modules gitignoré, lock intact).

## Correctifs de la revue indépendante (journal `reviewdesk-kit-docker-codex-review.log`)

| Constat | Correctif | Test |
|---|---|---|
| P1 — refus de liste anonyme ≠ objets privés | Au démarrage : PUT signé d'un objet de test sans donnée `<préfixe>/.reviewdesk-startup-probe-<uuid>`, GET **anonyme** de cet objet (401/403 seul accepté, 2xx = public, tout autre statut = refus), DELETE signé toujours tenté (même après refus/erreur réseau), échec si suppression impossible en nommant la clé (jamais un secret). Même signeur SigV4 que l'app (`dist/s3-signer.js`). | Unitaires (stockage simulé, dont bucket public-read) + smoke SeaweedFS réel |
| P2 — `HeadBucket` exige `s3:ListBucket` non documenté | Permissions minimales documentées : `s3:ListBucket`, `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` ; dépannage associé. | Doc |
| P2 — garde du volume ouverte si Docker indisponible | Nouvelle config : Docker requis ; `docker volume ls -q` doit réussir et ne pas contenir `<projet>_pgdata` (correspondance exacte) ; Docker absent / démon arrêté / droits refusés = arrêt sans rien écrire. Vérifier une config existante n'exige pas Docker. | `docker-install` (faux `docker`, PATH sans docker) |
| P2 — installateurs concurrents | Verrou `mkdir .reviewdesk-install.lock` pris avant toute vérification, libéré seulement par son créateur ; publication par `ln` (refuse une destination existante) au lieu de `mv`. | verrou étranger conservé ; 6 exécutions simultanées → une seule écrit (5 répétitions) |
| P3 — endpoint installateur ≠ démarrage | L'installateur n'accepte que la forme canonique gardée telle quelle par le parseur URL : minuscules, pas de `:443`, port sans zéro initial ≤ 65535, hôte numérique = IPv4 pointée stricte. Octets de l'endpoint inchangés. | test différentiel installateur/`assertHttpsEndpoint` sur 13 formes |

TDD : tests écrits d'abord, constatés rouges (4 échecs installateur + export `verifyObjectPrivacy`
absent), puis verts. Le test de concurrence passait déjà avant correctif (course non reproduite de
façon fiable) : conservé comme garde-fou, la garantie repose sur le verrou testé directement.

## Vérifications exécutées

| Contrôle | Résultat |
|---|---|
| `npm run lint` | OK |
| `npm run typecheck` | OK |
| `tests/unit/*.test.ts` (existant) | 48/48 |
| `tests/packaging/kit.test.mjs` + `install.test.mjs` (kit local, non-régression) | 15/15 |
| `docker-package.test.mjs` + `docker-install.test.mjs` | 26/26 (après correctifs) ; `docker-install` seul ×5 : 10/10 à chaque fois |
| `docker-package` + `docker-install` + `kit` + `install` | 41/41 |
| `tests/unit/sigv4.test.ts` | 6/6 |
| `REVIEWDESK_DOCKER_SMOKE=1 docker-smoke.test.mjs` | 1/1 (après correctifs, 60 s ; historique : 1ʳᵉ exécution initiale en échec, voir ci-dessous) |
| `devcheck .` (lint, types, tests 93/93, build) | OK |
| `shellcheck -s sh install.sh`, `dash -n` | aucune erreur ni avertissement ; 6 notes `info` (SC2015/SC2012) sur des motifs préexistants |

TDD : les tests ont été écrits avant l'implémentation et constatés rouges (modules absents),
idem pour l'ajout de la sonde authentifiée.

Smoke (projet `reviewdesk-kit-docker-test`, app sur `127.0.0.1:48391`) : ZIP extrait dans un chemin
avec espaces/accents ; `install.sh` (1ʳᵉ exécution : création ; suivantes : config restaurée et
conservée) ; `docker compose config/build/up --wait` ; PostgreSQL et S3 sans port publié, app
uniquement sur 127.0.0.1 ; processus app en UID 1000 ; aucun secret dans `compose config`,
`docker inspect` ni les journaux ; S3 SeaweedFS en HTTPS signé par une CA privée
(`NODE_EXTRA_CA_CERTS`) ; proxy TLS local avec vérification du nom d'hôte (`reviewdesk.test`,
mauvais nom refusé) ; connexion admin avec cookie `Secure`/`HttpOnly` ; écriture inter-sites refusée ;
CORS widget ; upload + relecture d'une capture via S3 ; persistance après redémarrage ;
`pg_dump` ; refus de démarrer avec S3 en HTTP, sans CA, ou bucket absent ; après tous les
démarrages, aucun objet de test restant dans le bucket privé (listing `fs.ls` non vide, donc
contrôle non vacant). Cas P1 de bout en bout : second SeaweedFS (tmpfs, aucun volume créé) avec
identité `anonymous` en `Read` sans `List` ; précondition vérifiée (liste anonyme 401/403) ;
le démarrage échoue avec « Les objets du bucket S3 sont lisibles anonymement » (message émis
seulement après un PUT signé 2xx puis un GET anonyme 2xx) et l'objet de test est supprimé.

1ʳᵉ exécution du smoke en échec : un bucket absent n'était pas détecté (SeaweedFS répond 403 en
anonyme même pour un bucket inexistant). Corrigé par un HeadBucket signé avant la sonde anonyme.
Le conteneur one-off laissé par ce timeout a été retiré (il appartenait au projet de test) ; le
nettoyage du test retire désormais ces conteneurs par label du projet de test.

État Docker après tests : aucun conteneur du projet de test ; volumes conservés
`reviewdesk-kit-docker-test_pgdata` et `_s3data` (aucun nouveau volume) ; conteneurs
`ticketmax-dev-*` inchangés (toujours « Up 35 hours »). Les tests `docker-install` n'interrogent
plus le Docker de l'hôte (faux `docker` en tête du PATH). Aucun `down -v`, aucun prune. État de test (config/PKI de test) :
`~/.cache/reviewdesk-kit-docker-test`.

## Limites

- MinIO n'est plus téléchargeable (quay.io/Docker Hub refusés) : S3 de test = SeaweedFS
  (`chrislusf/seaweedfs`, épinglé par digest, image locale). Aucun fournisseur S3 réel (R2, AWS…) testé.
- Vérification de confidentialité : prouve qu'un objet **nouvellement écrit** dans le préfixe
  n'est pas lisible anonymement au démarrage. Ne prouve pas l'absence d'ACL publique sur
  d'**autres** objets, ni une dérive ultérieure de la politique (contrôle au démarrage seulement) ;
  le blocage de l'accès public du fournisseur doit être configuré. Testée de bout en bout contre
  SeaweedFS seulement : compatibilité AWS S3, R2, Scaleway, B2, MinIO réels **non vérifiée** ; un
  fournisseur répondant autre chose que 401/403 à une lecture anonyme empêchera le démarrage.
- Démarrage : nécessite désormais aussi `s3:PutObject`/`s3:DeleteObject` effectifs (canari).
- Un verrou `.reviewdesk-install.lock` laissé par un `kill -9` doit être supprimé à la main
  (documenté) ; pas de détection de verrou périmé.
- La publication par `ln` exige que le dossier soit sur un système de fichiers acceptant les
  liens physiques (cas de tout système Linux usuel ; non testé sur montages exotiques).
- Proxy validé = proxy TLS Node local de test ; exemples Caddy/nginx du guide non exécutés ;
  pas de vrai nom de domaine ni certificat public, pas de navigateur réel ni de widget sur un site distant.
- Saisie masquée interactive (`stty -echo`) non testée automatiquement (fichier et stdin le sont).
- Testé sous Linux, Docker 29.9.0, Compose v5.6.0, `sh` = dash. Docker Desktop, Podman, rootless,
  userns-remap non vérifiés. Restauration de sauvegarde non outillée ni testée.
- Documentation en français seulement (comme le reste des docs du dépôt) ; pas de version EN.
- Pas de bump de version : distribution de la 8.0.0 existante, entrée sous « Non publié ».
