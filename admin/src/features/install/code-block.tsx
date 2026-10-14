/**
 * Copyable code block. Plain text in <pre><code> (tests read it back), a copy
 * button that confirms for 1.6 s. Inspired by 21st.dev "Code" (id 4228) and
 * "Code Block" (id 23586), adapted to the project tokens.
 */
import { useEffect, useRef, useState } from 'react';
import { CheckIcon, CopyIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

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
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error('Copie impossible : sélectionnez le texte et copiez-le à la main.');
    }
  }

  return (
    <figure className={cn('overflow-hidden rounded-lg border border-border bg-sunken', className)}>
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <figcaption className="truncate text-xs text-muted-foreground">{caption ?? 'À copier tel quel'}</figcaption>
        <Button type="button" variant="outline" size="sm" onClick={() => void copy()} aria-live="polite">
          {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
          {copied ? 'Copié' : copyLabel}
        </Button>
      </div>
      <pre className="code max-h-64 overflow-auto px-3.5 py-3 font-mono text-[12.5px] leading-relaxed break-all whitespace-pre-wrap text-foreground">
        <code>{code}</code>
      </pre>
    </figure>
  );
}
