# ReviewDesk MVP

MVP autonome de review visuelle pour sites de préproduction : widget JavaScript en Shadow DOM, épingle ancrée à un élément, tickets multi-projets et admin privé.

## Ce qui fonctionne

- projets et labels client, avec plusieurs origines exactes autorisées ;
- liens reviewer révocables : le secret est stocké uniquement sous forme de SHA-256 et transmis via `Authorization: Bearer`, jamais dans une query HTTP ;
- widget indépendant (Astro, React ou HTML), desktop et tactile, position relative à l’élément + viewport, signalement si l’ancre disparaît ;
- commentaire, diagnostics consentis et prévisualisés, capture manuelle PNG/JPEG/WebP facultative ;
- admin type liste Linear, filtres projet/statut, détail, réponse et statuts persistés ;
- stockage PostgreSQL PGlite persistant sur disque pour le MVP local (même moteur SQL PostgreSQL, sans service externe).

## Démarrage local

```bash
npm install
npm run build
ADMIN_PASSWORD='une-phrase-secrete-longue' npm start
```

Ouvrir `http://127.0.0.1:4300`. Pour tester une autre origine :

```bash
python3 -m http.server 4311 --bind 127.0.0.1 --directory public
```

Créer un projet avec l’origine `http://127.0.0.1:4311`, créer son lien reviewer, puis ouvrir l’URL `demo.html#project=…&review=…&api=http%3A%2F%2F127.0.0.1%3A4300`.

### Installation du widget

```html
<script src="https://reviewdesk-preview.example/widget.js"></script>
<script>
  ReviewDesk.init({
    api: 'https://reviewdesk-preview.example',
    projectId: 'UUID_DU_PROJET',
    token: 'SECRET_DU_LIEN_REVIEWER'
  })
</script>
```

Le script doit être présent uniquement dans la preview. En React/Astro, l’initialisation se fait côté client après chargement du script ; aucune dépendance au framework.

## Confidentialité et sécurité

Les diagnostics sont **désactivés par défaut**. Après consentement, l’utilisateur voit exactement l’objet envoyé : viewport, DPR borné, orientation, locale, timezone, navigateur/OS grossiers, URL sans query/hash/credentials, et erreurs structurées allowlistées. Le widget ne lit ni formulaire, cookies, localStorage, headers/bodies réseau, texte DOM, console globale, IP ou session replay. Les captures sont uniquement des fichiers choisis manuellement : aucune extraction automatique de page tierce.

Les API reviewer exigent à la fois un bearer lié au projet et une origine exacte. CORS n’est pas traité comme une authentification. Les uploads privés sont limités à 5 Mo, signature vérifiée, SVG refusé, servis uniquement à l’admin avec `no-store`. Les textes sont rendus avec `textContent`. Les soumissions sont limitées à 20/minute par hash de lien persistant.

## Contrôles

```bash
npm run check
npm audit --omit=dev
```

L’E2E lance l’admin sur `:4310` et la preview sur l’origine distincte `:4311`, puis exerce la soumission mobile, l’opt-in diagnostics, le filtrage admin, le changement de statut et sa persistance après refresh.

## Limites assumées du MVP

- une seule identité admin configurée par secret d’environnement ; pas de comptes/SSO ;
- capture automatique et annotations flèche/rectangle non incluses : une capture fiable sans fuite de champs/iframes tiers n’est pas simulée ; upload manuel seulement ;
- PGlite convient à un processus persistant local/dédié, pas au filesystem éphémère de Vercel Serverless. Une preview Internet sûre exige une URL dédiée avec volume privé ou l’adaptateur DB vers PostgreSQL managé et stockage objet privé ; aucun déploiement Internet n’est effectué ici ;
- pas de billing, websocket, intégration PILOTAGEHI ou données client réelles.
