# Changelog

Toutes les évolutions notables de ReviewDesk sont consignées ici.

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le
versionnage suit [SemVer](https://semver.org/lang/fr/). Tant que la version
majeure est `0`, une version mineure peut contenir une rupture : elle est alors
signalée sous **Rupture**.

## [Non publié]

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

[Non publié]: https://github.com/hugoinformatique/reviewdesk/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/hugoinformatique/reviewdesk/releases/tag/v0.3.0
[0.2.0]: https://github.com/hugoinformatique/reviewdesk/releases/tag/v0.2.0
[0.1.0]: https://github.com/hugoinformatique/reviewdesk/releases/tag/v0.1.0
