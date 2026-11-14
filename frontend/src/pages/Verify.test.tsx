import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { StrictMode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { VerifySignupRequest, VerifySignupResponse } from '../api/types';
import { landingInstanceHandler, problem } from '../test/fixtures';
import { server } from '../test/server';
import { renderWithProviders } from '../test/utils';
import { VerifyPage } from './Verify';

const OK: VerifySignupResponse = {
  organizationName: 'Café Andino',
  slug: 'andino',
  tenantUrl: 'https://andino.tesorero.gesco.ec',
  email: 'ana@andino.example',
};

function setup(path: string, respond: (call: number) => Response | Promise<Response> = () => HttpResponse.json(OK)) {
  const received: VerifySignupRequest[] = [];
  server.use(
    landingInstanceHandler(),
    http.post('*/api/signup/verify', async ({ request }) => {
      received.push((await request.json()) as VerifySignupRequest);
      return respond(received.length);
    }),
  );
  const router = createMemoryRouter(
    [
      { path: '/verify', element: <VerifyPage /> },
      { path: '/', element: <p>Landing page</p> },
    ],
    { initialEntries: [path] },
  );
  // StrictMode mounts, unmounts and re-runs effects: the single-use token must still be sent once.
  const view = renderWithProviders(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
    { withAuth: false },
  );
  return { received, router, ...view };
}

describe('Email verification (/verify)', () => {
  it('verifies the token exactly once under StrictMode and links to the new tenant', async () => {
    const { received } = setup('/verify?token=tok-123');
    expect(screen.getByText('Verifying your email…')).toBeInTheDocument();
    const success = await screen.findByTestId('verify-success');
    expect(success).toHaveTextContent('Email verified');
    expect(success).toHaveTextContent(
      'Your organization Café Andino is ready at https://andino.tesorero.gesco.ec. We sent the setup link to ana@andino.example; open it to create your Owner account.',
    );
    const link = screen.getByTestId('verify-tenant-link');
    expect(link).toHaveAttribute('href', 'https://andino.tesorero.gesco.ec');
    expect(link).toHaveTextContent('Go to andino.tesorero.gesco.ec');
    // Give a late duplicate request the chance to show up.
    await new Promise((r) => setTimeout(r, 50));
    expect(received).toEqual([{ token: 'tok-123' }]);
  });

  it('explains an invalid or expired link (400) and links back to the signup', async () => {
    const user = userEvent.setup();
    const { router } = setup('/verify?token=old', () => problem(400, 'The token is invalid or expired.'));
    const error = await screen.findByTestId('verify-error');
    expect(error).toHaveAttribute('data-reason', 'invalid');
    expect(error).toHaveTextContent('This verification link is invalid or has expired');
    await user.click(screen.getByTestId('verify-back'));
    expect(router.state.location.pathname).toBe('/');
    expect(router.state.location.hash).toBe('#signup');
  });

  it('shows the server detail on 409', async () => {
    setup('/verify?token=used', () => problem(409, 'This email was already verified. Check your inbox for the setup link.'));
    const error = await screen.findByTestId('verify-error');
    expect(error).toHaveAttribute('data-reason', 'conflict');
    expect(error).toHaveTextContent('Already taken care of');
    expect(error).toHaveTextContent('This email was already verified. Check your inbox for the setup link.');
  });

  it('does not call the API without a token', async () => {
    const { received } = setup('/verify');
    const error = await screen.findByTestId('verify-error');
    expect(error).toHaveAttribute('data-reason', 'missing');
    expect(received).toHaveLength(0);
  });

  it('lets the visitor retry after a transient failure', async () => {
    const user = userEvent.setup();
    const { received } = setup('/verify?token=tok-9', (call) => (call === 1 ? new HttpResponse(null, { status: 503 }) : HttpResponse.json(OK)));
    expect(await screen.findByTestId('verify-error')).toHaveAttribute('data-reason', 'generic');
    await user.click(screen.getByTestId('verify-retry'));
    expect(await screen.findByTestId('verify-success')).toBeInTheDocument();
    await waitFor(() => expect(received).toHaveLength(2));
  });
});
