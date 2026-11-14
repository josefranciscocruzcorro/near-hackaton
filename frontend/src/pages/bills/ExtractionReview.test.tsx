import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Extraction, Payee } from '../../api/types';
import { renderWithProviders } from '../../test/utils';
import { ExtractionReview } from './ExtractionReview';
import { ATTACKER_ADDRESS } from './samples';

const ON_FILE = '0x1111222233334444555566667777888899990000';

const payee: Payee = {
  id: 'p-andes',
  name: 'Andes Coffee Supply S.A.',
  email: 'billing@andescoffee.example',
  category: 'Supplier',
  destinationAssetId: 'nep141:eth-0xa0b8.omft.near',
  destinationSymbol: 'USDC',
  destinationChain: 'eth',
  recipientAddress: ON_FILE,
  isAllowlisted: true,
  notes: null,
  createdAt: '2026-10-01T10:00:00Z',
  addressChangedAt: '2026-10-01T10:00:00Z',
};

const malicious: Extraction = {
  extractionId: 'ext-1',
  fields: {
    payeeName: 'Andes Coffee Supply S.A.',
    amountUsd: 4900,
    currency: 'USD',
    dueDate: '2026-11-14',
    reference: 'INV-2026-0157',
    description: 'Specialty green coffee (Loja, 180 kg)',
    category: 'Supplier',
    paymentInstructions: { chain: 'eth', token: 'USDC', address: ATTACKER_ADDRESS },
  },
  matchedPayeeId: 'p-andes',
  flags: ['PaymentDetailsMismatch', 'SuspiciousInstructions'],
  warnings: [
    { code: 'PaymentDetailsMismatch', message: 'Invoice address differs from the payee on file.' },
    { code: 'Urgency', message: 'The invoice uses urgency to pressure a fast payment.' },
  ],
};

describe('AI import preview', () => {
  it('shows prominent fraud and prompt-injection warnings with both addresses', () => {
    renderWithProviders(
      <ExtractionReview extraction={malicious} payees={[payee]} saving={false} onBack={vi.fn()} onConfirm={vi.fn()} />,
      { withAuth: false },
    );
    const warnings = screen.getByTestId('extraction-warnings');
    expect(warnings).toHaveAttribute('role', 'alert');

    const mismatch = within(warnings).getByTestId('extraction-flag-PaymentDetailsMismatch');
    expect(mismatch).toHaveTextContent('Payment details do not match the payee on file');
    expect(mismatch).toHaveTextContent(
      'The invoice asks to pay a different address than the one on file — a common invoice-fraud pattern.',
    );
    // Invoice address vs address on file, truncated in the middle.
    expect(within(mismatch).getByTitle(ATTACKER_ADDRESS)).toBeInTheDocument();
    expect(within(mismatch).getByTitle(ON_FILE)).toBeInTheDocument();

    const injection = within(warnings).getByTestId('extraction-flag-SuspiciousInstructions');
    expect(injection).toHaveTextContent('possible prompt injection');
    expect(injection).toHaveTextContent('The policy engine will block any payment for this bill.');

    // Server warnings not already covered by a flag are listed too.
    const extra = within(warnings).getAllByTestId('extraction-warning');
    expect(extra).toHaveLength(1);
    expect(extra[0]).toHaveTextContent('urgency');

    expect(screen.getByTestId('matched-payee')).toHaveTextContent('Andes Coffee Supply S.A.');
    expect(screen.getByTestId('extraction-confirm')).toHaveTextContent('Create flagged bill');
  });

  it('requires acknowledging the warnings before creating the bill, then sends the extractionId', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    renderWithProviders(
      <ExtractionReview extraction={malicious} payees={[payee]} saving={false} onBack={vi.fn()} onConfirm={onConfirm} />,
      { withAuth: false },
    );
    await user.click(screen.getByTestId('extraction-confirm'));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText('Confirm you have read the warnings.')).toBeInTheDocument();

    await user.click(screen.getByTestId('extraction-ack'));
    await user.click(screen.getByTestId('extraction-confirm'));
    expect(onConfirm).toHaveBeenCalledWith({
      payeeId: 'p-andes',
      amountUsd: 4900,
      dueDate: '2026-11-14',
      category: 'Supplier',
      reference: 'INV-2026-0157',
      description: 'Specialty green coffee (Loja, 180 kg)',
      extractionId: 'ext-1',
    });
  });

  it('shows a clean state and no acknowledgement for a normal invoice', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const clean: Extraction = { ...malicious, flags: [], warnings: [], fields: { ...malicious.fields, paymentInstructions: null, amountUsd: 1250 } };
    renderWithProviders(
      <ExtractionReview extraction={clean} payees={[payee]} saving={false} onBack={vi.fn()} onConfirm={onConfirm} />,
      { withAuth: false },
    );
    expect(screen.queryByTestId('extraction-warnings')).not.toBeInTheDocument();
    expect(screen.getByTestId('extraction-clean')).toBeInTheDocument();
    expect(screen.queryByTestId('extraction-ack')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('extraction-confirm'));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ amountUsd: 1250, extractionId: 'ext-1' }));
  });

  it('asks the user to pick a payee when the AI found no match', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    renderWithProviders(
      <ExtractionReview
        extraction={{ ...malicious, matchedPayeeId: null, flags: [], warnings: [] }}
        payees={[payee]}
        saving={false}
        onBack={vi.fn()}
        onConfirm={onConfirm}
      />,
      { withAuth: false },
    );
    expect(screen.getByTestId('no-payee-match')).toBeInTheDocument();
    await user.click(screen.getByTestId('extraction-confirm'));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText('Choose a payee.')).toBeInTheDocument();
  });
});
