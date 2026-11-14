import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { NearAccountCheck, SignupRequest, SlugCheck } from '../api/types';
import type { Lang } from '../i18n';
import { landingInstanceHandler, problem } from '../test/fixtures';
import { server } from '../test/server';
import { renderRoutes } from '../test/utils';
import { LandingPage } from './Landing';
import { VIDEO_SOURCES } from './landing/VideoSection';

type User = ReturnType<typeof userEvent.setup>;

function slugAnswer(value: string): SlugCheck {
  if (value === 'taken-co') return { slug: value, available: false, reason: 'taken' };
  if (value === 'admin') return { slug: value, available: false, reason: 'reserved' };
  return { slug: value, available: true, reason: null };
}

function setup({ lang = 'en', signup }: { lang?: Lang; signup?: () => Response | Promise<Response> } = {}) {
  const slugCalls: string[] = [];
  const nearCalls: string[] = [];
  const posted: SignupRequest[] = [];
  server.use(
    landingInstanceHandler(),
    http.get('*/api/signup/slug', ({ request }) => {
      const value = new URL(request.url).searchParams.get('value') ?? '';
      slugCalls.push(value);
      return HttpResponse.json<SlugCheck>(slugAnswer(value));
    }),
    http.get('*/api/signup/near', ({ request }) => {
      const accountId = new URL(request.url).searchParams.get('accountId') ?? '';
      nearCalls.push(accountId);
      return HttpResponse.json<NearAccountCheck>({ accountId, exists: accountId !== 'ghost.near', valid: true });
    }),
    http.post('*/api/signup', async ({ request }) => {
      const body = (await request.json()) as SignupRequest;
      posted.push(body);
      return signup ? signup() : HttpResponse.json({ email: body.email }, { status: 202 });
    }),
  );
  const view = renderRoutes([{ path: '/', element: <LandingPage /> }], '/', { lang, withAuth: false });
  return { slugCalls, nearCalls, posted, ...view };
}

async function fillValid(user: User) {
  await user.type(await screen.findByTestId('signup-org'), 'Café Andino S.A.');
  await user.type(screen.getByTestId('signup-name'), 'Ana Pérez');
  await user.type(screen.getByTestId('signup-email'), 'ana@andino.example');
  await user.type(screen.getByTestId('signup-near'), 'andino.near');
  await user.click(screen.getByTestId('signup-terms'));
  await waitFor(() => expect(screen.getByTestId('signup-slug-status')).toHaveAttribute('data-status', 'available'));
  await waitFor(() => expect(screen.getByTestId('signup-near-status')).toHaveAttribute('data-status', 'exists'));
}

describe('Landing page', () => {
  it('renders the hero with the demo link and no app shell', async () => {
    setup();
    const hero = await screen.findByTestId('landing-hero');
    expect(within(hero).getByRole('heading', { level: 1 })).toHaveTextContent('Your AI treasurer. Your rules. Any chain.');
    expect(screen.getByTestId('landing-demo-link')).toHaveAttribute('href', 'https://demo.tesorero.gesco.ec');
    expect(screen.queryByTestId('user-menu-trigger')).not.toBeInTheDocument();
    expect(screen.queryByTestId('login-email')).not.toBeInTheDocument();
  });

  it('moves focus to the signup form from the hero CTA', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByTestId('landing-cta-signup'));
    expect(screen.getByTestId('signup-org')).toHaveFocus();
  });

  it('switches the walkthrough video between English and Spanish', async () => {
    const user = userEvent.setup();
    setup();
    const video = await screen.findByTestId('landing-video');
    expect(video).toHaveAttribute('src', VIDEO_SOURCES.en.src);
    expect(video).toHaveAttribute('poster', VIDEO_SOURCES.en.poster);
    expect(video).toHaveAttribute('preload', 'none');
    expect(screen.getByTestId('video-tab-en')).toHaveAttribute('aria-selected', 'true');

    await user.click(screen.getByTestId('video-tab-es'));
    expect(screen.getByTestId('video-tab-es')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('landing-video')).toHaveAttribute('src', VIDEO_SOURCES.es.src);
    expect(screen.getByTestId('landing-video')).toHaveAttribute('poster', VIDEO_SOURCES.es.poster);
    expect(VIDEO_SOURCES.es.src).toMatch(/^\/media\/tesorero-demo-es\.mp4\?v=/);

    // Arrow keys move between tabs.
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByTestId('video-tab-en')).toHaveFocus();
    expect(screen.getByTestId('landing-video')).toHaveAttribute('src', VIDEO_SOURCES.en.src);
  });

  it('defaults the video tab to the UI language and degrades gracefully when the file is missing', async () => {
    setup({ lang: 'es' });
    const video = await screen.findByTestId('landing-video');
    expect(screen.getByTestId('video-tab-es')).toHaveAttribute('aria-selected', 'true');
    expect(video).toHaveAttribute('src', VIDEO_SOURCES.es.src);
    fireEvent.error(video);
    expect(await screen.findByTestId('landing-video-unavailable')).toHaveTextContent('El video aún no está disponible aquí.');
    expect(screen.queryByTestId('landing-video')).not.toBeInTheDocument();
  });
});

describe('Signup form', () => {
  it('suggests the subdomain from the organization name and checks it once typing pauses', async () => {
    const user = userEvent.setup();
    const { slugCalls } = setup();
    await user.type(await screen.findByTestId('signup-org'), 'Café Andino S.A.');
    expect(screen.getByTestId('signup-slug')).toHaveValue('cafe-andino-s-a');
    expect(screen.getByTestId('signup-slug-status')).toHaveAttribute('data-status', 'checking');
    await waitFor(() => expect(screen.getByTestId('signup-slug-status')).toHaveAttribute('data-status', 'available'));
    expect(screen.getByTestId('signup-slug-status')).toHaveTextContent('cafe-andino-s-a.tesorero.gesco.ec is available');
    expect(slugCalls).toEqual(['cafe-andino-s-a']);
  });

  it('reports taken, reserved and invalid subdomains', async () => {
    const user = userEvent.setup();
    const { slugCalls } = setup();
    await user.type(await screen.findByTestId('signup-org'), 'Acme');
    const slug = screen.getByTestId('signup-slug');
    const status = screen.getByTestId('signup-slug-status');

    await user.clear(slug);
    await user.type(slug, 'Taken Co');
    expect(slug).toHaveValue('taken-co');
    await waitFor(() => expect(status).toHaveAttribute('data-status', 'taken'));
    expect(status).toHaveTextContent('taken-co.tesorero.gesco.ec is already taken.');
    expect(slug).toHaveAttribute('aria-invalid', 'true');

    await user.clear(slug);
    await user.type(slug, 'admin');
    await waitFor(() => expect(status).toHaveAttribute('data-status', 'reserved'));
    expect(status).toHaveTextContent('“admin” is reserved.');

    // The organization name no longer drives the subdomain once it was edited.
    await user.type(screen.getByTestId('signup-org'), ' Imports');
    expect(slug).toHaveValue('admin');

    await user.clear(slug);
    await user.type(slug, '-ab');
    await waitFor(() => expect(status).toHaveAttribute('data-status', 'invalid'));
    expect(status).toHaveTextContent('Use 3–30 lowercase letters');
    expect(slugCalls).not.toContain('-ab');
  });

  it('checks that the NEAR account exists on mainnet', async () => {
    const user = userEvent.setup();
    const { nearCalls } = setup();
    const near = await screen.findByTestId('signup-near');
    const status = screen.getByTestId('signup-near-status');
    expect(screen.getByText('We check that it exists on NEAR, e.g. yourname.near')).toBeInTheDocument();

    await user.type(near, 'Andino.near');
    expect(status).toHaveAttribute('data-status', 'checking');
    expect(status).toHaveTextContent('Looking it up on NEAR mainnet…');
    await waitFor(() => expect(status).toHaveAttribute('data-status', 'exists'));
    expect(status).toHaveTextContent('andino.near exists on NEAR mainnet');

    await user.clear(near);
    await user.type(near, 'ghost.near');
    await waitFor(() => expect(status).toHaveAttribute('data-status', 'notFound'));
    expect(status).toHaveTextContent('ghost.near was not found on NEAR mainnet.');

    await user.clear(near);
    await user.type(near, 'not valid!');
    await waitFor(() => expect(status).toHaveAttribute('data-status', 'invalid'));
    expect(nearCalls).toEqual(['andino.near', 'ghost.near']);
  });

  it('shows a retryable message when a live check fails', async () => {
    const user = userEvent.setup();
    setup();
    server.use(http.get('*/api/signup/near', () => new HttpResponse(null, { status: 503 })));
    await user.type(await screen.findByTestId('signup-near'), 'andino.near');
    const status = screen.getByTestId('signup-near-status');
    await waitFor(() => expect(status).toHaveAttribute('data-status', 'error'));
    server.use(http.get('*/api/signup/near', () => HttpResponse.json<NearAccountCheck>({ accountId: 'andino.near', exists: true, valid: true })));
    await user.click(within(status).getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(status).toHaveAttribute('data-status', 'exists'));
  });

  it('keeps submit disabled until every field is valid and both checks pass', async () => {
    const user = userEvent.setup();
    setup();
    const submit = await screen.findByTestId('signup-submit');
    expect(submit).toBeDisabled();
    expect(screen.getByText('Complete every field and wait for both checks to pass.')).toBeInTheDocument();

    await user.type(screen.getByTestId('signup-org'), 'Acme');
    await user.type(screen.getByTestId('signup-name'), 'Ana');
    await user.type(screen.getByTestId('signup-email'), 'not-an-email');
    await user.type(screen.getByTestId('signup-near'), 'acme.near');
    await user.click(screen.getByTestId('signup-terms'));
    await waitFor(() => expect(screen.getByTestId('signup-near-status')).toHaveAttribute('data-status', 'exists'));
    expect(submit).toBeDisabled();
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();

    await user.clear(screen.getByTestId('signup-email'));
    await user.type(screen.getByTestId('signup-email'), 'ana@acme.example');
    await waitFor(() => expect(submit).toBeEnabled());

    await user.click(screen.getByTestId('signup-terms'));
    expect(submit).toBeDisabled();
    expect(screen.getByText('Please accept to continue.')).toBeInTheDocument();
  });

  it('sends the request with an empty honeypot and shows the inbox message', async () => {
    const user = userEvent.setup();
    const { posted } = setup();
    expect(await screen.findByTestId('signup-website')).toHaveAttribute('tabindex', '-1');
    expect(screen.getByTestId('signup-website')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('signup-website')).toHaveAttribute('autocomplete', 'off');

    await fillValid(user);
    await user.click(screen.getByTestId('signup-submit'));

    const success = await screen.findByTestId('signup-success');
    expect(success).toHaveTextContent('Check your inbox');
    expect(success).toHaveTextContent('We sent a verification link to ana@andino.example. It expires in 24 hours.');
    expect(screen.queryByTestId('signup-form')).not.toBeInTheDocument();
    expect(posted).toEqual([
      {
        organizationName: 'Café Andino S.A.',
        slug: 'cafe-andino-s-a',
        ownerName: 'Ana Pérez',
        email: 'ana@andino.example',
        nearAccountId: 'andino.near',
        language: 'en',
        acceptTerms: true,
        website: '',
      },
    ]);
  });

  it('defaults the email language to the UI language', async () => {
    const user = userEvent.setup();
    const { posted } = setup({ lang: 'es' });
    expect(await screen.findByTestId('signup-language')).toHaveValue('es');
    await fillValid(user);
    await user.click(screen.getByTestId('signup-submit'));
    await screen.findByTestId('signup-success');
    expect(posted[0]?.language).toBe('es');
  });

  it('shows server field errors inline and clears them when the field changes', async () => {
    const user = userEvent.setup();
    setup({
      signup: () =>
        problem(400, 'One or more validation errors occurred.', {
          Slug: ['This subdomain was just taken.'],
          NearAccountId: ['This NEAR account does not exist.'],
          Email: ['Use a different email.'],
        }),
    });
    await fillValid(user);
    await user.click(screen.getByTestId('signup-submit'));

    expect(await screen.findByTestId('signup-error')).toHaveTextContent('Please review the highlighted fields.');
    expect(screen.getByText('This subdomain was just taken.')).toBeInTheDocument();
    expect(screen.getByText('This NEAR account does not exist.')).toBeInTheDocument();
    expect(screen.getByText('Use a different email.')).toBeInTheDocument();
    expect(screen.getByTestId('signup-slug')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByTestId('signup-submit')).toBeDisabled();

    await user.type(screen.getByTestId('signup-email'), 'x');
    expect(screen.queryByText('Use a different email.')).not.toBeInTheDocument();
    expect(screen.getByText('This subdomain was just taken.')).toBeInTheDocument();
  });

  it('explains the rate limit (429)', async () => {
    const user = userEvent.setup();
    setup({ signup: () => problem(429, 'Too Many Requests') });
    await fillValid(user);
    await user.click(screen.getByTestId('signup-submit'));
    expect(await screen.findByTestId('signup-error')).toHaveTextContent(
      'Too many sign-up attempts from your network. Please wait a few minutes and try again.',
    );
    expect(screen.getByTestId('signup-form')).toBeInTheDocument();
  });
});
