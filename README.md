<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/mark-dark.svg">
  <img src="docs/assets/mark-light.svg" width="72" height="72" alt="ReviewDesk">
</picture>

# ReviewDesk

**Client feedback, pinned to the exact spot on the page.**

Your client clicks the thing that's wrong and writes one sentence.
You get a ticket anchored to that element — no account for them,
no annotated screenshots by email, no guessing which button they meant.

[![Release](https://img.shields.io/github/v/release/hugoinformatique/reviewdesk?style=flat-square&color=09090b&label=release)](https://github.com/hugoinformatique/reviewdesk/releases/latest)
[![CI](https://img.shields.io/github/actions/workflow/status/hugoinformatique/reviewdesk/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/hugoinformatique/reviewdesk/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-09090b?style=flat-square)](LICENSE)
[![Self-hosted](https://img.shields.io/badge/self--hosted-Docker%20%C2%B7%20Vercel-09090b?style=flat-square)](#get-started)

[Get started](#get-started) · [Features](#features) · [Add it to a site](#add-the-widget-to-a-site) · [AI agents](#plug-in-an-ai-agent-mcp) · [Updating](#updating) · [Français](README.fr.md)

</div>

<br>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/board-dark.png">
  <img src="docs/assets/screenshots/board-light.png" alt="ReviewDesk admin: a project's feedback in four columns, To do, In progress, To validate, Done">
</picture>

## Why

Feedback on a staging site usually arrives as *"the button at the bottom looks off"* —
in an email, with no URL, no screen size and a cropped screenshot. Then you guess.

ReviewDesk removes the guessing. A one-line script adds a feedback button
to the staging site. The client points at the element and writes what's wrong;
a screenshot comes with it. The ticket keeps the page, the element, the
screen size and a **replay link** that reopens the page with the pin in place.

It's free, open source and **self-hosted**: your clients' feedback stays on your server.

## Features

<table>
<tr>
<td width="50%" valign="top">

**For the client reviewing**

- A floating button, two steps: *show the spot*, *say what's wrong*.
- Live highlight of the element, named in plain words — never a CSS selector.
- A screenshot of the visible page is taken as they point — they can annotate it
  (draw, arrow, blur), remove it, or attach / paste their own (`Ctrl/⌘ V`).
- *Bug · Visual · Content · Idea* in one click.
- **My feedback** tab: status and the team's replies, on the page itself.
- No account, no password, no extension.
- Shadow DOM: the host site's CSS can't break it, and it breaks nothing.
- Adopts the **host page's** light/dark theme; keyboard and touch friendly.

</td>
<td width="50%" valign="top">

**For the team fixing**

- Multiple projects, each with an exact list of allowed origins.
- Board (drag & drop) or list, filters, `⌘K` command palette.
- Statuses: *To do · In progress · To validate · Done*.
- A ticket is a conversation: reply to the client, or leave an internal note.
- **Replay link**: reopens the page with the pin on the element.
- **One-prompt export**: every open ticket as one Markdown block for your coding agent.
- **MCP server + agent API**: let Claude Code, Codex or Cursor read, fix and close tickets.
- Overview: what's waiting, what moved in 7/30/90 days, per project and page.
- Outgoing webhook, white-label branding, dark mode.

</td>
</tr>
</table>

<table>
<tr>
<td width="50%" valign="top">
<img src="docs/assets/screenshots/widget.png" alt="The widget on a demo shop: the client has pointed at a button, a screenshot is ready, and they are typing feedback">
<p align="center"><sub><b>Client side</b> — point, write, send.</sub></p>
</td>
<td width="50%" valign="top">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/ticket-dark.png">
  <img src="docs/assets/screenshots/ticket-light.png" alt="A ticket in the admin: the client's screenshot, the element, the conversation">
</picture>
<p align="center"><sub><b>Team side</b> — the element, the screenshot, the conversation.</sub></p>
</td>
</tr>
</table>

> [!NOTE]
> The interface (admin and widget) is in **French** for now. The button label is
> configurable; a full English UI is a welcome contribution.

## Get started

| | You need | Best for |
| --- | --- | --- |
| **[Docker Compose](#docker-compose-recommended)** | A Linux server with Docker | Running it for real, on your own infrastructure |
| **[Local kit](#try-it-on-your-machine)** | Node.js 22 | Trying it on your laptop in two minutes |
| **[Vercel](#vercel)** | PostgreSQL + an S3 bucket | Serverless, nothing to maintain |

### Docker Compose (recommended)

Everything runs on one host: the app, PostgreSQL 17 and a built-in private S3
store for screenshots. No Node.js on the host, no cloud account.

1. Download `reviewdesk-vX.Y.Z-docker.zip` and its `.sha256` from the
   **[latest release](https://github.com/hugoinformatique/reviewdesk/releases/latest)**.
2. Install and start:

   ```sh
   sha256sum -c reviewdesk-v*-docker.zip.sha256
   unzip reviewdesk-v*-docker.zip && cd reviewdesk-v*-docker
   sh install.sh --non-interactive --port 48300   # writes .env, secrets and the internal TLS
   docker compose up -d --build
   curl -fsS http://127.0.0.1:48300/health
   ```

3. Put a reverse proxy with HTTPS in front (Caddy and nginx examples in the guide)
   and open the admin. The admin password is in `secrets/admin_password`.

The full walkthrough — HTTPS, external S3, backups, troubleshooting — is in the
**[Docker guide](docs/GUIDE-DOCKER-EN.md)** ([français](docs/GUIDE-DOCKER-FR.md)).

### Try it on your machine

Download `reviewdesk-vX.Y.Z-local.zip` from the
[latest release](https://github.com/hugoinformatique/reviewdesk/releases/latest),
unzip it, then:

```sh
node install.mjs   # asks for the admin password
node start.mjs     # http://127.0.0.1:4300 — username: admin
```

Works on Windows, macOS and Linux with Node.js 22; data stays in the folder.
For local evaluation only — see the [local kit guide](docs/KIT-LOCAL.md) (French).

### Vercel

1. **Fork** this repository and import it in Vercel.
2. Create a dedicated **PostgreSQL** database (Neon, Supabase…) and a **private
   S3 bucket** (Cloudflare R2, AWS S3, Scaleway, Backblaze B2…).
3. Set the environment variables, then deploy:

   ```text
   ADMIN_PASSWORD=<long random passphrase>
   NODE_ENV=production
   DATABASE_URL=postgresql://…pooler…/reviewdesk?sslmode=require
   STORAGE_DRIVER=s3
   S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
   S3_BUCKET=reviewdesk-uploads
   S3_REGION=auto
   S3_ACCESS_KEY_ID=…
   S3_SECRET_ACCESS_KEY=…
   S3_FORCE_PATH_STYLE=true
   ```

`vercel.json` builds the static assets and routes `/api/*` and `/health` to the
function. Check `/health`, sign in, create a project. Every variable is
documented in [`.env.example`](.env.example).

### From source

```sh
git clone https://github.com/hugoinformatique/reviewdesk.git && cd reviewdesk
npm ci
npm run build
ADMIN_PASSWORD="a-long-random-passphrase" DATABASE_URL="pglite://.data/reviewdesk" \
  STORAGE_DRIVER=filesystem npm start          # http://127.0.0.1:4300
```

`npm run package:docker` and `npm run package:local` build the same kits as the
releases, in `dist/kits/`.

## Add the widget to a site

In the admin, create a project with the site's address. It gives you one line,
already filled in, to paste before `</body>`:

```html
<script src="https://reviews.example.com/widget.js#project=PROJECT_ID&token=REVIEW_LINK_SECRET" defer></script>
```

Settings travel in the URL fragment (`#…`), which browsers never send to a
server: the secret doesn't end up in access logs.

| Tool | Where the line goes |
| --- | --- |
| **WordPress** | The ReviewDesk plugin, served by your instance at `/integrations/reviewdesk-wordpress.zip` |
| **Webflow** | Site settings › Custom code › Footer code |
| **Framer** | Site Settings › General › Custom Code › End of `<body>` |
| **Wix** | Settings › Custom code › Body – end |
| **Squarespace** | Settings › Advanced › Code injection › Footer |
| **Google Tag Manager** | Custom HTML tag, All Pages trigger |
| **Nothing installed** | A review link: the client drags a *Faire un retour* bookmark (desktop only) |

<details>
<summary><b>Widget options and manual initialisation</b></summary>

<br>

Each setting goes in the fragment (`#project=…&label=…`), a `data-*` attribute,
or `init()`; the attribute wins over the fragment.

| Attribute | `init()` | Default | Effect |
| --- | --- | --- | --- |
| `data-api` | `api` | the script's origin | ReviewDesk API origin. |
| `data-project` | `projectId` | — | Project UUID. **Required.** |
| `data-token` | `token` | — | Review link secret. **Required.** |
| `data-label` | `label` | `Faire un retour` | Floating button label. |
| `data-position` | `position` | `bottom-right` | `bottom-right` or `bottom-left`. |
| `data-accent` | `accent` | `#4338ca` | Accent colour, to match the site. |

For React, Astro or Next when the token comes from app state:

```html
<script src="https://reviews.example.com/widget.js"></script>
<script>
  ReviewDesk.init({ api: 'https://reviews.example.com', projectId: 'PROJECT_ID', token: 'REVIEW_LINK_SECRET' })
</script>
```

</details>

> [!IMPORTANT]
> Only add the script to a **protected staging site**. The token in the page lets
> anyone who can see the page leave feedback on that project. It can be revoked
> at any time from the admin.

## Plug in an AI agent (MCP)

A coding agent — Claude Code, Codex, Cursor, Claude Desktop, VS Code or any MCP
client — can read the feedback, fix it and report back to the client.

1. Admin › **AI agents** › create a token (one project or all, read-only or read/write).
   The `rda_…` secret is shown once, with the MCP configuration already written.
2. Register the server (built by `npm run build` into `dist/mcp.js`):

   ```sh
   claude mcp add reviewdesk \
     --env REVIEWDESK_URL=https://reviews.example.com \
     --env REVIEWDESK_TOKEN=rda_… \
     -- node /path/to/reviewdesk/dist/mcp.js
   ```

3. Ask: *"Go through the ReviewDesk tickets to do on project X, fix them, and move
   each one to To validate with a note on what you changed."*

| Tool | What it does |
| --- | --- |
| `list_projects` | Projects visible to the token, with counts per status. |
| `list_tickets` | Tickets filtered by status, project, page or format. |
| `next_fix_request` | The oldest ticket the team sent to an agent with **Lancer la correction**. |
| `get_ticket` | Element, page, screen, diagnostics and history. |
| `get_screenshot` | The client's screenshot, as an image. |
| `comment_ticket` | An internal comment, or a reply published to the client. |
| `update_ticket` | Status and report in one call. |

No MCP? The agent API is plain HTTP with a bearer token — see the
[API reference](#reference) below.

## Updating

**Releases are the update channel.** Work lands on `main` continuously; a version
is only shipped when it is tagged `vX.Y.Z`, which builds the kits and publishes a
[GitHub release](https://github.com/hugoinformatique/reviewdesk/releases) with
its changelog. A self-hosted instance only ever moves from one release to the next.

| You run | How to update |
| --- | --- |
| **Docker** | `sh update.sh` in the install folder: downloads the latest release, checks its SHA-256, backs up the database, keeps your configuration and volumes, restarts. The previous folder is kept for rollback. [Details](docs/GUIDE-DOCKER-EN.md#8-operations) |
| **Vercel** | **Sync fork** on GitHub; Vercel redeploys and migrations run on boot. |
| **Local kit** | Download the new zip; see the [local kit guide](docs/KIT-LOCAL.md). |

**How you know:** the admin shows the installed version and a discreet
*new version available* line when a newer release exists. To get notified
anyway, click **Watch › Custom › Releases** on this repository.

## Security and privacy

- **The widget never reads** form fields, cookies, `localStorage`, network
  traffic or the console, and does no session replay. It sends what the client
  points at and writes.
- **Screenshots are shown before sending.** The one taken when the client points
  is rendered in their browser, previewed in the form, and can be blurred,
  annotated or removed; nothing leaves the page until they click *Send*.
- **Diagnostics are opt-in**, with an exact preview of what is sent (viewport,
  locale, coarse browser/OS, URL without query or hash).
- **Review links and agent tokens** are stored as SHA-256 hashes only, scoped,
  revocable, rate-limited. The reviewer API requires the bearer **and** the exact
  origin; CORS is never used as authentication.
- **Admin**: `HttpOnly` / `SameSite=Strict` session cookie and CSRF token;
  strict CSP (`script-src 'self'; style-src 'self'`), no CDN.
- **Uploads**: size-limited, checked by file signature, SVG refused, served only
  to an authenticated admin.
- **Update check**: while the admin is in use, the server asks GitHub's public API
  for the latest release, at most twice a day. Nothing else is sent. Turn it off
  with `UPDATE_CHECK=false`.

Found a vulnerability? Please report it privately — see [SECURITY.md](SECURITY.md).

## Reference

<details>
<summary><b>Configuration</b></summary>

<br>

Every variable is documented in [`.env.example`](.env.example). The main ones:

| Variable | Default | Role |
| --- | --- | --- |
| `ADMIN_PASSWORD` | — | **Required.** ≥ 16 characters. The only human credential. |
| `DATABASE_URL` | — | **Required.** `postgresql://…` (production, pooled) or `pglite://…` (development). |
| `STORAGE_DRIVER` | — | `s3`, `supabase` or `filesystem` (development only). |
| `S3_ENDPOINT` / `S3_BUCKET` / `S3_REGION` | — | A dedicated **private** bucket. |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | — | Credentials limited to that bucket. |
| `DATABASE_POOL_MAX` | `1` | Connections per instance. Raise only behind a pooler. |
| `RUN_MIGRATIONS_ON_BOOT` | `true` | Set to `false` and run `npm run migrate` at build time to avoid cold-start migrations. |
| `UPLOAD_MAX_BYTES` | `4000000` | Below Vercel's 4.5 MB request body limit. |
| `SUBMISSIONS_PER_MINUTE` | `20` | Per review link. |
| `AGENT_REQUESTS_PER_MINUTE` | `120` | Per agent token. |
| `SESSION_TTL_SECONDS` | `28800` | Admin session lifetime. |
| `UPDATE_CHECK` | `true` | `false` disables the new-release check. |
| `LOG_LEVEL` | `warn` | Logs, with secrets redacted. |

PGlite and filesystem storage are refused when `NODE_ENV=production` or `VERCEL=1`.

</details>

<details>
<summary><b>HTTP API</b></summary>

<br>

**Reviewer** — review link bearer + allowed origin

| Method | Route | Effect |
| --- | --- | --- |
| `POST` | `/api/feedback?projectId=…` | File anchored feedback. |
| `GET` | `/api/feedback?projectId=…` | This link's feedback and the team's replies. |
| `POST` | `/api/uploads?projectId=…` | Upload a screenshot (`multipart/form-data`). |

**Agent** — `Authorization: Bearer rda_…`, no cookie, no CORS

| Method | Route | Effect |
| --- | --- | --- |
| `GET` | `/api/agent/context` | Token scope and visible projects, with counts per status. |
| `GET` | `/api/agent/tickets` | Tickets (`status`, `projectId`, `page`, `format`, `requested`, `limit`, `cursor`). |
| `GET` | `/api/agent/tickets/:id` | One ticket and its history. |
| `POST` | `/api/agent/tickets/:id/comments` | Internal comment or reply to the client. |
| `PATCH` | `/api/agent/tickets/:id` | Status and comment in one call. |
| `GET` | `/api/agent/uploads/:id` | A ticket's screenshot. |

```sh
curl -H "Authorization: Bearer rda_…" "https://reviews.example.com/api/agent/tickets?status=TODO"
```

**Admin** — session cookie, CSRF token on writes: `/api/auth/*`, `/api/projects`,
`/api/projects/:id/review-links`, `/api/tickets`, `/api/tickets/:id/comments`,
`/api/tickets/:id/fix-request`, `/api/stats`, `/api/agent-tokens`, `/api/version`.
`GET /health` is the liveness probe.

</details>

<details>
<summary><b>Architecture</b></summary>

<br>

```text
src/app.ts          Fastify routes, Zod validation, origin guard and CSRF
src/db/             PostgreSQL (production) or PGlite (development), idempotent migrations
src/storage/        S3-compatible, Supabase Storage or local files (development)
src/widget/         the widget: Shadow DOM, no framework → public/widget.js
src/mcp/server.ts   stdio MCP server → dist/mcp.js
admin/              admin UI: React 19, Vite, Tailwind CSS 4, shadcn/ui, TanStack Router + Query
api/index.ts        Vercel serverless entry
integrations/       WordPress plugin
scripts/packaging/  Docker and local kits
```

</details>

## Development

```sh
npm run dev          # server with hot reload (serves public/)
npm run dev:admin    # admin with hot reload (Vite, :5173)
npm run lint         # ESLint
npm run typecheck    # server + admin
npm test             # unit and integration tests
npm run test:docker  # same, against throwaway PostgreSQL + MinIO containers
npm run test:e2e     # Playwright, on two real origins
npm run check        # all of the above + build + npm audit
```

`public/widget.js`, `public/index.html` and `public/assets/` are build outputs:
edit `src/widget/` and `admin/src/`, then `npm run build:assets`.

## Contributing

Issues and pull requests are welcome.

1. For anything bigger than a fix, open an issue first to discuss it.
2. Branch from `main` (`feat/…`, `fix/…`, `docs/…`).
3. `npm run check` must pass; changes touching privacy (what the widget sends,
   logging) come with the test that locks them.
4. Add a line under `## [Non publié]` in [CHANGELOG.md](CHANGELOG.md).

Code comments explain *why*, not *what*.

## License

[MIT](LICENSE) © Hugo Informatique.

Geist and Geist Mono are self-hosted under the SIL Open Font License 1.1.
Third-party tool logos come from [svgl.app](https://svgl.app) and belong to their owners.
