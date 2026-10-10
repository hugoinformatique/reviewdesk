# Rapport — kit Docker autonome sans compte cloud (branche feat/kit-docker)

Date : 2026-10-10. Branche dédiée, commit local (revue indépendante), sans push,
fusion ni publication. Aucun secret dans ce rapport.

## Livrable

`test-results/docker-kit/reviewdesk-v8.0.0-docker.zip` (27 fichiers, 287 273 octets),
SHA-256 `e436b8027bf5d4e77082a376b7151c7fb207429c3cbed9267aa181d61e08169d`
(`.sha256` à côté, `sha256sum -c` OK). Reproductible : généré deux fois, `cmp` identique.
Le smoke final a été exécuté sur une archive de **même SHA-256**. L'archive précédente
(`83b00ed1…`) est périmée.

## Correctifs de la revue indépendante (Codex)

Revue : `/home/agent/logs/reviewdesk-kit-selfcontained-codex-review.log`. Constats vérifiés
dans le code officiel SeaweedFS 4.48 (`weed/command/s3.go`, `weed/s3api/s3api_server_grpc.go`,
`weed/security/tls.go`, `weed/util/net_timeout.go`).

1. **P1 — gRPC IAM non authentifié joignable depuis le réseau de l'app.** Confirmé :
   `s3.go` ouvre le gRPC sur `-s3.ip.bind` (`NewIpAndLocalListeners(bindIp, grpcPort)`) ;
   `checkAdminAuth` retourne `nil` sans clé de signature du filer, donc `PutIdentity` est
   ouvert. **Correction** : SeaweedFS tourne dans le service `s3-storage` en
   `network_mode: none` (seule interface : `lo`), avec `-s3.ip.bind=127.0.0.1` et
   `-s3.port.grpc=18444`. Aucun conteneur ne peut donc atteindre le gRPC, quel que soit le
   port. Le réseau ne voit que la passerelle `s3` (`app/s3-gateway.mjs`, image de l'app).
   Elle termine TLS sur `https://s3:8443` avec le certificat interne et transmet au socket
   Unix S3 de SeaweedFS (`-s3.localSocket`), placé dans un volume tmpfs `s3socket` partagé
   par ces deux conteneurs seulement (UID 1000 des deux côtés, vérifié dans l'image).
   Alternatives écartées :
   - mTLS gRPC (`grpc.s3` + `grpc.ca`) : `LoadServerTLS` retombe **silencieusement** sur un
     gRPC en clair à la moindre erreur de chargement (`return nil, nil`). C'est un échec
     ouvert.
   - Relais TCP partageant l'espace réseau de SeaweedFS (`network_mode: service:s3`) :
     **implémenté puis abandonné**, car le smoke a échoué en réel. `docker compose restart`
     redémarre les deux conteneurs en parallèle, et Docker refuse alors la jonction (« cannot
     join network namespace of a non running container »).
2. **P2 — HTTP clair 8333.** Confirmé : avec `-s3.port.https=8443`, le port principal restait
   en HTTP. **Correction** : `-s3.port=8444 -s3.port.https=0` avec cert/clé, donc un port
   principal en TLS seul (branche `portHttps == 0` de `s3.go`). Plus aucun 8333 ni 18333.
   Seul reste un HTTP en clair, le socket Unix que SeaweedFS 4.48 ouvre toujours (non
   désactivable) : il est privé à `s3-storage` et `s3`, en mémoire.
3. **P2 — `.env` de l'installateur précédent refusé.** Confirmé (`REVIEWDESK_S3 manquant`).
   **Correction** : un `.env` sans `REVIEWDESK_S3` **ni** `COMPOSE_PROFILES` est accepté tel
   quel comme S3 externe, sans réécriture (message dédié). Avec `COMPOSE_PROFILES` mais sans
   `REVIEWDESK_S3`, il est refusé sans modification. Testé avec le `.env` réellement produit
   par l'`install.sh` de `bfea010` : fixture `tests/packaging/fixtures/env-bfea010.env`,
   générée en exécutant cet installateur, sans secret.
Liste blanche : aucun `.env`, secret, certificat, clé, source TypeScript, `node_modules` ni PGlite.

## Ce qui change

Installation par défaut, sans valeur S3 : `sh install.sh --non-interactive --port X` puis
`docker compose up -d --build`.

- **Service `s3-storage`** : SeaweedFS `chrislusf/seaweedfs@sha256:4e61d15f…872d` (digest du
  smoke précédent, `weed version` 4.48 ; aucun tag revendiqué). `network_mode: none`, aucun
  port publié, volumes `s3data` et `s3socket`. Démarrage par `s3/entrypoint.sh` (POSIX) : lit les secrets
  montés en fichiers en root (`DAC_READ_SEARCH`), valide, écrit la config d'identités SeaweedFS
  et une copie de la clé/cert TLS dans `/tmp` (tmpfs, 600, propriétaire `seaweed`), puis
  `exec su-exec seaweed weed server` : tout sur 127.0.0.1, S3 en HTTPS seul sur 8444, gRPC
  18444, socket `/run/reviewdesk-s3/s3.sock`, `-s3.autoCreateBucket=false`, `-s3.iam=false`, `-master.telemetry=false`, Iceberg/Lance
  coupés. `read_only`, `cap_drop: ALL` (+ DAC_READ_SEARCH/SETUID/SETGID), `no-new-privileges`.
  Healthcheck `curl --cacert certs/ca.pem --resolve s3:8444:127.0.0.1 https://s3:8444/healthz`
  (TLS vérifié, pas de `-k`).
- **Service `s3`** (passerelle, `app/s3-gateway.mjs`) : réseau `backend`, aucun port publié.
  Il lit la clé TLS en root (`DAC_READ_SEARCH`), passe en `node` (UID 1000), écoute 8443 en
  TLS ≥ 1.2 et coupe toute connexion qui n'est pas TLS. Il transmet les octets déchiffrés au
  socket, `Host` inchangé (SigV4). Il ne détient aucune identité S3. Healthcheck de bout en
  bout : TLS vérifié pour `s3`, puis `/healthz` = 200.
- **Deux identités S3 générées et distinctes**, limitées au bucket : `reviewdesk-app`
  (Read/Write/List) et `reviewdesk-init` (Admin du bucket, sert seulement à le créer).
- **Service `s3-init`** (même image que l'app, `app/s3-bootstrap.mjs`) : lit l'identité d'init,
  passe en `node`, `HeadBucket` signé → si 404 `CreateBucket` signé → `HeadBucket` exigé 2xx ;
  liste anonyme 401/403 exigée. Idempotent (bucket existant inchangé). L'app attend
  `service_completed_successfully` (`required: false` pour le mode externe).
- **TLS interne** (`install.sh`, openssl hôte) : autorité EC P-256 (`certs/ca.pem`, 644),
  certificat du service `s3` (SAN `DNS:s3` seul, `CA:FALSE`, serverAuth, 10 ans,
  `certs/s3.pem`, 644), clé privée `secrets/s3_tls_key` (600). La clé de l'autorité reste dans le
  dossier de préparation, supprimé à la sortie. Rien n'est affiché. L'app fait confiance via
  `NODE_EXTRA_CA_CERTS=/etc/reviewdesk/certs/ca.pem` ; aucun contournement TLS. Le TLS se
  termine dans la passerelle `s3` (et, sur la boucle locale, dans SeaweedFS pour le
  healthcheck). Entre la passerelle et SeaweedFS, les octets circulent en clair sur le socket
  Unix privé, pas sur un réseau.
- **App inchangée côté garde-fous** : `entrypoint.mjs` toujours HeadBucket signé, liste anonyme
  refusée, canari de confidentialité, passage en UID 1000. `runtime-config.mjs` : extraction de
  `prepareS3Env` (réutilisée par `prepareRuntimeEnv`) et ajout de `ensureBucket`.
- **install.sh** : `.env` gagne `REVIEWDESK_S3=bundled|external` et `COMPOSE_PROFILES` ; ancien
  format accepté comme S3 externe (voir correctif 3).
  Nouvelle install refusée si `<projet>_pgdata` **ou** `<projet>_s3data` existe (Docker requis,
  doute = refus). Relance : vérifie droits, cohérence `.env` (endpoint, profil, CA imposés en
  intégré), certificat valide pour `s3` et signé par `certs/ca.pem`, clé TLS correspondant au
  certificat — sans rien régénérer. Pièce manquante = configuration partielle refusée.
  `certs/ca.pem`/`s3.pem` préexistants jamais remplacés. Options S3 externes refusées sans
  `--s3-endpoint`.
- **S3 externe conservé** (`--s3-endpoint …`) : profils Compose (`s3-storage`/`s3`/`s3-init`
  désactivés),
  mêmes contrôles qu'avant. Jugé sûr et peu coûteux (profil + `required: false`).
- **Docs** : `docs/GUIDE-DOCKER-FR.md` réécrit (S3 intégré par défaut, droits réservés, frais
  d'hébergement à la charge de l'exploitant, proxy public non testé, sauvegarde du volume
  `s3data`, mise à jour avec `--force-recreate`), `README.md`, `docs/PACKAGING.md`,
  `CHANGELOG.md` (Non publié), `NOTICE.txt` (image SeaweedFS, frais), `certs/LISEZMOI.txt`.

Fichiers : modifiés `compose.yaml`, `install.sh`, `app/Dockerfile`, `app/runtime-config.mjs`,
`certs/LISEZMOI.txt`, `package-docker.mjs`, `NOTICE.txt`, les 3 tests Docker, docs ; ajoutés
`template/s3/entrypoint.sh`, `template/app/s3-bootstrap.mjs`, `template/app/s3-gateway.mjs`,
`tests/packaging/fixtures/env-bfea010.env`. **Non modifiés** : `src/`,
`public/`, `package.json`, `package-lock.json`, kit local.

## TDD

RED constaté avant implémentation : `docker-install` 6 échecs / 14 (mode intégré absent, volume
`s3data` non vérifié) ; `docker-package` en échec de chargement (`ensureBucket`, `prepareS3Env`
absents) ; smoke en échec (`install.sh --non-interactive --port X` refusé faute d'endpoint).
GREEN ensuite ; deux corrections de tests en cours de route (détection de clé privée trop large
qui comptait le texte des scripts ; regex `KEY` qui attrapait `S3_KEY_PREFIX`).

Correctifs de revue, RED d'abord :
- `docker-install` : le test de mise à jour avec le `.env` de `bfea010` a échoué
  (`REVIEWDESK_S3 manquant`) avant la correction.
- `docker-package` : la topologie `compose` et les drapeaux SeaweedFS ont échoué, ainsi que le
  module passerelle (absent) et la liste blanche du ZIP. Le test `compose` avec l'ancien `.env`
  passait déjà : la régression était limitée à `install.sh`.
- Smoke : nouvelles assertions réseau et HTTP clair, écrites avant l'implémentation.
- Premier GREEN unitaire de la passerelle en échec : un `destroy()` à la fermeture du client
  coupait les octets non transmis. Corrigé par une fin propre (`end()`).

## Vérifications exécutées (résultats exacts)

| Contrôle | Résultat |
|---|---|
| `kit` + `install` + `docker-package` + `docker-install` | 55/55 (dont `compose config` réel, projet `reviewdesk-kit-selfcontained-test`) |
| `REVIEWDESK_DOCKER_SMOKE=1 docker-smoke.test.mjs` | 1/1 (215 s) sur le ZIP livré `e436b802…` |
| `devcheck .` | OK : lint, types, tests 96 (93 passés, 0 échec, 3 sautés sans backends Docker), build |
| `shellcheck -s sh` | `s3/entrypoint.sh` propre ; `install.sh` aucun avertissement (`-S warning`) ; `dash -n` OK |

Smoke (sans overlay, `compose.yaml` de l'archive tel quel) : ZIP vérifié et extrait dans un
chemin avec espaces/accents, ne contenant aucun certificat ; install sans question S3 ; relance
« conservée » octet pour octet ; `openssl verify` nom `s3` OK / autre nom refusé ; `compose
config` sans secret et 5 services ; `up -d --build` ; `s3-init` code 0 ; app `healthy` ;
postgres/s3 sans port publié, app sur 127.0.0.1 ; app UID 1000, weed UID 1000 (`seaweed`) ;
`s3-storage` avec `lo` pour seule interface, tous ses ports en écoute sur 127.0.0.1 (dont
8444 et 18444), aucun 8333 ni 18333 ; passerelle `s3` en UID 1000, seule écoute 8443 ; depuis
l'app, `s3:8443` ouvert et `s3:{8333,8444,18333,18444,8888,18888,9333,19333,8080,18080}`
refusés, `s3-storage` non résolu ; `http://s3:8443` sans réponse HTTP ; `http://127.0.0.1:8444`
dans `s3-storage` → 400 (TLS seul), 8333 refusé ; TLS depuis l'app : `DNS:s3` accepté, nom `other.test`
refusé (`ERR_TLS_CERT_ALTNAME_INVALID`), sans CA refusé ; proxy TLS local de test (nom vérifié,
mauvais nom refusé) ; login admin cookie `Secure`/`HttpOnly`, inter-sites refusé, CORS widget ;
upload capture + ticket ; GET et liste **anonymes** de l'objet stocké → 403 ; persistance après
`restart` (pile entière), redémarrage isolé de `s3-storage` puis de `s3` (S3 de nouveau
joignable), puis `up --force-recreate` ; `s3-init` « existe déjà, inchangé » ; `pg_dump` ; refus
de démarrer en HTTP / sans CA / autre bucket ; identité d'init refusée sur un autre bucket ;
nouvelle install dans un dossier vierge refusée (volume existant) sans rien écrire ; aucun canari
restant ; aucun secret (ni début de clé TLS) dans config, erreurs, journaux.

Historique honnête du smoke :
- Exécution 1 (1ʳᵉ) (création réelle : install, build, bucket **créé** par `s3-init`, app healthy,
   ports) puis échec sur une assertion de test (code retour de boucle shell). Corrigé dans le
   test. Les étapes suivantes n'ont donc été vérifiées que sur des relances avec les mêmes
   volumes (chemin « configuration restaurée ») : le parcours premier démarrage complet n'a pas
   été rejoué de bout en bout (il exigerait de supprimer les volumes, interdit).
- Exécutions 2 et 3 : vertes (3 avec pile conservée pour inspection manuelle).
- Exécution 4 : échec réel de `docker compose restart` — conteneur `postgres` non recréé par
   `up -d --build` depuis un nouveau dossier, ses secrets pointant vers l'ancien dossier
   supprimé. Risque réel de mise à jour : guide corrigé (`--force-recreate`, entrée de
   dépannage) et smoke aligné sur cette procédure pour le chemin de mise à jour.
- Exécutions 5 et 6 : vertes.
- Après la revue : exécution 7, relais TCP en espace réseau partagé. Étapes 1 à 8 vertes (dont
   les nouvelles assertions réseau), puis échec réel de `docker compose restart` (jonction
   d'espace réseau refusée). Conception abandonnée, voir correctif 1.
- Exécution 8 (passerelle + socket) : verte. Exécution 9, finale, sur le ZIP livré : verte.
- Toutes les relances ont réutilisé les volumes existants : le chemin « premier démarrage »
   de la nouvelle topologie n'a pas été rejoué avec des volumes neufs (il faudrait supprimer
   des volumes, ce qui est interdit). La persistance des données créées avec l'ancienne
   topologie a, elle, été vérifiée.

## Isolation Docker

Toutes mes commandes Docker de test passent par `docker compose -p
reviewdesk-kit-selfcontained-test` (y compris deux sondages de l'image SeaweedFS : `weed
version`, puis UID de `seaweed` via un fichier compose temporaire, `network_mode: none`,
`run --rm`). Exceptions, en
lecture seule : une fois `docker volume ls -q` à la main pour constater l'état des volumes, et
`install.sh` lui-même exécute `docker volume ls -q` (garde de volume, par conception). Aucun
`down -v`, prune ni suppression de volume ; aucune commande sur `reviewdesk-kit-docker-test` ni
`ticketmax-dev-*`. État final : aucun conteneur du projet de test ; volumes
`reviewdesk-kit-selfcontained-test_pgdata`/`_s3data` conservés, `_s3socket` (tmpfs) créé par
Compose ; état de test (config, secrets,
certs de test, PKI du proxy de test) dans `~/.cache/reviewdesk-kit-selfcontained-test` pour
rerun. Images construites du projet de test laissées en place.

## Limites

- Le gRPC IAM de SeaweedFS reste **non authentifié** (pas de clé de signature du filer) : il
  est isolé, pas authentifié. La garantie repose sur `network_mode: none`. Tout processus du
  conteneur `s3-storage` (SeaweedFS seul) peut l'atteindre ; la passerelle `s3`, non (espaces
  réseau distincts). Le socket Unix S3, en HTTP clair, n'est accessible qu'à `s3-storage` et
  `s3`. Les deux conteneurs tournent en UID 1000.
- L'isolation est vérifiée par le smoke sur la nouvelle topologie. Il n'a pas été démontré
  que ces assertions échouent sur l'ancienne (pas de contre-épreuve exécutée).
- Ordre de démarrage après un redémarrage de l'hôte ou du démon Docker non testé
  (intervention sur le démon exclue). Il ne dépend plus d'un espace réseau partagé, et la
  passerelle se reconnecte au socket à chaque connexion (vérifié par redémarrage isolé).
- `s3-storage` et `s3` démarrent en root (lecture des secrets) avec capacités réduites, puis
  tournent en `seaweed` / `node`.
- Certificat interne 10 ans ; renouvellement non outillé. Une seule instance SeaweedFS, sans
  réplication ; sauvegarde du volume `s3data` documentée mais ni outillée ni testée.
- Le smoke ne couvre plus le S3 externe ni le cas « objets publics, liste refusée » de bout en
  bout (couverts par les tests unitaires ; validés de bout en bout dans le lot précédent,
  `REPORT` antérieur) — le mode externe n'a pas été rejoué en réel dans ce lot.
- Proxy validé = proxy TLS Node local de test ; Caddy/nginx non exécutés ; aucun proxy public,
  domaine réel ni certificat public ; pas de navigateur réel.
- Testé sous Linux, Docker Compose v5.6.0, OpenSSL 3.5.7, `sh` = dash. Docker Desktop, Podman,
  rootless, userns-remap, OpenSSL 1.1 non vérifiés. Saisie interactive sur terminal non testée
  automatiquement (le repli sans terminal l'est).
- Documentation en français seulement (comme le reste des docs du dépôt).
- Pas de bump de version : distribution 8.0.0 non publiée, entrée sous « Non publié ».
