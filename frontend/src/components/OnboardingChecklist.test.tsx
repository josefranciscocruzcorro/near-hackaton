import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { Payee, Policy, Role, TreasuryOverview, UserAdmin } from '../api/types';
import { allChecks, makeTreasury, meHandler, readyTreasury } from '../test/fixtures';
import { server } from '../test/server';
import { renderRoutes, signInAs, USERS } from '../test/utils';
import { ONBOARDING_DISMISSED_KEY, OnboardingChecklist } from './OnboardingChecklist';

const policy = (version: number): Policy => ({
  agentEnabled: true,
  maxPerPaymentUsd: 2000,
  approvalThresholdUsd: 1000,
  dailyLimitUsd: 5000,
  monthlyLimitUsd: 50000,
  minReserveUsd: 500,
  requireAllowlistedPayee: true,
  newPayeeCooldownHours: 24,
  planningHorizonDays: 7,
  categoryBudgets: { Supplier: 1, Contractor: 1, Payroll: 1, Software: 1, Operations: 1, Marketing: 1 },
  version,
  updatedAt: '2026-11-14T10:00:00Z',
  updatedBy: 'System',
});

const user = (id: string, isActive = true): UserAdmin => ({ id, email: `${id}@acme.test`, name: id, role: 'Owner', isActive, createdAt: '2026-11-14T10:00:00Z' });

const payee = { id: 'payee-1', name: 'Andes Coffee Co.' } as Payee;

interface Data {
  treasury: TreasuryOverview;
  users?: UserAdmin[];
  payees?: Payee[];
  policyVersion?: number;
}

function setup({ treasury, users = [user('u1')], payees = [], policyVersion = 1 }: Data, role: Role = 'Owner') {
  signInAs(role);
  const calls = { users: 0 };
  server.use(
    meHandler(USERS[role]),
    http.get('*/api/treasury', () => HttpResponse.json(treasury)),
    http.get('*/api/payees', () => HttpResponse.json(payees)),
    http.get('*/api/policy', () => HttpResponse.json(policy(policyVersion))),
    http.get('*/api/users', () => {
      calls.users++;
      return HttpResponse.json(users);
    }),
  );
  const result = renderRoutes(
    [
      { path: '/', element: <OnboardingChecklist /> },
      { path: '/users', element: <p>Users page</p> },
    ],
    '/',
  );
  return { calls, ...result };
}

describe('getting started checklist', () => {
  it('lists every step with an action for the Owner of a new organization', async () => {
    const u = userEvent.setup();
    setup({ treasury: makeTreasury() });
    const list = await screen.findByTestId('onboarding-checklist');
    expect(within(list).getByTestId('onboarding-progress')).toHaveTextContent('0 of 6 done');
    for (const id of ['team', 'payee', 'policies', 'treasury', 'fund', 'live']) {
      expect(within(list).getByTestId(`onboarding-item-${id}`)).toHaveAttribute('data-done', 'false');
    }
    expect(within(list).getByTestId('onboarding-cta-treasury')).toHaveAttribute('href', '/treasury');
    expect(within(list).getByTestId('onboarding-cta-fund')).toHaveAttribute('href', '/treasury?fund=1');
    expect(within(list).getByTestId('onboarding-cta-live')).toHaveAttribute('href', '/settings');
    expect(within(list).getByTestId('onboarding-cta-payee')).toHaveAttribute('href', '/payees');
    expect(within(list).getByTestId('onboarding-cta-policies')).toHaveAttribute('href', '/policies');
    await u.click(within(list).getByTestId('onboarding-cta-team'));
    expect(await screen.findByText('Users page')).toBeInTheDocument();
  });

  it('computes done/pending from the existing endpoints and the treasury', async () => {
    setup({ treasury: readyTreasury(), users: [user('u1'), user('u2')], payees: [payee], policyVersion: 3 });
    const list = await screen.findByTestId('onboarding-checklist');
    expect(within(list).getByTestId('onboarding-progress')).toHaveTextContent('5 of 6 done');
    for (const id of ['team', 'payee', 'policies', 'treasury', 'fund']) {
      expect(within(list).getByTestId(`onboarding-item-${id}`)).toHaveAttribute('data-done', 'true');
    }
    expect(within(list).getByTestId('onboarding-item-live')).toHaveAttribute('data-done', 'false');
    expect(within(list).queryByTestId('onboarding-cta-treasury')).not.toBeInTheDocument();
    expect(within(list).getByTestId('onboarding-cta-live')).toBeInTheDocument();
  });

  it('does not count deactivated users or an empty treasury', async () => {
    setup({ treasury: readyTreasury({ checks: allChecks(true, ['funded']), balances: null }), users: [user('u1'), user('u2', false)] });
    const list = await screen.findByTestId('onboarding-checklist');
    expect(within(list).getByTestId('onboarding-item-team')).toHaveAttribute('data-done', 'false');
    expect(within(list).getByTestId('onboarding-item-treasury')).toHaveAttribute('data-done', 'true');
    expect(within(list).getByTestId('onboarding-item-fund')).toHaveAttribute('data-done', 'false');
  });

  it('disappears once everything is done', async () => {
    const { client } = setup({ treasury: readyTreasury({ executionMode: 'Live' }), users: [user('u1'), user('u2')], payees: [payee], policyVersion: 2 });
    await waitFor(() => expect(client.getQueryData(['policy'])).toBeDefined());
    await waitFor(() => expect(client.getQueryData(['users'])).toBeDefined());
    expect(screen.queryByTestId('onboarding-checklist')).not.toBeInTheDocument();
  });

  it('is never shown on the public demo', async () => {
    const { client } = setup({ treasury: makeTreasury({ demo: true }) });
    await waitFor(() => expect(client.getQueryData(['treasury'])).toBeDefined());
    expect(screen.queryByTestId('onboarding-checklist')).not.toBeInTheDocument();
  });

  it('can be dismissed and stays dismissed', async () => {
    const u = userEvent.setup();
    setup({ treasury: makeTreasury() });
    await u.click(await screen.findByTestId('onboarding-dismiss'));
    expect(screen.queryByTestId('onboarding-checklist')).not.toBeInTheDocument();
    expect(localStorage.getItem(ONBOARDING_DISMISSED_KEY)).toBe('1');
  });

  it('respects an earlier dismissal', async () => {
    localStorage.setItem(ONBOARDING_DISMISSED_KEY, '1');
    const { client } = setup({ treasury: makeTreasury() });
    await waitFor(() => expect(client.getQueryData(['treasury'])).toBeDefined());
    expect(screen.queryByTestId('onboarding-checklist')).not.toBeInTheDocument();
  });

  it('is read-only for other roles and never asks for the Owner-only users list', async () => {
    const { calls } = setup({ treasury: makeTreasury() }, 'Approver');
    const list = await screen.findByTestId('onboarding-checklist');
    expect(list).toHaveTextContent('An Owner completes these steps');
    expect(within(list).getByTestId('onboarding-item-team')).toHaveAttribute('data-done', 'true');
    expect(within(list).queryAllByRole('link')).toHaveLength(0);
    expect(calls.users).toBe(0);
  });
});
