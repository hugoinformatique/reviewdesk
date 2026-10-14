/** The six agent targets offered after the install (legacy FIX_TARGETS, minimal). */
export type AgentTarget = { id: string; name: string; mark: string; kind: 'cli' | 'chat' | 'api'; where: string };

export const AGENT_TARGETS: AgentTarget[] = [
  { id: 'claude-code', name: 'Claude Code', mark: 'claude', kind: 'cli', where: 'Dans un terminal, depuis le dépôt du site.' },
  { id: 'codex', name: 'Codex CLI', mark: 'openai', kind: 'cli', where: 'Dans un terminal, depuis le dépôt du site.' },
  { id: 'cursor', name: 'Cursor', mark: 'cursor', kind: 'chat', where: 'Dans le chat Agent de Cursor, projet ouvert.' },
  { id: 'vscode', name: 'VS Code', mark: 'vscode', kind: 'chat', where: 'Dans Copilot Chat en mode Agent.' },
  { id: 'claude-desktop', name: 'Claude Desktop', mark: 'claude', kind: 'chat', where: 'Dans une conversation Claude Desktop.' },
  { id: 'api', name: 'API HTTP', mark: 'plug', kind: 'api', where: 'Depuis un script, n8n ou votre propre agent.' },
];
