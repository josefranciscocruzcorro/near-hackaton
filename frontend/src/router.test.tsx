import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter, type RouteObject } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { Instance, VerifySignupResponse } from './api/types';
import { AppRouter } from './router';
import { instanceHandler, landingInstanceHandler } from './test/fixtures';
import { server } from './test/server';
import { renderWithProviders } from './test/utils';

function renderApp(path: string) {
  let router: ReturnType<typeof createMemoryRouter> | null = null;
  const createRouter = (routes: RouteObject[]) => {
    router = createMemoryRouter(routes, { initialEntries: [path] });
    return router;
  };
  const view = renderWithProviders(<AppRouter createRouter={createRouter} />);
  return {
    ...view,
    pathname: () => router?.state.location.pathname,
  };
}

describe('routing by instance kind', () => {
  it('renders the public landing on the apex domain', async () => {
    server.use(landingInstanceHandler());
    renderApp('/');
    expect(await screen.findByTestId('landing-hero')).toBeInTheDocument();
    expect(screen.queryByTestId('login-email')).not.toBeInTheDocument();
  });

  it.each(['/login', '/setup', '/payments', '/anything'])('sends %s back to the landing on the apex domain', async (path) => {
    server.use(landingInstanceHandler());
    const { pathname } = renderApp(path);
    expect(await screen.findByTestId('landing-hero')).toBeInTheDocument();
    expect(pathname()).toBe('/');
  });

  it('serves /verify on the apex domain', async () => {
    server.use(
      landingInstanceHandler(),
      http.post('*/api/signup/verify', () =>
        HttpResponse.json<VerifySignupResponse>({
          organizationName: 'Acme',
          slug: 'acme',
          tenantUrl: 'https://acme.tesorero.gesco.ec',
          email: 'a@acme.example',
        }),
      ),
    );
    renderApp('/verify?token=t1');
    expect(await screen.findByTestId('verify-success')).toBeInTheDocument();
  });

  it('keeps the tenant behaviour: login when signed out, never the landing', async () => {
    server.use(instanceHandler());
    const { pathname } = renderApp('/');
    expect(await screen.findByTestId('login-email')).toBeInTheDocument();
    expect(pathname()).toBe('/login');
    expect(screen.queryByTestId('landing-hero')).not.toBeInTheDocument();
  });

  it('keeps the tenant first-run setup', async () => {
    server.use(instanceHandler({ needsSetup: true, organizationName: 'Acme Imports' }));
    const { pathname } = renderApp('/verify');
    expect(await screen.findByTestId('setup-form')).toBeInTheDocument();
    expect(pathname()).toBe('/setup');
  });

  it('falls back to the tenant login when the instance lookup fails', async () => {
    server.use(http.get('*/api/instance', () => new HttpResponse(null, { status: 500 })));
    const { pathname } = renderApp('/');
    expect(await screen.findByTestId('login-email')).toBeInTheDocument();
    await waitFor(() => expect(pathname()).toBe('/login'));
  });

  it('treats a server without `kind` as a tenant', async () => {
    server.use(
      http.get('*/api/instance', () =>
        HttpResponse.json({ demo: true, needsSetup: false, organizationName: null, setupTokenRequired: false } as Partial<Instance>),
      ),
    );
    renderApp('/login');
    expect(await screen.findByTestId('demo-login-owner')).toBeInTheDocument();
  });
});
