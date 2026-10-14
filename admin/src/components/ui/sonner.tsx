import { useEffect, useState } from 'react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

type Theme = NonNullable<ToasterProps['theme']>;

/** Explicit data-theme on <html> wins; otherwise the OS preference decides. */
function readTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  const explicit = document.documentElement.getAttribute('data-theme');
  if (explicit === 'dark' || explicit === 'light') return explicit;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function Toaster(props: ToasterProps) {
  const [theme, setTheme] = useState<Theme>(readTheme);

  useEffect(() => {
    const update = () => setTheme(readTheme());
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', update);
    return () => {
      observer.disconnect();
      media.removeEventListener('change', update);
    };
  }, []);

  return (
    <Sonner
      theme={theme}
      position="bottom-right"
      richColors={false}
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
