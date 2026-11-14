import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { OnChainGuard } from '../api/types';
import { makeDashboard, makeTreasury, meHandler } from '../test/fixtures';
import { server } from '../test/server';
import { renderRoutes, signInAs, USERS } from '../test/utils';
import { OverviewPage } from './Overview';

const GUARD: OnChainGuard = {
  contractId: 'treasury.acme.near',
  agentId: 'agent.acme.near',
  maxPerPayment: 2000,
  dailyLimit: 5000,
  spentToday: 1250,
  remainingToday: 3750,
  paused: false,
};

function setup(onChain: OnChainGuard | null) {
  signInAs('Owner');
  const base = makeDashboard();
  server.use(
    meHandler(USERS.Owner),
    http.get('*/api/dashboard', () => HttpResponse.json(makeDashboard({ treasury: { ...base.treasury, onChain } }))),
    // Getting-started checklist (hidden here: the demo never shows it).
    http.get('*/api/treasury', () => HttpResponse.json(makeTreasury({ demo: true }))),
    http.get('*/api/payees', () => HttpResponse.json([])),
    http.get('*/api/policy', () => HttpResponse.json({ version: 1 })),
    http.get('*/api/users', () => HttpResponse.json([])),
  );
  return renderRoutes([{ path: '/', element: <OverviewPage /> }], '/');
}

describe('on-chain guardrails card', () => {
  it('is not rendered when the treasury is not a Tesorero contract', async () => {
    setup(null);
    expect(await screen.findByTestId('treasury-balance')).toBeInTheDocument();
    expect(screen.queryByTestId('onchain-guard')).not.toBeInTheDocument();
  });

  it('shows the contract limits, a nearblocks link and today usage', async () => {
    setup(GUARD);
    const card = await screen.findByTestId('onchain-guard');
    expect(card).toHaveAttribute('data-paused', 'false');
    expect(card).toHaveTextContent('These limits are enforced by the NEAR smart contract — even a compromised server cannot exceed them.');
    expect(within(card).getByTestId('onchain-guard-status')).toHaveTextContent('Enforced on-chain');
    expect(within(card).getByTestId('onchain-guard-contract-link')).toHaveAttribute('href', 'https://nearblocks.io/address/treasury.acme.near');
    expect(within(card).getByTestId('onchain-guard-contract-link')).toHaveAttribute('rel', 'noopener noreferrer');
    expect(card).toHaveTextContent('$2,000.00');
    expect(card).toHaveTextContent('$3,750.00');
    const meter = within(card).getByRole('meter', { name: 'Spent today (on-chain)' });
    expect(meter).toHaveAttribute('aria-valuenow', '1250');
    expect(meter).toHaveAttribute('aria-valuemax', '5000');
    expect(within(card).queryByTestId('onchain-guard-paused')).not.toBeInTheDocument();
  });

  it('makes a paused contract unmistakable', async () => {
    setup({ ...GUARD, paused: true, agentId: null });
    const card = await screen.findByTestId('onchain-guard');
    expect(card).toHaveAttribute('data-paused', 'true');
    expect(within(card).getByTestId('onchain-guard-status')).toHaveTextContent('Paused on-chain');
    expect(within(card).getByTestId('onchain-guard-status')).toHaveAttribute('data-tone', 'danger');
    expect(within(card).getByTestId('onchain-guard-paused')).toHaveTextContent('rejects every payment');
    expect(card).toHaveTextContent('None — payments need your wallet signature');
  });
});

describe('treasury not configured', () => {
  it('sends the Owner to the Treasury page to create it', async () => {
    signInAs('Owner');
    const base = makeDashboard();
    server.use(
      meHandler(USERS.Owner),
      http.get('*/api/dashboard', () => HttpResponse.json(makeDashboard({ treasury: { ...base.treasury, configured: false, accountId: null } }))),
      http.get('*/api/treasury', () => HttpResponse.json(makeTreasury())),
      http.get('*/api/payees', () => HttpResponse.json([])),
      http.get('*/api/policy', () => HttpResponse.json({ version: 1 })),
      http.get('*/api/users', () => HttpResponse.json([])),
    );
    renderRoutes([{ path: '/', element: <OverviewPage /> }], '/');
    expect(await screen.findByTestId('treasury-configure')).toHaveAttribute('href', '/treasury');
    // A real organization sees the getting-started checklist above the dashboard.
    expect(await screen.findByTestId('onboarding-checklist')).toBeInTheDocument();
  });
});
