# ReviewDesk 8.0.0 — guide du kit local

> **Obsolète.** Pour un auto-hébergement, utilisez la distribution Docker
> Compose ([GUIDE-DOCKER-FR.md](GUIDE-DOCKER-FR.md)).

Ce ZIP contient l'application compilée, tous ses assets publics (y compris
polices, démo et licence des polices), un manifeste npm autonome et son
verrouillage. PGlite fournit PostgreSQL embarqué ; les captures sont stockées
sur disque. Aucun code source TypeScript, secret, donnée utilisateur,
node_modules, dépôt Git ou journal n'est distribué.

**Usage uniquement sur votre ordinateur.** Ce kit n'est ni un hébergement de
production, ni un serveur accessible aux clients, ni une installation cloud.
Le lanceur écoute exclusivement `127.0.0.1`, en HTTP, sans TLS. N'ajoutez pas de
proxy public, tunnel ou redirection de port. Un lien en `127.0.0.1` envoyé à un
client désigne son propre ordinateur : il ne lui donnera pas accès au vôtre.
Les restrictions du navigateur peuvent aussi empêcher un site HTTPS distant
de contacter le serveur HTTP local. Pour tester le widget, utilisez une page
locale et déclarez son origine exacte dans le projet.

## Installer sous Windows, macOS ou Linux

1. Installez **Node.js 22.x avec npm**. Vérifiez `node --version` et
   `npm --version` dans PowerShell ou un terminal. Aucune base externe, Docker,
   compilation, commande Unix ou outil ZIP supplémentaire n'est nécessaire.
2. Vérifiez si possible le SHA-256 fourni à côté de l'archive :
   Windows : `Get-FileHash .\reviewdesk-v8.0.0-local.zip -Algorithm SHA256` ;
   macOS : `shasum -a 256 reviewdesk-v8.0.0-local.zip` ;
   Linux : `sha256sum -c reviewdesk-v8.0.0-local.zip.sha256`.
   Comparez avec le fichier `.sha256` provenant d'une source de confiance.
3. Extrayez **tout** le ZIP dans un dossier personnel accessible en écriture.
   Évitez les dossiers partagés et la synchronisation cloud de la base active.
   Les espaces dans le chemin sont acceptés. Ouvrez un terminal dans le dossier
   `reviewdesk-v8.0.0-local` extrait (ou `cd "chemin avec espaces"`).
4. Exécutez `node install.mjs`. Choisissez et confirmez votre mot de passe
   administrateur dans la saisie masquée. Une connexion Internet au registre
   npm est nécessaire pour télécharger les dépendances verrouillées.
5. Exécutez `node start.mjs`, puis ouvrez **http://127.0.0.1:4300**.
   L'identifiant est **admin** ; utilisez le mot de passe choisi. Laissez le
   terminal ouvert et arrêtez avec **Ctrl+C**, afin de fermer proprement la base.
   Les lancements suivants utilisent simplement `node start.mjs`.

Le lancement fonctionne aussi depuis un autre dossier :
`node "chemin avec espaces/reviewdesk-v8.0.0-local/start.mjs"`.
Pour choisir un autre port : `node start.mjs --port 4301`.
`http://127.0.0.1:4301/health` doit répondre avec `ok: true`.
La sonde appelle la base et indique `postgresql` (PGlite) et le stockage disque.

## Mot de passe et configuration

Le mot de passe doit avoir **16 à 400 caractères**, au moins **8 caractères
distincts**, sans caractères de contrôle ni espaces en début ou fin. Les mots
`password`, `admin`, `reviewdesk`, `changeme`, `letmein`, `secret`, `12345678` et
`qwerty` sont refusés, quelle que soit leur casse. Utilisez une phrase originale
ou un gestionnaire de mots de passe. Aucun mot de passe par défaut n'existe.
Une saisie invalide ou une confirmation différente annule la configuration.

Alternative : `node install.mjs --generate-password` génère un mot de passe
aléatoire unique. Il n'est jamais affiché dans les journaux : consultez
`.reviewdesk/config.json` dans un éditeur local et sauvegardez-le dans votre
gestionnaire. Le dossier commençant par un point peut être masqué par votre
explorateur. Pour l'automatisation, `node install.mjs --password-stdin` lit une
seule ligne sur l'entrée standard jusqu'à EOF, avec ou sans fin de ligne.
Alimentez-la via votre gestionnaire de secrets ; ne mettez pas le mot de passe
dans les arguments de commande ou dans l'historique du terminal.
Sans terminal interactif, ces options explicites sont obligatoires au premier
lancement ; un mot de passe vide ou faible ne démarre jamais le serveur.

Le fichier `.reviewdesk/config.json` est **privé et contient le mot de passe en
clair**, nécessaire au serveur existant. Il n'est pas servi en HTTP. Sous
macOS/Linux, le dossier est créé en mode `0700` et le fichier en `0600`. Sous
Windows, protégez le dossier avec les permissions de votre compte Windows
(les modes Unix ne remplacent pas les ACL Windows). Ne partagez jamais ce
fichier ni le dossier `.reviewdesk`.

Les variables ambiantes `HOST`, `PORT`, `ADMIN_PASSWORD`, `DATABASE_URL`,
`POSTGRES_URL`, `STORAGE_DRIVER`, `UPLOAD_DIR` et les paramètres cloud ne
configurent pas ce lanceur : il impose les pilotes locaux et `127.0.0.1`.
Il ne lit aucun fichier `.env`. Si `NODE_ENV=production` ou `VERCEL=1` est
défini, le lanceur refuse de démarrer : les pilotes locaux restent interdits
en production.
Utilisez exclusivement `start.mjs` pour lancer le kit ; `dist/server.js` et
`dist/mcp.js` sont les autres exécutables compilés du produit, pas les lanceurs
d'installation locale.

Pour changer le port par défaut, arrêtez le serveur puis modifiez `port` dans
le JSON. Pour changer le mot de passe oublié, arrêtez le serveur puis remplacez
`adminPassword` par une valeur forte, en conservant un JSON valide (`version: 1`).
Cela ne supprime pas les données et ne révoque pas les sessions déjà ouvertes :
déconnectez-les ou attendez leur expiration. Une configuration corrompue est
refusée et n'est jamais remplacée automatiquement.

## Données, redémarrage et réinstallation

Tout est relatif au dossier du kit, jamais au dossier courant du terminal :

- `.reviewdesk/config.json` : mot de passe et port ;
- `.reviewdesk/database/` : projets, retours, sessions et autres données PGlite ;
- `.reviewdesk/uploads/` : captures et métadonnées de type de fichier ;
- `.reviewdesk/operation.lock` : empêche deux serveurs ou une installation et
  un serveur de modifier simultanément la même installation.

Le serveur ferme la base sur Ctrl+C et SIGTERM. Pour une sauvegarde cohérente,
arrêtez-le, puis copiez **tout `.reviewdesk/`**, configuration et captures
incluses, vers un emplacement privé. Ne copiez pas une base active.

`node install.mjs` peut être relancé après arrêt : `npm ci` réinstalle les
seules dépendances et conserve intégralement la configuration et les données.
Une option de création de mot de passe n'écrase jamais une configuration
existante. En cas de téléchargement interrompu, corrigez la connexion puis
relancez la même commande ; le mot de passe déjà enregistré reste valable.
Pour réinstaller le même kit dans un dossier neuf, installez ses dépendances,
arrêtez tout serveur et restaurez votre sauvegarde `.reviewdesk/` à sa place.
Une mise à niveau vers une autre version exige une sauvegarde préalable et
les instructions de cette version ; aucune compatibilité de retour arrière
n'est garantie. Ne fusionnez pas deux bases.

Après arrêt brutal, un verrou peut rester. Vérifiez que **tout processus
ReviewDesk utilisant ce dossier est arrêté** (le fichier contient son PID),
puis supprimez uniquement `.reviewdesk/operation.lock` avant de relancer.
Le kit ne supprime jamais automatiquement un verrou potentiellement actif.
Ne lancez pas deux copies du serveur sur la même base.

## Dépannage

- « Node.js 22.x est requis » : installez la bonne version, rouvrez le terminal.
- « npm introuvable » : réinstallez Node.js avec npm et vérifiez le PATH.
- Échec npm : vérifiez Internet, le proxy npm et les droits d'écriture ;
  relancez `node install.mjs` sans supprimer `.reviewdesk/`.
- Dépendances ou configuration absentes : exécutez `node install.mjs`.
- Port déjà utilisé : arrêtez l'autre programme ou utilisez `--port 4301`.
- Connexion refusée : gardez le serveur ouvert, utilisez `127.0.0.1`, le bon
  port et HTTP (pas HTTPS). Le cookie de session local n'est pas `Secure`.
- Configuration invalide : corrigez le JSON privé, sans le copier dans des
  journaux, tickets de support ou conversations publiques.

## Droits

**Tous droits réservés.** ReviewDesk n'est pas placé sous une licence open
source. Ce kit ne change pas ce statut et n'accorde aucune licence permissive.
Demandez une autorisation avant toute réutilisation. Voir `NOTICE.txt`.
Les bibliothèques et polices tierces conservent leurs licences respectives,
disponibles dans `node_modules` après installation et dans
`public/fonts/LICENSE-geist.txt`.
