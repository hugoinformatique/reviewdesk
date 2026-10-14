import type { ReactNode } from 'react';
import { formatAge, formatDate, isMobileViewport } from '@/lib/format';
import type { Ticket } from '@/lib/types';
import { safeHttpUrl } from './safe-url';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2 py-1.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="m-0 min-w-0 text-[13px] break-words text-foreground">{children}</dd>
    </div>
  );
}

const informative = (value: unknown) => value !== 'Unknown' && value !== null && value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0);

/** Facts about the page and the reviewer's screen, plus the folded technical details. */
export function InfoRail({ ticket }: { ticket: Ticket }) {
  const { browser, os } = ticket.diagnostics;
  const href = safeHttpUrl(ticket.pageUrl);
  const mobile = isMobileViewport(ticket);
  const entries = Object.entries(ticket.diagnostics).filter(([, value]) => informative(value));
  const { selector, relative, viewport } = ticket.anchor;
  return (
    <div className="flex flex-col gap-5">
      <section>
        <h3 className="mb-1 text-[13px] font-semibold tracking-tight">Informations</h3>
        <dl className="m-0 divide-y divide-border">
          <Row label="Page">
            {href ? (
              <a href={href} target="_blank" rel="noreferrer" className="underline decoration-border-strong underline-offset-4 hover:decoration-foreground">
                {ticket.pageUrl}
              </a>
            ) : (
              ticket.pageUrl
            )}
          </Row>
          <Row label="Écran">
            {viewport.width}×{viewport.height} ({mobile ? 'mobile' : 'ordinateur'})
          </Row>
          {typeof browser === 'string' && browser !== 'Unknown' && <Row label="Navigateur">{browser}</Row>}
          {typeof os === 'string' && os !== 'Unknown' && <Row label="Système">{os}</Row>}
          <Row label="Reçu">
            <time dateTime={ticket.createdAt} title={formatDate(ticket.createdAt)}>
              {formatDate(ticket.createdAt)} ({formatAge(ticket.createdAt)})
            </time>
          </Row>
          <Row label="Projet">
            {ticket.projectName} <span className="text-muted-foreground">· {ticket.clientLabel}</span>
          </Row>
          {ticket.fixRequestedAt && <Row label="Agent IA">{ticket.fixRequestedFor || 'Agent'}</Row>}
        </dl>
      </section>

      <details className="group rounded-lg border border-border bg-card">
        <summary className="cursor-pointer list-none rounded-lg px-3 py-2 text-[13px] font-semibold tracking-tight outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring">
          Détails techniques
        </summary>
        <div className="flex flex-col gap-3 border-t border-border px-3 py-3">
          <p className="font-mono text-xs break-all text-subtle-foreground">
            {selector} @ {Math.round(relative.x * 100)}%, {Math.round(relative.y * 100)}%
          </p>
          {entries.length === 0 ? (
            <p className="text-xs text-muted-foreground">Aucun diagnostic transmis. Le reviewer ne les a pas joints.</p>
          ) : (
            <dl className="m-0 flex flex-col gap-1.5">
              {entries.map(([key, value]) => (
                <div key={key} className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2 text-xs">
                  <dt className="text-muted-foreground">{key}</dt>
                  <dd className="m-0 font-mono break-all">{typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </details>
    </div>
  );
}
