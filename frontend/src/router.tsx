import { useMemo } from 'react';
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation, type RouteObject } from 'react-router';
import { useInstance } from './api/queries';
import type { InstanceKind } from './api/types';
import { useAuth } from './auth/AuthContext';
import { AppShell } from './components/layout/AppShell';
import { useI18n } from './i18n';
import { LoginPage } from './pages/Login';
import { RouteErrorPage } from './pages/RouteError';
import { SetupPage } from './pages/Setup';

function RequireAuth() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <Outlet />;
}

/**
 * Reads the public instance info once at startup. While no user exists (`needsSetup`) every route
 * leads to the first-run wizard; afterwards /setup is unreachable. If the call fails we fall back
 * to the normal login (never to the demo affordances).
 */
export function InstanceGate() {
  const instance = useInstance();
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  if (instance.isPending) return <PageLoader />;
  const needsSetup = instance.data?.needsSetup ?? false;
  const onSetup = location.pathname === '/setup';
  if (needsSetup && !onSetup) return <Navigate to="/setup" replace />;
  // Right after setup the new Owner is already signed in: straight to the overview.
  if (!needsSetup && onSetup) return <Navigate to={isAuthenticated ? '/' : '/login'} replace />;
  return <Outlet />;
}

// Pages are code-split; the shell, auth and login ship in the main chunk.
const payments = () => import('./pages/Payments').then((m) => ({ Component: m.PaymentsPage }));
const agent = () => import('./pages/Agent').then((m) => ({ Component: m.AgentPage }));

export function PageLoader() {
  const { t } = useI18n();
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg" role="status" aria-label={t('common.loading')}>
      <span className="size-8 animate-spin rounded-full border-2 border-border border-t-accent" />
    </div>
  );
}

const shellPages = [
  { index: true, lazy: () => import('./pages/Overview').then((m) => ({ Component: m.OverviewPage })) },
  { path: 'bills', lazy: () => import('./pages/Bills').then((m) => ({ Component: m.BillsPage })) },
  { path: 'approvals', lazy: () => import('./pages/Approvals').then((m) => ({ Component: m.ApprovalsPage })) },
  { path: 'payments', lazy: payments },
  { path: 'payments/:paymentId', lazy: payments },
  { path: 'treasury', lazy: () => import('./pages/Treasury').then((m) => ({ Component: m.TreasuryPage })) },
  { path: 'agent', lazy: agent },
  { path: 'agent/:runId', lazy: agent },
  { path: 'payees', lazy: () => import('./pages/Payees').then((m) => ({ Component: m.PayeesPage })) },
  { path: 'policies', lazy: () => import('./pages/Policies').then((m) => ({ Component: m.PoliciesPage })) },
  { path: 'audit', lazy: () => import('./pages/Audit').then((m) => ({ Component: m.AuditPage })) },
  { path: 'settings', lazy: () => import('./pages/Settings').then((m) => ({ Component: m.SettingsPage })) },
  { path: 'users', lazy: () => import('./pages/Users').then((m) => ({ Component: m.UsersPage })) },
  { path: '*', lazy: () => import('./pages/NotFound').then((m) => ({ Component: m.NotFoundPage })) },
];

/** Tenant (`<slug>.tesorero.gesco.ec`): first-run setup, login and the app shell. */
export const routes: RouteObject[] = [
  {
    element: <InstanceGate />,
    HydrateFallback: PageLoader,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/setup', element: <SetupPage /> },
      {
        element: <RequireAuth />,
        HydrateFallback: PageLoader,
        children: [
          {
            element: <AppShell />,
            children: [{ errorElement: <RouteErrorPage />, children: shellPages }],
          },
        ],
      },
    ],
  },
];

/**
 * Apex (`tesorero.gesco.ec`, ADR-0006): only the public landing and the email verification. The
 * app shell, login and setup never exist here; any other path goes back to the landing.
 */
export const landingRoutes: RouteObject[] = [
  {
    path: '/',
    HydrateFallback: PageLoader,
    lazy: () => import('./pages/Landing').then((m) => ({ Component: m.LandingPage })),
  },
  {
    path: '/verify',
    HydrateFallback: PageLoader,
    lazy: () => import('./pages/Verify').then((m) => ({ Component: m.VerifyPage })),
  },
  { path: '*', element: <Navigate to="/" replace /> },
];

export function routesFor(kind: InstanceKind): RouteObject[] {
  return kind === 'landing' ? landingRoutes : routes;
}

type RouterFactory = (routes: RouteObject[]) => ReturnType<typeof createBrowserRouter>;

/**
 * Picks the route tree from `GET /api/instance` before creating the router, so the landing never
 * downloads app chunks and a tenant never sees the landing. A failed lookup (or an older server
 * without `kind`) falls back to the tenant tree, whose gate shows the clean login.
 */
export function AppRouter({ createRouter = createBrowserRouter }: { createRouter?: RouterFactory }) {
  const instance = useInstance();
  const kind: InstanceKind | null = instance.isPending ? null : instance.data?.kind === 'landing' ? 'landing' : 'tenant';
  const router = useMemo(() => (kind ? createRouter(routesFor(kind)) : null), [kind, createRouter]);
  if (!router) return <PageLoader />;
  return <RouterProvider router={router} />;
}
