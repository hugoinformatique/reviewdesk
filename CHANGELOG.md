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

## [9.0.0] — 2026-10-09

Refonte de l'interface : administration, widget client et intégration.

### Ajouté

- Refonte de l'interface, administration et widget (inspirations 21st.dev :
  « Dashboard Sidebar » et « Popover Form », réécrites sans dépendance).
- Palette de commandes `⌘K` / `Ctrl+K` (`src/admin/palette.ts`) : vues,
  projets, retours récents et actions, au clavier, recherche sans accents.
- Couleurs de statut sémantiques (bleu à traiter, ambre en cours, cyan à
  valider, vert traité), toutes à 4,5:1 sur leur fond, en clair et en sombre ;
  avatars de projet (initiale sur une teinte stable par projet).
- Fiche retour repensée comme une conversation : barre fixe (retour
  précédent/suivant, statut, « Ouvrir au point d'ancrage »), capture en grand,
  fil des échanges, puis un compositeur unique « Répondre au client » /
  « Message interne » (`⌘↵` / `Ctrl+↵` pour envoyer). Une colonne latérale
  montre ce que voit le client, la note interne, le contexte (page, écran,
  navigateur) et, repliés, le sélecteur et les diagnostics.
- Assistant d'intégration : aperçu en direct du bouton (position, thème,
  libellé) et coloration des extraits de code.
- Écran de connexion en deux colonnes avec une illustration dessinée en CSS.
- Page de démonstration refaite (« Atelier Démo ») : bandeau explicatif,
  mode d'emploi en trois étapes, CSS externe `public/demo.css`.
- Widget : panneau qui naît du bouton, catégories à icônes SVG, compositeur à
  séparateur pointillé, envoi avec indicateur de chargement, confirmation
  animée, pastilles de statut dans « Mes retours », bouton œil pour les
  pastilles de la page.
- Test E2E de régression : le texte d'un reviewer reste du texte dans les
  pastilles collaboratives.
- Tableau de bord : lien « Aller au contenu » en tête de la tabulation, qui
  saute la barre de navigation et le rail des projets.
- Liste des retours : squelette de chargement au premier affichage, et état
  d'erreur avec bouton « Réessayer » quand le chargement échoue.
- Tests de régression `tests/unit/admin-contrast.test.ts` : contraste AA des
  gris de texte en clair et en sombre, cohérence des deux blocs du thème
  sombre, aucune variable CSS lue sans être déclarée.

### Modifié

- **Rupture d'usage** : plus de bouton « Enregistrer » commun. Le statut est
  enregistré dès qu'il est choisi, la note interne (ex-« Réponse interne ») a
  son propre bouton, et la réponse au client passe par le compositeur, qui
  l'inscrit aussi dans le fil.
- Le disque de statut se remplit à mesure que le travail avance (vide « à
  traiter », plein « traité ») : c'était l'inverse.
- Widget : styles posés par feuille construite (`adoptedStyleSheets`), avec
  repli sur `<style>` ; surfaces opaques au lieu du verre translucide.
- Widget : la couleur `data-accent` passe par `src/brand-tokens.ts`, le texte
  posé dessus est calculé pour rester lisible sur une teinte claire.
- Capture « admin-desktop » du README prise sur la fenêtre, et non en pleine
  page, où la barre collante tombait au milieu de l'image.
- Le gris de texte le plus clair (`--text-3`) passe à `#6b6b74` en clair et
  `#8b8b94` en sombre, pour atteindre 4,5:1 sur toutes les surfaces (dates,
  compteurs, métadonnées, statut « Traité »).
- Les filtres, le rail des projets, la liste et le détail ont un nom
  accessible ; le compteur de retours est annoncé (`aria-live`).
- La ligne ouverte porte `aria-current` et garde le focus ; sur écran étroit,
  le focus passe sur le titre du détail à l'ouverture et revient sur la ligne
  à la fermeture (bouton « Liste » ou Échap).

### Corrigé

- Sur ordinateur, faire défiler la fiche d'un retour faisait aussi défiler
  la liste : c'était la page entière qui défilait. Chaque colonne défile
  désormais seule, sans aucun élément collant : la barre, le fil (avec le
  compositeur posé dessous) et la colonne latérale sont des zones séparées.
  Sur mobile, la page ne défile plus sous la fiche ouverte.
- Une capture prise sur téléphone était étirée sur toute la largeur ; elle
  s'affiche maintenant à la taille d'un téléphone.
- L'assistant de personnalisation revenait à chaque chargement tant qu'il
  n'était pas terminé ; « Configurer plus tard » est maintenant retenu par le
  navigateur (Personnalisation et `⌘K` le rouvrent).
- **Sécurité** : le texte d'un retour était injecté en `innerHTML` dans
  l'info-bulle des pastilles collaboratives du widget ; un reviewer muni d'un
  lien pouvait exécuter du script sur la page du client chez les autres
  reviewers. Le nœud est désormais construit en `textContent`.
- Servie par l'instance (`style-src 'self'`), la page démo perdait ses styles
  inline et le widget les siens ; elle s'affichait cassée.
- La pastille de l'élément pointé passait au-dessus du panneau du widget
  (`z-index` hors limite) et masquait « Localiser » sur mobile.
- Emojis restants (🔍 📱 💻 📷, chips du widget) remplacés par des icônes.
- Déclarations `font: … inherit` invalides dans le widget : la police de repli
  n'était pas celle prévue.
- Un échec de chargement de la liste au démarrage renvoyait à l'écran de
  connexion alors que la session était valide ; un échec lors d'un changement
  de filtre restait silencieux.
- Variables CSS utilisées mais jamais déclarées (`--surface-3`,
  `--border-strong`, `--r-md`, `--r-xl`, `--shadow-sm`) : les déclarations
  correspondantes étaient ignorées, dont le survol du bouton d'agrandissement
  de la capture.
- Le bouton d'agrandissement de la capture n'avait plus d'anneau de focus.
- Le bouton « Accès agents → » de l'accueil d'un projet vide (`.btn-secondary`)
  n'avait aucun style.
- Sur téléphone (≤ 640 px), la barre du haut était plus large que l'écran et
  élargissait toute la page : filtres format et statut, colonne de statut et
  titre du projet sortaient de l'écran. La barre passe sur deux rangées (menu,
  marque, vues ; puis titre et actions), et la grille de l'application ne peut
  plus déborder latéralement.
- Le tiroir des projets fermé laissait son ombre sur le bord gauche et restait
  atteignable à la tabulation ; il est désormais masqué tant qu'il est fermé.
- La mention « Capture » d'une ligne de retour utilisait l'emoji 📸, affiché
  en couleur dans une liste monochrome ou en case vide sans police emoji ; elle
  devient du texte.
- Tests E2E : l'assistant de personnalisation du premier lancement recouvre le
  tableau de bord d'une instance neuve et faisait échouer quatre scénarios ;
  ils le referment désormais (« Configurer plus tard »). Nouveau scénario de
  régression mobile (390 px) : pas de débordement horizontal, tiroir fermé hors
  d'atteinte.

## [8.0.0] — 2026-09-19

L'instance cesse de s'appeler ReviewDesk.

Le produit est conçu pour être auto-hébergé et revendu : une agence déploie sa
propre instance, et tout ce que ses clients voient doit porter son nom à elle.
Cette version installe le socle de la marque blanche et le parcours de
configuration qui va avec.

### Ajouté

- **Assistant de personnalisation en marque blanche** : à la toute première
  connexion, un parcours plein écran en cinq temps (accueil, identité, couleur,
  diffusion, récapitulatif) prend la main sur l'interface. Il est rouvrable
  ensuite depuis l'entrée « Personnalisation » de la barre de navigation, où il
  sert d'écran de réglages.
  - **Aperçu en direct** : un tableau de bord miniature et le lanceur du widget
    se recolorent à chaque frappe. Le reste de l'interface ne change qu'à
    l'enregistrement, pour ne pas basculer pendant qu'on hésite.
  - **Identité** : nom du produit (qui remplace « ReviewDesk » dans l'interface),
    baseline de l'écran de connexion, et logo déposé ou choisi au clic
    (SVG, PNG, JPEG, WebP — 96 Ko). Le logo remplace aussi le favicon.
  - **Couleur de marque** : huit teintes prêtes à l'emploi, sélecteur natif et
    saisie hexadécimale, avec le rapport de contraste WCAG affiché en clair.
  - **Diffusion** : adresse publique de l'instance et identité d'expéditeur.
- **Dérivation automatique des couleurs** (`src/brand-tokens.ts`) : à partir de
  la seule teinte choisie, l'état survolé, la surface teintée, l'anneau de focus
  et surtout le texte posé sur la couleur sont calculés. Le texte bascule entre
  noir et blanc selon le contraste réel — un accent pâle reçoit du texte noir,
  là où un simple seuil de luminosité se trompait. L'accent employé comme texte
  est assombri ou éclairci jusqu'à franchir 4,5:1 sur le fond en cours.
- **Persistance de la configuration** : nouvelle table `instance_settings`
  (migration `007_instance_settings`), et les routes `GET /api/branding`
  (publique, pour habiller l'écran de connexion avant toute authentification),
  `GET /api/branding/settings` et `PUT /api/branding`.
- Tests : dérivation des couleurs et réparation d'une configuration corrompue
  (`tests/unit/brand-tokens.test.ts`), frontières d'authentification, validation
  et idempotence de l'assistant (`tests/integration/branding.test.ts`).

- **Capture d'écran 100% robuste sur tout site web (Support CSS moderne OKLCH, iframes et fallback résilient)** :
  - **Intercepteur et conversion automatique des couleurs CSS modernes** : `html2canvas` ne supporte pas nativement les fonctions de couleur modernes (`oklch()`, `color-mix()`, `lab()`, `oklab()`, `hwb()`) massivement utilisées par Tailwind v4 et les frameworks récents, provoquant un plantage silencieux de la capture. Mise en place d'un proxy transparent sur `window.getComputedStyle` (sur la fenêtre hôte et les clones `html2canvas`) qui convertit automatiquement et fidèlement ces formats en `rgb()` / `rgba()` via un canvas de tramage 2D matériel.
  - **Filtrage des frames inter-origines et médias externes** : exclusion préventive des balises `iframe`, `video`, `audio`, `script` et `noscript` dans `ignoreElements` et nettoyage systématique dans `onclone` pour empêcher tout blocage `SecurityError` cross-origin.
  - **Capture de secours technique blueprint (Fallback Viewport Blueprint)** : si le moteur `html2canvas` échoue (toiles corrompues, restrictions CSP ou environnement dégradé), génération automatique d'une vue synthétique élégante reproduisant le cadre de navigation, l'URL, le titre de la page, les dimensions de l'écran, le sélecteur d'ancrage et la pastille d'épingle numérotée.
  - **Garantie d'image à 100% des retours** : à la soumission du formulaire, le widget attend jusqu'à 8s la fin de la capture automatique ; si aucune image n'est disponible (ex: validation instantanée ou capture désactivée), le fallback est généré immédiatement. Aucun ticket n'arrive plus jamais sans capture d'écran côté admin.

- **Affichage visuel de la capture d'écran dans la fiche ticket admin & Modale Lightbox** :
  - **Carte de capture d'écran dédiée dans l'interface admin** : intégration d'une carte d'aperçu d'image haute fidélité (`.ticket-screenshot-card`) affichée directement sous les métadonnées et le bouton d'ancrage dans le panneau de détail du ticket.
  - **Aperçu interactif & badge viewport** : affichage direct de la capture d'écran annotée avec badge d'environnement (`📱 Mobile · 390×844` ou `💻 Desktop · 1280×800`), indicateur au survol et zoom au clic.
  - **Modale Lightbox grand format (`#screenshot-dialog`)** : ouverture d'une modale plein écran haute résolution sur clic de l'image ou du bouton `🔍 Agrandir`, avec boutons de téléchargement direct (`Télécharger`), ouverture de l'original dans un nouvel onglet (`Voir la capture privée`), et fermeture facile par touche Échap, bouton ✕ ou clic sur le voile d'arrière-plan.
  - **Indicateur dans la liste des tickets** : ajout d'une puce `📸 Capture` dans le résumé contextuel de chaque ticket disposant d'une capture d'écran.
  - **Fiabilisation de l'upload et de la capture automatique** : allongement de la fenêtre d'attente de capture automatique à 6s avant envoi pour éviter toute perte de capture sur pages complexes, fallback transparent sur PNG si WebP n'est pas supporté par le canvas du navigateur, et journalisation détaillée des erreurs réseau.

- **Refonte de l'expérience client & adaptation mobile complète (inspiré 21st.dev / Linear)** :
  - **Tiroir Bottom Sheet mobile ultra-fluide** : sur smartphone et tablette (`max-width: 640px`), le widget adopte un tiroir bottom sheet ancré en bas d'écran avec poignée de glissement tactile (`sheet-handle`), geste de fermeture par balayage vers le bas (swipe down), arrière-plan sombre avec flou d'atténuation (`panel-backdrop`), et respect strict des marges de sécurité iOS (`env(safe-area-inset-bottom)`).
  - **Carte de cible interactive (`.target-card`)** : état initial en carte pointillée incitative avec micro-copie (« Touchez ici pour pointer un élément sur la page »), puis état ancré avec icône d'action, libellé contrasté, bouton de recentrage visuel (`Localiser`) et bouton de suppression instantanée (`✕ Retirer`).
  - **Fallback transparent sur la page entière** : si un client rédige et envoie un retour sans avoir sélectionné d'élément spécifique, le système ne le bloque plus par un message d'erreur : il ancre automatiquement le ticket sur `body` (« Page entière ») avec capture automatique du viewport visible.
  - **Carte de capture enrichie (`.shot`)** : prévisualisation miniature haute fidélité avec badge de statut vert (`● Prête`), nom de fichier, raccourci d'édition directe vers le mini-éditeur d'annotation (`✏️ Annoter`), et retrait en un clic.
  - **Contraste et opacité renforcés** : surfaces de panneaux à haute opacité (`rgba(255,255,255,0.98)` / `rgba(12,12,15,0.98)`) éliminant toute fuite visuelle du texte de la page hôte au travers du verre dépoli.
  - **Mention explicite dans l'assistant d'intégration admin** : mise en avant de la compatibilité 100% mobile dans le wizard d'installation de script.

- **Capture d'écran automatique à chaque retour (Auto-screenshot)** :
  - Dès qu'un élément de la page est pointé / ancré, une capture d'écran haute résolution du viewport visible est automatiquement réalisée en arrière-plan via `html2canvas`.
  - L'image capturée intègre directement une pastille d'ancrage contrastée numérotée (« 1 ») dessinée aux coordonnées précises du clic.
  - La capture apparaît instantanément dans la zone de prévisualisation du formulaire avec possibilité immédiate de l'annoter avec le mini-éditeur (`✏️`) ou de la remplacer par une capture manuelle.
  - Si le point d'ancrage est retiré (`Retirer` ou clic sur l'épingle), la capture automatique est nettoyée en synchronisation.
  - Téléversement automatique non-bloquant lors de la soumission du retour, avec liaison au ticket pour consultation par l'administrateur et les agents IA.

- **Mini-éditeur d'annotation sur capture d'écran** :
  - Éditeur interactif intégré directement au widget permettant d'annoter une capture d'écran avant son envoi.
  - Outils intégrés : tracé de rectangles rouges d'accentuation, tracé de flèches indicatrices directionnelles et masquage/floutage par pixellisation des données sensibles (mots de passe, adresses email, informations confidentielles).
  - Contrôles complets : annulation coup par coup (`Annuler`), réinitialisation (`Effacer`), abandon ou validation avec réencodage instantané.
- **Mode « Pastilles collaboratives » sur la page (style Figma / Marker.io)** :
  - Rendu dynamique sur la page de l'ensemble des retours existants sous forme d'épingles numérotées avec badges de statut distinctifs (`À faire`, `En cours`, `À valider`, `Terminé`).
  - Infobulle au survol affichant le titre/extrait du ticket, son statut et son auteur.
  - Clic direct sur n'importe quelle pastille : ouverture immédiate de la fiche du retour dans le panneau latéral avec halo lumineux d'attention.
  - Commutateur dédié (`📍 Pastilles`) directement accessible dans la barre d'onglets pour afficher ou masquer les pastilles à tout moment.
- **Télémétrie & capture automatique des erreurs JavaScript** :
  - Écoute discrète et continue des erreurs d'exécution de la page (`window.onerror`) et des promesses non gérées (`unhandledrejection`) dans un tampon circulaire.
  - Intégration assainie dans les diagnostics techniques (`diagnostics.jsErrors`) avec troncature des messages, filtrage des tokens et anonymisation des URL sources.
- **Compression d'image côté client (Canvas WebP/JPEG)** :
  - Redimensionnement automatique des captures d'écran dépassant 1920×1080 px et encodage WebP haute qualité (0.85) avant téléversement, accélérant les soumissions et économisant la bande passante.
- **Nettoyage automatique du stockage à la résolution (Purge auto au statut Terminé)** :
  - Détection automatique du passage au statut `DONE` (par validation reviewer, par l'administrateur ou par un agent IA/MCP).
  - Suppression physique et irréversible de la capture d'écran du bucket de stockage (S3, Supabase Storage ou disque local) et dissociation en base de données pour libérer l'espace disque.
- **Simplification radicale du compositeur de retours client** :
  - Suppression des étapes numérotées artificielles (« 1 Montrez... », « 2 Dites... ») et du bandeau d'astuce jaune pour une interface aérée, fluide et épurée.
  - Ligne de cible interactive unifiée regroupant le libellé de l'élément pointé, la localisation et le retrait en un clic.
  - Puces de catégorie (`Bug`, `Visuel`, `Contenu`, `Idée`) ordonnées sur une seule grille épurée à 4 colonnes.
  - Barre d'outils compacte intégrée au conteneur de saisie : ajout de capture d'écran, accord pour informations techniques et aperçu sans verbiage superflu.
  - Pied de formulaire épuré : badge de raccourci clavier `<kbd>⌘↵</kbd>` incrusté dans le bouton d'action principal et rappels discrets (`P pointer`, `Échap annuler`).
- **Direction Artistique Monochrome Noir & Blanc pour l'interface client** :
  - Refonte visuelle complète du widget client avec des tokens noir et blanc purs (`#09090b` et `#ffffff`), surfaces dépolies en verre dépoli translucide, suppression des teintes indigo/orange pour une esthétique sobre, élégante et premium (style Linear/Vercel).
  - Pastille d'épingle `.pin` ultra-contrastée avec bague inversée, effet de survol dynamique et bague de rémanence.
  - Viseur de sélection d'élément (`.hl`) et bandeau d'instruction (`.pickbar`) en noir profond et verre fumé.
- **Nouveau libellé standard du bouton : « Faire un retour »** :
  - Remplacement de l'ancien libellé « Donner mon avis » par « Faire un retour », formule standardisée et professionnelle pour la revue de site web, avec rétro-compatibilité complète sur les configurations et attributs `label`.
  - Badge de raccourci clavier `[C]` directement visible sur le lanceur flottant.
- **Annulation intuitive de l'épingle posée (pin cancellation)** :
  - Bouton explicite `[✕ Retirer]` dans l'étape 1 du panneau de composition pour retirer le point d'ancrage en un clic.
  - Épingle posée directement interactive sur la page : au survol elle affiche `✕`, et un simple clic dessus retire l'épingle instantanément.
  - Touche `Échap` : annule l'épingle posée lorsqu'un point est sélectionné, ou ferme le widget si aucun point n'est posé.
- **Raccourcis clavier orientés productivité client** :
  - `C` : ouvre / ferme instantanément le panneau du widget (hors champs de saisie).
  - `P` : déclenche immédiatement le mode pointeur / sélection d'élément sur la page sans étape intermédiaire.
  - `1..4` (ou `Alt+1..4`) : sélection rapide de la catégorie (`1: Bug`, `2: Visuel`, `3: Contenu`, `4: Idée`).
  - `Échap` : annulation du point d'ancrage ou fermeture du widget.
  - `⌘ + ↵` / `Ctrl + ↵` : envoi direct du retour depuis le champ de saisie.
  - Barre d'aide aux raccourcis (`.shortcuts-bar`) discrète et élégante au bas du compositeur.
- **Boucle de validation complète pour le client reviewer** :
  - Actions interactives dans « Mes retours » pour les retours en attente (`À valider`) :
    - Bouton `[✓ Valider la correction]` : clôture immédiatement le retour (`DONE`), enregistre la validation client dans le journal de travail et émet l'événement webhook `feedback.resolved`.
    - Bouton `[↺ Demander un ajustement]` : champ de réponse intégré pour expliciter les retouches nécessaires, remettant le ticket à traiter (`TODO`) avec l'événement `feedback.reopened`.
  - Localisation visuelle interactive (`Localiser`) avec halo lumineux animé (`.halo-flash`) permettant au client de revoir instantanément l'élément ciblé sur la page depuis « Mes retours ».
  - Bouton de localisation et flash lumineux sur l'élément sélectionné dès l'étape 1 de la composition.
  - Puces de catégories rapides dans l'étape 2 (`[🐛 Bug]`, `[🎨 Visuel]`, `[✍️ Contenu]`, `[💡 Idée]`) pour qualifier et structurer les retours en un clic.
  - Bandeau d'astuce d'onboarding guidant le client dès la première utilisation du widget.
- **Accès rapide et onboarding admin renforcé** :
  - Bouton « Copier le lien » en 1 clic directement dans la barre de navigation pour copier l'URL directe du reviewer sans ouvrir le dialogue.
  - Guide d'onboarding en 3 étapes progressives sur l'espace vierge d'un projet (1. Intégration ou lien direct, 2. Test de l'expérience, 3. Automatisation avec agent IA).
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

### Notes

- **L'identité d'expéditeur est collectée mais dormante** : le produit n'embarque
  aucun service d'envoi d'emails — la seule notification sortante reste le
  webhook par projet. L'assistant le dit à l'écran plutôt que de laisser croire
  que des emails partent.
- **Le widget et les extraits d'installation ne sont pas encore rebrandés** : la
  marque s'applique pour l'instant à l'interface d'administration. Le libellé et
  les couleurs du widget, le texte inscrit sur la capture d'écran et les
  commentaires « ReviewDesk » des extraits livrés aux clients restent à traiter.

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
