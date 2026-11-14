import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PolicyReason } from '../api/types';
import { renderWithProviders } from '../test/utils';
import { ReasoningCard } from './ReasoningCard';

const reasons: PolicyReason[] = [
  { code: 'WithinPolicy', message: 'Daily and monthly limits respected.', severity: 'info' },
  { code: 'AboveApprovalThreshold', message: '$2,400.00 is above the $1,000.00 approval threshold.', severity: 'warn' },
  { code: 'SuspiciousInstructions', message: 'Invoice tries to instruct the agent.', severity: 'block' },
];

describe('ReasoningCard', () => {
  it('shows the AI reason, the policy verdict and every rule, most severe first', () => {
    renderWithProviders(
      <ReasoningCard aiReason="Due in 2 days and within budget." outcome="RequireApproval" reasons={reasons} />,
      { withAuth: false },
    );
    expect(screen.getByText('Due in 2 days and within budget.')).toBeInTheDocument();
    expect(screen.getByTestId('policy-outcome-chip')).toHaveTextContent('Requires approval');

    const items = screen.getAllByTestId('policy-reason');
    expect(items.map((i) => i.dataset.severity)).toEqual(['block', 'warn', 'info']);
    expect(items[0]).toHaveTextContent('Suspicious instructions');
    expect(items[0]).toHaveTextContent('Invoice tries to instruct the agent.');
    // Severity is conveyed as text for screen readers, not only by colour.
    const item = (i: number): HTMLElement => {
      const el = items[i];
      if (!el) throw new Error(`missing reason ${String(i)}`);
      return el;
    };
    expect(within(item(0)).getByText(/Blocking/)).toBeInTheDocument();
    expect(within(item(1)).getByText(/Warning/)).toBeInTheDocument();
  });

  it('handles unknown (newer) reason codes by showing the server message with its severity', () => {
    renderWithProviders(
      <ReasoningCard
        aiReason={null}
        outcome="Block"
        reasons={[{ code: 'SomeFutureRule', message: 'A brand-new guardrail fired.', severity: 'block' }]}
      />,
      { withAuth: false },
    );
    const item = screen.getByTestId('policy-reason');
    expect(item).toHaveTextContent('A brand-new guardrail fired.');
    expect(item).not.toHaveTextContent('SomeFutureRule');
    expect(item).toHaveAttribute('data-severity', 'block');
    expect(screen.getByText('No AI explanation was provided.')).toBeInTheDocument();
  });

  it('renders newly added contract codes with their localized title', () => {
    renderWithProviders(
      <ReasoningCard
        aiReason="x"
        outcome="RequireApproval"
        reasons={[{ code: 'TreasuryBalanceUnknown', message: 'Balance could not be read.', severity: 'warn' }]}
      />,
      { withAuth: false, lang: 'es' },
    );
    expect(screen.getByTestId('policy-reason')).toHaveTextContent('Saldo de tesorería desconocido');
    expect(screen.getByTestId('policy-outcome-chip')).toHaveTextContent('Requiere aprobación');
  });

  it('shows "not evaluated" when there is no outcome', () => {
    renderWithProviders(<ReasoningCard aiReason="Defer" outcome={null} reasons={[]} />, { withAuth: false });
    expect(screen.getByText('Not evaluated')).toBeInTheDocument();
    expect(screen.getByText('No rules were reported.')).toBeInTheDocument();
  });
});
