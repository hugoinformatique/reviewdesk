/**
 * Origins as removable chips. Adapted from 21st.dev "Tag Input" (id 23567,
 * Enter/duplicates/keyboard) and "Input with inner tags" (id 1285).
 * Whatever is pasted (URL with a path, bare domain) is reduced to its origin.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { XIcon } from 'lucide-react';
import { toOrigin } from '@/lib/format';
import { cn } from '@/lib/utils';

const SUGGESTIONS: { label: string; value: () => string }[] = [
  { label: 'Cette instance', value: () => location.origin },
  { label: 'localhost:3000', value: () => 'http://localhost:3000' },
  { label: 'localhost:5173', value: () => 'http://localhost:5173' },
];

/** commit() returns the resulting origins, or null when something typed was not an address. */
export type OriginsHandle = { commit: () => string[] | null };

export function OriginsInput({
  id,
  origins,
  onChange,
  error,
  onError,
  handleRef,
}: {
  id: string;
  origins: string[];
  onChange: (origins: string[]) => void;
  error: string;
  onError: (message: string) => void;
  handleRef: React.RefObject<OriginsHandle | null>;
}) {
  const [draft, setDraft] = useState('');
  const input = useRef<HTMLInputElement>(null);
  // Latest values for the deferred paste/blur commits.
  const live = useRef({ origins, draft });
  useLayoutEffect(() => {
    live.current = { origins, draft };
  });

  /** Adds what is typed, one address per line, comma or semicolon. */
  function commit(raw = live.current.draft): string[] | null {
    const parts = raw.split(/[\n,;]+/).map((part) => part.trim()).filter(Boolean);
    let next = live.current.origins;
    const rejected: string[] = [];
    for (const part of parts) {
      const origin = toOrigin(part);
      if (!origin) rejected.push(part);
      else if (!next.includes(origin)) next = [...next, origin];
    }
    if (next !== live.current.origins) onChange(next);
    live.current = { origins: next, draft: rejected.join(' ') };
    setDraft(rejected.join(' '));
    const last = rejected[rejected.length - 1];
    onError(last ? `« ${last} » n’est pas une adresse web. Exemple : https://preprod.client.fr` : '');
    return rejected.length === 0 ? next : null;
  }
  useLayoutEffect(() => {
    handleRef.current = { commit: () => commit() };
  });

  function add(value: string) {
    if (!origins.includes(value)) onChange([...origins, value]);
    onError('');
    input.current?.focus();
  }

  return (
    <div className="grid gap-2">
      <div
        className={cn(
          'flex min-h-[34px] w-full flex-wrap items-center gap-1.5 rounded-md border bg-background px-2 py-1.5 shadow-1 transition-[box-shadow,border-color] duration-150 focus-within:border-border-strong focus-within:ring-[3px] focus-within:ring-ring',
          error ? 'border-destructive' : 'border-input',
        )}
        onClick={(event) => event.target === event.currentTarget && input.current?.focus()}
      >
        <ul className="contents" aria-label="Adresses autorisées">
          {origins.map((origin) => (
            <li
              key={origin}
              className="flex items-center gap-1 rounded-md bg-secondary py-0.5 pr-0.5 pl-2 font-mono text-xs animate-in-fade"
            >
              <span>{origin}</span>
              <button
                type="button"
                aria-label={`Retirer ${origin}`}
                onClick={() => {
                  onChange(origins.filter((candidate) => candidate !== origin));
                  input.current?.focus();
                }}
                className="inline-flex size-5 cursor-pointer items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <XIcon className="size-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        <input
          ref={input}
          id={id}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ',') {
              event.preventDefault();
              commit();
            } else if (event.key === 'Backspace' && !draft && origins.length) {
              onChange(origins.slice(0, -1));
            }
          }}
          onPaste={() => setTimeout(() => commit(input.current?.value ?? ''))}
          onBlur={() => draft.trim() && commit()}
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder={origins.length ? '' : 'https://preprod.client.fr'}
          aria-label="Adresses où le widget sera installé (origines autorisées)"
          aria-describedby={`${id}-hint`}
          aria-invalid={Boolean(error) || undefined}
          className="min-w-40 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-muted-foreground"
        />
      </div>
      <p role="alert" className="text-[13px] text-destructive empty:hidden">
        {error}
      </p>
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        Collez l’adresse du site, avec ou sans chemin, puis <kbd className="rounded border border-border px-1 font-sans">Entrée</kbd>. Seules ces
        adresses pourront envoyer des retours.
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted-foreground">Suggestions</span>
        {SUGGESTIONS.filter((suggestion) => !origins.includes(suggestion.value())).map((suggestion) => (
          <button
            key={suggestion.label}
            type="button"
            onClick={() => add(suggestion.value())}
            className="cursor-pointer rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground transition-colors outline-none hover:border-border-strong hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            {suggestion.label}
          </button>
        ))}
      </div>
    </div>
  );
}
