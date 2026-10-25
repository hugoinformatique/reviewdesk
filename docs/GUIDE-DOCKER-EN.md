# ReviewDesk — Docker Compose self-hosting guide

**English** · [Français](GUIDE-DOCKER-FR.md)

This archive installs ReviewDesk on a server with Docker Compose, **without any
cloud account**: the compiled application, a dedicated PostgreSQL database and
built-in S3 storage (SeaweedFS) for screenshots, all on the same host. Node.js
is not required on the host. An external S3 remains possible as an option
(section 7).

The installer prompts and the admin interface are currently in French.

> **License.** ReviewDesk is free and open-source software, released under the [MIT license](../LICENSE) (also included as `NOTICE.txt` in the archive).
>
> **Hosting costs.** The archive requires no paid service, but the server, its
> disk, its backups, the domain name and the public certificate remain your
> responsibility, including their hosting fees.

## 1. Architecture

```
navigateur / widget ──HTTPS──▶ reverse proxy (même hôte) ──HTTP──▶ 127.0.0.1:48300 ─▶ app (conteneur)
                                                                                        │
                                       réseau interne Compose (aucune sortie) ◀─────────┘
                                          │                          │
                     postgres (volume pgdata)        s3 : passerelle HTTPS https://s3:8443
                                                       ▲              │ socket Unix (volume s3socket, en mémoire)
                                         s3-init       │              ▼
                            (crée le bucket privé,     │   s3-storage : SeaweedFS, sans réseau (volume s3data)
                             puis s'arrête) ───────────┘
```

(Diagram labels: browser / widget, reverse proxy on the same host, container,
internal Compose network with no outbound access, HTTPS gateway, Unix socket in
memory, creates the private bucket then exits, SeaweedFS with no network.)

- `app`: image built locally from `app/Dockerfile` (official
  `node:22.23.3-bookworm-slim` image, pinned by digest). Production
  dependencies only, installed by `npm ci` from `app/package-lock.json`.
  `NODE_ENV=production`, `HOST=0.0.0.0` inside the container, `Secure` cookies.
  The port is published **on 127.0.0.1 only**. The server runs as the `node`
  user (UID 1000), with a read-only file system.
- `postgres`: official `postgres:17.11-alpine3.24` image, pinned by digest.
  Compose network `internal`: no published port, no outbound access. Data is
  stored in the named volume `reviewdesk_pgdata`.
- `s3-storage`: SeaweedFS (`chrislusf/seaweedfs`, weed 4.48), pinned by digest.
  Container **with no network interface** (`network_mode: none`): all its ports
  (master, volume, filer, S3 gateway over HTTPS only on 8444, S3 gRPC on 18444)
  exist only on its loopback, and no other container can reach them. The S3 API
  leaves the container only through a Unix socket, in the `s3socket` volume
  (in memory, shared with `s3` only). Data is stored in the named volume
  `reviewdesk_s3data`. Processes run as the `seaweed` user, with a read-only
  file system.
- `s3`: gateway (same image as the app, `app/s3-gateway.mjs`), the only S3
  access point of the internal network, **no published port**. It terminates
  TLS on `https://s3:8443` with the certificate issued for the name `s3` by the
  authority generated at install time, then forwards to the SeaweedFS socket.
  It holds the TLS key and no S3 identity; it runs as the `node` user. Plain
  HTTP is refused (the connection is dropped).
- `s3-init`: one-shot container (same image as the app) that checks on every
  start that the private bucket exists, creates it otherwise, then exits. An
  existing bucket is never modified.

The application trusts the internal authority through `NODE_EXTRA_CA_CERTS`
(`certs/ca.pem`); TLS verification is never disabled.

## 2. Prerequisites

- Linux with Docker Engine and the Docker Compose v2 plugin (`docker compose version`).
- A POSIX shell (`sh`) and `openssl` (passwords, keys and internal TLS certificate).
- Docker accessible to the user running `install.sh` during the first
  configuration (see section 4).
- Disk space for the `pgdata` (database) and `s3data` (screenshots) volumes.
- For access from other machines (remote admin, widget on a client site): a
  domain name pointing to the server and an HTTPS reverse proxy on that same
  server (section 6).

## 3. Verify and extract the archive

Download `reviewdesk-vX.Y.Z-docker.zip` and its `.sha256` from the [latest GitHub release](https://github.com/hugoinformatique/reviewdesk/releases/latest), or build it from source with `npm ci && npm run package:docker` (Node 22; output in `dist/kits/`).

```sh
sha256sum -c reviewdesk-v*-docker.zip.sha256
unzip reviewdesk-v*-docker.zip
cd reviewdesk-v*-docker
```

## 4. Configure

### Default installation (built-in S3)

```sh
sh install.sh --non-interactive --port 48300
```

No S3 value is requested. Without `--non-interactive`, the script asks for the
port, then for an optional external S3 endpoint: leave it empty for the
built-in storage. Useful options: `--s3-bucket NAME` (default
`reviewdesk-captures`), `--s3-key-prefix PREFIX` (default `uploads`).
`sh install.sh --help` lists all options.

### What `install.sh` produces (built-in S3)

| File | Content | Permissions |
|---|---|---|
| `.env` | port, `REVIEWDESK_S3=bundled`, `COMPOSE_PROFILES=bundled-s3`, non-secret S3 settings | 600 |
| `secrets/admin_password` | generated administrator password (32 characters) | 600 |
| `secrets/postgres_password` | generated PostgreSQL password, distinct | 600 |
| `secrets/s3_access_key_id`, `secrets/s3_secret_access_key` | generated S3 identity of the application | 600 |
| `secrets/s3_admin_access_key_id`, `secrets/s3_admin_secret_access_key` | generated, distinct S3 initialization identity (bucket creation) | 600 |
| `secrets/s3_tls_key` | TLS private key of the built-in S3 (`s3` gateway and `s3-storage`) | 600 |
| `certs/ca.pem` | internal TLS authority (public certificate) | 644 |
| `certs/s3.pem` | certificate of the `s3` service (name `s3`, 10 years) | 644 |

The S3 keys are random and specific to each installation. The authority's
private key is used once to sign `certs/s3.pem`, then it is **destroyed**: no
other certificate can ever be recognized by the application. Both S3 identities
are limited to the configured bucket; anonymous access does not exist.

In the `s3` container, a script reads these secrets mounted as files, writes
the SeaweedFS configuration and a copy of the TLS key in memory (`tmpfs`,
permissions 600), then starts SeaweedFS without privileges. No secret goes
through an environment variable, `docker compose config` or the logs.

### Rules applied

- no secret is displayed or logged;
- an existing configuration is **never overwritten or regenerated**: when
  re-run without options, the script verifies it (permissions, values,
  certificate valid for `s3` and signed by `certs/ca.pem`, matching TLS key)
  and keeps it; with options, it refuses;
- a partial or invalid configuration is refused without modifying anything
  (for example a missing `secrets/s3_tls_key` or `certs/s3.pem`);
- an already existing `certs/ca.pem` or `certs/s3.pem` file is never replaced:
  the new installation stops;
- for a **new** configuration, the script requires Docker to confirm that the
  volumes `reviewdesk_pgdata` **and** `reviewdesk_s3data` (or
  `<COMPOSE_PROJECT_NAME>_…`) do not exist: if one exists, or if Docker is
  absent, stopped or denies access (doubt), the script stops without writing
  anything rather than generating passwords and keys that would no longer match
  the data. Verifying an existing configuration does not need Docker;
- an exclusive lock (directory `.reviewdesk-install.lock`) is taken before any
  check: two simultaneous runs can neither pass the checks together nor mix
  their files; the second one stops. After an abrupt stop (`kill -9`, power
  loss), delete this directory by hand **after checking** that no `install.sh`
  is running;
- files are published with no possible overwrite (a file that appeared in the
  meantime causes a stop, never a replacement).

**Retrieve the administrator password**, locally on the server:

```sh
cat secrets/admin_password
```

Login: `admin`. Do not copy this password into a ticket, a chat or logs.
**Back up `.env`, `secrets/` and `certs/` together** in an encrypted vault:
without them, the database and the storage are no longer accessible.

## 5. Start

```sh
docker compose up -d --build
docker compose ps
curl -fsS http://127.0.0.1:48300/health
```

`/health` answers `{"ok":true,"database":"postgresql","storage":"s3 reviewdesk-captures @ s3:8443"}`
(`curl` is optional; without it, `docker compose ps` must show `app` in the
`healthy` state and `s3-init` finished with exit code 0).

Start order: `postgres` and `s3-storage` (healthy when SeaweedFS answers over
HTTPS on its loopback, certificate verified by `certs/ca.pem`), then `s3`
(healthy when `https://s3:8443/healthz` answers end to end), then `s3-init`,
then `app`. `docker compose logs s3-init` reports « bucket S3 privé … créé »
(private S3 bucket … created) on the first start, « existe déjà, inchangé »
(already exists, unchanged) afterwards.

On start, the `app` container, before launching the server:

1. reads the secrets mounted in `/run/secrets/` and refuses a missing, empty or
   multi-line secret;
2. revalidates `S3_ENDPOINT` (exact HTTPS), the bucket and the region;
3. checks the bucket **with** the credentials (signed `HeadBucket`): it must
   exist and accept the key;
4. requests the bucket listing **without credentials**: only a 401/403 response
   (access denied) is accepted;
5. writes, with the credentials, a small test object with no data
   (`<prefix>/.reviewdesk-startup-probe-<random>`), reads it back **without
   credentials** — only a 401/403 response is accepted — then deletes it in all
   cases. Anonymously readable object, unexpected response, write or deletion
   refused: it stops with an explicit message (which names the object if it
   could not be deleted, never a secret);
6. drops root privileges and runs the server as the `node` user, with a
   read-only file system and Linux capabilities removed.

Database migrations are applied automatically on start.

## 6. Expose over HTTPS (remote admin and widget)

Port 48300 listens only on `127.0.0.1`: it is **not reachable** from another
machine, on purpose. Remote access goes through an HTTPS reverse proxy
**installed on the same host**, with a real domain name and a valid TLS
certificate (Let's Encrypt or equivalent). The proxy must forward the original
`Host` header and `X-Forwarded-Proto: https`: ReviewDesk uses them for its
protection against cross-site writes, and its `Secure` session cookies require
HTTPS. The application trusts these headers; this is safe only because just a
local process can reach the port.

The Caddy and nginx configurations below are examples to adapt; they were not
run during the validation of this archive, which used a local test TLS proxy
(on `127.0.0.1`, test name, test authority) applying the same headers. No
public proxy, real domain name or public certificate was tested.

### Caddy (automatic certificate)

```
reviews.example.com {
	reverse_proxy 127.0.0.1:48300
}
```

Caddy forwards `Host` and `X-Forwarded-Proto` by default.

### nginx

```nginx
server {
    listen 443 ssl;
    http2 on;
    server_name reviews.example.com;
    ssl_certificate     /etc/letsencrypt/live/reviews.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/reviews.example.com/privkey.pem;
    client_max_body_size 5m;
    location / {
        proxy_pass http://127.0.0.1:48300;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

Then:

- administration: `https://reviews.example.com/`;
- widget on a client site: load `https://reviews.example.com/widget.js` and
  declare the site's exact origin (e.g. `https://www.client.fr`) in the
  project's allowed origins. An HTTPS site cannot load a widget served over
  HTTP.

### Proxy on another machine

Never publish the application's HTTP port on a network interface. If the TLS
proxy has to run elsewhere, connect it to the server through an encrypted
tunnel that ends on `127.0.0.1:48300` (WireGuard, or `ssh -N -L
48300:127.0.0.1:48300 serveur` from the proxy machine), and let no other
client reach the tunnel's endpoint.

### Administration without a domain

For occasional admin access without a proxy, an SSH tunnel from your
workstation is enough: `ssh -N -L 48300:127.0.0.1:48300 serveur`, then
`http://localhost:48300/`. Common browsers treat `localhost` as a secure
context; if the connection fails (`Secure` cookie refused), go through the
HTTPS domain. The widget, for its part, requires the HTTPS domain.

## 7. S3 storage

### Built-in S3 (default)

- Private bucket in the `reviewdesk_s3data` volume, created by `s3-init`. No S3
  port is published on the host: only the containers of the internal Compose
  network (app, s3-init) can reach it.
- No SeaweedFS port is reachable from the network: the `s3-storage` container
  has no network interface. This is essential for its S3 gRPC port: SeaweedFS
  4.48 exposes identity administration calls there that are not authenticated
  without a filer signing key.
- No plain-HTTP S3 on the network: only the `s3` gateway listens, over HTTPS on
  8443. Inside `s3-storage`, the main S3 port is HTTPS only; SeaweedFS's Unix
  socket, for its part, speaks plain HTTP (cannot be disabled in SeaweedFS
  4.48), but it is accessible only to the `s3-storage` and `s3` containers, in
  an in-memory volume.
- The `certs/s3.pem` certificate is valid for 10 years. Renewing it is not
  tooled: `install.sh` refuses to regenerate an existing configuration.

### External S3 (optional)

For a bucket at a provider (R2, AWS, Scaleway…), pass `--s3-endpoint`: the
`s3-storage`, `s3` and `s3-init` services then stay disabled
(`REVIEWDESK_S3=external`, empty `COMPOSE_PROFILES`). Prepare a credentials
file outside the directory, with permissions 600:

```sh
umask 077
cat > ~/reviewdesk-s3.txt <<'EOF'
S3_ACCESS_KEY_ID=votre-cle
S3_SECRET_ACCESS_KEY=votre-secret
EOF
sh install.sh --non-interactive \
  --port 48300 \
  --s3-endpoint https://s3.example.com \
  --s3-bucket reviewdesk-captures \
  --s3-region auto \
  --s3-credentials-file ~/reviewdesk-s3.txt
shred -u ~/reviewdesk-s3.txt   # ou rm, une fois la configuration créée
```

(`votre-cle` / `votre-secret` are placeholders for your key and secret; the
trailing comment means "or rm, once the configuration is created".)

`--s3-credentials-stdin` reads the same two lines from standard input; without
these options, in interactive mode, the key and its secret are entered with
**masked input**. `--s3-region`, `--s3-path-style`, `--ca-file` and the
credentials options are refused without `--s3-endpoint`.

- `S3_ENDPOINT` must be exactly `https://host[:port]`, in canonical form
  (lowercase host, no explicit `:443`, port without leading zero, IPv4 only in
  full dotted notation): HTTP, path, parameters and credentials in the URL are
  refused.
- The bucket must already exist and stay **private**; enable the provider's
  public access block. Use a dedicated key limited to this bucket, with minimal
  permissions (AWS IAM names): `s3:ListBucket` on the bucket (required by
  `HeadBucket`), `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` on the
  objects of the prefix.
- `S3_FORCE_PATH_STYLE=true` (default) suits R2, MinIO, SeaweedFS and AWS;
  `false` for virtual-hosted addressing (`https://bucket.host`).
- **Private authority**: copy the PEM certificate of the provider's authority
  (never a private key) into `certs/`, for example `certs/fournisseur-ca.pem`,
  and pass `--ca-file fournisseur-ca.pem`.
- What the startup proves: a **newly written** object in the prefix is not
  anonymously readable *at that moment*. It does not prove the absence of a
  public ACL on **other** objects, nor a later change of the policy. A provider
  that answers anything other than 401/403 to an anonymous read prevents
  startup.
- Backups of the screenshots are then configured at the provider.

## 8. Operations

| Action | Command |
|---|---|
| Status | `docker compose ps -a` |
| Logs | `docker compose logs --tail 100 app` |
| Stop | `docker compose stop` |
| Restart | `docker compose up -d` |
| Database backup | `umask 077; docker compose exec -T postgres pg_dump -U reviewdesk reviewdesk > reviewdesk.sql` |

- **Never run `docker compose down -v`** or `docker volume prune`: they delete
  the database and screenshot volumes.
- **Screenshot backup (built-in S3)**: they are in the `reviewdesk_s3data`
  volume. A consistent copy is made with SeaweedFS stopped
  (`docker compose stop app s3 s3-storage`), by archiving the volume with your
  usual tools, then `docker compose up -d`. This procedure is neither tooled
  nor tested by the archive.
- **Update**: from the current installation directory, `sh update.sh`
  installs the latest GitHub release (`--version X.Y.Z` for a specific
  version, `--archive reviewdesk-vX.Y.Z-docker.zip` for an offline update, with
  its `.sha256` next to it; `--yes` skips the confirmation, `--skip-backup`
  skips the backup, `--timeout SECONDS` bounds the wait; `sh update.sh --help`
  documents everything). The script verifies the SHA-256, extracts the version
  into the sibling directory `reviewdesk-vX.Y.Z-docker` (refused if it
  exists), copies `.env`, `secrets/` and `certs/` into it with their
  permissions, verifies the configuration (`sh install.sh`), asks for
  confirmation, backs up the database (`backup-YYYYMMDD-HHMMSS.sql`, in the
  **old** directory, stopping if it fails), runs
  `docker compose up -d --build --force-recreate` from the new directory and
  waits for `app` to be `healthy`. It never moves to an older version and never
  deletes the old directory or the volumes (no `down -v`). **Rollback**: run
  `docker compose up -d --build --force-recreate` again from the old directory
  and, if the migrations changed the database, restore the backup first.
  By hand, the same steps: extract the new archive into a
  new directory, copy `.env`, `secrets/` and `certs/` into it while preserving
  permissions (`cp -a`), verify with `sh install.sh`, then, from that
  directory: `docker compose up -d --build --force-recreate`. `--force-recreate` is
  required: without it, an unchanged container (for example `postgres`) would
  keep its secrets mounted from the **old** directory and could no longer
  restart if that directory is deleted. The Compose project name `reviewdesk`
  is fixed in `compose.yaml`: the same volumes are reused.
- **Update from a version without built-in S3**: a `.env` written by the old
  `install.sh` contains neither `REVIEWDESK_S3` nor `COMPOSE_PROFILES`. It is
  accepted as is and read as an external S3; `install.sh` does not rewrite it
  (message « Format de .env antérieur … laissé tel quel », i.e. "Earlier .env
  format … left as is"). The built-in S3 services stay disabled. If you add
  `COMPOSE_PROFILES` by hand, also add `REVIEWDESK_S3=external`, otherwise
  `install.sh` refuses the configuration.
- Restoring a backup is not tooled by this archive; test it on a separate
  instance before relying on it.

## 9. Troubleshooting

The messages below are displayed by the software in French and are quoted
verbatim.

| Message | Cause and fix |
|---|---|
| `Configuration absente : lancez sh install.sh` ("Configuration missing: run sh install.sh") | `.env` is missing. |
| `bind source path does not exist: …/secrets/…` | a file in `secrets/` is missing: restore it from your backup. |
| `configuration partielle (incomplète)` ("partial (incomplete) configuration") | same (or `certs/`); `install.sh` never regenerates an isolated secret or certificate. |
| `le volume …_pgdata existe déjà` / `…_s3data existe déjà` ("the volume … already exists") | data exists: restore the original `.env`, `secrets/` and `certs/` instead of reinstalling. |
| `certs/ca.pem existe déjà` (install.sh) ("already exists") | file not generated by this script: move it away (new installation only). |
| `certs/s3.pem n'est pas valide pour le nom s3` ("is not valid for the name s3") | certificate expired, replaced or not coming from `certs/ca.pem`: restore `certs/` from the backup. |
| `ReviewDesk (S3 intégré) : …` (`s3-storage` logs) ("built-in S3") | secret or certificate missing/invalid, or `/data` / `s3socket` volume owned by someone else. |
| `ReviewDesk (passerelle S3) : …` (`s3` logs) ("S3 gateway") | `certs/s3.pem` or `secrets/s3_tls_key` missing or invalid: restore them from the backup. |
| `ReviewDesk (initialisation S3) : …` (`s3-init` logs) ("S3 initialization") | `s3` unreachable or initialization identity refused: check `secrets/s3_admin_*`. |
| `Le bucket S3 est lisible anonymement` ("The S3 bucket is anonymously readable") | remove the bucket's public access (external S3). |
| `Les objets du bucket S3 sont lisibles anonymement` ("The S3 bucket's objects are anonymously readable") | listing is refused but the objects are public: remove the public-read policy/ACL. |
| `Identifiants S3 refusés pour ce bucket` ("S3 credentials refused for this bucket") | wrong key or region, or missing `s3:ListBucket` permission (external S3). |
| `Écriture S3 refusée` / `L'objet de test … n'a pas pu être supprimé` ("S3 write refused" / "The test object … could not be deleted") | missing `s3:PutObject` / `s3:DeleteObject` permissions on the prefix; delete the named object by hand. |
| `Docker est introuvable` / `Docker ne répond pas` (install.sh) ("Docker not found" / "Docker is not responding") | first configuration: run the script where `docker volume ls` works. |
| `une autre installation est en cours` ("another installation is in progress") | an `install.sh` is already running; otherwise delete `.reviewdesk-install.lock`. |
| `Bucket S3 introuvable` ("S3 bucket not found") | create the bucket or fix `S3_BUCKET` / `S3_ENDPOINT` (external S3). |
| `REVIEWDESK_S3 manquant … COMPOSE_PROFILES est défini` ("REVIEWDESK_S3 missing … COMPOSE_PROFILES is set") | old-format `.env` edited by hand: add `REVIEWDESK_S3=external` (or remove `COMPOSE_PROFILES`). |
| `S3 injoignable en HTTPS (…)` ("S3 unreachable over HTTPS") | `s3` or `s3-storage` service stopped, DNS, outbound firewall, or missing certificate authority. |
| `password authentication failed` (postgres logs) | `secrets/postgres_password` no longer matches the existing volume: restore the old file. |
| `Cannot restart container …: no such file or directory` | container created from an old, deleted directory: `docker compose up -d --force-recreate` from the current directory. |
| Admin login refused over HTTP | expected: `Secure` cookies, use HTTPS (section 6). |

## 10. Known limitations

- Linux host with Docker Engine; Docker Desktop, Podman and rootless or
  `userns-remap` modes are not verified.
- Built-in S3: a single SeaweedFS instance, without replication; the durability
  of the screenshots is that of the host's disk and of your backups.
- Reverse proxy, domain name, public certificate and firewall remain your
  responsibility; no public proxy was tested.
- External S3: the privacy check is exercised end to end only against
  SeaweedFS; compatibility is not verified with real AWS S3, Cloudflare R2,
  Scaleway, Backblaze B2 or MinIO. IPv6 literal-address endpoints and temporary
  tokens (`S3_SESSION_TOKEN`) are not supported.
