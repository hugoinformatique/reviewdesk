# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Use GitHub's private reporting instead: **Security › Report a vulnerability** on
this repository. Describe the affected version, the steps to reproduce and the
impact you observed. You will get an answer in the same thread.

## Supported versions

Only the latest release receives security fixes. Self-hosted instances should
follow the [releases](https://github.com/hugoinformatique/reviewdesk/releases)
and update.

## Scope

In scope: the server (`src/`), the widget, the admin, the MCP server, the
Docker and local kits, and the WordPress extension.

Out of scope: an instance's own infrastructure (reverse proxy, TLS, host
hardening, backups) and anything that requires an already compromised admin
password or agent token.

---

*Français : signalez toute faille en privé via **Security › Report a
vulnerability**, jamais dans une issue publique.*
