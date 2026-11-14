import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PAYMENT_STATUSES, type PaymentStatus } from '../api/types';
import { en } from '../i18n/en';
import { PAYMENT_STATUS_VISUAL, type Tone } from '../lib/status';
import { renderWithProviders } from '../test/utils';
import { OutcomeChip, PaymentStatusChip } from './StatusChips';

const EXPECTED_TONE: Record<PaymentStatus, Tone> = {
  PendingApproval: 'warning',
  Approved: 'info',
  Blocked: 'danger',
  Rejected: 'danger',
  AwaitingDeposit: 'warning',
  Processing: 'info',
  Settled: 'success',
  Refunded: 'neutral',
  Failed: 'danger',
};

describe('payment status chip mapping', () => {
  it('maps every contract status to a tone and an icon', () => {
    for (const s of PAYMENT_STATUSES) {
      expect(PAYMENT_STATUS_VISUAL[s].tone, s).toBe(EXPECTED_TONE[s]);
      expect(PAYMENT_STATUS_VISUAL[s].icon, s).toBeTruthy();
    }
  });

  it.each(PAYMENT_STATUSES)('renders %s with icon + text, never colour alone', (status) => {
    renderWithProviders(<PaymentStatusChip status={status} />, { withAuth: false });
    const chip = screen.getByTestId('payment-status-chip');
    expect(chip).toHaveTextContent(en[`paymentStatus.${status}`]);
    expect(chip).toHaveAttribute('data-tone', EXPECTED_TONE[status]);
    expect(chip.querySelector('svg')).not.toBeNull();
  });

  it('localises labels', () => {
    renderWithProviders(<PaymentStatusChip status="PendingApproval" />, { withAuth: false, lang: 'es' });
    expect(screen.getByTestId('payment-status-chip')).toHaveTextContent('Pendiente de aprobación');
  });

  it('renders policy outcomes', () => {
    renderWithProviders(<OutcomeChip outcome="Block" />, { withAuth: false });
    expect(screen.getByTestId('policy-outcome-chip')).toHaveTextContent('Blocked');
    expect(screen.getByTestId('policy-outcome-chip')).toHaveAttribute('data-tone', 'danger');
  });
});
