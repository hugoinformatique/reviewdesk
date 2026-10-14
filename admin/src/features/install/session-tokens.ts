/**
 * Reviewer tokens minted during this browser session, per project. A token is
 * shown only once by the server, so this is the only place it can be found
 * again: never shared between projects (legacy bug: project B reused A's).
 */
export type KnownToken = { id: string; token: string };

const tokens = new Map<string, KnownToken>();

export function rememberToken(projectId: string, link: KnownToken) {
  tokens.set(projectId, { id: link.id, token: link.token });
}

export function knownToken(projectId: string): KnownToken | undefined {
  return tokens.get(projectId);
}

export function forgetToken(projectId: string, linkId?: string) {
  if (!linkId || tokens.get(projectId)?.id === linkId) tokens.delete(projectId);
}
