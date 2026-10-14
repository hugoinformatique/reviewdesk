import { useEffect, useRef, useState } from 'react';
import { CheckIcon, CopyIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Copies `value()`; the label flips to « Copié » for 1,6 s, as in the legacy admin. */
export function CopyButton({ label, value, variant = 'outline' }: { label: string; value: string; variant?: 'outline' | 'ghost' | 'secondary' }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <Button
      type="button"
      variant={variant}
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 1600);
        } catch {
          toast.error('Copie refusée par le navigateur. Sélectionnez le texte.');
        }
      }}
    >
      {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
      <span aria-live="polite">{copied ? 'Copié' : label}</span>
    </Button>
  );
}

/** A pasteable block: monospaced text rendered as a React text node, never parsed. */
export function CodeBlock({ text, copyLabel, wrap = false }: { text: string; copyLabel: string; wrap?: boolean }) {
  return (
    <div className="overflow-hidden rounded-md border border-border bg-sunken">
      <pre className={cn('max-h-56 overflow-auto p-3 font-mono text-xs leading-relaxed text-foreground', wrap ? 'whitespace-pre-wrap' : 'whitespace-pre')} tabIndex={0}>
        <code>{text}</code>
      </pre>
      <div className="flex justify-end border-t border-border bg-card px-2 py-1.5">
        <CopyButton label={copyLabel} value={text} variant="ghost" />
      </div>
    </div>
  );
}
