import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { queryKeys } from '../api/queries';
import type { Instance, LoginResponse, SetupRequest } from '../api/types';
import { getToken, loadSession } from '../auth/storage';
import { InstanceGate } from '../router';
import { instanceHandler, problem } from '../test/fixtures';
import { server } from '../test/server';
import { renderRoutes } from '../test/utils';
import { SetupPage } from './Setup';

const OWNER = { id: 'u-1', email: 'ana@acme.example', name: 'Ana Pérez', role: 'Owner' as const };
const STRONG = 'correct-Horse-battery-9';

function setup(instance: Partial<Instance> = { needsSetup: true, organizationName: null }, initial = '/setup') {
  const received: SetupRequest[] = [];
  server.use(
    instanceHandler(instance),
    http.post('*/api/setup', async ({ request }) => {
      const body = (await request.json()) as SetupRequest;
      received.push(body);
      return HttpResponse.json<LoginResponse>({ token: 'jwt-setup', expiresAt: '2099-01-01T00:00:00Z', user: { ...OWNER, name: body.ownerName, email: body.email } }, { status: 201 });
    }),
    http.get('*/api/auth/me', () => HttpResponse.json(OWNER)),
  );
  const view = renderRoutes(
    [
      {
        element: <InstanceGate />,
        children: [
          { path: '/setup', element: <SetupPage /> },
          { path: '/login', element: <p>Login page</p> },
          { path: '/', element: <p>Home page</p> },
        ],
      },
    ],
    initial,
  );
  return { received, ...view };
}

async function fill(user: ReturnType<typeof userEvent.setup>, password = STRONG, confirm = password) {
  await user.type(await screen.findByTestId('setup-org'), 'Acme Imports');
  await user.type(screen.getByTestId('setup-name'), 'Ana Pérez');
  await user.type(screen.getByTestId('setup-email'), 'ana@acme.example');
  await user.type(screen.getByTestId('setup-password'), password);
  await user.type(screen.getByTestId('setup-confirm'), confirm);
}

describe('first-run setup', () => {
  it('redirects every route to /setup while the instance has no users', async () => {
    const { router } = setup(undefined, '/login');
    expect(await screen.findByTestId('setup-form')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/setup');
  });

  it('redirects /setup to /login once the instance is set up', async () => {
    const { router } = setup({ needsSetup: false }, '/setup');
    expect(await screen.findByText('Login page')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('validates required fields, the 12-character minimum and the confirmation', async () => {
    const user = userEvent.setup();
    const { received } = setup();
    await fill(user, 'short-pw', 'different');
    await user.click(screen.getByTestId('setup-submit'));
    expect(await screen.findByText('Use at least 12 characters.')).toBeInTheDocument();
    expect(screen.getByText('The passwords do not match.')).toBeInTheDocument();
    expect(screen.getByTestId('setup-password')).toHaveAttribute('aria-invalid', 'true');
    expect(received).toHaveLength(0);
  });

  it('shows a live strength hint for the new password', async () => {
    const user = userEvent.setup();
    setup();
    const strength = await screen.findByTestId('setup-password-strength');
    expect(strength).toHaveTextContent('At least 12 characters');
    await user.type(screen.getByTestId('setup-password'), 'abc');
    expect(strength).toHaveAttribute('data-strength', 'tooShort');
    await user.clear(screen.getByTestId('setup-password'));
    await user.type(screen.getByTestId('setup-password'), STRONG);
    expect(strength).toHaveAttribute('data-strength', 'strong');
  });

  it('creates the first Owner, stores the session and lands on the overview', async () => {
    const user = userEvent.setup();
    const { received, router, client } = setup();
    await fill(user);
    await user.click(screen.getByTestId('setup-submit'));

    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(await screen.findByText('Home page')).toBeInTheDocument();
    expect(received).toEqual([{ organizationName: 'Acme Imports', ownerName: 'Ana Pérez', email: 'ana@acme.example', password: STRONG, setupToken: null }]);
    expect(getToken()).toBe('jwt-setup');
    expect(loadSession()?.user.role).toBe('Owner');
    expect(client.getQueryData<Instance>(queryKeys.instance)?.needsSetup).toBe(false);
  });

  it('takes the one-time setup code from the link and sends it with the request', async () => {
    const user = userEvent.setup();
    const { received } = setup({ needsSetup: true, organizationName: null, setupTokenRequired: true }, '/setup?token=abc123XYZ');
    expect(await screen.findByTestId('setup-token')).toHaveValue('abc123XYZ');
    await fill(user);
    await user.click(screen.getByTestId('setup-submit'));
    await waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]?.setupToken).toBe('abc123XYZ');
  });

  it('requires the setup code when the server asks for it', async () => {
    const user = userEvent.setup();
    const { received } = setup({ needsSetup: true, organizationName: null, setupTokenRequired: true });
    await fill(user);
    await user.click(screen.getByTestId('setup-submit'));
    expect(await screen.findByText('Enter the setup code from your e-mail.')).toBeInTheDocument();
    expect(received).toHaveLength(0);
  });

  it('shows the server message when the setup code is wrong (403)', async () => {
    const user = userEvent.setup();
    setup({ needsSetup: true, organizationName: null, setupTokenRequired: true }, '/setup?token=wrong');
    server.use(http.post('*/api/setup', () => problem(403, 'This setup link is not valid.')));
    await fill(user);
    await user.click(screen.getByTestId('setup-submit'));
    expect(await screen.findByTestId('setup-error')).toHaveTextContent('This setup link is not valid.');
    expect(getToken()).toBeNull();
  });

  it('prefills the organization verified at signup and asks for the same email', async () => {
    const user = userEvent.setup();
    const { received } = setup({ needsSetup: true, organizationName: 'Café Andino', setupTokenRequired: true }, '/setup?token=tok-1');
    expect(await screen.findByTestId('setup-org')).toHaveValue('Café Andino');
    expect(screen.getByText('Use the email you verified when you signed up.')).toBeInTheDocument();
    expect(screen.getByTestId('setup-token')).toHaveValue('tok-1');
    await user.type(screen.getByTestId('setup-name'), 'Ana Pérez');
    await user.type(screen.getByTestId('setup-email'), 'ana@andino.example');
    await user.type(screen.getByTestId('setup-password'), STRONG);
    await user.type(screen.getByTestId('setup-confirm'), STRONG);
    await user.click(screen.getByTestId('setup-submit'));
    await waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]).toMatchObject({ organizationName: 'Café Andino', setupToken: 'tok-1' });
  });

  it('does not show the signup email hint on an instance without a known organization', async () => {
    setup();
    expect(await screen.findByTestId('setup-org')).toHaveValue('');
    expect(screen.queryByText('Use the email you verified when you signed up.')).not.toBeInTheDocument();
  });

  it('shows a 400 email error inline (not the verified email)', async () => {
    const user = userEvent.setup();
    setup({ needsSetup: true, organizationName: 'Acme Imports' });
    server.use(
      http.post('*/api/setup', () =>
        problem(400, 'One or more validation errors occurred.', { Email: ['Use the email you verified when you signed up (a***@acme.example).'] }),
      ),
    );
    await screen.findByTestId('setup-org');
    await user.type(screen.getByTestId('setup-name'), 'Ana Pérez');
    await user.type(screen.getByTestId('setup-email'), 'other@acme.example');
    await user.type(screen.getByTestId('setup-password'), STRONG);
    await user.type(screen.getByTestId('setup-confirm'), STRONG);
    await user.click(screen.getByTestId('setup-submit'));
    expect(await screen.findByText('Use the email you verified when you signed up (a***@acme.example).')).toBeInTheDocument();
    expect(screen.getByTestId('setup-email')).toHaveAttribute('aria-invalid', 'true');
    expect(getToken()).toBeNull();
  });

  it('shows the server message when someone else completed the setup first (409)', async () => {
    const user = userEvent.setup();
    setup();
    server.use(http.post('*/api/setup', () => problem(409, 'This instance already has users.')));
    await fill(user);
    await user.click(screen.getByTestId('setup-submit'));
    expect(await screen.findByTestId('setup-error')).toHaveTextContent('This instance already has users.');
    expect(getToken()).toBeNull();
  });
});
