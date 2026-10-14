import { useCallback, useEffect, useRef, useState } from 'react';

/** Writes to the clipboard; false when the browser refuses (insecure origin, permission). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Copy helper whose `copied` flag stays true for 1,6 s after a successful copy. */
export function useCopy(duration = 1600) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = useCallback(
    async (text: string) => {
      const ok = await copyText(text);
      if (ok) {
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), duration);
      }
      return ok;
    },
    [duration],
  );
  return { copied, copy };
}
