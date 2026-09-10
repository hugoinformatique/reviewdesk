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

[Non publié]: https://github.com/hugoinformatique/reviewdesk/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/hugoinformatique/reviewdesk/releases/tag/v1.1.0
[1.0.0]: https://github.com/hugoinformatique/reviewdesk/releases/tag/v1.0.0
[0.3.0]: https://github.com/hugoinformatique/reviewdesk/releases/tag/v0.3.0
[0.2.0]: https://github.com/hugoinformatique/reviewdesk/releases/tag/v0.2.0
[0.1.0]: https://github.com/hugoinformatique/reviewdesk/releases/tag/v0.1.0
