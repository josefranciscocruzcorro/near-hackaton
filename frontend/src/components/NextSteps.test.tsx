import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { PolicyOutcome, PolicyReason, Role } from '../api/types';
import { ProposalChip } from '../pages/Agent';
import { meHandler } from '../test/fixtures';
import { server } from '../test/server';
import { renderRoutes, signInAs, USERS } from '../test/utils';
import { ReasoningCard } from './ReasoningCard';

const reason = (code: string, severity: PolicyReason['severity'] = 'block'): PolicyReason => ({ code, message: `${code} fired.`, severity });

function show(outcome: PolicyOutcome, reasons: PolicyReason[], role: Role = 'Owner') {
  signInAs(role);
  server.use(meHandler(USERS[role]), http.get('*/api/policy', () => HttpResponse.json({ newPayeeCooldownHours: 72 })));
  renderRoutes([{ path: '/', element: <ReasoningCard aiReason="Due soon." outcome={outcome} reasons={reasons} payeeId="p-9" /> }], '/');
}

describe('next steps for a blocked payment', () => {
  it('offers "Allow this supplier" for a supplier without automatic payments', async () => {
    show('Block', [reason('PayeeNotAllowlisted')]);
    expect(await screen.findByTestId('next-allow-payee')).toHaveAttribute('href', '/payees?edit=p-9&allow=1');
  });

  it('asks other roles to contact an owner instead', async () => {
    show('Block', [reason('PayeeNotAllowlisted')], 'Approver');
    expect(await screen.findByTestId('next-steps')).toHaveTextContent('Ask an owner to turn on automatic payments');
    expect(screen.queryByTestId('next-allow-payee')).not.toBeInTheDocument();
  });

  it('offers to lower the reserve or add funds when the reserve would break', async () => {
    show('Block', [reason('BelowReserve')]);
    expect(await screen.findByTestId('next-lower-reserve')).toHaveAttribute('href', '/policies#minReserveUsd');
    expect(screen.getByTestId('next-add-funds')).toHaveAttribute('href', '/treasury?fund=1');
  });

  it('explains the waiting period of a new supplier with the policy hours', async () => {
    show('RequireApproval', [reason('NewPayeeCooldown', 'warn')]);
    await waitFor(() => expect(screen.getByTestId('next-cooldown')).toHaveTextContent('during the first 72 h a person must approve each payment'));
  });

  it('shows nothing for rules without a next step', () => {
    show('Block', [reason('ExceedsDailyLimit')]);
    expect(screen.queryByTestId('next-steps')).not.toBeInTheDocument();
  });
});

describe('AI proposal chip', () => {
  function chip(payNow: boolean, outcome: PolicyOutcome | null) {
    renderRoutes([{ path: '/', element: <ProposalChip payNow={payNow} outcome={outcome} drill={false} /> }], '/', { withAuth: false });
    return screen.getByTestId('ai-proposal');
  }

  it('is green "Pay now" only when the policy allowed it', () => {
    const el = chip(true, 'Allow');
    expect(el).toHaveTextContent('Pay now');
    expect(el).toHaveAttribute('data-tone', 'success');
  });

  it('is neutral next to a Blocked verdict', () => {
    const el = chip(true, 'Block');
    expect(el).toHaveTextContent('AI proposed: pay');
    expect(el).not.toHaveAttribute('data-tone', 'success');
  });
});
