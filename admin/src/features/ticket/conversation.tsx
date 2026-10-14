import { useQuery } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { commentsQuery } from '@/lib/queries';
import { formatAge, formatDate } from '@/lib/format';
import { STATUS_LABELS, type Comment, type Ticket } from '@/lib/types';

const CLIENT_LABEL = 'Client (Reviewer)';

function Avatar({ label, tone }: { label: string; tone: 'client' | 'team' | 'agent' }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
        tone === 'client' && 'bg-brand-soft text-brand-text',
        tone === 'team' && 'bg-primary text-primary-foreground',
        tone === 'agent' && 'bg-st-review-soft text-st-review',
      )}
    >
      {label.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}

function Tag({ children, tone = 'plain' }: { children: string; tone?: 'plain' | 'shown' | 'internal' }) {
  return (
    <span
      className={cn(
        'rounded-md px-1.5 py-px text-[11px] font-medium',
        tone === 'plain' && 'bg-secondary text-subtle-foreground',
        tone === 'shown' && 'tag shown bg-st-done-soft text-st-done',
        tone === 'internal' && 'bg-st-progress-soft text-st-progress',
      )}
    >
      {children}
    </span>
  );
}

function Entry({ avatar, tone, author, at, tags, children, reviewer }: { avatar: string; tone: 'client' | 'team' | 'agent'; author: string; at: string; tags?: React.ReactNode; children?: React.ReactNode; reviewer?: boolean }) {
  return (
    <li className={cn('comment flex gap-3', reviewer && 'reviewer')}>
      <Avatar label={avatar} tone={tone} />
      <div className="min-w-0 flex-1">
        <div className="comment-meta flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="text-[13px] font-semibold text-foreground">{author}</span>
          <time dateTime={at} title={formatDate(at)}>
            {formatAge(at)}
          </time>
          {tags}
        </div>
        {children && <div className="mt-1 text-[13.5px] leading-relaxed break-words whitespace-pre-wrap text-foreground">{children}</div>}
      </div>
    </li>
  );
}

/** One thread for the whole ticket: client, team, agents and status changes. */
export function Conversation({ ticket }: { ticket: Ticket }) {
  const comments = useQuery(commentsQuery(ticket.id));
  const list = comments.data ?? [];
  // Only the latest reply the client can read is « Affiché au client ».
  const lastShown = list.findLastIndex((comment) => comment.visibility === 'reviewer' && comment.authorLabel !== CLIENT_LABEL);

  const tagsFor = (comment: Comment, index: number) => (
    <>
      {comment.authorLabel === CLIENT_LABEL ? (
        <Tag>Du client</Tag>
      ) : comment.visibility === 'reviewer' ? (
        index === lastShown ? <Tag tone="shown">Affiché au client</Tag> : <Tag>Envoyé au client</Tag>
      ) : (
        <Tag tone="internal">Interne</Tag>
      )}
      {comment.statusTo && comment.statusTo !== comment.statusFrom && (
        <span className="inline-flex items-center gap-1 rounded-md bg-sunken px-1.5 py-px text-[11px] font-medium text-subtle-foreground">
          {comment.statusFrom ? STATUS_LABELS[comment.statusFrom] : '—'}
          <ArrowRight aria-hidden="true" className="size-3" />
          {STATUS_LABELS[comment.statusTo]}
        </span>
      )}
    </>
  );

  return (
    <section aria-label="Conversation" className="flex flex-col gap-4">
      <h3 className="text-[13px] font-semibold tracking-tight">Conversation</h3>
      <ol className="m-0 flex list-none flex-col gap-4 p-0">
        <Entry avatar="C" tone="client" author="Retour reçu du client" at={ticket.createdAt} />
        {ticket.response.trim() && (
          <Entry avatar="É" tone="team" author="Note épinglée" at={ticket.createdAt} tags={<Tag tone="internal">Interne</Tag>}>
            {ticket.response}
          </Entry>
        )}
        {list.map((comment, index) => (
          <Entry
            key={comment.id}
            avatar={comment.authorLabel || (comment.author === 'agent' ? 'A' : 'É')}
            tone={comment.authorLabel === CLIENT_LABEL ? 'client' : comment.author === 'agent' ? 'agent' : 'team'}
            author={comment.authorLabel || (comment.author === 'agent' ? 'Agent' : 'Équipe')}
            at={comment.createdAt}
            tags={tagsFor(comment, index)}
            reviewer={comment.visibility === 'reviewer'}
          >
            {comment.body}
          </Entry>
        ))}
      </ol>
      {comments.isPending && (
        <div className="flex flex-col gap-3" aria-busy="true">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-4/5" />
        </div>
      )}
      {comments.isError && (
        <p role="alert" className="text-[13px] text-destructive">
          Échanges indisponibles.
        </p>
      )}
      {comments.isSuccess && list.length === 0 && (
        <p className="text-[13px] text-muted-foreground">Aucun échange pour l'instant. Répondez au client ou laissez un message à l'équipe.</p>
      )}
    </section>
  );
}
