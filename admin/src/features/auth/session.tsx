/**
 * Session state: unknown while the cookie is checked, then in or out. A 401
 * from any request sends the app back to the login and drops cached data, so
 * nothing of the previous session lingers on screen.
 */
import { useQueryClient } from '@tanstack/react-query';
import { createContext, use, useEffect, useState, type ReactNode } from 'react';
import { api, onUnauthorized, setCsrfToken } from '@/lib/api';

type SessionState = 'checking' | 'in' | 'out';
type Session = {
  state: SessionState;
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [state, setState] = useState<SessionState>('checking');

  useEffect(() => {
    const stop = onUnauthorized(() => {
      setState('out');
      client.clear();
    });
    api<{ csrfToken: string }>('/api/auth/session')
      .then(({ csrfToken }) => {
        setCsrfToken(csrfToken);
        setState('in');
      })
      // Any failure at boot, network included, lands on the login.
      .catch(() => setState('out'));
    return () => void stop();
  }, [client]);

  const session: Session = {
    state,
    async login(password) {
      const { csrfToken } = await api<{ csrfToken: string }>('/api/auth/login', {
        method: 'POST',
        body: { username: 'admin', password },
      });
      setCsrfToken(csrfToken);
      client.clear();
      setState('in');
    },
    async logout() {
      try {
        await api('/api/auth/logout', { method: 'POST' });
      } finally {
        setCsrfToken('');
        client.clear();
        setState('out');
      }
    },
  };

  return <SessionContext value={session}>{children}</SessionContext>;
}

export function useSession() {
  const session = use(SessionContext);
  if (!session) throw new Error('useSession outside <SessionProvider>');
  return session;
}
