import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { Policy, Role, Settings, TreasuryOverview } from '../api/types';
import { makeSettings, makeTreasury, meHandler, readyTreasury } from '../test/fixtures';
import { server } from '../test/server';
import { renderRoutes, signInAs, USERS } from '../test/utils';
import { SettingsPage } from './Settings';

const POLICY: Policy = {
  agentEnabled: true,
  maxPerPaymentUsd: 500,
  approvalThresholdUsd: 250,
  dailyLimitUsd: 1500,
  monthlyLimitUsd: 20000,
  minReserveUsd: 0,
  requireAllowlistedPayee: true,
  newPayeeCooldownHours: 48,
  planningHorizonDays: 7,
  categoryBudgets: { Supplier: 1, Contractor: 1, Payroll: 1, Software: 1, Operations: 1, Marketing: 1 },
  version: 3,
  updatedAt: '2026-11-13T00:00:00Z',
  updatedBy: 'Olivia Owner',
};

function setup(settings: Settings, role: Role = 'Owner', treasury: TreasuryOverview = makeTreasury({ setup: null }), policy: Policy = POLICY) {
  signInAs(role);
  const calls = { settings: 0, resets: 0 };
  server.use(
    meHandler(USERS[role]),
    http.get('*/api/settings', () => {
      calls.settings++;
      return HttpResponse.json(settings);
    }),
    http.get('*/api/version', () => HttpResponse.json({ version: '1.0.0', commit: 'abcdef1234', builtAt: '2026-11-13T00:00:00Z' })),
    http.get('*/api/treasury', () => HttpResponse.json(treasury)),
    http.get('*/api/policy', () => HttpResponse.json(policy)),
    http.post('*/api/demo/reset', () => {
      calls.resets++;
      return new HttpResponse(null, { status: 204 });
    }),
  );
  renderRoutes([{ path: '/settings', element: <SettingsPage /> }], '/settings');
  return { calls };
}

describe('settings: instance and live mode', () => {
  it('explains automatic Live signing when the server has an agent account', async () => {
    setup(makeSettings({ agentAccountId: 'agent.acme.near' }));
    expect(await screen.findByTestId('mode-live-description')).toHaveTextContent('the agent signs payments through the treasury contract automatically');
    expect(screen.getByTestId('agent-account')).toHaveTextContent('private key is stored encrypted and never leaves the server');
    expect(screen.getByTestId('instance-type')).toHaveTextContent('Production');
    expect(screen.getByTestId('mode-live')).toBeEnabled();
    expect(screen.queryByTestId('danger-zone')).not.toBeInTheDocument();
  });

  it('explains manual Live (wallet signature) when no agent is configured', async () => {
    setup(makeSettings({ agentAccountId: null }));
    expect(await screen.findByTestId('mode-live-description')).toHaveTextContent('you sign each deposit in your wallet');
    expect(screen.getByTestId('agent-account')).toHaveTextContent('Not configured');
    expect(screen.getByTestId('agent-account')).not.toHaveTextContent('private key');
  });

  it('disables Live on the public demo with an explanation', async () => {
    setup(makeSettings({ demo: true }));
    const live = await screen.findByTestId('mode-live');
    expect(live).toBeDisabled();
    expect(screen.getByTestId('mode-live-locked')).toHaveTextContent('Disabled on the public demo');
    expect(live).toHaveAccessibleDescription(/Disabled on the public demo/);
    expect(screen.getByTestId('instance-type')).toHaveTextContent('Public demo');
  });
});

describe('settings: reset demo', () => {
  it('asks for confirmation, resets and refetches every query', async () => {
    const user = userEvent.setup();
    const { calls } = setup(makeSettings({ demo: true }));
    await user.click(await screen.findByTestId('reset-demo-button'));
    const dialog = await screen.findByTestId('reset-demo-dialog');
    expect(calls.resets).toBe(0);
    const before = calls.settings;
    await user.click(within(dialog).getByTestId('reset-demo-confirm'));
    await waitFor(() => expect(calls.resets).toBe(1));
    expect(await screen.findByText('Demo data reset')).toBeInTheDocument();
    await waitFor(() => expect(calls.settings).toBeGreaterThan(before));
  });

  it('cancelling the confirmation does not reset anything', async () => {
    const user = userEvent.setup();
    const { calls } = setup(makeSettings({ demo: true }));
    await user.click(await screen.findByTestId('reset-demo-button'));
    const dialog = await screen.findByTestId('reset-demo-dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(calls.resets).toBe(0);
  });

  it('is Owner-only: other roles see it disabled with the required role', async () => {
    const user = userEvent.setup();
    const { calls } = setup(makeSettings({ demo: true }), 'Approver');
    const button = await screen.findByTestId('reset-demo-button');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    await user.click(button);
    expect(screen.queryByTestId('reset-demo-confirm')).not.toBeInTheDocument();
    expect(calls.resets).toBe(0);
  });

  it('is not offered on a real instance', async () => {
    setup(makeSettings({ demo: false }));
    expect(await screen.findByTestId('settings-form')).toBeInTheDocument();
    expect(screen.queryByTestId('reset-demo-button')).not.toBeInTheDocument();
  });
});

describe('settings: treasury balance', () => {
  it('shows the balance last read from NEAR mainnet for the saved treasury account', async () => {
    setup(makeSettings({ treasuryBalance: { usdc: 1234.5, near: 2.75, capturedAt: new Date().toISOString() } }));
    const line = await screen.findByTestId('treasury-balance');
    expect(line).toHaveTextContent('1,234.50 USDC');
    expect(line).toHaveTextContent('2.7500 NEAR');
  });

  it('reads the balance as soon as the owner saves, without waiting for the refresh job', async () => {
    const user = userEvent.setup();
    let saved: unknown = null;
    setup(makeSettings({ treasuryAccountId: null }));
    server.use(
      http.put('*/api/settings', async ({ request }) => {
        saved = await request.json();
        return HttpResponse.json(makeSettings({ treasuryAccountId: 'cruzespejose.near', treasuryBalance: { usdc: 0, near: 0, capturedAt: new Date().toISOString() } }));
      }),
    );
    const field = await screen.findByLabelText(/Treasury NEAR account/i);
    expect(screen.queryByTestId('treasury-balance')).not.toBeInTheDocument();
    await user.type(field, 'cruzespejose.near');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(saved).toMatchObject({ treasuryAccountId: 'cruzespejose.near' }));
    expect(await screen.findByText('Balance on NEAR mainnet: 0.00 USDC · 0.0000 NEAR')).toBeInTheDocument();
    expect(await screen.findByTestId('treasury-balance')).toHaveTextContent('0.00 USDC');
  });

  it('shows the server error when the account does not exist on mainnet', async () => {
    const user = userEvent.setup();
    setup(makeSettings({ treasuryAccountId: null }));
    server.use(
      http.put('*/api/settings', () =>
        HttpResponse.json(
          { title: 'Validation failed', status: 400, errors: { treasuryAccountId: ['This account does not exist on NEAR mainnet.'] } },
          { status: 400 },
        ),
      ),
    );
    await user.type(await screen.findByLabelText(/Treasury NEAR account/i), 'nobody-here-123.near');
    await user.click(screen.getByRole('button', { name: /save changes/i }));
    expect(await screen.findByText('This account does not exist on NEAR mainnet.')).toBeInTheDocument();
  });
});

describe('settings: treasury', () => {
  it('links to the Treasury page to create or manage the treasury', async () => {
    setup(makeSettings());
    expect(await screen.findByTestId('settings-treasury-link')).toHaveAttribute('href', '/treasury');
  });

  it('keeps the treasury account editable when no treasury was created in the app', async () => {
    setup(makeSettings());
    const field = await screen.findByTestId('settings-treasury-account');
    expect(field).not.toHaveAttribute('readonly');
    expect(screen.getByTestId('settings-treasury-link')).toHaveTextContent('Create or manage your treasury');
  });

  it('makes the treasury account read-only with a "Change in Treasury" link once a treasury exists', async () => {
    setup(makeSettings(), 'Owner', readyTreasury());
    await waitFor(() => expect(screen.getByTestId('settings-treasury-account')).toHaveAttribute('readonly'));
    expect(screen.getByTestId('settings-treasury-account')).toHaveAccessibleDescription(/To use another one, go to Treasury/);
    expect(screen.getByTestId('settings-treasury-link')).toHaveTextContent('Change in Treasury');
  });

  it('asks before switching to Live, stating the limits and that the agent pays automatically', async () => {
    const user = userEvent.setup();
    setup(makeSettings({ agentAccountId: 'f00dbabe00112233445566778899aabbccddeeff00112233445566778899aabb' }), 'Owner', readyTreasury());
    const puts: unknown[] = [];
    server.use(
      http.put('*/api/settings', async ({ request }) => {
        puts.push(await request.json());
        return HttpResponse.json(makeSettings({ executionMode: 'Live' }));
      }),
    );
    await user.click(await screen.findByTestId('mode-live'));
    await user.click(screen.getByRole('button', { name: /save changes/i }));
    const dialog = await screen.findByTestId('live-confirm-dialog');
    expect(dialog).toHaveTextContent('The agent will pay approved bills automatically');
    expect(within(dialog).getByTestId('live-confirm-limits')).toHaveTextContent('Up to $500.00 per payment.');
    expect(within(dialog).getByTestId('live-confirm-limits')).toHaveTextContent('Up to $1,500.00 per day and $20,000.00 per month.');
    expect(within(dialog).getByTestId('live-confirm-limits')).toHaveTextContent('Payments over $250.00 wait');
    expect(puts).toHaveLength(0);

    await user.click(within(dialog).getByTestId('live-confirm-dialog-cancel'));
    expect(puts).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: /save changes/i }));
    await user.click(await screen.findByTestId('live-confirm-dialog-confirm'));
    await waitFor(() => expect(puts).toEqual([expect.objectContaining({ executionMode: 'Live' })]));
  });

  it('drops the approval line when the threshold is at or above the max per payment (nothing can reach it)', async () => {
    const user = userEvent.setup();
    setup(makeSettings({ agentAccountId: 'f00dbabe00112233445566778899aabbccddeeff00112233445566778899aabb' }), 'Owner', readyTreasury(), {
      ...POLICY,
      approvalThresholdUsd: 500,
    });
    await user.click(await screen.findByTestId('mode-live'));
    await user.click(screen.getByRole('button', { name: /save changes/i }));
    const limits = within(await screen.findByTestId('live-confirm-dialog')).getByTestId('live-confirm-limits');
    expect(limits).toHaveTextContent('Up to $500.00 per payment.');
    expect(limits).toHaveTextContent('Up to $1,500.00 per day and $20,000.00 per month.');
    expect(limits).not.toHaveTextContent('wait for');
    expect(within(limits).queryByTestId('live-confirm-threshold')).not.toBeInTheDocument();
  });

  it('shows why Live was rejected and links to Treasury', async () => {
    const user = userEvent.setup();
    setup(makeSettings({ agentAccountId: 'f00dbabe00112233445566778899aabbccddeeff00112233445566778899aabb' }));
    server.use(
      http.put('*/api/settings', () =>
        HttpResponse.json(
          { title: 'Validation failed', status: 400, errors: { executionMode: ['This account is not a Tesorero treasury for this organization. Create it in Treasury.'] } },
          { status: 400 },
        ),
      ),
    );
    await user.click(await screen.findByTestId('mode-live'));
    await user.click(screen.getByRole('button', { name: /save changes/i }));
    // Real money: a confirmation first.
    await user.click(await screen.findByTestId('live-confirm-dialog-confirm'));
    const error = await screen.findByTestId('settings-mode-error');
    expect(error).toHaveTextContent('This account is not a Tesorero treasury for this organization.');
    expect(within(error).getByTestId('settings-mode-error-link')).toHaveAttribute('href', '/treasury');
  });
});
