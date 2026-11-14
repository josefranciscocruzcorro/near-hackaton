import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { CreateFundingRequest, CreateTreasurySetupRequest, Funding, Role, TreasuryMovements, TreasuryOverview } from '../api/types';
import {
  AGENT_ACCOUNT,
  allChecks,
  CODE_HASH,
  FUNDING_ASSETS,
  makeSetup,
  makeTreasury,
  meHandler,
  OWNER_WALLET,
  problem,
  readySetup,
  readyTreasury,
  SETUP_ACCOUNT,
} from '../test/fixtures';
import { server } from '../test/server';
import { renderRoutes, signInAs, USERS } from '../test/utils';
import { TreasuryPage } from './Treasury';

interface State {
  treasury: TreasuryOverview;
  fundings: Funding[];
  movements: TreasuryMovements;
}

function setup(initial: Partial<State> & { treasury: TreasuryOverview }, role: Role = 'Owner') {
  signInAs(role);
  const state: State = {
    fundings: [],
    movements: { accountId: initial.treasury.treasuryAccountId, items: [], alerts: 0, error: null },
    ...initial,
  };
  const calls = { setup: [] as CreateTreasurySetupRequest[], deploy: 0, cancel: 0, fundings: [] as CreateFundingRequest[] };
  server.use(
    meHandler(USERS[role]),
    http.get('*/api/treasury', () => HttpResponse.json(state.treasury)),
    http.get('*/api/treasury/fundings', () => HttpResponse.json(state.fundings)),
    http.get('*/api/treasury/movements', () => HttpResponse.json(state.movements)),
    http.get('*/api/treasury/funding-options', () => HttpResponse.json({ assets: FUNDING_ASSETS })),
    http.get('*/api/policy', () => HttpResponse.json({ agentEnabled: true, newPayeeCooldownHours: 48 })),
  );
  renderRoutes(
    [
      { path: '/treasury', element: <TreasuryPage /> },
      { path: '/settings', element: <p>Settings page</p> },
      { path: '/policies', element: <p>Policies page</p> },
      { path: '/payments/:id', element: <p>Payment page</p> },
    ],
    '/treasury',
  );
  return { state, calls };
}

describe('treasury: how the money is organized', () => {
  it('shows the three accounts with their real values and NearBlocks links', async () => {
    setup({ treasury: readyTreasury() });
    const accounts = await screen.findByTestId('treasury-accounts');
    const owner = within(accounts).getByTestId('account-owner');
    expect(owner).toHaveTextContent('Your wallet');
    expect(within(owner).getByTitle(OWNER_WALLET)).toBeInTheDocument();
    expect(within(owner).getByRole('link', { name: /NearBlocks/ })).toHaveAttribute('href', `https://nearblocks.io/address/${OWNER_WALLET}`);
    const vault = within(accounts).getByTestId('account-treasury');
    expect(within(vault).getByTitle(SETUP_ACCOUNT)).toBeInTheDocument();
    expect(vault).toHaveTextContent('Locked: nobody can change its code');
    const agent = within(accounts).getByTestId('account-agent');
    expect(within(agent).getByTitle(AGENT_ACCOUNT)).toBeInTheDocument();
    expect(agent).toHaveTextContent('Never send USDC here');
    expect(within(agent).getByRole('button', { name: 'Copy Agent' })).toBeInTheDocument();
  });

  it('renders balances, on-chain limits and the safety checklist with what to do when one fails', async () => {
    setup({ treasury: readyTreasury({ checks: allChecks(true, ['agentGas']), readyForLive: false, balances: { treasuryUsdc: 250, treasuryNear: 1.95, agentNear: 0.01, readAt: new Date().toISOString() } }) });
    expect(await screen.findByTestId('balance-usdc')).toHaveTextContent('250.00 USDC');
    expect(screen.getByTestId('balance-agent')).toHaveTextContent('0.0100 NEAR');
    expect(screen.getByTestId('treasury-limits')).toHaveTextContent('$50.00');
    const checks = screen.getByTestId('treasury-checks');
    expect(within(checks).getAllByRole('listitem')).toHaveLength(8);
    expect(within(checks).getByTestId('check-locked')).toHaveAttribute('data-ok', 'true');
    expect(within(checks).getByTestId('check-agentGas')).toHaveAttribute('data-ok', 'false');
    expect(within(checks).getByTestId('check-agentGas-fix')).toHaveTextContent('Send 0.5 NEAR');
    expect(screen.getByTestId('checks-summary')).toHaveTextContent('1 to fix');
    expect(screen.queryByTestId('treasury-live-cta')).not.toBeInTheDocument();
  });

  it('invites to switch to Live in Settings when everything is ready and the mode is Simulation', async () => {
    const user = userEvent.setup();
    setup({ treasury: readyTreasury() });
    const cta = await screen.findByTestId('treasury-live-cta');
    expect(cta).toHaveTextContent('Approved bills are paid for real from your treasury');
    await user.click(within(cta).getByTestId('treasury-live-link'));
    expect(await screen.findByText('Settings page')).toBeInTheDocument();
  });

  it('shows the exact owner-wallet commands, prefilled with the real accounts', async () => {
    const user = userEvent.setup();
    setup({ treasury: readyTreasury() });
    const unpause = await screen.findByTestId('owner-command-unpause');
    expect(unpause).toHaveTextContent(
      `near contract call-function as-transaction ${SETUP_ACCOUNT} unpause json-args '{}' prepaid-gas '30 Tgas' attached-deposit '1 yoctoNEAR' sign-as ${OWNER_WALLET} network-config mainnet sign-with-keychain send`,
    );
    expect(screen.getByTestId('owner-command-limits')).toHaveTextContent(`set_limits json-args '{"max_per_payment":"50000000","daily_limit":"100000000"}'`);
    expect(screen.getByTestId('owner-command-withdraw')).toHaveTextContent(`withdraw json-args '{"receiver_id":"${OWNER_WALLET}","amount":"250000000"}' prepaid-gas '100 Tgas'`);
    expect(screen.getByTestId('owner-command-agent')).toHaveTextContent(`set_agent json-args '{"agent_id":"${AGENT_ACCOUNT}"}'`);
    expect(screen.getByTestId('owner-command-install')).toHaveTextContent('npm install -g near-cli-rs');
    // The command line is an advanced, collapsed option; nothing asks to type a recovery phrase.
    expect(screen.getByTestId('owner-cli')).not.toHaveAttribute('open');
    expect(screen.getByTestId('owner-cli')).toHaveTextContent('Never type your recovery phrase');
    expect(screen.getByTestId('owner-actions')).not.toHaveTextContent(/choose your recovery phrase/i);

    const max = screen.getByTestId('owner-limits-max');
    await user.clear(max);
    await user.type(max, '75.5');
    expect(screen.getByTestId('owner-command-limits')).toHaveTextContent('"max_per_payment":"75500000"');
    await user.clear(max);
    await user.type(max, '500');
    expect(screen.queryByTestId('owner-command-limits')).not.toBeInTheDocument();
    expect(screen.getByTestId('owner-action-limits')).toHaveTextContent('cannot be higher than the daily limit');
  });
});

describe('treasury: setup wizard', () => {
  it('prefills the owner wallet with the NEAR account verified at signup', async () => {
    setup({ treasury: makeTreasury({ suggestedOwnerAccountId: 'rosa-bakery.near' }) });
    expect(await screen.findByTestId('setup-owner')).toHaveValue('rosa-bakery.near');
    expect(screen.getByTestId('setup-owner-suggested')).toHaveTextContent('the NEAR account you gave when you signed up');
  });

  it('happy path: wallet and limits → waiting for NEAR → create → ready', async () => {
    const user = userEvent.setup();
    const { state, calls } = setup({ treasury: makeTreasury() });
    server.use(
      http.post('*/api/treasury/setup', async ({ request }) => {
        const body = (await request.json()) as CreateTreasurySetupRequest;
        calls.setup.push(body);
        const created = makeSetup({ ownerAccountId: body.ownerAccountId, maxPerPayment: body.maxPerPayment, dailyLimit: body.dailyLimit });
        state.treasury = { ...state.treasury, setup: created, ownerAccountId: body.ownerAccountId };
        return HttpResponse.json(created, { status: 201 });
      }),
      http.post('*/api/treasury/setup/deploy', () => {
        calls.deploy++;
        state.treasury = readyTreasury({ readyForLive: false, checks: allChecks(true, ['funded']), balances: { treasuryUsdc: 0, treasuryNear: 1.95, agentNear: 0.3, readAt: new Date().toISOString() } });
        return HttpResponse.json(readySetup());
      }),
    );

    const wizard = await screen.findByTestId('treasury-setup');
    expect(wizard).toHaveAttribute('data-step', '1');
    expect(within(wizard).getByRole('listitem', { current: 'step' })).toHaveTextContent('Your wallet and limits');
    // Sensible small defaults that cap losses.
    expect(screen.getByTestId('setup-max')).toHaveValue('50');
    expect(screen.getByTestId('setup-daily')).toHaveValue('100');
    expect(screen.queryByTestId('treasury-status')).not.toBeInTheDocument();

    // Step 1
    await user.type(screen.getByTestId('setup-owner'), OWNER_WALLET);
    await user.click(screen.getByTestId('setup-submit'));
    await waitFor(() => expect(calls.setup).toEqual([{ ownerAccountId: OWNER_WALLET, maxPerPayment: 50, dailyLimit: 100 }]));

    // Step 2: send NEAR to the implicit account, with a QR and live progress
    expect(await screen.findByTestId('setup-fund-address')).toHaveTextContent(SETUP_ACCOUNT);
    expect(screen.getByTestId('treasury-setup')).toHaveAttribute('data-step', '2');
    expect(screen.getByTestId('setup-fund-qr')).toHaveAttribute('data-value', SETUP_ACCOUNT);
    expect(screen.getByTestId('setup-received')).toHaveTextContent('0.00 of 2.50 NEAR');
    expect(screen.getByTestId('setup-fund-warnings')).toHaveTextContent('Only send NEAR, on the NEAR network');
    expect(screen.getByTestId('setup-fund')).toHaveTextContent('Network: NEAR Protocol (NEAR). Not BNB Smart Chain');
    expect(screen.queryByTestId('setup-deploy')).not.toBeInTheDocument();
    // The not-yet-created treasury already shows in the accounts explainer.
    expect(within(screen.getByTestId('account-treasury')).getByTitle(SETUP_ACCOUNT)).toBeInTheDocument();
    expect(within(screen.getByTestId('account-owner')).getByTitle(OWNER_WALLET)).toBeInTheDocument();

    // The deposit arrives (partial first)
    state.treasury = { ...state.treasury, setup: makeSetup({ receivedNear: 1 }) };
    await user.click(screen.getByTestId('setup-check'));
    expect(await screen.findByText(/Send 1\.20 NEAR more to reach the minimum of 2\.20/)).toBeInTheDocument();
    state.treasury = { ...state.treasury, setup: makeSetup({ receivedNear: 2.5 }) };
    await user.click(screen.getByTestId('setup-check'));

    // Step 3: create
    expect(await screen.findByTestId('setup-funds-ok')).toHaveTextContent('We received 2.50 NEAR');
    expect(screen.getByTestId('treasury-setup')).toHaveAttribute('data-step', '3');
    expect(screen.getByTestId('setup-progress')).toHaveTextContent('Delete the setup key');
    await user.click(screen.getByTestId('setup-deploy'));
    await waitFor(() => expect(calls.deploy).toBe(1));

    // Step 4: ready, verified, funding comes next
    const done = await screen.findByTestId('setup-done');
    expect(within(done).getByTestId('setup-code-hash')).toHaveTextContent(CODE_HASH);
    expect(within(done).getByTestId('setup-locked')).toHaveTextContent('Yes — it has no access keys');
    expect(done).toHaveTextContent('$50.00');
    expect(await screen.findByText('Your treasury is ready')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('treasury-setup')).not.toBeInTheDocument());
    expect(screen.getByTestId('fund-button')).not.toHaveAttribute('aria-disabled');
  });

  it('shows the deploy progress with transaction links and a retry when it failed', async () => {
    const user = userEvent.setup();
    let deploys = 0;
    const failed = makeSetup({
      status: 'Failed',
      receivedNear: 2.5,
      lastError: 'RPC timeout while registering USDC',
      steps: [
        { id: 'deploy', status: 'done', txHash: 'TxDeploy111' },
        { id: 'register', status: 'failed', txHash: null },
        { id: 'agentGas', status: 'pending', txHash: null },
        { id: 'lock', status: 'pending', txHash: null },
      ],
    });
    const { state } = setup({ treasury: makeTreasury({ setup: failed, ownerAccountId: OWNER_WALLET }) });
    server.use(
      http.post('*/api/treasury/setup/deploy', () => {
        deploys++;
        state.treasury = readyTreasury();
        return HttpResponse.json(readySetup());
      }),
    );
    expect(await screen.findByTestId('setup-last-error')).toHaveTextContent('RPC timeout while registering USDC');
    expect(screen.getByTestId('setup-step-deploy')).toHaveAttribute('data-status', 'done');
    expect(screen.getByTestId('setup-step-register')).toHaveAttribute('data-status', 'failed');
    expect(screen.getByTestId('setup-step-deploy-tx')).toHaveAttribute('href', 'https://nearblocks.io/txns/TxDeploy111');
    const retry = screen.getByTestId('setup-deploy');
    expect(retry).toHaveTextContent('Try again');
    await user.click(retry);
    await waitFor(() => expect(deploys).toBe(1));
    expect(await screen.findByTestId('setup-done')).toBeInTheDocument();
  });

  it('shows server validation errors under each field and client checks before posting', async () => {
    const user = userEvent.setup();
    const { calls } = setup({ treasury: makeTreasury() });
    server.use(
      http.post('*/api/treasury/setup', async ({ request }) => {
        calls.setup.push((await request.json()) as CreateTreasurySetupRequest);
        return problem(400, 'Validation failed', { ownerAccountId: ['nobody-here.near does not exist on NEAR mainnet.'] });
      }),
    );
    const owner = await screen.findByTestId('setup-owner');
    // Client-side: format and max ≤ daily, without calling the API.
    await user.type(owner, 'Not A Wallet!');
    const max = screen.getByTestId('setup-max');
    await user.clear(max);
    await user.type(max, '500');
    await user.click(screen.getByTestId('setup-submit'));
    expect(owner).toHaveAccessibleDescription(/Enter a valid NEAR account/);
    expect(max).toHaveAccessibleDescription(/cannot be higher than the daily limit/);
    expect(calls.setup).toHaveLength(0);

    await user.clear(owner);
    await user.type(owner, 'nobody-here.near');
    await user.clear(max);
    await user.type(max, '50');
    await user.click(screen.getByTestId('setup-submit'));
    await waitFor(() => expect(owner).toHaveAccessibleDescription(/does not exist on NEAR mainnet/));
    expect(calls.setup).toHaveLength(1);
  });

  it('shows the server funds error under the create button', async () => {
    const user = userEvent.setup();
    setup({ treasury: makeTreasury({ setup: makeSetup({ receivedNear: 2.3 }), ownerAccountId: OWNER_WALLET }) });
    server.use(http.post('*/api/treasury/setup/deploy', () => problem(400, 'Validation failed', { funds: [`Send at least 2.2 NEAR to ${SETUP_ACCOUNT} first.`] })));
    await user.click(await screen.findByTestId('setup-deploy'));
    expect(await screen.findByTestId('setup-deploy-error')).toHaveTextContent('Send at least 2.2 NEAR');
  });

  it('lets the owner start over while nothing was sent', async () => {
    const user = userEvent.setup();
    let cancels = 0;
    const { state } = setup({ treasury: makeTreasury({ setup: makeSetup(), ownerAccountId: OWNER_WALLET }) });
    server.use(
      http.delete('*/api/treasury/setup', () => {
        cancels++;
        state.treasury = makeTreasury();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await user.click(await screen.findByTestId('setup-cancel'));
    const dialog = await screen.findByTestId('setup-cancel-dialog');
    await user.click(within(dialog).getByTestId('setup-cancel-confirm'));
    await waitFor(() => expect(cancels).toBe(1));
    expect(await screen.findByTestId('setup-owner')).toHaveValue('');
  });

  it('does not offer to start over once NEAR arrived', async () => {
    setup({ treasury: makeTreasury({ setup: makeSetup({ receivedNear: 0.5 }), ownerAccountId: OWNER_WALLET }) });
    expect(await screen.findByTestId('setup-fund-address')).toBeInTheDocument();
    expect(screen.queryByTestId('setup-cancel')).not.toBeInTheDocument();
  });

  it.each(['Approver', 'Auditor'] as const)('is read-only for %s', async (role) => {
    setup({ treasury: makeTreasury() }, role);
    expect(await screen.findByTestId('setup-readonly')).toHaveTextContent('Only an Owner can create the treasury');
    expect(screen.getByTestId('setup-explainer')).toBeInTheDocument();
    expect(screen.queryByTestId('setup-owner')).not.toBeInTheDocument();
  });

  it('lets non-owners follow an ongoing creation without acting on it', async () => {
    const user = userEvent.setup();
    let deploys = 0;
    setup({ treasury: makeTreasury({ setup: makeSetup({ receivedNear: 2.5 }), ownerAccountId: OWNER_WALLET }) }, 'Approver');
    server.use(
      http.post('*/api/treasury/setup/deploy', () => {
        deploys++;
        return HttpResponse.json(readySetup());
      }),
    );
    const deploy = await screen.findByTestId('setup-deploy');
    expect(deploy).toHaveAttribute('aria-disabled', 'true');
    await user.click(deploy);
    expect(deploys).toBe(0);
  });
});
