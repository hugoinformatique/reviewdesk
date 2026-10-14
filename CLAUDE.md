# ReviewDesk — consignes de projet

Retours visuels clients épinglés sur la page, auto-hébergeable (kit Docker, kit local, Vercel).

## Architecture
- `src/` : serveur Fastify (`app.ts`, routes + Zod + CSRF), `db/` (PostgreSQL ou PGlite en dev), `storage/`, `mcp/server.ts` (serveur MCP stdio), `widget/index.ts` (widget Shadow DOM **sans framework**, à garder ainsi).
- `admin/` : administration React 19 + Vite 8 + TypeScript, Tailwind 4, shadcn/ui (Radix), TanStack Router (hash : `#/projets`, `#/p/<id|all>`, `#/p/<id>/stats`, `#/p/<id>/t/<ticket>`) et TanStack Query.
  - `admin/src/lib/` : `api.ts` (seule porte vers l'API, CSRF), `queries.ts` (clés + requêtes + mutations), `types.ts`, `format.ts`, `theme.ts`, `ui-store.ts` (overlays globaux).
  - `admin/src/components/ui/` : primitives shadcn ; `admin/src/features/<écran>/` : un dossier par écran.
- `public/` : fichiers servis tels quels ; `index.html`, `assets/`, `widget.js` y sont **générés** (ne pas éditer).
- `integrations/wordpress/` : extension WordPress (zippée au build dans `public/integrations/`).
- `scripts/packaging/` : kits local et Docker (reconstruisent admin et widget depuis les sources).

## Commandes
- `npm run dev` (serveur, sert `public/`), `npm run dev:admin` (Vite :5173, API via `REVIEWDESK_API`)
- `npm run build:assets` (intégrations + widget + admin), `npm run build`
- `npm run lint`, `npm run typecheck` (serveur + admin), `npm test`, `npm run test:e2e`
- `node --test tests/packaging/*.test.mjs` après `node scripts/packaging/package-kit.mjs --output test-results/local-kit` et `node scripts/packaging/docker/package-docker.mjs --output test-results/docker-kit`

## Règles
- CSP stricte partout (`script-src 'self'; style-src 'self'`) : pas de `<style>` injecté, pas de script inline, pas de CDN ; `style={{}}` React autorisé. Toute nouvelle dépendance front qui injecte du CSS doit être neutralisée (voir `vite.config.ts`).
- Texte venant d'un reviewer ou d'un agent : toujours rendu comme texte, jamais `dangerouslySetInnerHTML`. Jamais de jeton reviewer dans un lien de rejeu ni un export.
- Dépendances front en `devDependencies` (le serveur n'en a pas besoin à l'exécution).
- Versions : majeur/mineur/correctif selon la taille du changement, `CHANGELOG.md` section « Non publié ».
