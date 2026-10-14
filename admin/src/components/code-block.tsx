/**
 * Copyable code block. Plain text in <pre><code> (never parsed), a copy button
 * that confirms for 1.6 s. Inspired by 21st.dev "Code" (id 4228) and
 * "Code Block" (id 23586), adapted to the project tokens.
 */
import { CheckIcon, CopyIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useCopy } from '@/lib/clipboard';
import { cn } from '@/lib/utils';

const REFUSED = 'Copie impossible : sélectionnez le texte et copiez-le à la main.';

/** Copies `value`; the label flips to « Copié » for 1,6 s. */
export function CopyButton({ label, value, variant = 'outline' }: { label: string; value: string; variant?: 'outline' | 'ghost' | 'secondary' }) {
  const { copied, copy } = useCopy();
  return (
    <Button
      type="button"
      variant={variant}
      size="sm"
      onClick={async () => {
        if (!(await copy(value))) toast.error(REFUSED);
      }}
    >
      {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
      <span aria-live="polite">{copied ? 'Copié' : label}</span>
    </Button>
  );
}

export function CodeBlock({
  code,
  copyLabel = 'Copier la ligne',
  caption,
  className,
}: {
  code: string;
  copyLabel?: string;
  caption?: string;
  className?: string;
}) {
  return (
    <figure className={cn('overflow-hidden rounded-lg border border-border bg-sunken', className)}>
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <figcaption className="truncate text-xs text-muted-foreground">{caption ?? 'À copier tel quel'}</figcaption>
        <CopyButton label={copyLabel} value={code} />
      </div>
      <pre className="code max-h-64 overflow-auto px-3.5 py-3 font-mono text-[12.5px] leading-relaxed break-all whitespace-pre-wrap text-foreground" tabIndex={0}>
        <code>{code}</code>
      </pre>
    </figure>
  );
}
