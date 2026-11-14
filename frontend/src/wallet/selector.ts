// NEAR Wallet Selector, loaded on demand (dynamic import from useOwnerWallet) so the main bundle
// does not carry the wallet SDKs. Only the treasury page's owner actions use it (ADR-0007 §5).
import './polyfills';
import { internalActionToNaj, setupWalletSelector, type Network, type WalletModuleFactory, type WalletSelector } from '@near-wallet-selector/core';
import { setupModal, type WalletSelectorModal } from '@near-wallet-selector/modal-ui';
import modalCss from '@near-wallet-selector/modal-ui/styles.css?inline';
import { outcomeTxHash, type OwnerTransaction } from '../lib/ownerTx';

/** Public RPC used by the selector and every wallet module (listed in the CSP's connect-src). */
export const RPC_URL = 'https://free.rpc.fastnear.com';

export const MAINNET: Network = {
  networkId: 'mainnet',
  nodeUrl: RPC_URL,
  helperUrl: 'https://helper.mainnet.near.org',
  explorerUrl: 'https://nearblocks.io',
  indexerUrl: 'https://api.fastnear.com/v0',
};

export interface OwnerWalletOptions {
  language: 'en' | 'es';
  theme: 'light' | 'dark';
  description: string;
}

export interface OwnerWalletHandle {
  /** Signed-in account (null when none). */
  accountId: () => string | null;
  subscribe: (listener: (accountId: string | null) => void) => () => void;
  /** Opens the wallet picker. */
  show: () => void;
  onHide: (listener: () => void) => () => void;
  signOut: () => Promise<void>;
  /** Signs and sends with the signed-in wallet; resolves with the tx hash (null if the wallet did not say). */
  send: (tx: OwnerTransaction) => Promise<string | null>;
}

/** HOT Wallet is the new name of HERE Wallet; its selector module still says "Here Wallet". */
function renamed(factory: WalletModuleFactory, name: string): WalletModuleFactory {
  return async (options) => {
    const module = await factory(options);
    return module ? { ...module, metadata: { ...module.metadata, name } } : null;
  };
}

const STYLE_ID = 'tesorero-wallet-selector-css';

/**
 * The modal stylesheet starts with a Google Fonts `@import` that our CSP blocks (and we never load
 * third-party fonts). Inject it without that line and use the app's bundled Inter.
 */
function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `${modalCss.replace(/@import\s+url\([^)]*\)\s*;?/g, '')}
#near-wallet-selector-modal .nws-modal-wrapper .nws-modal { font-family: 'Inter Variable', Inter, ui-sans-serif, system-ui, sans-serif; }
#near-wallet-selector-modal .nws-modal-wrapper { z-index: 80; }`;
  document.head.appendChild(style);
}

let instance: Promise<{ selector: WalletSelector; modal: WalletSelectorModal }> | null = null;

async function init(options: OwnerWalletOptions) {
  injectStyles();
  // Each wallet SDK in its own chunk (fetched in parallel), so no single file is huge.
  const [{ setupMyNearWallet }, { setupMeteorWallet }, { setupHereWallet }] = await Promise.all([
    import('@near-wallet-selector/my-near-wallet'),
    import('@near-wallet-selector/meteor-wallet'),
    import('@near-wallet-selector/here-wallet'),
  ]);
  const selector = await setupWalletSelector({
    network: MAINNET,
    fallbackRpcUrls: [RPC_URL],
    languageCode: options.language,
    modules: [
      setupMyNearWallet(),
      setupMeteorWallet(),
      renamed(setupHereWallet({ walletOptions: { networkId: 'mainnet', nodeUrl: RPC_URL } }), 'HOT Wallet (HERE)'),
    ],
  });
  // No `contractId`: signing in only links the account. Every owner call carries 1 yoctoNEAR, so a
  // function-call access key would never be used — no extra key, no extra fee.
  const modal = setupModal(selector, { theme: options.theme, description: options.description });
  return { selector, modal };
}

function activeAccount(selector: WalletSelector): string | null {
  const accounts = selector.store.getState().accounts;
  return accounts.find((a) => a.active)?.accountId ?? accounts[0]?.accountId ?? null;
}

export async function loadOwnerWallet(options: OwnerWalletOptions): Promise<OwnerWalletHandle> {
  instance ??= init(options);
  const { selector, modal } = await instance;
  return {
    accountId: () => activeAccount(selector),
    subscribe: (listener) => {
      const sub = selector.store.observable.subscribe(() => listener(activeAccount(selector)));
      return () => sub.unsubscribe();
    },
    show: () => modal.show(),
    onHide: (listener) => {
      const sub = modal.on('onHide', () => listener());
      return () => sub.remove();
    },
    signOut: async () => {
      if (!selector.isSignedIn()) return;
      const wallet = await selector.wallet();
      await wallet.signOut();
    },
    send: async (tx) => {
      const wallet = await selector.wallet();
      const outcome = await wallet.signAndSendTransaction({
        receiverId: tx.receiverId,
        actions: tx.actions.map((a) => internalActionToNaj(a)),
      });
      return outcomeTxHash(outcome);
    },
  };
}
