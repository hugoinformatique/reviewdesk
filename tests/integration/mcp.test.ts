import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { anchor, createProject, createReviewLink, createTestApp, loginAdmin } from '../helpers/harness.js';

/**
 * The MCP server is the surface an AI agent actually speaks to, so it is
 * exercised the way an agent does: a real child process, real JSON-RPC over
 * stdio, against a real ReviewDesk listening on a loopback port.
 */
type JsonRpcResponse = { id?: number; result?: Record<string, unknown>; error?: { message: string } };

class McpClient {
  private child: ChildProcessWithoutNullStreams;
  private buffer = '';
  private pending = new Map<number, (message: JsonRpcResponse) => void>();
  private nextId = 1;

  constructor(env: Record<string, string>) {
    this.child = spawn(process.execPath, ['--import', 'tsx', 'src/mcp/server.ts'], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => {
      this.buffer += chunk;
      let newline = this.buffer.indexOf('\n');
      while (newline !== -1) {
        const line = this.buffer.slice(0, newline).trim();
        this.buffer = this.buffer.slice(newline + 1);
        if (line) {
          const message = JSON.parse(line) as JsonRpcResponse;
          if (message.id !== undefined) this.pending.get(message.id)?.(message);
        }
        newline = this.buffer.indexOf('\n');
      }
    });
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 15_000);
      this.pending.set(id, (message) => {
        clearTimeout(timer);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result ?? {});
      });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  notify(method: string, params: Record<string, unknown> = {}): void {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  async close(): Promise<void> {
    this.child.kill();
    await once(this.child, 'exit');
  }
}

const toolText = (result: Record<string, unknown>): string =>
  (result.content as { type: string; text?: string }[]).map((part) => part.text ?? '').join('\n');

test('a coding agent drives ReviewDesk through MCP: read the backlog, comment, close the ticket', async (t) => {
  const app = await createTestApp(t);
  const auth = await loginAdmin(app);
  const project = await createProject(app, auth, {
    name: 'DEMO Atelier',
    clientLabel: 'DEMO Client A',
    origins: ['https://preview.client-a.test'],
  });
  const link = await createReviewLink(app, auth, project.id);
  const filed = await app.inject({
    method: 'POST',
    url: '/api/feedback',
    headers: { authorization: `Bearer ${link.token}`, origin: 'https://preview.client-a.test' },
    payload: {
      projectId: project.id,
      text: 'Le bouton du hero est illisible sur mobile',
      pageUrl: 'https://preview.client-a.test/',
      anchor,
    },
  });
  const ticketId = filed.json().id as string;
  const minted = await app.inject({
    method: 'POST',
    url: '/api/agent-tokens',
    headers: auth.write,
    payload: { label: 'Claude Code' },
  });
  const token = minted.json().token as string;

  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as AddressInfo;

  const client = new McpClient({ REVIEWDESK_URL: `http://127.0.0.1:${port}`, REVIEWDESK_TOKEN: token });
  t.after(() => client.close());

  const initialized = await client.send('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'reviewdesk-test', version: '0' },
  });
  assert.equal((initialized.serverInfo as { name: string }).name, 'reviewdesk');
  client.notify('notifications/initialized');

  const tools = (await client.send('tools/list')).tools as { name: string }[];
  assert.deepEqual(
    tools.map((tool) => tool.name).sort(),
    ['comment_ticket', 'get_screenshot', 'get_ticket', 'list_projects', 'list_tickets', 'next_fix_request', 'update_ticket'],
  );

  // An empty queue says so; a queued ticket comes back with its full brief.
  const idle = toolText(await client.send('tools/call', { name: 'next_fix_request', arguments: {} }));
  assert.ok(idle.includes('Aucune correction demandée'), idle);
  await app.inject({ method: 'POST', url: `/api/tickets/${ticketId}/fix-request`, headers: auth.write, payload: { agent: 'Claude Code' } });
  const queued = toolText(await client.send('tools/call', { name: 'next_fix_request', arguments: {} }));
  assert.ok(queued.includes(ticketId), queued);
  assert.ok(queued.includes('Correction demandée par l\'équipe : oui'), queued);

  const listed = await client.send('tools/call', { name: 'list_tickets', arguments: { status: 'IN_PROGRESS' } });
  const listedText = toolText(listed);
  assert.ok(listedText.includes(ticketId), listedText);
  assert.ok(listedText.includes('illisible sur mobile'), listedText);

  const detail = toolText(await client.send('tools/call', { name: 'get_ticket', arguments: { ticketId } }));
  assert.ok(detail.includes(anchor.selector), detail);
  assert.ok(detail.includes('390×844'), detail);

  const done = await client.send('tools/call', {
    name: 'update_ticket',
    arguments: {
      ticketId,
      status: 'DONE',
      comment: 'Contraste du CTA porté à 5.2:1.',
      visibility: 'reviewer',
    },
  });
  assert.ok(toolText(done).includes('traité'), toolText(done));

  // What the agent claims must be true in the product, not only in its answer.
  const ticket = await app.inject({ method: 'GET', url: `/api/tickets?status=DONE`, headers: auth.read });
  assert.equal(ticket.json().tickets[0].id, ticketId);
  assert.equal(ticket.json().tickets[0].replyText, 'Contraste du CTA porté à 5.2:1.');
  const comments = await app.inject({ method: 'GET', url: `/api/tickets/${ticketId}/comments`, headers: auth.read });
  assert.equal(comments.json().comments.at(-1).author, 'agent');
  assert.equal(comments.json().comments.at(-1).authorLabel, 'Claude Code');
  assert.equal(comments.json().comments.at(-1).statusTo, 'DONE');

  // A revoked token stops the agent dead, with a message it can act on.
  const tokens = await app.inject({ method: 'GET', url: '/api/agent-tokens', headers: auth.read });
  const tokenId = (tokens.json().tokens as { id: string }[])[0]!.id;
  await app.inject({ method: 'POST', url: `/api/agent-tokens/${tokenId}/revoke`, headers: auth.write });
  const refused = await client.send('tools/call', { name: 'list_tickets', arguments: {} });
  assert.equal(refused.isError, true);
  assert.ok(toolText(refused).includes('révoqué'), toolText(refused));
});
