import { useState } from 'react';
import { Download, ExternalLink, ImageOff, Maximize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { isMobileViewport } from '@/lib/format';
import type { Ticket } from '@/lib/types';
import { safeHttpUrl } from './safe-url';

/** The capture is display only: no annotation exists in the admin. */
export function Screenshot({ ticket, onZoomChange }: { ticket: Ticket; onZoomChange: (open: boolean) => void }) {
  const [zoom, setZoom] = useState(false);
  const id = ticket.screenshotId;
  const mobile = isMobileViewport(ticket);
  const device = mobile ? 'mobile' : 'ordinateur';
  const size = `${ticket.anchor.viewport.width}×${ticket.anchor.viewport.height}`;
  const setOpen = (open: boolean) => {
    setZoom(open);
    onZoomChange(open);
  };

  if (!id) {
    return (
      <div className="flex items-center gap-2.5 rounded-lg border border-dashed border-border-strong px-3.5 py-3 text-[13px] text-muted-foreground">
        <ImageOff aria-hidden="true" className="size-4 shrink-0" />
        Aucune capture d'écran jointe à ce retour
      </div>
    );
  }
  const src = `/api/uploads/${id}`;
  const page = safeHttpUrl(ticket.pageUrl);
  return (
    <figure className="m-0 flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Agrandir la capture"
        className={cn(
          'group relative block overflow-hidden rounded-lg border border-border bg-sunken text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring',
          mobile ? 'w-48 max-w-full' : 'w-full max-w-xl',
        )}
      >
        <img src={src} alt={`Capture du retour : ${ticket.text.slice(0, 120)}`} loading="lazy" className="block max-h-60 w-full object-cover object-top" />
        <span className="absolute right-2 bottom-2 inline-flex size-7 items-center justify-center rounded-md bg-background/90 text-foreground opacity-0 shadow-1 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <Maximize2 aria-hidden="true" className="size-3.5" />
        </span>
      </button>
      <figcaption className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>
          Capture · {device} · {size}
        </span>
        <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setOpen(true)}>
          Agrandir
        </Button>
        <a href={src} target="_blank" rel="noreferrer" className="underline-offset-4 hover:text-foreground hover:underline">
          Voir la capture privée
        </a>
      </figcaption>

      <Dialog open={zoom} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-3 sm:max-w-4xl">
          <div className="min-w-0 pr-8">
            <DialogTitle className="line-clamp-2 leading-snug">{ticket.text}</DialogTitle>
            <DialogDescription className="mt-1 break-all">
              {ticket.projectName} · {mobile ? 'Mobile' : 'Desktop'} ({size}) · {page ?? ticket.pageUrl}
            </DialogDescription>
          </div>
          <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-sunken">
            <img src={src} alt={`Capture agrandie : ${ticket.text.slice(0, 120)}`} className="mx-auto block h-auto max-w-full" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <a href={src} target="_blank" rel="noreferrer">
                <ExternalLink />
                Ouvrir l'original
              </a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={src} download={`capture-${id}.webp`}>
                <Download />
                Télécharger
              </a>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </figure>
  );
}
