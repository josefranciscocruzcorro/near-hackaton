import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { Policy } from '../api/types';
import { meHandler, problem } from '../test/fixtures';
import { server } from '../test/server';
import { renderRoutes, signInAs, USERS } from '../test/utils';
import { parseNum, PoliciesPage } from './Policies';

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
  categoryBudgets: { Supplier: 5000, Contractor: 1000, Payroll: 1000, Software: 500, Operations: 500, Marketing: 500 },
  version: 3,
  updatedAt: '2026-11-13T00:00:00Z',
  updatedBy: 'Olivia Owner',
};

function setup(path = '/policies') {
  signInAs('Owner');
  server.use(meHandler(USERS.Owner), http.get('*/api/policy', () => HttpResponse.json(POLICY)));
  return renderRoutes(
    [
      { path: '/policies', element: <PoliciesPage /> },
      { path: '/', element: <p>Overview page</p> },
    ],
    path,
  );
}

describe('policies', () => {
  it('explains the agent switch is Stop/Resume payments and does not freeze on-chain', async () => {
    setup();
    expect(await screen.findByTestId('policy-agent-enabled')).toHaveAccessibleDescription(/same as “Stop all payments”.*does not freeze the treasury on NEAR/);
  });

  it('warns before leaving with unsaved changes', async () => {
    const user = userEvent.setup();
    const { router } = setup();
    const field = await screen.findByLabelText(/Minimum reserve/);
    await user.clear(field);
    await user.type(field, '100');
    expect(screen.getByTestId('policy-dirty')).toBeInTheDocument();

    await router.navigate('/');
    await user.click(await screen.findByTestId('policy-unsaved-dialog-cancel'));
    expect(router.state.location.pathname).toBe('/policies');
    expect(screen.getByLabelText(/Minimum reserve/)).toHaveValue('100');

    await router.navigate('/');
    await user.click(await screen.findByTestId('policy-unsaved-dialog-confirm'));
    expect(await screen.findByText('Overview page')).toBeInTheDocument();
  });

  it('on a failed save, shows a toast and focuses the first field with an error', async () => {
    const user = userEvent.setup();
    setup();
    server.use(http.put('*/api/policy', () => problem(400, 'Validation failed', { dailyLimitUsd: ['The daily limit is too high for your treasury.'] })));
    await user.click(await screen.findByTestId('policy-save'));
    expect(await screen.findByText('Could not save the policy')).toBeInTheDocument();
    const daily = screen.getByLabelText(/Daily limit/);
    await waitFor(() => expect(daily).toHaveFocus());
    expect(daily).toHaveAccessibleDescription(/too high for your treasury/);
  });

  it('client-side errors also toast and focus the field', async () => {
    const user = userEvent.setup();
    setup();
    const max = await screen.findByLabelText(/Max per payment/);
    await user.clear(max);
    await user.type(max, 'abc');
    await user.click(screen.getByTestId('policy-save'));
    expect(await screen.findByText('Check the fields marked in red.')).toBeInTheDocument();
    await waitFor(() => expect(max).toHaveFocus());
  });

  it('accepts the Spanish decimal comma', () => {
    expect(parseNum('1250,50', false)).toBe(1250.5);
    expect(parseNum('1,250.50', false)).toBe(1250.5);
    expect(parseNum('1,250', false)).toBe(1250);
    expect(parseNum('12,5', true)).toBeNull();
  });
});
