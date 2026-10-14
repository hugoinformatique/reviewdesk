import { FileDownIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CodeBlock } from '@/components/code-block';
import type { WidgetContext, WidgetPlatform } from './platforms';

/** Numbered steps, the download if any, and the code or link to copy. */
export function PlatformInstructions({ platform, ctx }: { platform: WidgetPlatform; ctx: WidgetContext }) {
  return (
    <div className="grid gap-3">
      <ol className="grid gap-2">
        {platform.steps.map((step, index) => (
          <li key={step} className="flex gap-2.5 text-[13.5px] leading-snug">
            <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold tabular-nums">
              {index + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      {platform.download && (
        <Button asChild variant="outline" className="w-fit">
          <a href={platform.download.href} download>
            <FileDownIcon aria-hidden="true" />
            {platform.download.label}
          </a>
        </Button>
      )}
      <CodeBlock code={platform.generate(ctx)} copyLabel={platform.isLink ? 'Copier le lien' : 'Copier la ligne'} />
    </div>
  );
}
