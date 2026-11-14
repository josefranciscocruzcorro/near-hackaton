import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Policy, TreasuryOverview } from '../../api/types';
import type { Lang } from '../../i18n';
import { buildOwnerTransaction, type OwnerTransaction } from '../../lib/ownerTx';
import { allChecks, meHandler, OWNER_WALLET, readyTreasury, SETUP_ACCOUNT } from '../../test/fixtures';
import { server } from '../../test/server';
import { renderRoutes, signInAs, USERS } from '../../test/utils';
import { TreasuryPage } from '../Treasury';

// A fake NEAR Wallet Selector: the real SDKs never load in tests (and could not sign anyway).
const wallet = vi.hoisted(() => ({
  account: null as string | null,
  listeners: new Set<(account: string | null) => void>(),
  shown: 0,
  sent: [] as OwnerTransaction[],
  failWith: null as Error | null,
}));

vi.mock('../../wallet/selector', () => ({
  loadOwnerWallet: () =>
    Promise.resolve({
      accountId: () => wallet.account,
      subscribe: (listener: (account: string | null) => void) => {
        wallet.listeners.add(listener);
        return () => wallet.listeners.delete(listener);
      },
      show: () => {
        wallet.shown++;
      },
      onHide: () => () => undefined,
      signOut: () => {
        wallet.account = null;
        return Promise.resolve();
      },
      send: (tx: OwnerTransaction) => {
        wallet.sent.push(tx);
        return wallet.failWith ? Promise.reject(wallet.failWith) : Promise.resolve('7xHash');
      },
    }),
}));

function connectAs(account: string | null) {
  act(() => {
    wallet.account = account;
    for (const l of wallet.listeners) l(account);
  });
}

afterEach(() => {
  wallet.account = null;
  wallet.listeners.clear();
  wallet.shown = 0;
  wallet.sent = [];
  wallet.failWith = null;
});

const POLICY = { agentEnabled: true, newPayeeCooldownHours: 48, version: 1 } as Policy;

function setup(treasury: TreasuryOverview = readyTreasury(), path = '/treasury', policy: Policy = POLICY, lang: Lang = 'en') {
  signInAs('Owner');
  const calls = { freeze: 0, stop: 0, resume: 0 };
  let current = treasury;
  let currentPolicy = policy;
  server.use(
    meHandler(USERS.Owner),
    http.get('*/api/treasury', () => HttpResponse.json(current)),
    http.get('*/api/treasury/fundings', () => HttpResponse.json([])),
    http.get('*/api/treasury/movements', () => HttpResponse.json({ accountId: SETUP_ACCOUNT, items: [], alerts: 0, error: null })),
    http.get('*/api/policy', () => HttpResponse.json(currentPolicy)),
    http.post('*/api/treasury/freeze', () => {
      calls.freeze++;
      current = { ...current, onChain: current.onChain ? { ...current.onChain, paused: true } : null };
      return HttpResponse.json(current);
    }),
    http.post('*/api/payments/stop', () => {
      calls.stop++;
      currentPolicy = { ...currentPolicy, agentEnabled: false, version: currentPolicy.version + 1 };
      return HttpResponse.json(currentPolicy);
    }),
    http.post('*/api/payments/resume', () => {
      calls.resume++;
      currentPolicy = { ...currentPolicy, agentEnabled: true, version: currentPolicy.version + 1 };
      return HttpResponse.json(currentPolicy);
    }),
  );
  const result = renderRoutes(
    [
      { path: '/treasury', element: <TreasuryPage /> },
      { path: '/policies', element: <p>Policies page</p> },
      { path: '/settings', element: <p>Settings page</p> },
    ],
    path,
    { lang },
  );
  return { ...result, calls };
}

const paused = () => {
  const t = readyTreasury({ checks: allChecks(true, ['notPaused']), readyForLive: false });
  return { ...t, onChain: t.onChain ? { ...t.onChain, paused: true } : null };
};

describe('owner actions: sign with my wallet', () => {
  it('opens the wallet picker and explains when another account signs in', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByTestId('wallet-connect'));
    await waitFor(() => expect(wallet.shown).toBe(1));

    connectAs('someone-else.near');
    const wrong = await screen.findByTestId('wallet-wrong-account');
    expect(wrong).toHaveTextContent(`You connected someone-else.near, but only ${OWNER_WALLET} can do these actions.`);
    await user.click(within(wrong).getByTestId('wallet-switch'));
    await waitFor(() => expect(wallet.shown).toBe(2));

    connectAs(OWNER_WALLET);
    expect(await screen.findByTestId('wallet-connected')).toHaveTextContent(`Connected: ${OWNER_WALLET}`);
  });

  it('withdraws: states exactly what will happen, then sends the exact transaction', async () => {
    const user = userEvent.setup();
    setup();
    const amount = await screen.findByTestId('owner-withdraw-amount');
    await user.click(screen.getByTestId('wallet-connect'));
    connectAs(OWNER_WALLET);
    await screen.findByTestId('wallet-connected');
    await user.clear(amount);
    await user.type(amount, '10');
    await user.click(screen.getByTestId('wallet-withdraw'));

    const dialog = await screen.findByTestId('wallet-confirm');
    expect(within(dialog).getByTestId('wallet-confirm-text')).toHaveTextContent(`You will withdraw 10.00 USDC from your treasury to ${OWNER_WALLET}.`);
    expect(wallet.sent).toHaveLength(0);
    await user.click(within(dialog).getByTestId('wallet-confirm-confirm'));

    await waitFor(() => expect(wallet.sent).toEqual([buildOwnerTransaction(SETUP_ACCOUNT, OWNER_WALLET, { kind: 'withdraw', amountRaw: '10000000' })]));
    expect(await screen.findByText('Withdrawal sent')).toBeInTheDocument();
    expect(screen.getByText(/Transaction 7xHash/)).toBeInTheDocument();
  });

  it('asks for the wallet first when not connected, then confirms once the owner signs in', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByTestId('wallet-limits'));
    await waitFor(() => expect(wallet.shown).toBe(1));
    expect(screen.queryByTestId('wallet-confirm-text')).not.toBeInTheDocument();

    connectAs(OWNER_WALLET);
    const text = await screen.findByTestId('wallet-confirm-text');
    expect(text).toHaveTextContent('You will change the on-chain limits to 50.00 USDC per payment and 100.00 USDC per day.');
    await user.click(screen.getByTestId('wallet-confirm-confirm'));
    await waitFor(() =>
      expect(wallet.sent).toEqual([buildOwnerTransaction(SETUP_ACCOUNT, OWNER_WALLET, { kind: 'setLimits', maxPerPaymentRaw: '50000000', dailyLimitRaw: '100000000' })]),
    );
  });

  it('formats amounts in Spanish in the confirmation', async () => {
    const user = userEvent.setup();
    signInAs('Owner');
    server.use(
      meHandler(USERS.Owner),
      http.get('*/api/treasury', () => HttpResponse.json(readyTreasury())),
      http.get('*/api/treasury/fundings', () => HttpResponse.json([])),
      http.get('*/api/treasury/movements', () => HttpResponse.json({ accountId: SETUP_ACCOUNT, items: [], alerts: 0, error: null })),
      http.get('*/api/policy', () => HttpResponse.json(POLICY)),
    );
    renderRoutes([{ path: '/treasury', element: <TreasuryPage /> }], '/treasury', { lang: 'es' });
    const amount = await screen.findByTestId('owner-withdraw-amount');
    await user.click(screen.getByTestId('wallet-connect'));
    connectAs(OWNER_WALLET);
    await user.clear(amount);
    await user.type(amount, '2,5');
    await user.click(screen.getByTestId('wallet-withdraw'));
    expect(await screen.findByTestId('wallet-confirm-text')).toHaveTextContent(`Vas a retirar 2,50 USDC de tu tesorería a ${OWNER_WALLET}.`);
  });

  it('says nothing was signed when the person closes the wallet', async () => {
    const user = userEvent.setup();
    wallet.failWith = new Error('User closed the window');
    setup(paused());
    await user.click(await screen.findByTestId('wallet-connect'));
    connectAs(OWNER_WALLET);
    await user.click(await screen.findByTestId('wallet-unpause'));
    expect(await screen.findByTestId('wallet-confirm-text')).toHaveTextContent('You will resume the treasury on NEAR');
    await user.click(screen.getByTestId('wallet-confirm-confirm'));
    expect(await screen.findByText('Nothing was signed')).toBeInTheDocument();
    expect(wallet.sent).toEqual([buildOwnerTransaction(SETUP_ACCOUNT, OWNER_WALLET, { kind: 'unpause' })]);
  });

  it('only offers to resume (unpause) when the treasury is frozen', async () => {
    setup();
    expect(await screen.findByTestId('wallet-unpause')).toHaveAttribute('aria-disabled', 'true');
  });

  it('does not show the amount error before the field is edited or the withdrawal is tried', async () => {
    const user = userEvent.setup();
    setup(readyTreasury({ balances: { treasuryUsdc: 0, treasuryNear: 1.95, agentNear: 0.3, readAt: new Date().toISOString() } }));
    const amount = await screen.findByTestId('owner-withdraw-amount');
    expect(amount).toHaveValue('0');
    const action = screen.getByTestId('owner-action-withdraw');
    expect(action).not.toHaveTextContent('Enter an amount greater than zero');
    expect(amount).not.toHaveAttribute('aria-invalid', 'true');

    // Trying to withdraw reveals it.
    await user.click(screen.getByTestId('wallet-withdraw'));
    expect(action).toHaveTextContent('Enter an amount greater than zero (up to 6 decimals).');
    // Nothing is asked of the wallet.
    expect(wallet.shown).toBe(0);
    expect(wallet.sent).toEqual([]);
  });

  it('shows the amount error once the field is edited', async () => {
    const user = userEvent.setup();
    setup();
    const amount = await screen.findByTestId('owner-withdraw-amount');
    expect(screen.getByTestId('owner-action-withdraw')).not.toHaveTextContent('Enter an amount greater than zero');
    await user.clear(amount);
    expect(screen.getByTestId('owner-action-withdraw')).toHaveTextContent('Enter an amount greater than zero (up to 6 decimals).');
    expect(screen.getByTestId('wallet-withdraw')).toHaveAttribute('aria-disabled', 'true');
  });

  it('refuses a withdrawal larger than the balance', async () => {
    const user = userEvent.setup();
    setup();
    const amount = await screen.findByTestId('owner-withdraw-amount');
    await user.clear(amount);
    await user.type(amount, '999');
    expect(screen.getByTestId('owner-action-withdraw')).toHaveTextContent('That is more than the treasury holds (250.00 USDC).');
    expect(screen.getByTestId('wallet-withdraw')).toHaveAttribute('aria-disabled', 'true');
  });

  it('shows a toast and refreshes after MyNearWallet redirects back', async () => {
    sessionStorage.setItem('tesorero.wallet.pending', 'withdraw');
    const { router } = setup(readyTreasury(), '/treasury?transactionHashes=9zHash');
    expect(await screen.findByText('Withdrawal sent')).toBeInTheDocument();
    expect(screen.getByText(/Transaction 9zHash/)).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.search).toBe(''));
  });

  it('explains a failed redirect', async () => {
    setup(readyTreasury(), '/treasury?errorCode=userRejected');
    expect(await screen.findByText('Nothing was signed')).toBeInTheDocument();
  });
});

describe('owner actions: freeze and stop', () => {
  it('freezes on-chain only after a strong confirmation, then offers the wallet unpause', async () => {
    const user = userEvent.setup();
    const { calls } = setup();
    await user.click(await screen.findByTestId('freeze-button'));
    const dialog = await screen.findByTestId('freeze-dialog');
    expect(dialog).toHaveTextContent('Only your wallet can unfreeze it.');
    await user.click(within(dialog).getByTestId('freeze-dialog-confirm'));
    expect(calls.freeze).toBe(0);
    await user.click(within(dialog).getByTestId('freeze-understood'));
    await user.click(within(dialog).getByTestId('freeze-dialog-confirm'));
    await waitFor(() => expect(calls.freeze).toBe(1));
    expect(await screen.findByTestId('treasury-frozen')).toHaveTextContent('The treasury is frozen on NEAR');
    expect(screen.getByTestId('frozen-unpause')).toBeInTheDocument();
  });

  it('shows "Frozen" right after freezing even while the chain read lags, and polls until NEAR confirms it', async () => {
    const user = userEvent.setup();
    setup();
    // The server caches chain reads for 15 s: the freeze response and the next reads still say "not paused".
    let chainPaused = false;
    let reads = 0;
    const stale = readyTreasury();
    const confirmed = paused();
    server.use(
      http.get('*/api/treasury', () => {
        reads++;
        return HttpResponse.json(chainPaused ? confirmed : stale);
      }),
      http.post('*/api/treasury/freeze', () => HttpResponse.json(stale)),
    );
    await user.click(await screen.findByTestId('freeze-button'));
    const dialog = await screen.findByTestId('freeze-dialog');
    await user.click(within(dialog).getByTestId('freeze-understood'));
    await user.click(within(dialog).getByTestId('freeze-dialog-confirm'));

    // Immediately frozen, from the POST response.
    expect(await screen.findByTestId('treasury-frozen')).toBeInTheDocument();
    expect(screen.getByTestId('treasury-paused')).toBeInTheDocument();
    expect(screen.getByTestId('check-notPaused-label')).toHaveTextContent('Paused: no payment can leave');
    expect(screen.queryByText(/^Not paused/)).not.toBeInTheDocument();

    // It polls every 2 s; a stale read does not flip it back to "Not paused".
    const before = reads;
    await waitFor(() => expect(reads).toBeGreaterThan(before), { timeout: 4000 });
    expect(screen.getByTestId('treasury-frozen')).toBeInTheDocument();
    expect(screen.getByTestId('check-notPaused-label')).toHaveTextContent('Paused: no payment can leave');

    // Once NEAR confirms, polling stops.
    chainPaused = true;
    const beforeConfirm = reads;
    await waitFor(() => expect(reads).toBeGreaterThan(beforeConfirm), { timeout: 4000 });
    const afterConfirm = reads;
    await new Promise((r) => setTimeout(r, 2500));
    expect(reads).toBe(afterConfirm);
    expect(screen.getByTestId('treasury-frozen')).toBeInTheDocument();
  }, 15_000);

  it('"Stop all payments" asks first and says it does not touch the money', async () => {
    const user = userEvent.setup();
    const { calls } = setup();
    await user.click(await screen.findByTestId('stop-payments-button'));
    const dialog = await screen.findByTestId('stop-payments-dialog');
    expect(dialog).toHaveTextContent('No payment will leave until you resume. This does not touch your money.');
    await user.click(within(dialog).getByTestId('stop-payments-dialog-confirm'));
    await waitFor(() => expect(calls.stop).toBe(1));
    // Once stopped, the same place offers to resume.
    await user.click(await screen.findByTestId('resume-payments-button'));
    await user.click(await screen.findByTestId('resume-payments-dialog-confirm'));
    await waitFor(() => expect(calls.resume).toBe(1));
  });
});

describe('readiness checklist', () => {
  it('shows the reserve check with what to do, and the paused wording in both states', async () => {
    setup(readyTreasury({ checks: allChecks(true, ['reserveCovered', 'notPaused']), readyForLive: false }));
    const reserve = await screen.findByTestId('check-reserveCovered');
    expect(within(reserve).getByTestId('check-reserveCovered-label')).toHaveTextContent('Your balance does not cover the minimum reserve');
    expect(within(reserve).getByTestId('check-reserveCovered-fix')).toHaveTextContent('Add funds or lower the minimum reserve in Policies.');
    expect(within(reserve).getByTestId('check-reserveCovered-policies')).toHaveAttribute('href', '/policies#minReserveUsd');
    expect(screen.getByTestId('check-notPaused-label')).toHaveTextContent('Paused: no payment can leave');
    // The failing state has its own description: never "accepts payments" next to "Paused".
    expect(screen.getByTestId('check-notPaused-meaning')).toHaveTextContent(
      'The treasury is frozen on NEAR. Only your wallet can unfreeze it (Resume, under “Sign with my wallet”).',
    );
    expect(screen.getByTestId('check-notPaused-meaning')).not.toHaveTextContent('accepts payments');
  });

  it('describes the frozen state in Spanish too', async () => {
    setup(readyTreasury({ checks: allChecks(true, ['notPaused']), readyForLive: false }), '/treasury', POLICY, 'es');
    expect(await screen.findByTestId('check-notPaused-meaning')).toHaveTextContent(
      'La tesorería está congelada en NEAR. Solo tu billetera puede descongelarla (Reanudar, en «Firmar con mi billetera»).',
    );
  });

  it('reads "Not paused" when it is not', async () => {
    setup();
    expect(await screen.findByTestId('check-notPaused-label')).toHaveTextContent(/^Not paused/);
    expect(screen.getByTestId('check-notPaused-meaning')).toHaveTextContent('The treasury on NEAR accepts payments within its limits.');
    expect(screen.getByTestId('check-reserveCovered-label')).toHaveTextContent(/^Your balance covers the minimum reserve/);
  });
});
