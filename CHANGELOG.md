# Changelog

Toutes les évolutions notables de ReviewDesk sont consignées ici.

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le
versionnage suit cette règle :

| Chiffre | Quand | Exemple |
| --- | --- | --- |
| **majeur** `X`.0.0 | grosse fonctionnalité, refonte | refonte de l'UI reviewer |
| **mineur** 1.`X`.0 | petite amélioration | un libellé plus clair, une option |
| **correctif** 1.0.`X` | correction de bug | une épingle mal repositionnée |

Une rupture est signalée sous **Rupture** dans l'entrée concernée.

## [Non publié]

### Ajouté

- **Assistant d'onboarding projet & installation widget en 3 étapes** :
  - **Étape 1 (Plateforme)** : sélection visuelle de la méthode d'intégration (HTML / Script direct, Next.js / React, CMS / No-Code, ou Lien direct sans code), génération sécurisée de jeton d'accès et historique des liens.
  - **Étape 2 (Intégration & Personnalisation)** : options interactives (positionnement du lanceur, thème visuel, libellé de bouton) avec génération dynamique de snippet de code et bouton de copie.
  - **Étape 3 (Vérification)** : accès direct pour tester sur l'origine de préproduction ou la démo locale, et détection en direct de la première connexion du widget.
- **Cartes de plateformes premium dans l'assistant widget** : intégration des véritables logos de marque (HTML5, React / Next.js, Webflow, Lien direct) en SVG vectoriels, badges de qualification (« Recommandé », « Universel », « No-Code », « Zéro code ») et mise en page responsive soignée.
- **Suppression complète de projet (`DELETE /api/projects/:id`)** :
  - Suppression en cascade sécurisée de tous les retours, commentaires, jetons agents et liens reviewers rattachés.
  - Nettoyage des captures et fichiers stockés dans le bucket d'objets (S3 / Supabase).
  - Zone de suppression avec confirmation explicite intégrée dans le dialogue de réglages du projet.
- **Aides à la création de projet** : puces d'ajout rapide d'origines autorisées (`localhost:3000`, `localhost:5173`, origine actuelle) et aides contextuelles.
- **Notification incitative après création de projet** : affichage automatique d'une carte flottante d'onboarding demandant à l'utilisateur s'il souhaite configurer l'intégration immédiatement, avec bouton d'accès direct au formulaire et option pour différer (« Plus tard »).
- **Écran d'accueil guidé pour projet vierge** : carte d'onboarding dans la liste des retours invitant à installer le widget ou tester le flux.
- Détection immédiate de l'installation par ping automatique de l'état des réponses au montage du widget.

## [7.0.0] — 2026-09-12

Le produit a une identité, et les outils tiers ont leur vrai visage.

### Ajouté

- **Une marque.** Une bulle de dialogue dont le seul contenu visible est le point
  dont on parle — le retour, et l'endroit exact auquel il appartient. Un seul
  tracé, lisible de 16 px à une tuile d'application, partagé par le favicon
  (`public/favicon.svg`), l'administration et le lanceur du widget.
- **Un logotype** : `Review` en graisse normale, `Desk` en demi-gras, dans la
  barre de navigation comme sur l'écran de connexion.
- **Un favicon** — l'onglet ne montre plus l'icône générique du navigateur.
- **Écran de connexion retravaillé** : champ de points en fond, clairière
  radiale sous la carte, marque, logotype et la promesse du produit en une ligne.
- **Les vrais logos** des outils dans le parcours de connexion : Claude, OpenAI,
  Cursor, VS Code, tous en SVG inline (la CSP interdit toute image distante), et
  une prise de courant pour « Autre outil ». Claude et VS Code gardent leurs
  couleurs ; Cursor et OpenAI, monochromes par nature, suivent le thème.
- Une section **Identité** dans le README : ce que veut dire la marque, la règle
  typographique, la règle de couleur et les deux exceptions assumées.

### Modifié

- **Rupture (visuel)** : l'ancienne épingle générique disparaît de la marque, de
  l'administration et du widget.

## [6.0.0] — 2026-09-12

Connecter un agent n'est plus une affaire de fichier de configuration.

### Ajouté

- **Parcours de connexion en trois étapes** (Administration → Accès agents) :
  choix de l'outil (Claude Code, Codex CLI, Cursor, Claude Desktop, VS Code, ou
  l'API HTTP pour tout le reste), puis portée et droits reformulés en toutes
  lettres avant qu'un secret n'existe, puis la connexion.
- **Configuration écrite pour l'outil choisi** : commande `claude mcp add`, table
  `[mcp_servers.reviewdesk]` d'un `config.toml`, `mcpServers` d'un `.cursor/mcp.json`
  ou d'un `claude_desktop_config.json`, `servers` d'un `.vscode/mcp.json`, ou deux
  `curl` commentés. Chaque bloc a son bouton Copier, qui confirme sur lui-même.
- **Le chemin local du serveur MCP se saisit une fois** dans le parcours : tous
  les blocs se réécrivent en direct, et la valeur est mémorisée pour la fois
  suivante.
- **Détection de connexion en direct** : la dernière étape interroge le serveur
  et bascule sur « Agent connecté » à la toute première requête de l'agent. Un
  jeton qui existe n'est pas un jeton qui marche, et la fenêtre ne prétend pas le
  contraire — au bout de deux minutes sans requête, elle le dit.
- **Prompt de démarrage** prêt à coller dans l'agent une fois connecté.
- **Liste de démarrage** sur la vue d'ensemble d'une instance neuve : projet →
  widget → premier retour → agent connecté, avec la progression et un seul bouton
  d'action, celui de la prochaine étape. Elle est déduite des données et jamais
  stockée : révoquer le dernier jeton remet l'étape à faire.
- Route `GET /api/onboarding`.

### Modifié

- **Rupture (interface)** : la fenêtre « Accès agents » n'est plus un formulaire
  suivi d'un pavé de texte ; les jetons existants restent gérés et révocables à
  la première étape du parcours.
- Une instance sans aucun retour affiche la liste de démarrage seule, au lieu
  d'un mur de zéros.

## [5.0.0] — 2026-09-12

Passe de finition sur l'administration : elle était correcte et plate, elle a
maintenant de la matière.

### Ajouté

- **Typographie Geist**, auto-hébergée (SIL OFL 1.1, 52 Ko pour les deux
  graisses variables, `font-display: swap` et préchargement). La CSP de
  l'administration n'autorise que `font-src 'self'` : aucun CDN n'est joignable,
  et c'est très bien ainsi. Chiffres tabulaires partout, interlettrage resserré
  à mesure que le corps grandit.
- **Matière** : élévation sur trois niveaux, filet de lumière sur l'arête haute
  des surfaces, bouton principal en dégradé plutôt qu'en aplat, barre de
  navigation translucide à flou d'arrière-plan (avec repli opaque si le
  navigateur ne floute pas).
- **Mouvement**, sous les règles de la maison : entrées en `ease-out` fort
  (`cubic-bezier(.23,1,.32,1)`), jamais depuis `scale(0)`, jamais plus de 300 ms.
  Rangées de la liste et cartes de la vue d'ensemble en cascade (28 ms d'écart),
  barres du graphe qui poussent depuis l'axe, dialogues qui apparaissent en
  `scale(.96)`, retour d'appui `scale(.97)` sur tout ce qui se presse. Le survol
  est derrière `@media (hover: hover)`, et `prefers-reduced-motion` garde les
  fondus en supprimant tout déplacement.
- **Squelettes de chargement** sur la vue d'ensemble : la forme de la réponse
  arrive avant la réponse.
- Barres d'échelle et **légende** sur le graphe d'activité, ligne de synthèse
  sous la répartition (« 10 retours encore ouverts, soit 83 % de tout ce qui a
  été reçu »).
- Ascenseurs discrets, et le bouton « Liste » du détail ne s'affiche plus que sur
  mobile, là où il veut dire quelque chose.

### Modifié

- **Rupture (visuel)** : la rampe de gris est refaite (neutres légèrement plus
  froids), les rayons, les ombres et les graisses avec elle. Le monochrome reste
  la règle — c'est la matière qui a changé, pas la couleur.
- Le retour sélectionné dans la liste est une carte surélevée, plus un simple
  fond teinté.

## [4.0.0] — 2026-09-12

### Ajouté

- **Vue d'ensemble.** Un second onglet dans la barre de navigation, qui répond à
  trois questions : ce qui attend, comment la file bouge, où est le travail.
  Cinq indicateurs (à traiter et âge du plus ancien, ouverts dont ceux de plus de
  7 jours, reçus et traités sur la période avec comparaison à la période
  précédente, délai moyen de traitement), un graphe d'activité jour par jour
  reçus contre traités, la répartition par statut, le classement des projets, les
  pages les plus signalées et le journal des derniers mouvements — agents
  compris.
- Période réglable (7, 30 ou 90 jours) et périmètre hérité du projet sélectionné :
  les chiffres décrivent toujours ce que le reste de l'écran affiche.
- Route `GET /api/stats` (`days`, `projectId`), qui calcule tout en une requête
  côté serveur plutôt que de faire agréger le navigateur.
- Le graphe est un SVG écrit à la main : aucune bibliothèque de charts, aucun
  script tiers — la CSP de l'administration le refuserait de toute façon.

### Modifié

- La barre de configuration est désormais propre à chaque vue : filtres pour les
  retours, sélecteur de période pour la vue d'ensemble.
- Cliquer une ligne du classement par projet sélectionne ce projet partout.

## [3.0.0] — 2026-09-12

Refonte de l'administration : monochrome, et rangée.

### Modifié

- **Rupture (visuel)** : la palette n'a plus de teinte. Fond, texte, bordures et
  boutons sont une seule rampe de gris ; le bouton principal est de l'encre noire
  sur blanc, et s'inverse en thème sombre. Les seules couleurs restantes sont le
  rouge des erreurs et des actions destructrices.
- **Barre de navigation** en haut, sur toute la largeur : marque, projet affiché
  et son client, actions (liens reviewer, accès agents, réglages), thème et
  déconnexion. Elle remplace l'en-tête qui vivait dans la colonne de droite.
- **Barre de configuration** distincte, sous la navigation : les filtres (client,
  page, format, statut), l'export et le compteur, sur fond plat, sans encadré.
- **Rail projets** allégé : plus de pastille pleine ni d'ombre portée. La
  sélection est un filet d'encre sur le bord gauche, le compte de retours un
  simple nombre.
- **Statuts sans couleur** : un disque qui se vide à mesure que le travail
  avance — plein pour « à traiter », moitié pour « en cours », quart pour
  « à valider », vide et grisé pour « traité ». Le libellé reste toujours à côté
  du glyphe : la forme ne porte jamais le sens toute seule.
- Lignes de la liste et sélection reposées sur le contraste et l'espacement
  plutôt que sur des fonds colorés ; ombres réduites à presque rien.

Le widget côté client n'est pas touché : il garde son apparence « liquid glass »
et l'épingle orange.

## [2.0.0] — 2026-09-12

Les retours ne se lisent plus seulement : un agent IA s'y branche, les traite et
rend compte.

### Ajouté

- **Serveur MCP.** `dist/mcp.js` expose ReviewDesk à tout client MCP (Claude Code,
  Claude Desktop…) via six outils : `list_projects`, `list_tickets`, `get_ticket`,
  `get_screenshot`, `comment_ticket`, `update_ticket`. L'agent lit le retour avec
  son élément visé, sa page, son écran et ses diagnostics, voit la capture, puis
  déplace le statut en expliquant ce qu'il a changé — en un seul appel.
- **API agent** (`/api/agent/*`), authentifiée par `Authorization: Bearer rda_…` :
  contexte, liste filtrée et paginée, détail avec journal, commentaires, statut,
  capture. Pas de cookie, donc pas de CSRF ; aucune origine autorisée en CORS.
- **Jetons agents**, gérés depuis l'administration (« Accès agents ») : libellé,
  portée (un projet ou tous), droits (lecture seule ou lecture/écriture),
  révocation immédiate, date de dernière utilisation. Le secret n'est affiché
  qu'une fois, avec la configuration MCP déjà remplie, et n'est stocké qu'en
  SHA-256. Limite de 120 requêtes par minute et par jeton (`AGENT_REQUESTS_PER_MINUTE`).
- **Journal par retour** : chaque commentaire, d'un humain ou d'un agent, est
  horodaté, attribué, et porte le changement de statut qui l'accompagne. Il
  s'affiche dans le détail du retour, les entrées d'agent distinguées de celles
  de l'équipe, et s'écrit aussi depuis l'administration.
- Un commentaire en portée `reviewer` devient la réponse que le client lit dans
  son widget ; un commentaire interne ne peut pas le devenir après coup.

### Modifié

- **Rupture (base de données)** : migration `006_agent_access` (tables
  `agent_tokens` et `ticket_comments`). Elle s'applique au démarrage comme les
  précédentes, mais une instance antérieure ne lira pas ce schéma.
- `/api/tickets` et l'API agent partagent désormais le même moteur de filtres et
  de pagination, et renvoient `commentCount` par retour.

## [1.2.0] — 2026-09-12

### Ajouté

- **Export « un seul prompt ».** Un bouton « Exporter pour Claude Code », dans la
  barre de filtres, rassemble **tous les retours au statut `À traiter`** du
  périmètre affiché (projet, client, page et format filtrés sont respectés ; le
  filtre de statut est ignoré) et les rend en un bloc Markdown prêt à coller dans
  un agent de code. Chaque retour y arrive avec son projet, sa page, le sélecteur
  CSS de l'élément visé et le point cliqué en pourcentage, la taille d'écran, les
  diagnostics consentis, le lien de rejeu de l'épingle, la capture s'il y en a une
  et la note interne s'il y en a une. Plus besoin de rouvrir douze retours pour en
  recopier le contexte à la main.
- L'export suit la pagination jusqu'au bout (et non la seule page chargée),
  classe les retours du plus ancien au plus récent, s'arrête à 400 retours en le
  disant, et copie dans le presse-papier en un clic. Il ne contient aucun secret :
  ni mot de passe admin, ni token reviewer.

## [1.1.0] — 2026-09-10

### Ajouté

- **Le thème vient de la page, plus du système d'exploitation.** Le widget lit
  la couleur de fond réelle du site hôte et s'habille en clair ou en sombre en
  conséquence. Un reviewer sous macOS en mode sombre ne reçoit plus une dalle
  grise posée sur une page blanche. La préférence système ne sert que de dernier
  recours, pour une page qui ne déclare aucun fond.
- Option `data-theme` / `theme` (`auto` par défaut, `light`, `dark`) pour forcer
  le thème quand la détection ne convient pas.

### Corrigé

- **Contraste** : les textes secondaires devenaient illisibles, le fond flouté
  de la page éclaircissant la surface par en dessous. Les teintes sont plus
  opaques (0,86–0,88 au lieu de 0,66–0,80), les gris de texte remontés, le
  placeholder et la croix de fermeture rendus visibles. Le flou reste une
  atmosphère : il n'a plus le droit de servir de fond.
- La bordure de la zone d'erreur ne disparaissait plus dans le fond en thème sombre.

## [1.0.0] — 2026-09-10

Refonte visuelle complète du widget : le matériau remplace les aplats.

### Ajouté

- **Design « liquid glass »** : surfaces translucides à backdrop-filter
  (blur + saturation), arête spéculaire sur les bords hauts, ombres portées
  multi-couches. Le panneau, le lanceur, la barre de pointage et les cartes sont
  des matériaux superposés, plus des rectangles peints.
- Indicateur glissant sur le sélecteur d'onglets : la pastille se déplace au
  lieu de se repeindre, l'œil suit la sélection.
- Reliefs d'état : la pastille d'étape s'allume en dégradé quand l'étape est
  faite, le bouton principal a son propre reflet, l'épingle a une lentille.
- Animations ressort (`cubic-bezier(.32,.72,0,1)`) à l'ouverture, au survol et
  à l'appui ; le panneau s'ouvre depuis le coin du lanceur.
- Repli automatique en surfaces opaques quand le navigateur ne sait pas flouter
  (`@supports`) ou quand le visiteur demande moins de transparence
  (`prefers-reduced-transparency`) — le verre ne doit jamais coûter la lisibilité.

### Modifié

- **Rupture (visuel)** : palette, rayons, ombres et épaisseurs revus de bout en
  bout. Un site hôte qui surchargeait des styles du widget n'a rien à changer —
  le Shadow DOM isole toujours tout — mais l'apparence n'est plus la même.
- La surbrillance de pointage n'applique plus de voile blanc sur l'élément visé :
  celui-ci garde ses couleurs, c'est le reste de la page qui s'assombrit.
- Accent passé à un dégradé violet-indigo ; l'épingle reste orange pour rester
  distincte de l'accent.

## [0.3.0] — 2026-09-10

Refonte de l'expérience reviewer : c'est la partie que voit le client final, et
elle devait être compréhensible sans un mot d'explication.

### Ajouté

- **Intégration en une ligne** : `<script src=".../widget.js" data-project data-token>`
  s'initialise tout seul. L'appel manuel à `ReviewDesk.init()` reste supporté.
- Options d'intégration `data-label`, `data-position` (`bottom-right` /
  `bottom-left`) et `data-accent`, pour que le widget parle la langue et porte
  les couleurs du site hôte.
- **Surbrillance en direct** pendant le pointage : l'élément survolé est encadré
  et nommé (« Bouton « Découvrir la collection » ») avant tout clic.
- Collage d'une capture (`Ctrl/⌘ + V`) directement dans le panneau, avec
  vignette de prévisualisation et retrait en un clic.
- Compteur de réponses non lues sur le lanceur et sur l'onglet « Mes retours ».
- Raccourcis : `Échap` ferme le panneau, `⌘/Ctrl + ↵` envoie.
- Écran de confirmation après envoi, avec accès direct à « Mes retours ».

### Modifié

- **Rupture (libellés)** : le bouton flottant s'appelle désormais
  « Donner mon avis » (au lieu de « Commenter ») et l'envoi « Envoyer mon
  retour ». Les onglets deviennent « Nouveau retour » / « Mes retours ». Les
  tests E2E qui ciblaient les anciens libellés ont été mis à jour.
- Le panneau est structuré en **deux étapes numérotées** (montrer l'endroit,
  puis décrire), avec un état visuel « fait » sur chaque étape.
- Le sélecteur CSS (`div.hero>button:nth-of-type(2)`) n'est plus affiché au
  reviewer : il voit un libellé humain. Le sélecteur continue de partir vers
  l'admin, inchangé — le libellé, lui, reste **local et n'est jamais envoyé**.
- Le consentement aux diagnostics est reformulé en clair, et l'aperçu exact des
  données part derrière un « Voir ce qui sera envoyé ».
- Les erreurs d'envoi s'affichent dans une zone dédiée (`role="alert"`) au lieu
  de remplacer le libellé de la cible.
- La capture passe par un bouton stylé, avec validation du format et de la
  taille (4 Mo) **avant** la requête réseau.
- Le snippet proposé par l'admin à la création d'un lien reviewer est le nouveau
  snippet une ligne.

## [0.2.0] — 2026-09-09

### Ajouté

- **Deux réponses par retour** : une note interne jamais exposée, et une réponse
  que le reviewer relit dans le widget.
- **Retour au point d'ancrage** : un lien admin rouvre la préproduction avec
  l'épingle reposée sur l'élément concerné, via le fragment d'URL.
- **Notification sortante** par projet : POST JSON vers une URL HTTPS publique à
  chaque nouveau retour.
- Onglet « Mes retours » dans le widget : consulter les réponses n'exige ni de
  pointer un élément ni d'envoyer quoi que ce soit ; le mode sélection s'annule
  (`Échap` ou *Annuler*).
- Stockage objet managé Supabase en plus des cibles S3-compatibles.

### Modifié

- Refonte de la coque d'administration et du widget.
- L'admin est utilisable de 390 px à un 21:9 de 3440 px : au-delà de 1750 px le
  détail se scinde en colonne d'action et rail de contexte.

### Corrigé

- Régressions d'authentification et de transport.
- Téléchargement des objets privés Supabase.

### Sécurité

- Les métadonnées de stockage ne fuitent plus par le `/health`.

## [0.1.0] — 2026-09-08

Première version autonome, privée, multi-projets.

### Ajouté

- Widget JavaScript en Shadow DOM, indépendant du framework, desktop et tactile,
  avec épingle ancrée à un élément.
- Projets avec libellé client et liste exacte des origines autorisées.
- Liens reviewer révocables, secret stocké uniquement en SHA-256.
- Diagnostics strictement opt-in et prévisualisés ; capture manuelle uniquement.
- Liste admin avec filtres, pagination par curseur et statuts persistants.
- Exécution sur PostgreSQL externe et stockage objet S3-compatible privé.
- Suite de vérification : lint, typecheck, tests Node adversariaux contre
  PostgreSQL + MinIO jetables, build, E2E Playwright cross-origine.

[Non publié]: https://github.com/hugoinformatique/reviewdesk/compare/v7.0.0...HEAD
[7.0.0]: https://github.com/hugoinformatique/reviewdesk/releases/tag/v7.0.0
[6.0.0]: https://github.com/hugoinformatique/reviewdesk/releases/tag/v6.0.0
[5.0.0]: https://github.com/hugoinformatique/reviewdesk/releases/tag/v5.0.0
[4.0.0]: https://github.com/hugoinformatique/reviewdesk/releases/tag/v4.0.0
[3.0.0]: https://github.com/hugoinformatique/reviewdesk/releases/tag/v3.0.0
[2.0.0]: https://github.com/hugoinformatique/reviewdesk/releases/tag/v2.0.0
[1.2.0]: https://github.com/hugoinformatique/reviewdesk/releases/tag/v1.2.0
[1.1.0]: https://github.com/hugoinformatique/reviewdesk/releases/tag/v1.1.0
[1.0.0]: https://github.com/hugoinformatique/reviewdesk/releases/tag/v1.0.0
[0.3.0]: https://github.com/hugoinformatique/reviewdesk/releases/tag/v0.3.0
[0.2.0]: https://github.com/hugoinformatique/reviewdesk/releases/tag/v0.2.0
[0.1.0]: https://github.com/hugoinformatique/reviewdesk/releases/tag/v0.1.0
