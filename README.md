<div align="center">

# ReviewDesk

**Le retour visuel de vos clients, épinglé au bon endroit de la page.**

Votre client ouvre la préproduction, clique l'élément qui cloche, écrit une
phrase. Vous recevez un ticket ancré à cet élément exact, avec le statut, la
capture et votre réponse — sans compte à créer pour lui, sans Slack, sans
capture d'écran annotée par mail.

[![version](https://img.shields.io/badge/version-1.1.0-4f46e5)](CHANGELOG.md)
[![node](https://img.shields.io/badge/node-22.x-informational)](package.json)
[![stack](https://img.shields.io/badge/stack-Fastify%20%2B%20PostgreSQL%20%2B%20S3-lightgrey)](#architecture)

</div>

| Côté client (widget) | Côté agence (administration) |
| --- | --- |
| ![Le widget sur mobile](artifacts/widget-mobile.png) | ![L'administration](artifacts/admin-desktop.png) |

---

## Sommaire

- [Pourquoi](#pourquoi)
- [Fonctionnalités](#fonctionnalités)
- [Démarrage en local](#démarrage-en-local)
- [Intégrer le widget sur un site](#intégrer-le-widget-sur-un-site)
- [Le parcours du reviewer](#le-parcours-du-reviewer)
- [L'administration](#ladministration)
- [Architecture](#architecture)
- [Configuration](#configuration)
- [Déploiement sur Vercel](#déploiement-sur-vercel)
- [Sécurité et confidentialité](#sécurité-et-confidentialité)
- [Référence API](#référence-api)
- [Développer et vérifier](#développer-et-vérifier)
- [Versions](#versions)
- [Limites connues](#limites-connues)
- [Contribuer](#contribuer)
- [Licence](#licence)

## Pourquoi

Un retour client sur une maquette en ligne arrive presque toujours sous une
forme inexploitable : « le bouton en bas est moche », dans un mail, sans URL, sans
taille d'écran, avec une capture recadrée. Il faut ensuite deviner de quel bouton
il s'agit, sur quelle page, dans quel navigateur.

ReviewDesk enlève cette étape de devinette. Le retour est **ancré à un élément
du DOM** et rejouable : depuis l'administration, un lien rouvre la
préproduction avec l'épingle reposée exactement au même endroit.

Et côté client, il n'y a rien à installer, rien à comprendre : un bouton
« Donner mon avis », deux étapes, et il peut relire les réponses de l'équipe
au même endroit.

## Fonctionnalités

**Pour le client qui relit**

- un bouton flottant, deux étapes numérotées : montrer l'endroit, dire ce qui ne va pas ;
- surbrillance en direct de l'élément visé, nommé en clair (« Bouton « Voir la collection » »),
  jamais un sélecteur CSS ;
- capture facultative, choisie au clic ou simplement collée (`Ctrl/⌘ + V`), avec vignette avant envoi ;
- diagnostics techniques **opt-in**, avec aperçu exact de ce qui part ;
- onglet « Mes retours » : statut de chaque retour et réponse de l'équipe, sans
  avoir à écrire quoi que ce soit ;
- interface « liquid glass » : surfaces translucides, arêtes spéculaires, ressorts
  à l'ouverture — avec repli opaque si le navigateur ne floute pas ou si le
  visiteur demande moins de transparence ;
- thème pris **sur la page hôte**, pas sur le système du reviewer : le widget
  s'habille comme le site sur lequel il est posé ;
- widget en Shadow DOM : aucun CSS du site hôte ne le déforme, et il ne déforme rien ;
- desktop, tactile, clavier (`Échap` ferme, `⌘/Ctrl + ↵` envoie), thème clair/sombre automatique.

**Pour l'équipe qui traite**

- projets multiples, avec libellé client et **liste exacte** des origines autorisées ;
- liens reviewer révocables, sans compte ni mot de passe pour le client ;
- filtres projet, client, page/site, format et statut ; pagination par curseur ;
- statuts persistants `À traiter`, `En cours`, `À valider`, `Traité` ;
- **deux réponses distinctes** par retour : une note interne jamais exposée, et
  une réponse que le reviewer relit dans son widget ;
- **retour au point d'ancrage** : un lien rouvre la préproduction, épingle reposée ;
- **notification sortante** par projet : un POST JSON à chaque nouveau retour ;
- interface utilisable de 390 px à un 21:9 de 3440 px ;
- téléchargements privés servis seulement après authentification admin.

## Démarrage en local

Prérequis : Node 22.x.

```bash
git clone https://github.com/hugoinformatique/reviewdesk.git
cd reviewdesk
npm install
npm run build

ADMIN_PASSWORD="une-phrase-secrete-longue" \
DATABASE_URL="pglite://.data/reviewdesk" \
STORAGE_DRIVER=filesystem \
npm start
```

L'administration est sur <http://127.0.0.1:4300>.

Pour exercer le widget depuis une **origine réellement distincte** (c'est le
seul moyen de valider le CORS et l'authentification par lien) :

```bash
python3 -m http.server 4311 --bind 127.0.0.1 --directory public
```

Dans l'administration : créer un projet autorisant `http://127.0.0.1:4311`,
générer un lien reviewer, puis ouvrir

```text
http://127.0.0.1:4311/demo.html#project=…&review=…&api=http%3A%2F%2F127.0.0.1%3A4300
```

Le token reste dans le fragment, est retiré de l'URL après initialisation, et
part ensuite par en-tête `Authorization` — jamais en query HTTP.

## Intégrer le widget sur un site

### Une ligne, à coller avant `</body>`

```html
<script src="https://reviewdesk.example/widget.js"
        data-api="https://reviewdesk.example"
        data-project="UUID_DU_PROJET"
        data-token="SECRET_DU_LIEN_REVIEWER"></script>
```

C'est tout : le widget s'initialise seul, y compris s'il est injecté par un CMS
ou un gestionnaire de balises. L'administration génère ce snippet, déjà rempli,
au moment où vous créez un lien reviewer.

### Options

| Attribut | `init()` | Défaut | Effet |
| --- | --- | --- | --- |
| `data-api` | `api` | origine du script | Origine de l'API ReviewDesk. |
| `data-project` | `projectId` | — | UUID du projet. **Requis.** |
| `data-token` | `token` | — | Secret du lien reviewer. **Requis.** |
| `data-label` | `label` | `Donner mon avis` | Libellé du bouton flottant. |
| `data-position` | `position` | `bottom-right` | `bottom-right` ou `bottom-left`. |
| `data-accent` | `accent` | `#4338ca` | Couleur d'accent, pour coller à la charte du site. |

### Initialisation manuelle

Utile en React, Astro ou Next quand le token vient d'un état applicatif. À
appeler côté client, après le chargement du script :

```html
<script src="https://reviewdesk.example/widget.js"></script>
<script>
  ReviewDesk.init({
    api: 'https://reviewdesk.example',
    projectId: 'UUID_DU_PROJET',
    token: 'SECRET_DU_LIEN_REVIEWER',
    label: 'Donner mon avis',
    position: 'bottom-right',
  })
</script>
```

Le widget refuse de s'initialiser deux fois sur la même page.

> [!IMPORTANT]
> N'incluez ce script **que sur une préproduction protégée**. Le token présent
> dans la page vaut droit de déposer un retour sur le projet : il est révocable
> à tout moment depuis l'administration, mais il n'est pas secret pour qui
> accède à la page.

## Le parcours du reviewer

1. **Montrer l'endroit.** Un clic sur « Cliquez ici, puis l'endroit sur la page »
   passe la page en mode pointage : l'élément survolé est encadré et nommé. Un
   clic le fige et pose l'épingle. `Échap` ou *Annuler* sort du mode à tout
   moment — lire les réponses ne doit jamais coûter un ticket bidon.
2. **Dire ce qui ne va pas.** Un texte libre (4 000 caractères), une capture
   facultative, et les diagnostics si le reviewer les accepte.
3. **Envoyer.** Confirmation immédiate, puis suivi dans « Mes retours » :
   statut et réponse de l'équipe, avec un compteur sur le bouton flottant dès
   qu'une réponse arrive.

Ce que le widget capte est exactement ce que le reviewer a désigné et écrit :
il n'y a ni capture automatique, ni lecture du DOM, ni session replay.

## L'administration

Un seul secret (`ADMIN_PASSWORD`) ouvre l'administration. On y crée les projets
et leurs origines, on génère et révoque les liens reviewer, on filtre et on
traite les retours.

Le rejeu d'épingle suppose que le widget est déjà installé sur la page ouverte,
ce qui est le cas d'une préproduction équipée du snippet ci-dessus. Le lien de
rejeu ne contient **aucun secret** : c'est le snippet de la page qui porte le
token, et l'ancre voyage dans le fragment d'URL, que le navigateur n'envoie
jamais au serveur du client.

## Architecture

```text
public/widget.js   widget Shadow DOM (build de src/widget/index.ts)
public/admin.js    interface d'administration (build de src/admin/app.ts)
src/app.ts         routes Fastify, validation Zod, garde d'origine et CSRF
src/db/            PostgreSQL (prod) ou PGlite (dev), migrations idempotentes
src/storage/       S3-compatible, Supabase Storage ou fichiers locaux (dev)
api/index.ts       handler serverless (Vercel)
```

Deux modes existent et ne se mélangent pas :

- **production** : PostgreSQL externe via `DATABASE_URL`, stockage objet
  S3-compatible **privé** via `STORAGE_DRIVER=s3` ;
- **développement local uniquement** : PGlite sur disque et fichiers locaux. Ces
  pilotes sont refusés si `NODE_ENV=production` ou `VERCEL=1`.

Chaque instance chaude réutilise un pool PostgreSQL borné
(`DATABASE_POOL_MAX=1` par défaut). Les migrations sont idempotentes,
sérialisées par advisory lock, et lançables au démarrage ou via `npm run migrate`.

## Configuration

Toutes les variables et leurs valeurs locales sont commentées dans
[`.env.example`](.env.example). Les principales :

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `ADMIN_PASSWORD` | — | **Requis.** ≥ 16 caractères. Seule identité humaine. |
| `DATABASE_URL` | — | **Requis.** `postgresql://…` (prod, chaîne poolée) ou `pglite://…` (dev). |
| `DATABASE_POOL_MAX` | `1` | Connexions par instance. À ne monter que derrière un pooler. |
| `RUN_MIGRATIONS_ON_BOOT` | `true` | Mettre à `false` et migrer au build pour éviter le cold start. |
| `STORAGE_DRIVER` | — | `s3`, `supabase` ou `filesystem` (dev seulement). |
| `S3_ENDPOINT` / `S3_BUCKET` / `S3_REGION` | — | Bucket **privé** dédié. |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | — | Identifiants limités à ce bucket. |
| `UPLOAD_MAX_BYTES` | `4000000` | Sous la limite de 4,5 Mo d'un corps de requête Vercel. |
| `SUBMISSIONS_PER_MINUTE` | `20` | Limite persistante par lien reviewer. |
| `SESSION_TTL_SECONDS` | `28800` | Durée de la session admin. |
| `WEBHOOK_TIMEOUT_MS` | `3000` | Budget de la notification sortante, attendue avant la réponse. |
| `LOG_LEVEL` | `warn` | Journalisation, secrets expurgés. |

## Déploiement sur Vercel

**1. PostgreSQL externe.** Une base **dédiée** (Neon, Supabase ou compatible),
avec sa chaîne **poolée** et TLS. Ne jamais réutiliser une base métier.

```text
DATABASE_URL=postgresql://...pooler.../reviewdesk?sslmode=require
DATABASE_POOL_MAX=1
```

**2. Stockage objet privé.** Un bucket dédié Cloudflare R2, AWS S3, Scaleway,
Backblaze B2 ou compatible. Pour R2 : bucket privé, ni `r2.dev` ni domaine
public, identifiants limités à ce bucket.

```text
STORAGE_DRIVER=s3
S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
S3_BUCKET=reviewdesk-uploads
S3_REGION=auto
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_FORCE_PATH_STYLE=true
```

**3. Variables et build.**

```text
ADMIN_PASSWORD=<phrase aléatoire longue>
NODE_ENV=production
RUN_MIGRATIONS_ON_BOOT=true
```

Importer le dépôt dans Vercel : `vercel.json` construit les assets statiques et
route `/api/*` et `/health` vers la fonction. Après déploiement : vérifier
`/health`, se connecter à l'administration, créer un projet et son origine,
tester un upload puis sa lecture admin.

Pour éviter les migrations au cold start : `RUN_MIGRATIONS_ON_BOOT=false` et
`npm run migrate` depuis un environnement disposant de `DATABASE_URL` avant le
déploiement.

Les coûts de base, de stockage, d'opérations et de sortie réseau sont ceux des
fournisseurs choisis ; ce dépôt ne provisionne aucune ressource.

## Sécurité et confidentialité

**Ce que le widget ne collecte jamais** : champs de formulaire, cookies,
`localStorage`, corps de requête réseau, texte du DOM, console arbitraire, IP
applicative, session replay.

**Diagnostics.** Désactivés par défaut. Après consentement, le reviewer voit
exactement les champs envoyés : viewport, DPR borné, orientation, locale,
fuseau, navigateur/OS grossiers, URL sans query ni hash ni credentials, et
erreurs structurées allowlistées.

**Libellé d'élément.** Le nom lisible affiché pendant le pointage (« Bouton
« … » ») est construit et affiché **localement**. Seuls le sélecteur et le point
relatif partent au serveur : aucun texte de la page ne se retrouve dans le
ticket au-delà de ce que le reviewer écrit lui-même.

**Authentification.** Les API reviewer exigent un bearer lié au projet **et**
une origine exacte ; CORS ne sert jamais d'authentification. Le secret du lien
n'est stocké que sous forme de SHA-256. Les mutations admin exigent un cookie
`HttpOnly`/`SameSite=Strict` et un jeton CSRF.

**Uploads.** Limités à 4 000 000 octets par défaut, vérifiés par signature de
fichier, SVG refusé, objets non publics. Les réponses privées portent
`no-store` et la journalisation expurge les secrets.

**Captures.** Exclusivement manuelles. ReviewDesk ne prétend pas masquer
automatiquement des données sensibles visibles dans une capture : le reviewer
contrôle le fichier avant l'envoi.

## Référence API

Reviewer — bearer du lien + origine autorisée :

| Méthode | Route | Effet |
| --- | --- | --- |
| `POST` | `/api/feedback?projectId=…` | Dépose un retour ancré. |
| `GET` | `/api/feedback?projectId=…` | Liste les retours de ce lien et leurs réponses. |
| `POST` | `/api/uploads?projectId=…` | Envoie une capture (`multipart/form-data`). |

Administration — cookie de session + jeton CSRF sur les mutations :

| Méthode | Route | Effet |
| --- | --- | --- |
| `POST` | `/api/auth/login` · `/api/auth/logout` | Session admin. |
| `GET` | `/api/auth/session` | État de session et jeton CSRF. |
| `GET` `POST` | `/api/projects` | Liste et création de projets. |
| `PATCH` | `/api/projects/:id` | Nom, client, origines, webhook. |
| `GET` `POST` | `/api/projects/:id/review-links` | Liens reviewer (le secret n'est montré qu'une fois). |
| `POST` | `/api/projects/:projectId/review-links/:linkId/revoke` | Révocation. |
| `GET` | `/api/tickets` | Triage filtré, pagination par curseur. |
| `PATCH` | `/api/tickets/:id` | Statut, note interne, réponse au reviewer. |
| `GET` | `/api/uploads/:id` | Téléchargement privé d'une capture. |
| `GET` | `/health` | Sonde de disponibilité, sans métadonnée d'infrastructure. |

## Développer et vérifier

```bash
npm run dev          # serveur en rechargement à chaud
npm run build        # widget + admin + serveur
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
npm test             # tests unitaires et d'intégration
npm run test:docker  # idem, contre PostgreSQL + MinIO jetables
npm run test:e2e     # E2E Playwright, admin :4310 et preview :4311
npm run check        # tout l'enchaînement ci-dessus + npm audit --omit=dev
```

`npm run check` est la porte d'entrée : lint, typecheck, **67 tests Node**
(unitaires et intégration adversariale contre PostgreSQL + MinIO Docker
jetables — 3 d'entre eux sont sautés sans Docker), build, **3 E2E Playwright**
sur une origine réellement distincte, puis `npm audit --omit=dev`.

Le widget est un artefact de build : modifier `src/widget/index.ts`, jamais
`public/widget.js`, puis `npm run build:widget`.

## Versions

Les évolutions sont consignées dans [CHANGELOG.md](CHANGELOG.md), au format
Keep a Changelog. Version courante : **1.1.0**.

Le numéro se décide à la taille du changement : **majeur** pour une grosse
fonctionnalité ou une refonte, **mineur** pour une petite amélioration,
**correctif** pour un bug. Les ruptures sont signalées explicitement dans le
changelog.

## Limites connues

- une seule identité admin par secret d'environnement ; ni SSO ni comptes multiples ;
- aucune capture automatique, aucune annotation flèche/rectangle : upload manuel seulement ;
- rate limiting persistant par lien, mais pas de protection réseau/WAF distribuée ;
- le rejeu d'épingle échoue proprement (épingle rouge) si l'élément d'origine a
  disparu de la page ;
- aucune ressource PostgreSQL, bucket, projet Vercel ou domaine n'est provisionné ici ;
- une mise en ligne publique suppose au préalable la base dédiée, le bucket
  privé, les secrets, et une protection d'accès forte sur la préproduction.

## Contribuer

Les contributions sont bienvenues.

1. Ouvrir une issue décrivant le problème ou l'intention avant un gros changement.
2. Travailler sur une branche (`feat/…`, `fix/…`, `docs/…`).
3. `npm run check` doit passer en entier.
4. Ajouter une entrée sous `## [Non publié]` dans [CHANGELOG.md](CHANGELOG.md).
5. Les commentaires du code expliquent **pourquoi**, pas quoi : c'est la
   convention du dépôt, merci de la suivre.

Toute modification touchant la confidentialité (diagnostics, contenu envoyé,
journalisation) doit être accompagnée du test qui la verrouille.

## Licence

Ce dépôt n'est pas encore placé sous une licence open source : tous droits
réservés pour l'instant. Une licence permissive est envisagée ; d'ici là,
demandez avant toute réutilisation.
