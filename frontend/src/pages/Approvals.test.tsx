import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { ExecutionMode } from '../api/types';
import { makePayment, makeSettings, meHandler } from '../test/fixtures';
import { server } from '../test/server';
import { renderRoutes, signInAs, USERS } from '../test/utils';
import { ApprovalsPage } from './Approvals';

function setup(mode: ExecutionMode, simulation: boolean) {
  signInAs('Owner');
  const approved: string[] = [];
  const pending = makePayment({ status: 'PendingApproval', policyOutcome: 'RequireApproval', simulation });
  server.use(
    meHandler(USERS.Owner),
    http.get('*/api/settings', () => HttpResponse.json(makeSettings({ executionMode: mode }))),
    http.get('*/api/payments', () => HttpResponse.json(approved.length > 0 ? [] : [pending])),
    http.post('*/api/payments/:id/approve', ({ params }) => {
      approved.push(String(params.id));
      return HttpResponse.json({ ...pending, status: 'Approved' });
    }),
  );
  renderRoutes([{ path: '/approvals', element: <ApprovalsPage /> }], '/approvals');
  return { approved };
}

describe('approvals: real money', () => {
  it('in Live, confirms amount, supplier, network/token and address before approving', async () => {
    const user = userEvent.setup();
    const { approved } = setup('Live', false);
    await user.click(await screen.findByTestId('approve-button'));
    const dialog = await screen.findByTestId('approve-live-dialog');
    const details = within(dialog).getByTestId('approve-live-details');
    expect(details).toHaveTextContent('$1,250.50');
    expect(details).toHaveTextContent('Andes Coffee Co.');
    expect(details).toHaveTextContent('USDC · Ethereum (ERC20)');
    expect(details).toHaveTextContent('0x9f1c4b2a3d4e5f60718293a4b5c6d7e8f9012345');
    expect(approved).toHaveLength(0);
    await user.click(within(dialog).getByTestId('approve-live-dialog-confirm'));
    await waitFor(() => expect(approved).toEqual(['pay-1']));
  });

  it('in Simulation, approves right away', async () => {
    const user = userEvent.setup();
    const { approved } = setup('Simulation', true);
    await user.click(await screen.findByTestId('approve-button'));
    await waitFor(() => expect(approved).toEqual(['pay-1']));
    expect(screen.queryByTestId('approve-live-dialog-confirm')).not.toBeInTheDocument();
  });
});
