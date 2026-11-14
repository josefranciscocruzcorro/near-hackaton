import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { queryKeys } from '../../api/queries';
import type { Role, TreasuryOverview } from '../../api/types';
import type { Lang } from '../../i18n';
import { allChecks, instanceHandler, makeSettings, makeTreasury, meHandler, readyTreasury } from '../../test/fixtures';
import { server } from '../../test/server';
import { renderRoutes, signInAs, USERS } from '../../test/utils';
import { AppShell } from './AppShell';

function setup(role: Role, demo: boolean, lang: Lang = 'en', treasury: TreasuryOverview = makeTreasury()) {
  signInAs(role);
  server.use(
    instanceHandler({ demo }),
    meHandler(USERS[role]),
    http.get('*/api/payments', () => HttpResponse.json([])),
    http.get('*/api/settings', () => HttpResponse.json(makeSettings({ demo }))),
    http.get('*/api/treasury', () => HttpResponse.json(treasury)),
  );
  return renderRoutes([{ path: '/', element: <AppShell />, children: [{ index: true, element: <p>Page body</p> }] }], '/', { lang });
}

describe('shell navigation', () => {
  it('shows the Users page in the navigation for the Owner', async () => {
    setup('Owner', false);
    expect(await screen.findByTestId('nav-users')).toHaveAttribute('href', '/users');
  });

  it.each(['Owner', 'Approver', 'Auditor'] as const)('shows the Treasury page to %s', async (role) => {
    setup(role, false);
    expect(await screen.findByTestId('nav-treasury')).toHaveAttribute('href', '/treasury');
  });

  it.each(['Approver', 'Auditor'] as const)('hides the Users page from %s', async (role) => {
    setup(role, false);
    expect(await screen.findByTestId('nav-overview')).toBeInTheDocument();
    expect(screen.queryByTestId('nav-users')).not.toBeInTheDocument();
  });
});

describe('demo banner', () => {
  it('is not shown on a real instance', async () => {
    const { client } = setup('Owner', false);
    expect(await screen.findByText('Page body')).toBeInTheDocument();
    await waitFor(() => expect(client.getQueryData(queryKeys.instance)).toBeDefined());
    expect(screen.queryByTestId('demo-banner')).not.toBeInTheDocument();
  });

  it('is shown on the public demo and can be dismissed for the session', async () => {
    const user = userEvent.setup();
    setup('Approver', true);
    const banner = await screen.findByTestId('demo-banner');
    expect(banner).toHaveTextContent('Public demo — data can be reset at any time. Real money never moves here.');
    await user.click(screen.getByTestId('demo-banner-dismiss'));
    expect(screen.queryByTestId('demo-banner')).not.toBeInTheDocument();
    expect(sessionStorage.getItem('tesorero.demoBanner.dismissed')).toBe('1');
  });

  it('stays hidden when it was dismissed earlier in this session', async () => {
    sessionStorage.setItem('tesorero.demoBanner.dismissed', '1');
    const { client } = setup('Owner', true);
    await waitFor(() => expect(client.getQueryData(queryKeys.instance)).toBeDefined());
    expect(screen.queryByTestId('demo-banner')).not.toBeInTheDocument();
  });
});

describe('payments stopped banner', () => {
  function stopped(role: Role, agentEnabled: boolean) {
    const calls = { resume: 0 };
    let enabled = agentEnabled;
    server.use(
      http.get('*/api/policy', () => HttpResponse.json({ agentEnabled: enabled, version: enabled ? 2 : 1 })),
      http.post('*/api/payments/resume', () => {
        calls.resume++;
        enabled = true;
        return HttpResponse.json({ agentEnabled: true, version: 2 });
      }),
    );
    setup(role, false);
    return calls;
  }

  it('is shown everywhere while payments are stopped, with Resume for the Owner', async () => {
    const user = userEvent.setup();
    const calls = stopped('Owner', false);
    const banner = await screen.findByTestId('payments-stopped-banner');
    expect(banner).toHaveTextContent('Payments are stopped.');
    await user.click(screen.getByTestId('banner-resume-button'));
    await user.click(await screen.findByTestId('resume-payments-dialog-confirm'));
    await waitFor(() => expect(calls.resume).toBe(1));
    await waitFor(() => expect(screen.queryByTestId('payments-stopped-banner')).not.toBeInTheDocument());
  });

  it('asks other roles to contact an owner', async () => {
    stopped('Approver', false);
    const banner = await screen.findByTestId('payments-stopped-banner');
    expect(banner).toHaveTextContent('Ask an owner to resume them.');
    expect(screen.queryByTestId('banner-resume-button')).not.toBeInTheDocument();
  });

  it('is not shown while payments run', async () => {
    stopped('Owner', true);
    expect(await screen.findByText('Page body')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('payments-stopped-banner')).not.toBeInTheDocument());
  });
});

describe('treasury frozen banner', () => {
  const frozen = () => {
    const t = readyTreasury({ checks: allChecks(true, ['notPaused']), readyForLive: false });
    return { ...t, onChain: t.onChain ? { ...t.onChain, paused: true } : null };
  };

  it.each(['Owner', 'Approver', 'Auditor'] as const)('is shown to %s while the contract is frozen on NEAR, with a link to Treasury', async (role) => {
    setup(role, false, 'en', frozen());
    const banner = await screen.findByTestId('treasury-frozen-banner');
    expect(banner).toHaveTextContent('Your treasury is frozen on NEAR: no payment can leave. Only your wallet can resume it.');
    const link = screen.getByTestId('treasury-frozen-banner-link');
    expect(link).toHaveTextContent('Go to Treasury');
    expect(link).toHaveAttribute('href', '/treasury');
  });

  it('speaks Spanish', async () => {
    setup('Owner', false, 'es', frozen());
    const banner = await screen.findByTestId('treasury-frozen-banner');
    expect(banner).toHaveTextContent('Tu tesorería está congelada en NEAR: ningún pago puede salir. Solo tu billetera puede reanudarla.');
    expect(screen.getByTestId('treasury-frozen-banner-link')).toHaveTextContent('Ir a Tesorería');
  });

  it('is not shown while the contract is not paused (or there is no treasury yet)', async () => {
    const { client } = setup('Owner', false, 'en', readyTreasury());
    await waitFor(() => expect(client.getQueryData(queryKeys.treasury)).toBeDefined());
    expect(screen.queryByTestId('treasury-frozen-banner')).not.toBeInTheDocument();
  });
});

describe('header', () => {
  it('keeps the language switch in the header on every screen size', async () => {
    const user = userEvent.setup();
    setup('Owner', false);
    const header = (await screen.findAllByRole('banner'))[0];
    const toggle = header?.querySelector('[data-testid="language-toggle"]');
    expect(toggle).not.toBeNull();
    expect(toggle?.closest('.hidden')).toBeNull();
    await user.click(toggle as HTMLElement);
    expect(document.documentElement.lang).toBe('es');
  });
});
