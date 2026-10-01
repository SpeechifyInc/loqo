import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import { Toaster } from 'sonner';
import { Layout } from './components/layout';
import { AppSkeleton } from './components/skeletons';
import { ApiError, UNAUTHORIZED_EVENT } from './lib/api';
import { ME_KEY, MeProvider, useMeQuery } from './lib/auth';
import { useCurrentProject } from './lib/current-project';
import { AnalysisPage } from './pages/analysis';
import { AuditPage } from './pages/audit';
import { AnalyticsPage } from './pages/cost';
import { LayersPage } from './pages/flow';
import { LoginPage } from './pages/login';
import { VaultPage } from './pages/project';
import { ProjectSettingsPage } from './pages/project/settings';
import { QueuePage } from './pages/queue';
import { ResourcePage } from './pages/resource';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 2000 } } });

const CurrentProjectRedirect = () => <Navigate to={`/projects/${useCurrentProject().project.slug}`} replace />;

const router = createBrowserRouter([
  {
    path: '/',
    Component: Layout,
    children: [
      { index: true, Component: CurrentProjectRedirect },
      { path: 'projects/:slug', Component: VaultPage },
      { path: 'projects/:slug/layers', Component: LayersPage },
      { path: 'projects/:slug/audit', Component: AuditPage },
      { path: 'projects/:slug/settings', Component: ProjectSettingsPage },
      { path: 'resources/:id', Component: ResourcePage },
      { path: 'queue', Component: QueuePage },
      { path: 'analysis', Component: AnalysisPage },
      { path: 'analytics', Component: AnalyticsPage },
      { path: 'login', Component: () => <Navigate to="/" replace /> },
    ],
  },
]);

/** The app renders only behind a session; a 401 anywhere drops back to the login page. */
const AuthGate = () => {
  const me = useMeQuery();
  useEffect(() => {
    const onUnauthorized = () => void queryClient.invalidateQueries({ queryKey: ME_KEY });
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);
  if (me.isPending) return <AppSkeleton />;
  if (!me.data) {
    if (me.error instanceof ApiError && me.error.status === 401) return <LoginPage />;
    return <div className="p-6 text-sm text-destructive">{me.error instanceof Error ? me.error.message : 'Could not reach the server'}</div>;
  }
  return (
    <MeProvider me={me.data}>
      <RouterProvider router={router} />
    </MeProvider>
  );
};

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthGate />
      <Toaster position="bottom-right" theme="system" />
    </QueryClientProvider>
  </StrictMode>,
);
