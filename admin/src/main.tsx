import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiError } from '@/lib/api';
import { SessionProvider, useSession } from '@/features/auth/session';
import { LoginPage } from '@/features/auth/login-page';
import { BrandingProvider } from '@/features/branding/branding-provider';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { router } from './router';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      // A 4xx will not fix itself by asking again.
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
    },
  },
});

function App() {
  const { state } = useSession();
  if (state === 'checking') return null;
  if (state === 'out') return <LoginPage />;
  return <RouterProvider router={router} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrandingProvider>
        <SessionProvider>
          <TooltipProvider delayDuration={300}>
            <App />
            <Toaster />
          </TooltipProvider>
        </SessionProvider>
      </BrandingProvider>
    </QueryClientProvider>
  </StrictMode>,
);
