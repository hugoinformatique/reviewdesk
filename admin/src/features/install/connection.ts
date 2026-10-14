import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { reviewLinksQuery } from '@/lib/queries';
import type { ReviewLink } from '@/lib/types';

/** The link whose first use proves the widget is live: ours if known, else any used active one. */
export function connectedLink(links: ReviewLink[] | undefined, tokenId?: string) {
  if (!links) return undefined;
  const mine = tokenId ? links.find((link) => link.id === tokenId) : links.find((link) => !link.revokedAt && link.lastUsedAt);
  return mine?.lastUsedAt ? mine : undefined;
}

/**
 * Polls the project's review links until the widget calls in: first refetch
 * after 1.5 s, then every 2.5 s. `giveUpMs` stops the polling (wizard: 120 s).
 * Timers die with the component.
 */
export function useWidgetConnection(projectId: string, tokenId: string | undefined, giveUpMs?: number) {
  const ticks = useRef(0);
  const [gaveUp, setGaveUp] = useState(false);
  const link$ = useQuery({
    ...reviewLinksQuery(projectId),
    refetchInterval: (query) => {
      if (gaveUp || connectedLink(query.state.data, tokenId)) return false;
      ticks.current += 1;
      return ticks.current === 1 ? 1500 : 2500;
    },
  });
  const link = connectedLink(link$.data, tokenId);
  useEffect(() => {
    if (giveUpMs === undefined || link) return;
    const timer = setTimeout(() => setGaveUp(true), giveUpMs);
    return () => clearTimeout(timer);
  }, [giveUpMs, link]);
  return { link, connected: Boolean(link), gaveUp: gaveUp && !link };
}
