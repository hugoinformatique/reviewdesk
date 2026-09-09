# ReviewDesk MVP

MVP autonome de review visuelle pour sites de préproduction : widget JavaScript en Shadow DOM, épingle ancrée à un élément, tickets multi-projets et administration privée.

## Architecture

Deux modes existent et ne se mélangent pas :

- **production / Vercel** : PostgreSQL externe via `DATABASE_URL` et stockage objet S3-compatible **privé** via `STORAGE_DRIVER=s3` ;
- **développement local uniquement** : PGlite sur disque et fichiers locaux. Ces pilotes sont refusés si `NODE_ENV=production` ou `VERCEL=1`.

Le handler serverless est `api/index.ts`. Chaque instance chaude réutilise un pool PostgreSQL borné (`DATABASE_POOL_MAX=1` par défaut). Les migrations sont idempotentes, sérialisées par advisory lock et peuvent être lancées au démarrage ou avec `npm run migrate`.

## Fonctionnalités

- projets avec libellé client et liste exacte des origines autorisées ;
- liens reviewer révocables, secret stocké uniquement sous forme de SHA-256 ;
- widget indépendant du framework, desktop et tactile, avec épingle relative à un élément et au viewport ;
- commentaire, diagnostics strictement opt-in et prévisualisés, capture PNG/JPEG/WebP choisie manuellement ;
- liste admin avec filtres projet, client, page/site, format et statut, pagination par curseur et compteur de retours ouverts par projet ;
- statuts persistants `À traiter`, `En cours`, `À valider`, `Traité` ;
- **deux réponses distinctes par retour** : une note interne, jamais exposée, et une réponse que le reviewer relit dans le widget ;
- **retour au point d'ancrage** : depuis l'admin, un lien rouvre la page de préproduction avec l'épingle reposée sur l'élément concerné. L'ancrage voyage dans le fragment d'URL, que le navigateur n'envoie jamais au serveur du client ;
- **notification sortante** par projet : un POST JSON à chaque nouveau retour, vers une URL HTTPS publique ;
- téléchargements privés servis seulement après authentification admin.

Le rejeu d'épingle suppose que le widget est déjà installé sur la page ouverte,
ce qui est le cas d'une préproduction équipée du snippet ci-dessous. Le lien ne
contient aucun secret : c'est le snippet de la page qui porte le token.

## Développement local

```bash
npm install
npm run build
ADMIN_PASSWORD="une-phrase-secrete-longue" \
DATABASE_URL="pglite://.data/reviewdesk" \
STORAGE_DRIVER=filesystem \
npm start
```

Ouvrir `http://127.0.0.1:4300`. Pour une vraie origine distincte :

```bash
python3 -m http.server 4311 --bind 127.0.0.1 --directory public
```

Créer un projet autorisant `http://127.0.0.1:4311`, créer un lien reviewer, puis ouvrir `demo.html#project=…&review=…&api=http%3A%2F%2F127.0.0.1%3A4300`. Le token reste dans le fragment et est retiré de l’URL après initialisation ; il est envoyé par en-tête `Authorization`, jamais en query HTTP.

### Intégration du widget

```html
<script src="https://reviewdesk-preview.example/widget.js"></script>
<script>
  ReviewDesk.init({
    api: "https://reviewdesk-preview.example",
    projectId: "UUID_DU_PROJET",
    token: "SECRET_DU_LIEN_REVIEWER"
  })
</script>
```

N’inclure ce script que sur une préproduction protégée. En React ou Astro, initialiser côté client après chargement du script.

## Configuration Vercel

### 1. PostgreSQL externe

Créer une base **dédiée** chez Neon, Supabase ou un fournisseur PostgreSQL compatible. Utiliser sa chaîne **poolée** avec TLS :

```text
DATABASE_URL=postgresql://...pooler.../reviewdesk?sslmode=require
DATABASE_POOL_MAX=1
```

Ne jamais réutiliser une base métier. Le plan et le tarif dépendent du fournisseur ; vérifier quota, région, sauvegardes et politique de mise en veille avant activation.

### 2. Stockage objet privé

Créer un bucket dédié Cloudflare R2, AWS S3, Scaleway, Backblaze B2 ou compatible S3. Pour R2, laisser le bucket privé : ne pas activer `r2.dev` ni de domaine public. Créer des identifiants limités à ce bucket.

```text
STORAGE_DRIVER=s3
S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
S3_BUCKET=reviewdesk-uploads
S3_REGION=auto
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_FORCE_PATH_STYLE=true
```

Les coûts de stockage, opérations et sortie réseau sont ceux du fournisseur ; aucun achat ni ressource externe n’a été créé pendant cette livraison.

### 3. Variables et build

Ajouter aussi :

```text
ADMIN_PASSWORD=<phrase aléatoire longue>
NODE_ENV=production
RUN_MIGRATIONS_ON_BOOT=true
```

Importer le dépôt dans Vercel. `vercel.json` construit les assets statiques et route `/api/*` et `/health` vers la fonction. Après déploiement, vérifier `/health`, se connecter à l’admin, créer un projet/origine et tester un upload puis sa lecture admin.

Pour éviter les migrations au cold start, définir `RUN_MIGRATIONS_ON_BOOT=false` et exécuter `npm run migrate` depuis un environnement disposant de `DATABASE_URL` avant le déploiement.

## Confidentialité et sécurité

Les diagnostics sont désactivés par défaut. Après consentement, le reviewer voit exactement les champs envoyés : viewport, DPR borné, orientation, locale, fuseau, navigateur/OS grossiers, URL sans query/hash/credentials et erreurs structurées allowlistées. Le widget ne collecte ni champs de formulaire, cookies, localStorage, corps réseau, texte DOM, console arbitraire, IP applicative ou session replay.

Les API reviewer exigent un bearer lié au projet **et** une origine exacte ; CORS ne sert jamais d’authentification. Les uploads sont limités par défaut à **4 000 000 octets**, vérifiés par signature de fichier, SVG refusé et objets non publics. Les mutations admin exigent cookie `HttpOnly`/`SameSite=Strict` et jeton CSRF. Les réponses privées portent `no-store` et la journalisation expurge les secrets.

Les captures sont exclusivement manuelles. Le MVP ne prétend pas masquer automatiquement des données sensibles visibles dans la capture : le reviewer doit contrôler le fichier avant envoi.

## Vérifications

```bash
npm run check
```

Le contrôle lance lint, typecheck, **52 tests Node** (unitaires et intégration adversariale contre PostgreSQL + MinIO Docker jetables), build, puis **1 E2E Playwright** avec admin `:4310` et preview sur l’origine réellement distincte `:4311`, et enfin `npm audit --omit=dev`.

## Limites et prérequis avant preview Internet

- une seule identité admin par secret d’environnement ; pas de SSO ni comptes multiples ;
- aucune capture automatique ni annotation flèche/rectangle ; upload manuel seulement ;
- rate limiting persistant par lien, mais pas de protection réseau/WAF distribuée ;
- aucune ressource PostgreSQL, bucket, projet Vercel, domaine ou preview n’est provisionné ici ;
- la preview Internet reste bloquée tant que la base dédiée, le bucket privé, les secrets Vercel et une protection d’accès forte à la préproduction ne sont pas fournis ;
- aucun déploiement, push GitHub, donnée client réelle ou intégration PILOTAGEHI n’a été effectué.

Toutes les variables disponibles et leurs valeurs locales sont décrites dans `.env.example`.
