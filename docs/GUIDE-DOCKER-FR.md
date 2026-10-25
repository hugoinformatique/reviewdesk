# ReviewDesk — guide d'auto-hébergement Docker Compose

[English](GUIDE-DOCKER-EN.md) · **Français**

Cette archive installe ReviewDesk sur un serveur avec Docker Compose, **sans
compte cloud** : l'application compilée, une base PostgreSQL dédiée et un
stockage S3 intégré (SeaweedFS) pour les captures d'écran, tous sur le même
hôte. Aucun Node.js n'est requis sur l'hôte. Un S3 externe reste possible en
option (section 7).

> **Licence.** ReviewDesk est un logiciel libre, distribué sous
> [licence MIT](../LICENSE) (texte inclus dans l'archive, `NOTICE.txt`).
>
> **Frais d'hébergement.** Aucun service payant n'est requis par l'archive,
> mais le serveur, son disque, ses sauvegardes, le nom de domaine et le
> certificat public restent à votre charge, y compris leurs frais
> d'hébergement.

## 1. Architecture

```
navigateur / widget ──HTTPS──▶ reverse proxy (même hôte) ──HTTP──▶ 127.0.0.1:48300 ─▶ app (conteneur)
                                                                                        │
                                       réseau interne Compose (aucune sortie) ◀─────────┘
                                          │                          │
                     postgres (volume pgdata)        s3 : passerelle HTTPS https://s3:8443
                                                       ▲              │ socket Unix (volume s3socket, en mémoire)
                                         s3-init       │              ▼
                            (crée le bucket privé,     │   s3-storage : SeaweedFS, sans réseau (volume s3data)
                             puis s'arrête) ───────────┘
```

- `app` : image construite localement depuis `app/Dockerfile` (image officielle
  `node:22.23.3-bookworm-slim`, épinglée par digest). Dépendances de production
  uniquement, installées par `npm ci` depuis `app/package-lock.json`.
  `NODE_ENV=production`, `HOST=0.0.0.0` dans le conteneur, cookies `Secure`.
  Le port est publié **uniquement sur 127.0.0.1**. Le serveur tourne sous
  l'utilisateur `node` (UID 1000), système de fichiers en lecture seule.
- `postgres` : image officielle `postgres:17.11-alpine3.24`, épinglée par
  digest. Réseau Compose `internal` : pas de port publié, pas d'accès sortant.
  Données dans le volume nommé `reviewdesk_pgdata`.
- `s3-storage` : SeaweedFS (`chrislusf/seaweedfs`, weed 4.48), épinglé par
  digest. Conteneur **sans interface réseau** (`network_mode: none`) : tous ses
  ports (master, volume, filer, passerelle S3 en HTTPS seul sur 8444, gRPC S3
  sur 18444) n'existent que sur sa boucle locale, aucun autre conteneur ne peut
  les joindre. L'API S3 sort du conteneur uniquement par un socket Unix, dans le
  volume `s3socket` (en mémoire, partagé avec `s3` seul). Données dans le volume
  nommé `reviewdesk_s3data`. Processus sous l'utilisateur `seaweed`, système de
  fichiers en lecture seule.
- `s3` : passerelle (même image que l'app, `app/s3-gateway.mjs`), seul point
  d'accès S3 du réseau interne, **aucun port publié**. Elle termine TLS sur
  `https://s3:8443` avec le certificat émis pour le nom `s3` par l'autorité
  générée à l'installation, puis transmet au socket de SeaweedFS. Elle détient
  la clé TLS, aucune identité S3 ; tourne sous l'utilisateur `node`. HTTP en
  clair refusé (connexion coupée).
- `s3-init` : conteneur ponctuel (même image que l'app) qui vérifie à chaque
  démarrage que le bucket privé existe, le crée sinon, puis s'arrête. Un bucket
  existant n'est jamais modifié.

L'application fait confiance à l'autorité interne via `NODE_EXTRA_CA_CERTS`
(`certs/ca.pem`) ; la vérification TLS n'est jamais désactivée.

## 2. Prérequis

- Linux avec Docker Engine et le plugin Docker Compose v2 (`docker compose version`).
- Un shell POSIX (`sh`) et `openssl` (mots de passe, clés et certificat TLS interne).
- Docker accessible à l'utilisateur qui lance `install.sh` lors de la première
  configuration (voir section 4).
- De l'espace disque pour les volumes `pgdata` (base) et `s3data` (captures).
- Pour un accès depuis d'autres machines (admin distant, widget sur un site
  client) : un nom de domaine pointant vers le serveur et un reverse proxy
  HTTPS sur ce même serveur (section 6).

## 3. Vérifier et extraire l'archive

Téléchargez `reviewdesk-vX.Y.Z-docker.zip` et son `.sha256` depuis la
[dernière release GitHub](https://github.com/hugoinformatique/reviewdesk/releases/latest),
ou construisez-les depuis les sources avec `npm ci && npm run package:docker`
(Node 22 ; résultat dans `dist/kits/`).

```sh
sha256sum -c reviewdesk-v*-docker.zip.sha256
unzip reviewdesk-v*-docker.zip
cd reviewdesk-v*-docker
```

## 4. Configurer

### Installation par défaut (S3 intégré)

```sh
sh install.sh --non-interactive --port 48300
```

Aucune valeur S3 n'est demandée. Sans `--non-interactive`, le script demande
le port, puis un éventuel point d'accès S3 externe : laissez vide pour le
stockage intégré. Options utiles : `--s3-bucket NOM` (défaut
`reviewdesk-captures`), `--s3-key-prefix PREFIXE` (défaut `uploads`).
`sh install.sh --help` liste toutes les options.

### Ce que produit `install.sh` (S3 intégré)

| Fichier | Contenu | Droits |
|---|---|---|
| `.env` | port, `REVIEWDESK_S3=bundled`, `COMPOSE_PROFILES=bundled-s3`, paramètres S3 non secrets | 600 |
| `secrets/admin_password` | mot de passe administrateur généré (32 caractères) | 600 |
| `secrets/postgres_password` | mot de passe PostgreSQL généré, distinct | 600 |
| `secrets/s3_access_key_id`, `secrets/s3_secret_access_key` | identité S3 de l'application, générée | 600 |
| `secrets/s3_admin_access_key_id`, `secrets/s3_admin_secret_access_key` | identité S3 d'initialisation (création du bucket), générée, distincte | 600 |
| `secrets/s3_tls_key` | clé privée TLS du S3 intégré (passerelle `s3` et `s3-storage`) | 600 |
| `certs/ca.pem` | autorité TLS interne (certificat public) | 644 |
| `certs/s3.pem` | certificat du service `s3` (nom `s3`, 10 ans) | 644 |

Les clés S3 sont aléatoires et propres à chaque installation. La clé privée de
l'autorité sert une seule fois à signer `certs/s3.pem`, puis elle est
**détruite** : aucun autre certificat ne pourra jamais être reconnu par
l'application. Les deux identités S3 sont limitées au bucket configuré ;
l'accès anonyme n'existe pas.

Dans le conteneur `s3`, un script lit ces secrets montés en fichiers, écrit la
configuration SeaweedFS et une copie de la clé TLS en mémoire (`tmpfs`, droits
600), puis lance SeaweedFS sans privilèges. Aucun secret ne passe par une
variable d'environnement, `docker compose config` ni les journaux.

### Règles appliquées

- aucun secret n'est affiché ni journalisé ;
- une configuration existante n'est **jamais écrasée ni régénérée** : relancé
  sans option, le script la vérifie (droits, valeurs, certificat valide pour
  `s3` et signé par `certs/ca.pem`, clé TLS correspondante) et la conserve ;
  avec des options, il refuse ;
- une configuration partielle ou invalide est refusée sans rien modifier (par
  exemple `secrets/s3_tls_key` ou `certs/s3.pem` manquant) ;
- un fichier `certs/ca.pem` ou `certs/s3.pem` déjà présent n'est jamais
  remplacé : la nouvelle installation s'arrête ;
- pour une **nouvelle** configuration, le script exige que Docker confirme
  l'absence des volumes `reviewdesk_pgdata` **et** `reviewdesk_s3data` (ou
  `<COMPOSE_PROJECT_NAME>_…`) : si l'un existe, ou si Docker est absent, arrêté
  ou refuse l'accès (doute), le script s'arrête sans rien écrire plutôt que
  générer des mots de passe et des clés qui ne correspondraient plus aux
  données. La vérification d'une configuration existante n'a pas besoin de
  Docker ;
- un verrou exclusif (dossier `.reviewdesk-install.lock`) est pris avant toute
  vérification : deux exécutions simultanées ne peuvent ni passer les
  contrôles ensemble ni mélanger leurs fichiers ; la seconde s'arrête.
  Après un arrêt brutal (`kill -9`, coupure), supprimez ce dossier à la main
  **après avoir vérifié** qu'aucun `install.sh` ne tourne ;
- les fichiers sont publiés sans écrasement possible (un fichier apparu entre
  temps provoque un arrêt, jamais un remplacement).

**Récupérer le mot de passe administrateur**, localement sur le serveur :

```sh
cat secrets/admin_password
```

Identifiant de connexion : `admin`. Ne copiez ce mot de passe ni dans un ticket,
ni dans un chat, ni dans des journaux. **Sauvegardez `.env`, `secrets/` et
`certs/` ensemble** dans un coffre chiffré : sans eux, la base et le stockage
ne sont plus accessibles.

## 5. Démarrer

```sh
docker compose up -d --build
docker compose ps
curl -fsS http://127.0.0.1:48300/health
```

`/health` répond `{"ok":true,"database":"postgresql","storage":"s3 reviewdesk-captures @ s3:8443"}`
(`curl` est facultatif ; sans lui, `docker compose ps` doit afficher `app` en
état `healthy` et `s3-init` terminé avec le code 0).

Ordre de démarrage : `postgres` et `s3-storage` (sain quand SeaweedFS répond
en HTTPS sur sa boucle locale, certificat vérifié par `certs/ca.pem`), puis
`s3` (sain quand `https://s3:8443/healthz` répond de bout en bout), puis
`s3-init`, puis `app`. `docker compose logs s3-init` indique « bucket S3 privé … créé » au
premier démarrage, « existe déjà, inchangé » ensuite.

Au démarrage, le conteneur `app`, avant de lancer le serveur :

1. lit les secrets montés dans `/run/secrets/` et refuse un secret absent, vide
   ou multiligne ;
2. revalide `S3_ENDPOINT` (HTTPS exact), le bucket, la région ;
3. vérifie le bucket **avec** les identifiants (`HeadBucket` signé) : il doit
   exister et accepter la clé ;
4. demande la liste du bucket **sans identifiants** : seule une réponse 401/403
   (accès refusé) est acceptée ;
5. écrit, avec les identifiants, un petit objet de test sans donnée
   (`<préfixe>/.reviewdesk-startup-probe-<aléatoire>`), le relit **sans
   identifiants** — seule une réponse 401/403 est acceptée — puis le supprime
   dans tous les cas. Objet lisible anonymement, réponse inattendue, écriture
   ou suppression refusée : arrêt avec un message explicite (qui nomme l'objet
   s'il n'a pas pu être supprimé, jamais un secret) ;
6. abandonne les privilèges root et exécute le serveur sous l'utilisateur
   `node`, système de fichiers en lecture seule, capacités Linux retirées.

Les migrations de base sont appliquées automatiquement au démarrage.

## 6. Exposer en HTTPS (admin distant et widget)

Le port 48300 n'écoute que sur `127.0.0.1` : il n'est **pas joignable** depuis
une autre machine, volontairement. L'accès distant passe par un reverse proxy
HTTPS **installé sur le même hôte**, avec un vrai nom de domaine et un
certificat TLS valide (Let's Encrypt ou équivalent). Le proxy doit transmettre
l'en-tête `Host` d'origine et `X-Forwarded-Proto: https` : ReviewDesk s'en sert
pour sa protection contre les écritures inter-sites, et ses cookies de session
`Secure` exigent HTTPS. L'application fait confiance à ces en-têtes ; c'est
sûr uniquement parce que seul un processus local peut joindre le port.

Les configurations Caddy et nginx ci-dessous sont des exemples à adapter ;
elles n'ont pas été exécutées lors de la validation de cette archive, qui a
utilisé un proxy TLS local de test (sur `127.0.0.1`, nom de test, autorité de
test) appliquant les mêmes en-têtes. Aucun proxy public, nom de domaine réel
ni certificat public n'a été testé.

### Caddy (certificat automatique)

```
reviews.example.com {
	reverse_proxy 127.0.0.1:48300
}
```

Caddy transmet `Host` et `X-Forwarded-Proto` par défaut.

### nginx

```nginx
server {
    listen 443 ssl;
    http2 on;
    server_name reviews.example.com;
    ssl_certificate     /etc/letsencrypt/live/reviews.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/reviews.example.com/privkey.pem;
    client_max_body_size 5m;
    location / {
        proxy_pass http://127.0.0.1:48300;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

Ensuite :

- administration : `https://reviews.example.com/` ;
- widget sur un site client : chargez `https://reviews.example.com/widget.js`
  et déclarez l'origine exacte du site (ex. `https://www.client.fr`) dans les
  origines autorisées du projet. Un site HTTPS ne peut pas charger un widget
  servi en HTTP.

### Proxy sur une autre machine

Ne publiez jamais le port HTTP de l'application sur une interface réseau. Si le
proxy TLS doit tourner ailleurs, reliez-le au serveur par un tunnel chiffré qui
aboutit sur `127.0.0.1:48300` (WireGuard, ou `ssh -N -L 48300:127.0.0.1:48300
serveur` depuis la machine du proxy), et ne laissez aucun autre client joindre
l'extrémité du tunnel.

### Administration sans domaine

Pour un accès admin ponctuel sans proxy, un tunnel SSH depuis votre poste
suffit : `ssh -N -L 48300:127.0.0.1:48300 serveur`, puis
`http://localhost:48300/`. Les navigateurs courants traitent `localhost` comme
un contexte sécurisé ; si la connexion échoue (cookie `Secure` refusé), passez
par le domaine HTTPS. Le widget, lui, exige le domaine HTTPS.

## 7. Stockage S3

### S3 intégré (défaut)

- Bucket privé dans le volume `reviewdesk_s3data`, créé par `s3-init`. Aucun
  port S3 n'est publié sur l'hôte : seuls les conteneurs du réseau interne
  Compose (app, s3-init) peuvent le joindre.
- Aucun port de SeaweedFS n'est joignable depuis le réseau : le conteneur
  `s3-storage` n'a pas d'interface réseau. C'est indispensable pour son port
  gRPC S3 : SeaweedFS 4.48 y expose des appels d'administration des identités
  qui ne sont pas authentifiés sans clé de signature du filer.
- Pas de S3 en HTTP clair sur le réseau : seule la passerelle `s3` écoute, en
  HTTPS sur 8443. Dans `s3-storage`, le port S3 principal est en HTTPS seul ;
  le socket Unix de SeaweedFS, lui, parle HTTP en clair (non désactivable dans
  SeaweedFS 4.48), mais il n'est accessible qu'aux conteneurs `s3-storage` et
  `s3`, dans un volume en mémoire.
- Le certificat `certs/s3.pem` est valable 10 ans. Son renouvellement n'est pas
  outillé : `install.sh` refuse de régénérer une configuration existante.

### S3 externe (facultatif)

Pour un bucket chez un fournisseur (R2, AWS, Scaleway…), passez
`--s3-endpoint` : les services `s3-storage`, `s3` et `s3-init` restent alors désactivés
(`REVIEWDESK_S3=external`, `COMPOSE_PROFILES` vide). Préparez un fichier
d'identifiants hors du dossier, en droits 600 :

```sh
umask 077
cat > ~/reviewdesk-s3.txt <<'EOF'
S3_ACCESS_KEY_ID=votre-cle
S3_SECRET_ACCESS_KEY=votre-secret
EOF
sh install.sh --non-interactive \
  --port 48300 \
  --s3-endpoint https://s3.example.com \
  --s3-bucket reviewdesk-captures \
  --s3-region auto \
  --s3-credentials-file ~/reviewdesk-s3.txt
shred -u ~/reviewdesk-s3.txt   # ou rm, une fois la configuration créée
```

`--s3-credentials-stdin` lit les deux mêmes lignes sur l'entrée standard ;
sans ces options, en mode interactif, la clé et son secret sont saisis en
**saisie masquée**. `--s3-region`, `--s3-path-style`, `--ca-file` et les
options d'identifiants sont refusées sans `--s3-endpoint`.

- `S3_ENDPOINT` doit être exactement `https://hôte[:port]`, sous forme
  canonique (hôte en minuscules, pas de `:443` explicite, port sans zéro
  initial, IPv4 uniquement en notation pointée complète) : HTTP, chemin,
  paramètres et identifiants dans l'URL sont refusés.
- Le bucket doit déjà exister et rester **privé** ; activez le blocage de
  l'accès public du fournisseur. Clé dédiée limitée à ce bucket, permissions
  minimales (noms AWS IAM) : `s3:ListBucket` sur le bucket (requis par
  `HeadBucket`), `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` sur les
  objets du préfixe.
- `S3_FORCE_PATH_STYLE=true` (défaut) convient à R2, MinIO, SeaweedFS et AWS ;
  `false` pour l'adressage virtuel (`https://bucket.hôte`).
- **Autorité privée** : copiez le certificat PEM de l'autorité du fournisseur
  (jamais de clé privée) dans `certs/`, par exemple `certs/fournisseur-ca.pem`,
  et passez `--ca-file fournisseur-ca.pem`.
- Ce que le démarrage prouve : un objet **nouvellement écrit** dans le préfixe
  n'est pas lisible anonymement *à cet instant*. Il ne prouve pas l'absence
  d'ACL publique sur d'**autres** objets, ni une modification ultérieure de la
  politique. Un fournisseur qui répond autre chose que 401/403 à une lecture
  anonyme empêche le démarrage.
- Les sauvegardes des captures se configurent alors chez le fournisseur.

## 8. Exploitation

| Action | Commande |
|---|---|
| État | `docker compose ps -a` |
| Journaux | `docker compose logs --tail 100 app` |
| Arrêt | `docker compose stop` |
| Redémarrage | `docker compose up -d` |
| Sauvegarde base | `umask 077; docker compose exec -T postgres pg_dump -U reviewdesk reviewdesk > reviewdesk.sql` |

- **Ne lancez jamais `docker compose down -v`** ni `docker volume prune` : ils
  suppriment les volumes de la base et des captures.
- **Sauvegarde des captures (S3 intégré)** : elles sont dans le volume
  `reviewdesk_s3data`. Une copie cohérente se fait SeaweedFS arrêté
  (`docker compose stop app s3 s3-storage`), en archivant le volume avec vos outils
  habituels, puis `docker compose up -d`. Cette procédure n'est ni outillée ni
  testée par l'archive.
- **Mise à jour** : depuis le dossier d'installation courant,
  `sh update.sh` installe la dernière release GitHub (`--version X.Y.Z` pour
  une version précise, `--archive reviewdesk-vX.Y.Z-docker.zip` pour une mise
  à jour hors ligne, avec son `.sha256` à côté ; `--yes` saute la confirmation,
  `--skip-backup` ignore la sauvegarde, `--timeout SECONDES` borne l'attente ;
  `sh update.sh --help` détaille tout). Le script vérifie le SHA-256, extrait
  la version dans le dossier frère `reviewdesk-vX.Y.Z-docker` (refusé s'il
  existe), y copie `.env`, `secrets/` et `certs/` avec leurs droits, vérifie
  la configuration (`sh install.sh`), demande confirmation, sauvegarde la base
  (`backup-AAAAMMJJ-HHMMSS.sql`, dans l'**ancien** dossier, arrêt si elle
  échoue), relance `docker compose up -d --build --force-recreate` depuis le
  nouveau dossier et attend que `app` soit `healthy`. Il ne propose jamais de
  version plus ancienne, ne supprime ni l'ancien dossier ni les volumes
  (jamais de `down -v`). **Retour arrière** : relancez
  `docker compose up -d --build --force-recreate` depuis l'ancien dossier et,
  si les migrations ont modifié la base, restaurez d'abord la sauvegarde.
  À la main, les mêmes étapes :
  extrayez la nouvelle archive dans un nouveau dossier,
  copiez-y `.env`, `secrets/` et `certs/` en conservant les droits
  (`cp -a`), vérifiez avec `sh install.sh`, puis, depuis ce dossier :
  `docker compose up -d --build --force-recreate`. `--force-recreate` est
  nécessaire : sans lui, un conteneur non modifié (par exemple `postgres`)
  garderait ses secrets montés depuis l'**ancien** dossier et ne pourrait plus
  redémarrer si ce dossier est supprimé. Le nom de projet Compose `reviewdesk`
  est fixé dans `compose.yaml` : les mêmes volumes sont réutilisés.
- **Mise à jour depuis une version sans S3 intégré** : un `.env` écrit par
  l'ancien `install.sh` ne contient ni `REVIEWDESK_S3` ni `COMPOSE_PROFILES`.
  Il est accepté tel quel et lu comme un S3 externe ; `install.sh` ne le
  réécrit pas (message « Format de .env antérieur … laissé tel quel »). Les
  services du S3 intégré restent désactivés. Si vous ajoutez à la main
  `COMPOSE_PROFILES`, ajoutez aussi `REVIEWDESK_S3=external`, sinon
  `install.sh` refuse la configuration.
- La restauration d'une sauvegarde n'est pas outillée par cette archive ;
  testez-la sur une instance séparée avant d'en dépendre.

## 9. Dépannage

| Message | Cause et correction |
|---|---|
| `Configuration absente : lancez sh install.sh` | `.env` manquant. |
| `bind source path does not exist: …/secrets/…` | un fichier de `secrets/` manque : restaurez-le depuis votre sauvegarde. |
| `configuration partielle (incomplète)` | idem (ou `certs/`) ; `install.sh` ne régénère jamais un secret ou un certificat isolé. |
| `le volume …_pgdata existe déjà` / `…_s3data existe déjà` | des données existent : restaurez `.env`, `secrets/` et `certs/` d'origine au lieu de réinstaller. |
| `certs/ca.pem existe déjà` (install.sh) | fichier non généré par ce script : déplacez-le (nouvelle installation uniquement). |
| `certs/s3.pem n'est pas valide pour le nom s3` | certificat expiré, remplacé ou ne venant pas de `certs/ca.pem` : restaurez `certs/` depuis la sauvegarde. |
| `ReviewDesk (S3 intégré) : …` (journaux `s3-storage`) | secret ou certificat manquant/invalide, ou volume `/data` / `s3socket` d'un autre propriétaire. |
| `ReviewDesk (passerelle S3) : …` (journaux `s3`) | `certs/s3.pem` ou `secrets/s3_tls_key` manquant ou invalide : restaurez-les depuis la sauvegarde. |
| `ReviewDesk (initialisation S3) : …` (journaux `s3-init`) | `s3` injoignable ou identité d'initialisation refusée : vérifiez `secrets/s3_admin_*`. |
| `Le bucket S3 est lisible anonymement` | retirez l'accès public du bucket (S3 externe). |
| `Les objets du bucket S3 sont lisibles anonymement` | la liste est refusée mais les objets sont publics : retirez la politique/ACL de lecture publique. |
| `Identifiants S3 refusés pour ce bucket` | clé ou région erronée, ou permission `s3:ListBucket` manquante (S3 externe). |
| `Écriture S3 refusée` / `L'objet de test … n'a pas pu être supprimé` | permissions `s3:PutObject` / `s3:DeleteObject` manquantes sur le préfixe ; supprimez l'objet nommé à la main. |
| `Docker est introuvable` / `Docker ne répond pas` (install.sh) | première configuration : lancez le script là où `docker volume ls` fonctionne. |
| `une autre installation est en cours` | un `install.sh` tourne déjà ; sinon supprimez `.reviewdesk-install.lock`. |
| `Bucket S3 introuvable` | créez le bucket ou corrigez `S3_BUCKET` / `S3_ENDPOINT` (S3 externe). |
| `REVIEWDESK_S3 manquant … COMPOSE_PROFILES est défini` | `.env` de l'ancien format modifié à la main : ajoutez `REVIEWDESK_S3=external` (ou retirez `COMPOSE_PROFILES`). |
| `S3 injoignable en HTTPS (…)` | service `s3` ou `s3-storage` arrêté, DNS, pare-feu sortant, ou autorité de certification manquante. |
| `password authentication failed` (journaux postgres) | `secrets/postgres_password` ne correspond plus au volume existant : restaurez l'ancien fichier. |
| `Cannot restart container …: no such file or directory` | conteneur créé depuis un ancien dossier supprimé : `docker compose up -d --force-recreate` depuis le dossier actuel. |
| Connexion admin refusée en HTTP | normal : cookies `Secure`, passez par HTTPS (section 6). |

## 10. Limites connues

- Hôte Linux avec Docker Engine ; Docker Desktop, Podman et les modes
  rootless ou `userns-remap` ne sont pas vérifiés.
- S3 intégré : une seule instance SeaweedFS, sans réplication ; la durabilité
  des captures est celle du disque de l'hôte et de vos sauvegardes.
- Reverse proxy, nom de domaine, certificat public et pare-feu restent à votre
  charge ; aucun proxy public n'a été testé.
- S3 externe : vérification de confidentialité exercée de bout en bout
  uniquement contre SeaweedFS ; compatibilité non vérifiée avec AWS S3,
  Cloudflare R2, Scaleway, Backblaze B2 ou MinIO réels. Les points d'accès en
  adresse IPv6 littérale et les jetons temporaires (`S3_SESSION_TOKEN`) ne sont
  pas pris en charge.
