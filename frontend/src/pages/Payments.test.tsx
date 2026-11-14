import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { Payment } from '../api/types';
import { makePayment, meHandler } from '../test/fixtures';
import { server } from '../test/server';
import { renderRoutes, signInAs, USERS } from '../test/utils';
import { PaymentsPage } from './Payments';

function setup(payment: Payment) {
  signInAs('Owner');
  server.use(
    meHandler(USERS.Owner),
    http.get('*/api/payments', () => HttpResponse.json([payment])),
    http.get('*/api/payments/:id', () => HttpResponse.json(payment)),
  );
  renderRoutes(
    [
      { path: '/payments', element: <PaymentsPage /> },
      { path: '/payments/:paymentId', element: <PaymentsPage /> },
    ],
    `/payments/${payment.id}`,
  );
}

describe('payment detail (real money)', () => {
  it('links the agent-signed on-chain transaction and shows the failure reason', async () => {
    setup(
      makePayment({
        status: 'Failed',
        onChainTxHash: '8kXq3vGf2N1sYc4WbP7tRz9LmD5hJ6aE',
        onChainTxUrl: 'https://nearblocks.io/txns/8kXq3vGf2N1sYc4WbP7tRz9LmD5hJ6aE',
        lastError: 'Quote expired before the deposit was confirmed.',
      }),
    );
    const detail = await screen.findByTestId('payment-detail');
    expect(within(detail).getByTestId('onchain-tx-link')).toHaveAttribute('href', 'https://nearblocks.io/txns/8kXq3vGf2N1sYc4WbP7tRz9LmD5hJ6aE');
    expect(within(detail).getByTestId('payment-last-error')).toHaveTextContent('Quote expired before the deposit was confirmed.');
    expect(within(detail).queryByText('Submit deposit')).not.toBeInTheDocument();
  });

  it('says NEAR Intents is delivering while Processing and hides the manual deposit form', async () => {
    setup(makePayment({ status: 'Processing', lastError: null }));
    const detail = await screen.findByTestId('payment-detail');
    expect(within(detail).getByTestId('payment-status-hint')).toHaveTextContent('NEAR Intents is delivering the funds');
    expect(within(detail).queryByTestId('payment-last-error')).not.toBeInTheDocument();
    expect(within(detail).queryByText('Submit deposit')).not.toBeInTheDocument();
  });

  it('keeps the manual deposit form only while AwaitingDeposit', async () => {
    setup(makePayment({ status: 'AwaitingDeposit' }));
    const detail = await screen.findByTestId('payment-detail');
    expect(within(detail).getByRole('button', { name: 'Submit deposit' })).toBeInTheDocument();
    expect(within(detail).getByTestId('payment-status-hint')).toHaveTextContent('Live (manual)');
  });
});
