# Construire et vérifier le kit ZIP local 8.0.0

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
