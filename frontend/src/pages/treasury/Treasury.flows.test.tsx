import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { CreateFundingRequest, Funding, Role, TreasuryMovements, TreasuryOverview } from '../../api/types';
import {
  AGENT_ACCOUNT,
  allChecks,
  FUNDING_ASSETS,
  makeFunding,
  makeMovement,
  makeTreasury,
  meHandler,
  problem,
  readyTreasury,
  SETUP_ACCOUNT,
  USDC_CONTRACT,
} from '../../test/fixtures';
import { server } from '../../test/server';
import { renderRoutes, signInAs, USERS } from '../../test/utils';
import { TreasuryPage } from '../Treasury';

interface State {
  treasury: TreasuryOverview;
  fundings: Funding[];
  movements: TreasuryMovements;
}

function setup(initial: Partial<State> & { treasury: TreasuryOverview }, role: Role = 'Owner', path = '/treasury') {
  signInAs(role);
  const state: State = {
    fundings: [],
    movements: { accountId: initial.treasury.treasuryAccountId, items: [], alerts: 0, error: null },
    ...initial,
  };
  const calls = { fundings: [] as CreateFundingRequest[] };
  server.use(
    meHandler(USERS[role]),
    http.get('*/api/treasury', () => HttpResponse.json(state.treasury)),
    http.get('*/api/treasury/fundings', () => HttpResponse.json(state.fundings)),
    http.get('*/api/treasury/movements', () => HttpResponse.json(state.movements)),
    http.get('*/api/treasury/funding-options', () => HttpResponse.json({ assets: FUNDING_ASSETS })),
  );
  renderRoutes(
    [
      { path: '/treasury', element: <TreasuryPage /> },
      { path: '/policies', element: <p>Policies page</p> },
      { path: '/payments/:id', element: <p>Payment page</p> },
    ],
    path,
  );
  return { state, calls };
}

describe('treasury: funding', () => {
  it('creates a cross-chain funding (USDT on BNB Smart Chain recommended) and tracks it', async () => {
    const user = userEvent.setup();
    const { state, calls } = setup({ treasury: readyTreasury() });
    server.use(
      http.post('*/api/treasury/fundings', async ({ request }) => {
        const body = (await request.json()) as CreateFundingRequest;
        calls.fundings.push(body);
        const created = makeFunding({ amountIn: body.amount, refundAddress: body.refundAddress });
        // The server already saw the deposit by the time the list is refetched.
        state.fundings = [{ ...created, status: 'Processing' }];
        return HttpResponse.json(created, { status: 201 });
      }),
    );
    await user.click(await screen.findByTestId('fund-button'));
    const dialog = await screen.findByTestId('fund-dialog');
    const asset = await within(dialog).findByTestId('fund-asset');
    expect(asset).toHaveValue(FUNDING_ASSETS[0]?.assetId);
    expect(within(asset).getByRole('option', { name: 'USDT · BNB Smart Chain (BEP20) ★' })).toBeInTheDocument();
    expect(within(dialog).getByTestId('fund-asset')).toHaveAccessibleDescription(/Recommended if your money is in Binance/);
    expect(within(asset).getByRole('option', { name: 'USDT · Tron (TRC20)' })).toBeInTheDocument();
    expect(within(asset).getByRole('group', { name: 'USDC' })).toBeInTheDocument();
    expect(dialog).toHaveTextContent('Tron sometimes needs at least $100');
    expect(within(dialog).getByTestId('fund-refund')).toHaveAccessibleDescription(/use your Binance deposit address for USDT on BNB Smart Chain \(BEP20\)/);

    await user.type(within(dialog).getByTestId('fund-amount'), '150');
    await user.type(within(dialog).getByTestId('fund-refund'), '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');
    await user.click(within(dialog).getByTestId('fund-submit'));
    await waitFor(() =>
      expect(calls.fundings).toEqual([{ originAssetId: FUNDING_ASSETS[0]?.assetId, amount: 150, refundAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' }]),
    );

    const instructions = await within(dialog).findByTestId('fund-instructions');
    expect(within(instructions).getByTestId('fund-amount-exact')).toHaveTextContent('150.00 USDT');
    expect(within(instructions).getByTestId('fund-network')).toHaveTextContent('BNB Smart Chain (BEP20)');
    expect(within(instructions).getByTestId('fund-deposit-address')).toHaveTextContent('0x1234567890abcdef1234567890abcdef12345678');
    expect(within(instructions).getByTestId('fund-deposit-qr')).toHaveAttribute('data-value', '0x1234567890abcdef1234567890abcdef12345678');
    expect(within(instructions).getByTestId('fund-deadline')).toHaveTextContent(/left/);
    expect(within(instructions).getByTestId('fund-warnings')).toHaveTextContent('Send exactly 150.00 USDT');
    expect(within(instructions).queryByTestId('fund-deposit-memo')).not.toBeInTheDocument();
    // The status follows the server (polled list).
    await waitFor(() => expect(within(dialog).getByTestId('fund-status')).toHaveTextContent('Converting'));
    expect(await screen.findByTestId('funding-row')).toHaveAttribute('data-status', 'Processing');
  });

  it('validates the form before asking for a quote', async () => {
    const user = userEvent.setup();
    const { calls } = setup({ treasury: readyTreasury() });
    await user.click(await screen.findByTestId('fund-button'));
    const dialog = await screen.findByTestId('fund-dialog');
    await within(dialog).findByTestId('fund-asset');
    await user.type(within(dialog).getByTestId('fund-refund'), 'not-an-evm-address');
    await user.click(within(dialog).getByTestId('fund-submit'));
    expect(within(dialog).getByTestId('fund-amount')).toHaveAccessibleDescription(/Enter an amount like 150/);
    expect(within(dialog).getByTestId('fund-refund')).toHaveAccessibleDescription(/does not look like a valid BNB Smart Chain \(BEP20\) address/);
    expect(calls.fundings).toHaveLength(0);
  });

  it('shows the 1Click minimum amount error under the amount field', async () => {
    const user = userEvent.setup();
    setup({ treasury: readyTreasury() });
    server.use(http.post('*/api/treasury/fundings', () => problem(400, 'Validation failed', { amount: ['Temporary swap limits: minimum swap amount is $100'] })));
    await user.click(await screen.findByTestId('fund-button'));
    const dialog = await screen.findByTestId('fund-dialog');
    await user.selectOptions(await within(dialog).findByTestId('fund-asset'), FUNDING_ASSETS[2]?.assetId ?? '');
    await user.type(within(dialog).getByTestId('fund-amount'), '20');
    await user.type(within(dialog).getByTestId('fund-refund'), 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf');
    await user.click(within(dialog).getByTestId('fund-submit'));
    await waitFor(() => expect(within(dialog).getByTestId('fund-amount')).toHaveAccessibleDescription(/minimum swap amount is \$100/));
    expect(within(dialog).queryByTestId('fund-instructions')).not.toBeInTheDocument();
  });

  it('shows a provider refusal (errors.funding) above the button, not under the amount', async () => {
    const user = userEvent.setup();
    setup({ treasury: readyTreasury() });
    server.use(http.post('*/api/treasury/fundings', () => problem(400, 'Validation failed', { funding: ['Failed to get quote: tokenIn is not supported'] })));
    await user.click(await screen.findByTestId('fund-button'));
    const dialog = await screen.findByTestId('fund-dialog');
    await within(dialog).findByTestId('fund-asset');
    await user.type(within(dialog).getByTestId('fund-amount'), '150');
    await user.type(within(dialog).getByTestId('fund-refund'), '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');
    await user.click(within(dialog).getByTestId('fund-submit'));
    const error = await within(dialog).findByTestId('fund-form-error');
    expect(error).toHaveTextContent('The conversion service could not prepare this deposit');
    expect(error).toHaveTextContent('Try another amount or network');
    expect(within(error).getByTestId('fund-form-error-detail')).toHaveTextContent('Failed to get quote: tokenIn is not supported');
    expect(within(dialog).getByTestId('fund-amount')).not.toHaveAttribute('aria-invalid');
  });

  it('calls the list "fundings from other networks" and says where direct USDC deposits appear', async () => {
    setup({ treasury: readyTreasury() });
    const card = await screen.findByTestId('treasury-funding');
    expect(card).toHaveTextContent('Fundings from other networks');
    expect(within(card).getByTestId('fundings-direct-note')).toHaveTextContent('shows up in Movements and in the balance');
  });

  it('explains USDC on NEAR with the treasury address and the exact token', async () => {
    const user = userEvent.setup();
    setup({ treasury: readyTreasury() });
    await user.click(await screen.findByTestId('fund-button'));
    const dialog = await screen.findByTestId('fund-dialog');
    await user.click(within(dialog).getByTestId('fund-option-near'));
    expect(within(dialog).getByTestId('fund-near-address')).toHaveTextContent(SETUP_ACCOUNT);
    expect(within(dialog).getByTestId('fund-near-qr')).toHaveAttribute('data-value', SETUP_ACCOUNT);
    expect(dialog).toHaveTextContent(USDC_CONTRACT);
    expect(within(dialog).getByTestId('fund-near-warnings')).toHaveTextContent('Never send USDC to the agent');
  });

  it('reopens the instructions of a pending funding from the recent list, memo included', async () => {
    const user = userEvent.setup();
    setup({ treasury: readyTreasury(), fundings: [makeFunding({ depositMemo: '123456', chain: 'tron', chainName: 'Tron', amountIn: 120.5 })] });
    const row = await screen.findByTestId('funding-row');
    expect(row).toHaveTextContent('120.50 USDT');
    await user.click(within(row).getByTestId('funding-open'));
    const dialog = await screen.findByTestId('fund-dialog');
    expect(within(dialog).getByTestId('fund-deposit-memo')).toHaveTextContent('123456');
    expect(within(dialog).getByTestId('fund-memo-warning')).toBeInTheDocument();
    expect(within(dialog).getByTestId('fund-network')).toHaveTextContent('Tron (TRC20)');
  });

  it('opens the dialog from the command palette link (?fund=1)', async () => {
    setup({ treasury: readyTreasury() }, 'Owner', '/treasury?fund=1');
    expect(await screen.findByTestId('fund-dialog')).toHaveAttribute('open');
  });

  it('keeps Add funds disabled until the treasury is created and locked', async () => {
    setup({ treasury: readyTreasury({ setup: null, checks: allChecks(true, ['locked']), readyForLive: false }) });
    const button = await screen.findByTestId('fund-button');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAccessibleDescription(/Create and lock your treasury first/);
  });

  it('is Owner-only', async () => {
    setup({ treasury: readyTreasury() }, 'Auditor');
    expect(await screen.findByTestId('fund-button')).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('treasury: movements', () => {
  it('flags USDC that left without Tesorero and raises a banner', async () => {
    const user = userEvent.setup();
    setup({
      treasury: readyTreasury(),
      movements: {
        accountId: SETUP_ACCOUNT,
        alerts: 1,
        error: null,
        items: [
          makeMovement({ txHash: 'TxEvil', direction: 'out', amount: 90, counterparty: 'thief.near', kind: 'other', flagged: true }),
          makeMovement({ txHash: 'TxPay', direction: 'out', amount: 40, kind: 'payment', paymentId: 'pay-1', reference: 'INV-1001', counterparty: 'intents.near' }),
          makeMovement({ txHash: 'TxFund', direction: 'in', amount: 250, kind: 'funding' }),
          makeMovement({ txHash: 'TxSetup', direction: 'out', asset: 'NEAR', amount: 0.3, kind: 'setup', counterparty: AGENT_ACCOUNT }),
        ],
      },
    });
    const banner = await screen.findByTestId('movements-alert');
    expect(banner).toHaveRole('alert');
    expect(banner).toHaveTextContent('Money left the treasury that Tesorero did not send. Pause the treasury now');
    expect(within(banner).getByTestId('movements-alert-pause')).toHaveAttribute('href', '/policies');

    const rows = await screen.findAllByTestId('movement-row');
    expect(rows).toHaveLength(4);
    const [evil, pay, fund, created] = rows as [HTMLElement, HTMLElement, HTMLElement, HTMLElement];
    expect(evil).toHaveAttribute('data-flagged', 'true');
    expect(evil).toHaveTextContent('Not sent by Tesorero');
    expect(evil).toHaveTextContent('−90.00');
    expect(within(evil).getByRole('link', { name: /Transaction/ })).toHaveAttribute('href', 'https://nearblocks.io/txns/TxEvil');
    expect(pay).toHaveAttribute('data-flagged', 'false');
    expect(pay).toHaveTextContent('Tesorero payment · INV-1001');
    expect(fund).toHaveTextContent('+250.00');
    expect(fund).toHaveTextContent('Funding');
    expect(created).toHaveTextContent('Treasury creation');
    expect(created).toHaveTextContent('0.3000');
    await user.click(within(pay).getByTestId('movement-payment-link'));
    expect(await screen.findByText('Payment page')).toBeInTheDocument();
  });

  it('degrades gracefully when the indexer does not answer', async () => {
    setup({ treasury: readyTreasury(), movements: { accountId: SETUP_ACCOUNT, items: [], alerts: 0, error: 'NearBlocks timeout' } });
    expect(await screen.findByTestId('movements-error')).toHaveTextContent('NearBlocks timeout');
    expect(screen.queryByTestId('movements-alert')).not.toBeInTheDocument();
    expect(screen.getByTestId('balance-usdc')).toBeInTheDocument();
  });
});

describe('treasury: public demo', () => {
  it('is read-only with an explanation, and never posts', async () => {
    const user = userEvent.setup();
    let posts = 0;
    setup({ treasury: makeTreasury({ demo: true }) });
    server.use(
      http.post('*/api/treasury/setup', () => {
        posts++;
        return problem(403, 'The public demo never moves real money.');
      }),
    );
    expect(await screen.findByTestId('treasury-demo')).toHaveTextContent('never moves real money');
    expect(screen.getByTestId('setup-owner')).toBeDisabled();
    const submit = screen.getByTestId('setup-submit');
    expect(submit).toHaveAttribute('aria-disabled', 'true');
    expect(submit).toHaveAccessibleDescription(/Not available on the public demo/);
    await user.click(submit);
    expect(posts).toBe(0);
  });

  it('blocks funding on a demo treasury', async () => {
    setup({ treasury: readyTreasury({ demo: true }) });
    const button = await screen.findByTestId('fund-button');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAccessibleDescription(/Not available on the public demo/);
  });
});

describe('treasury: Spanish', () => {
  it('speaks plain Spanish', async () => {
    signInAs('Owner');
    server.use(meHandler(USERS.Owner), http.get('*/api/treasury', () => HttpResponse.json(makeTreasury())));
    renderRoutes([{ path: '/treasury', element: <TreasuryPage /> }], '/treasury', { lang: 'es' });
    expect(await screen.findByText('Cómo está organizado tu dinero')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Crea tu tesorería' })).toBeInTheDocument();
  });
});
