# ReviewDesk — guide d'auto-hébergement Docker Compose

Cette archive installe ReviewDesk sur un serveur avec Docker Compose :
l'application compilée, une base PostgreSQL dédiée et un stockage S3 externe
privé pour les captures d'écran. Aucun Node.js n'est requis sur l'hôte.

> **Statut juridique.** Tous droits réservés. Cette archive n'accorde aucune
> licence ; sa redistribution n'est autorisée que par le titulaire des droits,
> qui décide seul des conditions d'utilisation. Voir `NOTICE.txt`.

## 1. Architecture

```
navigateur / widget ──HTTPS──▶ reverse proxy (même hôte) ──HTTP──▶ 127.0.0.1:48300 ─▶ app (conteneur)
                                                                                        │   │
                                                         réseau interne Compose ◀──────┘   └──HTTPS──▶ S3 privé
                                                                 │
                                                             postgres (aucun port publié, volume pgdata)
```

- `app` : image construite localement depuis `app/Dockerfile` (image officielle
  `node:22.23.3-bookworm-slim`, épinglée par digest). Dépendances de production
  uniquement, installées par `npm ci` depuis `app/package-lock.json`.
  `NODE_ENV=production`, `HOST=0.0.0.0` dans le conteneur, cookies `Secure`.
  Le port est publié **uniquement sur 127.0.0.1**.
- `postgres` : image officielle `postgres:17.11-alpine3.24`, épinglée par
  digest. Réseau Compose `internal` : pas de port publié, pas d'accès sortant.
  Données dans le volume nommé `reviewdesk_pgdata`.
- Stockage : bucket S3 externe **privé**, joint en HTTPS uniquement.

## 2. Prérequis

- Linux avec Docker Engine et le plugin Docker Compose v2 (`docker compose version`).
- Un shell POSIX (`sh`) et `openssl` (génération des mots de passe).
- Un bucket S3 compatible déjà créé, **privé**, avec le **blocage de l'accès
  public** du fournisseur activé s'il existe, et une clé d'accès dédiée limitée
  à ce bucket. Permissions minimales (noms AWS IAM ; équivalents chez les
  autres fournisseurs) :
  - `s3:ListBucket` sur le bucket : requis par la vérification `HeadBucket` du
    démarrage (sans elle, le démarrage échoue avec « Identifiants S3 refusés ») ;
  - `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` sur les objets du préfixe
    configuré (`uploads/` par défaut) : captures, et objet de test du démarrage.
- Docker accessible à l'utilisateur qui lance `install.sh` lors de la première
  configuration (voir section 4).
- Pour un accès depuis d'autres machines (admin distant, widget sur un site
  client) : un nom de domaine pointant vers le serveur et un reverse proxy
  HTTPS sur ce même serveur (section 6).

## 3. Vérifier et extraire l'archive

```sh
sha256sum -c reviewdesk-v8.0.0-docker.zip.sha256
unzip reviewdesk-v8.0.0-docker.zip
cd reviewdesk-v8.0.0-docker
```

## 4. Configurer

### Mode interactif

```sh
sh install.sh
```

Le script demande le port local (défaut 48300), le point d'accès S3, le bucket,
la région, le style d'adressage, un éventuel certificat d'autorité privée, puis
la clé S3 et son secret en **saisie masquée**.

### Mode non interactif

Préparez un fichier d'identifiants hors du dossier, en droits 600 :

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

`--s3-credentials-stdin` lit les deux mêmes lignes sur l'entrée standard.
`sh install.sh --help` liste toutes les options.

### Ce que produit `install.sh`

| Fichier | Contenu | Droits |
|---|---|---|
| `.env` | port, paramètres S3 non secrets, chemin du certificat d'autorité | 600 |
| `secrets/admin_password` | mot de passe administrateur généré (32 caractères) | 600 |
| `secrets/postgres_password` | mot de passe PostgreSQL généré, distinct | 600 |
| `secrets/s3_access_key_id`, `secrets/s3_secret_access_key` | identifiants S3 fournis | 600 |

Règles appliquées :

- aucun secret n'est affiché ni journalisé ;
- `S3_ENDPOINT` doit être exactement `https://hôte[:port]` : HTTP, chemin,
  paramètres et identifiants dans l'URL sont refusés, et l'URL est utilisée
  telle quelle (jamais réécrite en HTTP) ;
- une configuration existante n'est **jamais écrasée** : relancé sans option,
  le script la vérifie (droits, valeurs) et la conserve ; avec des options, il
  refuse ;
- `S3_ENDPOINT` doit déjà être sous forme canonique, exactement comme le
  démarrage l'exige : hôte en minuscules, pas de `:443` explicite, port sans
  zéro initial, adresse IPv4 uniquement en notation pointée complète ;
- une configuration partielle ou invalide est refusée sans rien modifier ;
- un verrou exclusif (dossier `.reviewdesk-install.lock`) est pris avant toute
  vérification : deux exécutions simultanées ne peuvent ni passer les
  contrôles ensemble ni mélanger leurs fichiers ; la seconde s'arrête.
  Après un arrêt brutal (`kill -9`, coupure), supprimez ce dossier à la main
  **après avoir vérifié** qu'aucun `install.sh` ne tourne ;
- les fichiers sont publiés sans écrasement possible (un fichier apparu entre
  temps provoque un arrêt, jamais un remplacement) ;
- pour une **nouvelle** configuration, le script exige que Docker confirme
  l'absence du volume `reviewdesk_pgdata` (ou `<COMPOSE_PROJECT_NAME>_pgdata`) :
  s'il existe, ou si Docker est absent, arrêté ou refuse l'accès (doute),
  le script s'arrête sans rien écrire plutôt que générer un mot de passe
  PostgreSQL qui ne correspondrait plus à la base. La vérification d'une
  configuration existante n'a pas besoin de Docker.

**Récupérer le mot de passe administrateur**, localement sur le serveur :

```sh
cat secrets/admin_password
```

Identifiant de connexion : `admin`. Ne copiez ce mot de passe ni dans un ticket,
ni dans un chat, ni dans des journaux. Sauvegardez `.env` et `secrets/` dans un
coffre chiffré : sans `secrets/postgres_password`, la base n'est plus accessible.

## 5. Démarrer

```sh
docker compose up -d --build
docker compose ps
curl -fsS http://127.0.0.1:48300/health
```

`/health` répond `{"ok":true,"database":"postgresql","storage":"s3 …"}`
(`curl` est facultatif ; sans lui, `docker compose ps` doit afficher `app` en
état `healthy`).

Au démarrage, le conteneur `app`, avant de lancer le serveur :

1. lit les secrets montés dans `/run/secrets/` et refuse un secret absent, vide
   ou multiligne ;
2. revalide `S3_ENDPOINT` (HTTPS exact), le bucket, la région ;
3. vérifie le bucket **avec** les identifiants (`HeadBucket` signé) : il doit
   exister et accepter la clé ;
4. demande la liste du bucket **sans identifiants** : seule une réponse 401/403
   (accès refusé) est acceptée ;
5. un refus de liste ne prouve pas que les objets sont privés. Le conteneur
   écrit donc, avec les identifiants, un petit objet de test sans donnée
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
utilisé un proxy TLS local de test appliquant les mêmes en-têtes.

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

## 7. Stockage S3 et autorité de certification privée

- Le bucket doit exister et rester **privé** : aucune lecture anonyme, aucune
  politique publique. Activez le blocage de l'accès public proposé par le
  fournisseur. Ce que le démarrage prouve, et ce qu'il ne prouve pas :
  un objet **nouvellement écrit** dans le préfixe n'est pas lisible
  anonymement *à cet instant*. Il ne peut pas prouver l'absence d'ACL publique
  posée sur d'**autres** objets, ni une modification ultérieure de la politique
  du bucket (la vérification n'a lieu qu'au démarrage). Seule une réponse
  401/403 explicite est acceptée : un fournisseur qui répond autrement à une
  lecture anonyme (404, 400…) empêche le démarrage. Les captures transitent par l'application ; aucune règle
  CORS n'est nécessaire sur le bucket.
- `S3_FORCE_PATH_STYLE=true` (défaut) convient à Cloudflare R2, MinIO,
  SeaweedFS et AWS. Mettez `false` pour l'adressage virtuel
  (`https://bucket.hôte`).
- **Autorité privée** : si le certificat du S3 est émis par une autorité
  interne, copiez le certificat PEM de cette autorité (jamais de clé privée)
  dans `certs/`, par exemple `certs/ca.pem`, et passez `--ca-file ca.pem` à
  `install.sh`. Pour une configuration existante, renseignez dans `.env` :
  `NODE_EXTRA_CA_CERTS=/etc/reviewdesk/certs/ca.pem`, puis
  `docker compose up -d`. La vérification TLS reste active ; elle n'est
  jamais désactivée.

## 8. Exploitation

| Action | Commande |
|---|---|
| État | `docker compose ps` |
| Journaux | `docker compose logs --tail 100 app` |
| Arrêt | `docker compose stop` |
| Redémarrage | `docker compose up -d` |
| Sauvegarde base | `umask 077; docker compose exec -T postgres pg_dump -U reviewdesk reviewdesk > reviewdesk.sql` |

- **Ne lancez jamais `docker compose down -v`** : `-v` supprime le volume de la
  base de données.
- Les captures sont dans le bucket : leur sauvegarde se configure chez le
  fournisseur S3 (versionnage, réplication).
- **Mise à jour** : extrayez la nouvelle archive dans un nouveau dossier,
  copiez-y `.env`, `secrets/` (en conservant les droits : `cp -a`) et `certs/`,
  vérifiez avec `sh install.sh`, puis `docker compose up -d --build` depuis ce
  dossier. Le nom de projet Compose `reviewdesk` est fixé dans `compose.yaml` :
  le même volume `reviewdesk_pgdata` est réutilisé.
- La restauration d'une sauvegarde n'est pas outillée par cette archive ;
  testez-la sur une instance séparée avant d'en dépendre.

## 9. Dépannage

| Message | Cause et correction |
|---|---|
| `Configuration absente : lancez sh install.sh` | `.env` manquant. |
| `bind source path does not exist: …/secrets/…` | un fichier de `secrets/` manque : restaurez-le depuis votre sauvegarde. |
| `configuration partielle (incomplète)` | idem ; `install.sh` ne régénère jamais un secret isolé. |
| `Le bucket S3 est lisible anonymement` | retirez l'accès public du bucket. |
| `Les objets du bucket S3 sont lisibles anonymement` | la liste est refusée mais les objets sont publics : retirez la politique/ACL de lecture publique, activez le blocage de l'accès public. |
| `Identifiants S3 refusés pour ce bucket` | clé ou région erronée, ou permission `s3:ListBucket` manquante (requise par `HeadBucket`). |
| `Écriture S3 refusée` / `L'objet de test … n'a pas pu être supprimé` | permissions `s3:PutObject` / `s3:DeleteObject` manquantes sur le préfixe ; supprimez l'objet nommé à la main. |
| `Docker est introuvable` / `Docker ne répond pas` (install.sh) | première configuration : lancez le script là où `docker volume ls` fonctionne. |
| `une autre installation est en cours` | un `install.sh` tourne déjà ; sinon supprimez `.reviewdesk-install.lock`. |
| `Bucket S3 introuvable` | créez le bucket ou corrigez `S3_BUCKET` / `S3_ENDPOINT`. |
| `S3 injoignable en HTTPS (…)` | DNS, pare-feu sortant, ou certificat d'autorité privée manquant (section 7). |
| `password authentication failed` (journaux postgres) | `secrets/postgres_password` ne correspond plus au volume existant : restaurez l'ancien fichier. |
| Connexion admin refusée en HTTP | normal : cookies `Secure`, passez par HTTPS (section 6). |

## 10. Limites connues

- Hôte Linux avec Docker Engine ; Docker Desktop, Podman et les modes
  `userns-remap` ne sont pas vérifiés.
- Les points d'accès S3 en adresse IPv6 littérale ne sont pas acceptés par
  `install.sh`.
- Vérification de confidentialité S3 : exercée de bout en bout uniquement
  contre SeaweedFS (bucket privé, et bucket à objets lisibles anonymement).
  Compatibilité non vérifiée avec AWS S3, Cloudflare R2, Scaleway, Backblaze
  B2 ou MinIO réels.
- Les jetons de session S3 temporaires (`S3_SESSION_TOKEN`) ne sont pas pris
  en charge par cette distribution.
- Le reverse proxy, le certificat public et le pare-feu restent à votre charge.
