import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { Instance, LoginRequest } from '../api/types';
import { getToken, loadSession } from '../auth/storage';
import { InstanceGate } from '../router';
import { instanceHandler } from '../test/fixtures';
import { server } from '../test/server';
import { renderRoutes, USERS } from '../test/utils';
import { DEMO_PASSWORD, LoginPage } from './Login';

function setup(instance: Partial<Instance> | 'error' = { demo: true }) {
  const received: LoginRequest[] = [];
  server.use(
    instance === 'error' ? http.get('*/api/instance', () => new HttpResponse(null, { status: 500 })) : instanceHandler(instance),
    http.post('*/api/auth/login', async ({ request }) => {
      const body = (await request.json()) as LoginRequest;
      received.push(body);
      const user = Object.values(USERS).find((u) => u.email === body.email);
      if (!user || body.password !== DEMO_PASSWORD) {
        return HttpResponse.json({ title: 'Unauthorized', status: 401 }, { status: 401, headers: { 'Content-Type': 'application/problem+json' } });
      }
      return HttpResponse.json({ token: `jwt-${user.role}`, expiresAt: '2099-01-01T00:00:00Z', user });
    }),
    http.get('*/api/auth/me', ({ request }) => {
      const role = (request.headers.get('authorization') ?? '').replace('Bearer jwt-', '');
      const user = Object.values(USERS).find((u) => u.role === role);
      return user ? HttpResponse.json(user) : new HttpResponse(null, { status: 401 });
    }),
  );
  const view = renderRoutes(
    [
      {
        element: <InstanceGate />,
        children: [
          { path: '/login', element: <LoginPage /> },
          { path: '/setup', element: <p>Setup wizard</p> },
          { path: '/', element: <p>Home page</p> },
        ],
      },
    ],
    '/login',
  );
  return { received, ...view };
}

describe('Login demo buttons', () => {
  it('renders one demo button per seeded role on the demo instance', async () => {
    setup();
    expect(await screen.findByTestId('demo-login-owner')).toHaveTextContent('Owner');
    expect(screen.getByTestId('demo-login-approver')).toHaveTextContent('Approver');
    expect(screen.getByTestId('demo-login-auditor')).toHaveTextContent('Auditor');
  });

  it.each([
    ['approver', 'approver@tesorero.demo', 'Approver'],
    ['auditor', 'auditor@tesorero.demo', 'Auditor'],
  ] as const)('signs in as %s with the contract demo credentials and stores the JWT', async (id, email, role) => {
    const user = userEvent.setup();
    const { received, router } = setup();
    await user.click(await screen.findByTestId(`demo-login-${id}`));

    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(received).toEqual([{ email, password: 'Demo!2026' }]);
    expect(getToken()).toBe(`jwt-${role}`);
    expect(loadSession()?.user.role).toBe(role);
    expect(await screen.findByText('Home page')).toBeInTheDocument();
  });

  it('shows a clear error for wrong credentials', async () => {
    const user = userEvent.setup();
    setup();
    await user.type(await screen.findByTestId('login-email'), 'owner@tesorero.demo');
    await user.type(screen.getByTestId('login-password'), 'wrong');
    await user.click(screen.getByTestId('login-submit'));
    expect(await screen.findByTestId('login-error')).toHaveTextContent('Email or password is incorrect.');
    expect(getToken()).toBeNull();
  });

  it('validates empty fields client-side', async () => {
    const user = userEvent.setup();
    const { received } = setup();
    await user.click(await screen.findByTestId('login-submit'));
    expect(await screen.findByTestId('login-error')).toHaveTextContent('Enter your email and password.');
    expect(received).toHaveLength(0);
  });
});

describe('Login on a real (non-demo) instance', () => {
  it('shows a clean login without the demo accounts or demo hint', async () => {
    setup({ demo: false, organizationName: 'Acme Imports' });
    expect(await screen.findByTestId('login-email')).toBeInTheDocument();
    expect(screen.getByText('Sign in to Acme Imports with your email and password.')).toBeInTheDocument();
    expect(screen.queryByTestId('demo-login-owner')).not.toBeInTheDocument();
    expect(screen.queryByTestId('demo-login-approver')).not.toBeInTheDocument();
    expect(screen.queryByTestId('demo-login-auditor')).not.toBeInTheDocument();
    expect(screen.queryByText(/One-click demo accounts/)).not.toBeInTheDocument();
  });

  it('shows which organization and tenant the visitor is signing in to', async () => {
    setup({ demo: false, organizationName: 'Acme Imports', tenantSlug: 'acme' });
    const tenant = await screen.findByTestId('login-tenant');
    expect(tenant).toHaveTextContent('Tesorero · acme');
    expect(screen.getByTestId('login-org-name')).toHaveTextContent('Acme Imports');
  });

  it('does not show the tenant context on the demo', async () => {
    setup({ demo: true, organizationName: 'Demo Co', tenantSlug: 'demo' });
    expect(await screen.findByTestId('demo-login-owner')).toBeInTheDocument();
    expect(screen.queryByTestId('login-tenant')).not.toBeInTheDocument();
  });

  it('falls back to the clean login when the instance endpoint fails', async () => {
    setup('error');
    expect(await screen.findByTestId('login-email')).toBeInTheDocument();
    expect(screen.queryByTestId('demo-login-owner')).not.toBeInTheDocument();
  });

  it('sends a fresh instance to the first-run wizard instead of the login', async () => {
    const { router } = setup({ needsSetup: true, demo: false, organizationName: null });
    expect(await screen.findByText('Setup wizard')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/setup');
  });
});
