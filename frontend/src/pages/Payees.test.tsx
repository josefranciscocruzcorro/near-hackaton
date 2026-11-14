import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { Payee, PayeeInput, Token } from '../api/types';
import { meHandler, problem } from '../test/fixtures';
import { server } from '../test/server';
import { renderRoutes, signInAs, USERS } from '../test/utils';
import { PayeesPage } from './Payees';

const tk = (symbol: string, blockchain: string, assetId: string, priceUsd = 1): Token => ({ symbol, blockchain, assetId, decimals: 6, priceUsd });
const USDC_ETH = tk('USDC', 'eth', 'nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near');
const USDT_BSC = tk('USDT', 'bsc', 'nep141:bsc-0x55d398326f99059ff775485246999027b3197955.omft.near');
const USDT_TRON = tk('USDT', 'tron', 'nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near');
const USDC_SOL = tk('USDC', 'sol', 'nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near');
const DAI_ETH = tk('DAI', 'eth', 'nep141:eth-0x6b175474e89094c44da98b954eedeac495271d0f.omft.near');
const OLD = tk('USDC (DEPRECATED)', 'base', 'nep141:base-0x1111111111111111111111111111111111111111.omft.near');
const ETH = tk('ETH', 'eth', 'nep141:eth.omft.near', 3200);
const TOKENS: Token[] = [ETH, DAI_ETH, OLD, USDC_SOL, USDT_TRON, USDT_BSC, USDC_ETH];
const ADDRESS = '0x9f1c4b2a3d4e5f60718293a4b5c6d7e8f9012345';

const PAYEE: Payee = {
  id: 'p-1',
  name: 'Andes Coffee Co.',
  email: null,
  category: 'Supplier',
  destinationAssetId: USDC_ETH.assetId,
  recipientAddress: ADDRESS,
  isAllowlisted: false,
  notes: null,
  destinationSymbol: 'USDC',
  destinationChain: 'eth',
  createdAt: '2026-10-01T00:00:00Z',
  addressChangedAt: '2026-10-01T00:00:00Z',
};

function setup(path = '/payees', payees: Payee[] = []) {
  signInAs('Owner');
  const saved: PayeeInput[] = [];
  server.use(
    meHandler(USERS.Owner),
    http.get('*/api/payees', () => HttpResponse.json(payees)),
    http.get('*/api/policy', () => HttpResponse.json({ newPayeeCooldownHours: 48 })),
    http.get('*/api/tokens', () => HttpResponse.json(TOKENS)),
    http.post('*/api/payees', async ({ request }) => {
      const body = (await request.json()) as PayeeInput;
      saved.push(body);
      return HttpResponse.json({ ...PAYEE, ...body, id: 'p-new' }, { status: 201 });
    }),
    http.put('*/api/payees/:id', async ({ request }) => {
      const body = (await request.json()) as PayeeInput;
      saved.push(body);
      return HttpResponse.json({ ...PAYEE, ...body });
    }),
  );
  renderRoutes([{ path: '/payees', element: <PayeesPage /> }], path);
  return { saved };
}

const radioNames = (container: HTMLElement) =>
  within(container)
    .getAllByRole('radio')
    .map((r) => (r.getAttribute('aria-label') ?? '').split(' · ').slice(0, 2).join(' · '));

describe('payee form: NEAR Intents address verification', () => {
  it('shows the 1Click rejection inline under the recipient address', async () => {
    const user = userEvent.setup();
    setup();
    server.use(
      http.post('*/api/payees', () =>
        problem(400, 'One or more validation errors occurred.', {
          recipientAddress: ['NEAR Intents rejected this address for USDC on eth.'],
        }),
      ),
    );

    await user.click(await screen.findByTestId('new-payee-button'));
    const dialog = await screen.findByTestId('payee-dialog');
    await user.type(within(dialog).getByLabelText(/^Name/), 'Andes Coffee Co.');
    await user.click(await within(dialog).findByRole('radio', { name: /USDC · Ethereum/ }));
    const address = within(dialog).getByTestId('payee-recipient');
    await user.type(address, ADDRESS);
    expect(address).toHaveAccessibleDescription(/We verify this address with NEAR Intents before saving\./);

    await user.click(within(dialog).getByTestId('payee-form-submit'));
    expect(await within(dialog).findByText('NEAR Intents rejected this address for USDC on eth.')).toBeInTheDocument();
    expect(address).toHaveAttribute('aria-invalid', 'true');
    expect(address).toHaveAccessibleDescription(/NEAR Intents rejected this address/);
    expect(screen.getByTestId('payee-dialog')).toBeInTheDocument();
  });
});

describe('payee form: supplier token picker', () => {
  it('selects no token by default and requires a choice', async () => {
    const user = userEvent.setup();
    const { saved } = setup();
    await user.click(await screen.findByTestId('new-payee-button'));
    const dialog = await screen.findByTestId('payee-dialog');
    await within(dialog).findByTestId('token-picker');
    expect(within(dialog).getAllByRole('radio').some((r) => (r as HTMLInputElement).checked)).toBe(false);
    expect(within(dialog).getByTestId('token-picker')).toHaveTextContent('Choose how your supplier wants to be paid');

    await user.type(within(dialog).getByLabelText(/^Name/), 'Andes Coffee Co.');
    await user.type(within(dialog).getByTestId('payee-recipient'), ADDRESS);
    await user.click(within(dialog).getByTestId('payee-form-submit'));
    expect(await within(dialog).findByText('Choose the destination token.')).toBeInTheDocument();
    expect(saved).toHaveLength(0);
  });

  it('shows the recommended stablecoins first with full network names, hides deprecated and non-stablecoins', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByTestId('new-payee-button'));
    const picker = await screen.findByTestId('token-picker');
    const recommended = within(picker).getByTestId('token-group-recommended');
    expect(radioNames(recommended)).toEqual([
      'USDC · Solana',
      'USDC · Ethereum (ERC20)',
      'USDT · Tron (TRC20)',
      'USDT · BNB Smart Chain (BEP20)',
    ]);
    expect(within(picker).getByTestId('token-group-others')).toHaveTextContent('DAI');
    expect(picker).not.toHaveTextContent('DEPRECATED');
    expect(within(picker).queryByRole('radio', { name: /^ETH/ })).not.toBeInTheDocument();

    await user.click(within(picker).getByTestId('token-show-all'));
    expect(picker).toHaveTextContent('DEPRECATED');
    expect(within(picker).getByRole('radio', { name: /^ETH · Ethereum/ })).toBeInTheDocument();
  });

  it('never changes the chosen token while searching', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByTestId('new-payee-button'));
    const picker = await screen.findByTestId('token-picker');
    await user.click(within(picker).getByRole('radio', { name: /USDT · Tron/ }));
    await user.type(within(picker).getByTestId('token-search'), 'bnb');
    // The choice stays checked (shown on top as "Your choice") while the results change.
    expect(within(picker).getByTestId('token-group-selected')).toHaveTextContent('USDT · Tron (TRC20)');
    expect(within(picker).getByRole('radio', { name: /USDT · Tron/ })).toBeChecked();
    expect(within(picker).getByRole('radio', { name: /USDT · BNB Smart Chain/ })).not.toBeChecked();
  });

  it('turns automatic payments on by default for a new supplier', async () => {
    const user = userEvent.setup();
    const { saved } = setup();
    await user.click(await screen.findByTestId('new-payee-button'));
    const dialog = await screen.findByTestId('payee-dialog');
    expect(within(dialog).getByRole('switch', { name: 'Automatic payments to this supplier' })).toBeChecked();
    await user.type(within(dialog).getByLabelText(/^Name/), 'Andes Coffee Co.');
    await user.click(await within(dialog).findByRole('radio', { name: /USDT · BNB Smart Chain/ }));
    await user.type(within(dialog).getByTestId('payee-recipient'), ADDRESS);
    await user.click(within(dialog).getByTestId('payee-form-submit'));
    await waitFor(() => expect(saved).toEqual([expect.objectContaining({ isAllowlisted: true, destinationAssetId: USDT_BSC.assetId })]));
  });

  it('uses plain words for automatic payments in the list (ES)', async () => {
    signInAs('Owner');
    server.use(
      meHandler(USERS.Owner),
      http.get('*/api/payees', () => HttpResponse.json([PAYEE, { ...PAYEE, id: 'p-2', name: 'Lima Beans', isAllowlisted: true }])),
      http.get('*/api/policy', () => HttpResponse.json({ newPayeeCooldownHours: 48 })),
    );
    renderRoutes([{ path: '/payees', element: <PayeesPage /> }], '/payees', { lang: 'es' });
    expect((await screen.findAllByText('Pagos automáticos: no')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Pagos automáticos: sí').length).toBeGreaterThan(0);
    expect(screen.queryByText(/permitido/i)).not.toBeInTheDocument();
  });

  it('"Allow this supplier" opens the supplier with automatic payments turned on', async () => {
    const user = userEvent.setup();
    const { saved } = setup('/payees?edit=p-1&allow=1', [PAYEE]);
    const dialog = await screen.findByTestId('payee-dialog');
    expect(within(dialog).getByTestId('payee-allow-note')).toBeInTheDocument();
    expect(within(dialog).getByRole('switch', { name: 'Automatic payments to this supplier' })).toBeChecked();
    await user.click(within(dialog).getByTestId('payee-form-submit'));
    await waitFor(() => expect(saved).toEqual([expect.objectContaining({ isAllowlisted: true })]));
  });
});
