import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router';
import type { User } from '../api/types';
import { AuthProvider } from '../auth/AuthContext';
import { saveSession } from '../auth/storage';
import { ToastProvider } from '../components/ui/Toast';
import { I18nProvider, type Lang } from '../i18n';
import { ThemeProvider } from '../lib/theme';

export const USERS: Record<User['role'], User> = {
  Owner: { id: 'u-owner', email: 'owner@tesorero.demo', name: 'Olivia Owner', role: 'Owner' },
  Approver: { id: 'u-approver', email: 'approver@tesorero.demo', name: 'Andres Approver', role: 'Approver' },
  Auditor: { id: 'u-auditor', email: 'auditor@tesorero.demo', name: 'Ada Auditor', role: 'Auditor' },
};

export function signInAs(role: User['role']): void {
  saveSession({ token: `test-token-${role}`, user: USERS[role], expiresAt: null });
}

interface Options extends Omit<RenderOptions, 'wrapper'> {
  /** null: no initial language (stored choice → organization → browser, as in the app). */
  lang?: Lang | null;
  withAuth?: boolean;
}

export function createTestQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
}

/** Renders a component inside every app provider (no router). */
export function renderWithProviders(ui: ReactElement, { lang = 'en', withAuth = true, ...options }: Options = {}) {
  const client = createTestQueryClient();
  function Wrapper({ children }: { children: ReactNode }) {
    const inner = withAuth ? <AuthProvider>{children}</AuthProvider> : children;
    return (
      <QueryClientProvider client={client}>
        <ThemeProvider>
          <I18nProvider initialLang={lang ?? undefined}>
            <ToastProvider>{inner}</ToastProvider>
          </I18nProvider>
        </ThemeProvider>
      </QueryClientProvider>
    );
  }
  return { client, ...render(ui, { wrapper: Wrapper, ...options }) };
}

/** Renders routes with a memory router inside every provider. */
export function renderRoutes(routes: RouteObject[], initialPath: string, options: Options = {}) {
  const router = createMemoryRouter(routes, { initialEntries: [initialPath] });
  const result = renderWithProviders(<RouterProvider router={router} />, options);
  return { router, ...result };
}
