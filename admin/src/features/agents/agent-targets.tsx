/**
 * Every client the wizard knows how to configure. `install` returns the block a
 * person pastes, and `where` says what to paste it into — the two questions
 * someone actually has when connecting a tool for the first time.
 */
import type { ComponentType, SVGProps } from 'react';
import { ClaudeLogo, CursorLogo, OpenAILogo, PlugLogo, VSCodeLogo } from './agent-logos';

export type InstallContext = { token: string; origin: string; server: string };

export type AgentTarget = {
  id: string;
  name: string;
  hint: string;
  Logo: ComponentType<SVGProps<SVGSVGElement>>;
  where: string;
  /** Short name shown by the guide and the fix dialog (sent as the agent label). */
  shortName: string;
  /** How the fix dialog hands the brief over: terminal command, chat prompt, or HTTP call. */
  kind: 'cli' | 'chat' | 'api';
  /** Where to run the fix command / paste the fix prompt. */
  fixWhere: string;
  install: (context: InstallContext) => string;
};

const mcpJson = (key: string) => (context: InstallContext) =>
  JSON.stringify(
    {
      [key]: {
        reviewdesk: {
          command: 'node',
          args: [context.server],
          env: { REVIEWDESK_URL: context.origin, REVIEWDESK_TOKEN: context.token },
        },
      },
    },
    null,
    2,
  );

export const AGENT_TARGETS: AgentTarget[] = [
  {
    id: 'claude-code',
    shortName: 'Claude Code',
    kind: 'cli',
    fixWhere: 'Dans un terminal, depuis le dépôt du site.',
    name: 'Claude Code',
    hint: 'CLI, une commande',
    Logo: ClaudeLogo,
    where: 'À lancer dans un terminal, depuis le dépôt de votre site.',
    install: ({ token, origin, server }) =>
      `claude mcp add reviewdesk \\\n  --env REVIEWDESK_URL=${origin} \\\n  --env REVIEWDESK_TOKEN=${token} \\\n  -- node ${server}`,
  },
  {
    id: 'codex',
    shortName: 'Codex CLI',
    kind: 'cli',
    fixWhere: 'Dans un terminal, depuis le dépôt du site.',
    name: 'Codex CLI',
    hint: '~/.codex/config.toml',
    Logo: OpenAILogo,
    where: 'À ajouter à la fin de ~/.codex/config.toml.',
    install: ({ token, origin, server }) =>
      `[mcp_servers.reviewdesk]\ncommand = "node"\nargs = ["${server}"]\nenv = { REVIEWDESK_URL = "${origin}", REVIEWDESK_TOKEN = "${token}" }`,
  },
  {
    id: 'cursor',
    shortName: 'Cursor',
    kind: 'chat',
    fixWhere: 'Dans le chat Agent de Cursor, projet ouvert.',
    name: 'Cursor',
    hint: '.cursor/mcp.json',
    Logo: CursorLogo,
    where: 'À créer à la racine du projet, dans .cursor/mcp.json.',
    install: mcpJson('mcpServers'),
  },
  {
    id: 'claude-desktop',
    shortName: 'Claude Desktop',
    kind: 'chat',
    fixWhere: 'Dans une conversation Claude Desktop.',
    name: 'Claude Desktop',
    hint: 'claude_desktop_config.json',
    Logo: ClaudeLogo,
    where: 'Réglages → Développeur → Modifier la configuration, puis redémarrer l’application.',
    install: mcpJson('mcpServers'),
  },
  {
    id: 'vscode',
    shortName: 'VS Code',
    kind: 'chat',
    fixWhere: 'Dans Copilot Chat en mode Agent.',
    name: 'VS Code',
    hint: '.vscode/mcp.json',
    Logo: VSCodeLogo,
    where: 'À créer à la racine du projet, dans .vscode/mcp.json.',
    install: mcpJson('servers'),
  },
  {
    id: 'api',
    shortName: 'API HTTP',
    kind: 'api',
    fixWhere: 'Depuis un script, n8n ou votre propre agent.',
    name: 'Autre outil',
    hint: 'API HTTP, script, n8n…',
    Logo: PlugLogo,
    where: 'N’importe quel client HTTP. Le jeton part en en-tête Authorization.',
    install: ({ token, origin }) =>
      `# Les retours à traiter\ncurl -H "Authorization: Bearer ${token}" \\\n  "${origin}/api/agent/tickets?status=TODO"\n\n` +
      `# Traiter un retour et rendre compte\ncurl -X PATCH "${origin}/api/agent/tickets/UUID" \\\n  -H "Authorization: Bearer ${token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"status":"DONE","comment":"Contraste corrigé.","visibility":"reviewer"}'`,
  },
];

/** The prompt someone pastes into the agent once it is connected. */
export const STARTER_PROMPT =
  'Tu es connecté à ReviewDesk (MCP). Liste les retours à traiter, ouvre-les un par un pour ' +
  'voir l’élément visé et la capture, corrige-les dans le code, puis passe chaque ticket à ' +
  '« À valider » en expliquant ce que tu as changé. Si la réponse intéresse le client, publie ' +
  'le commentaire en visibility "reviewer".';

export const SERVER_PATH_KEY = 'reviewdesk-mcp-path';
export const DEFAULT_SERVER_PATH = '/chemin/vers/reviewdesk/dist/mcp.js';

export function readServerPath(): string {
  try {
    return localStorage.getItem(SERVER_PATH_KEY) || DEFAULT_SERVER_PATH;
  } catch {
    return DEFAULT_SERVER_PATH;
  }
}

export function writeServerPath(value: string) {
  try {
    localStorage.setItem(SERVER_PATH_KEY, value.trim() || DEFAULT_SERVER_PATH);
  } catch {
    // Private mode: the value simply lasts for this dialog.
  }
}
