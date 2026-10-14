import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Send, StickyNote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { keys, useAddComment } from '@/lib/queries';
import type { Ticket } from '@/lib/types';

type Mode = 'reviewer' | 'internal';

const COPY: Record<Mode, { label: string; button: string; hint: string; placeholder: string; done: string }> = {
  reviewer: {
    label: 'Réponse au client',
    button: 'Envoyer au client',
    hint: 'Le client lit cette réponse dans le widget.',
    placeholder: 'Écrivez votre réponse au client…',
    done: 'Réponse envoyée au client.',
  },
  internal: {
    label: 'Note pour l’équipe',
    button: 'Ajouter la note',
    hint: 'Visible par l’équipe et les agents, jamais par le client.',
    placeholder: 'Laissez une note pour l’équipe…',
    done: 'Note ajoutée.',
  },
};

const isApple = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** The only composer: one field, two audiences. */
export function Composer({ ticket, onSent }: { ticket: Ticket; onSent: () => void }) {
  const [mode, setMode] = useState<Mode>('reviewer');
  const [drafts, setDrafts] = useState<Record<Mode, string>>({ reviewer: '', internal: '' });
  const add = useAddComment();
  const client = useQueryClient();
  const text = drafts[mode];
  const copy = COPY[mode];

  const send = async () => {
    const body = text.trim();
    if (!body || add.isPending) return;
    try {
      await add.mutateAsync({ ticketId: ticket.id, body, visibility: mode });
    } catch {
      toast.error('Envoi impossible.');
      return;
    }
    setDrafts((state) => ({ ...state, [mode]: '' }));
    onSent();
    try {
      await client.refetchQueries({ queryKey: keys.tickets, type: 'active' }, { throwOnError: true, cancelRefetch: false });
      toast.success(copy.done);
    } catch {
      toast.error(`${copy.done.slice(0, -1)}, mais actualisation indisponible.`);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
      className="flex flex-col gap-2 rounded-xl border border-border-strong bg-card p-2.5 shadow-2"
    >
      <div role="group" aria-label="Destinataire" className="flex gap-1 self-start rounded-lg bg-secondary p-0.5">
        {(['reviewer', 'internal'] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() => setMode(value)}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium text-muted-foreground outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring [&_svg]:size-3.5',
              mode === value && 'bg-background text-foreground shadow-1',
            )}
          >
            {value === 'reviewer' ? <Send aria-hidden="true" /> : <StickyNote aria-hidden="true" />}
            {value === 'reviewer' ? 'Répondre au client' : 'Note interne'}
          </button>
        ))}
      </div>
      <Textarea
        aria-label={copy.label}
        value={text}
        maxLength={4000}
        rows={3}
        placeholder={copy.placeholder}
        onChange={(event) => setDrafts((state) => ({ ...state, [mode]: event.target.value }))}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void send();
          }
        }}
        className="min-h-[4.5rem] resize-none border-0 bg-transparent px-1.5 shadow-none focus-visible:ring-0"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{copy.hint}</p>
        <div className="flex items-center gap-2">
          <Kbd className="hidden sm:inline-flex">{isApple ? '⌘↵' : 'Ctrl ↵'}</Kbd>
          <Button type="submit" size="sm" disabled={add.isPending || !text.trim()}>
            {copy.button}
          </Button>
        </div>
      </div>
    </form>
  );
}
